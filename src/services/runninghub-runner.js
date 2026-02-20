const { API } = require("../config");
const { normalizeAppId, isEmptyValue } = require("../utils");
const { resolveInputType, getInputOptionEntries } = require("../shared/input-schema");

const BLANK_IMAGE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2fJ0QAAAAASUVORK5CYII=";
const UPLOAD_MAX_EDGE_CHOICES = [0, 1024, 2048, 4096];
const UPLOAD_MAX_EDGE_RETRY_CHAIN = [1024, 2048, 4096, 0];
const IMAGE_RESIZE_DECODE_TIMEOUT_MS = 3500;
const IMAGE_RESIZE_ENCODE_TIMEOUT_MS = 3000;
const REQUEST_TIMEOUT_MS = 45000;

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

function normalizeUploadMaxEdge(rawValue) {
  const num = Number(rawValue);
  if (!Number.isFinite(num)) return 0;
  return UPLOAD_MAX_EDGE_CHOICES.includes(num) ? num : 0;
}

function getUploadMaxEdgeLabel(rawValue) {
  const normalized = normalizeUploadMaxEdge(rawValue);
  return normalized > 0 ? `${normalized}px` : "unlimited";
}

function buildUploadMaxEdgeCandidates(rawValue) {
  const normalized = normalizeUploadMaxEdge(rawValue);
  if (normalized <= 0) return [0];
  const index = UPLOAD_MAX_EDGE_RETRY_CHAIN.indexOf(normalized);
  if (index < 0) return [0];
  return UPLOAD_MAX_EDGE_RETRY_CHAIN.slice(index);
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

function createRunCancelledError(message = "Run cancelled") {
  const err = new Error(message);
  err.code = "RUN_CANCELLED";
  return err;
}

async function fetchWithTimeout(fetchImpl, url, init = {}, options = {}) {
  const safeFetch = typeof fetchImpl === "function" ? fetchImpl : fetch;
  const timeoutRaw = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : REQUEST_TIMEOUT_MS;
  const externalSignal = init && init.signal ? init.signal : null;

  if (typeof AbortController === "undefined") {
    return safeFetch(url, init);
  }

  const controller = new AbortController();
  let timerId = null;
  let abortCause = "";

  const onExternalAbort = () => {
    abortCause = "cancelled";
    try {
      controller.abort();
    } catch (_) {}
  };

  if (externalSignal && externalSignal.aborted) {
    throw createRunCancelledError("Run cancelled");
  }
  if (externalSignal && typeof externalSignal.addEventListener === "function") {
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timerId = setTimeout(() => {
      abortCause = "timeout";
      try {
        controller.abort();
      } catch (_) {}
    }, timeoutMs);
  }

  try {
    const requestInit = {
      ...(init && typeof init === "object" ? init : {}),
      signal: controller.signal
    };
    return await safeFetch(url, requestInit);
  } catch (error) {
    if (abortCause === "cancelled" || (externalSignal && externalSignal.aborted)) {
      throw createRunCancelledError("Run cancelled");
    }
    if (abortCause === "timeout") {
      throw new Error(`Request timeout after ${Math.round(timeoutMs)}ms`);
    }
    throw error;
  } finally {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (externalSignal && typeof externalSignal.removeEventListener === "function") {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

async function loadImageFromBuffer(arrayBuffer, options = {}) {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength === 0) {
    throw new Error("Image buffer is empty");
  }
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("URL.createObjectURL is not available");
  }
  if (typeof Image === "undefined") {
    throw new Error("Image is not available");
  }

  const signal = options.signal || null;
  const timeoutMsRaw = Number(options.timeoutMs);
  const timeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : IMAGE_RESIZE_DECODE_TIMEOUT_MS;
  const blob = new Blob([arrayBuffer], { type: detectImageMime(arrayBuffer) });
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
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
      img.onload = null;
      img.onerror = null;
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    };

    const finishResolve = (value) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(value);
    };

    const finishReject = (error) => {
      if (done) return;
      done = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => {
      finishReject(createRunCancelledError("Run cancelled during image decode"));
    };

    if (signal && signal.aborted) {
      finishReject(createRunCancelledError("Run cancelled during image decode"));
      return;
    }
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timerId = setTimeout(() => {
      finishReject(new Error(`Image decode timeout after ${Math.round(timeoutMs)}ms`));
    }, timeoutMs);

    img.onload = () => {
      finishResolve(img);
    };
    img.onerror = () => {
      finishReject(new Error("Image decode failed"));
    };
    img.src = url;
  });
}

