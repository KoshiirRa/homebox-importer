import { providerAttempt } from "./operational-errors.js";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

const FIELD_LIMITS = {
  title: 200,
  subtitle: 300,
  publisher: 160,
  publishedDate: 32,
  edition: 120,
  format: 80,
  series: 160
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "subtitle", "authors", "publisher", "publishedDate", "edition", "format", "series", "confidence"],
  properties: {
    title: { type: "string", description: "The work title only, excluding series, edition, and format labels." },
    subtitle: { type: "string" },
    authors: { type: "array", items: { type: "string" }, maxItems: 12 },
    publisher: { type: "string" },
    publishedDate: { type: "string", description: "A visible publication date or year only." },
    edition: { type: "string" },
    format: { type: "string" },
    series: { type: "string" },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["title", "subtitle", "authors", "publisher", "publishedDate", "edition", "format", "series"],
      properties: Object.fromEntries(["title", "subtitle", "authors", "publisher", "publishedDate", "edition", "format", "series"].map(field => [field, { type: "number", minimum: 0, maximum: 1 }]))
    }
  }
};

function clean(value, limit) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function confidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

export function validateGeminiMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = Object.fromEntries(Object.entries(FIELD_LIMITS).map(([field, limit]) => [field, clean(value[field], limit)]));
  metadata.authors = Array.isArray(value.authors)
    ? value.authors.slice(0, 12).map(author => clean(author, 120)).filter(Boolean)
    : [];
  metadata.confidence = Object.fromEntries(Object.keys(schema.properties.confidence.properties).map(field => [field, confidence(value.confidence?.[field])]));
  if (!metadata.title || metadata.confidence.title < .5) return null;
  return metadata;
}

async function responseJson(response) {
  if (!response?.ok) return null;
  try { return await response.json(); } catch { return null; }
}

export async function extractGeminiBookMetadata(content, fetchImpl = fetch, { apiKey = "", model = DEFAULT_GEMINI_MODEL, mimeType = "image/jpeg" } = {}) {
  if (!apiKey) return { metadata: null, attempt: null };
  const selectedModel = clean(model, 100) || DEFAULT_GEMINI_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: "Extract bibliographic metadata visible on this physical book cover. Separate the work title from series, edition, format, marketing text, and publisher marks. Use empty strings or arrays when a field is not visibly supported. Do not return or infer an ISBN, barcode, catalog number, description, or synopsis." },
          { inlineData: { mimeType, data: content } }
        ] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseJsonSchema: schema
        }
      })
    });
  } catch {
    return { metadata: null, attempt: providerAttempt("Gemini cover extraction", "unavailable") };
  }
  const data = await responseJson(response);
  const text = data?.candidates?.[0]?.content?.parts?.find(part => typeof part.text === "string")?.text;
  if (!text) return { metadata: null, attempt: providerAttempt("Gemini cover extraction", response?.ok ? "invalid" : "unavailable") };
  try {
    const metadata = validateGeminiMetadata(JSON.parse(text));
    return { metadata, attempt: providerAttempt("Gemini cover extraction", metadata ? "matched" : "invalid") };
  } catch {
    return { metadata: null, attempt: providerAttempt("Gemini cover extraction", "invalid") };
  }
}
