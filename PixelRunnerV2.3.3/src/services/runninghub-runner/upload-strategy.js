const { API } = require("../../config");
const { RUNNINGHUB_ERROR_CODES } = require("../runninghub-error-codes");
const { createRunCancelledError, fetchWithTimeout } = require("./request-strategy");
const {
  normalizeUploadTargetBytes,
  normalizeUploadHardLimitBytes,
  classifyUploadRiskByBytes
} = require("../../domain/policies/run-settings-policy");

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

function normalizeBitDepth(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num);
}

function normalizeNonNegativeNumber(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return Math.max(0, Number(fallback) || 0);
  return num;
}

function normalizeDimension(value, fallback = 0) {
  return Math.max(0, Math.floor(normalizeNonNegativeNumber(value, fallback)));
}

function normalizeImageMeta(imageValue, fallback = {}) {
  const source = imageValue && typeof imageValue === "object" ? imageValue : {};
  const sourceMeta = source.sourceMeta && typeof source.sourceMeta === "object" ? source.sourceMeta : {};
  const uploadMeta = source.uploadMeta && typeof source.uploadMeta === "object" ? source.uploadMeta : {};
  const compressionTrace = source.compressionTrace && typeof source.compressionTrace === "object" ? source.compressionTrace : {};
  const fallbackUploadBytes = Math.max(0, Number(fallback.uploadBytes) || 0);
  const fallbackUploadMime = String(fallback.uploadMime || "");

  const sourceBitDepth = normalizeBitDepth(sourceMeta.bitDepth);
  const uploadBitDepth = normalizeBitDepth(uploadMeta.bitDepth);
  const normalizedDocBitDepth = sourceBitDepth != null ? sourceBitDepth : uploadBitDepth;

  const normalizedUploadBytes = normalizeNonNegativeNumber(uploadMeta.bytes, fallbackUploadBytes);
  const normalizedSourceBytes = normalizeNonNegativeNumber(sourceMeta.bytes, normalizedUploadBytes);
  const normalizedUploadWidth = normalizeDimension(uploadMeta.width, sourceMeta.width);
  const normalizedUploadHeight = normalizeDimension(uploadMeta.height, sourceMeta.height);
  const normalizedSourceWidth = normalizeDimension(sourceMeta.width, normalizedUploadWidth);
  const normalizedSourceHeight = normalizeDimension(sourceMeta.height, normalizedUploadHeight);
  const normalizedUploadMime = String(uploadMeta.mime || fallbackUploadMime || sourceMeta.mime || "");
  const normalizedSourceMime = String(sourceMeta.mime || normalizedUploadMime || "");

  return {
    sourceMeta: {
      mime: normalizedSourceMime,
      bytes: normalizedSourceBytes,
      width: normalizedSourceWidth,
      height: normalizedSourceHeight,
      bitDepth: normalizedDocBitDepth,
      risk: String(sourceMeta.risk || "")
    },
    uploadMeta: {
      mime: normalizedUploadMime,
      bytes: normalizedUploadBytes,
      width: normalizedUploadWidth,
      height: normalizedUploadHeight,
      bitDepth: normalizedDocBitDepth,
      risk: String(uploadMeta.risk || "")
    },
    compressionTrace: {
      applied: Boolean(compressionTrace.applied),
      quality: Number.isFinite(Number(compressionTrace.quality)) ? Number(compressionTrace.quality) : null,
      maxEdge: Number.isFinite(Number(compressionTrace.maxEdge)) ? Number(compressionTrace.maxEdge) : null,
      attempts: Math.max(0, Number(compressionTrace.attempts) || 0),
      durationMs: Math.max(0, Number(compressionTrace.durationMs) || 0)
    }
  };
}

