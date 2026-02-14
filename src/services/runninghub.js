const { API } = require("../config");
const { normalizeAppId, inferInputType, sleep, isEmptyValue } = require("../utils");

function toMessage(result, fallback = "请求失败") {
  if (!result || typeof result !== "object") return fallback;
  return String(result.msg || result.message || fallback);
}

const OPTION_CONTAINER_KEYS = [
  "options",
  "enums",
  "values",
  "items",
  "list",
  "data",
  "children",
  "selectOptions",
  "optionList",
  "fieldOptions",
  "candidate",
  "candidates",
  "enum"
];

const OPTION_VALUE_KEYS = [
  "value",
  "name",
  "label",
  "title",
  "text",
  "index",
  "option",
  "optionValue",
  "enumValue",
  "displayName",
  "display",
  "key",
  "id",
  "code"
];

const OPTION_IGNORE_MARKERS = new Set(["ignore", "ignored", "忽略"]);
const OPTION_NOISE_MARKERS = new Set([
  "string",
  "text",
  "number",
  "int",
  "integer",
  "float",
  "double",
  "boolean",
  "bool",
  "object",
  "array",
  "list",
  "enum",
  "select",
  "index",
  "fastindex",
  "description",
  "descriptionen",
  "descriptioncn"
]);
const OPTION_META_KEYS = new Set([
  "default",
  "description",
  "descriptionEn",
  "desc",
  "title",
  "label",
  "name",
  "placeholder",
  "required",
  "min",
  "max",
  "step",
  "type",
  "widget",
  "inputType",
  "fieldType",
  "multiple"
]);

const FIELD_LABEL_MAP = {
  aspectratio: "比例",
  resolution: "分辨率",
  channel: "通道",
  prompt: "提示词",
  negativeprompt: "反向提示词",
  seed: "随机种子",
  steps: "步数",
  cfg: "CFG",
  cfgscale: "CFG 强度",
  sampler: "采样器",
  scheduler: "调度器",
  width: "宽度",
  height: "高度",
  model: "模型",
  style: "风格",
  strength: "强度",
  denoise: "降噪强度"
};

