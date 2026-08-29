import { BrowserMultiFormatReader } from "@zxing/browser";
import { canScanCoverInstead, coverOutcome, metadataSource } from "./cover-status.js";

const elements = {
  status: document.querySelector("#status"), location: document.querySelector("#location"),
  barcode: document.querySelector("#isbn"), lookup: document.querySelector("#lookup"),
  scanContainer: document.querySelector("#scan-container"), scan: document.querySelector("#scan"), stop: document.querySelector("#stop"),
  video: document.querySelector("#scanner-video"), results: document.querySelector("#results"),
  message: document.querySelector("#message"), boxView: document.querySelector("#box-view"),
  coverFallback: document.querySelector("#cover-fallback"), coverPhoto: document.querySelector("#cover-photo"),
  coverStatus: document.querySelector("#cover-status"), coverText: document.querySelector("#cover-text"),
  coverTextValue: document.querySelector("#cover-text-value")
};
let scannerControls;
let matches = [];
let coverLookupAvailable = false;
let manualProvenance = "manual_after_no_match";

function destinationFromQr(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.searchParams.get("destination")?.trim() || "";
  } catch {
    return "";
  }
}

function message(text, kind = "info") {
  elements.message.textContent = text;
  elements.message.dataset.kind = kind;
}

function coverMessage(text, kind = "info") {
  elements.coverStatus.textContent = text;
  elements.coverStatus.dataset.kind = kind;
}

function showRecognizedCoverText(text = "") {
  elements.coverTextValue.textContent = text;
  elements.coverText.hidden = !text;
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error ?? `Request failed (${response.status})`);
    Object.assign(error, body);
    throw error;
  }
  return body;
}

function renderLocations(locations) {
  const sorted = [...locations].sort((a, b) => a.name.localeCompare(b.name));
  elements.location.innerHTML = '<option value="">Choose a box or location…</option>';
  for (const location of sorted) {
    const option = document.createElement("option");
    option.value = location.id;
    option.textContent = location.path || location.name;
    elements.location.append(option);
  }
}

