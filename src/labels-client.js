import QRCode from "qrcode";
import { jsPDF } from "jspdf";

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
const selectedLocations = () => {
  const ids = new Set(selectedIds());
  return locations.filter(location => ids.has(location.id));
};

function destinationUrl(location) {
  const target = new URL("/", elements.baseUrl.value);
  if (!/^https?:$/.test(target.protocol)) throw new Error("Unsupported URL protocol");
  target.searchParams.set("destination", location.id);
  return target.href;
}

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
  const selected = selectedLocations();
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
      target = destinationUrl(location);
    } catch {
      elements.message.textContent = "Enter a valid QR destination URL.";
      return;
    }
    const label = document.createElement("article");
    label.className = "inventory-label";
    const qr = document.createElement("img");
    qr.alt = `QR code for ${location.name}`;
    qr.src = await QRCode.toDataURL(target, { margin: 0, width: 300, errorCorrectionLevel: "M" });
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
  elements.print.textContent = elements.preset.value === "dk2205" ? "Download print-ready PDF" : "Print";
  elements.message.textContent = `${selected.length} label${selected.length === 1 ? "" : "s"} ready to print.`;
}

async function downloadBrotherPdf() {
  const selected = selectedLocations();
  if (!selected.length) return generateLabels();
  elements.message.textContent = "Building exact-size 62 × 50 mm PDF…";
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [62, 50], compress: true });
  pdf.setProperties({ title: "HomeBox Box Labels", subject: "Brother QL-810WC / DK-2205 labels" });
  for (let index = 0; index < selected.length; index += 1) {
    const location = selected[index];
    if (index) pdf.addPage([62, 50], "landscape");
    const qr = await QRCode.toDataURL(destinationUrl(location), { margin: 0, width: 600, errorCorrectionLevel: "M" });
    pdf.addImage(qr, "PNG", 2.5, 10, 30, 30, undefined, "FAST");
    const textX = 35;
    const textWidth = 24;
    pdf.setTextColor(0);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    const nameLines = pdf.splitTextToSize(location.name, textWidth).slice(0, 3);
    pdf.text(nameLines, textX, 10);
    let cursor = 10 + nameLines.length * 5.2 + 1;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.5);
    const safePath = location.path.replace(/[^\x20-\x7E]/g, " > ");
    const pathLines = pdf.splitTextToSize(safePath, textWidth).slice(0, 3);
    pdf.text(pathLines, textX, cursor);
    cursor += pathLines.length * 2.8 + 1.5;
    pdf.setFont("courier", "bold");
    pdf.setFontSize(8.5);
    pdf.text(location.assetId || `ID ${location.id.slice(0, 8)}`, textX, Math.min(cursor, 41));
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(5.5);
    pdf.text("Scan to view contents", textX, 46);
  }
  pdf.save("homebox-box-labels-dk2205.pdf");
  elements.message.textContent = `${selected.length} exact-size label page${selected.length === 1 ? "" : "s"} downloaded. Print the PDF at Actual size.`;
}

elements.search.addEventListener("input", () => renderLocations(elements.search.value));
const presetHelp = {
  dk2205: "Download the exact-size PDF, then print it at Actual size on 62 mm continuous media. Each label is 50 mm long.",
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
elements.print.addEventListener("click", () => {
  if (elements.preset.value === "dk2205") downloadBrotherPdf().catch(error => {
    elements.message.textContent = `Unable to build label PDF: ${error.message}`;
  });
  else window.print();
});

jsonRequest("/api/locations").then(result => {
  locations = result.sort((a, b) => a.path.localeCompare(b.path));
  renderLocations();
  elements.message.textContent = `${locations.length} boxes and locations available.`;
}).catch(error => { elements.message.textContent = error.message; });
