export function coverOutcome(result = {}) {
  const text = String(result.text ?? "").trim();
  const matchCount = Array.isArray(result.matches) ? result.matches.length : 0;

  if (!text) {
    return {
      message: "No readable cover text was recognized. Try a closer, well-lit photo or enter the details manually.",
      kind: "error",
      text: ""
    };
  }
  if (!matchCount) {
    return {
      message: "Cover text was recognized, but no catalog match was found. Use the recognized text below to complete the manual entry.",
      kind: "info",
      text
    };
  }
  return {
    message: `${matchCount} possible cover match${matchCount === 1 ? "" : "es"} found. Review before adding.`,
    kind: "success",
    text
  };
}