function normalizeFieldToken(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function lookupMappedLabel(rawToken) {
  const token = normalizeFieldToken(rawToken);
  if (!token) return "";
  return FIELD_LABEL_MAP[token] || "";
}

function resolveDisplayLabel(key, fieldName, rawLabel, rawName) {
  const candidates = [];
  const keyText = String(key || "").trim();
  const fieldText = String(fieldName || "").trim();
  if (fieldText) candidates.push(fieldText);
  if (keyText) {
    candidates.push(keyText);
    if (keyText.includes(":")) candidates.push(keyText.split(":").pop());
  }
  if (rawLabel) candidates.push(rawLabel);
  if (rawName) candidates.push(rawName);

  for (const item of candidates) {
    const mapped = lookupMappedLabel(item);
    if (mapped) return mapped;
  }

  return String(rawLabel || rawName || key || "").trim();
}

function isLikelyOptionKey(rawKey) {
  const key = String(rawKey || "").trim();
  if (!key) return false;
  const marker = key.toLowerCase();
  if (OPTION_META_KEYS.has(marker)) return false;
  if (key.length > 40) return false;
  return /^[a-z0-9:_./\-]+$/i.test(key);
}

function tryParseJsonString(raw) {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  if (!/^[\[{"]/.test(text)) return undefined;
  try {
    return JSON.parse(text);
  } catch (_) {
    return undefined;
  }
}

function normalizeOptionText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value !== "object" || Array.isArray(value)) return "";
  for (const key of OPTION_VALUE_KEYS) {
    const item = value[key];
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      const text = String(item).trim();
      if (text) return text;
    }
  }
  return "";
}

function pushOptionValue(bucket, seen, value) {
  const text = normalizeOptionText(value);
  if (!text) return false;
  const marker = text.toLowerCase();
  if (OPTION_IGNORE_MARKERS.has(marker)) return false;
  if (seen.has(marker)) return true;
  seen.add(marker);
  bucket.push(text);
  return true;
}

function collectOptionValues(source, bucket, seen, depth = 0) {
  if (depth > 8 || source === undefined || source === null) return;

  if (typeof source === "string") {
    const text = source.trim();
    if (!text) return;
    const parsed = tryParseJsonString(text);
    if (parsed !== undefined) {
      collectOptionValues(parsed, bucket, seen, depth + 1);
      return;
    }
    if ((text.includes("|") || text.includes(",") || text.includes("\n")) && text.length <= 2000) {
      const tokens = text.split(/[|,\r\n]+/).map((x) => x.trim()).filter(Boolean);
      if (tokens.length > 1) {
        tokens.forEach((token) => pushOptionValue(bucket, seen, token));
      }
    }
    return;
  }

  if (typeof source === "number" || typeof source === "boolean") {
    pushOptionValue(bucket, seen, source);
    return;
  }

  if (Array.isArray(source)) {
    source.forEach((item) => collectOptionValues(item, bucket, seen, depth + 1));
    return;
  }

  if (typeof source !== "object") return;

  let usedKnownContainer = false;
  for (const key of OPTION_CONTAINER_KEYS) {
    if (source[key] !== undefined) {
      usedKnownContainer = true;
      collectOptionValues(source[key], bucket, seen, depth + 1);
    }
  }

  pushOptionValue(bucket, seen, source);
  if (usedKnownContainer) return;

  const keys = Object.keys(source);
  if (keys.length > 0 && keys.length <= 24) {
    const optionLikeKeys = keys.filter(isLikelyOptionKey);
    if (optionLikeKeys.length >= 2) {
      optionLikeKeys.forEach((k) => pushOptionValue(bucket, seen, k));
    }

    const primitiveValues = keys
      .map((k) => source[k])
      .filter((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
    if (primitiveValues.length >= 2) {
      primitiveValues.forEach((v) => pushOptionValue(bucket, seen, v));
    }

    const nestedValues = keys.map((k) => source[k]).filter((v) => v && (Array.isArray(v) || typeof v === "object"));
    if (nestedValues.length > 0) {
      nestedValues.forEach((v) => collectOptionValues(v, bucket, seen, depth + 1));
    }
  }
}

function parseFieldOptions(fieldData) {
  const bucket = [];
  const seen = new Set();
  collectOptionValues(fieldData, bucket, seen, 0);
  const cleaned = sanitizeOptionList(bucket);
  return cleaned.length > 0 ? cleaned : undefined;
}

function sanitizeOptionList(list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const text = String(item || "").trim();
    if (!text) continue;
    const marker = text.toLowerCase();
    if (seen.has(marker)) continue;
    if (OPTION_IGNORE_MARKERS.has(marker)) continue;
    if (OPTION_META_KEYS.has(marker)) continue;
    if (OPTION_NOISE_MARKERS.has(marker)) continue;
    if (/^\d+$/.test(marker)) continue;
    if (/^(?:fast)?index$/i.test(text)) continue;
    if (/^description(?:en|cn)?$/i.test(text)) continue;
    seen.add(marker);
    out.push(text);
  }
  return out;
}

function mergeOptionLists(primary, secondary) {
  const merged = [];
  const seen = new Set();
  const pushMany = (list) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const text = String(item || "").trim();
      if (!text) continue;
      const marker = text.toLowerCase();
      if (seen.has(marker)) continue;
      seen.add(marker);
      merged.push(text);
    }
  };
  pushMany(primary);
  pushMany(secondary);
  return sanitizeOptionList(merged);
}

function pushUniqueText(bucket, seen, raw) {
  const text = String(raw || "").trim();
  if (!text) return;
  const marker = text.toLowerCase();
  if (seen.has(marker) || OPTION_IGNORE_MARKERS.has(marker) || OPTION_META_KEYS.has(marker)) return;
  seen.add(marker);
  bucket.push(text);
}

function stringifyLoose(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function inferOptionsFromRawText(fieldData, hintText) {
  const text = stringifyLoose(fieldData);
  if (!text) return [];

  const bucket = [];
  const seen = new Set();
  const hint = String(hintText || "").toLowerCase();
  const preferAspect = /aspect|ratio|比例/.test(hint);
  const preferResolution = /resolution|分辨率/.test(hint);
  if (!preferAspect && !preferResolution) return [];

  if (preferAspect) {
    if (/\bauto\b/i.test(text) || /自动/.test(text)) {
      pushUniqueText(bucket, seen, "auto");
    }
    const ratioMatches = text.match(/\b\d{1,2}\s*:\s*\d{1,2}\b/g) || [];
    ratioMatches.forEach((x) => pushUniqueText(bucket, seen, x.replace(/\s+/g, "")));
  }

  if (preferResolution) {
    const kMatches = text.match(/\b\d+(?:\.\d+)?k\b/gi) || [];
    const sizeMatches = text.match(/\b\d{3,5}\s*[xX]\s*\d{3,5}\b/g) || [];
    kMatches.forEach((x) => pushUniqueText(bucket, seen, x.toLowerCase()));
    sizeMatches.forEach((x) => pushUniqueText(bucket, seen, x.replace(/\s+/g, "").toLowerCase()));
  }

  return sanitizeOptionList(bucket).slice(0, 40);
}

function pickBestOptionList(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
  let fallback = undefined;
  let best = undefined;
  for (const list of candidates) {
    if (!Array.isArray(list) || list.length === 0) continue;
    if (!fallback) fallback = list;
    if (list.length <= 1) continue;
    if (!best || list.length > best.length) best = list;
  }
  return best || fallback;
}

function tryParseJsonText(raw) {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch (_) {
    return undefined;
  }
}

function extractNodeInfoListFromCurl(curlText) {
  if (typeof curlText !== "string" || !curlText.trim()) return [];

  const raw = curlText.trim();
  const patterns = [
    /--data-raw\s+'([\s\S]*?)'(?:\s|$)/i,
    /--data\s+'([\s\S]*?)'(?:\s|$)/i,
    /--data-raw\s+"([\s\S]*?)"(?:\s|$)/i,
    /--data\s+"([\s\S]*?)"(?:\s|$)/i
  ];

  let bodyRaw = "";
  for (const pattern of patterns) {
    const m = raw.match(pattern);
    if (m && m[1]) {
      bodyRaw = m[1];
      break;
    }
  }
  if (!bodyRaw) return [];

  const direct = tryParseJsonText(bodyRaw);
  if (direct && Array.isArray(direct.nodeInfoList)) return direct.nodeInfoList;

  const repaired = bodyRaw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();
  const parsed = tryParseJsonText(repaired);
  if (parsed && Array.isArray(parsed.nodeInfoList)) return parsed.nodeInfoList;
  return [];
}

function findCurlDemoText(data) {
  if (!data || typeof data !== "object") return "";
  const keys = ["curl", "curlCmd", "curlCommand", "requestDemo", "requestExample", "demo", "example"];
  for (const key of keys) {
    if (typeof data[key] === "string" && data[key].trim()) return data[key];
  }
  return "";
}

function buildInputMergeKey(input) {
  if (!input || typeof input !== "object") return "";
  const nodeId = String(input.nodeId || "").trim();
  const fieldName = String(input.fieldName || "").trim();
  if (nodeId && fieldName) return `${nodeId}:${fieldName}`.toLowerCase();
  const key = String(input.key || "").trim();
  if (key) return key.toLowerCase();
  if (fieldName) return fieldName.toLowerCase();
  return "";
}

function mergeInputsWithFallback(primaryInputs, fallbackInputs) {
  const base = Array.isArray(primaryInputs) ? primaryInputs : [];
  const backup = Array.isArray(fallbackInputs) ? fallbackInputs : [];
  if (base.length === 0) return backup;
  if (backup.length === 0) return base;

  const backupMap = new Map();
  for (const item of backup) {
    const marker = buildInputMergeKey(item);
    if (!marker || backupMap.has(marker)) continue;
    backupMap.set(marker, item);
  }

  return base.map((input) => {
    const marker = buildInputMergeKey(input);
    if (!marker) return input;
    const alt = backupMap.get(marker);
    if (!alt) return input;

    const type = inferInputType(input.type || input.fieldType);
    const needsSelectOptions =
      type === "select" && (!Array.isArray(input.options) || input.options.length <= 1) && Array.isArray(alt.options) && alt.options.length > 1;
    if (!needsSelectOptions) return input;

    return {
      ...input,
      options: alt.options
    };
  });
}

function isPromptLikeText(text) {
  const hint = String(text || "").toLowerCase();
  return /prompt|提示词|negative|正向|负向/.test(hint);
}

function isGhostSchemaInput(raw, input) {
  if (!raw || !input) return false;
  const hint = `${input.key || ""} ${input.fieldName || ""} ${input.label || ""}`;
  if (!isPromptLikeText(hint)) return false;

  const hasNodeBinding = Boolean(String(input.nodeId || "").trim() && String(input.fieldName || "").trim());
  if (hasNodeBinding) return false;

  const rawType = String(raw.type || raw.valueType || raw.widget || raw.inputType || raw.fieldType || "").toLowerCase();
  const defaultMarker = String(input.default || "").trim().toLowerCase();
  const optionCount = Array.isArray(input.options) ? input.options.length : 0;
  const looksTypeDescriptor = OPTION_NOISE_MARKERS.has(defaultMarker) || /string|text|schema/.test(rawType);
  return looksTypeDescriptor && optionCount <= 1;
}

function normalizeInput(raw, index = 0) {
  const nodeId = String(raw.nodeId || raw.nodeID || "").trim();
  const fieldName = String(raw.fieldName || "").trim();
  const key = String(
    raw.key ||
      raw.paramKey ||
      (nodeId && fieldName ? `${nodeId}:${fieldName}` : `param_${index + 1}`)
  ).trim();

  const primaryOptionCandidates = [
    parseFieldOptions(raw.options),
    parseFieldOptions(raw.enums),
    parseFieldOptions(raw.values),
    parseFieldOptions(raw.selectOptions),
    parseFieldOptions(raw.optionList),
    parseFieldOptions(raw.fieldOptions),
    parseFieldOptions(raw.fieldData)
  ];
  const secondaryOptionCandidates = [
    parseFieldOptions(raw.config),
    parseFieldOptions(raw.extra),
    parseFieldOptions(raw.schema)
  ];
  let options = pickBestOptionList(primaryOptionCandidates) || pickBestOptionList(secondaryOptionCandidates);

  const optionCount = Array.isArray(options) ? options.length : 0;
  if (optionCount <= 1) {
    const hintText = `${key} ${raw.fieldName || ""} ${raw.label || ""} ${raw.name || ""}`;
    const textFallback = inferOptionsFromRawText(raw.fieldData, hintText);
    options = mergeOptionLists(options, textFallback);
  }
  options = sanitizeOptionList(options);

  const inferredType = inferInputType(raw.type || raw.valueType || raw.widget || raw.inputType || raw.fieldType);
  const keyHint = `${key} ${raw.fieldName || ""} ${raw.label || ""} ${raw.name || ""}`.toLowerCase();
  const looksPromptLike = isPromptLikeText(keyHint);
  let normalizedType = inferredType;
  if (inferredType === "text" && Array.isArray(options) && options.length > 1) normalizedType = "select";
  if (inferredType === "select" && looksPromptLike && (!Array.isArray(options) || options.length <= 1)) {
    normalizedType = "text";
  }

  const baseName = String(raw.name || raw.label || raw.title || raw.description || fieldName || key).trim();
  const baseLabel = String(raw.label || raw.name || raw.title || fieldName || key).trim();
  const displayLabel = resolveDisplayLabel(key, fieldName, baseLabel, baseName);

  return {
    key,
    name: baseName,
    label: displayLabel || baseLabel || baseName || key,
    type: normalizedType,
    required: raw.required !== false && raw.required !== 0 && raw.required !== "false",
    default: raw.default ?? raw.fieldValue,
    options: Array.isArray(options) ? options : undefined,
    min: typeof raw.min === "number" ? raw.min : undefined,
    max: typeof raw.max === "number" ? raw.max : undefined,
    step: typeof raw.step === "number" ? raw.step : undefined,
    nodeId: nodeId || undefined,
    fieldName: fieldName || undefined,
    fieldType: raw.fieldType || undefined,
    fieldData: raw.fieldData || undefined
  };
}

function extractAppInfoPayload(data) {
  if (!data || typeof data !== "object") {
    return { name: "未命名应用", description: "", inputs: [] };
  }

  let rawInputs = [];
  if (Array.isArray(data.nodeInfoList)) rawInputs = data.nodeInfoList;
  else if (Array.isArray(data.inputs)) rawInputs = data.inputs;
  else if (Array.isArray(data.params)) rawInputs = data.params;
  else if (Array.isArray(data.inputParams)) rawInputs = data.inputParams;
  else if (Array.isArray(data.nodeList)) rawInputs = data.nodeList;
  else if (data.workflow && Array.isArray(data.workflow.inputs)) rawInputs = data.workflow.inputs;

  const primaryInputs = rawInputs
    .map((x, idx) => ({ raw: x, input: normalizeInput(x, idx) }))
    .filter((item) => item && item.input && item.input.key)
    .filter((item) => !isGhostSchemaInput(item.raw, item.input))
    .map((item) => item.input);
  const curlDemoText = findCurlDemoText(data);
  const curlNodeInfoList = extractNodeInfoListFromCurl(curlDemoText);
  const fallbackInputs = curlNodeInfoList.map((x, idx) => normalizeInput(x, idx)).filter((x) => x.key);
  const inputs = mergeInputsWithFallback(primaryInputs, fallbackInputs);

  return {
    name: data.webappName || data.name || data.title || data.appName || data.workflowName || "未命名应用",
    description: data.description || data.desc || data.summary || "",
    inputs
  };
}

function warnSelectOptionCoverage(appInfo, log) {
  if (typeof log !== "function" || !appInfo || !Array.isArray(appInfo.inputs)) return;
  const weakSelects = appInfo.inputs
    .filter((input) => inferInputType(input.type || input.fieldType) === "select")
    .filter((input) => !Array.isArray(input.options) || input.options.length <= 1);
  if (weakSelects.length === 0) return;

  const preview = weakSelects
    .slice(0, 4)
    .map((input) => input.label || input.name || input.key || "unknown")
    .join(", ");
  log(`检测到 ${weakSelects.length} 个下拉参数可选项不足（${preview}）`, "warn");
}

async function parseJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    return text ? { message: text } : null;
  }
  return response.json().catch(() => null);
}