async function canvasToPngBlob(canvas, options = {}) {
  if (!canvas) return null;
  const timeoutMsRaw = Number(options.timeoutMs);
  const timeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : IMAGE_RESIZE_ENCODE_TIMEOUT_MS;
  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise((resolve) => {
      let done = false;
      const timerId = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, timeoutMs);
      try {
        canvas.toBlob((result) => {
          if (done) return;
          done = true;
          clearTimeout(timerId);
          resolve(result || null);
        }, "image/png");
      } catch (_) {
        if (done) return;
        done = true;
        clearTimeout(timerId);
        resolve(null);
      }
    });
    if (blob) return blob;
  }

  if (typeof canvas.toDataURL === "function") {
    const dataUrl = canvas.toDataURL("image/png");
    const base64 = String(dataUrl || "").split(",")[1] || "";
    if (base64) {
      return new Blob([base64ToArrayBuffer(base64)], { type: "image/png" });
    }
  }
  return null;
}

async function resizeUploadBufferIfNeeded(buffer, uploadMaxEdge, log, options = {}) {
  const maxEdge = normalizeUploadMaxEdge(uploadMaxEdge);
  if (maxEdge <= 0) return buffer;
  if (typeof document === "undefined" || typeof Image === "undefined") return buffer;

  try {
    const img = await loadImageFromBuffer(buffer, {
      signal: options.signal,
      timeoutMs: options.resizeDecodeTimeoutMs
    });
    const sourceWidth = Number(img && (img.naturalWidth || img.width) || 0);
    const sourceHeight = Number(img && (img.naturalHeight || img.height) || 0);
    const longEdge = Math.max(sourceWidth, sourceHeight);
    if (!Number.isFinite(longEdge) || longEdge <= 0 || longEdge <= maxEdge) return buffer;

    const scale = maxEdge / longEdge;
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return buffer;

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    const resizedBlob = await canvasToPngBlob(canvas, {
      timeoutMs: options.resizeEncodeTimeoutMs
    });
    if (!resizedBlob) return buffer;
    const resizedBuffer = await resizedBlob.arrayBuffer();
    if (!(resizedBuffer instanceof ArrayBuffer) || resizedBuffer.byteLength === 0) return buffer;

    if (typeof log === "function") {
      log(`Image resized before upload: ${sourceWidth}x${sourceHeight} -> ${targetWidth}x${targetHeight}`, "info");
    }
    return resizedBuffer;
  } catch (error) {
    if (error && error.code === "RUN_CANCELLED") throw error;
    if (typeof log === "function") {
      const message = error && error.message ? error.message : String(error || "unknown");
      log(`Image resize skipped: ${message}`, "warn");
    }
    return buffer;
  }
}

function pickUploadedValue(data) {
  const token = data.fileName || data.filename || data.fileKey || data.key || "";
  const url = data.url || data.fileUrl || data.download_url || data.downloadUrl || "";
  return { value: token || url, token: token || "", url: url || "" };
}

function isAiInput(input) {
  return Boolean(input && input.nodeId && input.fieldName);
}

function isImageLikeInput(input) {
  const typeMarker = String((input && (input.type || input.fieldType)) || "").toLowerCase();
  const fieldMarker = String((input && input.fieldName) || "").toLowerCase();
  return (
    typeMarker.includes("image") ||
    typeMarker.includes("img") ||
    fieldMarker === "image"
  );
}

