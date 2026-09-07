import assert from "node:assert/strict";
import test from "node:test";
import { applyApprovedReport, enrichRpgBooks, inferRpgFields, mergeRpgFields } from "../src/rpg-enrichment.js";

function entity(overrides = {}) {
  return {
    id: "item-1",
    name: "Roleplaying Book",
    description: "",
    archived: false,
    assetId: "HB-1",
    quantity: 1,
    manufacturer: "",
    modelNumber: "",
    serialNumber: "",
    parent: { id: "shelf-1", name: "RPG Shelf" },
    entityType: { id: "type-1", name: "Item" },
    tags: [{ id: "tag-1", name: "Tabletop RPG" }],
    fields: [{ id: "media", name: "Media Type", type: "text", textValue: "Book" }],
    ...overrides
  };
}

test("normalizes game-system aliases to canonical names", () => {
  for (const title of ["Mutants & Masterminds: Hero's Handbook", "Mutants and Masterminds Heroes Handbook"]) {
    const result = inferRpgFields(entity({ name: title }));
    assert.equal(result.system.value, "Mutants & Masterminds");
    assert.equal(result.system.confidence, "high");
  }
  assert.equal(inferRpgFields(entity({ name: "Dungeons and Dragons Player Handbook" })).system.value, "Dungeons & Dragons");
});

test("normalizes edition aliases to consistent names", () => {
  const aliases = [
    ["Second Edition", "2nd Edition"],
    ["3.5e", "3.5 Edition"],
    ["5E", "5th Edition"],
    ["2024 Core Rules", "2024 Revision"],
    ["Remastered Core", "Remastered"]
  ];
  for (const [alias, canonical] of aliases) {
    assert.equal(inferRpgFields(entity({ name: `Pathfinder ${alias}` })).edition.value, canonical);
  }
});

test("infers system and edition independently", () => {
  const systemOnly = inferRpgFields(entity({ name: "D&D Adventure Anthology" }));
  assert.equal(systemOnly.system.value, "Dungeons & Dragons");
  assert.equal(systemOnly.edition.value, null);

  const editionOnly = inferRpgFields(entity({ name: "Core Rulebook 2nd Edition" }));
  assert.equal(editionOnly.system.value, null);
  assert.equal(editionOnly.edition.value, "2nd Edition");
});

test("never uses or changes Edition or Printing", () => {
  const original = entity({
    name: "Pathfinder Core Rulebook 2e",
    fields: [
      { id: "media", name: "Media Type", type: "text", textValue: "Book" },
      { id: "printing", name: "Edition or Printing", type: "text", textValue: "Third printing" }
    ]
  });
  const inference = inferRpgFields(original);
  assert.equal(inference.edition.value, "2nd Edition");
  const merged = mergeRpgFields(original, inference);
  assert.equal(merged.fields.find(field => field.name === "Edition or Printing").textValue, "Third printing");
});

test("preserves existing non-empty manual values", () => {
  const original = entity({
    name: "Dungeons & Dragons 5e Player Handbook",
    fields: [
      { name: "Media Type", type: "text", textValue: "Book" },
      { id: "system", name: "Game System", type: "text", textValue: "My Campaign System" },
      { id: "edition", name: "Game Edition", type: "text", textValue: "House Rules" }
    ]
  });
  const merged = mergeRpgFields(original, inferRpgFields(original));
  assert.equal(merged.changed, false);
  assert.equal(merged.fields.find(field => field.name === "Game System").textValue, "My Campaign System");
  assert.equal(merged.fields.find(field => field.name === "Game Edition").textValue, "House Rules");
});

test("reports conflicting exact systems as ambiguous", () => {
  const result = inferRpgFields(entity({ name: "Pathfinder and Starfinder Adventure Collection" }));
  assert.equal(result.system.ambiguous, true);
  assert.deepEqual(result.system.candidates, ["Pathfinder", "Starfinder"]);
});

test("does not turn a multi-line publisher into a game-system match", () => {
  const result = inferRpgFields(entity({ name: "Generic Science Fiction Sourcebook", manufacturer: "Paizo" }));
  assert.equal(result.system.value, null);
  assert.equal(result.system.ambiguous, false);
});

