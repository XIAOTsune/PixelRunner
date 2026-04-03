function normalizeFieldToken(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isWeakLabel(label) {
  const text = String(label || "").trim().toLowerCase();
  if (!text) return true;
  return ["value", "text", "string", "number", "int", "float", "double", "bool", "boolean"].includes(text);
}

function resolveDisplayLabel(params = {}) {
  const { key, fieldName, rawLabel, rawName, labelMap = {} } = params;
  const preferredRawLabel = String(rawLabel || rawName || "").trim();
  if (preferredRawLabel && !isWeakLabel(preferredRawLabel)) {
    return { label: preferredRawLabel, source: "raw", confidence: 1 };
  }

  const candidates = [fieldName, key, key && String(key).includes(":") ? String(key).split(":").pop() : ""];
  for (const item of candidates) {
    const mapped = labelMap[normalizeFieldToken(item)];
    if (mapped) return { label: mapped, source: "map", confidence: 0.6 };
  }
  const fallback = preferredRawLabel || String(fieldName || key || "").trim();
  return { label: fallback, source: "fallback", confidence: 0.4 };
}

function resolveFieldDataLabel(fieldData, parseJsonFromEscapedText) {
  if (!fieldData) return "";
  let parsed = fieldData;
  if (typeof fieldData === "string" && typeof parseJsonFromEscapedText === "function") {
    parsed = parseJsonFromEscapedText(fieldData);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";

  const hasOptionLike = Array.isArray(parsed.options) || Array.isArray(parsed.items) || Array.isArray(parsed.values);
  if (hasOptionLike) return "";

  const candidate = parsed.label || parsed.name || parsed.title || parsed.description || "";
  return String(candidate || "").trim();
}

module.exports = {
  normalizeFieldToken,
  isWeakLabel,
  resolveDisplayLabel,
  resolveFieldDataLabel
};
