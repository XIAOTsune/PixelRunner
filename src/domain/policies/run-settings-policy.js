const UPLOAD_MAX_EDGE_CHOICES = [0, 4096, 2048, 1024];
const PASTE_STRATEGY_CHOICES = ["normal", "smart", "smartEnhanced"];
const LEGACY_PASTE_STRATEGY_MAP = {
  stretch: "normal",
  contain: "normal",
  cover: "normal",
  alphaTrim: "smart",
  edgeAuto: "smart"
};

function normalizeUploadMaxEdge(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return UPLOAD_MAX_EDGE_CHOICES.includes(num) ? num : fallback;
}

function normalizePasteStrategy(value, fallback = "normal") {
  const marker = String(value || "").trim();
  const normalized = LEGACY_PASTE_STRATEGY_MAP[marker] || marker;
  if (!normalized) return fallback;
  return PASTE_STRATEGY_CHOICES.includes(normalized) ? normalized : fallback;
}

module.exports = {
  UPLOAD_MAX_EDGE_CHOICES,
  PASTE_STRATEGY_CHOICES,
  LEGACY_PASTE_STRATEGY_MAP,
  normalizeUploadMaxEdge,
  normalizePasteStrategy
};
