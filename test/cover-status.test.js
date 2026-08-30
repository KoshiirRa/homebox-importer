import assert from "node:assert/strict";
import test from "node:test";
import { canScanCoverInstead, coverOutcome, metadataSource } from "../src/cover-status.js";

test("cover outcome distinguishes unreadable photos", () => {
  const outcome = coverOutcome({ text: "", matches: [] });
  assert.equal(outcome.kind, "error");
  assert.match(outcome.message, /No readable cover text/);
  assert.equal(outcome.text, "");
});

test("cover outcome preserves recognized text when catalogs have no match", () => {
  const outcome = coverOutcome({ text: "  Trials of Saruman\nFree League  ", matches: [] });
  assert.equal(outcome.kind, "info");
  assert.match(outcome.message, /no catalog match/);
  assert.equal(outcome.text, "Trials of Saruman\nFree League");
});

test("cover outcome reports singular and plural matches", () => {
  assert.match(coverOutcome({ text: "Book", matches: [{}] }).message, /1 possible cover match found/);
  assert.match(coverOutcome({ text: "Book", matches: [{}, {}] }).message, /2 possible cover matches found/);
});

test("cover outcome accepts Gemini-assisted matches without raw OCR text", () => {
  const outcome = coverOutcome({ text: "", draft: { source: "gemini", title: "Example Book" }, matches: [{ title: "Example Book" }] });
  assert.equal(outcome.kind, "success");
  assert.match(outcome.message, /1 possible catalog match/);
});

test("cover outcome discloses Gemini suggestions alongside catalog matches", () => {
  const outcome = coverOutcome({ text: "", draft: { source: "gemini", title: "Character Options" }, matches: [{ title: "Character Options" }] });
  assert.match(outcome.message, /AI-assisted cover metadata/);
  assert.match(outcome.message, /1 possible catalog match/);
});

test("metadata source labels identify the provider", () => {
  assert.equal(metadataSource("Open Library"), "Metadata source: Open Library");
  assert.equal(metadataSource(""), "Metadata source unavailable");
});

test("cover alternative is offered only for provider-backed book matches", () => {
  assert.equal(canScanCoverInstead({ isbn: "9798987122006", provider: "Open Library" }, true), true);
  assert.equal(canScanCoverInstead({ isbn: "9798987122006", provider: "Manual entry" }, true), false);
  assert.equal(canScanCoverInstead({ barcode: "012345678905", provider: "UPCitemdb" }, true), false);
  assert.equal(canScanCoverInstead({ isbn: "9798987122006", provider: "Open Library" }, false), false);
});
