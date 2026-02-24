const PASTE_STRATEGY_CHOICES = ["normal", "smart", "smartEnhanced"];
const LEGACY_PASTE_STRATEGY_MAP = {
  stretch: "normal",
  contain: "normal",
  cover: "normal",
  alphaTrim: "smart",
  edgeAuto: "smart"
};

function createAbortError(message = "User aborted") {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function isAbortError(error) {
  if (!error) return false;
  if (error.name === "AbortError") return true;
  if (error.code === "RUN_CANCELLED") return true;
  const message = String(error.message || "").toLowerCase();
  return message.includes("abort") || message.includes("cancel") || message.includes("中止");
}

function isTimeoutError(error) {
  return Boolean(error && error.name === "TimeoutError");
}

function withTimeout(promise, timeoutMs, label = "operation") {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return promise;

  let timerId = null;
  return new Promise((resolve, reject) => {
    timerId = setTimeout(() => {
      const err = new Error(`${label} timeout after ${Math.round(ms)}ms`);
      err.name = "TimeoutError";
      reject(err);
    }, ms);

    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => {
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
      });
  });
}

function toPixelNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }
  if (value && typeof value === "object") {
    if (typeof value._value === "number" && Number.isFinite(value._value)) return value._value;
    if (typeof value.value === "number" && Number.isFinite(value.value)) return value.value;
  }
  return fallback;
}

function getDocSizePx(doc) {
  const width = Math.max(1, Math.round(toPixelNumber(doc && doc.width, 1)));
  const height = Math.max(1, Math.round(toPixelNumber(doc && doc.height, 1)));
  return { width, height };
}

function normalizePasteStrategy(value) {
  const marker = String(value || "").trim();
  if (!marker) return "normal";
  const legacy = LEGACY_PASTE_STRATEGY_MAP[marker];
  const normalized = legacy || marker;
  return PASTE_STRATEGY_CHOICES.includes(normalized) ? normalized : "normal";
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function lerpNumber(a, b, t) {
  const x = Number.isFinite(a) ? a : 0;
  const y = Number.isFinite(b) ? b : x;
  const k = clampNumber(Number(t), 0, 1);
  return x + (y - x) * k;
}

function wrapAngleDegrees(angle) {
  if (!Number.isFinite(angle)) return 0;
  let v = angle % 360;
  if (v > 180) v -= 360;
  if (v <= -180) v += 360;
  return v;
}

module.exports = {
  createAbortError,
  isAbortError,
  isTimeoutError,
  withTimeout,
  toPixelNumber,
  getDocSizePx,
  normalizePasteStrategy,
  clampNumber,
  lerpNumber,
  wrapAngleDegrees
};
