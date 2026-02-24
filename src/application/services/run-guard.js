const DEFAULT_DEDUP_WINDOW_MS = 800;
const DEFAULT_DEDUP_CACHE_LIMIT = 80;

function toPositiveNumber(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return num;
}

function getArrayBufferByteLength(value) {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return 0;
}

function normalizeBoundsForFingerprint(bounds) {
  if (!bounds || typeof bounds !== "object") return null;
  const pick = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.round(num * 1000) / 1000;
  };
  return {
    left: pick(bounds.left),
    top: pick(bounds.top),
    right: pick(bounds.right),
    bottom: pick(bounds.bottom)
  };
}

function normalizeFingerprintValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (typeof value === "function") return "[function]";

  const binaryBytes = getArrayBufferByteLength(value);
  if (binaryBytes > 0) return `[binary:${binaryBytes}]`;
  if (depth >= 4) return "[max-depth]";

  if (Array.isArray(value)) {
    const maxItems = 20;
    const items = value.slice(0, maxItems).map((item) => normalizeFingerprintValue(item, depth + 1, seen));
    if (value.length > maxItems) items.push(`[+${value.length - maxItems}]`);
    return items;
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out = {};
    const keys = Object.keys(value).sort();
    const maxKeys = 40;
    keys.slice(0, maxKeys).forEach((key) => {
      const item = value[key];
      if (typeof item === "function") return;
      out[key] = normalizeFingerprintValue(item, depth + 1, seen);
    });
    if (keys.length > maxKeys) out.__truncatedKeys = keys.length - maxKeys;
    seen.delete(value);
    return out;
  }

  return String(value);
}

function buildRunFingerprint({ appItem, inputValues, targetBounds, sourceBuffer, pasteStrategy, uploadMaxEdge, pollSettings }) {
  const payload = {
    appId: String((appItem && (appItem.id || appItem.appId || appItem.name)) || ""),
    pasteStrategy: String(pasteStrategy || ""),
    uploadMaxEdge: Number(uploadMaxEdge) || 0,
    pollInterval: Number(pollSettings && pollSettings.pollInterval) || 0,
    timeout: Number(pollSettings && pollSettings.timeout) || 0,
    targetBounds: normalizeBoundsForFingerprint(targetBounds),
    sourceBytes: getArrayBufferByteLength(sourceBuffer),
    inputValues: normalizeFingerprintValue(inputValues)
  };
  return JSON.stringify(payload);
}

function createRunGuard(options = {}) {
  const dedupWindowMs = toPositiveNumber(options.dedupWindowMs, DEFAULT_DEDUP_WINDOW_MS);
  const dedupCacheLimit = Math.max(1, Math.floor(toPositiveNumber(options.dedupCacheLimit, DEFAULT_DEDUP_CACHE_LIMIT)));
  const nowProvider = typeof options.now === "function" ? options.now : Date.now;
  let submitInFlight = false;
  let clickBlockedUntil = 0;
  let recentFingerprints = new Map();

  function reset() {
    submitInFlight = false;
    clickBlockedUntil = 0;
    recentFingerprints = new Map();
  }

  function beginSubmit(now = nowProvider()) {
    if (submitInFlight || clickBlockedUntil > Number(now || 0)) return false;
    submitInFlight = true;
    return true;
  }

  function finishSubmit() {
    submitInFlight = false;
  }

  function isSubmitInFlight() {
    return submitInFlight;
  }

  function blockClickFor(durationMs, now = nowProvider()) {
    const duration = Math.max(0, Number(durationMs) || 0);
    clickBlockedUntil = Number(now || 0) + duration;
  }

  function clearClickBlock() {
    clickBlockedUntil = 0;
  }

  function isClickGuardActive(now = nowProvider()) {
    return clickBlockedUntil > Number(now || 0);
  }

  function pruneRecentFingerprints(now = nowProvider()) {
    if (!(recentFingerprints instanceof Map)) {
      recentFingerprints = new Map();
      return;
    }
    for (const [fingerprint, ts] of recentFingerprints.entries()) {
      const time = Number(ts || 0);
      if (!Number.isFinite(time) || now - time > dedupWindowMs) {
        recentFingerprints.delete(fingerprint);
      }
    }
    while (recentFingerprints.size > dedupCacheLimit) {
      const oldest = recentFingerprints.keys().next();
      if (oldest.done) break;
      recentFingerprints.delete(oldest.value);
    }
  }

  function isRecentDuplicateFingerprint(fingerprint, now = nowProvider()) {
    if (!fingerprint) return false;
    pruneRecentFingerprints(now);
    const previous = Number(recentFingerprints.get(fingerprint) || 0);
    return previous > 0 && now - previous <= dedupWindowMs;
  }

  function rememberFingerprint(fingerprint, now = nowProvider()) {
    if (!fingerprint) return;
    pruneRecentFingerprints(now);
    recentFingerprints.set(fingerprint, now);
  }

  return {
    reset,
    beginSubmit,
    finishSubmit,
    isSubmitInFlight,
    blockClickFor,
    clearClickBlock,
    isClickGuardActive,
    pruneRecentFingerprints,
    isRecentDuplicateFingerprint,
    rememberFingerprint,
    buildRunFingerprint
  };
}

module.exports = {
  createRunGuard,
  buildRunFingerprint,
  normalizeFingerprintValue,
  normalizeBoundsForFingerprint
};