function getTextLength(value) {
  return Array.from(String(value == null ? "" : value)).length;
}

function getTailPreview(value, maxChars = 20) {
  const chars = Array.from(String(value == null ? "" : value));
  if (chars.length === 0) return "(empty)";
  const tail = chars.slice(Math.max(0, chars.length - maxChars)).join("");
  const singleLineTail = tail.replace(/\r/g, "").replace(/\n/g, "\\n");
  return chars.length > maxChars ? `...${singleLineTail}` : singleLineTail;
}

function isPromptLikeInputForPayload(input, runtimeType) {
  if (runtimeType === "image") return false;
  const key = String((input && input.key) || "").toLowerCase();
  const fieldName = String((input && input.fieldName) || "").toLowerCase();
  const label = String((input && (input.label || input.name || "")) || "").toLowerCase();
  const marker = `${key} ${fieldName} ${label}`;
  return /prompt|negative|positive|hint/.test(marker);
}

function shouldAttachFieldData(input, runtimeType) {
  if (isImageLikeInput(input)) return false;
  if (input.fieldData === undefined) return false;
  // Prompt-like text is sensitive to backend side coercion; avoid sending extra field metadata.
  if (runtimeType === "text" || isPromptLikeInputForPayload(input, runtimeType)) return false;
  return runtimeType === "select" || runtimeType === "boolean" || runtimeType === "number";
}

function buildNodeInfoPayload(input, value, runtimeType) {
  const payload = {
    nodeId: input.nodeId,
    fieldName: input.fieldName,
    fieldValue: value
  };
  if (input.fieldType) payload.fieldType = input.fieldType;
  if (shouldAttachFieldData(input, runtimeType)) {
    payload.fieldData = input.fieldData;
  }
  return payload;
}

function resolveRuntimeInputType(input) {
  return resolveInputType(input || {});
}

function resolveInputValue(input, inputValues, options = {}) {
  const key = String((input && input.key) || "").trim();
  if (!key) return { key: "", aliasKey: "", value: undefined };
  const aliasKey = key.includes(":") ? key.split(":").pop() : "";
  let value = inputValues[key];
  const allowAlias = options.allowAlias !== false;
  if (allowAlias && isEmptyValue(value) && aliasKey) value = inputValues[aliasKey];
  return { key, aliasKey, value };
}

function parseBooleanValue(value) {
  if (value === true || value === false) return value;
  const marker = String(value == null ? "" : value).trim().toLowerCase();
  if (!marker) return null;
  if (["true", "1", "yes", "y", "on", "shi", "\u662f"].includes(marker)) return true;
  if (["false", "0", "no", "n", "off", "fou", "\u5426"].includes(marker)) return false;
  return null;
}

function normalizeSelectValue(input, value) {
  const entries = getInputOptionEntries(input || {});
  if (!Array.isArray(entries) || entries.length === 0) return value;

  const marker = String(value == null ? "" : value).trim().toLowerCase();
  if (!marker) return value;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const valueMarker = String(entry.value == null ? "" : entry.value).trim().toLowerCase();
    const labelMarker = String(entry.label == null ? "" : entry.label).trim().toLowerCase();
    if (valueMarker === marker || labelMarker === marker) {
      return entry.value;
    }
  }

  return value;
}

function isNumericLike(value) {
  return /^-?\d+(?:\.\d+)?$/.test(String(value == null ? "" : value).trim());
}

function hasNumericFieldHint(input) {
  const marker = String((input && input.fieldType) || "");
  return /(?:^|[^a-z])(int|integer|float|double|decimal|number)(?:[^a-z]|$)/i.test(marker);
}

