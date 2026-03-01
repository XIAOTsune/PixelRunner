const { API } = require("../../config");
const { RUNNINGHUB_ERROR_CODES } = require("../runninghub-error-codes");
const { createRunCancelledError, fetchWithTimeout } = require("./request-strategy");

const UPLOAD_RETRY_COUNT_MIN = 0;
const UPLOAD_RETRY_COUNT_MAX = 5;
const UPLOAD_RETRY_DELAY_BASE_MS = 800;
const UPLOAD_RETRY_DELAY_MAX_MS = 5000;
const UPLOAD_RETRY_JITTER_RATIO = 0.2;

function fallbackToMessage(result, fallback = "Request failed") {
  if (!result || typeof result !== "object") return fallback;
  return String(result.msg || result.message || fallback);
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binaryString.charCodeAt(i);
  return bytes.buffer;
}

function normalizeUploadBuffer(imageValue) {
  if (imageValue instanceof ArrayBuffer) return imageValue;
  if (ArrayBuffer.isView(imageValue)) {
    const view = imageValue;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  if (imageValue && typeof imageValue === "object") {
    if (imageValue.arrayBuffer instanceof ArrayBuffer) return imageValue.arrayBuffer;
    if (ArrayBuffer.isView(imageValue.arrayBuffer)) {
      const view = imageValue.arrayBuffer;
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
    if (typeof imageValue.base64 === "string" && imageValue.base64.trim()) {
      return base64ToArrayBuffer(imageValue.base64.trim());
    }
  }
  if (typeof imageValue === "string" && imageValue.trim()) {
    return base64ToArrayBuffer(imageValue.trim());
  }
  throw new Error("Image input is invalid");
}

function detectImageMime(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 12) return "application/octet-stream";
  const bytes = new Uint8Array(arrayBuffer);
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return "application/octet-stream";
}

function pickUploadedValue(data) {
  const token = data.fileName || data.filename || data.fileKey || data.key || "";
  const url = data.url || data.fileUrl || data.download_url || data.downloadUrl || "";
  return { value: token || url, token: token || "", url: url || "" };
}

function normalizeUploadRetryCount(value, fallback = 0) {
  const fallbackNum = Number(fallback);
  const fallbackNormalized = Number.isFinite(fallbackNum)
    ? Math.max(UPLOAD_RETRY_COUNT_MIN, Math.min(UPLOAD_RETRY_COUNT_MAX, Math.floor(fallbackNum)))
    : 0;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallbackNormalized;
  return Math.max(UPLOAD_RETRY_COUNT_MIN, Math.min(UPLOAD_RETRY_COUNT_MAX, Math.floor(num)));
}

function isRetryableNetworkMessage(message) {
  const marker = String(message || "").toLowerCase();
  if (!marker) return false;
  return (
    marker.includes("network request failed") ||
    marker.includes("failed to fetch") ||
    marker.includes("networkerror") ||
    marker.includes("network error") ||
    marker.includes("request timeout") ||
    marker.includes("timeout") ||
    marker.includes("timed out")
  );
}

function isRetryableHttpStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(Number(status));
}

function isNonRetryableApiMessage(message) {
  const marker = String(message || "").toLowerCase();
  if (!marker) return false;
  const nonRetryableMarkers = [
    "api key is required",
    "param apikey is required",
    "param api key is required",
    "invalid api key",
    "unauthorized",
    "forbidden",
    "missing required parameter",
    "invalid number parameter",
    "invalid boolean parameter",
    "image input is invalid",
    "not found"
  ];
  return nonRetryableMarkers.some((item) => marker.includes(item));
}

function isRetryableApiMessage(message) {
  const marker = String(message || "").toLowerCase();
  if (!marker) return true;
  if (isRetryableNetworkMessage(marker)) return true;
  if (isNonRetryableApiMessage(marker)) return false;
  const retryableMarkers = [
    "rate limit",
    "too many requests",
    "temporarily unavailable",
    "service unavailable",
    "gateway",
    "upstream",
    "try again",
    "busy"
  ];
  return retryableMarkers.some((item) => marker.includes(item));
}

function isRetryableError(error) {
  if (!error) return true;
  if (error.code === RUNNINGHUB_ERROR_CODES.RUN_CANCELLED) return false;
  if (error.code === RUNNINGHUB_ERROR_CODES.REQUEST_TIMEOUT) return true;
  const message = error && error.message ? error.message : String(error || "");
  if (isRetryableNetworkMessage(message)) return true;
  return !isNonRetryableApiMessage(message);
}

function computeRetryDelayMs(retryIndex) {
  const index = Math.max(0, Number(retryIndex) || 0);
  const withoutJitter = Math.min(UPLOAD_RETRY_DELAY_BASE_MS * Math.pow(2, index), UPLOAD_RETRY_DELAY_MAX_MS);
  const jitterScale = 1 + (Math.random() * 2 - 1) * UPLOAD_RETRY_JITTER_RATIO;
  return Math.max(100, Math.round(withoutJitter * jitterScale));
}

