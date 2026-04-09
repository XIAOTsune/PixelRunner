const runninghubTaskControllers = new Map();
const blankImageTokenCache = new Map();
const BLANK_IMAGE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2fJ0QAAAAASUVORK5CYII=";

function normalizeAppId(value) {
  const normalized = String(value == null ? "" : value).trim();
  if (!normalized) return "";
  if (["null", "undefined"].includes(normalized.toLowerCase())) return "";
  return normalized;
}

function parseBooleanValue(value) {
  if (value === true || value === false) return value;
  const marker = String(value == null ? "" : value).trim().toLowerCase();
  if (!marker) return null;
  if (["true", "1", "yes", "y", "on", "shi", "是"].includes(marker)) return true;
  if (["false", "0", "no", "n", "off", "fou", "否"].includes(marker)) return false;
  return null;
}

function isFilledInputValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return true;

  if (typeof value === "object") {
    return Boolean(
      (typeof value.dataUrl === "string" && value.dataUrl.trim()) ||
      (typeof value.base64 === "string" && value.base64.trim()) ||
      (typeof value.url === "string" && value.url.trim())
    );
  }

  return String(value).trim() !== "";
}

function isProbablyBase64String(value) {
  const text = String(value || "").trim();
  if (!text || text.length < 16 || text.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(text);
}

function normalizeBase64Text(value) {
  const text = String(value || "").trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!text) return "";
  const padding = text.length % 4;
  if (padding === 1) return "";
  if (padding > 1) return `${text}${"=".repeat(4 - padding)}`;
  return text;
}

function classifyImageSubmissionValue(imageValue) {
  if (imageValue instanceof ArrayBuffer || ArrayBuffer.isView(imageValue)) {
    return { mode: "upload", value: imageValue };
  }

  if (imageValue && typeof imageValue === "object") {
    if (typeof imageValue.dataUrl === "string" && imageValue.dataUrl.trim()) {
      return { mode: "upload", value: imageValue };
    }
    if (typeof imageValue.base64 === "string" && imageValue.base64.trim()) {
      return { mode: "upload", value: imageValue };
    }
    if (typeof imageValue.url === "string" && imageValue.url.trim()) {
      return { mode: "passthrough", value: String(imageValue.url).trim() };
    }
    if (typeof imageValue.value === "string" && imageValue.value.trim()) {
      return { mode: "passthrough", value: String(imageValue.value).trim() };
    }
    return { mode: "empty", value: null };
  }

  const text = String(imageValue || "").trim();
  if (!text) return { mode: "empty", value: null };
  if (/^https?:\/\//i.test(text)) {
    return { mode: "passthrough", value: text };
  }
  if (/^data:[^;,]+;base64,/i.test(text)) {
    return { mode: "upload", value: text };
  }
  return { mode: "passthrough", value: text };
}

function normalizeImageInputValue(input, value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (input && input.passObject === true) {
    return value;
  }

  const mode = String(
    (input && (input.imageValueMode || input.valueMode || input.transferMode || input.transport)) || ""
  ).trim().toLowerCase();

  if (mode === "base64") {
    return String(value.base64 || "");
  }

  if (mode === "url") {
    return String(value.url || "");
  }

  if (mode === "object" || mode === "json") {
    return value;
  }

  return String(value.dataUrl || value.base64 || value.url || "");
}

function isImageLikeInput(input) {
  if (!input || typeof input !== "object") return false;
  const typeMarker = String(input.type || input.fieldType || "").trim().toLowerCase();
  const fieldMarker = String(input.fieldName || "").trim().toLowerCase();
  return typeMarker.includes("image") || typeMarker.includes("img") || typeMarker.includes("file") || fieldMarker === "image";
}

function parseDataUrl(value) {
  const text = String(value || "").trim();
  const match = text.match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: String(match[1] || "application/octet-stream").trim() || "application/octet-stream",
    base64: String(match[2] || "").trim()
  };
}

function base64ToArrayBuffer(base64) {
  const normalized = normalizeBase64Text(base64);
  if (!normalized || !isProbablyBase64String(normalized)) {
    throw new Error("Image input is not valid base64");
  }
  const binaryString = atob(normalized);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes.buffer;
}

