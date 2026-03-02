const PASTE_STRATEGY_CHOICES = ["normal", "smart", "smartEnhanced"];
const CLOUD_CONCURRENT_JOBS_MIN = 1;
const CLOUD_CONCURRENT_JOBS_MAX = 100;
const DEFAULT_CLOUD_CONCURRENT_JOBS = 2;
const UPLOAD_RETRY_COUNT_MIN = 0;
const UPLOAD_RETRY_COUNT_MAX = 5;
const DEFAULT_UPLOAD_RETRY_COUNT = 2;
const UPLOAD_TARGET_BYTES_MIN = 1_000_000;
const UPLOAD_TARGET_BYTES_MAX = 100_000_000;
const DEFAULT_UPLOAD_TARGET_BYTES = 9_000_000;
const UPLOAD_HARD_LIMIT_BYTES_MIN = 1_000_000;
const UPLOAD_HARD_LIMIT_BYTES_MAX = 100_000_000;
const DEFAULT_UPLOAD_HARD_LIMIT_BYTES = 10_000_000;
const DEFAULT_UPLOAD_AUTO_COMPRESS_ENABLED = true;
const UPLOAD_COMPRESS_FORMAT_CHOICES = ["jpeg"];
const DEFAULT_UPLOAD_COMPRESS_FORMAT = "jpeg";
const UPLOAD_RISK_LEVELS = Object.freeze({
  SAFE: "safe",
  RISKY: "risky",
  BLOCKED: "blocked"
});
const LEGACY_PASTE_STRATEGY_MAP = {
  stretch: "normal",
  contain: "normal",
  cover: "normal",
  alphaTrim: "smart",
  edgeAuto: "smart"
};

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

function normalizeUploadRetryCount(value, fallback = DEFAULT_UPLOAD_RETRY_COUNT) {
  const fallbackNum = Number(fallback);
  const fallbackNormalized = Number.isFinite(fallbackNum)
    ? Math.max(UPLOAD_RETRY_COUNT_MIN, Math.min(UPLOAD_RETRY_COUNT_MAX, Math.floor(fallbackNum)))
    : DEFAULT_UPLOAD_RETRY_COUNT;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallbackNormalized;
  return Math.max(UPLOAD_RETRY_COUNT_MIN, Math.min(UPLOAD_RETRY_COUNT_MAX, Math.floor(num)));
}

function normalizeUploadTargetBytes(value, fallback = DEFAULT_UPLOAD_TARGET_BYTES) {
  const fallbackNum = Number(fallback);
  const fallbackNormalized = Number.isFinite(fallbackNum)
    ? Math.max(UPLOAD_TARGET_BYTES_MIN, Math.min(UPLOAD_TARGET_BYTES_MAX, Math.floor(fallbackNum)))
    : DEFAULT_UPLOAD_TARGET_BYTES;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallbackNormalized;
  return Math.max(UPLOAD_TARGET_BYTES_MIN, Math.min(UPLOAD_TARGET_BYTES_MAX, Math.floor(num)));
}

function normalizeUploadHardLimitBytes(value, fallback = DEFAULT_UPLOAD_HARD_LIMIT_BYTES, targetBytes = null) {
  const fallbackNum = Number(fallback);
  const fallbackNormalized = Number.isFinite(fallbackNum)
    ? Math.max(UPLOAD_HARD_LIMIT_BYTES_MIN, Math.min(UPLOAD_HARD_LIMIT_BYTES_MAX, Math.floor(fallbackNum)))
    : DEFAULT_UPLOAD_HARD_LIMIT_BYTES;
  const num = Number(value);
  const normalized = Number.isFinite(num)
    ? Math.max(UPLOAD_HARD_LIMIT_BYTES_MIN, Math.min(UPLOAD_HARD_LIMIT_BYTES_MAX, Math.floor(num)))
    : fallbackNormalized;
  const normalizedTarget = normalizeUploadTargetBytes(
    targetBytes,
    Math.min(DEFAULT_UPLOAD_TARGET_BYTES, normalized)
  );
  return Math.max(normalizedTarget, normalized);
}

