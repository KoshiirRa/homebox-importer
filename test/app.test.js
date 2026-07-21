import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

test("serves the browser workflow through HTTP routes", async t => {
  const homebox = {
    status: async () => ({ health: true, build: { version: "v-test" } }),
    locations: async () => [{ id: "box-id", name: "Test Box", path: "Storage → Test Box" }],
    boxContents: async id => ({ box: { id, name: "Test Box", assetId: "BOX-001" }, items: [{ id: "item-1", name: "Test Drill", quantity: 2 }] }),
    createBook: async book => ({ id: "book-id", name: book.title, parent: { id: book.parentId, name: "Test Box" }, quantity: 1 }),
    createInventoryItem: async item => ({ id: "item-id", name: item.title, parent: { id: item.parentId, name: "Test Box" }, quantity: item.quantity })
  };
  const bookLookup = async isbn => [{ isbn, title: "Test Book", authors: ["Test Author"] }];
  const mediaLookup = async barcode => [{ barcode, title: "Test Game", mediaType: "Video Game", quantity: 2 }];
  const server = createApp({ homebox, bookLookup, mediaLookup }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Scan it into the right box/);
  const labelsPage = await fetch(`${base}/labels.html`);
  assert.equal(labelsPage.status, 200);
  const labelsHtml = await labelsPage.text();
  assert.match(labelsHtml, /Label the boxes/);
  assert.match(labelsHtml, /QL-810WC/);
  assert.match(labelsHtml, /DK-2205/);
  assert.match(labelsHtml, /exact-size PDF/);

  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.homebox.version, "v-test");
  const locations = await (await fetch(`${base}/api/locations`)).json();
  assert.equal(locations[0].path, "Storage → Test Box");
  const box = await (await fetch(`${base}/api/boxes/box-id`)).json();
  assert.equal(box.box.name, "Test Box");
  assert.equal(box.items[0].quantity, 2);
  const matches = await (await fetch(`${base}/api/books/9780306406157`)).json();
  assert.equal(matches[0].title, "Test Book");
  const mediaMatches = await (await fetch(`${base}/api/lookup/012345678905`)).json();
  assert.equal(mediaMatches[0].mediaType, "Video Game");

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
});
