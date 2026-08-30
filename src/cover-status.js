export function coverOutcome(result = {}) {
  const text = String(result.text ?? "").trim();
  const matchCount = Array.isArray(result.matches) ? result.matches.length : 0;

  if (matchCount) {
    return {
      message: `${matchCount} possible cover match${matchCount === 1 ? "" : "es"} found. Review before adding.`,
      kind: "success",
      text
    };
  }
  if (!text && result.draft?.source !== "gemini") {
    return {
      message: "No readable cover text was recognized. Try a closer, well-lit photo or enter the details manually.",
      kind: "error",
      text: ""
    };
  }
  if (result.draft?.source === "gemini") {
    return {
      message: "Cover metadata was extracted, but no catalog match was found. Review the suggestions below.",
      kind: "info",
      text
    };
  }
  if (!matchCount) {
    return {
      message: "Cover text was recognized, but no catalog match was found. Use the recognized text below to complete the manual entry.",
      kind: "info",
      text
    };
  }
}

export function metadataSource(provider) {
  const source = String(provider ?? "").trim();
  return source ? `Metadata source: ${source}` : "Metadata source unavailable";
}

export function canScanCoverInstead(item, coverLookupAvailable) {
  return Boolean(coverLookupAvailable && item?.isbn && item?.provider !== "Manual entry");
}