function scanCoverInstead() {
  manualProvenance = "manual_after_rejected_candidate";
  renderManualDraft(elements.barcode.value, true, null, manualProvenance);
  elements.coverFallback.hidden = false;
  coverMessage("The barcode result was set aside. Choose or take a clear cover photo.");
  showRecognizedCoverText();
  message("Incorrect barcode result set aside. Scan the cover or complete the manual entry below.");
  elements.coverFallback.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderMatches() {
  elements.results.replaceChildren();
  matches.forEach((item, index) => {
    const imageUrl = item.coverUrl || item.imageUrl;
    const creators = item.authors || item.creators || [];
    const identifier = item.isbn || item.barcode;
    const card = document.createElement("article");
    card.className = "book-card";
    const image = imageUrl ? document.createElement("img") : document.createElement("div");
    if (imageUrl) {
      image.src = imageUrl;
      image.alt = "";
    } else {
      image.className = "cover-placeholder";
      image.textContent = "No image";
    }
    const details = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = item.subtitle ? `${item.title}: ${item.subtitle}` : item.title;
    const byline = document.createElement("p");
    byline.className = "byline";
    byline.textContent = creators.join(", ") || item.manufacturer || item.mediaType || "Item";
    const metadata = document.createElement("p");
    metadata.className = "details";
    metadata.textContent = [item.mediaType || "Book", item.publisher || item.manufacturer, item.publishedDate || item.releaseDate, identifier].filter(Boolean).join(" · ");
    const source = document.createElement("p");
    source.className = "metadata-source";
    source.textContent = metadataSource(item.provider);
    const actions = document.createElement("div");
    actions.className = "match-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Add to selected box";
    button.addEventListener("click", () => importMatch(index));
    actions.append(button);
    if (canScanCoverInstead(item, coverLookupAvailable)) {
      const coverButton = document.createElement("button");
      coverButton.type = "button";
      coverButton.className = "secondary";
      coverButton.textContent = "Incorrect match? Scan cover instead";
      coverButton.addEventListener("click", scanCoverInstead);
      actions.append(coverButton);
    }
    details.append(heading, byline, metadata, source, actions);
    card.append(image, details);
    elements.results.append(card);
  });
}

async function renderBoxContents(id) {
  elements.boxView.hidden = false;
  elements.boxView.replaceChildren();
  const loading = document.createElement("p");
  loading.textContent = "Loading box contents…";
  elements.boxView.append(loading);
  try {
    const { box, items } = await jsonRequest(`/api/boxes/${encodeURIComponent(id)}`);
    elements.boxView.replaceChildren();
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Scanned container";
    const heading = document.createElement("h2");
    heading.textContent = box.name;
    const summary = document.createElement("p");
    summary.textContent = [box.assetId, `${items.length} direct item${items.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
    elements.boxView.append(eyebrow, heading, summary);
    if (items.length) {
      const list = document.createElement("ul");
      list.className = "box-contents";
      for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
        const row = document.createElement("li");
        const name = document.createElement("strong");
        name.textContent = item.name;
        const details = document.createElement("span");
        details.textContent = [item.quantity > 1 ? `Qty ${item.quantity}` : "", item.entityType, item.assetId].filter(Boolean).join(" · ");
        row.append(name, details);
        list.append(row);
      }
      elements.boxView.append(list);
    } else {
      const empty = document.createElement("p");
      empty.textContent = "This box is currently empty.";
      elements.boxView.append(empty);
    }
    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.textContent = "Add items to this box";
    useButton.addEventListener("click", () => {
      elements.barcode.focus();
      message(`${box.name} is selected. Scan an item barcode.`);
    });
    elements.boxView.append(useButton);
  } catch (error) {
    elements.boxView.replaceChildren();
    const failure = document.createElement("p");
    failure.textContent = `Unable to load box contents: ${error.message}`;
    elements.boxView.append(failure);
  }
}

function addTextField(container, labelText, value, onInput, required = false) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.value = value;
  input.required = required;
  input.addEventListener("input", () => onInput(input.value));
  label.append(input);
  container.append(label);
  return input;
}

function renderManualDraft(barcode, isBook = false, draft = null, provenance = "manual_after_no_match") {
  const item = isBook ? {
    provider: "Manual entry", providerId: barcode, isbn: String(barcode).replace(/[^0-9X]/gi, "").toUpperCase(),
    title: draft?.title ?? "", subtitle: draft?.subtitle ?? "", authors: draft?.authors ?? [], publisher: "", publishedDate: "", description: "", coverUrl: "", provenance
  } : {
    provider: "Manual entry", providerId: barcode, barcode: String(barcode).replace(/\D/g, ""),
    title: "", mediaType: "Item", creators: [], manufacturer: "", modelNumber: "", releaseDate: "",
    description: "", imageUrl: "", quantity: 1, provenance
  };
  matches = [item];
  elements.results.replaceChildren();
  const card = document.createElement("article");
  card.className = "book-card manual-card";
  const placeholder = document.createElement("div");
  placeholder.className = "cover-placeholder";
  placeholder.textContent = "Manual entry";
  const fields = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = isBook ? "Add book details" : "Add item details";
  fields.append(heading);
  if (draft) {
    const suggestion = document.createElement("p");
    suggestion.className = "field-help";
    suggestion.textContent = "Suggested from cover OCR. Review and edit every value before importing.";
    fields.append(suggestion);
  }
  const titleInput = addTextField(fields, draft ? "Title (OCR suggestion)" : "Title", item.title, value => { item.title = value.trim(); }, true);
  if (isBook) {
    addTextField(fields, draft ? "Subtitle (OCR suggestion)" : "Subtitle", item.subtitle, value => { item.subtitle = value.trim(); });
    addTextField(fields, draft ? "Author(s), separated by commas (OCR suggestion)" : "Author(s), separated by commas", item.authors.join(", "), value => {
      item.authors = value.split(",").map(author => author.trim()).filter(Boolean);
    });
    addTextField(fields, "Publisher", "", value => { item.publisher = value.trim(); });
    addTextField(fields, "Published date or year", "", value => { item.publishedDate = value.trim(); });
  } else {
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "Item type";
    const typeSelect = document.createElement("select");
    for (const type of ["Item", "Movie", "Video Game", "Music", "Book"]) {
      const option = document.createElement("option");
      option.value = option.textContent = type;
      typeSelect.append(option);
    }
    typeSelect.addEventListener("change", () => { item.mediaType = typeSelect.value; });
    typeLabel.append(typeSelect);
    fields.append(typeLabel);
    addTextField(fields, "Creator, artist, studio, or developer", "", value => {
      item.creators = value.split(",").map(creator => creator.trim()).filter(Boolean);
    });
    addTextField(fields, "Publisher or manufacturer", "", value => { item.manufacturer = value.trim(); });
    const quantityInput = addTextField(fields, "Quantity", "1", value => {
      item.quantity = Math.max(1, Number.parseInt(value, 10) || 1);
    });
    quantityInput.type = "number";
    quantityInput.min = "1";
  }
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Add ${isBook ? "book" : "item"} to selected box`;
  button.addEventListener("click", () => {
    if (!item.title) {
      titleInput.focus();
      return message(`Enter the ${isBook ? "book" : "item"} title before adding it.`, "error");
    }
    importMatch(0);
  });
  fields.append(button);
  card.append(placeholder, fields);
  elements.results.append(card);
  titleInput.focus();
}

async function coverDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .82));
  if (!blob) throw new Error("Unable to prepare that cover photo");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener("error", () => reject(new Error("Unable to read that cover photo")), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function lookupCover(file) {
  if (!file) return;
  coverMessage("Preparing and reading the book cover…");
  showRecognizedCoverText();
  elements.coverFallback.setAttribute("aria-busy", "true");
  elements.coverPhoto.disabled = true;
  try {
    const image = await coverDataUrl(file);
    const result = await jsonRequest("/api/books/cover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, barcode: elements.barcode.value })
    });
    const outcome = coverOutcome(result);
    coverMessage(outcome.message, outcome.kind);
    showRecognizedCoverText(outcome.text);
    if (!result.matches.length) return;
    matches = result.matches;
    renderMatches();
    elements.coverFallback.hidden = true;
    message(outcome.message, outcome.kind);
  } catch (error) {
    if (error.code === "cover_no_match" && error.draft) {
      manualProvenance = "manual_after_cover_no_match";
      showRecognizedCoverText(error.text);
      renderManualDraft(elements.barcode.value, true, error.draft, manualProvenance);
      return coverMessage("Readable cover text was found, but no trustworthy catalog match survived. Review the OCR suggestions below.");
    }
    coverMessage(`Cover lookup failed: ${error.message}`, "error");
  } finally {
    elements.coverFallback.removeAttribute("aria-busy");
    elements.coverPhoto.disabled = false;
    elements.coverPhoto.value = "";
  }
}

async function lookup() {
  elements.coverFallback.hidden = true;
  message("Looking up barcode…");
  try {
    matches = await jsonRequest(`/api/lookup/${encodeURIComponent(elements.barcode.value)}`);
    renderMatches();
    message(`${matches.length} metadata match${matches.length === 1 ? "" : "es"} found.`, "success");
  } catch (error) {
    if (error.code === "provider_no_match" && /^(978|979)/.test(elements.barcode.value.replace(/\D/g, ""))) {
      renderManualDraft(elements.barcode.value, true, null, "manual_after_no_match");
      elements.coverFallback.hidden = !coverLookupAvailable;
      return message(coverLookupAvailable
        ? "No barcode match found. Scan the cover or enter the missing details below."
        : "No public book match found. Enter the missing details below.");
    }
    if (error.code === "provider_no_match") {
      renderManualDraft(elements.barcode.value, false, null, "manual_after_no_match");
      return message("No public product match found. Enter the item details below.");
    }
    message(error.message, "error");
  }
}

async function importMatch(index) {
  if (!elements.location.value) return message("Select a destination box first.", "error");
  const item = matches[index];
  const isBook = Boolean(item.isbn);
  message(`Adding ${isBook ? "book" : item.mediaType?.toLowerCase() || "item"} to HomeBox…`);
  try {
    const entity = await jsonRequest(isBook ? "/api/import/books" : "/api/import/items", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isBook
        ? { book: item, parentId: elements.location.value }
        : { item, parentId: elements.location.value })
    });
    message(`Added “${entity.name}” to HomeBox.`, "success");
    elements.barcode.value = "";
    matches = [];
    renderMatches();
  } catch (error) { message(error.message, "error"); }
}

