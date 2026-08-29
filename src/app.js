import express from "express";
import { fileURLToPath } from "node:url";
import { lookupBook, normalizeIsbn } from "./books.js";
import { isValidGtin, lookupMedia, normalizeBarcode } from "./media.js";
import { HomeboxClient } from "./homebox.js";
import { lookupBookCover } from "./vision.js";
import { correlationId, OperationalError, safeError } from "./operational-errors.js";

function emitSuccess(logger, event) {
  logger.info(JSON.stringify({ timestamp: new Date().toISOString(), ...event }));
}

function lookupSummary({ workflow, identifier, result, startedAt, correlationId: id }) {
  const matches = Array.isArray(result) ? result : result?.matches ?? [];
  return {
    event: "lookup.succeeded",
    workflow,
    identifier,
    provider: matches[0]?.provider || "none",
    resultCount: matches.length,
    durationMs: Date.now() - startedAt,
    correlationId: id
  };
}

function failureSummary({ workflow, identifier, error, startedAt, correlationId: id }) {
  return {
    event: "lookup.failed", workflow, ...(error.code !== "invalid_identifier" && identifier ? { identifier } : {}),
    failureCode: error.code, providerAttempts: error.attempts ?? [],
    durationMs: Date.now() - startedAt, correlationId: id
  };
}

async function runLookup({ request, response, next, logger, workflow, identifier, operation }) {
  const startedAt = Date.now();
  const id = correlationId();
  response.set("x-correlation-id", id);
  try {
    const result = await operation();
    emitSuccess(logger, lookupSummary({ workflow, identifier: identifier(), result, startedAt, correlationId: id }));
    response.json(result);
  } catch (caught) {
    const error = caught instanceof OperationalError ? caught : safeError(caught);
    emitSuccess(logger, failureSummary({ workflow, identifier: identifier(), error, startedAt, correlationId: id }));
    error.correlationId = id;
    error.unexpected = !(caught instanceof OperationalError);
    next(error);
  }
}

