import QRCode from "qrcode";

const elements = {
  locations: document.querySelector("#label-locations"), search: document.querySelector("#label-search"),
  baseUrl: document.querySelector("#label-base-url"),
  preset: document.querySelector("#label-preset"), selectAll: document.querySelector("#select-all"),
  presetHelp: document.querySelector("#preset-help"),
  generate: document.querySelector("#generate-labels"), print: document.querySelector("#print-labels"),
  message: document.querySelector("#label-message"), preview: document.querySelector("#label-preview")
};
let locations = [];
const selectedLocationIds = new Set();

async function jsonRequest(url) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

const selectedIds = () => [...selectedLocationIds];

function renderLocations(filter = "") {
  const needle = filter.trim().toLowerCase();
  elements.locations.replaceChildren();
  for (const location of locations.filter(entry => !needle || entry.path.toLowerCase().includes(needle))) {
    const label = document.createElement("label");
    label.className = "location-choice";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = location.id;
    checkbox.checked = selectedLocationIds.has(location.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedLocationIds.add(location.id);
      else selectedLocationIds.delete(location.id);
    });
    const text = document.createElement("span");
    text.textContent = location.assetId ? `${location.path} (${location.assetId})` : location.path;
    label.append(checkbox, text);
    elements.locations.append(label);
  }
}

async function generateLabels() {
  const ids = new Set(selectedIds());
  const selected = locations.filter(location => ids.has(location.id));
  if (!selected.length) {
    elements.message.textContent = "Select at least one box or location.";
    return;
  }
  elements.message.textContent = "Generating QR labels…";
  elements.preview.className = `label-grid preset-${elements.preset.value}`;
  elements.preview.replaceChildren();
  for (const location of selected) {
    let target;
    try {
      target = new URL("/", elements.baseUrl.value);
      if (!/^https?:$/.test(target.protocol)) throw new Error("Unsupported URL protocol");
    } catch {
      elements.message.textContent = "Enter a valid QR destination URL.";
      return;
    }
    target.searchParams.set("destination", location.id);
    const label = document.createElement("article");
    label.className = "inventory-label";
    const qr = document.createElement("img");
    qr.alt = `QR code for ${location.name}`;
    qr.src = await QRCode.toDataURL(target.href, { margin: 0, width: 300, errorCorrectionLevel: "M" });
    const text = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = location.name;
    const path = document.createElement("span");
    path.textContent = location.path;
    const asset = document.createElement("code");
    asset.textContent = location.assetId || `ID ${location.id.slice(0, 8)}`;
    const instruction = document.createElement("small");
    instruction.textContent = "Scan to select this box";
    text.append(heading, path, asset, instruction);
    label.append(qr, text);
    elements.preview.append(label);
  }
  elements.print.hidden = false;
  elements.message.textContent = `${selected.length} label${selected.length === 1 ? "" : "s"} ready to print.`;
}

elements.search.addEventListener("input", () => renderLocations(elements.search.value));
const presetHelp = {
  dk2205: "Print on 62 mm continuous media at 100% scale. Each label is automatically cut to 50 mm.",
  "5160": "Use Avery 5160 letter-size stock and print at 100% scale.",
  "5163": "Use Avery 5163 letter-size stock and print at 100% scale.",
  "4x2": "Use 4 × 2 inch stock and print at 100% scale."
};
elements.preset.addEventListener("change", () => {
  elements.presetHelp.textContent = presetHelp[elements.preset.value];
});
elements.baseUrl.value = localStorage.getItem("labelBaseUrl") || window.location.origin;
elements.baseUrl.addEventListener("change", () => localStorage.setItem("labelBaseUrl", elements.baseUrl.value));
elements.selectAll.addEventListener("click", () => {
  const checkboxes = [...elements.locations.querySelectorAll('input[type="checkbox"]')];
  const shouldSelect = checkboxes.some(checkbox => !checkbox.checked);
  checkboxes.forEach(checkbox => {
    checkbox.checked = shouldSelect;
    if (shouldSelect) selectedLocationIds.add(checkbox.value);
    else selectedLocationIds.delete(checkbox.value);
  });
});
elements.generate.addEventListener("click", generateLabels);
elements.print.addEventListener("click", () => window.print());

jsonRequest("/api/locations").then(result => {
  locations = result.sort((a, b) => a.path.localeCompare(b.path));
  renderLocations();
  elements.message.textContent = `${locations.length} boxes and locations available.`;
}).catch(error => { elements.message.textContent = error.message; });
