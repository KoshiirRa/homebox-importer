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
        title: "Example Book", authors: ["Test Author"], publisher: "Test Press",
        industryIdentifiers: [{ type: "ISBN_13", identifier: "9789190079249" }]
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

test("rejects loose catalog matches and uses an exact-ISBN Brave result", async () => {
  const fakeFetch = async url => {
    const requestUrl = String(url);
    if (requestUrl.includes("vision.googleapis.com")) {
      return Response.json({ responses: [{ fullTextAnnotation: { text: "STAR TREK\nADVENTURES\nTHE ROLEPLAYING GAME\nSpecies Sourcebook\nTM" } }] });
    }
    if (requestUrl.includes("googleapis.com/books")) {
      return Response.json({ items: [{ id: "wrong-google", volumeInfo: {
        title: "Star Trek Adventures: The Sciences Division",
        industryIdentifiers: [{ type: "ISBN_13", identifier: "9781910132852" }]
      } }] });
    }
    if (requestUrl.includes("openlibrary.org")) return Response.json({ docs: [] });
    if (requestUrl.includes("api.search.brave.com")) {
      return Response.json({ web: { results: [{
        title: "Star Trek Adventures RPG: Species Sourcebook | 978-1-80281-218-3",
        url: "https://example.test/978-1-80281-218-3",
        description: "The Species Sourcebook for Star Trek Adventures."
      }] } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await lookupBookCover(
    "data:image/jpeg;base64,aGVsbG8=",
    "9781802812183",
    fakeFetch,
    { apiKey: "vision-key", braveSearchApiKey: "brave-key" }
  );

  assert.equal(result.matches[0].provider, "Brave Search");
  assert.equal(result.matches[0].isbn, "9781802812183");
  assert.match(result.matches[0].title, /Species Sourcebook/);
  assert.equal(result.matches.some(book => book.title.includes("Sciences Division")), false);
});

test("never stamps the scanned ISBN onto a provider candidate that reports another ISBN", async () => {
  const fakeFetch = async url => {
    if (String(url).includes("vision.googleapis.com")) {
      return Response.json({ responses: [{ fullTextAnnotation: { text: "Exact Example Title" } }] });
    }
    if (String(url).includes("googleapis.com/books")) {
      return Response.json({ items: [{ id: "google-other", volumeInfo: {
        title: "Exact Example Title",
        industryIdentifiers: [{ type: "ISBN_13", identifier: "9780306406157" }]
      } }] });
    }
    return Response.json({ docs: [] });
  };

  const result = await lookupBookCover(
    "data:image/jpeg;base64,aGVsbG8=",
    "9789190079249",
    fakeFetch,
    { apiKey: "vision-key" }
  );
  assert.equal(result.matches[0].isbn, "9780306406157");
  assert.notEqual(result.matches[0].isbn, "9789190079249");
});

test("requires server-side Vision configuration", async () => {
  await assert.rejects(
    () => lookupBookCover("data:image/jpeg;base64,aGVsbG8=", "9789190079249", async () => {}, {}),
    /Cover scanning is not configured/
  );
});
