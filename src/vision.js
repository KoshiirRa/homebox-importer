import { isValidIsbn, normalizeIsbn } from "./books.js";
import { OperationalError, providerAttempt } from "./operational-errors.js";
import { searchBraveBooks } from "./brave.js";
import { extractGeminiBookMetadata } from "./gemini.js";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_QUERIES = 3;
const RESULTS_PER_QUERY = 5;

function imageContent(value) {
  const match = String(value ?? "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new OperationalError("invalid_identifier", "Choose a JPEG, PNG, or WebP cover photo", { status: 400 });
  if (Math.ceil(match[2].length * 3 / 4) > MAX_IMAGE_BYTES) throw new OperationalError("invalid_identifier", "Cover photo must be smaller than 4 MB", { status: 400 });
  return { mimeType: match[1], content: match[2] };
}

function wordsFromParagraph(paragraph) {
  return (paragraph.words ?? []).map(word => ({ text: (word.symbols ?? []).map(symbol => symbol.text ?? "").join(""), confidence: word.confidence ?? null, boundingBox: word.boundingBox ?? null })).filter(word => word.text);
}

export function extractOcr(annotation = {}) {
  const structuredLines = [];
  for (const page of annotation.fullTextAnnotation?.pages ?? []) for (const block of page.blocks ?? []) for (const paragraph of block.paragraphs ?? []) {
    const words = wordsFromParagraph(paragraph);
    const text = words.map(word => word.text).join(" ").replace(/\s+/g, " ").trim();
    if (text) structuredLines.push({ text, words, confidence: paragraph.confidence ?? block.confidence ?? null, boundingBox: paragraph.boundingBox ?? block.boundingBox ?? null });
  }
  const text = annotation.fullTextAnnotation?.text || annotation.textAnnotations?.[0]?.description || structuredLines.map(line => line.text).join("\n");
  const fallbackLines = String(text).split(/\r?\n/).map(value => value.replace(/\s+/g, " ").trim()).filter(Boolean);
  return { text: String(text), lines: structuredLines.length ? structuredLines : fallbackLines.map(value => ({ text: value, words: [], confidence: null, boundingBox: null })) };
}

export function buildCoverQueries(ocr) {
  const lines = ocr.lines.filter(line => line.text.length >= 2 && line.text.length <= 100 && /[A-Za-z]/.test(line.text)).slice(0, 10);
  const contextPattern = /\b(?:edition|sourcebook|publisher|publishing|studios|press)\b/i;
  const markedContext = lines.filter(line => contextPattern.test(line.text)).map(line => line.text.toLowerCase());
  const isContext = line => contextPattern.test(line.text) || (line.text.split(/\s+/).length >= 2 && markedContext.some(text => text !== line.text.toLowerCase() && text.includes(line.text.toLowerCase())));
  const titleLines = lines.filter(line => !isContext(line));
  const fragments = [];
  for (let index = 0; index < titleLines.length - 1; index += 1) {
    const first = titleLines[index]; const second = titleLines[index + 1];
    if (/^(?:&|and\b|or\b|of\b|the\b)/i.test(second.text) || /[:\-–—]$/.test(first.text)) {
      fragments.push({
        text: `${first.text} ${second.text}`.replace(/\s+/g, " ").trim(),
        confidence: Math.min(first.confidence ?? .5, second.confidence ?? .5)
      });
    }
  }
  const ranked = [...fragments, ...(titleLines.length ? titleLines : lines)]
    .sort((a, b) => (b.confidence ?? .5) - (a.confidence ?? .5) || b.text.length - a.text.length);
  const title = ranked[0]?.text ?? "";
  const author = ranked.slice(1).find(line => /\b(?:by|author)\b/i.test(line.text))?.text.replace(/^.*?\b(?:by|author)\b\s*/i, "") || ranked.slice(1, 4).find(line => line.text.split(/\s+/).length <= 5)?.text || "";
  const queries = title ? [{ title, author }] : [];
  for (const line of ranked.slice(1)) {
    if (queries.length >= MAX_QUERIES) break;
    if (!queries.some(query => query.title.toLowerCase() === line.text.toLowerCase())) queries.push({ title: line.text, author: "" });
  }
  return queries;
}

function tokens(value) { return new Set(String(value).toLowerCase().match(/[a-z0-9]{3,}/g) ?? []); }
function overlap(left, right) {
  const a = tokens(left); const b = tokens(right);
  return a.size && b.size ? [...a].filter(token => b.has(token)).length / Math.min(a.size, b.size) : 0;
}

export function titleSimilarity(left, right) {
  const expected = tokens(left); const candidate = tokens(right);
  if (!expected.size || !candidate.size) return 0;
  const shared = [...expected].filter(token => candidate.has(token)).length;
  if (expected.size === 1) return shared === 1 && candidate.size === 1 ? 1 : 0;
  const expectedCoverage = shared / expected.size;
  const dice = (2 * shared) / (expected.size + candidate.size);
  return dice * .85 + expectedCoverage * .15;
}

export function scoreCoverCandidate(candidate, query, scannedIsbn = "") {
  const reported = normalizeIsbn(candidate.isbn);
  const exact = Boolean(scannedIsbn && reported === scannedIsbn);
  const conflict = Boolean(scannedIsbn && reported && reported !== scannedIsbn);
  const completeness = [candidate.authors?.length, candidate.publisher, candidate.publishedDate, candidate.coverUrl].filter(Boolean).length;
  return (exact ? 1000 : 0) + titleSimilarity(query.title, `${candidate.title} ${candidate.subtitle}`) * 100 + overlap(query.author, (candidate.authors ?? []).join(" ")) * 35 + titleSimilarity(query.title, candidate.subtitle ?? "") * 15 + completeness * 2 - (conflict ? 30 : 0);
}

function agreesWithGemini(candidate, metadata) {
  if (!metadata?.title) return true;
  const candidateTitle = `${candidate.title} ${candidate.subtitle}`;
  const titleAgreement = titleSimilarity(metadata.title, candidateTitle);
  if (titleAgreement < .8) return false;

  const expectedAuthors = metadata.authors ?? [];
  const candidateAuthors = candidate.authors ?? [];
  const hasAuthorEvidence = expectedAuthors.length && candidateAuthors.length;
  if (hasAuthorEvidence && overlap(expectedAuthors.join(" "), candidateAuthors.join(" ")) === 0) return false;

  const hasPublisherEvidence = metadata.publisher && candidate.publisher;
  if (hasPublisherEvidence && overlap(metadata.publisher, candidate.publisher) === 0) return false;

  return hasAuthorEvidence || hasPublisherEvidence || titleAgreement >= .95;
}

function googleMatch(item) {
  const info = item.volumeInfo ?? {};
  const isbn = (info.industryIdentifiers ?? []).map(value => normalizeIsbn(value.identifier)).find(isValidIsbn) ?? "";
  return { provider: "Google Books cover search", providerId: item.id, isbn, title: info.title ?? "Untitled book", subtitle: info.subtitle ?? "", authors: info.authors ?? [], publisher: info.publisher ?? "", publishedDate: info.publishedDate ?? "", description: info.description ?? "", coverUrl: info.imageLinks?.thumbnail?.replace(/^http:/, "https:") ?? "" };
}

function openLibraryMatch(book) {
  const isbn = (book.isbn ?? []).map(normalizeIsbn).find(isValidIsbn) ?? "";
  return { provider: "Open Library cover search", providerId: book.key ?? "", isbn, title: book.title ?? "Untitled book", subtitle: book.subtitle ?? "", authors: book.author_name ?? [], publisher: book.publisher?.[0] ?? "", publishedDate: book.first_publish_year ? String(book.first_publish_year) : "", description: "", coverUrl: book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : "" };
}

async function responseJson(response) { if (!response?.ok) return null; try { return await response.json(); } catch { return null; } }
async function safeFetch(fetchImpl, ...args) { try { return await fetchImpl(...args); } catch { return null; } }
function geminiQueries(metadata) {
  if (!metadata?.title) return [];
  return [{ title: metadata.title, author: metadata.authors?.[0] ?? "" }];
}

function mergeQueries(...sets) {
  const unique = new Map();
  for (const query of sets.flat()) {
    const key = `${query.title}|${query.author}`.toLowerCase();
    if (query.title && !unique.has(key)) unique.set(key, query);
  }
  return [...unique.values()].slice(0, MAX_QUERIES);
}

function manualDraft(ocr, queries, metadata) {
  return {
    source: metadata ? "gemini" : "ocr",
    title: metadata?.title ?? queries[0]?.title ?? ocr.lines[0]?.text ?? "",
    subtitle: metadata?.subtitle ?? "",
    authors: metadata?.authors?.length ? metadata.authors : queries[0]?.author ? [queries[0].author] : [],
    publisher: metadata?.publisher ?? "",
    publishedDate: metadata?.publishedDate ?? "",
    edition: metadata?.edition ?? "",
    format: metadata?.format ?? "",
    series: metadata?.series ?? "",
    confidence: metadata?.confidence ?? null,
    lines: ocr.lines.map(line => line.text).slice(0, 12)
  };
}

export async function lookupBookCover(image, barcode, fetchImpl = fetch, { apiKey = "", googleBooksApiKey = "", braveSearchApiKey = "", geminiApiKey = "", geminiModel = "" } = {}) {
  if (!apiKey && !geminiApiKey) throw new OperationalError("provider_unavailable", "Cover scanning is not configured", { status: 503 });
  const { content, mimeType } = imageContent(image);
  const attempts = [];
  let ocr = { text: "", lines: [] };
  if (apiKey) {
    const visionResponse = await safeFetch(fetchImpl, "https://vision.googleapis.com/v1/images:annotate", { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify({ requests: [{ image: { content }, features: [{ type: "TEXT_DETECTION", maxResults: 1 }] }] }) });
    const visionData = await responseJson(visionResponse);
    const annotation = visionData?.responses?.[0];
    if (visionData && !annotation?.error) {
      ocr = extractOcr(annotation);
      attempts.push(providerAttempt("Google Cloud Vision", ocr.lines.length ? "matched" : "no_text"));
    } else attempts.push(providerAttempt("Google Cloud Vision", "unavailable"));
  }
  const gemini = await extractGeminiBookMetadata(content, fetchImpl, { apiKey: geminiApiKey, model: geminiModel, mimeType });
  if (gemini.attempt) attempts.push(gemini.attempt);
  const queries = mergeQueries(geminiQueries(gemini.metadata), buildCoverQueries(ocr));
  if (!queries.length) throw new OperationalError("cover_no_text", "No readable cover text was found", { status: 404, attempts });
  const isbn = isValidIsbn(barcode) ? normalizeIsbn(barcode) : "";
  const calls = queries.flatMap(query => {
    const google = new URL("https://www.googleapis.com/books/v1/volumes");
    google.searchParams.set("q", `intitle:${query.title}${query.author ? ` inauthor:${query.author}` : ""}`);
    google.searchParams.set("maxResults", String(RESULTS_PER_QUERY));
    if (googleBooksApiKey) google.searchParams.set("key", googleBooksApiKey);
    const open = new URL("https://openlibrary.org/search.json");
    open.searchParams.set("title", query.title); if (query.author) open.searchParams.set("author", query.author);
    open.searchParams.set("fields", "key,title,subtitle,author_name,publisher,first_publish_year,cover_i,isbn"); open.searchParams.set("limit", String(RESULTS_PER_QUERY));
    return [safeFetch(fetchImpl, google).then(responseJson).then(data => ({ query, provider: "Google Books", candidates: (data?.items ?? []).map(googleMatch), available: Boolean(data) })), safeFetch(fetchImpl, open, { headers: { "User-Agent": "HomeBox-Importer/0.1 (personal inventory application)" } }).then(responseJson).then(data => ({ query, provider: "Open Library", candidates: (data?.docs ?? []).map(openLibraryMatch), available: Boolean(data) }))];
  });
  const results = await Promise.all(calls);
  for (const result of results) attempts.push(providerAttempt(result.provider, result.available ? (result.candidates.length ? "matched" : "no_match") : "unavailable"));
  const braveMatches = braveSearchApiKey ? await searchBraveBooks({ isbn, text: queries[0].title }, fetchImpl, { apiKey: braveSearchApiKey }) : [];
  if (braveSearchApiKey) attempts.push(providerAttempt("Brave Search", braveMatches.length ? "matched" : "no_match"));
  const ranked = [
    ...braveMatches.map(candidate => ({ candidate, query: queries[0], score: scoreCoverCandidate(candidate, queries[0], isbn) })),
    ...results.flatMap(result => result.candidates.map(candidate => ({ candidate, query: result.query, score: scoreCoverCandidate(candidate, result.query, isbn) })))
  ].sort((a, b) => b.score - a.score);
  const unique = [...new Map(ranked.map(entry => [`${entry.candidate.isbn}|${entry.candidate.title}|${entry.candidate.authors.join(",")}`.toLowerCase(), entry])).values()];
  const geminiQuery = gemini.metadata ? geminiQueries(gemini.metadata)[0] : null;
  const rescored = unique.map(entry => {
    const query = geminiQuery ?? entry.query;
    return { ...entry, query, score: scoreCoverCandidate(entry.candidate, query, isbn) };
  }).sort((a, b) => b.score - a.score);
  const matches = rescored.filter(entry => {
    const exactIsbn = Boolean(isbn && normalizeIsbn(entry.candidate.isbn) === isbn);
    return (exactIsbn || (titleSimilarity(entry.query.title, `${entry.candidate.title} ${entry.candidate.subtitle}`) >= .7
      && agreesWithGemini(entry.candidate, gemini.metadata))) && entry.score >= 65;
  }).map(entry => ({ ...entry.candidate, matchScore: Math.round(entry.score) })).slice(0, 8);
  const draft = manualDraft(ocr, queries, gemini.metadata);
  if (!matches.length) throw new OperationalError("cover_no_match", "No trustworthy catalog match was found", { status: 404, attempts, details: { text: ocr.text, lines: ocr.lines, draft } });
  return { text: ocr.text, lines: ocr.lines, draft, matches };
}