function normalizeUploadAutoCompressEnabled(value, fallback = DEFAULT_UPLOAD_AUTO_COMPRESS_ENABLED) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return Boolean(value);
  if (value == null) return Boolean(fallback);
  const marker = String(value).trim().toLowerCase();
  if (!marker) return Boolean(fallback);
  if (["true", "1", "yes", "on", "shi", "\u662f"].includes(marker)) return true;
  if (["false", "0", "no", "off", "fou", "\u5426"].includes(marker)) return false;
  return Boolean(fallback);
}

function normalizeUploadCompressFormat(value, fallback = DEFAULT_UPLOAD_COMPRESS_FORMAT) {
  const fallbackMarker = String(fallback || DEFAULT_UPLOAD_COMPRESS_FORMAT).trim().toLowerCase();
  const fallbackNormalized = UPLOAD_COMPRESS_FORMAT_CHOICES.includes(fallbackMarker)
    ? fallbackMarker
    : DEFAULT_UPLOAD_COMPRESS_FORMAT;
  const marker = String(value || "").trim().toLowerCase();
  if (!marker) return fallbackNormalized;
  return UPLOAD_COMPRESS_FORMAT_CHOICES.includes(marker) ? marker : fallbackNormalized;
}

function classifyUploadRiskByBytes(bytes, targetBytes = DEFAULT_UPLOAD_TARGET_BYTES, hardLimitBytes = DEFAULT_UPLOAD_HARD_LIMIT_BYTES) {
  const safeBytes = Math.max(0, Number(bytes) || 0);
  const normalizedTarget = normalizeUploadTargetBytes(targetBytes, DEFAULT_UPLOAD_TARGET_BYTES);
  const normalizedHardLimit = normalizeUploadHardLimitBytes(hardLimitBytes, DEFAULT_UPLOAD_HARD_LIMIT_BYTES, normalizedTarget);
  if (safeBytes <= normalizedTarget) return UPLOAD_RISK_LEVELS.SAFE;
  if (safeBytes <= normalizedHardLimit) return UPLOAD_RISK_LEVELS.RISKY;
  return UPLOAD_RISK_LEVELS.BLOCKED;
}

function formatBytesAsMbText(bytes, fractionDigits = 2) {
  const safeBytes = Math.max(0, Number(bytes) || 0);
  const mb = safeBytes / (1024 * 1024);
  const digits = Math.max(0, Number(fractionDigits) || 0);
  return `${mb.toFixed(digits)} MB`;
}

module.exports = {
  PASTE_STRATEGY_CHOICES,
  CLOUD_CONCURRENT_JOBS_MIN,
  CLOUD_CONCURRENT_JOBS_MAX,
  DEFAULT_CLOUD_CONCURRENT_JOBS,
  UPLOAD_RETRY_COUNT_MIN,
  UPLOAD_RETRY_COUNT_MAX,
  DEFAULT_UPLOAD_RETRY_COUNT,
  UPLOAD_TARGET_BYTES_MIN,
  UPLOAD_TARGET_BYTES_MAX,
  DEFAULT_UPLOAD_TARGET_BYTES,
  UPLOAD_HARD_LIMIT_BYTES_MIN,
  UPLOAD_HARD_LIMIT_BYTES_MAX,
  DEFAULT_UPLOAD_HARD_LIMIT_BYTES,
  DEFAULT_UPLOAD_AUTO_COMPRESS_ENABLED,
  UPLOAD_COMPRESS_FORMAT_CHOICES,
  DEFAULT_UPLOAD_COMPRESS_FORMAT,
  UPLOAD_RISK_LEVELS,
  LEGACY_PASTE_STRATEGY_MAP,
  normalizePasteStrategy,
  normalizeCloudConcurrentJobs,
  normalizeUploadRetryCount,
  normalizeUploadTargetBytes,
  normalizeUploadHardLimitBytes,
  normalizeUploadAutoCompressEnabled,
  normalizeUploadCompressFormat,
  classifyUploadRiskByBytes,
  formatBytesAsMbText
};