async function fetchAppInfo(appId, apiKey, options = {}) {
  const log = options.log || (() => {});
  const normalizedId = normalizeAppId(appId);
  const reasons = [];

  const parseUrl = new URL(`${API.BASE_URL}${API.ENDPOINTS.PARSE_APP}`);
  parseUrl.searchParams.set("apiKey", apiKey);
  parseUrl.searchParams.set("webappId", normalizedId);

  try {
    log(`解析应用: ${API.ENDPOINTS.PARSE_APP}`, "info");
    const response = await fetch(parseUrl.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
    });
    const result = await parseJsonResponse(response);
    if (response.ok && result && (result.code === 0 || result.success === true)) {
      const payload = extractAppInfoPayload(result.data || result.result || result);
      warnSelectOptionCoverage(payload, log);
      return payload;
    }
    reasons.push(`apiCallDemo: ${toMessage(result, `HTTP ${response.status}`)}`);
  } catch (e) {
    reasons.push(`apiCallDemo: ${e.message}`);
  }

  for (const endpoint of API.PARSE_FALLBACKS) {
    const url = `${API.BASE_URL}${endpoint}/${encodeURIComponent(normalizedId)}`;
    try {
      log(`解析应用回退: ${endpoint}`, "info");
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
      });
      const result = await parseJsonResponse(response);
      if (response.ok && result && (result.code === 0 || result.success === true)) {
        const payload = extractAppInfoPayload(result.data || result.result || result);
        warnSelectOptionCoverage(payload, log);
        return payload;
      }
      reasons.push(`${endpoint}: ${toMessage(result, `HTTP ${response.status}`)}`);
    } catch (e) {
      reasons.push(`${endpoint}: ${e.message}`);
    }
  }

  throw new Error(reasons[0] || "自动解析失败");
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
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
  if (typeof imageValue === "string" && imageValue.trim()) return base64ToArrayBuffer(imageValue.trim());
  throw new Error("鍥剧墖杈撳叆鏃犳晥");
}

