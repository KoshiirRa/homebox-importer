import assert from "node:assert/strict";
import test from "node:test";
import { coverOutcome } from "../src/cover-status.js";

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