function coerceSelectValue(input, value) {
  const normalized = normalizeSelectValue(input, value);
  const entries = getInputOptionEntries(input || {});

  const allBooleanOptions =
    Array.isArray(entries) && entries.length > 0 && entries.every((entry) => parseBooleanValue(entry && entry.value) !== null);
  if (allBooleanOptions) {
    const boolValue = parseBooleanValue(normalized);
    if (boolValue !== null) return boolValue;
  }

  const allNumericOptions =
    Array.isArray(entries) && entries.length > 0 && entries.every((entry) => isNumericLike(entry && entry.value));
  if ((allNumericOptions || hasNumericFieldHint(input)) && isNumericLike(normalized)) {
    const n = Number(normalized);
    if (Number.isFinite(n)) return n;
  }

  return normalized;
}

function extractNodeValidationSummary(result) {
  if (!result || typeof result !== "object") return "";
  const raw = result.node_errors || result.nodeErrors || (result.data && (result.data.node_errors || result.data.nodeErrors));
  if (!raw || typeof raw !== "object") return "";

  const lines = [];
  Object.values(raw)
    .slice(0, 4)
    .forEach((node) => {
      if (!node || typeof node !== "object") return;
      const nodeName = String(node.node_name || node.nodeName || node.class_type || "node").trim();
      const errs = Array.isArray(node.errors) ? node.errors : [];
      errs.slice(0, 2).forEach((err) => {
        if (!err || typeof err !== "object") return;
        const msg = String(err.message || err.type || "validation error").trim();
        const details = String(err.details || "").trim();
        lines.push(details ? `${nodeName}: ${msg} (${details})` : `${nodeName}: ${msg}`);
      });
    });

  return lines.join("; ");
}

function toAiAppErrorMessage(result, fallback = "AI app request failed") {
  if (!result || typeof result !== "object") return fallback;
  if (result.msg) return String(result.msg);
  if (result.message) return String(result.message);
  if (result.error && typeof result.error === "object" && (result.error.message || result.error.type)) {
    const errMsg = String(result.error.message || result.error.type || "").trim();
    if (errMsg) return errMsg;
  }
  const summary = extractNodeValidationSummary(result);
  if (summary) return summary;
  return fallback;
}

function isParameterShapeError(message) {
  const marker = String(message || "").toLowerCase();
  if (!marker) return false;
  return (
    marker.includes("webappid cannot be null") ||
    marker.includes("param apikey is required") ||
    marker.includes("param api key is required")
  );
}

function parseTaskId(result) {
  if (!result || typeof result !== "object") return "";
  return (
    (result.data && (result.data.taskId || result.data.id)) ||
    result.taskId ||
    result.id ||
    ""
  );
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
  const rawBuffer = normalizeUploadBuffer(imageValue);
  const buffer = await resizeUploadBufferIfNeeded(rawBuffer, options.uploadMaxEdge, log, options);
  const detectedMime = detectImageMime(buffer);
  const uploadMime = detectedMime.startsWith("image/") ? detectedMime : "image/png";
  const uploadFileName = uploadMime === "image/jpeg" ? "image.jpg" : uploadMime === "image/webp" ? "image.webp" : "image.png";
  const blob = new Blob([buffer], { type: uploadMime });
  const reasons = [];

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
        reasons.push(`${endpoint}: HTTP ${response.status}`);
        continue;
      }

      const success = result && (result.code === 0 || result.success === true);
      if (!success) {
        reasons.push(`${endpoint}: ${safeToMessage(result)}`);
        continue;
      }

      const data = result.data || result.result || {};
      const picked = pickUploadedValue(data);
      if (picked.value) return picked;
      reasons.push(`${endpoint}: upload success but no usable file token/url`);
    } catch (error) {
      if (error && error.code === "RUN_CANCELLED") throw error;
      reasons.push(`${endpoint}: ${error.message}`);
    }
  }

  log(reasons.join(" | "), "warn");
  throw new Error("Image upload failed");
}

