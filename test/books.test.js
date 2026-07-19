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

test("falls back to ISBNdb when the free providers have no match", async () => {
  const requests = [];
  const fakeFetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("googleapis.com")) return Response.json({ totalItems: 0 });
    if (String(url).includes("openlibrary.org")) return Response.json({ numFound: 0, docs: [] });
    return Response.json({ book: { isbn13: "9798986753447", title: "The Legend of Heroes: Trails of Destiny", authors: ["Ashram Kain"], publisher: "Promethium Books", date_published: "2026-06-01", synopsys: "Explore Zemuria.", image: "https://example.test/cover.jpg" } });
  };
  const result = await lookupBook("9798986753447", fakeFetch, { isbnDbApiKey: "test-isbndb-key" });
  assert.equal(result[0].provider, "ISBNdb");
  assert.equal(result[0].title, "The Legend of Heroes: Trails of Destiny");
  assert.equal(result[0].authors[0], "Ashram Kain");
  const isbnDbRequest = requests.find(request => request.url.includes("api2.isbndb.com"));
  assert.equal(isbnDbRequest.options.headers.Authorization, "test-isbndb-key");
});

test("falls back to Hardcover and keeps its token in the server request", async () => {
  const requests = [];
  const fakeFetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("googleapis.com")) return Response.json({ totalItems: 0 });
    if (String(url).includes("openlibrary.org")) return Response.json({ numFound: 0, docs: [] });
    return Response.json({ data: { editions: [{
      id: 42,
      title: "The Legend of Heroes: Trails of Destiny",
      subtitle: "A Test Subtitle",
      release_date: "2026-06-01",
      isbn_13: "9798986753447",
      image: { url: "https://example.test/hardcover.jpg" },
      publisher: { name: "Promethium Books" },
      book: { description: "Explore Zemuria.", contributions: [{ author: { name: "Ashram Kain" } }] }
    }] } });
  };
  const result = await lookupBook("9798986753447", fakeFetch, { hardcoverApiToken: "test-hardcover-token" });
  assert.equal(result[0].provider, "Hardcover");
  assert.equal(result[0].authors[0], "Ashram Kain");
  const hardcoverRequest = requests.find(request => request.url.includes("api.hardcover.app"));
  assert.equal(hardcoverRequest.options.headers.authorization, "Bearer test-hardcover-token");
  assert.equal(JSON.parse(hardcoverRequest.options.body).variables.isbn, "9798986753447");
});

test("preserves a Hardcover token that already includes the Bearer prefix", async () => {
  const fakeFetch = async (url, options = {}) => {
    if (String(url).includes("googleapis.com")) return Response.json({ totalItems: 0 });
    if (String(url).includes("openlibrary.org")) return Response.json({ docs: [] });
    assert.equal(options.headers.authorization, "Bearer complete-token");
    return Response.json({ data: { editions: [] } });
  };
  await assert.rejects(
    () => lookupBook("9798986753447", fakeFetch, { hardcoverApiToken: "Bearer complete-token" }),
    /No book metadata found/
  );
});

test("does not call ISBNdb when no key is configured", async () => {
  const urls = [];
  const fakeFetch = async url => {
    urls.push(String(url));
    if (String(url).includes("googleapis.com")) return Response.json({ totalItems: 0 });
    return Response.json({ numFound: 0, docs: [] });
  };
  await assert.rejects(() => lookupBook("9798986753447", fakeFetch), /No book metadata found/);
  assert.equal(urls.some(url => url.includes("isbndb.com")), false);
});