function normalizeUploadBuffer(imageValue) {
  if (imageValue instanceof ArrayBuffer) return imageValue;
  if (ArrayBuffer.isView(imageValue)) {
    return imageValue.buffer.slice(imageValue.byteOffset, imageValue.byteOffset + imageValue.byteLength);
  }

  if (imageValue && typeof imageValue === "object") {
    if (typeof imageValue.dataUrl === "string" && imageValue.dataUrl.trim()) {
      const parsed = parseDataUrl(imageValue.dataUrl);
      if (parsed && parsed.base64) return base64ToArrayBuffer(parsed.base64);
    }
    if (typeof imageValue.base64 === "string" && imageValue.base64.trim()) {
      return base64ToArrayBuffer(imageValue.base64);
    }
    if (imageValue.arrayBuffer instanceof ArrayBuffer) return imageValue.arrayBuffer;
    if (ArrayBuffer.isView(imageValue.arrayBuffer)) {
      return imageValue.arrayBuffer.buffer.slice(
        imageValue.arrayBuffer.byteOffset,
        imageValue.arrayBuffer.byteOffset + imageValue.arrayBuffer.byteLength
      );
    }
  }

  if (typeof imageValue === "string" && imageValue.trim()) {
    const parsed = parseDataUrl(imageValue);
    if (parsed && parsed.base64) return base64ToArrayBuffer(parsed.base64);
    if (isProbablyBase64String(normalizeBase64Text(imageValue))) {
      return base64ToArrayBuffer(imageValue);
    }
  }

  throw new Error("Image input is invalid");
}

function detectImageMime(arrayBuffer, fallback = "image/jpeg") {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 12) return fallback;
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
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
  return fallback;
}

function pickUploadedValue(data) {
  const source = data && typeof data === "object" ? data : {};
  const token = String(source.fileName || source.filename || source.fileKey || source.key || "").trim();
  const url = String(source.url || source.fileUrl || source.download_url || source.downloadUrl || "").trim();
  return { value: token || url, token, url };
}

