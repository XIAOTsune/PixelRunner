const UPLOAD_MAX_EDGE_CHOICES = [0, 4096, 2048, 1024];
const PASTE_STRATEGY_CHOICES = ["normal", "smart", "smartEnhanced"];
const CLOUD_CONCURRENT_JOBS_MIN = 1;
const CLOUD_CONCURRENT_JOBS_MAX = 100;
const DEFAULT_CLOUD_CONCURRENT_JOBS = 2;
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

function normalizeCloudConcurrentJobs(value, fallback = DEFAULT_CLOUD_CONCURRENT_JOBS) {
  const fallbackNum = Number(fallback);
  const fallbackNormalized = Number.isFinite(fallbackNum)
    ? Math.max(CLOUD_CONCURRENT_JOBS_MIN, Math.min(CLOUD_CONCURRENT_JOBS_MAX, Math.floor(fallbackNum)))
    : DEFAULT_CLOUD_CONCURRENT_JOBS;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallbackNormalized;
  return Math.max(CLOUD_CONCURRENT_JOBS_MIN, Math.min(CLOUD_CONCURRENT_JOBS_MAX, Math.floor(num)));
}

module.exports = {
  UPLOAD_MAX_EDGE_CHOICES,
  PASTE_STRATEGY_CHOICES,
  CLOUD_CONCURRENT_JOBS_MIN,
  CLOUD_CONCURRENT_JOBS_MAX,
  DEFAULT_CLOUD_CONCURRENT_JOBS,
  LEGACY_PASTE_STRATEGY_MAP,
  normalizeUploadMaxEdge,
  normalizePasteStrategy,
  normalizeCloudConcurrentJobs
};