function selectScannedContainer(value) {
  const destinationId = destinationFromQr(value);
  const option = [...elements.location.options].find(entry => entry.value === destinationId);
  if (!destinationId || !option) {
    message("That QR code does not identify an available HomeBox container.", "error");
    return false;
  }
  elements.location.value = destinationId;
  const destinationUrl = new URL(window.location.href);
  destinationUrl.searchParams.set("destination", destinationId);
  window.history.replaceState({}, "", destinationUrl);
  message(`Container selected: ${option.textContent}`, "success");
  renderBoxContents(destinationId);
  elements.barcode.focus();
  return true;
}

async function startScanner(mode = "item") {
  stopScanner();
  elements.video.hidden = false;
  elements.stop.hidden = false;
  const reader = new BrowserMultiFormatReader();
  try {
    scannerControls = await reader.decodeFromVideoDevice(undefined, elements.video, result => {
      if (!result) return;
      const value = result.getText();
      stopScanner();
      if (mode === "container" || destinationFromQr(value)) {
        selectScannedContainer(value);
      } else {
        elements.barcode.value = value;
        lookup();
      }
    });
    message(mode === "container"
      ? "Point the camera at a HomeBox Importer container QR label."
      : "Point the camera at a UPC, EAN, or ISBN barcode.");
  } catch (error) {
    stopScanner();
    message(`Camera unavailable: ${error.message}`, "error");
  }
}

