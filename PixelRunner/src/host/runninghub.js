import { parseRunningHubApp } from "./runninghub-parser.js";

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

function getImageInputMarker(input) {
  return `${(input && input.key) || ""} ${(input && input.label) || ""} ${(input && input.name) || ""} ${(input && input.fieldName) || ""}`
    .toLowerCase();
}

function isMainImageInput(input) {
  return /(主图|主输入|原图|底图|主体图|main|primary|source|base)/i.test(getImageInputMarker(input));
}

function getImageInputPrimaryScore(input, index = 0) {
  const marker = getImageInputMarker(input);
  let score = 0;
  if (isMainImageInput(input)) score += 80;
  if (/(参考|副图|辅图|风格图|遮罩|控制图|ref|reference|style|mask|control|pose|depth|edge)/i.test(marker)) score -= 40;
  if (input && input.required) score += 8;
  return score - index * 0.01;
}

function findPrimaryImageInput(inputs, values) {
  const imageInputs = (Array.isArray(inputs) ? inputs : []).filter(isImageLikeInput);
  const mainInputs = imageInputs.filter(isMainImageInput);
  const sourceInputs = mainInputs.length ? mainInputs : imageInputs;
  const ranked = sourceInputs
    .map((input, index) => ({
      input,
      index,
      key: String((input && input.key) || "").trim() || `param_${index + 1}`,
      score: getImageInputPrimaryScore(input, index)
    }))
    .filter((item) => item.key && isFilledInputValue(values[item.key]))
    .filter((item) => mainInputs.length || item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.length ? ranked[0] : null;
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
  const autoFillEmptyImageInputs = settings.autoFillEmptyImageInputs !== false;
  const primaryImageInput = autoFillEmptyImageInputs ? findPrimaryImageInput(inputs, values) : null;
  const uploadedImageValues = new Map();
  const normalizedValues = {};
  const nodeInfoList = [];
  const nodeParams = {};

  async function normalizeImageSubmission(input, rawValue, key) {
    const imageSubmission = classifyImageSubmissionValue(rawValue);
    if (imageSubmission.mode === "empty") return "";
    if (imageSubmission.mode === "upload") {
      try {
        return await uploadImageValue(apiKey, imageSubmission.value, settings);
      } catch (error) {
        console.warn("[PixelRunner/RunningHub] image upload classification failed", {
          key,
          fieldName: String((input && (input.fieldName || input.name || key)) || key),
          mode: imageSubmission.mode,
          message: error && error.message ? error.message : String(error || "")
        });
        throw error;
      }
    }
    return imageSubmission.value;
  }

  async function getPrimaryImageValue() {
    if (!primaryImageInput || !primaryImageInput.key) return "";
    if (uploadedImageValues.has(primaryImageInput.key)) return uploadedImageValues.get(primaryImageInput.key);
    const normalized = await normalizeImageSubmission(
      primaryImageInput.input,
      values[primaryImageInput.key],
      primaryImageInput.key
    );
    if (isFilledInputValue(normalized)) uploadedImageValues.set(primaryImageInput.key, normalized);
    return normalized;
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
    if (!isFilledInputValue(rawValue)) {
      if (isImageInput && autoFillEmptyImageInputs) {
        const primaryImageValue = await getPrimaryImageValue();
        if (primaryImageValue && (!primaryImageInput || key !== primaryImageInput.key)) {
          pushImagePayload(input, key, primaryImageValue);
          console.log("[PixelRunner/RunningHub] image input empty, reusing primary image", {
            key,
            fieldName: String((input && (input.fieldName || input.name || key)) || key)
          });
          continue;
        }
      }

      if (isImageInput && !(input && input.required)) {
        if (autoFillEmptyImageInputs) {
          const primaryImageValue = await getPrimaryImageValue();
          if (primaryImageValue) {
            pushImagePayload(input, key, primaryImageValue);
            console.log("[PixelRunner/RunningHub] optional image empty, reusing primary image", {
              key,
              fieldName: String((input && (input.fieldName || input.name || key)) || key)
            });
            continue;
          }
        }

        const blankToken = await getBlankImageToken(apiKey, settings);
        pushImagePayload(input, key, blankToken);
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
        const primaryImageValue = autoFillEmptyImageInputs ? await getPrimaryImageValue() : "";
        if (primaryImageValue) {
          normalizedValue = primaryImageValue;
          console.log("[PixelRunner/RunningHub] optional image normalized to primary image", {
            key,
            fieldName: String((input && (input.fieldName || input.name || key)) || key)
          });
        } else {
          normalizedValue = await getBlankImageToken(apiKey, settings);
          console.log("[PixelRunner/RunningHub] optional image normalized to blank placeholder", {
            key,
            fieldName: String((input && (input.fieldName || input.name || key)) || key)
          });
        }
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
      const message = normalizeCloudFailureMessage(
        extractBestFailureMessageText(result) ||
          (result && (result.message || result.msg || result.error)) ||
          `Request failed (HTTP ${response.status})`,
        { provider: "RunningHub", httpStatus: response.status }
      );
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

function extractTaskChargeByKeys(payload, keys = []) {
  const candidates = collectCandidateValues(
    payload,
    (key) => {
      const normalized = String(key || "").trim().toLowerCase();
      return keys.includes(normalized);
    }
  );

  let total = 0;
  let matched = false;
  for (const candidate of candidates) {
    const parsed = parseChargeValue(candidate);
    if (parsed === null) continue;
    total += Math.abs(parsed);
    matched = true;
  }
  return matched ? Number(total.toFixed(3)) : null;
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
    const directKeys = [
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
    for (const key of directKeys) {
      const value = payload[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    }

    const nestedKeys = [
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
    for (const key of nestedKeys) {
      const url = extractOutputUrl(payload[key]);
      if (url) return url;
    }
  }

  return "";
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
  if (!apiKey) throw new Error("RunningHub API Key is missing");
  if (!appId) throw new Error("AI optimize appId is missing");
  if (!image) throw new Error("AI optimize image is missing");

  const parsedApp = await parseRunningHubApp([{ appId, apiKey, preferredName: "AI优化" }]);
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
    settings
  }]);
  const taskId = String((submitResult && submitResult.taskId) || "").trim();
  const pollResult = await pollRunningHubTask([{ apiKey, taskId, settings }]);
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
    txtUrl: txtCandidate.url,
    txtFileName: txtCandidate.fileName || "",
    outputUrl: String((pollResult && pollResult.outputUrl) || "").trim(),
    raw: pollResult && pollResult.result ? pollResult.result : null
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

function isContentPolicyFailureMessage(message) {
  const text = compactFailureText(message, 800).toLowerCase();
  if (!text) return false;
  return /(content\s*(policy|safety|moderation|filter)|policy\s*(violation|violated|reject|rejected|refusal)|safety\s*(policy|system|filter|check)|moderation|review failed|audit failed|not pass(?:ed)? (?:the )?(?:review|audit)|sensitive|inappropriate|nsfw|porn|sexual|violence|violent|harmful|unsafe|prohibited|blocked|banned|abuse|violation|violates|审核|审查|内容安全|安全策略|内容政策|敏感|违规|违禁|不合规|风控|拒绝|拦截)/i.test(text);
}

function isBalanceFailureMessage(message) {
  return /(insufficient|not enough|lack of|balance|quota|credit|recharge|余额不足|欠费|额度不足|点数不足|充值)/i.test(String(message || ""));
}

function isAuthFailureMessage(message) {
  const text = String(message || "");
  if (getTaskStatusErrorCode(text)) return false;
  return /(api\s*key|apikey|unauthorized|forbidden|invalid token|access denied|permission|鉴权|认证|授权|无权限|密钥|令牌)/i.test(text);
}

function isTaskStatusErrorCode(message) {
  const text = String(message || "").trim();
  if (!text) return false;
  return /^[A-Z0-9_]*TASK_STATUS_ERROR[A-Z0-9_]*$/.test(text) || /^[A-Z0-9_]*(?:STATUS|TASK)_ERROR[A-Z0-9_]*$/.test(text);
}

function getTaskStatusErrorCode(message) {
  const text = String(message || "").toUpperCase();
  const match = text.match(/\b[A-Z0-9_]*TASK_STATUS_ERROR[A-Z0-9_]*\b/) || text.match(/\b[A-Z0-9_]*(?:STATUS|TASK)_ERROR[A-Z0-9_]*\b/);
  return match ? match[0] : "";
}

function getHttpStatusFromFailureMessage(message) {
  const match = String(message || "").match(/\b(?:http\s*)?([1-5]\d\d)\b/i);
  if (!match) return 0;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : 0;
}

function buildFailureRawSuffix(rawMessage, normalizedText = "") {
  const raw = compactFailureText(rawMessage, 260);
  if (!raw) return "";
  if (normalizedText && normalizedText.includes(raw)) return "";
  return `（云端返回：${raw}）`;
}

function isNormalizedCloudFailureMessage(message) {
  return /^(内容未通过审核|请求内容可能触发|云端拒绝了本次任务|RunningHub (?:返回任务状态异常|账户余额|鉴权失败|拒绝了本次请求|请求过于频繁|云端服务暂时异常|任务等待超时|任务执行失败))/.test(
    String(message || "").trim()
  );
}

function normalizeCloudFailureMessage(message, options = {}) {
  const provider = String(options.provider || "RunningHub").trim() || "RunningHub";
  const raw = compactFailureText(message || options.fallback || "", 500);
  const status = String(options.status || "").trim();
  const httpStatus = Number(options.httpStatus) || getHttpStatusFromFailureMessage(raw);
  const source = raw || (status ? `任务状态：${status}` : "");

  const taskStatusErrorCode = getTaskStatusErrorCode(source);
  if (taskStatusErrorCode) {
    return `${provider} 返回任务状态异常，请点击“详情”进入任务页面，在“任务响应信息”中查看具体失败原因。（状态：${taskStatusErrorCode}）`;
  }
  if (isNormalizedCloudFailureMessage(raw)) return raw;
  if (!source) {
    return `${provider} 任务执行失败，平台未返回具体原因。请稍后重试，或检查提示词、输入图片和工作流配置。`;
  }
  if (/任务轮询已取消|任务已取消/.test(source) || /task polling cancelled|cancelled|canceled/i.test(source)) return "任务已取消。";
  if (isContentPolicyFailureMessage(source)) {
    const messageText = "内容未通过审核，请调整提示词或输入图片后重试。请求内容可能触发平台内容政策或安全策略。";
    return `${messageText}${buildFailureRawSuffix(source, messageText)}`;
  }
  if (isBalanceFailureMessage(source)) {
    const messageText = `${provider} 账户余额或额度不足，请充值或检查额度后重试。`;
    return `${messageText}${buildFailureRawSuffix(source, messageText)}`;
  }
  if (isAuthFailureMessage(source) || httpStatus === 401) {
    const messageText = `${provider} 鉴权失败，请检查 API Key、账号权限或登录状态后重试。`;
    return `${messageText}${buildFailureRawSuffix(source, messageText)}`;
  }
  if (httpStatus === 403) {
    const messageText = `${provider} 拒绝了本次请求，请检查账号权限、应用权限或内容安全策略。`;
    return `${messageText}${buildFailureRawSuffix(source, messageText)}`;
  }
  if (httpStatus === 429) {
    const messageText = `${provider} 请求过于频繁或额度受限，请稍后再试。`;
    return `${messageText}${buildFailureRawSuffix(source, messageText)}`;
  }
  if (httpStatus >= 500) {
    const messageText = `${provider} 云端服务暂时异常，请稍后重试。`;
    return `${messageText}${buildFailureRawSuffix(source, messageText)}`;
  }
  if (/timeout|timed out|超时/i.test(source)) {
    const messageText = `${provider} 任务等待超时，插件未能在本地等待时间内确认最终结果。`;
    return `${messageText}${buildFailureRawSuffix(source, messageText)}`;
  }
  if (isGenericFailureMessage(source)) {
    const messageText = `${provider} 任务执行失败，平台未返回更具体原因。请检查提示词、输入图片和工作流配置后重试。`;
    return `${messageText}${buildFailureRawSuffix(source, messageText)}`;
  }
  if (/[\u4e00-\u9fff]/.test(source)) return source;
  return `${provider} 任务执行失败：${source}`;
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
    "job_status",
    "nodeStatus",
    "node_status"
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

function buildTaskStatusResponse(taskId, snapshot, fallbackMessage = "") {
  const result = snapshot && snapshot.result;
  const payloadData = (result && (result.data || result.result)) || result;
  const status = extractTaskStatus(payloadData);
  const outputUrl = extractOutputUrl(payloadData);
  const balanceCharge = extractTaskBalanceCharge(payloadData || result);
  const coinsCharge = extractTaskCoinsCharge(payloadData || result);
  const rawMessage = String(
    extractBestFailureMessageText(result) ||
      extractMessageText(result) ||
    fallbackMessage ||
    (snapshot && !snapshot.ok ? `Request failed (HTTP ${snapshot.status})` : "")
  ).trim();
  const rootCode = getApiCode(result);
  const dataCode = getApiCode(payloadData);
  const hasFailureStatus = isFailedStatus(status);
  const hasSuccessStatus = isSucceededStatus(status);
  const transientError =
    Boolean(snapshot && snapshot.transientError) ||
    Boolean(snapshot && !snapshot.ok && isTransientHttpStatus(snapshot.status)) ||
    isTransientNetworkErrorMessage(rawMessage);
  const failed = Boolean(
    hasFailureStatus ||
      (!transientError && isFailureMessage(rawMessage)) ||
      (snapshot && !snapshot.ok && !transientError) ||
      ((rootCode !== null || dataCode !== null) &&
        [rootCode, dataCode].some((code) => code !== null && code !== 0 && code !== 200) &&
        !hasSuccessStatus &&
        !transientError &&
        isFailureMessage(rawMessage || fallbackMessage))
  );
  const message = failed
    ? normalizeCloudFailureMessage(rawMessage || fallbackMessage || status, {
        provider: "RunningHub",
        status,
        httpStatus: snapshot && snapshot.status
      })
    : rawMessage;
  const stillRunning = !failed && (isPendingStatus(status) || isPendingMessage(rawMessage) || Boolean(snapshot && snapshot.transientError));

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
    stillRunning,
    failed,
    transientError,
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
        throw new Error(
          normalizeCloudFailureMessage(
            extractBestFailureMessageText(result) || (result && (result.message || result.msg)) || "Task created but taskId missing",
            { provider: "RunningHub" }
          )
        );
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
        throw new Error(
          normalizeCloudFailureMessage(
            extractBestFailureMessageText(result) || (result && (result.message || result.msg)) || "Legacy task created but taskId missing",
            { provider: "RunningHub" }
          )
        );
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
        if (localController && localController.signal.aborted) {
          throw new Error("Task polling cancelled");
        }
        const result = snapshot.result;
        if (!snapshot.ok) {
          const rawMessage =
            extractBestFailureMessageText(result) ||
            (result && (result.message || result.msg || result.error)) ||
            `Request failed (HTTP ${snapshot.status})`;
          if (snapshot.transientError || isTransientHttpStatus(snapshot.status) || isTransientNetworkErrorMessage(rawMessage)) {
            console.warn("[PixelRunner/RunningHub] transient task status request failed", {
              taskId,
              status: snapshot.status,
              message: rawMessage
            });
            await sleep(pollIntervalMs);
            continue;
          }
          throw new Error(String(normalizeCloudFailureMessage(rawMessage, { provider: "RunningHub", httpStatus: snapshot.status })));
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

        const statusResponse = buildTaskStatusResponse(taskId, snapshot);
        const status = statusResponse.status || extractTaskStatus(payloadData);
        if (statusResponse.failed || isFailedStatus(status)) {
          const failedStatus = statusResponse.failed
            ? statusResponse
            : buildTaskStatusResponse(
                taskId,
                snapshot,
                normalizeCloudFailureMessage(`Task failed (${status})`, { provider: "RunningHub", status })
              );
          return {
            ok: false,
            taskId,
            failed: true,
            status: failedStatus.status || status || "FAILED",
            outputUrl: "",
            charge: failedStatus.charge,
            balanceCharge: failedStatus.balanceCharge,
            coinsCharge: failedStatus.coinsCharge,
            chargeDisplay: failedStatus.chargeDisplay,
            message: failedStatus.message || normalizeCloudFailureMessage(`Task failed (${status})`, { provider: "RunningHub", status }),
            result
          };
        }

        if (!isPendingStatus(status) && !isPendingMessage(result && (result.message || result.msg))) {
          console.warn("[PixelRunner/RunningHub] task status not terminal yet", {
            taskId,
            status: status || "",
            message: (result && (result.message || result.msg)) || "Unknown task status"
          });
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
    if (localController && localController.signal.aborted) {
      throw new Error("Task polling cancelled");
    }
    const timeoutStatus = buildTaskStatusResponse(
      taskId,
      timeoutSnapshot,
      normalizeCloudFailureMessage("Task polling timed out", { provider: "RunningHub", status: "TIMEOUT" })
    );
    if (timeoutStatus.outputUrl) {
      return {
        ok: true,
        taskId,
        status: "SUCCEEDED",
        outputUrl: timeoutStatus.outputUrl,
        result: timeoutSnapshot.result
      };
    }
    if (timeoutStatus.failed) {
      return {
        ok: false,
        taskId,
        failed: true,
        status: timeoutStatus.status || "FAILED",
        outputUrl: "",
        charge: timeoutStatus.charge,
        balanceCharge: timeoutStatus.balanceCharge,
        coinsCharge: timeoutStatus.coinsCharge,
        chargeDisplay: timeoutStatus.chargeDisplay,
        message:
          timeoutStatus.message ||
          normalizeCloudFailureMessage(`Task failed (${timeoutStatus.status || "FAILED"})`, {
            provider: "RunningHub",
            status: timeoutStatus.status || "FAILED"
          }),
        result: timeoutSnapshot.result || null
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
          ? "本地等待超时，但 RunningHub 仍显示任务运行中，插件会继续后台追踪。"
          : "本地等待超时，RunningHub 尚未返回最终结果。"),
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

export async function runAiOptimizeTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  return runAiOptimizeInternal(payload);
}
