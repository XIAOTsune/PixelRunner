function parseJsonText(raw) {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch (_) {
    return undefined;
  }
}

function parseJsonFromEscapedText(raw) {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  const candidates = [
    text,
    text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\"/g, "\""),
    text.replace(/\\u0022/g, "\"")
  ];
  for (const candidate of candidates) {
    const parsed = parseJsonText(candidate);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

module.exports = {
  parseJsonText,
  parseJsonFromEscapedText
};