function pickUploadedValue(data) {
  const token = data.fileName || data.filename || data.fileKey || data.key || "";
  const url = data.url || data.fileUrl || data.download_url || data.downloadUrl || "";
  return { value: token || url, token: token || "", url: url || "" };
}

async function uploadImage(apiKey, imageValue, options = {}) {
  const log = options.log || (() => {});
  const endpoints = [API.ENDPOINTS.UPLOAD_V2, API.ENDPOINTS.UPLOAD_LEGACY];
  const buffer = normalizeUploadBuffer(imageValue);
  const blob = new Blob([buffer], { type: "image/png" });
  const reasons = [];

  for (const endpoint of endpoints) {
    throwIfCancelled(options);
    try {
      const formData = new FormData();
      formData.append("file", blob, "image.png");

      const response = await fetch(`${API.BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
        signal: options.signal 
      });
      throwIfCancelled(options);
      const result = await parseJsonResponse(response);
      throwIfCancelled(options);
      if (!response.ok) {
        reasons.push(`${endpoint}: HTTP ${response.status}`);
        continue;
      }

      const success = result && (result.code === 0 || result.success === true);
      if (!success) {
        reasons.push(`${endpoint}: ${toMessage(result)}`);
        continue;
      }

      const data = result.data || result.result || {};
      const picked = pickUploadedValue(data);
      if (picked.value) return picked;
      reasons.push(`${endpoint}: 上传成功但未返回可用文件标识`);
    } catch (e) {
      if (e && e.code === "RUN_CANCELLED") throw e;
      reasons.push(`${endpoint}: ${e.message}`);
    }
  }

  log(reasons.join(" | "), "warn");
  throw new Error("图片上传失败");
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

function parseTaskId(result) {
  if (!result || typeof result !== "object") return "";
  return (
    (result.data && (result.data.taskId || result.data.id)) ||
    result.taskId ||
    result.id ||
    ""
  );
}

async function createAiAppTask(apiKey, appId, nodeInfoList, options = {}) {
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
    throwIfCancelled(options);
    try {
      const response = await fetch(`${API.BASE_URL}${API.ENDPOINTS.AI_APP_RUN}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal
      });
      throwIfCancelled(options);
      const result = await parseJsonResponse(response);
      throwIfCancelled(options);
      const taskId = parseTaskId(result);
      const success = response.ok && result && (result.code === 0 || result.success === true) && taskId;
      if (success) return taskId;

      const marker = Object.keys(body).join(",");
      reasons.push(`ai-app/run(${marker}): ${toMessage(result, `HTTP ${response.status}`)}`);
    } catch (e) {
      if (e && e.code === "RUN_CANCELLED") throw e;
      reasons.push(`ai-app/run: ${e.message}`);
    }
  }

  log(reasons.join(" | "), "warn");
  throw new Error("AI 应用任务创建失败");
}

