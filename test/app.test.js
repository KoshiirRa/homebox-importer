import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

test("serves the browser workflow through HTTP routes", async t => {
  const homebox = {
    status: async () => ({ health: true, build: { version: "v-test" } }),
    locations: async () => [{ id: "box-id", name: "Test Box", path: "Storage → Test Box" }],
    createBook: async book => ({ id: "book-id", name: book.title, parent: { id: book.parentId, name: "Test Box" }, quantity: 1 })
  };
  const bookLookup = async isbn => [{ isbn, title: "Test Book", authors: ["Test Author"] }];
  const server = createApp({ homebox, bookLookup }).listen(0, "127.0.0.1");
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

  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.homebox.version, "v-test");
  const locations = await (await fetch(`${base}/api/locations`)).json();
  assert.equal(locations[0].path, "Storage → Test Box");
  const matches = await (await fetch(`${base}/api/books/9780306406157`)).json();
  assert.equal(matches[0].title, "Test Book");

  const response = await fetch(`${base}/api/import/books`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentId: "box-id", book: matches[0] })
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.parent.id, "box-id");
});
