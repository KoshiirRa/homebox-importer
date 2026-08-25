import test from "node:test";
import assert from "node:assert/strict";
import { lookupBookCover } from "../src/vision.js";

test("recognizes cover text and returns reviewable catalog candidates", async () => {
  const requests = [];
  const fakeFetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("vision.googleapis.com")) {
      return Response.json({ responses: [{ fullTextAnnotation: { text: "Example Book\nTest Author" } }] });
    }
    if (String(url).includes("googleapis.com/books")) {
      return Response.json({ items: [{ id: "google-1", volumeInfo: {
        title: "Example Book", authors: ["Test Author"], publisher: "Test Press"
      } }] });
    }
    return Response.json({ docs: [] });
  };

  const result = await lookupBookCover(
    "data:image/jpeg;base64,aGVsbG8=",
    "9789190079249",
    fakeFetch,
    { apiKey: "test-vision-key", googleBooksApiKey: "test-google-books-key" }
  );

  assert.equal(result.text, "Example Book\nTest Author");
  assert.equal(result.matches[0].title, "Example Book");
  assert.equal(result.matches[0].isbn, "9789190079249");
  const visionRequest = requests.find(request => request.url.includes("vision.googleapis.com"));
  assert.equal(visionRequest.options.headers["x-goog-api-key"], "test-vision-key");
  assert.equal(visionRequest.url.includes("test-vision-key"), false);
  const googleBooksRequest = requests.find(request => request.url.includes("googleapis.com/books"));
  assert.equal(new URL(googleBooksRequest.url).searchParams.get("key"), "test-google-books-key");
});

test("requires server-side Vision configuration", async () => {
  await assert.rejects(
    () => lookupBookCover("data:image/jpeg;base64,aGVsbG8=", "9789190079249", async () => {}, {}),
    /Cover scanning is not configured/
  );
});