export function createApp({ homebox, bookLookup = lookupBook, mediaLookup = lookupMedia, coverLookup = null, logger = console } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "6mb" }));

  app.get("/api/health", async (_request, response, next) => {
    try {
      const status = await homebox.status();
      response.json({
        ok: true,
        homebox: { health: status.health, version: status.build?.version },
        features: { coverLookup: Boolean(coverLookup) }
      });
    } catch (error) { next(error); }
  });

  app.get("/api/locations", async (_request, response, next) => {
    try { response.json(await homebox.locations()); } catch (error) { next(error); }
  });

  app.get("/api/label-destinations", async (_request, response, next) => {
    try { response.json(await homebox.labelDestinations()); } catch (error) { next(error); }
  });

  app.get("/api/boxes/:id", async (request, response, next) => {
    try { response.json(await homebox.boxContents(request.params.id)); } catch (error) { next(error); }
  });

  app.get("/api/books/:isbn", async (request, response, next) => {
    await runLookup({ request, response, next, logger, workflow: "book",
      identifier: () => normalizeIsbn(request.params.isbn), operation: () => bookLookup(request.params.isbn) });
  });

  app.get("/api/lookup/:barcode", async (request, response, next) => {
    const barcode = normalizeBarcode(request.params.barcode);
    const isIsbn = /^(978|979)/.test(barcode) && isValidGtin(barcode);
    await runLookup({ request, response, next, logger, workflow: isIsbn ? "book" : "media",
      identifier: () => barcode, operation: () => isIsbn ? bookLookup(barcode) : mediaLookup(barcode) });
  });

  app.post("/api/books/cover", async (request, response, next) => {
    const { image, barcode } = request.body ?? {};
    await runLookup({ request, response, next, logger, workflow: "cover",
      identifier: () => normalizeIsbn(barcode), operation: async () => {
        if (!coverLookup) throw new OperationalError("provider_unavailable", "Cover scanning is not configured", { status: 503 });
        if (!image) throw new OperationalError("invalid_identifier", "Choose a book cover photo", { status: 400 });
        return coverLookup(image, barcode);
      } });
  });

  app.post("/api/import/books", async (request, response, next) => {
    const startedAt = Date.now();
    try {
      const { book, parentId } = request.body ?? {};
      if (!book?.title || !book?.isbn) return response.status(400).json({ error: "Book title and ISBN are required" });
      if (!parentId) return response.status(400).json({ error: "Select a destination box or location" });
      const entity = await homebox.createBook({ ...book, parentId });
      emitSuccess(logger, {
        event: "import.succeeded", workflow: "book", identifier: normalizeIsbn(book.isbn),
        provider: book.provider || "unknown", provenance: book.provenance || "provider_candidate", destinationId: parentId, entityId: entity.id,
        assetId: entity.assetId || "", quantity: Number(entity.quantity ?? 1), durationMs: Date.now() - startedAt
      });
      response.status(201).json(entity);
    } catch (error) { next(new OperationalError("homebox_failure", "HomeBox could not create the book", { status: 502, cause: error })); }
  });

  app.post("/api/import/items", async (request, response, next) => {
    const startedAt = Date.now();
    try {
      const { item, parentId } = request.body ?? {};
      if (!item?.title || !item?.barcode) return response.status(400).json({ error: "Item title and barcode are required" });
      if (!parentId) return response.status(400).json({ error: "Select a destination box or location" });
      const entity = await homebox.createInventoryItem({ ...item, parentId });
      emitSuccess(logger, {
        event: "import.succeeded", workflow: "media", identifier: normalizeBarcode(item.barcode),
        provider: item.provider || "unknown", provenance: item.provenance || "provider_candidate", destinationId: parentId, entityId: entity.id,
        assetId: entity.assetId || "", quantity: Number(entity.quantity ?? item.quantity ?? 1), durationMs: Date.now() - startedAt
      });
      response.status(201).json(entity);
    } catch (error) { next(new OperationalError("homebox_failure", "HomeBox could not create the item", { status: 502, cause: error })); }
  });

  const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));
  const indexFile = fileURLToPath(new URL("../public/index.html", import.meta.url));
  app.use(express.static(publicDirectory));
  app.get("/{*path}", (_request, response) => response.sendFile(indexFile));
  app.use((error, _request, response, _next) => {
    if (error.unexpected) logger.error?.(error.stack || "Unexpected lookup defect");
    response.status(error.status || 502).json({
      error: error.message || "Unexpected integration error",
      ...(error.code ? { code: error.code } : {}),
      ...(error.correlationId ? { correlationId: error.correlationId } : {}),
      ...(error.details ? error.details : {})
    });
  });
  return app;
}

export function createConfiguredApp(env = process.env) {
  const homebox = new HomeboxClient({
    baseUrl: env.HOMEBOX_URL ?? "http://homebox:7745",
    apiKey: env.HOMEBOX_API_KEY
  });
  const bookLookup = isbn => lookupBook(isbn, fetch, {
    googleBooksApiKey: env.GOOGLE_BOOKS_API_KEY,
    hardcoverApiToken: env.HARDCOVER_API_TOKEN,
    isbnDbApiKey: env.ISBNDB_API_KEY,
    braveSearchApiKey: env.BRAVE_SEARCH_API_KEY
  });
  const mediaLookup = barcode => lookupMedia(barcode, fetch, {
    discogsToken: env.DISCOGS_TOKEN,
    upcItemDbApiKey: env.UPCITEMDB_API_KEY
  });
  const coverLookup = env.GOOGLE_CLOUD_VISION_API_KEY
    ? (image, barcode) => lookupBookCover(image, barcode, fetch, {
      apiKey: env.GOOGLE_CLOUD_VISION_API_KEY,
      googleBooksApiKey: env.GOOGLE_BOOKS_API_KEY,
      braveSearchApiKey: env.BRAVE_SEARCH_API_KEY
    })
    : null;
  return createApp({ homebox, bookLookup, mediaLookup, coverLookup });
}