async function createAiAppTask(apiKey, appId, nodeInfoList, options = {}, helpers = {}) {
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
  const normalizedId = normalizeAppId(appId);
  const candidates = [
    { apiKey, webappId: normalizedId, nodeInfoList },
    { apiKey, webAppId: normalizedId, nodeInfoList },
    { apiKey, appId: normalizedId, nodeInfoList }
  ];
  const reasons = [];

  for (const body of candidates) {
    safeThrowIfCancelled(options);
    try {
      const response = await fetchWithTimeout(safeFetch, `${API.BASE_URL}${API.ENDPOINTS.AI_APP_RUN}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal
      }, {
        timeoutMs: options.requestTimeoutMs
      });
      safeThrowIfCancelled(options);
      const result = await safeParseJsonResponse(response);
      safeThrowIfCancelled(options);
      const taskId = parseTaskId(result);
      const success = response.ok && result && (result.code === 0 || result.success === true) && taskId;
      if (success) return taskId;

      const marker = Object.keys(body).join(",");
      const message = toAiAppErrorMessage(result, safeToMessage(result, `HTTP ${response.status}`));
      const primaryVariant = body.apiKey && body.webappId;
      if (primaryVariant && !isParameterShapeError(message)) {
        const terminalError = new Error(message || "AI app request rejected");
        terminalError.code = "AI_APP_REJECTED";
        terminalError.apiResult = result;
        throw terminalError;
      }
      reasons.push(`ai-app/run(${marker}): ${message}`);
    } catch (error) {
      if (error && error.code === "RUN_CANCELLED") throw error;
      if (error && error.code === "AI_APP_REJECTED") throw error;
      reasons.push(`ai-app/run: ${error.message}`);
    }
  }

  log(reasons.join(" | "), "warn");
  throw new Error("AI app task creation failed");
}

async function createLegacyTask(apiKey, appId, nodeParams, options = {}, helpers = {}) {
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

  safeThrowIfCancelled(options);
  const response = await fetchWithTimeout(safeFetch, `${API.BASE_URL}${API.ENDPOINTS.LEGACY_CREATE_TASK}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, workflowId: normalizeAppId(appId), nodeParams }),
    signal: options.signal
  }, {
    timeoutMs: options.requestTimeoutMs
  });
  safeThrowIfCancelled(options);
  const result = await safeParseJsonResponse(response);
  safeThrowIfCancelled(options);
  const taskId = parseTaskId(result);
  const success = response.ok && result && (result.code === 0 || result.success === true) && taskId;
  if (!success) throw new Error(safeToMessage(result, `Create task failed (HTTP ${response.status})`));
  return taskId;
}

function createLocalValidationError(message, code = "LOCAL_VALIDATION") {
  const error = new Error(String(message || "Validation failed"));
  error.code = code;
  error.localValidation = true;
  return error;
}

function shouldRetryWithNextUploadEdge(error) {
  if (!error) return true;
  if (error.code === "RUN_CANCELLED") return false;
  if (error.localValidation) return false;

  const message = String(error.message || error || "").toLowerCase();
  if (!message) return true;
  const nonRetryMarkers = [
    "missing required parameter",
    "invalid number parameter",
    "invalid boolean parameter",
    "image input is invalid",
    "no parameters to submit",
    "param apikey is required",
    "param api key is required",
    "api key is required"
  ];
  return !nonRetryMarkers.some((marker) => message.includes(marker));
}

