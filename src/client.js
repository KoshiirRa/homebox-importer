import { BrowserMultiFormatReader } from "@zxing/browser";

const elements = {
  status: document.querySelector("#status"),
  location: document.querySelector("#location"),
  isbn: document.querySelector("#isbn"),
  lookup: document.querySelector("#lookup"),
  scan: document.querySelector("#scan"),
  stop: document.querySelector("#stop"),
  video: document.querySelector("#scanner-video"),
  results: document.querySelector("#results"),
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
  matches.forEach((book, index) => {
    const card = document.createElement("article");
    card.className = "book-card";
    card.innerHTML = `
      ${book.coverUrl ? `<img src="${book.coverUrl}" alt="" />` : '<div class="cover-placeholder">No cover</div>'}
      <div><h3></h3><p class="byline"></p><p class="details"></p><button type="button">Add to selected box</button></div>`;
    card.querySelector("h3").textContent = book.subtitle ? `${book.title}: ${book.subtitle}` : book.title;
    card.querySelector(".byline").textContent = book.authors.join(", ") || "Unknown author";
    card.querySelector(".details").textContent = [book.publisher, book.publishedDate, book.isbn].filter(Boolean).join(" · ");
    card.querySelector("button").addEventListener("click", () => importBook(index));
    elements.results.append(card);
  });
}

function renderManualDraft(isbn) {
  const book = {
    provider: "Manual entry",
    providerId: isbn,
    isbn: String(isbn).replace(/[^0-9X]/gi, "").toUpperCase(),
    title: "",
    subtitle: "",
    authors: [],
    publisher: "",
    publishedDate: "",
    description: "",
    coverUrl: ""
  };
  matches = [book];
  elements.results.replaceChildren();

  const card = document.createElement("article");
  card.className = "book-card manual-card";
  const placeholder = document.createElement("div");
  placeholder.className = "cover-placeholder";
  placeholder.textContent = "Manual entry";
  const fields = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = "Add book details";
  fields.append(heading);

  const addField = (labelText, value, onInput, required = false) => {
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.value = value;
    input.required = required;
    input.addEventListener("input", () => onInput(input.value));
    label.append(input);
    fields.append(label);
    return input;
  };

  const titleInput = addField("Title", "", value => { book.title = value.trim(); }, true);
  addField("Author(s), separated by commas", "", value => {
    book.authors = value.split(",").map(author => author.trim()).filter(Boolean);
  });
  addField("Publisher", "", value => { book.publisher = value.trim(); });
  addField("Published date or year", "", value => { book.publishedDate = value.trim(); });
  const isbnInput = addField("ISBN", book.isbn, value => {
    book.isbn = value.replace(/[^0-9X]/gi, "").toUpperCase();
  }, true);
  isbnInput.inputMode = "numeric";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Add manual book to selected box";
  button.addEventListener("click", () => {
    if (!book.title) {
      titleInput.focus();
      return message("Enter the book title before adding it.", "error");
    }
    importBook(0);
  });
  fields.append(button);
  card.append(placeholder, fields);
  elements.results.append(card);
  titleInput.focus();
}

async function lookup() {
  message("Looking up barcode…");
  try {
    matches = await jsonRequest(`/api/books/${encodeURIComponent(elements.isbn.value)}`);
    renderMatches();
    message(`${matches.length} metadata match${matches.length === 1 ? "" : "es"} found.`, "success");
  } catch (error) {
    if (error.message.startsWith("No book metadata found for ISBN")) {
      renderManualDraft(elements.isbn.value);
      message("No public metadata match yet. Enter the missing details below.", "info");
      return;
    }
    message(error.message, "error");
  }
}

async function importBook(index) {
  if (!elements.location.value) return message("Select a destination box first.", "error");
  message("Adding book to HomeBox…");
  try {
    const entity = await jsonRequest("/api/import/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book: matches[index], parentId: elements.location.value })
    });
    message(`Added “${entity.name}” to HomeBox.`, "success");
    elements.isbn.value = "";
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
    scannerControls = await reader.decodeFromVideoDevice(undefined, elements.video, (result) => {
      if (!result) return;
      elements.isbn.value = result.getText();
      stopScanner();
      lookup();
    });
    message("Point the camera at an ISBN barcode.");
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
elements.isbn.addEventListener("keydown", event => { if (event.key === "Enter") lookup(); });

Promise.all([
  jsonRequest("/api/health"),
  jsonRequest("/api/locations")
]).then(([health, locations]) => {
  elements.status.textContent = `Connected to HomeBox ${health.homebox.version ?? ""}`;
  renderLocations(locations);
}).catch(error => {
  elements.status.textContent = "HomeBox connection needs attention";
  message(error.message, "error");
});
