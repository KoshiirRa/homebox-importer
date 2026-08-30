import test from "node:test";
import assert from "node:assert/strict";
import { buildCoverQueries, extractOcr, lookupBookCover, scoreCoverCandidate, titleSimilarity } from "../src/vision.js";

test("extracts structured OCR words, confidence, and bounding boxes", () => {
  const box = { vertices: [{ x: 1, y: 2 }] };
  const ocr = extractOcr({ fullTextAnnotation: { text: "The Book\nBy Jane Doe", pages: [{ blocks: [{ paragraphs: [{ confidence: .91, boundingBox: box, words: [{ confidence: .9, symbols: [{ text: "The" }] }, { symbols: [{ text: "Book" }] }] }] }] }] } });
  assert.equal(ocr.lines[0].text, "The Book");
  assert.equal(ocr.lines[0].confidence, .91);
  assert.deepEqual(ocr.lines[0].boundingBox, box);
  assert.equal(ocr.lines[0].words[0].text, "The");
});

test("builds a bounded title and author query set", () => {
  const queries = buildCoverQueries(extractOcr({ fullTextAnnotation: { text: "Distinctive Book Title\nBy Jane Doe\nA Novel\nPublisher Mark" } }));
  assert.ok(queries.length <= 3);
  assert.equal(queries[0].title, "Distinctive Book Title");
  assert.equal(queries[0].author, "Jane Doe");
});

test("treats edition and publisher lines as context and joins split title fragments", () => {
  const queries = buildCoverQueries(extractOcr({ fullTextAnnotation: {
    text: "ECLIPSE PHASE SECOND EDITION\nMultiplicity\n& Synthesis\nAN ECLIPSE PHASE SOURCEBOOK\nPOSTHUMAN STUDIOS"
  } }));
  assert.equal(queries[0].title, "Multiplicity & Synthesis");
  assert.equal(queries.some(query => /edition|sourcebook|studios/i.test(query.title)), false);
});

test("scores exact ISBNs above OCR-only candidates and penalizes conflicts", () => {
  const query = { title: "Distinctive Book Title", author: "Jane Doe" };
  const base = { title: "Distinctive Book Title", subtitle: "", authors: ["Jane Doe"] };
  const exact = scoreCoverCandidate({ ...base, isbn: "9789190079249" }, query, "9789190079249");
  const ocrOnly = scoreCoverCandidate({ ...base, isbn: "" }, query, "9789190079249");
  const conflict = scoreCoverCandidate({ ...base, isbn: "9780306406157" }, query, "9789190079249");
  assert.ok(exact > ocrOnly);
  assert.ok(ocrOnly > conflict);
});

test("title similarity rejects long academic titles sharing only generic OCR words", () => {
  assert.ok(titleSimilarity("Multiplicity & Synthesis", "Eclipse Phase: Multiplicity & Synthesis") >= .7);
  assert.ok(titleSimilarity("Multiplicity & Synthesis", "Oxo Synthesis in an Isothermal Gas-liquid CSTR: Steady-state Multiplicity and Stability") < .7);
  assert.equal(titleSimilarity("Multiplicity", "Effect of Multiplicity of Infection on M-RNA Synthesis"), 0);
});

test("rejects the live Multiplicity and Synthesis academic false positives", async () => {
  const academicItems = [
    "Oxo Synthesis in an Isothermal Gas-liquid CSTR: Steady-state Multiplicity and Stability",
    "Effect of Multiplicity of Infection on M-RNA Synthesis in Escherichia Coli Cells Infected by Bacteriophage Lambda",
    "The Negative Effect of Multiplicity of Infection on the Synthesis of Endolysin in Bacteriophage [lambda]-Infected Escherichia Coli Cells",
    "Synthesis of the Feynman-Y Neutron Multiplicity Metric Using Deterministic Transport"
  ].map((title, index) => ({ id: `academic-${index}`, volumeInfo: { title, authors: ["Research Author"], publishedDate: "1980" } }));
  const fakeFetch = async url => {
    const requestUrl = String(url);
    if (requestUrl.includes("vision.googleapis.com")) {
      return Response.json({ responses: [{ fullTextAnnotation: { text: "ECLIPSE PHASE SECOND EDITION\nMultiplicity & Synthesis\nAN ECLIPSE PHASE SOURCEBOOK\nPOSTHUMAN STUDIOS" } }] });
    }
    if (requestUrl.includes("googleapis.com/books")) return Response.json({ items: academicItems });
    if (requestUrl.includes("openlibrary.org")) return Response.json({ docs: [] });
    throw new Error(`Unexpected request: ${url}`);
  };

  await assert.rejects(
    () => lookupBookCover("data:image/jpeg;base64,aGVsbG8=", "", fakeFetch, { apiKey: "vision-key" }),
    error => error.code === "cover_no_match" && error.details?.draft?.title === "Multiplicity & Synthesis"
  );
});

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
