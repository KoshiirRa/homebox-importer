import express from "express";
import { fileURLToPath } from "node:url";
import { lookupBook, normalizeIsbn } from "./books.js";
import { isValidGtin, lookupMedia, normalizeBarcode } from "./media.js";
import { HomeboxClient } from "./homebox.js";
import { lookupBookCover } from "./vision.js";

function emitSuccess(logger, event) {
  logger.info(JSON.stringify({ timestamp: new Date().toISOString(), ...event }));
}

function lookupSummary({ workflow, identifier, result, startedAt }) {
  const matches = Array.isArray(result) ? result : result?.matches ?? [];
  return {
    event: "lookup.succeeded",
    workflow,
    identifier,
    provider: matches[0]?.provider || "none",
    resultCount: matches.length,
    durationMs: Date.now() - startedAt
  };
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
    const startedAt = Date.now();
    try {
      const result = await bookLookup(request.params.isbn);
      emitSuccess(logger, lookupSummary({ workflow: "book", identifier: normalizeIsbn(request.params.isbn), result, startedAt }));
      response.json(result);
    } catch (error) { next(error); }
  });

  app.get("/api/lookup/:barcode", async (request, response, next) => {
    const startedAt = Date.now();
    try {
      const barcode = normalizeBarcode(request.params.barcode);
      const isIsbn = /^(978|979)/.test(barcode) && isValidGtin(barcode);
      const result = isIsbn ? await bookLookup(barcode) : await mediaLookup(barcode);
      emitSuccess(logger, lookupSummary({ workflow: isIsbn ? "book" : "media", identifier: barcode, result, startedAt }));
      response.json(result);
    } catch (error) { next(error); }
  });

  app.post("/api/books/cover", async (request, response, next) => {
    const startedAt = Date.now();
    try {
      if (!coverLookup) return response.status(503).json({ error: "Cover scanning is not configured" });
      const { image, barcode } = request.body ?? {};
      if (!image) return response.status(400).json({ error: "Choose a book cover photo" });
      const result = await coverLookup(image, barcode);
      emitSuccess(logger, lookupSummary({ workflow: "cover", identifier: normalizeIsbn(barcode), result, startedAt }));
      response.json(result);
    } catch (error) { next(error); }
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
        provider: book.provider || "unknown", destinationId: parentId, entityId: entity.id,
        assetId: entity.assetId || "", quantity: Number(entity.quantity ?? 1), durationMs: Date.now() - startedAt
      });
      response.status(201).json(entity);
    } catch (error) { next(error); }
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
        provider: item.provider || "unknown", destinationId: parentId, entityId: entity.id,
        assetId: entity.assetId || "", quantity: Number(entity.quantity ?? item.quantity ?? 1), durationMs: Date.now() - startedAt
      });
      response.status(201).json(entity);
    } catch (error) { next(error); }
  });

  const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));
  const indexFile = fileURLToPath(new URL("../public/index.html", import.meta.url));
  app.use(express.static(publicDirectory));
  app.get("/{*path}", (_request, response) => response.sendFile(indexFile));
  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(502).json({ error: error.message || "Unexpected integration error" });
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