async function submitTaskAttempt(params = {}) {
  const {
    apiKey,
    appItem,
    inputValues,
    uploadMaxEdge = 0,
    options = {},
    helpers = {}
  } = params;
  const {
    fetchImpl,
    parseJsonResponse,
    toMessage,
    throwIfCancelled
  } = helpers;
  const safeThrowIfCancelled = typeof throwIfCancelled === "function" ? throwIfCancelled : () => {};
  const normalizedUploadMaxEdge = normalizeUploadMaxEdge(uploadMaxEdge);
  const attemptOptions = {
    ...(options && typeof options === "object" ? options : {}),
    uploadMaxEdge: normalizedUploadMaxEdge
  };
  const log = attemptOptions.log || (() => {});

  if (normalizedUploadMaxEdge > 0) {
    log(`Upload max edge active: ${getUploadMaxEdgeLabel(normalizedUploadMaxEdge)}`, "info");
  }

  const nodeInfoList = [];
  const nodeParams = {};
  const textPayloadDebug = [];
  const missingRequiredImages = [];
  let blankImageToken = "";
  let blankImageTokenPromise = null;

  const getBlankImageToken = async () => {
    if (blankImageToken) return blankImageToken;
    if (!blankImageTokenPromise) {
      blankImageTokenPromise = uploadImage(apiKey, BLANK_IMAGE_PNG_BASE64, attemptOptions, {
        fetchImpl,
        parseJsonResponse,
        toMessage,
        throwIfCancelled: safeThrowIfCancelled
      }).then((uploaded) => {
        const nextToken = uploaded && uploaded.value ? String(uploaded.value) : "";
        if (!nextToken) throw new Error("blank image upload returned empty token");
        blankImageToken = nextToken;
        return nextToken;
      });
    }
    return blankImageTokenPromise;
  };

  for (const input of appItem.inputs || []) {
    safeThrowIfCancelled(attemptOptions);
    const type = resolveRuntimeInputType(input);
    const strictRequired = Boolean(input && input.required && input.requiredExplicit === true);
    if (type !== "image" || !strictRequired) continue;
    const resolved = resolveInputValue(input, inputValues || {}, { allowAlias: false });
    if (isEmptyValue(resolved.value)) {
      missingRequiredImages.push(String(input.label || input.name || resolved.key || "unnamed image parameter"));
    }
  }

  if (missingRequiredImages.length > 0) {
    throw createLocalValidationError(
      `Missing required image parameters: ${missingRequiredImages.join(", ")}. Please capture or provide images before running.`,
      "MISSING_REQUIRED_IMAGE"
    );
  }

  for (const input of appItem.inputs || []) {
    safeThrowIfCancelled(attemptOptions);
    const type = resolveRuntimeInputType(input);
    const resolved = resolveInputValue(input, inputValues || {}, { allowAlias: type !== "image" });
    const key = resolved.key;
    if (!key) continue;
    let value = resolved.value;
    if (type !== "image" && input.required && isEmptyValue(value)) {
      throw createLocalValidationError(
        `Missing required parameter: ${input.label || input.name || key}`,
        "MISSING_REQUIRED_PARAMETER"
      );
    }

    if (type === "image") {
      if (isEmptyValue(value)) {
        try {
          value = await getBlankImageToken();
          log(`Image parameter is empty, using uploaded blank placeholder: ${input.label || input.name || key}`, "warn");
        } catch (error) {
          throw createLocalValidationError(
            `Failed to upload blank placeholder for ${input.label || input.name || key}: ${error.message}`,
            "BLANK_IMAGE_UPLOAD_FAILED"
          );
        }
      } else {
        const uploaded = await uploadImage(apiKey, value, attemptOptions, {
          fetchImpl,
          parseJsonResponse,
          toMessage,
          throwIfCancelled: safeThrowIfCancelled
        });
        value = uploaded.value;
        safeThrowIfCancelled(attemptOptions);
      }
    } else if (type === "select" && !isEmptyValue(value)) {
      value = coerceSelectValue(input, value);
    } else if (type === "number" && !isEmptyValue(value)) {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw createLocalValidationError(`Invalid number parameter: ${input.label || key}`, "INVALID_NUMBER_PARAMETER");
      }
      value = n;
    } else if (type === "boolean") {
      const boolValue = parseBooleanValue(value);
      if (boolValue === null) {
        throw createLocalValidationError(`Invalid boolean parameter: ${input.label || key}`, "INVALID_BOOLEAN_PARAMETER");
      }
      value = boolValue;
    }

    nodeParams[key] = value;
    if (input.fieldName && !(input.fieldName in nodeParams)) nodeParams[input.fieldName] = value;
    if (type !== "image") {
      const textValue = String(value == null ? "" : value);
      textPayloadDebug.push({
        key,
        label: String(input.label || input.name || key),
        type,
        length: getTextLength(textValue),
        tail: getTailPreview(textValue, 20)
      });
    }
    if (isAiInput(input)) nodeInfoList.push(buildNodeInfoPayload(input, value, type));
  }

  if (textPayloadDebug.length > 0) {
    log(`Pre-submit text parameter check: ${textPayloadDebug.length} item(s)`, "info");
    textPayloadDebug.slice(0, 12).forEach((item) => {
      log(`Parameter ${item.label} (${item.key}, ${item.type}): length ${item.length}, tail ${item.tail}`, "info");
    });
    if (textPayloadDebug.length > 12) {
      log(`Other ${textPayloadDebug.length - 12} text parameter(s) not shown`, "info");
    }
  }

  let lastErr = null;
  if (nodeInfoList.length > 0) {
    try {
      safeThrowIfCancelled(attemptOptions);
      log(`Submitting task: AI app API (${nodeInfoList.length} params)`, "info");
      return await createAiAppTask(apiKey, appItem.appId, nodeInfoList, attemptOptions, {
        fetchImpl,
        parseJsonResponse,
        toMessage,
        throwIfCancelled: safeThrowIfCancelled
      });
    } catch (error) {
      if (error && error.code === "RUN_CANCELLED") throw error;
      if (error && error.code === "AI_APP_REJECTED") throw error;
      lastErr = error;
      log(`AI app API failed, fallback to legacy API: ${error.message}`, "warn");
    }
  }

  if (Object.keys(nodeParams).length > 0) {
    safeThrowIfCancelled(attemptOptions);
    log("Submitting task: legacy workflow API", "info");
    return createLegacyTask(apiKey, appItem.appId, nodeParams, attemptOptions, {
      fetchImpl,
      parseJsonResponse,
      toMessage,
      throwIfCancelled: safeThrowIfCancelled
    });
  }

  if (lastErr) throw lastErr;
  throw createLocalValidationError("No parameters to submit", "NO_PARAMETERS_TO_SUBMIT");
}

