import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GEMINI_MODEL, extractGeminiBookMetadata, validateGeminiMetadata } from "../src/gemini.js";

const validMetadata = {
  title: "Multiplicity & Synthesis",
  subtitle: "",
  authors: ["Rob Boyle", "Talia Dean"],
  publisher: "Posthuman Studios",
  publishedDate: "2022",
  edition: "Second Edition",
  format: "Sourcebook",
  series: "Eclipse Phase",
  confidence: { title: .99, subtitle: 0, authors: .95, publisher: .95, publishedDate: .7, edition: .98, format: .9, series: .98 }
};

test("validates and bounds Gemini metadata without accepting an ISBN", () => {
  const result = validateGeminiMetadata({ ...validMetadata, isbn: "9780306406157", title: `  ${"A".repeat(250)}  ` });
  assert.equal(result.title.length, 200);
  assert.equal("isbn" in result, false);
  assert.deepEqual(result.authors, ["Rob Boyle", "Talia Dean"]);
  assert.equal(result.confidence.title, .99);
});

test("rejects missing and low-confidence titles", () => {
  assert.equal(validateGeminiMetadata({ ...validMetadata, title: "" }), null);
  assert.equal(validateGeminiMetadata({ ...validMetadata, confidence: { ...validMetadata.confidence, title: .49 } }), null);
});

test("sends the image and schema to Gemini without putting the key in the URL", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(validMetadata) }] } }] });
  };
  const result = await extractGeminiBookMetadata("aGVsbG8=", fetchImpl, { apiKey: "secret-key", mimeType: "image/png" });
  assert.equal(result.metadata.title, "Multiplicity & Synthesis");
  assert.deepEqual(result.attempt, { provider: "Gemini cover extraction", outcome: "matched" });
  assert.match(request.url, new RegExp(DEFAULT_GEMINI_MODEL));
  assert.equal(request.url.includes("secret-key"), false);
  assert.equal(request.options.headers["x-goog-api-key"], "secret-key");
  const body = JSON.parse(request.options.body);
  assert.equal(body.contents[0].parts[1].inlineData.mimeType, "image/png");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.generationConfig.responseJsonSchema.properties.isbn, undefined);
});

test("fails safely for transport, HTTP, malformed JSON, and invalid metadata", async () => {
  const unavailable = await extractGeminiBookMetadata("aA==", async () => { throw new Error("offline"); }, { apiKey: "key" });
  assert.equal(unavailable.metadata, null);
  assert.equal(unavailable.attempt.outcome, "unavailable");
  const http = await extractGeminiBookMetadata("aA==", async () => new Response("rate limited", { status: 429 }), { apiKey: "key" });
  assert.equal(http.attempt.outcome, "unavailable");
  const malformed = await extractGeminiBookMetadata("aA==", async () => Response.json({ candidates: [{ content: { parts: [{ text: "not-json" }] } }] }), { apiKey: "key" });
  assert.equal(malformed.attempt.outcome, "invalid");
  const invalid = await extractGeminiBookMetadata("aA==", async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ...validMetadata, title: "" }) }] } }] }), { apiKey: "key" });
  assert.equal(invalid.attempt.outcome, "invalid");
});
