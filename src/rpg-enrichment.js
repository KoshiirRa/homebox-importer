const CONFIDENCE = Object.freeze({ low: 1, medium: 2, high: 3 });
export const RPG_FIELD_NAMES = Object.freeze({ system: "Game System", edition: "Game Edition" });

const normalize = value => String(value ?? "")
  .normalize("NFKD")
  .replace(/&/g, " and ")
  .replace(/[’']/g, "")
  .replace(/[^a-zA-Z0-9.]+/g, " ")
  .trim()
  .toLowerCase();

const systemDefinitions = [
  ["Dungeons & Dragons", ["dungeons and dragons", "dungeons dragons", "d and d", "dnd"]],
  ["Pathfinder", ["pathfinder roleplaying game", "pathfinder rpg", "pathfinder"]],
  ["Starfinder", ["starfinder roleplaying game", "starfinder rpg", "starfinder"]],
  ["Mutants & Masterminds", ["mutants and masterminds", "mutants masterminds", "m and m"]],
  ["Star Trek Adventures", ["star trek adventures"]],
  ["Call of Cthulhu", ["call of cthulhu"]],
  ["The One Ring", ["the one ring roleplaying game", "the one ring rpg", "the one ring"]],
  ["Warhammer Fantasy Roleplay", ["warhammer fantasy roleplay", "warhammer fantasy roleplaying", "wfrp"]],
  ["Lancer", ["lancer ttrpg", "lancer rpg", "lancer roleplaying game"]],
  ["Marvel Multiverse Role-Playing Game", ["marvel multiverse role playing game", "marvel multiverse roleplaying game", "marvel multiverse rpg"]],
  ["The Expanse RPG", ["the expanse rpg", "the expanse roleplaying game"]],
  ["The Lord of the Rings Roleplaying", ["the lord of the rings roleplaying", "lord of the rings roleplaying"]]
];

const publisherSystems = [
  ["wizards of the coast", ["Dungeons & Dragons"]],
  ["tsr", ["Dungeons & Dragons"]],
  ["paizo", ["Pathfinder", "Starfinder"]],
  ["green ronin", ["Mutants & Masterminds"]],
  ["modiphius", ["Star Trek Adventures"]],
  ["chaosium", ["Call of Cthulhu"]],
  ["cubicle 7", ["The One Ring"]],
  ["free league", ["The One Ring"]]
];

const editionDefinitions = [
  ["2024 Revision", ["2024 revision", "2024 revised rules", "2024 core rules"]],
  ["Remastered", ["remastered", "remaster"]],
  ["3.5 Edition", ["3.5 edition", "edition 3.5", "version 3.5", "v3.5", "v.3.5", "v. 3.5", "d20 3.5", "3.5e"]],
  ["1st Edition", ["1st edition", "first edition", "edition 1", "1e"]],
  ["2nd Edition", ["2nd edition", "second edition", "edition 2", "2e"]],
  ["3rd Edition", ["3rd edition", "third edition", "edition 3", "3e"]],
  ["4th Edition", ["4th edition", "fourth edition", "edition 4", "4e"]],
  ["5th Edition", ["5th edition", "fifth edition", "edition 5", "5e"]],
  ["6th Edition", ["6th edition", "sixth edition", "edition 6", "6e"]],
  ["7th Edition", ["7th edition", "seventh edition", "edition 7", "7e"]]
];

const hasPhrase = (text, phrase) => {
  const haystack = ` ${normalize(text)} `;
  const needle = ` ${normalize(phrase)} `;
  return haystack.includes(needle);
};

function matchesDefinitions(text, definitions) {
  return definitions.filter(([, aliases]) => aliases.some(alias => hasPhrase(text, alias))).map(([canonical]) => canonical);
}

function addEvidence(evidence, canonical, confidence, source, detail) {
  if (!evidence.has(canonical)) evidence.set(canonical, []);
  evidence.get(canonical).push({ confidence, source, detail });
}

function inferFromEvidence(evidence) {
  if (!evidence.size) return { value: null, confidence: null, reasons: [], ambiguous: false };
  const ranked = [...evidence].map(([value, reasons]) => {
    const best = Math.max(...reasons.map(reason => CONFIDENCE[reason.confidence]));
    const sourceCount = new Set(reasons.map(reason => reason.source)).size;
    const confidence = best >= CONFIDENCE.high ? "high" : sourceCount >= 2 ? "medium" : "low";
    return { value, confidence, reasons, rank: CONFIDENCE[confidence], sourceCount };
  }).sort((a, b) => b.rank - a.rank || b.sourceCount - a.sourceCount || a.value.localeCompare(b.value));
  const top = ranked[0];
  const tied = ranked.filter(item => item.rank === top.rank && item.sourceCount === top.sourceCount);
  if (tied.length > 1) {
    return { value: null, confidence: top.confidence, reasons: tied.flatMap(item => item.reasons), ambiguous: true, candidates: tied.map(item => item.value) };
  }
  return { value: top.value, confidence: top.confidence, reasons: top.reasons, ambiguous: false };
}

function fieldValue(entity, name) {
  return entity.fields?.find(field => normalize(field.name) === normalize(name))?.textValue?.trim() ?? "";
}

function safeFields(entity) {
  return (entity.fields ?? []).filter(field => normalize(field.name) !== "edition or printing");
}

function addTextEvidence(evidence, text, source, confidence, definitions) {
  for (const canonical of matchesDefinitions(text, definitions)) {
    addEvidence(evidence, canonical, confidence, source, String(text ?? "").slice(0, 120));
  }
}

export function inferRpgFields(entity, { path = "", isbnMetadata = null } = {}) {
  const systemEvidence = new Map();
  const editionEvidence = new Map();
  const fields = safeFields(entity);
  const tags = (entity.tags ?? []).map(tag => tag.name).filter(Boolean);
  const metadata = Array.isArray(isbnMetadata) ? isbnMetadata[0] : isbnMetadata;

  addTextEvidence(systemEvidence, entity.name, "title", "high", systemDefinitions);
  addTextEvidence(editionEvidence, entity.name, "title", "high", editionDefinitions);
  addTextEvidence(systemEvidence, entity.description, "description", "low", systemDefinitions);
  addTextEvidence(editionEvidence, entity.description, "description", "low", editionDefinitions);
  addTextEvidence(systemEvidence, tags.join(" "), "tags", "low", systemDefinitions);
  addTextEvidence(editionEvidence, tags.join(" "), "tags", "low", editionDefinitions);
  addTextEvidence(systemEvidence, path, "location", "low", systemDefinitions);
  addTextEvidence(editionEvidence, path, "location", "low", editionDefinitions);
  for (const field of fields) {
    const source = `custom field ${field.name}`;
    addTextEvidence(systemEvidence, field.textValue, source, "low", systemDefinitions);
    addTextEvidence(editionEvidence, field.textValue, source, "low", editionDefinitions);
  }

  const publisherText = [entity.manufacturer, metadata?.publisher].filter(Boolean).join(" ");
  for (const [publisher, systems] of publisherSystems) {
    if (!hasPhrase(publisherText, publisher)) continue;
    // Publishers own multiple game lines. They may corroborate a detected line,
    // but must never create or merge a system inference by themselves.
    for (const system of systems.filter(candidate => systemEvidence.has(candidate))) {
      addEvidence(systemEvidence, system, "low", "publisher", publisher);
    }
  }

  if (metadata) {
    for (const [source, value] of [
      ["ISBN title", metadata.title], ["ISBN subtitle", metadata.subtitle],
      ["ISBN description", metadata.description], ["ISBN categories", (metadata.categories ?? []).join(" ")]
    ]) {
      addTextEvidence(systemEvidence, value, source, source === "ISBN description" ? "low" : "high", systemDefinitions);
      addTextEvidence(editionEvidence, value, source, source === "ISBN description" ? "low" : "high", editionDefinitions);
    }
  }

  const system = inferFromEvidence(systemEvidence);
  const edition = inferFromEvidence(editionEvidence);
  const mediaType = fieldValue(entity, "Media Type");
  const tabletopContext = [path, tags.join(" "), entity.name, entity.description, ...fields.map(field => field.textValue)]
    .some(value => /\b(tabletop|role.?playing|ttrpg|rpg|core rulebook|players? handbook|game master|gamemaster)\b/i.test(value ?? ""));
  const isBook = normalize(mediaType) === "book" || /book/i.test(entity.entityType?.name ?? "") || Boolean(fieldValue(entity, "ISBN"));
  const tabletop = isBook && (tabletopContext || Boolean(system.value) || system.ambiguous);
  return { tabletop, system, edition };
}

export function entityToUpdate(entity, fields) {
  const update = {};
  for (const key of [
    "id", "name", "archived", "assetId", "description", "insured", "lifetimeWarranty", "manufacturer",
    "modelNumber", "notes", "purchaseDate", "purchaseFrom", "purchasePrice", "quantity", "serialNumber",
    "soldDate", "soldNotes", "soldPrice", "soldTo", "syncChildEntityLocations", "warrantyDetails", "warrantyExpires"
  ]) {
    if (Object.hasOwn(entity, key)) update[key] = entity[key];
  }
  update.parentId = entity.parent?.id ?? null;
  if (entity.entityType?.id) update.entityTypeId = entity.entityType.id;
  update.tagIds = (entity.tags ?? []).map(tag => tag.id);
  update.fields = fields.map(field => ({ ...field }));
  return update;
}

export function mergeRpgFields(entity, proposals) {
  const fields = (entity.fields ?? []).map(field => ({ ...field }));
  let changed = false;
  for (const [kind, name] of Object.entries(RPG_FIELD_NAMES)) {
    const proposal = proposals[kind];
    if (!proposal || proposal.confidence !== "high" || !proposal.value) continue;
    const index = fields.findIndex(field => normalize(field.name) === normalize(name));
    if (index >= 0 && String(fields[index].textValue ?? "").trim()) continue;
    if (index >= 0) fields[index] = { ...fields[index], name, type: "text", textValue: proposal.value };
    else fields.push({ name, type: "text", textValue: proposal.value });
    changed = true;
  }
  return { changed, fields, update: changed ? entityToUpdate(entity, fields) : null };
}

export async function mapConcurrent(items, limit, operation) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

export async function retry(operation, { attempts = 3, baseDelayMs = 250, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(baseDelayMs * (2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

function isbnFor(entity) {
  const raw = fieldValue(entity, "ISBN") || entity.serialNumber || entity.modelNumber || "";
  const digits = String(raw).replace(/[^0-9X]/gi, "");
  return /^(?:\d{10}|\d{13})$/.test(digits) ? digits : "";
}

export async function applyApprovedReport({ homebox, report, concurrency = 4, retryOptions = {}, logger = console }) {
  if (report?.mode !== "dry-run") throw new Error("Approved input must be a dry-run report");
  const plans = new Map();
  const add = (kind, item) => {
    if (item?.confidence !== "high" || !item.id || !item.value) return;
    const plan = plans.get(item.id) ?? { id: item.id, name: item.name, proposals: {} };
    plan.proposals[kind] = { value: item.value, confidence: "high" };
    plans.set(item.id, plan);
  };
  for (const item of report.proposedGameSystemUpdates ?? []) add("system", item);
  for (const item of report.proposedGameEditionUpdates ?? []) add("edition", item);

  const result = {
    mode: "approved-report-write",
    requestedFieldUpdates: [...plans.values()].reduce((count, plan) => count + Object.keys(plan.proposals).length, 0),
    targetedEntities: plans.size,
    appliedFieldUpdates: 0,
    updatedEntities: [],
    skippedExistingValues: [],
    errors: []
  };
  await mapConcurrent([...plans.values()], concurrency, async plan => {
    try {
      const current = await retry(() => homebox.entity(plan.id), retryOptions);
      const eligibleKinds = Object.keys(plan.proposals).filter(kind => {
        const existing = fieldValue(current, RPG_FIELD_NAMES[kind]);
        if (!existing) return true;
        result.skippedExistingValues.push({ id: plan.id, name: current.name, field: RPG_FIELD_NAMES[kind], value: existing });
        return false;
      });
      const proposals = Object.fromEntries(eligibleKinds.map(kind => [kind, plan.proposals[kind]]));
      const merged = mergeRpgFields(current, proposals);
      if (!merged.changed) return;
      await retry(() => homebox.updateEntity(plan.id, merged.update), retryOptions);
      result.appliedFieldUpdates += eligibleKinds.length;
      result.updatedEntities.push({ id: plan.id, name: current.name, fields: eligibleKinds.map(kind => RPG_FIELD_NAMES[kind]) });
    } catch (error) {
      result.errors.push({ id: plan.id, name: plan.name, stage: "update", error: error.message });
      logger.error?.(`Failed to enrich approved record ${plan.id}: ${error.message}`);
    }
  });
  result.summary = {
    requestedFieldUpdates: result.requestedFieldUpdates,
    targetedEntities: result.targetedEntities,
    appliedFieldUpdates: result.appliedFieldUpdates,
    updatedEntities: result.updatedEntities.length,
    skippedExistingValues: result.skippedExistingValues.length,
    errors: result.errors.length
  };
  return result;
}

export async function enrichRpgBooks({ homebox, lookupIsbn = null, write = false, concurrency = 4, retryOptions = {}, logger = console }) {
  const summaries = await retry(() => homebox.allEntities(), retryOptions);
  const paths = await retry(() => homebox.entityPaths(), retryOptions);
  const existingFieldNames = await retry(() => homebox.customFieldNames(), retryOptions);
  const errors = [];
  const metadataWarnings = [];
  const records = await mapConcurrent(summaries.filter(item => !item.archived), concurrency, async summary => {
    try {
      const entity = await retry(() => homebox.entity(summary.id), retryOptions);
      let isbnMetadata = null;
      const isbn = isbnFor(entity);
      const mediaType = fieldValue(entity, "Media Type");
      const bookLike = normalize(mediaType) === "book" || Boolean(isbn);
      if (lookupIsbn && bookLike && isbn) {
        try { isbnMetadata = await retry(() => lookupIsbn(isbn), retryOptions); }
        catch (error) {
          metadataWarnings.push({
            id: entity.id, name: entity.name, stage: "isbn metadata",
            ...(error.code ? { code: error.code } : {}), error: error.message
          });
        }
      }
      return { entity, inference: inferRpgFields(entity, { path: paths.get(entity.id) ?? "", isbnMetadata }) };
    } catch (error) {
      errors.push({ id: summary.id, name: summary.name, stage: "fetch", error: error.message });
      return null;
    }
  });

  const report = {
    mode: write ? "write" : "dry-run",
    scanned: summaries.length,
    tabletopRecords: 0,
    proposedGameSystemUpdates: [],
    proposedGameEditionUpdates: [],
    existingValuesPreserved: [],
    reviewSuggestions: [],
    ambiguousRecords: [],
    recordsWithNoMatch: [],
    updatedEntities: [],
    customFieldsMissing: Object.values(RPG_FIELD_NAMES).filter(name => !existingFieldNames.some(existing => normalize(existing) === normalize(name))),
    metadataWarnings,
    errors
  };

  for (const record of records.filter(Boolean)) {
    const { entity, inference } = record;
    if (!inference.tabletop) continue;
    report.tabletopRecords += 1;
    const proposals = {};
    for (const [kind, fieldName] of Object.entries(RPG_FIELD_NAMES)) {
      const existing = fieldValue(entity, fieldName);
      const result = inference[kind];
      if (existing) {
        report.existingValuesPreserved.push({ id: entity.id, name: entity.name, field: fieldName, value: existing });
        continue;
      }
      if (result.ambiguous) {
        report.ambiguousRecords.push({ id: entity.id, name: entity.name, field: fieldName, candidates: result.candidates, confidence: result.confidence });
      } else if (result.value && result.confidence === "high") {
        proposals[kind] = result;
        const target = kind === "system" ? report.proposedGameSystemUpdates : report.proposedGameEditionUpdates;
        target.push({ id: entity.id, name: entity.name, value: result.value, confidence: result.confidence });
      } else if (result.value) {
        report.reviewSuggestions.push({ id: entity.id, name: entity.name, field: fieldName, value: result.value, confidence: result.confidence });
      }
    }
    if (!inference.system.value && !inference.system.ambiguous && !inference.edition.value && !inference.edition.ambiguous) {
      report.recordsWithNoMatch.push({ id: entity.id, name: entity.name });
    }
    if (!write || (!proposals.system && !proposals.edition)) continue;
    try {
      const current = await retry(() => homebox.entity(entity.id), retryOptions);
      const merged = mergeRpgFields(current, proposals);
      if (!merged.changed) continue;
      await retry(() => homebox.updateEntity(entity.id, merged.update), retryOptions);
      report.updatedEntities.push({ id: entity.id, name: entity.name });
    } catch (error) {
      errors.push({ id: entity.id, name: entity.name, stage: "update", error: error.message });
      logger.error?.(`Failed to enrich ${entity.assetId || entity.id}: ${error.message}`);
    }
  }
  report.summary = {
    proposedGameSystemUpdates: report.proposedGameSystemUpdates.length,
    proposedGameEditionUpdates: report.proposedGameEditionUpdates.length,
    existingValuesPreserved: report.existingValuesPreserved.length,
    reviewSuggestions: report.reviewSuggestions.length,
    ambiguousRecords: report.ambiguousRecords.length,
    recordsWithNoMatch: report.recordsWithNoMatch.length,
    updatedEntities: report.updatedEntities.length,
    metadataWarnings: report.metadataWarnings.length,
    errors: report.errors.length
  };
  return report;
}
