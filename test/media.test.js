import test from "node:test";
import assert from "node:assert/strict";
import { isValidGtin, lookupMedia, normalizeBarcode } from "../src/media.js";

test("normalizes and validates retail barcodes", () => {
  assert.equal(normalizeBarcode("0 12345-67890 5"), "012345678905");
  assert.equal(isValidGtin("012345678905"), true);
  assert.equal(isValidGtin("012345678906"), false);
});

test("uses Discogs first when a token is configured", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return Response.json({ results: [{ id: 17, title: "Test Artist - Test Album", label: ["Test Records"], catno: "TR-1", year: 2001, format: ["CD", "Album"], cover_image: "https://example.test/discogs.jpg" }] });
  };
  const matches = await lookupMedia("012345678905", fakeFetch, { discogsToken: "secret" });
  assert.equal(matches[0].provider, "Discogs");
  assert.equal(matches[0].title, "Test Album");
  assert.equal(matches[0].creators[0], "Test Artist");
  assert.equal(calls[0].options.headers.Authorization, "Discogs token=secret");
});

test("falls back through MusicBrainz to UPCitemdb and classifies a video game", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("musicbrainz.org")) return Response.json({ releases: [] });
    return Response.json({ items: [{ ean: "012345678905", title: "Example Nintendo Switch Video Game", brand: "Example Studio", category: "Video Games", images: ["https://example.test/game.jpg"] }] });
  };
  const matches = await lookupMedia("012345678905", fakeFetch);
  assert.equal(matches[0].provider, "UPCitemdb");
  assert.equal(matches[0].mediaType, "Video Game");
  assert.equal(calls.some(call => call.url.includes("prod/trial/lookup")), true);
});

test("maps MusicBrainz physical release metadata", async () => {
  const fakeFetch = async () => Response.json({ releases: [{
    id: "release-id", title: "Example Album", date: "1999-01-01",
    "artist-credit": [{ name: "Example Artist" }],
    "label-info": [{ "catalog-number": "CAT-1", label: { name: "Example Label" } }],
    media: [{ format: "CD" }]
  }] });
  const matches = await lookupMedia("012345678905", fakeFetch);
  assert.equal(matches[0].provider, "MusicBrainz");
  assert.equal(matches[0].creators[0], "Example Artist");
  assert.equal(matches[0].description, "CD");
});
