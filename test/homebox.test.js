import test from "node:test";
import assert from "node:assert/strict";
import { HomeboxClient } from "../src/homebox.js";

test("sends bearer authentication and creates then enriches a book", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/v1/entity-types")) return Response.json([{ id: "item-type", name: "Item", isLocation: false }]);
    if (url.endsWith("/api/v1/entities") && options.method === "POST") return Response.json({ id: "new-id", name: "A Book", assetId: "42", tags: [] }, { status: 201 });
    if (url.endsWith("/api/v1/entities/new-id") && options.method === "PUT") return Response.json({ id: "new-id", name: "A Book" });
    return new Response("Not found", { status: 404 });
  };
  const client = new HomeboxClient({ baseUrl: "http://homebox:7745/", apiKey: "secret", fetchImpl: fakeFetch });
  const result = await client.createBook({ title: "A Book", authors: ["A. Writer"], isbn: "9780306406157", parentId: "box-id" });
  assert.equal(result.id, "new-id");
  assert.equal(new Headers(calls[0].options.headers).get("Authorization"), "Bearer secret");
  const createBody = JSON.parse(calls[1].options.body);
  assert.equal(createBody.parentId, "box-id");
  const updateBody = JSON.parse(calls[2].options.body);
  assert.equal(updateBody.quantity, 1);
  assert.equal(updateBody.entityTypeId, "item-type");
  assert.equal(updateBody.fields.find(field => field.name === "ISBN").textValue, "9780306406157");
});

test("supports a clean HomeBox instance without a non-location entity type", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/v1/entity-types")) return Response.json([{ id: "location-type", name: "Location", isLocation: true }]);
    if (url.endsWith("/api/v1/entities") && options.method === "POST") return Response.json({ id: "new-id", name: "A Book", tags: [] }, { status: 201 });
    if (url.endsWith("/api/v1/entities/new-id") && options.method === "PUT") return Response.json({ id: "new-id", name: "A Book" });
    return new Response("Not found", { status: 404 });
  };
  const client = new HomeboxClient({ baseUrl: "http://homebox:7745", apiKey: "secret", fetchImpl: fakeFetch });
  await client.createBook({ title: "A Book", isbn: "9780306406157", parentId: "box-id" });
  assert.equal("entityTypeId" in JSON.parse(calls[1].options.body), false);
  assert.equal("entityTypeId" in JSON.parse(calls[2].options.body), false);
});

test("creates a quantity-aware general media item", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/v1/entity-types")) return Response.json([{ id: "item-type", name: "Item", isLocation: false }]);
    if (url.endsWith("/api/v1/entities") && options.method === "POST") return Response.json({ id: "game-id", name: "Test Game", tags: [] }, { status: 201 });
    if (url.endsWith("/api/v1/entities/game-id") && options.method === "PUT") return Response.json({ id: "game-id", name: "Test Game", quantity: 3 });
    return new Response("Not found", { status: 404 });
  };
  const client = new HomeboxClient({ baseUrl: "http://homebox:7745", apiKey: "secret", fetchImpl: fakeFetch });
  await client.createInventoryItem({ title: "Test Game", barcode: "012345678905", mediaType: "Video Game", manufacturer: "Test Studio", quantity: 3, parentId: "box-id" });
  const update = JSON.parse(calls[2].options.body);
  assert.equal(update.quantity, 3);
  assert.equal(update.manufacturer, "Test Studio");
  assert.equal(update.fields.find(field => field.name === "Media Type").textValue, "Video Game");
});

test("flattens the HomeBox location tree for destination selection", async () => {
  const fakeFetch = async url => {
    assert.match(url, /\/api\/v1\/entities\/tree\?withItems=false$/);
    return Response.json([{ id: "unit", name: "Storage Unit", children: [{ id: "box", name: "Box 14", children: [] }] }]);
  };
  const client = new HomeboxClient({ baseUrl: "http://homebox:7745", apiKey: "secret", fetchImpl: fakeFetch });
  const locations = await client.locations();
  assert.deepEqual(locations, [
    { id: "unit", name: "Storage Unit", path: "Storage Unit" },
    { id: "box", name: "Box 14", path: "Storage Unit → Box 14" }
  ]);
});
