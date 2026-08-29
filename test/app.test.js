import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { OperationalError } from "../src/operational-errors.js";

test("classifies lookup failures and emits exactly one terminal event", async t => {
  const lines = [];
  const logger = { info: line => lines.push(JSON.parse(line)), error: () => {} };
  const homebox = { status: async () => ({}), locations: async () => [] };
  const bookLookup = async () => { throw new OperationalError("provider_no_match", "No match", { status: 404, attempts: [{ provider: "Catalog", outcome: "no_match" }] }); };
  const server = createApp({ homebox, bookLookup, mediaLookup: bookLookup, logger }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/books/9780306406157`);
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.code, "provider_no_match");
  assert.match(body.correlationId, /^[0-9a-f-]{36}$/);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].event, "lookup.failed");
  assert.equal(lines[0].correlationId, body.correlationId);
  assert.deepEqual(lines[0].providerAttempts, [{ provider: "Catalog", outcome: "no_match" }]);
});

test("classifies invalid, cover no-text, cover no-match, and unexpected failures over HTTP", async t => {
  const events = [];
  const logger = { info: line => events.push(JSON.parse(line)), error: () => {} };
  const homebox = { status: async () => ({}), locations: async () => [] };
  const bookLookup = async value => {
    if (value === "bad") throw new OperationalError("invalid_identifier", "Invalid ISBN", { status: 400 });
    throw new Error("internal provider defect");
  };
  const coverLookup = async (_image, barcode) => {
    if (barcode === "no-text") throw new OperationalError("cover_no_text", "No readable text", { status: 404 });
    throw new OperationalError("cover_no_match", "No trustworthy match", { status: 404, details: { text: "Readable Title", draft: { source: "ocr", title: "Readable Title", authors: [], lines: ["Readable Title"] } } });
  };
  const server = createApp({ homebox, bookLookup, mediaLookup: bookLookup, coverLookup, logger }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const invalid = await fetch(`${base}/api/books/bad`);
  assert.equal((await invalid.json()).code, "invalid_identifier");
  const cover = barcode => fetch(`${base}/api/books/cover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: "data:image/jpeg;base64,aA==", barcode }) });
  assert.equal((await (await cover("no-text")).json()).code, "cover_no_text");
  const noMatch = await (await cover("no-match")).json();
  assert.equal(noMatch.code, "cover_no_match");
  assert.equal(noMatch.draft.title, "Readable Title");
  const unexpected = await fetch(`${base}/api/books/9780306406157`);
  assert.equal((await unexpected.json()).code, "provider_unavailable");
  assert.deepEqual(events.map(event => event.failureCode), ["invalid_identifier", "cover_no_text", "cover_no_match", "provider_unavailable"]);
  assert.ok(events.every(event => event.event === "lookup.failed"));
  assert.equal("identifier" in events[0], false);
});

test("serves the browser workflow through HTTP routes", async t => {
  const logLines = [];
  const logger = { info: line => logLines.push(line) };
  const homebox = {
    status: async () => ({ health: true, build: { version: "v-test" } }),
    locations: async () => [{ id: "box-id", name: "Test Box", path: "Storage → Test Box" }],
    labelDestinations: async () => [
      { id: "box-id", name: "Test Box", path: "Storage → Test Box", isLocation: true },
      { id: "records-id", name: "Uninventoried Records", path: "Storage → Uninventoried Records", isLocation: false }
    ],
    boxContents: async id => ({ box: { id, name: "Test Box", assetId: "BOX-001" }, items: [{ id: "item-1", name: "Test Drill", quantity: 2 }] }),
    createBook: async book => ({ id: "book-id", assetId: "BOOK-001", name: book.title, parent: { id: book.parentId, name: "Test Box" }, quantity: 1 }),
    createInventoryItem: async item => ({ id: "item-id", assetId: "ITEM-001", name: item.title, parent: { id: item.parentId, name: "Test Box" }, quantity: item.quantity })
  };
  const bookLookup = async isbn => [{ provider: "Test Books", isbn, title: "Test Book", authors: ["Test Author"] }];
  const mediaLookup = async barcode => [{ provider: "Test Media", barcode, title: "Test Game", mediaType: "Video Game", quantity: 2 }];
  const coverLookup = async (_image, barcode) => ({
    text: "Test Book\nTest Author",
    matches: [{ provider: "Test Cover Search", isbn: barcode, title: "Test Book", authors: ["Test Author"] }]
  });
  const server = createApp({ homebox, bookLookup, mediaLookup, coverLookup, logger }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const page = await fetch(base);
  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  assert.match(pageHtml, /Scan it into the right box/);
  assert.match(pageHtml, /Scan container QR/);
  assert.match(pageHtml, /Scan the cover/);
  const labelsPage = await fetch(`${base}/labels.html`);
  assert.equal(labelsPage.status, 200);
  const labelsHtml = await labelsPage.text();
  assert.match(labelsHtml, /Label the boxes/);
  assert.match(labelsHtml, /QL-810WC/);
  assert.match(labelsHtml, /DK-2205/);
  assert.match(labelsHtml, /exact-size PDF/);

  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.homebox.version, "v-test");
  assert.equal(health.features.coverLookup, true);
  const locations = await (await fetch(`${base}/api/locations`)).json();
  assert.equal(locations[0].path, "Storage → Test Box");
  const labelDestinations = await (await fetch(`${base}/api/label-destinations`)).json();
  assert.equal(labelDestinations[1].name, "Uninventoried Records");
  const box = await (await fetch(`${base}/api/boxes/box-id`)).json();
  assert.equal(box.box.name, "Test Box");
  assert.equal(box.items[0].quantity, 2);
  const matches = await (await fetch(`${base}/api/books/9780306406157`)).json();
  assert.equal(matches[0].title, "Test Book");
  const mediaMatches = await (await fetch(`${base}/api/lookup/012345678905`)).json();
  assert.equal(mediaMatches[0].mediaType, "Video Game");
  const coverMatches = await (await fetch(`${base}/api/books/cover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: "data:image/jpeg;base64,aGVsbG8=", barcode: "9789190079249" })
  })).json();
  assert.equal(coverMatches.matches[0].isbn, "9789190079249");

  const response = await fetch(`${base}/api/import/books`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentId: "box-id", book: matches[0] })
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.parent.id, "box-id");

  const itemResponse = await fetch(`${base}/api/import/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentId: "box-id", item: mediaMatches[0] })
  });
  assert.equal(itemResponse.status, 201);
  assert.equal((await itemResponse.json()).quantity, 2);

  const events = logLines.map(line => JSON.parse(line));
  assert.deepEqual(events.map(event => `${event.event}:${event.workflow}`), [
    "lookup.succeeded:book", "lookup.succeeded:media", "lookup.succeeded:cover",
    "import.succeeded:book", "import.succeeded:media"
  ]);
  assert.deepEqual(events.map(event => event.provider), [
    "Test Books", "Test Media", "Test Cover Search", "Test Books", "Test Media"
  ]);
  assert.equal(events[0].identifier, "9780306406157");
  assert.equal(events[0].resultCount, 1);
  assert.equal(events[3].destinationId, "box-id");
  assert.equal(events[3].entityId, "book-id");
  assert.equal(events[3].assetId, "BOOK-001");
  assert.equal(events[3].provenance, "provider_candidate");
  assert.equal(events[4].quantity, 2);
  assert.ok(events.every(event => Number.isInteger(event.durationMs) && event.durationMs >= 0));
  const serializedLogs = logLines.join("\n");
  assert.doesNotMatch(serializedLogs, /data:image|aGVsbG8=|description|authorization|api.?key/i);
});