function stopScanner() {
  scannerControls?.stop();
  scannerControls = undefined;
  elements.video.hidden = true;
  elements.stop.hidden = true;
}

elements.lookup.addEventListener("click", lookup);
elements.scanContainer.addEventListener("click", () => startScanner("container"));
elements.scan.addEventListener("click", () => startScanner("item"));
elements.stop.addEventListener("click", stopScanner);
elements.coverPhoto.addEventListener("change", () => lookupCover(elements.coverPhoto.files[0]));
elements.barcode.addEventListener("keydown", event => { if (event.key === "Enter") lookup(); });

Promise.all([jsonRequest("/api/health"), jsonRequest("/api/locations")])
  .then(([health, locations]) => {
    elements.status.textContent = `Connected to HomeBox ${health.homebox.version ?? ""}`;
    coverLookupAvailable = Boolean(health.features?.coverLookup);
    renderLocations(locations);
    const destinationId = new URLSearchParams(window.location.search).get("destination");
    if (destinationId && [...elements.location.options].some(option => option.value === destinationId)) {
      elements.location.value = destinationId;
      message(`Destination selected: ${elements.location.selectedOptions[0].textContent}`, "success");
      renderBoxContents(destinationId);
    }
  }).catch(error => {
    elements.status.textContent = "HomeBox connection needs attention";
    message(error.message, "error");
  });