async function waitRetryDelay(delayMs, options = {}) {
  const ms = Math.max(0, Number(delayMs) || 0);
  if (ms <= 0) return;
  const signal = options.signal || null;
  await new Promise((resolve, reject) => {
    let done = false;
    let timerId = null;
    const cleanup = () => {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", onAbort);
      }
    };
    const finishResolve = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };
    const finishReject = (error) => {
      if (done) return;
      done = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      finishReject(createRunCancelledError("Run cancelled during upload retry delay"));
    };

    if (signal && signal.aborted) {
      onAbort();
      return;
    }
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    timerId = setTimeout(() => {
      finishResolve();
    }, ms);
  });
}

async function uploadImage(apiKey, imageValue, options = {}, helpers = {}) {
  const {
    fetchImpl,
    parseJsonResponse,
    toMessage,
    throwIfCancelled
  } = helpers;
  const safeFetch = typeof fetchImpl === "function" ? fetchImpl : fetch;
  const safeParseJsonResponse =
    typeof parseJsonResponse === "function"
      ? parseJsonResponse
      : async (response) => response.json().catch(() => null);
  const safeToMessage = typeof toMessage === "function" ? toMessage : fallbackToMessage;
  const safeThrowIfCancelled = typeof throwIfCancelled === "function" ? throwIfCancelled : () => {};

  const log = options.log || (() => {});
  const endpoints = [API.ENDPOINTS.UPLOAD_V2, API.ENDPOINTS.UPLOAD_LEGACY];
  const buffer = normalizeUploadBuffer(imageValue);
  const detectedMime = detectImageMime(buffer);
  const uploadMime = detectedMime.startsWith("image/") ? detectedMime : "image/png";
  const uploadFileName = uploadMime === "image/jpeg" ? "image.jpg" : uploadMime === "image/webp" ? "image.webp" : "image.png";
  const blob = new Blob([buffer], { type: uploadMime });
  const uploadRetryCount = normalizeUploadRetryCount(options.uploadRetryCount, 0);
  const maxAttempts = uploadRetryCount + 1;
  const attemptSummaries = [];

  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    safeThrowIfCancelled(options);
    const failures = [];

    for (const endpoint of endpoints) {
      safeThrowIfCancelled(options);
      try {
        const formData = new FormData();
        formData.append("file", blob, uploadFileName);

        const response = await fetchWithTimeout(safeFetch, `${API.BASE_URL}${endpoint}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: formData,
          signal: options.signal
        }, {
          timeoutMs: options.requestTimeoutMs
        });
        safeThrowIfCancelled(options);
        const result = await safeParseJsonResponse(response);
        safeThrowIfCancelled(options);

        if (!response.ok) {
          failures.push({
            reason: `${endpoint}: HTTP ${response.status}`,
            retryable: isRetryableHttpStatus(response.status)
          });
          continue;
        }

        const success = result && (result.code === 0 || result.success === true);
        if (!success) {
          const message = safeToMessage(result);
          failures.push({
            reason: `${endpoint}: ${message}`,
            retryable: isRetryableApiMessage(message)
          });
          continue;
        }

        const data = result.data || result.result || {};
        const picked = pickUploadedValue(data);
        if (picked.value) return picked;
        failures.push({
          reason: `${endpoint}: upload success but no usable file token/url`,
          retryable: true
        });
      } catch (error) {
        if (error && error.code === RUNNINGHUB_ERROR_CODES.RUN_CANCELLED) throw error;
        const message = error && error.message ? error.message : String(error || "unknown");
        failures.push({
          reason: `${endpoint}: ${message}`,
          retryable: isRetryableError(error)
        });
      }
    }

    const summary = failures.length > 0
      ? failures.map((item) => item.reason).join(" | ")
      : "Image upload failed for unknown reason";
    attemptSummaries.push(`attempt ${attemptIndex + 1}/${maxAttempts}: ${summary}`);
    const hasMoreAttempts = attemptIndex < maxAttempts - 1;
    const canRetry = hasMoreAttempts && failures.length > 0 && failures.every((item) => item.retryable);
    if (!canRetry) break;

    const delayMs = computeRetryDelayMs(attemptIndex);
    log(
      `Upload failed (attempt ${attemptIndex + 1}/${maxAttempts}), retrying in ${delayMs}ms: ${summary}`,
      "warn"
    );
    await waitRetryDelay(delayMs, options);
  }

  log(attemptSummaries.join(" || "), "warn");
  throw new Error("Image upload failed");
}

module.exports = {
  normalizeUploadBuffer,
  detectImageMime,
  pickUploadedValue,
  uploadImage
};
