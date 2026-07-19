import test from "node:test";
import assert from "node:assert/strict";
import { isValidIsbn, lookupBook, normalizeIsbn } from "../src/books.js";

test("normalizes and validates ISBN values", () => {
  assert.equal(normalizeIsbn("978-0-306-40615-7"), "9780306406157");
  assert.equal(isValidIsbn("978-0-306-40615-7"), true);
  assert.equal(isValidIsbn("0-306-40615-2"), true);
  assert.equal(isValidIsbn("9780306406158"), false);
});

test("maps Google Books metadata", async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ items: [{ id: "abc", volumeInfo: { title: "Test Book", authors: ["A. Writer"], publisher: "Example Press", publishedDate: "2026", imageLinks: { thumbnail: "http://example.test/cover.jpg" } } }] }), { status: 200 });
  const result = await lookupBook("9780306406157", fakeFetch);
  assert.equal(result[0].title, "Test Book");
  assert.equal(result[0].coverUrl, "https://example.test/cover.jpg");
});

test("falls back to Open Library when Google Books is rate limited", async () => {
  const fakeFetch = async url => {
    if (String(url).includes("googleapis.com")) return new Response("rate limited", { status: 429 });
    return Response.json({ docs: [{ key: "/works/OL1W", title: "Fallback Book", author_name: ["Library Author"], publisher: ["Library Press"], first_publish_year: 1999, cover_i: 123 }] });
  };
  const result = await lookupBook("9780306406157", fakeFetch);
  assert.equal(result[0].provider, "Open Library");
  assert.equal(result[0].title, "Fallback Book");
  assert.equal(result[0].coverUrl, "https://covers.openlibrary.org/b/id/123-M.jpg");
});
