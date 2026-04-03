function buildTextPayloadDebugEntry(params = {}) {
  const {
    key,
    label,
    type,
    value,
    getTextLength,
    getTailPreview,
    tailMaxChars = 20
  } = params;
  const safeGetTextLength = typeof getTextLength === "function" ? getTextLength : (text) => String(text || "").length;
  const safeGetTailPreview =
    typeof getTailPreview === "function" ? getTailPreview : (text) => String(text || "").slice(-tailMaxChars);

  const textValue = String(value == null ? "" : value);
  return {
    key: String(key || ""),
    label: String(label || key || ""),
    type: String(type || "text"),
    length: safeGetTextLength(textValue),
    tail: safeGetTailPreview(textValue, tailMaxChars)
  };
}

function emitTextPayloadDebugLog(log, entries, options = {}) {
  if (typeof log !== "function") return;
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) return;

  const previewLimitRaw = Number(options.previewLimit);
  const previewLimit = Number.isFinite(previewLimitRaw) && previewLimitRaw > 0 ? Math.floor(previewLimitRaw) : 12;
  log(`Pre-submit text parameter check: ${list.length} item(s)`, "info");
  list.slice(0, previewLimit).forEach((item) => {
    if (!item || typeof item !== "object") return;
    log(
      `Parameter ${item.label} (${item.key}, ${item.type}): length ${item.length}, tail ${item.tail}`,
      "info"
    );
  });
  if (list.length > previewLimit) {
    log(`Other ${list.length - previewLimit} text parameter(s) not shown`, "info");
  }
}

module.exports = {
  buildTextPayloadDebugEntry,
  emitTextPayloadDebugLog
};