async function createLegacyTask(apiKey, appId, nodeParams, options = {}) {
  throwIfCancelled(options);
  const response = await fetch(`${API.BASE_URL}${API.ENDPOINTS.LEGACY_CREATE_TASK}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, workflowId: normalizeAppId(appId), nodeParams }),
    signal: options.signal
  });
  throwIfCancelled(options);
  const result = await parseJsonResponse(response);
  throwIfCancelled(options);
  const taskId = parseTaskId(result);
  const success = response.ok && result && (result.code === 0 || result.success === true) && taskId;
  if (!success) throw new Error(toMessage(result, `创建任务失败 (HTTP ${response.status})`));
  return taskId;
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
    const keys = ["fileUrl", "url", "downloadUrl", "download_url", "imageUrl", "resultUrl"];
    for (const key of keys) {
      const v = payload[key];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
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
  const status = payload.status || payload.state || payload.taskStatus || "";
  return String(status).toUpperCase();
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

function makeRunCancelledError(message = "用户取消运行") {
  const err = new Error(message);
  err.code = "RUN_CANCELLED";
  return err;
}

function throwIfCancelled(options = {}) {
  // 1. 支持函数式取消
  if (typeof options.shouldCancel === "function" && options.shouldCancel()) {
    throw makeRunCancelledError();
  }
  // 2. 支持 Signal 信号取消 (新增)
  if (options.signal && options.signal.aborted) {
    throw makeRunCancelledError("用户中止");
  }
}

async function pollTaskOutput(apiKey, taskId, settings, options = {}) {
  const log = options.log || (() => {});
  const pollIntervalMs = Math.max(1, Number(settings.pollInterval) || 2) * 1000;
  const timeoutMs = Math.max(10, Number(settings.timeout) || 90) * 1000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    throwIfCancelled(options);
    try {
      const response = await fetch(`${API.BASE_URL}${API.ENDPOINTS.TASK_OUTPUTS}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, taskId }),
        signal: options.signal
      });
      throwIfCancelled(options);
      const result = await parseJsonResponse(response);
      throwIfCancelled(options);

      if (response.ok && result && (result.code === 0 || result.success === true)) {
        const payload = result.data || result.result || result;
        const outputUrl = extractOutputUrl(payload);
        if (outputUrl) return outputUrl;

        const status = extractTaskStatus(payload);
        if (isFailedStatus(status)) throw new Error(toMessage(result, `任务失败 (${status})`));
        log(`任务状态: ${status || "处理中"}`, "info");
        await sleep(pollIntervalMs);
        throwIfCancelled(options);
        continue;
      }

      const message = toMessage(result, `HTTP ${response.status}`);
      const status = extractTaskStatus(result && result.data ? result.data : result);
      if (isPendingStatus(status) || isPendingMessage(message)) {
        log(`任务状态: ${status || message}`, "info");
        await sleep(pollIntervalMs);
        throwIfCancelled(options);
        continue;
      }

      throw new Error(message);
    } catch (e) {
      if (e && e.code === "RUN_CANCELLED") throw e;
      if (isPendingMessage(e.message)) {
        await sleep(pollIntervalMs);
        throwIfCancelled(options);
        continue;
      }
      throw e;
    }
  }

  throw new Error("任务超时，请稍后查看 RunningHub 任务列表");
}

