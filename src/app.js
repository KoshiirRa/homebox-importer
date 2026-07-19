import express from "express";
import { fileURLToPath } from "node:url";
import { lookupBook } from "./books.js";
import { isValidGtin, lookupMedia, normalizeBarcode } from "./media.js";
import { HomeboxClient } from "./homebox.js";

export function createApp({ homebox, bookLookup = lookupBook, mediaLookup = lookupMedia } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", async (_request, response, next) => {
    try {
      const status = await homebox.status();
      response.json({ ok: true, homebox: { health: status.health, version: status.build?.version } });
    } catch (error) { next(error); }
  });

  app.get("/api/locations", async (_request, response, next) => {
    try { response.json(await homebox.locations()); } catch (error) { next(error); }
  });

  app.get("/api/boxes/:id", async (request, response, next) => {
    try { response.json(await homebox.boxContents(request.params.id)); } catch (error) { next(error); }
  });

  app.get("/api/books/:isbn", async (request, response, next) => {
    try { response.json(await bookLookup(request.params.isbn)); } catch (error) { next(error); }
  });

  app.get("/api/lookup/:barcode", async (request, response, next) => {
    try {
      const barcode = normalizeBarcode(request.params.barcode);
      const isIsbn = /^(978|979)/.test(barcode) && isValidGtin(barcode);
      response.json(isIsbn ? await bookLookup(barcode) : await mediaLookup(barcode));
    } catch (error) { next(error); }
  });

  app.post("/api/import/books", async (request, response, next) => {
    try {
      const { book, parentId } = request.body ?? {};
      if (!book?.title || !book?.isbn) return response.status(400).json({ error: "Book title and ISBN are required" });
      if (!parentId) return response.status(400).json({ error: "Select a destination box or location" });
      const entity = await homebox.createBook({ ...book, parentId });
      response.status(201).json(entity);
    } catch (error) { next(error); }
  });

  app.post("/api/import/items", async (request, response, next) => {
    try {
      const { item, parentId } = request.body ?? {};
      if (!item?.title || !item?.barcode) return response.status(400).json({ error: "Item title and barcode are required" });
      if (!parentId) return response.status(400).json({ error: "Select a destination box or location" });
      response.status(201).json(await homebox.createInventoryItem({ ...item, parentId }));
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
    hardcoverApiToken: env.HARDCOVER_API_TOKEN,
    isbnDbApiKey: env.ISBNDB_API_KEY
  });
  const mediaLookup = barcode => lookupMedia(barcode, fetch, {
    discogsToken: env.DISCOGS_TOKEN,
    upcItemDbApiKey: env.UPCITEMDB_API_KEY
  });
  return createApp({ homebox, bookLookup, mediaLookup });
}
