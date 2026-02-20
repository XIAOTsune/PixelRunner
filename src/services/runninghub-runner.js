const { API } = require("../config");
const { normalizeAppId, isEmptyValue } = require("../utils");
const { resolveInputType, getInputOptionEntries } = require("../shared/input-schema");

const BLANK_IMAGE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2fJ0QAAAAASUVORK5CYII=";
const UPLOAD_MAX_EDGE_CHOICES = [0, 1024, 2048, 4096];

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

async function loadImageFromBlob(blob) {
  if (!blob) throw new Error("Image blob is empty");
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("URL.createObjectURL is not available");
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image decode failed"));
    };
    img.src = url;
  });
}

async function canvasToPngBlob(canvas) {
  if (!canvas) return null;
  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise((resolve) => {
      try {
        canvas.toBlob((result) => resolve(result || null), "image/png");
      } catch (_) {
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

async function resizeUploadBufferIfNeeded(buffer, uploadMaxEdge, log) {
  const maxEdge = normalizeUploadMaxEdge(uploadMaxEdge);
  if (maxEdge <= 0) return buffer;
  if (typeof document === "undefined" || typeof Image === "undefined") return buffer;

  try {
    const sourceBlob = new Blob([buffer], { type: "image/png" });
    const img = await loadImageFromBlob(sourceBlob);
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
    const resizedBlob = await canvasToPngBlob(canvas);
    if (!resizedBlob) return buffer;
    const resizedBuffer = await resizedBlob.arrayBuffer();
    if (!(resizedBuffer instanceof ArrayBuffer) || resizedBuffer.byteLength === 0) return buffer;

    if (typeof log === "function") {
      log(`Image resized before upload: ${sourceWidth}x${sourceHeight} -> ${targetWidth}x${targetHeight}`, "info");
    }
    return resizedBuffer;
  } catch (error) {
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
  if (chars.length === 0) return "(空)";
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
  return /prompt|negative|提示词|正向|负向/.test(marker);
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
  if (["true", "1", "yes", "y", "on", "是"].includes(marker)) return true;
  if (["false", "0", "no", "n", "off", "否"].includes(marker)) return false;
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
  const buffer = await resizeUploadBufferIfNeeded(rawBuffer, options.uploadMaxEdge, log);
  const blob = new Blob([buffer], { type: "image/png" });
  const reasons = [];

  for (const endpoint of endpoints) {
    safeThrowIfCancelled(options);
    try {
      const formData = new FormData();
      formData.append("file", blob, "image.png");

      const response = await safeFetch(`${API.BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
        signal: options.signal
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
      const response = await safeFetch(`${API.BASE_URL}${API.ENDPOINTS.AI_APP_RUN}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal
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
  const response = await safeFetch(`${API.BASE_URL}${API.ENDPOINTS.LEGACY_CREATE_TASK}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, workflowId: normalizeAppId(appId), nodeParams }),
    signal: options.signal
  });
  safeThrowIfCancelled(options);
  const result = await safeParseJsonResponse(response);
  safeThrowIfCancelled(options);
  const taskId = parseTaskId(result);
  const success = response.ok && result && (result.code === 0 || result.success === true) && taskId;
  if (!success) throw new Error(safeToMessage(result, `Create task failed (HTTP ${response.status})`));
  return taskId;
}

async function runAppTaskCore(params = {}) {
  const {
    apiKey,
    appItem,
    inputValues,
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

  const log = options.log || (() => {});
  const nodeInfoList = [];
  const nodeParams = {};
  const textPayloadDebug = [];
  const missingRequiredImages = [];
  let blankImageToken = "";
  let blankImageTokenPromise = null;

  const getBlankImageToken = async () => {
    if (blankImageToken) return blankImageToken;
    if (!blankImageTokenPromise) {
      blankImageTokenPromise = uploadImage(apiKey, BLANK_IMAGE_PNG_BASE64, options, {
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
    safeThrowIfCancelled(options);
    const type = resolveRuntimeInputType(input);
    const strictRequired = Boolean(input && input.required && input.requiredExplicit === true);
    if (type !== "image" || !strictRequired) continue;
    const resolved = resolveInputValue(input, inputValues || {}, { allowAlias: false });
    if (isEmptyValue(resolved.value)) {
      missingRequiredImages.push(String(input.label || input.name || resolved.key || "未命名图片参数"));
    }
  }

  if (missingRequiredImages.length > 0) {
    throw new Error(`缺少必填图片参数: ${missingRequiredImages.join("、")}。请先为这些参数捕获图片后再运行。`);
  }

  for (const input of appItem.inputs || []) {
    safeThrowIfCancelled(options);
    const type = resolveRuntimeInputType(input);
    const resolved = resolveInputValue(input, inputValues || {}, { allowAlias: type !== "image" });
    const key = resolved.key;
    if (!key) continue;
    let value = resolved.value;
    if (type !== "image" && input.required && isEmptyValue(value)) {
      throw new Error(`Missing required parameter: ${input.label || input.name || key}`);
    }

    if (type === "image") {
      if (isEmptyValue(value)) {
        try {
          value = await getBlankImageToken();
          log(`Image parameter is empty, using uploaded blank placeholder: ${input.label || input.name || key}`, "warn");
        } catch (error) {
          throw new Error(`Failed to upload blank placeholder for ${input.label || input.name || key}: ${error.message}`);
        }
      } else {
        const uploaded = await uploadImage(apiKey, value, options, {
          fetchImpl,
          parseJsonResponse,
          toMessage,
          throwIfCancelled: safeThrowIfCancelled
        });
        value = uploaded.value;
        safeThrowIfCancelled(options);
      }
    } else if (type === "select" && !isEmptyValue(value)) {
      value = coerceSelectValue(input, value);
    } else if (type === "number" && !isEmptyValue(value)) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`Invalid number parameter: ${input.label || key}`);
      value = n;
    } else if (type === "boolean") {
      const boolValue = parseBooleanValue(value);
      if (boolValue === null) throw new Error(`Invalid boolean parameter: ${input.label || key}`);
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
    log(`提交前文本参数检查：共 ${textPayloadDebug.length} 个`, "info");
    textPayloadDebug.slice(0, 12).forEach((item) => {
      log(`参数 ${item.label} (${item.key}, ${item.type}): 长度 ${item.length}，末尾 ${item.tail}`, "info");
    });
    if (textPayloadDebug.length > 12) {
      log(`其余 ${textPayloadDebug.length - 12} 个文本参数未展开`, "info");
    }
  }

  let lastErr = null;
  if (nodeInfoList.length > 0) {
    try {
      safeThrowIfCancelled(options);
      log(`Submitting task: AI app API (${nodeInfoList.length} params)`, "info");
      return await createAiAppTask(apiKey, appItem.appId, nodeInfoList, options, {
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
    safeThrowIfCancelled(options);
    log("Submitting task: legacy workflow API", "info");
    return createLegacyTask(apiKey, appItem.appId, nodeParams, options, {
      fetchImpl,
      parseJsonResponse,
      toMessage,
      throwIfCancelled: safeThrowIfCancelled
    });
  }

  if (lastErr) throw lastErr;
  throw new Error("No parameters to submit");
}

module.exports = { runAppTaskCore };
