import { BrowserMultiFormatReader } from "@zxing/browser";

const elements = {
  status: document.querySelector("#status"), location: document.querySelector("#location"),
  barcode: document.querySelector("#isbn"), lookup: document.querySelector("#lookup"),
  scan: document.querySelector("#scan"), stop: document.querySelector("#stop"),
  video: document.querySelector("#scanner-video"), results: document.querySelector("#results"),
  message: document.querySelector("#message")
};
let scannerControls;
let matches = [];

function message(text, kind = "info") {
  elements.message.textContent = text;
  elements.message.dataset.kind = kind;
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
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
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Add to selected box";
    button.addEventListener("click", () => importMatch(index));
    details.append(heading, byline, metadata, button);
    card.append(image, details);
    elements.results.append(card);
  });
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

function renderManualDraft(barcode, isBook = false) {
  const item = isBook ? {
    provider: "Manual entry", providerId: barcode, isbn: String(barcode).replace(/[^0-9X]/gi, "").toUpperCase(),
    title: "", subtitle: "", authors: [], publisher: "", publishedDate: "", description: "", coverUrl: ""
  } : {
    provider: "Manual entry", providerId: barcode, barcode: String(barcode).replace(/\D/g, ""),
    title: "", mediaType: "Item", creators: [], manufacturer: "", modelNumber: "", releaseDate: "",
    description: "", imageUrl: "", quantity: 1
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
  const titleInput = addTextField(fields, "Title", "", value => { item.title = value.trim(); }, true);
  if (isBook) {
    addTextField(fields, "Author(s), separated by commas", "", value => {
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

async function lookup() {
  message("Looking up barcode…");
  try {
    matches = await jsonRequest(`/api/lookup/${encodeURIComponent(elements.barcode.value)}`);
    renderMatches();
    message(`${matches.length} metadata match${matches.length === 1 ? "" : "es"} found.`, "success");
  } catch (error) {
    if (error.message.startsWith("No book metadata found for ISBN")) {
      renderManualDraft(elements.barcode.value, true);
      return message("No public book match found. Enter the missing details below.");
    }
    if (error.message.startsWith("No product metadata found for barcode")) {
      renderManualDraft(elements.barcode.value, false);
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

async function startScanner() {
  stopScanner();
  elements.video.hidden = false;
  elements.stop.hidden = false;
  const reader = new BrowserMultiFormatReader();
  try {
    scannerControls = await reader.decodeFromVideoDevice(undefined, elements.video, result => {
      if (!result) return;
      elements.barcode.value = result.getText();
      stopScanner();
      lookup();
    });
    message("Point the camera at a UPC, EAN, or ISBN barcode.");
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
elements.scan.addEventListener("click", startScanner);
elements.stop.addEventListener("click", stopScanner);
elements.barcode.addEventListener("keydown", event => { if (event.key === "Enter") lookup(); });

Promise.all([jsonRequest("/api/health"), jsonRequest("/api/locations")])
  .then(([health, locations]) => {
    elements.status.textContent = `Connected to HomeBox ${health.homebox.version ?? ""}`;
    renderLocations(locations);
    const destinationId = new URLSearchParams(window.location.search).get("destination");
    if (destinationId && [...elements.location.options].some(option => option.value === destinationId)) {
      elements.location.value = destinationId;
      message(`Destination selected: ${elements.location.selectedOptions[0].textContent}`, "success");
    }
  }).catch(error => {
    elements.status.textContent = "HomeBox connection needs attention";
    message(error.message, "error");
  });
