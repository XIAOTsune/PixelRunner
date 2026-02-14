function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateId() {
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function normalizeAppId(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";

  if (!/[/?#]/.test(value) && !value.includes("runninghub.cn")) return value;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch (_) {}

  try {
    const url = new URL(decoded);
    const keys = [
      "webappId",
      "webappid",
      "appId",
      "appid",
      "workflowId",
      "workflowid",
      "id",
      "code"
    ];
    for (const key of keys) {
      const v = url.searchParams.get(key);
      if (v && v.trim()) return v.trim();
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length > 0) {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i].toLowerCase();
        if (["app", "workflow", "community", "detail"].includes(seg) && segments[i + 1]) {
          return segments[i + 1].trim();
        }
      }
      return segments[segments.length - 1].trim();
    }
  } catch (_) {}

  const numeric = decoded.match(/\d{5,}/);
  return numeric ? numeric[0] : value;
}

function inferInputType(rawType) {
  const t = String(rawType || "").toLowerCase();
  if (t.includes("image") || t.includes("file") || t.includes("img")) return "image";
  if (t.includes("number") || t.includes("int") || t.includes("float") || t.includes("slider")) return "number";
  if (t === "list") return "select";
  if (t.includes("select") || t.includes("enum") || t.includes("option")) return "select";
  if (t.includes("bool") || t.includes("switch") || t.includes("checkbox")) return "boolean";
  return "text";
}

function isEmptyValue(value) {
  return value === undefined || value === null || value === "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toFiniteNumber(value, fallback = 0) {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value || ""));
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  sleep,
  generateId,
  safeJsonParse,
  normalizeAppId,
  inferInputType,
  isEmptyValue,
  escapeHtml,
  toFiniteNumber
};

