import test from "node:test";
import assert from "node:assert/strict";
import { isBookCandidate } from "../src/candidate.js";

test("routes explicit book candidates even when provider ISBN metadata is absent", () => {
  assert.equal(isBookCandidate({ mediaType: "Book", isbn: "", lookupIdentifier: "9780786965595" }), true);
  assert.equal(isBookCandidate({ mediaType: "Video Game", barcode: "012345678905" }), false);
});
