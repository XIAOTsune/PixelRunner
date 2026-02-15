const { API } = require("../config");
const { normalizeAppId, isEmptyValue } = require("../utils");
const { resolveInputType } = require("../shared/input-schema");

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

function pickUploadedValue(data) {
  const token = data.fileName || data.filename || data.fileKey || data.key || "";
  const url = data.url || data.fileUrl || data.download_url || data.downloadUrl || "";
  return { value: token || url, token: token || "", url: url || "" };
}

function isAiInput(input) {
  return Boolean(input && input.nodeId && input.fieldName);
}

function buildNodeInfoPayload(input, value) {
  const payload = {
    nodeId: input.nodeId,
    fieldName: input.fieldName,
    fieldValue: value
  };
  if (input.fieldType) payload.fieldType = input.fieldType;
  if (input.fieldData) payload.fieldData = input.fieldData;
  return payload;
}

function resolveRuntimeInputType(input) {
  return resolveInputType(input || {});
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
  const buffer = normalizeUploadBuffer(imageValue);
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
    { apiKey, appId: normalizedId, nodeInfoList },
    { webappId: normalizedId, nodeInfoList },
    { appId: normalizedId, nodeInfoList }
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
      reasons.push(`ai-app/run(${marker}): ${safeToMessage(result, `HTTP ${response.status}`)}`);
    } catch (error) {
      if (error && error.code === "RUN_CANCELLED") throw error;
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

  for (const input of appItem.inputs || []) {
    safeThrowIfCancelled(options);
    const key = String(input.key || "").trim();
    if (!key) continue;

    let value = inputValues[key];
    const type = resolveRuntimeInputType(input);
    if (type !== "image" && input.required && isEmptyValue(value)) {
      throw new Error(`Missing required parameter: ${input.label || input.name || key}`);
    }

    if (type === "image") {
      if (isEmptyValue(value)) {
        value = "";
        if (input.required) log(`Image parameter is empty, using blank placeholder: ${input.label || input.name || key}`, "warn");
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
    } else if (type === "number" && !isEmptyValue(value)) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`Invalid number parameter: ${input.label || key}`);
      value = n;
    } else if (type === "boolean") {
      value = Boolean(value);
    }

    nodeParams[key] = value;
    if (input.fieldName && !(input.fieldName in nodeParams)) nodeParams[input.fieldName] = value;
    if (isAiInput(input)) nodeInfoList.push(buildNodeInfoPayload(input, value));
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