async function runAppTaskCore(params = {}) {
  const {
    apiKey,
    appItem,
    inputValues,
    options = {},
    helpers = {}
  } = params;
  const log = options.log || (() => {});
  const hasImageInput = Array.isArray(appItem && appItem.inputs)
    ? appItem.inputs.some((input) => resolveRuntimeInputType(input) === "image")
    : false;
  const uploadMaxEdgeCandidates = hasImageInput ? buildUploadMaxEdgeCandidates(options.uploadMaxEdge) : [0];
  let lastErr = null;

  for (let index = 0; index < uploadMaxEdgeCandidates.length; index += 1) {
    const currentUploadMaxEdge = uploadMaxEdgeCandidates[index];
    if (index > 0) {
      const previousLabel = getUploadMaxEdgeLabel(uploadMaxEdgeCandidates[index - 1]);
      const nextLabel = getUploadMaxEdgeLabel(currentUploadMaxEdge);
      log(`Retrying task submission with relaxed upload limit: ${previousLabel} -> ${nextLabel}`, "warn");
    }

    try {
      return await submitTaskAttempt({
        apiKey,
        appItem,
        inputValues,
        uploadMaxEdge: currentUploadMaxEdge,
        options,
        helpers
      });
    } catch (error) {
      if (error && error.code === "RUN_CANCELLED") throw error;
      lastErr = error;
      const hasNextCandidate = index < uploadMaxEdgeCandidates.length - 1;
      if (!hasNextCandidate || !shouldRetryWithNextUploadEdge(error)) {
        throw error;
      }
      const currentLabel = getUploadMaxEdgeLabel(currentUploadMaxEdge);
      const message = error && error.message ? error.message : String(error || "unknown error");
      log(`Task submission failed under upload limit ${currentLabel}: ${message}`, "warn");
    }
  }

  if (lastErr) throw lastErr;
  throw new Error("Task submission failed");
}

module.exports = { runAppTaskCore };


