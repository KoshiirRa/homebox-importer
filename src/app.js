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

function asBookCandidates(result, lookupIdentifier = "", identifierless = false) {
  const decorate = item => ({
    ...item,
    mediaType: "Book",
    lookupIdentifier: identifierless ? "" : normalizeIsbn(lookupIdentifier),
    ...(identifierless && item.isbn ? { catalogCandidateIsbn: item.isbn, isbn: "" } : {})
  });
  if (Array.isArray(result)) return result.map(decorate);
  return { ...result, matches: (result.matches ?? []).map(decorate) };
}

function importFailureSummary({ workflow, identifier, provider, provenance, details = {}, error, startedAt, correlationId: id }) {
  return {
    event: "import.failed", workflow, ...(identifier ? { identifier } : {}),
    provider: provider || "unknown", provenance: provenance || "unknown",
    ...details, failureCode: error.code || "homebox_failure", durationMs: Date.now() - startedAt, correlationId: id
  };
}

async function runImport({ response, next, logger, workflow, identifier, provider, provenance, details = () => ({}), operation }) {
  const startedAt = Date.now();
  const id = correlationId();
  response.set("x-correlation-id", id);
  try {
    const entity = await operation();
    emitSuccess(logger, {
      event: "import.succeeded", workflow, ...(identifier() ? { identifier: identifier() } : {}),
      provider: provider(), provenance: provenance(), ...details(), destinationId: entity.destinationId,
      entityId: entity.id, assetId: entity.assetId || "", quantity: Number(entity.quantity ?? 1),
      durationMs: Date.now() - startedAt, correlationId: id
    });
    response.status(201).json(entity);
  } catch (caught) {
    const error = caught instanceof OperationalError ? caught : new OperationalError(
      "homebox_failure", `HomeBox could not create the ${workflow === "book" ? "book" : "item"}`, { status: 502, cause: caught }
    );
    emitSuccess(logger, importFailureSummary({ workflow, identifier: identifier(), provider: provider(), provenance: provenance(), details: details(), error, startedAt, correlationId: id }));
    error.correlationId = id;
    next(error);
  }
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
      identifier: () => normalizeIsbn(request.params.isbn), operation: async () => asBookCandidates(await bookLookup(request.params.isbn), request.params.isbn) });
  });

  app.get("/api/lookup/:barcode", async (request, response, next) => {
    const barcode = normalizeBarcode(request.params.barcode);
    const isIsbn = /^(978|979)/.test(barcode) && isValidGtin(barcode);
    await runLookup({ request, response, next, logger, workflow: isIsbn ? "book" : "media",
      identifier: () => barcode, operation: async () => isIsbn ? asBookCandidates(await bookLookup(barcode), barcode) : mediaLookup(barcode) });
  });

  app.post("/api/books/cover", async (request, response, next) => {
    const { image, barcode, identifierless = false } = request.body ?? {};
    await runLookup({ request, response, next, logger, workflow: "cover",
      identifier: () => normalizeIsbn(barcode), operation: async () => {
        if (!coverLookup) throw new OperationalError("provider_unavailable", "Cover scanning is not configured", { status: 503 });
        if (!image) throw new OperationalError("invalid_identifier", "Choose a book cover photo", { status: 400 });
        return asBookCandidates(await coverLookup(image, barcode), barcode, Boolean(identifierless));
      } });
  });

  app.post("/api/import/books", async (request, response, next) => {
    const { book, parentId } = request.body ?? {};
    const providerIsbn = normalizeIsbn(book?.isbn);
    const scannedIsbn = normalizeIsbn(book?.lookupIdentifier);
    const identifier = () => providerIsbn || scannedIsbn;
    await runImport({ response, next, logger, workflow: "book", identifier,
      provider: () => book?.provider || "unknown", provenance: () => book?.provenance || "provider_candidate",
      details: () => ({ identifierProvenance: providerIsbn ? "provider" : scannedIsbn ? "scan" : "none" }),
      operation: async () => {
        if (!book?.title?.trim()) throw new OperationalError("invalid_identifier", "Book title is required", { status: 400 });
        if (!parentId) throw new OperationalError("invalid_identifier", "Select a destination box or location", { status: 400 });
        if (providerIsbn && scannedIsbn && providerIsbn !== scannedIsbn) {
          throw new OperationalError("invalid_identifier", "The provider ISBN conflicts with the scanned ISBN; review another match or use manual entry", { status: 409 });
        }
        const entity = await homebox.createBook({ ...book, isbn: identifier(), parentId });
        return { ...entity, destinationId: parentId };
      } });
  });

  app.post("/api/import/items", async (request, response, next) => {
    const { item, parentId } = request.body ?? {};
    await runImport({ response, next, logger, workflow: "media", identifier: () => normalizeBarcode(item?.barcode),
      provider: () => item?.provider || "unknown", provenance: () => item?.provenance || "provider_candidate",
      operation: async () => {
        if (!item?.title || !item?.barcode) throw new OperationalError("invalid_identifier", "Item title and barcode are required", { status: 400 });
        if (!parentId) throw new OperationalError("invalid_identifier", "Select a destination box or location", { status: 400 });
        const entity = await homebox.createInventoryItem({ ...item, parentId });
        return { ...entity, destinationId: parentId };
      } });
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
