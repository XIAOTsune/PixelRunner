import { parseRunningHubApp } from "./runninghub-parser.js";
import { getRunningHubRegionConfig, resolveRunningHubRegion } from "./runninghub-region.js";
import { getRunningHubSafeError, normalizeRunningHubErrorCode, getRunningHubErrorHint, isRunningHubPendingErrorCode } from "../shared/runninghub-error-hints.js";

import { extractRunningHubTaskCostTime } from "../shared/runninghub-progress.js";
import { observeRunningHubProgress, stopRunningHubProgress } from "./runninghub-progress.js";

const runninghubTaskControllers = new Map();
const SAFE_EMPTY_IMAGE_PLACEHOLDER = {
  dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACISURBVHhe7dChAQAwDITAjP6bt54VQJxBctue2THYNIDBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYNIDBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYNIDBpgEMNg1gsGkAg00DGGwawGDTAAabBjDYNIDBpgEMNg1gsGkAg00DGGwawGDTAAabD4jT8konzddhAAAAAElFTkSuQmCC",
  mimeType: "image/png",
  width: 64,
  height: 64
};

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

function getImageInputEmptyBehavior(input) {
  return String((input && (input.emptyBehavior || input.emptyBehaviour || input.emptyPolicy || input.onEmpty)) || "")
    .trim()
    .toLowerCase();
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
  const { baseUrl } = getRunningHubRegionConfig(resolveRunningHubRegion({ settings }));
  const endpoints = [
    `${baseUrl}/openapi/v2/media/upload/binary`,
    `${baseUrl}/uc/openapi/upload`
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
      throw createRunningHubApiError((result && (result.message || result.msg)) || "Upload succeeded but no usable file token/url", extractTaskErrorCode(result));
    } catch (error) {
      console.warn("[PixelRunner/RunningHub] image upload failed", {
        endpoint,
        message: getRunningHubSafeError(error?.message, error?.errorCode).message
      });
      lastError = error;
    }
  }

  throw lastError || new Error("Image upload failed");
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
  const uploadedImageValues = new Map();
  const normalizedValues = {};
  const nodeInfoList = [];
  const nodeParams = {};
  let safePlaceholderImageValue = "";

  async function normalizeImageSubmission(input, rawValue, key) {
    const imageSubmission = classifyImageSubmissionValue(rawValue);
    if (imageSubmission.mode === "empty") return "";
    if (imageSubmission.mode === "upload") {
      try {
        return await uploadImageValue(apiKey, imageSubmission.value, settings);
      } catch (error) {
        console.warn("[PixelRunner/RunningHub] image upload classification failed", {
          mode: imageSubmission.mode,
          message: getRunningHubSafeError(error?.message, error?.errorCode).message
        });
        throw error;
      }
    }
    return imageSubmission.value;
  }

  async function getSafePlaceholderImageValue() {
    if (safePlaceholderImageValue) return safePlaceholderImageValue;
    safePlaceholderImageValue = await uploadImageValue(apiKey, SAFE_EMPTY_IMAGE_PLACEHOLDER, settings);
    return safePlaceholderImageValue;
  }

  function shouldUseSafePlaceholder(input, imageRequiresValue) {
    if (imageRequiresValue) return false;
    return getImageInputEmptyBehavior(input) !== "skip";
  }

  function pushImagePayload(input, key, normalizedValue) {
    normalizedValues[key] = normalizedValue;
    nodeParams[key] = normalizedValue;
    const fieldName = String((input && (input.fieldName || input.name)) || "").trim();
    if (fieldName && !(fieldName in nodeParams)) nodeParams[fieldName] = normalizedValue;
    nodeInfoList.push({
      nodeId: input && input.nodeId ? input.nodeId : key,
      fieldName: String((input && (input.fieldName || input.key || input.name)) || key).trim(),
      fieldValue: normalizedValue,
      ...(input && input.fieldType ? { fieldType: input.fieldType } : {})
    });
  }

  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const key = String((input && input.key) || "").trim() || `param_${index + 1}`;
    const rawValue = values[key];
    const isImageInput = isImageLikeInput(input);
    const imageEmptyBehavior = isImageInput ? getImageInputEmptyBehavior(input) : "";
    const imageRequiresValue = Boolean(input && input.required) || imageEmptyBehavior === "require";
    if (!isFilledInputValue(rawValue)) {
      if (isImageInput && !imageRequiresValue) {
        if (shouldUseSafePlaceholder(input, imageRequiresValue)) {
          const placeholderImageValue = await getSafePlaceholderImageValue();
          if (placeholderImageValue) {
            pushImagePayload(input, key, placeholderImageValue);
            console.log("[PixelRunner/RunningHub] optional image empty, using safe placeholder", {
              size: "64x64"
            });
            continue;
          }
        }

        console.log("[PixelRunner/RunningHub] optional image empty, skipping field");
        continue;
      }
      if (imageRequiresValue && typeof rawValue !== "boolean") {
        throw new Error(`Missing required input: ${input.label || input.name || key}`);
      }
      continue;
    }

    let normalizedValue = rawValue;
    if (isImageInput) {
      const imageSubmission = classifyImageSubmissionValue(rawValue);
      if (imageSubmission.mode === "empty") {
        if (imageRequiresValue) {
          throw new Error(`Missing required input: ${input.label || input.name || key}`);
        }
        const placeholderImageValue = shouldUseSafePlaceholder(input, imageRequiresValue)
          ? await getSafePlaceholderImageValue()
          : "";
        if (placeholderImageValue) {
          normalizedValue = placeholderImageValue;
          console.log("[PixelRunner/RunningHub] optional image normalized to safe placeholder", {
            size: "64x64"
          });
        } else continue;
      } else if (imageSubmission.mode === "upload") {
        normalizedValue = uploadedImageValues.has(key)
          ? uploadedImageValues.get(key)
          : await normalizeImageSubmission(input, rawValue, key);
        uploadedImageValues.set(key, normalizedValue);
      } else {
        normalizedValue = imageSubmission.value;
        uploadedImageValues.set(key, normalizedValue);
      }
      console.log("[PixelRunner/RunningHub] image uploaded", {
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
      const errorCode = extractTaskErrorCode(result);
      const errorMessage =
        extractBestFailureMessageText(result) ||
        (result && (result.message || result.msg || result.error)) ||
        `Request failed (HTTP ${response.status})`;
      const message = normalizeCloudFailureMessage(
        errorMessage,
        { provider: "RunningHub", httpStatus: response.status, errorCode }
      );
      const error = new Error(String(message));
      error.errorCode = normalizeRunningHubErrorCode(errorCode);
      error.errorMessage = message;
      error.parameterShape = isParameterShapeError(errorMessage);
      throw error;
    }

    return result;
  } catch (error) {
    if (error?.errorMessage) throw error;
    throw createRunningHubApiError(error?.message, error?.errorCode);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isTransientHttpStatus(status) {
  const code = Number(status) || 0;
  return code === 0 || code === 408 || code === 409 || code === 425 || code === 429 || code >= 500;
}

function isTransientNetworkErrorMessage(message) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes("abort") ||
    text.includes("aborted") ||
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("network") ||
    text.includes("fetch failed") ||
    text.includes("failed to fetch") ||
    text.includes("load failed") ||
    text.includes("econnreset") ||
    text.includes("enotfound") ||
    text.includes("etimedout") ||
    text.includes("socket") ||
    text.includes("temporarily unavailable")
  );
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

function getTaskChargeComponent(key) {
  if (key.startsWith("thirdparty")) return "third-party";
  if (key.startsWith("model")) return "model";
  return "task";
}

function collectTaskChargeValuesByComponent(payload, keys = [], out = new Map()) {
  collectCandidateValues(
    payload,
    (key, value) => {
      const normalized = String(key || "").trim().toLowerCase();
      if (!keys.includes(normalized)) return false;
      const parsed = parseChargeValue(value);
      if (parsed === null) return false;
      const component = getTaskChargeComponent(normalized);
      const current = out.get(component);
      const nextValue = Math.abs(parsed);
      out.set(component, current === undefined ? nextValue : Math.max(current, nextValue));
      return false;
    }
  );
  return out;
}

function extractTaskChargeByKeys(payload, keys = []) {
  // RunningHub repeats task-level charge fields on output items. Deduplicate each
  // semantic component across the full response, including nested result arrays.
  const valuesByComponent = collectTaskChargeValuesByComponent(payload, keys);
  if (valuesByComponent.size === 0) return null;
  const total = Array.from(valuesByComponent.values()).reduce((sum, value) => sum + value, 0);
  return Number(total.toFixed(3));
}

export function extractTaskBalanceCharge(payload) {
  return extractTaskChargeByKeys(payload, [
    "consume",
    "consumefee",
    "consumemoney",
    "thirdpartyconsume",
    "thirdpartyconsumefee",
    "thirdpartyconsumemoney",
    "thirdpartydeduct",
    "thirdpartydeductfee",
    "thirdpartydeductmoney",
    "thirdpartycost",
    "thirdpartymoneycost",
    "thirdpartyfee",
    "thirdpartycharge",
    "modelconsume",
    "modelconsumefee",
    "modelconsumemoney",
    "modelcost",
    "modelmoneycost",
    "modelfee",
    "modelcharge",
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

export function extractTaskCoinsCharge(payload) {
  return extractTaskChargeByKeys(payload, [
    "consumecoins",
    "thirdpartyconsumecoins",
    "thirdpartydeductcoins",
    "thirdpartyusedcoins",
    "thirdpartyspentcoins",
    "thirdpartycoinscost",
    "thirdpartycoincost",
    "thirdpartycoincharge",
    "thirdpartyconsumerhcoins",
    "thirdpartydeductrhcoins",
    "thirdpartyusedrhcoins",
    "thirdpartyspentrhcoins",
    "thirdpartyintegralcost",
    "thirdpartyintegralcharge",
    "modelconsumecoins",
    "modeldeductcoins",
    "modelusedcoins",
    "modelspentcoins",
    "modelcoinscost",
    "modelcoincost",
    "modelcoincharge",
    "modelconsumerhcoins",
    "modeldeductrhcoins",
    "modelusedrhcoins",
    "modelspentrhcoins",
    "modelintegralcost",
    "modelintegralcharge",
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

function isPointSettlement(usage) {
  const mode = String(usage && usage.settleMode || "").trim().toUpperCase();
  return !mode || mode === "POINT";
}

function findAggregatePointUsage(payload, depth = 0, seen = new Set()) {
  if (!payload || typeof payload !== "object" || depth > 6 || seen.has(payload)) return null;
  seen.add(payload);
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findAggregatePointUsage(item, depth + 1, seen);
      if (found) return found;
    }
    return null;
  }
  if (payload.usage && typeof payload.usage === "object" && !Array.isArray(payload.usage) &&
      Object.prototype.hasOwnProperty.call(payload.usage, "chargedPoint") && isPointSettlement(payload.usage)) {
    return payload.usage;
  }
  for (const [key, value] of Object.entries(payload)) {
    if (key === "taskUsageList") continue;
    const found = findAggregatePointUsage(value, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

function findTaskUsageLists(payload, output = [], seen = new Set(), depth = 0) {
  if (!payload || typeof payload !== "object" || depth > 6 || seen.has(payload)) return output;
  seen.add(payload);
  if (Array.isArray(payload)) {
    payload.forEach((item) => findTaskUsageLists(item, output, seen, depth + 1));
    return output;
  }
  if (Array.isArray(payload.taskUsageList)) output.push(payload.taskUsageList);
  Object.entries(payload).forEach(([key, value]) => {
    if (key !== "taskUsageList") findTaskUsageLists(value, output, seen, depth + 1);
  });
  return output;
}

function collectDirectPointCharges(payload, values = [], seen = new Set(), depth = 0) {
  if (!payload || typeof payload !== "object" || depth > 6 || seen.has(payload)) return values;
  seen.add(payload);
  if (Array.isArray(payload)) {
    payload.forEach((item) => collectDirectPointCharges(item, values, seen, depth + 1));
    return values;
  }
  const settleMode = String(payload.settleMode || "").trim().toUpperCase();
  if (settleMode === "POINT" && Object.prototype.hasOwnProperty.call(payload, "chargedPoint")) {
    const charge = parseChargeValue(payload.chargedPoint);
    if (charge !== null) values.push(Math.abs(charge));
  }
  Object.entries(payload).forEach(([key, value]) => {
    if (key !== "usage" && key !== "taskUsageList") collectDirectPointCharges(value, values, seen, depth + 1);
  });
  return values;
}

export function extractTaskPointsCharge(payload) {
  const aggregateUsage = findAggregatePointUsage(payload);
  if (aggregateUsage) {
    const aggregate = parseChargeValue(aggregateUsage.chargedPoint);
    if (aggregate !== null) return aggregate;
  }

  const lists = findTaskUsageLists(payload);
  const seenLists = new Set();
  const seenTaskIds = new Set();
  let total = 0;
  let found = false;
  lists.forEach((list) => {
    const signature = JSON.stringify(list);
    if (seenLists.has(signature)) return;
    seenLists.add(signature);
    list.forEach((entry, index) => {
      const usage = entry && entry.usage && typeof entry.usage === "object" ? entry.usage : entry;
      if (!usage || typeof usage !== "object" || !isPointSettlement(usage)) return;
      const value = parseChargeValue(usage.chargedPoint);
      if (value === null) return;
      const taskId = String(entry.taskId || entry.id || "").trim();
      const key = taskId ? `${taskId}:${value}` : `${signature}:${index}`;
      if (seenTaskIds.has(key)) return;
      seenTaskIds.add(key);
      total += Math.abs(value);
      found = true;
    });
  });
  if (found) return Number(total.toFixed(3));

  // The V1 outputs endpoint places the task settlement directly on each output;
  // repeated output rows represent the same task charge, so use one value only.
  const directCharges = collectDirectPointCharges(payload);
  return directCharges.length > 0 ? Number(Math.max(...directCharges).toFixed(3)) : null;
}

function hasPointSettlement(payload, depth = 0, seen = new Set()) {
  if (!payload || typeof payload !== "object" || depth > 6 || seen.has(payload)) return false;
  seen.add(payload);
  if (Array.isArray(payload)) return payload.some((item) => hasPointSettlement(item, depth + 1, seen));
  if (String(payload.settleMode || "").trim().toUpperCase() === "POINT" &&
      Object.prototype.hasOwnProperty.call(payload, "chargedPoint")) return true;
  if (payload.usage && typeof payload.usage === "object" && isPointSettlement(payload.usage)) return true;
  return Object.values(payload).some((value) => hasPointSettlement(value, depth + 1, seen));
}

function formatBalanceChargeDisplay(charge, region = "cn") {
  const parsed = parseChargeValue(charge);
  if (parsed === null) return "";
  if (resolveRunningHubRegion({ region }) === "global") return `-$${parsed.toFixed(3)}`;
  return `-${parsed.toFixed(3)}R`;
}

function formatCoinsChargeDisplay(charge) {
  const parsed = parseChargeValue(charge);
  if (parsed === null) return "";
  return Number.isInteger(parsed) ? `-${parsed}RH` : `-${parsed.toFixed(3)}RH`;
}

function formatPointsChargeDisplay(charge) {
  const parsed = parseChargeValue(charge);
  if (parsed === null) return "";
  const amount = parsed.toFixed(3).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
  return `-${amount} 积分`;
}

export function formatTaskChargeDisplay(balanceCharge, coinsCharge, region = "cn", pointsCharge = null) {
  const pointsText = formatPointsChargeDisplay(pointsCharge);
  if (pointsText) return pointsText;
  const parts = [];
  const balanceText = formatBalanceChargeDisplay(balanceCharge, region);
  if (balanceText) parts.push(balanceText);
  return parts.join(" · ");
}

const OUTPUT_URL_KEYS = [
  "fileUrl",
  "file_url",
  "url",
  "downloadUrl",
  "download_url",
  "imageUrl",
  "image_url",
  "resultUrl",
  "result_url",
  "outputUrl",
  "output_url",
  "originUrl",
  "origin_url",
  "ossUrl",
  "oss_url"
];

const OUTPUT_NESTED_KEYS = [
  "outputs",
  "output",
  "data",
  "result",
  "results",
  "list",
  "items",
  "files",
  "fileList",
  "images",
  "imageList",
  "nodeOutputs",
  "nodeOutputList"
];

function parseNestedOutputJson(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 500000 || !["{", "["].includes(text[0])) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function scoreOutputUrlCandidate(url, source = {}, key = "") {
  const marker = [
    key,
    source.fileType,
    source.file_type,
    source.mimeType,
    source.mime_type,
    source.mediaType,
    source.outputType,
    source.output_type,
    source.type,
    source.format,
    source.fileName,
    source.file_name,
    source.filename,
    source.name
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  const normalizedUrl = String(url || "").toLowerCase();
  let score = 0;
  if (/image|\b(?:png|jpe?g|webp|gif|bmp|tiff?|avif|heic)\b/.test(marker)) score += 120;
  if (/\.(?:png|jpe?g|webp|gif|bmp|tiff?|avif|heic)(?:[?#]|$)/i.test(normalizedUrl)) score += 100;
  if (/imageurl|image_url/.test(String(key || "").toLowerCase())) score += 60;
  if (/video|audio|text|json|zip|archive|\b(?:mp4|mov|webm|mp3|wav|txt|json|zip)\b/.test(marker)) score -= 100;
  if (/\.(?:mp4|mov|webm|mp3|wav|txt|json|zip)(?:[?#]|$)/i.test(normalizedUrl)) score -= 80;
  return score;
}

function collectOutputUrlCandidates(payload, depth = 0, seen = new Set(), candidates = []) {
  if (!payload || depth > 8) return candidates;
  if (typeof payload === "string") {
    const text = payload.trim();
    if (/^https?:\/\//i.test(text)) {
      candidates.push({ url: text, score: scoreOutputUrlCandidate(text), order: candidates.length });
      return candidates;
    }
    const parsed = parseNestedOutputJson(text);
    if (parsed) collectOutputUrlCandidates(parsed, depth + 1, seen, candidates);
    return candidates;
  }
  if (typeof payload !== "object" || seen.has(payload)) return candidates;
  seen.add(payload);

  if (Array.isArray(payload)) {
    payload.forEach((item) => collectOutputUrlCandidates(item, depth + 1, seen, candidates));
    return candidates;
  }

  OUTPUT_URL_KEYS.forEach((key) => {
    const value = payload[key];
    if (typeof value !== "string") return;
    const url = value.trim();
    if (!/^https?:\/\//i.test(url)) return;
    candidates.push({
      url,
      score: scoreOutputUrlCandidate(url, payload, key),
      order: candidates.length
    });
  });
  OUTPUT_NESTED_KEYS.forEach((key) => {
    collectOutputUrlCandidates(payload[key], depth + 1, seen, candidates);
  });
  return candidates;
}

export function extractOutputUrl(payload) {
  const candidates = collectOutputUrlCandidates(payload);
  if (candidates.length === 0) return "";
  candidates.sort((left, right) => right.score - left.score || left.order - right.order);
  return candidates[0].url;
}

export function extractReadyOutputUrl(payload) {
  const status = extractTaskStatus(payload);
  if (isPendingStatus(status) || isFailedStatus(status)) return "";
  return extractOutputUrl(payload);
}

function looksLikeTxtUrl(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return false;
  return /\.txt(?:[?#]|$)/i.test(text);
}

function looksLikeTxtName(value) {
  return /\.txt$/i.test(String(value || "").trim());
}

function collectTxtResultCandidates(payload, results = [], seen = new Set(), depth = 0) {
  if (payload == null || depth > 8) return results;

  if (typeof payload === "string") {
    if (looksLikeTxtUrl(payload) && !seen.has(payload)) {
      seen.add(payload);
      results.push({ url: payload, fileName: "" });
    }
    return results;
  }

  if (Array.isArray(payload)) {
    payload.forEach((item) => collectTxtResultCandidates(item, results, seen, depth + 1));
    return results;
  }

  if (typeof payload !== "object") return results;

  const source = payload;
  const fileName = String(
    source.fileName || source.filename || source.name || source.title || source.label || source.key || ""
  ).trim();
  const directUrl = String(
    source.url || source.fileUrl || source.downloadUrl || source.download_url || source.resultUrl || source.textUrl || ""
  ).trim();

  if (directUrl && (looksLikeTxtUrl(directUrl) || looksLikeTxtName(fileName))) {
    const marker = `${directUrl}|${fileName}`;
    if (!seen.has(marker)) {
      seen.add(marker);
      results.push({ url: directUrl, fileName });
    }
  }

  Object.values(source).forEach((value) => {
    if (value && typeof value === "object") {
      collectTxtResultCandidates(value, results, seen, depth + 1);
      return;
    }
    if (typeof value === "string" && looksLikeTxtUrl(value) && !seen.has(value)) {
      seen.add(value);
      results.push({ url: value, fileName });
    }
  });

  return results;
}

async function fetchTextWithTimeout(url, options = {}, timeoutMs = 30000) {
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
    if (!response.ok) {
      throw new Error(`Request failed (HTTP ${response.status})`);
    }
    return await response.text();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pickPreferredPromptInput(inputs) {
  const list = Array.isArray(inputs) ? inputs : [];
  const promptLike = list.filter((input) => {
    const hint = `${input && input.key ? input.key : ""} ${input && input.label ? input.label : ""} ${input && input.name ? input.name : ""}`.toLowerCase();
    return /prompt|positive/.test(hint) && !/negative/.test(hint);
  });
  if (promptLike.length === 0) return null;
  const priority = ["prompt", "positive_prompt"];
  for (const key of priority) {
    const matched = promptLike.find((input) => String(input && input.key || "").trim().toLowerCase() === key);
    if (matched) return matched;
  }
  return promptLike[0];
}

function pickPreferredTextInput(inputs) {
  const list = Array.isArray(inputs) ? inputs : [];
  const promptInput = pickPreferredPromptInput(list);
  if (promptInput) return promptInput;
  return list.find((input) => !isImageLikeInput(input)) || null;
}

function buildAiOptimizePromptText(payload = {}) {
  const sections = [];
  const basePrompt = String(payload.prompt || "").trim();
  const extraRequirement = String(payload.extraRequirement || "").trim();
  if (basePrompt) sections.push(`当前主 prompt：\n${basePrompt}`);
  if (extraRequirement) sections.push(`附加优化需求：\n${extraRequirement}`);
  return sections.join("\n\n");
}

async function runAiOptimizeInternal(payload = {}) {
  const apiKey = String(payload.apiKey || "").trim();
  const appId = normalizeAppId(payload.appId);
  const image = payload.image;
  const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
  const region = resolveRunningHubRegion(payload);
  if (!apiKey) throw new Error("RunningHub API Key is missing");
  if (!appId) throw new Error("AI optimize appId is missing");
  if (!image) throw new Error("AI optimize image is missing");

  const parsedApp = await parseRunningHubApp([{ appId, apiKey, preferredName: "AI优化", region }]);
  const inputs = Array.isArray(parsedApp && parsedApp.inputs) ? parsedApp.inputs : [];
  const imageInput = inputs.find((input) => isImageLikeInput(input));
  if (!imageInput) throw new Error("AI 优化应用未识别到图片输入项");
  const textInput = pickPreferredTextInput(inputs);
  if (!textInput) throw new Error("AI 优化应用未识别到可写入的提示词输入项");

  const submissionInputs = {};
  submissionInputs[imageInput.key] = image;
  submissionInputs[textInput.key] = buildAiOptimizePromptText(payload);

  const submitResult = await submitRunningHubTask([{
    apiKey,
    appId,
    appName: "AI优化",
    app: {
      id: `ai-optimize-${appId}`,
      appId,
      name: "AI优化",
      inputs
    },
    inputs: submissionInputs,
    region,
    settings
  }]);
  const taskId = String((submitResult && submitResult.taskId) || "").trim();
  const pollResult = await pollRunningHubTask([{ apiKey, taskId, region, settings }]);
  if (!pollResult || pollResult.failed) {
    throw new Error(String((pollResult && pollResult.message) || "AI 优化任务执行失败"));
  }
  if (pollResult.timedOut) {
    throw new Error(String((pollResult && pollResult.message) || "AI 优化任务超时"));
  }

  const txtCandidates = collectTxtResultCandidates((pollResult && pollResult.result) || null);
  const txtCandidate = txtCandidates[0] || null;
  if (!txtCandidate || !txtCandidate.url) {
    throw new Error("AI 优化应用未返回可解析的 .txt 文本结果，请检查工作流输出配置。");
  }

  const textContent = String(await fetchTextWithTimeout(txtCandidate.url, {}, Math.max(10000, Number(settings.timeout || 180) * 1000))).trim();
  if (!textContent) {
    throw new Error("AI 优化应用返回的 .txt 结果为空。");
  }

  return {
    ok: true,
    taskId,
    text: textContent,
    balanceCharge: pollResult?.balanceCharge ?? null,
    pointsCharge: pollResult?.pointsCharge ?? null,
    chargeDisplay: pollResult?.chargeDisplay ?? "",
    txtUrl: txtCandidate.url,
    txtFileName: txtCandidate.fileName || "",
    outputUrl: String((pollResult && pollResult.outputUrl) || "").trim(),
    taskCostTime: pollResult?.taskCostTime ?? null
  };
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
  return ["0", "PENDING", "RUNNING", "PROCESSING", "QUEUED", "QUEUE", "WAITING", "IN_PROGRESS", "CREATED", "SUBMITTED"].includes(String(status || "").toUpperCase());
}

function isSucceededStatus(status) {
  return ["1", "SUCCESS", "SUCCEEDED", "SUCCEED", "COMPLETED", "COMPLETE", "DONE", "FINISHED"].includes(String(status || "").toUpperCase());
}

function isFailedStatus(status) {
  return ["-1", "2", "FAIL", "FAILED", "FAILURE", "ERROR", "EXCEPTION", "CANCELLED", "CANCELED", "REJECTED", "TIMEOUT", "TIMED_OUT"].includes(String(status || "").toUpperCase());
}

function isPendingMessage(message) {
  const text = String(message || "").toLowerCase();
  return /(processing|pending|running|queue|wait|not finished|not completed|not ready|运行中|排队|处理中|等待中|未完成)/i.test(text);
}

function isFailureMessage(message) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return false;
  if (isPendingMessage(text)) return false;
  if (/\b(no|without)\s+error\b/.test(text)) return false;
  return /(fail|failed|failure|error|exception|cancelled|canceled|rejected|insufficient|forbidden|unauthorized|policy|safety|moderation|sensitive|blocked|violation|余额不足|欠费|失败|错误|异常|取消|违规|拒绝|审核|内容安全|安全策略|内容政策|敏感)/i.test(text);
}

function isGenericSuccessMessage(message) {
  const text = String(message || "").trim().toLowerCase();
  return ["success", "succeed", "succeeded", "ok", "done", "complete", "completed", "请求成功", "成功"].includes(text);
}

function compactFailureText(value, maxLength = 500) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(80, Number(maxLength) || 500));
}

function isGenericFailureMessage(message) {
  const text = compactFailureText(message, 160).toLowerCase().replace(/[。.!]+$/g, "");
  if (!text) return false;
  if (getTaskStatusErrorCode(text.toUpperCase())) return true;
  if (/返回任务状态异常|任务响应信息/.test(text)) return true;
  if (/^request failed(?: \(http \d+\))?$/.test(text)) return true;
  return [
    "api task error",
    "api error",
    "task failed",
    "task failure",
    "request failed",
    "failed",
    "failure",
    "error",
    "unknown error",
    "任务失败",
    "任务执行失败",
    "执行失败",
    "请求失败",
    "未知错误"
  ].includes(text);
}

function getTaskStatusErrorCode(message) {
  const text = String(message || "").toUpperCase();
  const match = text.match(/\b[A-Z0-9_]*TASK_STATUS_ERROR[A-Z0-9_]*\b/) || text.match(/\b[A-Z0-9_]*(?:STATUS|TASK)_ERROR[A-Z0-9_]*\b/);
  return match ? match[0] : "";
}

function normalizeCloudFailureMessage(message, options = {}) {
  return getRunningHubSafeError(message, options.errorCode ?? extractTaskErrorCode(options.raw), options.httpStatus).message;
}

function normalizeStatusValue(value) {
  if (value == null) return "";
  if (typeof value === "number") {
    if (value < 0) return "-1";
    if (value === 0) return "0";
    if (value === 1) return "1";
    if (value === 2) return "2";
  }
  const text = String(value).trim();
  if (!text) return "";
  return text.toUpperCase().replace(/[\s-]+/g, "_");
}

function findStatusValue(payload, depth = 0, seen = new Set()) {
  if (!payload || depth > 6 || typeof payload !== "object") return "";
  if (seen.has(payload)) return "";
  seen.add(payload);

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const status = findStatusValue(item, depth + 1, seen);
      if (status) return status;
    }
    return "";
  }

  const statusKeys = [
    "status",
    "state",
    "taskStatus",
    "task_status",
    "runStatus",
    "run_status",
    "executeStatus",
    "execute_status",
    "jobStatus",
    "job_status"
  ];
  for (const key of statusKeys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    const normalized = normalizeStatusValue(payload[key]);
    if (normalized) return normalized;
  }

  for (const key of ["data", "result", "results", "output", "outputs", "task", "job", "items", "list"]) {
    const status = findStatusValue(payload[key], depth + 1, seen);
    if (status) return status;
  }

  return "";
}

function extractTaskStatus(payload) {
  return findStatusValue(payload);
}

function getApiCode(payload) {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload.code ?? payload.statusCode ?? payload.errorCode ?? payload.errCode;
  if (raw === undefined || raw === null || raw === "") return null;
  const code = Number(raw);
  return Number.isFinite(code) ? code : null;
}

function extractTaskErrorCode(payload) {
  const explicit = [];
  const generic = [];
  const seen = new Set();
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    Object.entries(value).forEach(([key, item]) => {
      const normalized = key.replace(/[_-]/g, "").toLowerCase();
      if (["errorcode", "errcode"].includes(normalized)) explicit.push(item);
      else if (["code", "statuscode"].includes(normalized)) generic.push(item);
      if (["data", "result", "error"].includes(key) && item && typeof item === "object") visit(item, depth + 1);
    });
  };
  visit(payload);
  const candidates = [...explicit, ...generic];
  for (const candidate of candidates) {
    if (candidate == null || candidate === "") continue;
    if (typeof candidate === "number") return candidate === 0 || candidate === 200 ? null : candidate;
    const text = String(candidate).trim();
    if (!text || text === "0" || text === "200") continue;
    return /^\d+$/.test(text) ? Number(text) : text;
  }
  return null;
}

function createRunningHubApiError(message, errorCode, httpStatus = 0) {
  const errorMessage = String(message || "").trim();
  const normalizedMessage = normalizeCloudFailureMessage(errorMessage, { provider: "RunningHub", errorCode, httpStatus });
  const error = new Error(normalizedMessage);
  error.errorCode = normalizeRunningHubErrorCode(errorCode);
  error.errorMessage = normalizedMessage;
  error.parameterShape = isParameterShapeError(errorMessage);
  return error;
}

function extractMessageText(value, depth = 0, seen = new Set()) {
  if (value == null || depth > 6) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractMessageText(item, depth + 1, seen);
      if (text) return text;
    }
    return "";
  }

  for (const key of ["message", "msg", "error", "errors", "detail", "reason", "failureReason", "failure_reason", "errMsg", "errorMessage"]) {
    const item = value[key];
    if (typeof item === "string" && item.trim() && !isGenericSuccessMessage(item)) return item.trim();
    if (item && typeof item === "object") {
      const text = extractMessageText(item, depth + 1, seen);
      if (text) return text;
    }
  }

  for (const key of ["data", "result", "results", "output", "outputs", "task", "job", "items", "list"]) {
    const text = extractMessageText(value[key], depth + 1, seen);
    if (text) return text;
  }

  return "";
}

function collectFailureMessageTexts(value, depth = 0, seen = new Set(), output = []) {
  if (value == null || depth > 6) return output;
  if (typeof value === "string") {
    const text = compactFailureText(value);
    if (text && !isGenericSuccessMessage(text)) output.push(text);
    return output;
  }
  if (typeof value !== "object") return output;
  if (seen.has(value)) return output;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectFailureMessageTexts(item, depth + 1, seen, output);
    return output;
  }

  for (const key of [
    "failureReason",
    "failure_reason",
    "failReason",
    "fail_reason",
    "reason",
    "detail",
    "errorMessage",
    "errMsg",
    "message",
    "msg",
    "error",
    "errors",
    "cause",
    "description",
    "response",
    "taskResponse",
    "task_response",
    "responseInfo",
    "response_info",
    "taskResponseInfo",
    "task_response_info",
    "callbackResponse",
    "callback_response",
    "apiResponse",
    "api_response",
    "outputResponse",
    "output_response"
  ]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      collectFailureMessageTexts(value[key], depth + 1, seen, output);
    }
  }

  for (const key of ["data", "result", "results", "output", "outputs", "task", "job", "items", "list"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      collectFailureMessageTexts(value[key], depth + 1, seen, output);
    }
  }

  return output;
}

function extractBestFailureMessageText(value) {
  const messages = collectFailureMessageTexts(value)
    .map((item) => compactFailureText(item))
    .filter(Boolean);
  return messages.find((item) => !isGenericFailureMessage(item)) || messages[0] || "";
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

const runninghubTaskQueryVersions = new Map();

async function fetchTaskSnapshotRequest(apiKey, taskId, options = {}) {
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
    const { baseUrl } = getRunningHubRegionConfig(resolveRunningHubRegion(options));
    const response = await fetch(`${baseUrl}${options.pathname}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(options.includeApiKey ? { apiKey, taskId } : { taskId }),
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
  } catch (error) {
    const message = String(error && error.message ? error.message : error || "Task status request failed").trim();
    return {
      ok: false,
      status: 0,
      result: { message },
      errorMessage: message,
      transientError: true
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchTaskV2Snapshot(apiKey, taskId, options = {}) {
  return fetchTaskSnapshotRequest(apiKey, taskId, {
    ...options,
    pathname: "/openapi/v2/query",
    includeApiKey: false
  });
}

async function fetchTaskOutputsV1Snapshot(apiKey, taskId, options = {}) {
  return fetchTaskSnapshotRequest(apiKey, taskId, {
    ...options,
    pathname: "/task/openapi/outputs",
    includeApiKey: true
  });
}

function getTaskSnapshotPayload(snapshot) {
  const result = snapshot && snapshot.result;
  return (result && (result.data || result.result)) || result;
}

function classifyV2Fallback(snapshot) {
  const payload = getTaskSnapshotPayload(snapshot);
  if (isRunningHubPendingErrorCode(extractTaskErrorCode(snapshot?.result))) return "";
  const status = extractTaskStatus(payload);
  const outputUrl = extractOutputUrl(payload);
  if (outputUrl || isPendingStatus(status) || isFailedStatus(status)) return "";

  const httpStatus = Number(snapshot && snapshot.status) || 0;
  const result = snapshot && snapshot.result;
  const message = String(
    extractBestFailureMessageText(result) || extractMessageText(result) || ""
  ).trim();
  if ([405, 410, 501].includes(httpStatus)) return "unsupported";
  if (
    httpStatus === 404 &&
    /(?:endpoint|route|path|api).*(?:not found|unsupported|not support)|(?:not found|unsupported|not support).*(?:endpoint|route|path|api)|接口.*(?:不存在|未找到|不支持)/i.test(message)
  ) {
    return "unsupported";
  }
  const apiCode = getApiCode(result);
  if (
    !snapshot ||
    (!snapshot.ok && !isTransientHttpStatus(httpStatus)) ||
    (!status && apiCode !== null && apiCode !== 0 && apiCode !== 200)
  ) {
    return /not found|unsupported|not support|does not exist|不存在|未找到|不支持/i.test(message)
      ? "unsupported"
      : "api-error";
  }

  // A successful V2 status without results can occur while older tasks only expose V1 outputs.
  if (isSucceededStatus(status) || (!status && snapshot.ok)) return "missing-results";
  return "";
}

async function fetchTaskOutputsSnapshot(apiKey, taskId, options = {}) {
  const region = resolveRunningHubRegion(options);
  if (runninghubTaskQueryVersions.get(region) === "v1") {
    return fetchTaskOutputsV1Snapshot(apiKey, taskId, options);
  }

  const v2Snapshot = await fetchTaskV2Snapshot(apiKey, taskId, options);
  const fallbackReason = classifyV2Fallback(v2Snapshot);
  if (!fallbackReason) {
    runninghubTaskQueryVersions.set(region, "v2");
    const payload = getTaskSnapshotPayload(v2Snapshot);
    // Supplement only missing point settlement. Never replace confirmed V2
    // outputs or status with a delayed/failed compatibility response.
    if (isSucceededStatus(extractTaskStatus(payload)) && extractReadyOutputUrl(payload) &&
        extractTaskPointsCharge(v2Snapshot.result) === null) {
      try {
        const billingSnapshot = await fetchTaskOutputsV1Snapshot(apiKey, taskId, {
          ...options,
          timeoutMs: Math.min(10000, Number(options.timeoutMs) || 10000)
        });
        const billingPayload = getTaskSnapshotPayload(billingSnapshot);
        const billingStatus = extractTaskStatus(billingPayload);
        if (billingSnapshot.ok && (isSucceededStatus(billingStatus) ||
            (Array.isArray(billingPayload) && getApiCode(billingSnapshot.result) === 0))) {
          v2Snapshot.settlement = {
            balanceCharge: hasPointSettlement(billingPayload) ? null : extractTaskBalanceCharge(billingSnapshot.result),
            pointsCharge: extractTaskPointsCharge(billingSnapshot.result)
          };
        }
      } catch (_) {}
    }
    return v2Snapshot;
  }

  const v1Snapshot = await fetchTaskOutputsV1Snapshot(apiKey, taskId, options);
  const v1Payload = getTaskSnapshotPayload(v1Snapshot);
  const v1Recognized = Boolean(
    v1Snapshot && v1Snapshot.ok && (extractOutputUrl(v1Payload) || extractTaskStatus(v1Payload))
  );

  if (fallbackReason === "unsupported") {
    runninghubTaskQueryVersions.set(region, "v1");
    console.info("[PixelRunner/RunningHub] V2 task query unavailable; using V1 compatibility endpoint", {
      region,
      httpStatus: v2Snapshot && v2Snapshot.status
    });
  }

  if (v1Recognized || !v2Snapshot || !v2Snapshot.ok || fallbackReason !== "missing-results") {
    return v1Snapshot;
  }
  return v2Snapshot;
}

function buildTaskStatusResponse(taskId, snapshot, fallbackMessage = "", options = {}) {
  const result = snapshot && snapshot.result;
  const payloadData = (result && (result.data || result.result)) || result;
  const status = extractTaskStatus(payloadData);
  const restSucceeded = isSucceededStatus(status) || (Array.isArray(payloadData) && getApiCode(result) === 0);
  const outputUrl = restSucceeded ? extractReadyOutputUrl(payloadData) : "";
  const pointSettlement = hasPointSettlement(payloadData || result) || hasPointSettlement(snapshot?.settlement || {});
  const balanceCharge = pointSettlement ? null : extractTaskBalanceCharge(result) ?? snapshot?.settlement?.balanceCharge ?? null;
  const coinsCharge = null;
  const pointsCharge = extractTaskPointsCharge(result) ?? snapshot?.settlement?.pointsCharge ?? null;
  const errorCode = extractTaskErrorCode(result);
  const errorMessage = String(extractBestFailureMessageText(result) || extractMessageText(result) || "").trim();
  const rawMessage = String(
    errorMessage ||
    fallbackMessage ||
    (snapshot && !snapshot.ok ? `Request failed (HTTP ${snapshot.status})` : "")
  ).trim();
  const rootCode = getApiCode(result);
  const dataCode = getApiCode(payloadData);
  const hasFailureStatus = isFailedStatus(status);
  const hasSuccessStatus = isSucceededStatus(status);
  const errorHint = getRunningHubErrorHint(errorCode);
  const pendingErrorCode = isRunningHubPendingErrorCode(errorCode);
  const transientError =
    Boolean(snapshot && snapshot.transientError) ||
    Boolean(snapshot && !snapshot.ok && isTransientHttpStatus(snapshot.status)) ||
    isTransientNetworkErrorMessage(rawMessage);
  const failed = Boolean(
    (!pendingErrorCode && hasFailureStatus) ||
      (!transientError && isFailureMessage(rawMessage)) ||
      (snapshot && !snapshot.ok && !transientError) ||
      ((rootCode !== null || dataCode !== null) &&
        [rootCode, dataCode].some((code) => code !== null && code !== 0 && code !== 200) &&
        !hasSuccessStatus &&
        !transientError)
  );
  const resolvedFailed = pendingErrorCode ? false : failed;
  const message = resolvedFailed || errorHint
    ? normalizeCloudFailureMessage(rawMessage || fallbackMessage || status, {
        provider: "RunningHub",
        status,
        httpStatus: snapshot && snapshot.status,
        errorCode,
        raw: result
      })
    : "";
  const stillRunning = pendingErrorCode || (!resolvedFailed && (isPendingStatus(status) || isPendingMessage(rawMessage) || transientError));
  const queuedErrorCode = String(errorCode == null ? "" : errorCode).toUpperCase() === "813" ||
    String(errorCode == null ? "" : errorCode).toUpperCase() === "APIKEY_TASK_IS_QUEUED";
  const resolvedStatus = pendingErrorCode ? (queuedErrorCode ? "QUEUED" : "RUNNING")
    : isSucceededStatus(status) ? "SUCCESS"
    : isFailedStatus(status) ? "FAILED"
    : ["QUEUED", "QUEUE", "PENDING", "CREATE", "CREATED"].includes(status) ? "QUEUED"
    : ["RUNNING", "PROCESSING", "EXECUTING", "0"].includes(status) ? "RUNNING" : "";

  return {
    ok: Boolean(snapshot && snapshot.ok),
    taskId,
    status: resolvedStatus,
    outputUrl: resolvedFailed || pendingErrorCode ? "" : outputUrl,
    charge: balanceCharge,
    balanceCharge,
    coinsCharge,
    pointsCharge,
    chargeDisplay: formatTaskChargeDisplay(balanceCharge, coinsCharge, options.region, pointsCharge),
    message,
    errorCode: normalizeRunningHubErrorCode(errorCode),
    errorMessage: resolvedFailed || errorHint ? message : "",
    taskCostTime: outputUrl && !resolvedFailed ? extractRunningHubTaskCostTime(result) : null,
    stillRunning,
    failed: resolvedFailed,
    transientError
  };
}

export async function submitRunningHubTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const app = payload.app && typeof payload.app === "object" ? payload.app : {};
  const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
  const region = resolveRunningHubRegion(payload);
  const { baseUrl } = getRunningHubRegionConfig(region);
  settings.runningHubRegion = region;
  const apiKey = String(payload.apiKey || "").trim();
  const appId = normalizeAppId(app.appId || payload.appId);
  const instanceType = String(payload.instanceType || "").trim().toLowerCase() === "plus" ? "plus" : "";

  if (!apiKey) throw new Error("RunningHub API Key is missing");
  if (!appId) throw new Error("RunningHub App ID is missing");

  const { nodeInfoList, nodeParams } = await buildSubmissionInputs(app, payload.inputs, apiKey, settings);
  const bodyCandidates = [
    { apiKey, webappId: appId, nodeInfoList },
    { apiKey, webAppId: appId, nodeInfoList },
    { apiKey, appId, nodeInfoList }
  ].map((body) => (instanceType ? { ...body, instanceType } : body));

  console.log("[PixelRunner/RunningHub] submit task", {
    appId,
    appName: String(payload.appName || app.name || "").trim(),
    instanceType: instanceType || "default",
    inputCount: Array.isArray(nodeInfoList) ? nodeInfoList.length : 0,
    legacyParamCount: Object.keys(nodeParams).length
  });

  let lastError = null;
  for (const body of bodyCandidates) {
    try {
      console.log("[PixelRunner/RunningHub] submit body variant", Object.keys(body));
      const result = await fetchJsonWithTimeout(
        `${baseUrl}/task/openapi/ai-app/run`,
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
        const errorMessage = extractBestFailureMessageText(result) || (result && (result.message || result.msg)) || "Task created but taskId missing";
        throw createRunningHubApiError(
          errorMessage,
          extractTaskErrorCode(result)
        );
      }

      observeRunningHubProgress(String(taskId), region, result, submissionPhase(result));
      return { ok: true, taskId: String(taskId), region, status: submissionPhase(result) };
    } catch (error) {
      console.warn("[PixelRunner/RunningHub] ai-app/run failed", {
        variant: Object.keys(body).join(","),
        message: getRunningHubSafeError(error?.message, error?.errorCode).message
      });
      lastError = error;
      if (body.webappId && error && error.message && !error.parameterShape) {
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
        `${baseUrl}/task/openapi/create`,
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
        throw new Error(
          normalizeCloudFailureMessage(
            extractBestFailureMessageText(result) || (result && (result.message || result.msg)) || "Legacy task created but taskId missing",
            { provider: "RunningHub" }
          )
        );
      }

      observeRunningHubProgress(String(taskId), region, result, submissionPhase(result));
      return { ok: true, taskId: String(taskId), region, status: submissionPhase(result), mode: "legacy" };
    } catch (error) {
      console.warn("[PixelRunner/RunningHub] legacy submit failed", {
        message: getRunningHubSafeError(error?.message, error?.errorCode).message
      });
      lastError = error;
    }
  }

  throw lastError || new Error("RunningHub task submission failed");
}

export async function fetchRunningHubAccountStatus(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || "").trim();
  const region = resolveRunningHubRegion(payload);
  const { baseUrl } = getRunningHubRegionConfig(region);
  if (!apiKey) {
    return { ok: false, balance: null, points: null };
  }

  const result = await fetchJsonWithTimeout(`${baseUrl}/uc/openapi/accountStatus`, {
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
    region,
    balance: account.remainMoney ?? account.balance ?? account.amount ?? account.walletBalance ?? account.money ?? null,
    points: account.remainPoint ?? null,
    currency: String(account.currency || (region === "global" ? "USD" : "R")).trim(),
    result
  };
}

function submissionPhase(result) {
  const status = extractTaskStatus(result);
  return ["RUNNING", "EXECUTING", "PROCESSING"].includes(status) ? "running" : "queued";
}

function updateTaskProgress(taskId, region, snapshot, status) {
  if (status.failed || status.outputUrl) {
    stopRunningHubProgress(taskId, region);
  } else {
    const phase = ["QUEUED", "QUEUE", "PENDING", "CREATE", "CREATED"].includes(status.status) ? "queued"
      : ["RUNNING", "EXECUTING", "PROCESSING"].includes(status.status) ? "running" : "";
    observeRunningHubProgress(taskId, region, snapshot.result, phase);
  }
}

export async function pollRunningHubTask(args = []) {
  const payload = args[0] || {};
  const apiKey = String(payload.apiKey || "").trim();
  const taskId = String(payload.taskId || "").trim();
  const settings = payload.settings || {};
  const region = resolveRunningHubRegion(payload);
  if (!apiKey) throw new Error("RunningHub API Key is missing");
  if (!taskId) throw new Error("RunningHub taskId is missing");
  const interval = Math.max(1, Number(settings.pollInterval) || 2) * 1000;
  const timeout = Math.max(10, Number(settings.timeout) || 180) * 1000;
  const started = Date.now();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const key = `${region}:${taskId}`;
  runninghubTaskControllers.set(key, controller);
  try {
    while (true) {
      if (controller?.signal.aborted) throw new Error("Task polling cancelled");
      const snapshot = await fetchTaskOutputsSnapshot(apiKey, taskId, { region, signal: controller?.signal, timeoutMs: 30000 });
      if (controller?.signal.aborted) throw new Error("Task polling cancelled");
      const status = buildTaskStatusResponse(taskId, snapshot, "", { region });
      updateTaskProgress(taskId, region, snapshot, status);
      if (status.outputUrl && !status.failed) {
        // AI optimization consumes text-result URLs, never the original response.
        const results = collectTxtResultCandidates(snapshot.result).map(item => ({ url: item.url }));
        return { ...status, ok: true, status: "SUCCEEDED", result: { results } };
      }
      if (status.failed) return { ...status, ok: false };
      if (Date.now() - started >= timeout) return { ...status, ok: false, timedOut: true };
      await sleep(interval);
    }
  } finally {
    runninghubTaskControllers.delete(key);
    if (controller?.signal.aborted) stopRunningHubProgress(taskId, region);
  }
}

export async function fetchRunningHubTaskStatus(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || "").trim();
  const taskId = String(payload.taskId || "").trim();
  const region = resolveRunningHubRegion(payload);

  if (!apiKey) throw new Error("RunningHub API Key is missing");
  if (!taskId) throw new Error("RunningHub taskId is missing");

  const snapshot = await fetchTaskOutputsSnapshot(apiKey, taskId, {
    region,
    timeoutMs: Math.max(5000, Number(payload.timeoutMs) || 30000)
  });
  const status = buildTaskStatusResponse(taskId, snapshot, "", { region });
  updateTaskProgress(taskId, region, snapshot, status);
  return status;
}

export async function cancelRunningHubTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || "").trim();
  const taskId = String(payload.taskId || "").trim();
  const region = resolveRunningHubRegion(payload);
  const { baseUrl } = getRunningHubRegionConfig(region);

  if (!apiKey) throw new Error("RunningHub API Key is missing");
  if (!taskId) throw new Error("RunningHub taskId is missing");

  stopRunningHubProgress(taskId, region);
  const controller = runninghubTaskControllers.get(`${region}:${taskId}`);
  if (controller && typeof controller.abort === "function") {
    try {
      controller.abort();
    } catch (_) {}
  }

  await fetchJsonWithTimeout(`${baseUrl}/task/openapi/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ apiKey, taskId })
  });

  return { ok: true, taskId, region };
}

export async function runAiOptimizeTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  return runAiOptimizeInternal(payload);
}