async function runAppTask(apiKey, appItem, inputValues, options = {}) {
  const log = options.log || (() => {});
  const nodeInfoList = [];
  const nodeParams = {};

  for (const input of appItem.inputs || []) {
    throwIfCancelled(options);
    const key = String(input.key || "").trim();
    if (!key) continue;

    let value = inputValues[key];
    const type = inferInputType(input.type || input.fieldType);
    if (type !== "image" && input.required && isEmptyValue(value)) {
      throw new Error(`缺少必填参数: ${input.label || input.name || key}`);
    }

    if (type === "image") {
      if (isEmptyValue(value)) {
        // 显式传空值占位，避免服务端回退到应用内示例图。
        value = "";
        if (input.required) log(`图片参数未上传，已使用空值占位: ${input.label || input.name || key}`, "warn");
      } else {
        const uploaded = await uploadImage(apiKey, value, options);
        value = uploaded.value;
        throwIfCancelled(options);
      }
    } else if (type === "number" && !isEmptyValue(value)) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`数字参数无效: ${input.label || key}`);
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
      throwIfCancelled(options);
      log(`提交任务: AI 应用接口 (${nodeInfoList.length} 个参数)`, "info");
      return await createAiAppTask(apiKey, appItem.appId, nodeInfoList, options);
    } catch (e) {
      if (e && e.code === "RUN_CANCELLED") throw e;
      lastErr = e;
      log(`AI 应用接口失败，尝试回退旧接口: ${e.message}`, "warn");
    }
  }

  if (Object.keys(nodeParams).length > 0) {
    throwIfCancelled(options);
    log("提交任务: 兼容工作流接口", "info");
    return createLegacyTask(apiKey, appItem.appId, nodeParams, options);
  }

  if (lastErr) throw lastErr;
  throw new Error("没有可提交的参数");
}

