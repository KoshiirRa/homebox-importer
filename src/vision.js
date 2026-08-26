import { normalizeIsbn } from "./books.js";
import { searchBraveBooks, titleSimilarity } from "./brave.js";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function imageContent(value) {
  const match = String(value ?? "").match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Choose a JPEG, PNG, or WebP cover photo");
  const content = match[1];
  if (Math.ceil(content.length * 3 / 4) > MAX_IMAGE_BYTES) {
    throw new Error("Cover photo must be smaller than 4 MB");
  }
  return content;
}

function coverQuery(text) {
  const lines = String(text ?? "").split(/\r?\n/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(line => line.length >= 2 && line.length <= 120);
  return [...new Set(lines)].slice(0, 8).join(" ").slice(0, 500);
}

function googleMatch(item, fallbackIsbn) {
  const info = item.volumeInfo ?? {};
  const providerIsbn = (info.industryIdentifiers ?? [])
    .find(identifier => identifier.type === "ISBN_13")?.identifier;
  return {
    provider: "Google Books cover search",
    providerId: item.id,
    isbn: normalizeIsbn(providerIsbn) === fallbackIsbn ? fallbackIsbn : normalizeIsbn(providerIsbn),
    title: info.title ?? "Untitled book",
    subtitle: info.subtitle ?? "",
    authors: info.authors ?? [],
    publisher: info.publisher ?? "",
    publishedDate: info.publishedDate ?? "",
    description: info.description ?? "",
    coverUrl: info.imageLinks?.thumbnail?.replace(/^http:/, "https:") ?? ""
  };
}

function openLibraryMatch(book, fallbackIsbn) {
  const providerIsbn = (book.isbn ?? []).map(normalizeIsbn).find(Boolean) ?? "";
  return {
    provider: "Open Library cover search",
    providerId: book.key ?? fallbackIsbn,
    isbn: providerIsbn === fallbackIsbn ? fallbackIsbn : providerIsbn,
    title: book.title ?? "Untitled book",
    subtitle: book.subtitle ?? "",
    authors: book.author_name ?? [],
    publisher: book.publisher?.[0] ?? "",
    publishedDate: book.first_publish_year ? String(book.first_publish_year) : "",
    description: "",
    coverUrl: book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : ""
  };
}

async function responseJson(response) {
  if (!response?.ok) return null;
  try { return await response.json(); } catch { return null; }
}

async function safeFetch(fetchImpl, ...args) {
  try { return await fetchImpl(...args); } catch { return null; }
}

export async function lookupBookCover(image, barcode, fetchImpl = fetch, { apiKey = "", googleBooksApiKey = "", braveSearchApiKey = "" } = {}) {
  if (!apiKey) throw new Error("Cover scanning is not configured");
  const content = imageContent(image);
  const visionResponse = await safeFetch(fetchImpl, "https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ requests: [{ image: { content }, features: [{ type: "TEXT_DETECTION", maxResults: 1 }] }] })
  });
  const visionData = await responseJson(visionResponse);
  const annotation = visionData?.responses?.[0];
  if (!visionData || annotation?.error) throw new Error("Cover text recognition failed");
  const text = annotation?.fullTextAnnotation?.text || annotation?.textAnnotations?.[0]?.description || "";
  const query = coverQuery(text);
  if (!query) return { text: "", matches: [] };

  const isbn = normalizeIsbn(barcode);
  const googleUrl = new URL("https://www.googleapis.com/books/v1/volumes");
  googleUrl.searchParams.set("q", query);
  googleUrl.searchParams.set("maxResults", "5");
  if (googleBooksApiKey) googleUrl.searchParams.set("key", googleBooksApiKey);
  const openLibraryUrl = new URL("https://openlibrary.org/search.json");
  openLibraryUrl.searchParams.set("q", query);
  openLibraryUrl.searchParams.set("fields", "key,title,subtitle,author_name,publisher,first_publish_year,cover_i,isbn");
  openLibraryUrl.searchParams.set("limit", "5");

  const [googleData, openLibraryData] = await Promise.all([
    safeFetch(fetchImpl, googleUrl).then(responseJson),
    safeFetch(fetchImpl, openLibraryUrl, {
      headers: { "User-Agent": "HomeBox-Importer/0.1 (personal inventory application)" }
    }).then(responseJson)
  ]);
  const catalogMatches = [
    ...(googleData?.items ?? []).map(item => googleMatch(item, isbn)),
    ...(openLibraryData?.docs ?? []).map(book => openLibraryMatch(book, isbn))
  ].filter(book => titleSimilarity(query, `${book.title} ${book.subtitle} ${book.authors.join(" ")}`) >= 0.7);
  const braveMatches = braveSearchApiKey && !catalogMatches.some(book => book.isbn === isbn)
    ? await searchBraveBooks({ isbn, text: query }, fetchImpl, { apiKey: braveSearchApiKey })
    : [];
  const matches = [...braveMatches, ...catalogMatches];
  const uniqueMatches = [...new Map(matches.map(book => [
    `${book.title}\n${book.authors.join(",")}`.toLocaleLowerCase(), book
  ])).values()];
  return { text, matches: uniqueMatches.slice(0, 8) };
}
