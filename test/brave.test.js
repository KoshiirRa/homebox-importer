import test from "node:test";
import assert from "node:assert/strict";
import { searchBraveBooks, titleSimilarity } from "../src/brave.js";

test("finds an ISBN-bearing web result without exposing the Brave key in the URL", async () => {
  let request;
  const fakeFetch = async (url, options) => {
    request = { url: new URL(url), options };
    return Response.json({ web: { results: [{
      title: "Star Trek Adventures RPG: Species Sourcebook | 978-1-80281-218-3",
      url: "https://example.test/books/978-1-80281-218-3",
      description: "The Species Sourcebook for Star Trek Adventures.",
      profile: { long_name: "Example Books" }
    }] } });
  };

  const matches = await searchBraveBooks(
    { isbn: "9781802812183" },
    fakeFetch,
    { apiKey: "test-brave-key" }
  );

  assert.equal(matches[0].provider, "Brave Search");
  assert.equal(matches[0].isbn, "9781802812183");
  assert.equal(matches[0].title, "Star Trek Adventures RPG: Species Sourcebook");
  assert.equal(request.options.headers["x-subscription-token"], "test-brave-key");
  assert.equal(request.url.searchParams.get("q"), '"9781802812183"');
  assert.equal(request.url.href.includes("test-brave-key"), false);
});

test("rejects web results that do not actually report the searched ISBN", async () => {
  const fakeFetch = async () => Response.json({ web: { results: [{
    title: "Star Trek Adventures: The Sciences Division",
    url: "https://example.test/unrelated",
    description: "A different Star Trek Adventures supplement."
  }] } });

  const matches = await searchBraveBooks(
    { isbn: "9781802812183" },
    fakeFetch,
    { apiKey: "test-brave-key" }
  );
  assert.deepEqual(matches, []);
});

test("uses distinctive OCR title tokens to reject loosely related books", () => {
  const query = "STAR TREK ADVENTURES THE ROLEPLAYING GAME Species Sourcebook";
  assert.equal(titleSimilarity(query, "Star Trek Adventures: The Species Sourcebook"), 1);
  assert.ok(titleSimilarity(query, "Star Trek Adventures: The Sciences Division") < 0.7);
});

test("does not call Brave when no key is configured", async () => {
  let called = false;
  const matches = await searchBraveBooks(
    { isbn: "9781802812183" },
    async () => { called = true; },
    {}
  );
  assert.deepEqual(matches, []);
  assert.equal(called, false);
});