async function uploadImageValue(apiKey, imageValue, settings = {}) {
  const buffer = normalizeUploadBuffer(imageValue);
  const fallbackMime =
    (imageValue && typeof imageValue === "object" && String(imageValue.mimeType || "").trim()) || "image/jpeg";
  const mimeType = detectImageMime(buffer, fallbackMime);
  const fileName = mimeType === "image/png" ? "image.png" : mimeType === "image/webp" ? "image.webp" : "image.jpg";
  const blob = new Blob([buffer], { type: mimeType });
  const timeoutMs = Math.max(5000, Number(settings.timeout || 180) * 1000);
  const endpoints = [
    "https://www.runninghub.cn/openapi/v2/media/upload/binary",
    "https://www.runninghub.cn/uc/openapi/upload"
  ];

  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const formData = new FormData();
      formData.append("file", blob, fileName);
      const result = await fetchJsonWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`
          },
          body: formData
        },
        timeoutMs
      );
      const picked = pickUploadedValue((result && (result.data || result.result)) || result);
      if (picked.value) {
        return picked.value;
      }
      throw new Error((result && (result.message || result.msg)) || "Upload succeeded but no usable file token/url");
    } catch (error) {
      console.warn("[PixelRunner/RunningHub] image upload failed", {
        endpoint,
        message: error && error.message ? error.message : String(error || "")
      });
      lastError = error;
    }
  }

  throw lastError || new Error("Image upload failed");
}

async function getBlankImageToken(apiKey, settings = {}) {
  const cacheKey = String(apiKey || "").trim();
  if (!cacheKey) throw new Error("RunningHub API Key is missing");
  const cached = blankImageTokenCache.get(cacheKey);
  if (cached) return cached;

  const pending = uploadImageValue(cacheKey, BLANK_IMAGE_PNG_BASE64, settings)
    .then((token) => {
      const normalized = String(token || "").trim();
      if (!normalized) {
        blankImageTokenCache.delete(cacheKey);
        throw new Error("Blank image upload returned empty token");
      }
      blankImageTokenCache.set(cacheKey, normalized);
      return normalized;
    })
    .catch((error) => {
      blankImageTokenCache.delete(cacheKey);
      throw error;
    });

  blankImageTokenCache.set(cacheKey, pending);
  return pending;
}

function normalizeInputValue(input, value) {
  const typeMarker = String((input && (input.type || input.fieldType)) || "").trim().toLowerCase();
  if (isImageLikeInput(input) || typeMarker === "image" || typeMarker === "file") {
    return normalizeImageInputValue(input, value);
  }

  if (typeMarker === "number" || typeMarker === "int" || typeMarker === "float") {
    const num = Number(value);
    return Number.isFinite(num) ? num : value;
  }

  if (typeMarker === "boolean" || typeMarker === "switch" || typeMarker === "checkbox") {
    const boolValue = parseBooleanValue(value);
    return boolValue === null ? Boolean(value) : boolValue;
  }

  return value;
}

function buildNodeInfoList(app, inputValues) {
  const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
  const values = inputValues && typeof inputValues === "object" ? inputValues : {};

  return inputs
    .map((input, index) => {
      const key = String((input && input.key) || "").trim() || `param_${index + 1}`;
      const rawValue = values[key];
      if (!isFilledInputValue(rawValue)) {
        if (input && input.required && typeof rawValue !== "boolean") {
          throw new Error(`Missing required input: ${input.label || input.name || key}`);
        }
        return null;
      }

      const fieldName = String((input && (input.fieldName || input.key || input.name)) || key).trim();
      const payload = {
        nodeId: input && input.nodeId ? input.nodeId : key,
        fieldName,
        fieldValue: normalizeInputValue(input, rawValue)
      };

      if (input && input.fieldType) payload.fieldType = input.fieldType;
      if (input && input.fieldData !== undefined) payload.fieldData = input.fieldData;
      return payload;
    })
    .filter(Boolean);
}

function buildNodeParams(app, inputValues) {
  const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
  const values = inputValues && typeof inputValues === "object" ? inputValues : {};
  const nodeParams = {};

  inputs.forEach((input, index) => {
    const key = String((input && input.key) || "").trim() || `param_${index + 1}`;
    const rawValue = values[key];
    if (!isFilledInputValue(rawValue)) {
      if (input && input.required && typeof rawValue !== "boolean") {
        throw new Error(`Missing required input: ${input.label || input.name || key}`);
      }
      return;
    }

    const normalizedValue = normalizeInputValue(input, rawValue);
    nodeParams[key] = normalizedValue;

    const fieldName = String((input && (input.fieldName || input.name)) || "").trim();
    if (fieldName && !(fieldName in nodeParams)) nodeParams[fieldName] = normalizedValue;
  });

  return nodeParams;
}

async function buildSubmissionInputs(app, inputValues, apiKey, settings = {}) {
  const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
  const values = inputValues && typeof inputValues === "object" ? inputValues : {};
  const normalizedValues = {};
  const nodeInfoList = [];
  const nodeParams = {};

  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const key = String((input && input.key) || "").trim() || `param_${index + 1}`;
    const rawValue = values[key];
    const isImageInput = isImageLikeInput(input);
    if (!isFilledInputValue(rawValue)) {
      if (isImageInput && !(input && input.required)) {
        const blankToken = await getBlankImageToken(apiKey, settings);
        normalizedValues[key] = blankToken;
        nodeParams[key] = blankToken;
        const optionalFieldName = String((input && (input.fieldName || input.name)) || "").trim();
        if (optionalFieldName && !(optionalFieldName in nodeParams)) nodeParams[optionalFieldName] = blankToken;
        nodeInfoList.push({
          nodeId: input && input.nodeId ? input.nodeId : key,
          fieldName: String((input && (input.fieldName || input.key || input.name)) || key).trim(),
          fieldValue: blankToken,
          ...(input && input.fieldType ? { fieldType: input.fieldType } : {})
        });
        console.log("[PixelRunner/RunningHub] optional image empty, using blank placeholder", {
          key,
          fieldName: String((input && (input.fieldName || input.name || key)) || key)
        });
        continue;
      }
      if (input && input.required && typeof rawValue !== "boolean") {
        throw new Error(`Missing required input: ${input.label || input.name || key}`);
      }
      continue;
    }

    let normalizedValue = rawValue;
    const typeMarker = String((input && (input.type || input.fieldType)) || "").trim().toLowerCase();
    if (isImageInput) {
      const imageSubmission = classifyImageSubmissionValue(rawValue);
      if (imageSubmission.mode === "empty") {
        if (input && input.required) {
          throw new Error(`Missing required input: ${input.label || input.name || key}`);
        }
        normalizedValue = await getBlankImageToken(apiKey, settings);
        console.log("[PixelRunner/RunningHub] optional image normalized to blank placeholder", {
          key,
          fieldName: String((input && (input.fieldName || input.name || key)) || key)
        });
      } else if (imageSubmission.mode === "upload") {
        try {
          normalizedValue = await uploadImageValue(apiKey, imageSubmission.value, settings);
        } catch (error) {
          console.warn("[PixelRunner/RunningHub] image upload classification failed", {
            key,
            fieldName: String((input && (input.fieldName || input.name || key)) || key),
            mode: imageSubmission.mode,
            message: error && error.message ? error.message : String(error || "")
          });
          throw error;
        }
      } else {
        normalizedValue = imageSubmission.value;
      }
      console.log("[PixelRunner/RunningHub] image uploaded", {
        key,
        fieldName: String((input && (input.fieldName || input.name || key)) || key),
        valueType: /^https?:\/\//i.test(String(normalizedValue || "")) ? "url" : "token"
      });
    } else {
      normalizedValue = normalizeInputValue(input, rawValue);
    }

    normalizedValues[key] = normalizedValue;
    nodeParams[key] = normalizedValue;
    const fieldName = String((input && (input.fieldName || input.name)) || "").trim();
    if (fieldName && !(fieldName in nodeParams)) nodeParams[fieldName] = normalizedValue;

    const nodeFieldName = String((input && (input.fieldName || input.key || input.name)) || key).trim();
    const payload = {
      nodeId: input && input.nodeId ? input.nodeId : key,
      fieldName: nodeFieldName,
      fieldValue: normalizedValue
    };
    if (input && input.fieldType) payload.fieldType = input.fieldType;
    if (input && input.fieldData !== undefined && !isImageInput) {
      payload.fieldData = input.fieldData;
    }
    nodeInfoList.push(payload);
  }

  return { normalizedValues, nodeInfoList, nodeParams };
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch (_) {}
      }, timeoutMs)
    : null;

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller ? controller.signal : options.signal
    });
    const text = await response.text();
    let result = null;
    try {
      result = text ? JSON.parse(text) : null;
    } catch (_) {
      result = { rawText: text };
    }

    if (!response.ok) {
      const message =
        (result && (result.message || result.msg || result.error)) ||
        `Request failed (HTTP ${response.status})`;
      throw new Error(String(message));
    }

    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function collectCandidateValues(payload, predicate, results = [], seen = new Set(), depth = 0) {
  if (!payload || depth > 6) return results;
  if (typeof payload !== "object") return results;
  if (seen.has(payload)) return results;
  seen.add(payload);

  if (Array.isArray(payload)) {
    payload.forEach((item) => collectCandidateValues(item, predicate, results, seen, depth + 1));
    return results;
  }

  Object.entries(payload).forEach(([key, value]) => {
    if (predicate(key, value, payload)) {
      results.push(value);
    }
    if (value && typeof value === "object") {
      collectCandidateValues(value, predicate, results, seen, depth + 1);
    }
  });

  return results;
}

function parseChargeValue(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
  }
  const text = String(value).trim();
  if (!text) return null;
  const matched = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!matched) return null;
  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(3)) : null;
}

function extractTaskChargeByKeys(payload, keys = []) {
  const candidates = collectCandidateValues(
    payload,
    (key) => {
      const normalized = String(key || "").trim().toLowerCase();
      return keys.includes(normalized);
    }
  );

  for (const candidate of candidates) {
    const parsed = parseChargeValue(candidate);
    if (parsed !== null) return Math.abs(parsed);
  }
  return null;
}

function extractTaskBalanceCharge(payload) {
  return extractTaskChargeByKeys(payload, [
    "consume",
    "consumefee",
    "consumemoney",
    "deduct",
    "deductfee",
    "deductmoney",
    "usedmoney",
    "spentmoney",
    "billingamount",
    "taskcost",
    "moneycost",
    "feecost",
    "cost",
    "fee",
    "charge"
  ]);
}

function extractTaskCoinsCharge(payload) {
  return extractTaskChargeByKeys(payload, [
    "consumecoins",
    "deductcoins",
    "usedcoins",
    "spentcoins",
    "coinscost",
    "coincost",
    "coincharge",
    "rhcoinscost",
    "rhcoincost",
    "rhcoincharge",
    "consumerhcoins",
    "deductrhcoins",
    "usedrhcoins",
    "spentrhcoins",
    "integralcost",
    "integralcharge"
  ]);
}

function formatBalanceChargeDisplay(charge) {
  const parsed = parseChargeValue(charge);
  if (parsed === null) return "";
  return `-${parsed.toFixed(3)}R`;
}

function formatCoinsChargeDisplay(charge) {
  const parsed = parseChargeValue(charge);
  if (parsed === null) return "";
  return Number.isInteger(parsed) ? `-${parsed}RH` : `-${parsed.toFixed(3)}RH`;
}

function formatTaskChargeDisplay(balanceCharge, coinsCharge) {
  const parts = [];
  const balanceText = formatBalanceChargeDisplay(balanceCharge);
  const coinsText = formatCoinsChargeDisplay(coinsCharge);
  if (balanceText) parts.push(balanceText);
  if (coinsText) parts.push(coinsText);
  return parts.join(" · ");
}

function extractOutputUrl(payload) {
  if (!payload) return "";
  if (typeof payload === "string") {
    return /^https?:\/\//i.test(payload) ? payload : "";
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const url = extractOutputUrl(item);
      if (url) return url;
    }
    return "";
  }

  if (typeof payload === "object") {
    const directKeys = ["fileUrl", "url", "downloadUrl", "download_url", "imageUrl", "resultUrl"];
    for (const key of directKeys) {
      const value = payload[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    }

    const nestedKeys = ["outputs", "data", "result", "list", "items", "nodeOutputs"];
    for (const key of nestedKeys) {
      const url = extractOutputUrl(payload[key]);
      if (url) return url;
    }
  }

  return "";
}

function extractTaskStatus(payload) {
  if (!payload || typeof payload !== "object") return "";
  return String(payload.status || payload.state || payload.taskStatus || "").toUpperCase();
}

function parseTaskId(result) {
  if (!result || typeof result !== "object") return "";
  return (result.data && (result.data.taskId || result.data.id)) || result.taskId || result.id || "";
}

function isParameterShapeError(message) {
  const marker = String(message || "").toLowerCase();
  return (
    marker.includes("webappid cannot be null") ||
    marker.includes("param apikey is required") ||
    marker.includes("param api key is required")
  );
}

function isPendingStatus(status) {
  return ["PENDING", "RUNNING", "PROCESSING", "QUEUED", "QUEUE", "WAITING", "IN_PROGRESS"].includes(status);
}

function isFailedStatus(status) {
  return ["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(status);
}

function isPendingMessage(message) {
  const text = String(message || "").toLowerCase();
  return /(processing|pending|running|queue|wait|运行中|排队|处理中)/i.test(text);
}

function isAbortLikeMessage(message) {
  const text = String(message || "").trim().toLowerCase();
  return (
    text.includes("request aborted by user") ||
    text.includes("signal is aborted") ||
    text.includes("operation was aborted") ||
    text.includes("the user aborted a request") ||
    text.includes("aborterror")
  );
}

async function fetchTaskOutputsSnapshot(apiKey, taskId, options = {}) {
  const timeoutMs = Math.max(5000, Number(options.timeoutMs) || 30000);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch (_) {}
      }, timeoutMs)
    : null;

  try {
    const response = await fetch("https://www.runninghub.cn/task/openapi/outputs", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ apiKey, taskId }),
      signal: controller ? controller.signal : options.signal
    });
    const text = await response.text();
    let result = null;
    try {
      result = text ? JSON.parse(text) : null;
    } catch (_) {
      result = { rawText: text };
    }
    return { ok: response.ok, status: response.status, result };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildTaskStatusResponse(taskId, snapshot, fallbackMessage = "") {
  const result = snapshot && snapshot.result;
  const payloadData = (result && (result.data || result.result)) || result;
  const status = extractTaskStatus(payloadData);
  const outputUrl = extractOutputUrl(payloadData);
  const balanceCharge = extractTaskBalanceCharge(payloadData || result);
  const coinsCharge = extractTaskCoinsCharge(payloadData || result);
  const message = String(
    (result && (result.message || result.msg || result.error)) ||
    fallbackMessage ||
    (snapshot && !snapshot.ok ? `Request failed (HTTP ${snapshot.status})` : "")
  ).trim();

  return {
    ok: Boolean(snapshot && snapshot.ok),
    taskId,
    status,
    outputUrl,
    charge: balanceCharge,
    balanceCharge,
    coinsCharge,
    chargeDisplay: formatTaskChargeDisplay(balanceCharge, coinsCharge),
    message,
    stillRunning: isPendingStatus(status) || isPendingMessage(message),
    failed: isFailedStatus(status),
    raw: result || null
  };
}

export async function submitRunningHubTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const app = payload.app && typeof payload.app === "object" ? payload.app : {};
  const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
  const apiKey = String(payload.apiKey || "").trim();
  const appId = normalizeAppId(app.appId || payload.appId);

  if (!apiKey) throw new Error("RunningHub API Key is missing");
  if (!appId) throw new Error("RunningHub App ID is missing");

  const { nodeInfoList, nodeParams } = await buildSubmissionInputs(app, payload.inputs, apiKey, settings);
  const bodyCandidates = [
    { apiKey, webappId: appId, nodeInfoList },
    { apiKey, webAppId: appId, nodeInfoList },
    { apiKey, appId, nodeInfoList }
  ];

  console.log("[PixelRunner/RunningHub] submit task", {
    appId,
    appName: String(payload.appName || app.name || "").trim(),
    inputCount: Array.isArray(nodeInfoList) ? nodeInfoList.length : 0,
    legacyParamCount: Object.keys(nodeParams).length
  });

  let lastError = null;
  for (const body of bodyCandidates) {
    try {
      console.log("[PixelRunner/RunningHub] submit body variant", Object.keys(body));
      const result = await fetchJsonWithTimeout(
        "https://www.runninghub.cn/task/openapi/ai-app/run",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        },
        Math.max(5000, Number(settings.timeout || 180) * 1000)
      );

      const taskId = parseTaskId(result);

      if (!taskId) {
        throw new Error((result && (result.message || result.msg)) || "Task created but taskId missing");
      }

      return { ok: true, taskId: String(taskId), result };
    } catch (error) {
      console.warn("[PixelRunner/RunningHub] ai-app/run failed", {
        variant: Object.keys(body).join(","),
        message: error && error.message ? error.message : String(error || "")
      });
      lastError = error;
      if (body.webappId && error && error.message && !isParameterShapeError(error.message)) {
        throw error;
      }
    }
  }

  if (Object.keys(nodeParams).length > 0) {
    const legacyBody = { apiKey, workflowId: appId, nodeParams };
    try {
      console.log("[PixelRunner/RunningHub] fallback legacy submit", {
        workflowId: appId,
        paramCount: Object.keys(nodeParams).length
      });
      const result = await fetchJsonWithTimeout(
        "https://www.runninghub.cn/task/openapi/create",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(legacyBody)
        },
        Math.max(5000, Number(settings.timeout || 180) * 1000)
      );

      const taskId = parseTaskId(result);
      if (!taskId) {
        throw new Error((result && (result.message || result.msg)) || "Legacy task created but taskId missing");
      }

      return { ok: true, taskId: String(taskId), result, mode: "legacy" };
    } catch (error) {
      console.warn("[PixelRunner/RunningHub] legacy submit failed", {
        message: error && error.message ? error.message : String(error || "")
      });
      lastError = error;
    }
  }

  throw lastError || new Error("RunningHub task submission failed");
}

export async function fetchRunningHubAccountStatus(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || "").trim();
  if (!apiKey) {
    return { ok: false, balance: null, coins: null };
  }

  const result = await fetchJsonWithTimeout("https://www.runninghub.cn/uc/openapi/accountStatus", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ apikey: apiKey })
  });

  const data = (result && (result.data || result.result)) || {};
  const account = data && data.accountStatus && typeof data.accountStatus === "object" ? data.accountStatus : data;
  return {
    ok: true,
    balance: account.remainMoney ?? account.balance ?? account.amount ?? account.walletBalance ?? account.money ?? null,
    coins: account.remainCoins ?? account.coins ?? account.rhCoins ?? account.integral ?? null,
    result
  };
}

export async function pollRunningHubTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || "").trim();
  const taskId = String(payload.taskId || "").trim();
  const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};

  if (!apiKey) throw new Error("RunningHub API Key is missing");
  if (!taskId) throw new Error("RunningHub taskId is missing");

  const pollIntervalMs = Math.max(1, Number(settings.pollInterval) || 2) * 1000;
  const timeoutMs = Math.max(10, Number(settings.timeout) || 180) * 1000;
  const startedAt = Date.now();
  const localController = typeof AbortController !== "undefined" ? new AbortController() : null;
  runninghubTaskControllers.set(taskId, localController);

  try {
    while (Date.now() - startedAt < timeoutMs) {
      if (localController && localController.signal.aborted) {
        throw new Error("Task polling cancelled");
      }

      try {
        const snapshot = await fetchTaskOutputsSnapshot(apiKey, taskId, {
          signal: localController ? localController.signal : undefined,
          timeoutMs: 30000
        });
        const result = snapshot.result;
        if (!snapshot.ok) {
          const message =
            (result && (result.message || result.msg || result.error)) ||
            `Request failed (HTTP ${snapshot.status})`;
          throw new Error(String(message));
        }

        const payloadData = (result && (result.data || result.result)) || result;
        const outputUrl = extractOutputUrl(payloadData);
        if (outputUrl) {
          const balanceCharge = extractTaskBalanceCharge(payloadData || result);
          const coinsCharge = extractTaskCoinsCharge(payloadData || result);
          return {
            ok: true,
            taskId,
            status: "SUCCEEDED",
            outputUrl,
            charge: balanceCharge,
            balanceCharge,
            coinsCharge,
            chargeDisplay: formatTaskChargeDisplay(balanceCharge, coinsCharge),
            result
          };
        }

        const status = extractTaskStatus(payloadData);
        if (isFailedStatus(status)) {
          const failedStatus = buildTaskStatusResponse(taskId, snapshot, `Task failed (${status})`);
          return {
            ok: false,
            taskId,
            failed: true,
            status: failedStatus.status || status || "FAILED",
            outputUrl: "",
            charge: failedStatus.charge,
            chargeDisplay: failedStatus.chargeDisplay,
            message: failedStatus.message || `Task failed (${status})`,
            result
          };
        }

        if (!isPendingStatus(status) && !isPendingMessage(result && (result.message || result.msg))) {
          throw new Error((result && (result.message || result.msg)) || "Unknown task status");
        }
      } catch (error) {
        if (localController && localController.signal.aborted) {
          throw new Error("Task polling cancelled");
        }
        if (!isPendingMessage(error && error.message) && !isAbortLikeMessage(error && error.message)) {
          throw error;
        }
      }

      await sleep(pollIntervalMs);
    }
    const timeoutSnapshot = await fetchTaskOutputsSnapshot(apiKey, taskId, {
      signal: localController ? localController.signal : undefined,
      timeoutMs: 30000
    });
    const timeoutStatus = buildTaskStatusResponse(taskId, timeoutSnapshot, "Task polling timed out");
    if (timeoutStatus.outputUrl) {
      return {
        ok: true,
        taskId,
        status: "SUCCEEDED",
        outputUrl: timeoutStatus.outputUrl,
        result: timeoutSnapshot.result
      };
    }
    return {
      ok: false,
      taskId,
      timedOut: true,
      status: timeoutStatus.status || "TIMEOUT",
      stillRunning: timeoutStatus.stillRunning,
      failed: timeoutStatus.failed,
      outputUrl: "",
      message:
        timeoutStatus.message ||
        (timeoutStatus.stillRunning
          ? "Task polling timed out, but RunningHub still reports the task as running."
          : "Task polling timed out before RunningHub returned a terminal result."),
      result: timeoutSnapshot.result || null
    };
  } finally {
    runninghubTaskControllers.delete(taskId);
  }
}

export async function fetchRunningHubTaskStatus(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || "").trim();
  const taskId = String(payload.taskId || "").trim();

  if (!apiKey) throw new Error("RunningHub API Key is missing");
  if (!taskId) throw new Error("RunningHub taskId is missing");

  const snapshot = await fetchTaskOutputsSnapshot(apiKey, taskId, {
    timeoutMs: Math.max(5000, Number(payload.timeoutMs) || 30000)
  });
  return buildTaskStatusResponse(taskId, snapshot);
}

export async function cancelRunningHubTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || "").trim();
  const taskId = String(payload.taskId || "").trim();

  if (!apiKey) throw new Error("RunningHub API Key is missing");
  if (!taskId) throw new Error("RunningHub taskId is missing");

  const controller = runninghubTaskControllers.get(taskId);
  if (controller && typeof controller.abort === "function") {
    try {
      controller.abort();
    } catch (_) {}
  }

  const result = await fetchJsonWithTimeout("https://www.runninghub.cn/task/openapi/cancel", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ apiKey, taskId })
  });

  return { ok: true, taskId, result };
}