test("keeps genuinely different Tolkien game lines separate", () => {
  assert.equal(inferRpgFields(entity({ name: "The One Ring Roleplaying Game" })).system.value, "The One Ring");
  assert.equal(inferRpgFields(entity({ name: "The Lord of the Rings Roleplaying" })).system.value, "The Lord of the Rings Roleplaying");
});

function mockHomebox(item, updateEntity = async () => {}) {
  return {
    allEntities: async () => [{ id: item.id, name: item.name, archived: false }],
    entityPaths: async () => new Map([[item.id, `Games → ${item.name}`]]),
    customFieldNames: async () => ["Media Type", "Edition or Printing"],
    entity: async () => structuredClone(item),
    updateEntity
  };
}

test("dry run proposes updates without Homebox mutations", async () => {
  let writes = 0;
  const item = entity({ name: "Call of Cthulhu 7e Keeper Rulebook" });
  const report = await enrichRpgBooks({
    homebox: mockHomebox(item, async () => { writes += 1; }),
    write: false,
    retryOptions: { baseDelayMs: 0 }
  });
  assert.equal(writes, 0);
  assert.equal(report.proposedGameSystemUpdates.length, 1);
  assert.equal(report.proposedGameEditionUpdates.length, 1);
  assert.deepEqual(report.customFieldsMissing, ["Game System", "Game Edition"]);
});

test("write mode is idempotent when correct values already exist", async () => {
  let writes = 0;
  const item = entity({
    name: "The One Ring 2e Core Rules",
    fields: [
      { name: "Media Type", type: "text", textValue: "Book" },
      { name: "Game System", type: "text", textValue: "The One Ring" },
      { name: "Game Edition", type: "text", textValue: "2nd Edition" }
    ]
  });
  const report = await enrichRpgBooks({
    homebox: mockHomebox(item, async () => { writes += 1; }),
    write: true,
    retryOptions: { baseDelayMs: 0 }
  });
  assert.equal(writes, 0);
  assert.equal(report.updatedEntities.length, 0);
  assert.equal(report.existingValuesPreserved.length, 2);
});

test("complete update payload preserves fields, tags, location, and metadata", () => {
  const original = entity({
    name: "Star Trek Adventures 2e Core Rulebook",
    notes: "manual notes",
    purchasePrice: 42,
    attachments: [{ id: "attachment-1" }],
    fields: [
      { id: "media", name: "Media Type", type: "text", textValue: "Book" },
      { id: "printing", name: "Edition or Printing", type: "text", textValue: "First printing" }
    ]
  });
  const merged = mergeRpgFields(original, inferRpgFields(original));
  assert.equal(merged.update.notes, "manual notes");
  assert.equal(merged.update.purchasePrice, 42);
  assert.deepEqual(merged.update.tagIds, ["tag-1"]);
  assert.equal(merged.update.parentId, "shelf-1");
  assert.equal(merged.update.fields.find(field => field.name === "Edition or Printing").textValue, "First printing");
  assert.equal(Object.hasOwn(merged.update, "attachments"), false, "attachments use a separate API relationship and must not be replaced by PUT");
});

test("applies only the exact high-confidence fields in an approved dry-run report", async () => {
  const writes = [];
  const item = entity({ name: "Call of Cthulhu Keeper Rulebook" });
  const report = await applyApprovedReport({
    homebox: mockHomebox(item, async (id, update) => writes.push({ id, update })),
    report: {
      mode: "dry-run",
      proposedGameSystemUpdates: [{ id: item.id, name: item.name, value: "Call of Cthulhu", confidence: "high" }],
      proposedGameEditionUpdates: [{ id: item.id, name: item.name, value: "7th Edition", confidence: "medium" }]
    },
    retryOptions: { baseDelayMs: 0 }
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].update.fields.find(field => field.name === "Game System").textValue, "Call of Cthulhu");
  assert.equal(writes[0].update.fields.some(field => field.name === "Game Edition"), false);
  assert.equal(report.appliedFieldUpdates, 1);
});