function emitUploadDiagnosticLog(log, payload, level = "info") {
  if (typeof log !== "function") return;
  try {
    log(`[UploadDiag] ${JSON.stringify(payload)}`, level);
  } catch (_) {}
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
  const uploadBytes = Math.max(0, Number(buffer.byteLength) || 0);
  const targetBytes = normalizeUploadTargetBytes(options.uploadTargetBytes, 9_000_000);
  const hardLimitBytes = normalizeUploadHardLimitBytes(options.uploadHardLimitBytes, 10_000_000, targetBytes);
  const uploadRisk = classifyUploadRiskByBytes(uploadBytes, targetBytes, hardLimitBytes);
  const detectedMime = detectImageMime(buffer);
  const uploadMime = detectedMime.startsWith("image/") ? detectedMime : "image/png";
  const uploadFileName = uploadMime === "image/jpeg" ? "image.jpg" : uploadMime === "image/webp" ? "image.webp" : "image.png";
  const blob = new Blob([buffer], { type: uploadMime });
  const uploadRetryCount = normalizeUploadRetryCount(options.uploadRetryCount, 0);
  const maxAttempts = uploadRetryCount + 1;
  const attemptSummaries = [];
  const normalizedMeta = normalizeImageMeta(imageValue, {
    uploadBytes,
    uploadMime
  });
  const sourceBytesForRisk = normalizedMeta.sourceMeta.bytes > 0 ? normalizedMeta.sourceMeta.bytes : uploadBytes;
  const sourceRisk = classifyUploadRiskByBytes(sourceBytesForRisk, targetBytes, hardLimitBytes);
  const declaredUploadRisk = normalizedMeta.uploadMeta.risk || null;

  emitUploadDiagnosticLog(log, {
    stage: "preflight",
    sourceBytes: normalizedMeta.sourceMeta.bytes || null,
    uploadBytes,
    sourceMime: normalizedMeta.sourceMeta.mime || null,
    uploadMime,
    sourceSize: normalizedMeta.sourceMeta.width > 0 ? `${normalizedMeta.sourceMeta.width}x${normalizedMeta.sourceMeta.height}` : null,
    uploadSize: normalizedMeta.uploadMeta.width > 0 ? `${normalizedMeta.uploadMeta.width}x${normalizedMeta.uploadMeta.height}` : null,
    sourceBitDepth: normalizedMeta.sourceMeta.bitDepth,
    uploadBitDepth: normalizedMeta.uploadMeta.bitDepth,
    riskBefore: sourceRisk,
    riskAfter: uploadRisk,
    riskBeforeStage: "source-meta",
    riskAfterStage: "upload-buffer",
    declaredUploadRisk,
    compressionApplied: normalizedMeta.compressionTrace.applied,
    quality: normalizedMeta.compressionTrace.quality,
    maxEdge: normalizedMeta.compressionTrace.maxEdge,
    attempts: normalizedMeta.compressionTrace.attempts,
    durationMs: normalizedMeta.compressionTrace.durationMs,
    targetBytes,
    hardLimitBytes
  });

  if (uploadBytes > hardLimitBytes) {
    emitUploadDiagnosticLog(log, {
      stage: "preflight-blocked",
      sourceBytes: normalizedMeta.sourceMeta.bytes || null,
      uploadBytes,
      hardLimitBytes,
      riskBefore: sourceRisk,
      riskAfter: uploadRisk
    }, "warn");
    throw new Error("Upload preflight failed: file size exceeds hard limit");
  }

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
          emitUploadDiagnosticLog(log, {
            stage: "endpoint-response",
            endpoint,
            httpStatus: response.status,
            apiCode: null,
            apiMessage: null,
            uploadBytes,
            riskAfter: uploadRisk
          }, "warn");
          failures.push({
            reason: `${endpoint}: HTTP ${response.status}`,
            retryable: isRetryableHttpStatus(response.status)
          });
          continue;
        }

        const success = result && (result.code === 0 || result.success === true);
        if (!success) {
          const message = safeToMessage(result);
          emitUploadDiagnosticLog(log, {
            stage: "endpoint-response",
            endpoint,
            httpStatus: response.status,
            apiCode: result && (result.code || result.statusCode || null),
            apiMessage: message,
            uploadBytes,
            riskAfter: uploadRisk
          }, "warn");
          failures.push({
            reason: `${endpoint}: ${message}`,
            retryable: isRetryableApiMessage(message)
          });
          continue;
        }

        const data = result.data || result.result || {};
        const picked = pickUploadedValue(data);
        if (picked.value) {
          emitUploadDiagnosticLog(log, {
            stage: "endpoint-success",
            endpoint,
            httpStatus: response.status,
            apiCode: result && (result.code || 0),
            apiMessage: safeToMessage(result, "ok"),
            uploadBytes,
            riskAfter: uploadRisk
          });
          return picked;
        }
        failures.push({
          reason: `${endpoint}: upload success but no usable file token/url`,
          retryable: true
        });
      } catch (error) {
        if (error && error.code === RUNNINGHUB_ERROR_CODES.RUN_CANCELLED) throw error;
        const message = error && error.message ? error.message : String(error || "unknown");
        emitUploadDiagnosticLog(log, {
          stage: "endpoint-error",
          endpoint,
          httpStatus: null,
          apiCode: null,
          apiMessage: message,
          uploadBytes,
          riskAfter: uploadRisk
        }, "warn");
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