async function downloadResultBinary(url, options = {}) {
  throwIfCancelled(options);
  // 加入 signal
  const response = await fetch(url, { signal: options.signal }); 
  
  throwIfCancelled(options);
  if (!response.ok) throw new Error(`下载结果失败 (HTTP ${response.status})`);
  return response.arrayBuffer();
}

async function testApiKey(apiKey) {
  const url = new URL(`${API.BASE_URL}${API.ENDPOINTS.PARSE_APP}`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("webappId", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
  });
  const result = await parseJsonResponse(response);

  if (response.status === 401) return { ok: false, message: "API Key 无效 (401)" };
  if (response.status === 403) return { ok: false, message: "API Key 权限不足或余额不足 (403)" };
  if (result && (result.code === 0 || result.success === true)) return { ok: true, message: "API Key 有效" };

  return { ok: response.ok, message: toMessage(result, `HTTP ${response.status}`) };
}

function pickAccountValue(raw, keys) {
  if (!raw || typeof raw !== "object") return "";
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && String(raw[key]).trim() !== "") {
      return String(raw[key]).trim();
    }
  }
  return "";
}

async function fetchAccountStatus(apiKey) {
  if (!apiKey) throw new Error("缺少 API Key");
  const response = await fetch(`${API.BASE_URL}${API.ENDPOINTS.ACCOUNT_STATUS}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: apiKey })
  });
  const result = await parseJsonResponse(response);
  const ok = response.ok && result && (result.code === 0 || result.success === true);
  if (!ok) throw new Error(toMessage(result, `获取账户信息失败 (HTTP ${response.status})`));

  const data = result.data || result.result || {};
  const account = (data && data.accountStatus && typeof data.accountStatus === "object" ? data.accountStatus : data) || {};
  return {
    remainMoney: pickAccountValue(account, ["remainMoney", "balance", "money"]),
    remainCoins: pickAccountValue(account, ["remainCoins", "rhCoins", "coins"])
  };
}

module.exports = {
  fetchAppInfo,
  runAppTask,
  pollTaskOutput,
  downloadResultBinary,
  testApiKey,
  fetchAccountStatus
};
