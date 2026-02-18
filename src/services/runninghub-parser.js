const { API } = require("../config");
const { normalizeAppId, inferInputType } = require("../utils");
const { resolveInputType } = require("../shared/input-schema");

const PARSE_DEBUG_STORAGE_KEY = "rh_last_parse_debug";

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
  "descriptionen",
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
  "inputtype",
  "fieldtype",
  "multiple"
]);

function normalizeFieldToken(text) {
  return String(text || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolveDisplayLabel(key, fieldName, rawLabel, rawName) {
  const preferredRawLabel = String(rawLabel || rawName || "").trim();
  if (preferredRawLabel && !isWeakLabel(preferredRawLabel)) return preferredRawLabel;

  const candidates = [fieldName, key, key && String(key).includes(":") ? String(key).split(":").pop() : ""];
  for (const item of candidates) {
    const mapped = FIELD_LABEL_MAP[normalizeFieldToken(item)];
    if (mapped) return mapped;
  }
  return preferredRawLabel || String(fieldName || key || "").trim();
}

function resolveFieldDataLabel(fieldData) {
  if (!fieldData) return "";
  let parsed = fieldData;
  if (typeof fieldData === "string") {
    parsed = parseJsonFromEscapedText(fieldData);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const candidate = parsed.label || parsed.name || parsed.title || parsed.description || "";
  return String(candidate || "").trim();
}

function isWeakLabel(label) {
  const text = String(label || "").trim().toLowerCase();
  if (!text) return true;
  return ["value", "text", "string", "number", "int", "float", "double", "bool", "boolean"].includes(text);
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
  if (!/^[\[{\"]/.test(text)) return undefined;
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

function buildStructuredOptionEntry(value, label) {
  const normalizedValue = normalizeOptionText(value);
  if (!normalizedValue) return null;
  const normalizedLabel = normalizeOptionText(label) || normalizedValue;
  if (!normalizedLabel) return null;
  return {
    value: normalizedValue,
    label: normalizedLabel
  };
}

function sanitizeStructuredOptionEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const out = [];
  const seen = new Set();
  for (const item of entries) {
    if (!item || typeof item !== "object") continue;
    const value = normalizeOptionText(item.value);
    if (!value) continue;
    const label = normalizeOptionText(item.label) || value;
    const marker = value.toLowerCase();
    if (seen.has(marker)) continue;
    seen.add(marker);
    out.push({ value, label });
  }
  return out;
}

function parseIndexedSwitchOptions(fieldData) {
  let parsed = fieldData;
  if (typeof parsed === "string") {
    parsed = parseJsonFromEscapedText(parsed);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;

  const entries = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;

    const value = item.index ?? item.fastIndex ?? item.value ?? item.optionValue ?? item.enumValue;
    if (value === undefined || value === null) return undefined;
    if (!normalizeOptionText(value)) return undefined;

    const label = item.description || item.descriptionCn || item.descriptionEn || item.label || item.name || item.title || item.text || value;
    const entry = buildStructuredOptionEntry(value, label);
    if (!entry) return undefined;
    entries.push(entry);
  }

  const normalized = sanitizeStructuredOptionEntries(entries);
  return normalized.length > 0 ? normalized : undefined;
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
      if (tokens.length > 1) tokens.forEach((token) => pushOptionValue(bucket, seen, token));
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
    if (/^(?:fast)?index$/i.test(text)) continue;
    if (/^description(?:en|cn)?$/i.test(text)) continue;
    seen.add(marker);
    out.push(text);
  }
  return out;
}

function parseFieldOptions(fieldData) {
  const bucket = [];
  const seen = new Set();
  collectOptionValues(fieldData, bucket, seen, 0);
  const cleaned = sanitizeOptionList(bucket);
  return cleaned.length > 0 ? cleaned : undefined;
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

function pushUniqueText(bucket, seen, value) {
  const text = String(value || "").trim();
  if (!text) return;
  const marker = text.toLowerCase();
  if (seen.has(marker) || OPTION_IGNORE_MARKERS.has(marker) || OPTION_META_KEYS.has(marker)) return;
  seen.add(marker);
  bucket.push(text);
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

function mergeOptionLists(base, extra) {
  const a = Array.isArray(base) ? base : [];
  const b = Array.isArray(extra) ? extra : [];
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  return sanitizeOptionList([...a, ...b]);
}

function isPromptLikeText(text) {
  const hint = String(text || "").toLowerCase();
  return /prompt|提示词|negative|正向|负向/.test(hint);
}

function parseJsonText(raw) {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch (_) {
    return undefined;
  }
}

function parseJsonFromEscapedText(raw) {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  const candidates = [
    text,
    text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\"/g, "\""),
    text.replace(/\\u0022/g, "\"")
  ];
  for (const candidate of candidates) {
    const parsed = parseJsonText(candidate);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
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
    const match = raw.match(pattern);
    if (match && match[1]) {
      bodyRaw = match[1];
      break;
    }
  }
  if (!bodyRaw) {
    const bodyMatch = raw.match(/\{[\s\S]*\}/);
    bodyRaw = bodyMatch ? bodyMatch[0] : "";
  }
  if (!bodyRaw) return [];

  const direct = parseJsonFromEscapedText(bodyRaw);
  if (direct && Array.isArray(direct.nodeInfoList)) return direct.nodeInfoList;

  const fragment = bodyRaw.match(/"nodeInfoList"\s*:\s*(\[[\s\S]*?\])\s*(?:,|\})/);
  if (fragment && fragment[1]) {
    const list = parseJsonFromEscapedText(fragment[1]);
    if (Array.isArray(list)) return list;
  }
  return [];
}

function extractNodeInfoListFromText(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) return [];
  const fromCurl = extractNodeInfoListFromCurl(rawText);
  if (fromCurl.length > 0) return fromCurl;

  const jsonCandidate = parseJsonFromEscapedText(rawText);
  if (jsonCandidate && Array.isArray(jsonCandidate.nodeInfoList)) return jsonCandidate.nodeInfoList;

  const fragment = rawText.match(/"nodeInfoList"\s*:\s*(\[[\s\S]*?\])\s*(?:,|\})/);
  if (fragment && fragment[1]) {
    const list = parseJsonFromEscapedText(fragment[1]);
    if (Array.isArray(list)) return list;
  }
  return [];
}

function findCurlDemoText(data, depth = 0) {
  if (!data || typeof data !== "object" || depth > 8) return "";
  const keys = ["curl", "curlCmd", "curlCommand", "apiCallDemo", "requestDemo", "requestExample", "demo", "example", "doc", "docs", "apiDoc", "apiDocs"];
  for (const key of keys) {
    if (typeof data[key] === "string" && data[key].trim()) return data[key];
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findCurlDemoText(item, depth + 1);
      if (found) return found;
    }
    return "";
  }

  for (const value of Object.values(data)) {
    if (!value || typeof value !== "object") continue;
    const found = findCurlDemoText(value, depth + 1);
    if (found) return found;
  }
  return "";
}

function isLikelyInputRecord(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  if (String(item.key || item.paramKey || "").trim()) return true;
  if (String(item.fieldName || "").trim()) return true;
  if (String(item.nodeId || item.nodeID || "").trim() && String(item.fieldName || "").trim()) return true;
  if (item.fieldData !== undefined && (item.fieldName || item.key || item.paramKey)) return true;
  if ((item.default !== undefined || item.fieldValue !== undefined) && (item.name || item.label || item.fieldName || item.key)) return true;
  const marker = String(item.type || item.fieldType || item.inputType || item.widget || item.valueType || "").trim();
  return Boolean(marker);
}

function isLikelyOptionRecord(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  if (String(item.value || item.optionValue || item.enumValue || item.key || "").trim()) return true;
  if (String(item.name || item.label || item.title || item.text || item.displayName || "").trim()) return true;
  return false;
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

function isBooleanOptionList(options) {
  if (!Array.isArray(options) || options.length === 0) return false;
  const markers = new Set(["true", "false", "yes", "no", "是", "否"]);
  let matched = 0;
  for (const item of options) {
    const rawValue =
      item && typeof item === "object" && !Array.isArray(item)
        ? item.value ?? item.label ?? item.name ?? ""
        : item;
    const text = String(rawValue || "").trim().toLowerCase();
    if (!text) continue;
    if (!markers.has(text)) return false;
    matched += 1;
  }
  return matched > 0;
}

function toInputListFromUnknown(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const values = Object.values(value);
  if (!values.length) return [];
  const inputLike = values.filter(isLikelyInputRecord);
  if (inputLike.length === 0) return [];
  if (inputLike.length === values.length || inputLike.length >= 1) return inputLike;
  return [];
}

function collectInputCandidates(source, depth = 0, path = "root", out = []) {
  if (!source || depth > 8) return out;
  if (Array.isArray(source)) {
    const inputLikeCount = source.filter(isLikelyInputRecord).length;
    if (source.length > 0 && inputLikeCount > 0) {
      out.push({ path, list: source, inputLikeCount, nodeBindingCount: getNodeBindingCount(source) });
    }
    source.forEach((item, idx) => collectInputCandidates(item, depth + 1, `${path}[${idx}]`, out));
    return out;
  }
  if (typeof source !== "object") return out;

  const objectList = toInputListFromUnknown(source);
  if (objectList.length > 0) {
    out.push({
      path,
      list: objectList,
      inputLikeCount: objectList.filter(isLikelyInputRecord).length,
      nodeBindingCount: getNodeBindingCount(objectList)
    });
  }

  for (const [key, value] of Object.entries(source)) {
    collectInputCandidates(value, depth + 1, `${path}.${key}`, out);
  }
  return out;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const deduped = [];
  for (const item of candidates || []) {
    if (!item || !Array.isArray(item.list) || item.list.length === 0) continue;
    const marker = `${item.path}|${item.list.length}|${item.inputLikeCount || 0}`;
    if (seen.has(marker)) continue;
    seen.add(marker);
    deduped.push(item);
  }
  return deduped.sort((a, b) => {
    if ((b.nodeBindingCount || 0) !== (a.nodeBindingCount || 0)) {
      return (b.nodeBindingCount || 0) - (a.nodeBindingCount || 0);
    }
    if ((b.inputLikeCount || 0) !== (a.inputLikeCount || 0)) return (b.inputLikeCount || 0) - (a.inputLikeCount || 0);
    return b.list.length - a.list.length;
  });
}

function getNodeBindingCount(list) {
  if (!Array.isArray(list)) return 0;
  let count = 0;
  list.forEach((item) => {
    if (!item || typeof item !== "object") return;
    if (String(item.nodeId || item.nodeID || "").trim() && String(item.fieldName || item.field || "").trim()) count += 1;
  });
  return count;
}

function normalizeDefaultValueByType(value, type) {
  if (type === "number" && value !== undefined && value !== null && String(value).trim() !== "") {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  if (type === "boolean") {
    if (value === true || value === false) return value;
    const marker = String(value || "").trim().toLowerCase();
    if (marker === "true" || marker === "1") return true;
    if (marker === "false" || marker === "0") return false;
  }
  return value;
}

function parseExplicitRequired(value) {
  if (value === undefined) return null;
  if (value === null) return false;
  if (value === true || value === false) return value;
  if (typeof value === "number") return value !== 0;
  const marker = String(value || "").trim().toLowerCase();
  if (!marker) return false;
  if (["true", "1", "yes", "y", "on", "required", "是"].includes(marker)) return true;
  if (["false", "0", "no", "n", "off", "optional", "否"].includes(marker)) return false;
  return Boolean(marker);
}

function resolveRequiredSpec(raw, type) {
  const requiredKeys = ["required", "isRequired", "must", "need", "needRequired", "mandatory"];
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(raw || {}, key)) continue;
    const parsed = parseExplicitRequired(raw[key]);
    if (parsed !== null) {
      return { required: parsed, explicit: true };
    }
  }

  // RunningHub image nodes often do not provide explicit required metadata.
  // Treat them as optional by default and rely on backend validation when needed.
  if (type === "image") {
    return { required: false, explicit: false };
  }
  return { required: true, explicit: false };
}

function normalizeInput(raw, index = 0) {
  const nodeId = String(raw.nodeId || raw.nodeID || raw.node || raw.node_id || "").trim();
  const fieldName = String(raw.fieldName || raw.field || raw.name || "").trim();
  const derivedKey = nodeId && fieldName ? `${nodeId}:${fieldName}` : "";
  const key = String(raw.key || raw.paramKey || derivedKey || raw.fieldName || `param_${index + 1}`).trim();
  const explicitOptionFields = [
    parseFieldOptions(raw.options),
    parseFieldOptions(raw.enums),
    parseFieldOptions(raw.values),
    parseFieldOptions(raw.selectOptions),
    parseFieldOptions(raw.optionList),
    parseFieldOptions(raw.fieldOptions)
  ];

  let inlineFieldOptions = parseFieldOptions(raw.fieldData);
  if (!inlineFieldOptions && raw.fieldData && typeof raw.fieldData === "object" && !Array.isArray(raw.fieldData)) {
    const fieldDataValues = Object.values(raw.fieldData);
    if (fieldDataValues.length > 0 && fieldDataValues.every(isLikelyOptionRecord)) {
      inlineFieldOptions = fieldDataValues
        .map((item) => normalizeOptionText(item))
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    }
  }
  if (inlineFieldOptions && inlineFieldOptions.length > 0) {
    inlineFieldOptions = sanitizeOptionList(inlineFieldOptions);
  }

  const primaryOptionCandidates = [...explicitOptionFields, inlineFieldOptions];
  const secondaryOptionCandidates = [parseFieldOptions(raw.config), parseFieldOptions(raw.extra), parseFieldOptions(raw.schema)];
  const indexedSwitchOptions = parseIndexedSwitchOptions(raw.fieldData);
  let options =
    (Array.isArray(indexedSwitchOptions) && indexedSwitchOptions.length > 0 && indexedSwitchOptions) ||
    pickBestOptionList(primaryOptionCandidates) ||
    pickBestOptionList(secondaryOptionCandidates);

  const hasStructuredOptions =
    Array.isArray(options) &&
    options.some((item) => item && typeof item === "object" && !Array.isArray(item));

  if (!hasStructuredOptions) {
    const optionCount = Array.isArray(options) ? options.length : 0;
    if (optionCount <= 1) {
      const hintText = `${key} ${raw.fieldName || ""} ${raw.label || ""} ${raw.name || ""} ${raw.description || ""}`;
      const textFallback = inferOptionsFromRawText(raw.fieldData, hintText);
      options = mergeOptionLists(options, textFallback);
    }
    options = sanitizeOptionList(options);
  }

  const inferredType = inferInputType(raw.type || raw.valueType || raw.widget || raw.inputType || raw.fieldType);
  const keyHint = `${key} ${raw.fieldName || ""} ${raw.label || ""} ${raw.name || ""} ${raw.description || ""}`.toLowerCase();
  const looksPromptLike = isPromptLikeText(keyHint);
  let normalizedType = inferredType;
  if (inferredType === "text" && Array.isArray(options) && options.length > 1) normalizedType = "select";
  if (inferredType === "select" && looksPromptLike && (!Array.isArray(options) || options.length <= 1)) {
    normalizedType = "text";
  }

  const numericDefault = raw.default ?? raw.fieldValue;
  const numericMarker = numericDefault !== undefined && numericDefault !== null && String(numericDefault).trim() !== "";
  const numericValue = numericMarker ? Number(numericDefault) : NaN;
  if (!looksPromptLike && normalizedType === "text" && Number.isFinite(numericValue)) {
    normalizedType = "number";
  }

  if (looksPromptLike) {
    normalizedType = "text";
    options = undefined;
  }

  const mappedInput = {
    type: normalizedType,
    fieldType: raw.fieldType || "",
    options,
    fieldData: raw.fieldData,
    default: raw.default ?? raw.fieldValue
  };
  const type = resolveInputType(mappedInput);
  const fieldDataLabel = resolveFieldDataLabel(raw.fieldData);
  const rawDescription = String(raw.description || raw.desc || "").trim();
  const baseName = String(raw.name || raw.label || raw.title || fieldDataLabel || rawDescription || fieldName || key).trim();
  const baseLabel = String(raw.label || raw.name || raw.title || fieldDataLabel || rawDescription || fieldName || key).trim();
  const explicitTitle = String(raw.label || raw.name || raw.title || fieldDataLabel || "").trim();
  const displayLabel = resolveDisplayLabel(key, fieldName, baseLabel, baseName);
  const normalizedLabel = isWeakLabel(displayLabel)
    ? explicitTitle || rawDescription || displayLabel
    : displayLabel;
  const requiredSpec = resolveRequiredSpec(raw, type);

  return {
    key,
    name: baseName,
    label: normalizedLabel || baseLabel || baseName || key,
    type,
    required: requiredSpec.required,
    requiredExplicit: requiredSpec.explicit,
    default: normalizeDefaultValueByType(raw.default ?? raw.fieldValue, type),
    options: Array.isArray(options) && options.length > 0 ? options : undefined,
    min: typeof raw.min === "number" ? raw.min : undefined,
    max: typeof raw.max === "number" ? raw.max : undefined,
    step: typeof raw.step === "number" ? raw.step : undefined,
    nodeId: nodeId || undefined,
    fieldName: fieldName || undefined,
    fieldType: raw.fieldType || undefined,
    fieldData: raw.fieldData || undefined
  };
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

  const merged = base.map((input) => {
    const marker = buildInputMergeKey(input);
    if (!marker) return input;
    const alt = backupMap.get(marker);
    if (!alt) return input;

    const inputType = inferInputType(input.type || input.fieldType);
    const inputOptions = Array.isArray(input.options) ? input.options : [];
    const altOptions = Array.isArray(alt.options) ? alt.options : [];
    const inputHasBooleanOptions = isBooleanOptionList(inputOptions);
    const altHasBooleanOptions = isBooleanOptionList(altOptions);
    const needsSelectOptions =
      inputType === "select" &&
      (inputOptions.length <= 1 || (inputHasBooleanOptions && !altHasBooleanOptions)) &&
      altOptions.length > 1;
    if (!needsSelectOptions) return input;
    return { ...input, options: alt.options };
  });

  const mergedMarkers = new Set(merged.map((item) => buildInputMergeKey(item)).filter(Boolean));
  for (const item of backup) {
    const marker = buildInputMergeKey(item);
    if (!marker || mergedMarkers.has(marker)) continue;
    merged.push(item);
    mergedMarkers.add(marker);
  }
  return merged;
}

function sanitizeDebugRawEntry(raw) {
  if (!raw || typeof raw !== "object") return raw;
  return {
    key: raw.key || raw.paramKey || "",
    name: raw.name || raw.label || raw.title || "",
    nodeId: raw.nodeId || raw.nodeID || "",
    fieldName: raw.fieldName || "",
    type: raw.type || raw.fieldType || raw.inputType || raw.widget || raw.valueType || "",
    required: raw.required,
    default: raw.default ?? raw.fieldValue,
    hasFieldData: raw.fieldData !== undefined,
    optionsCount: Array.isArray(raw.options) ? raw.options.length : undefined
  };
}

function normalizeNameKey(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isMeaningfulAppName(name) {
  const text = String(name || "").trim();
  if (!text) return false;
  const marker = text.toLowerCase();
  if (marker === "unknown app" || marker === "unknown" || marker === "unnamed app" || marker === "app") return false;
  return true;
}

function scoreAppNameCandidate(name, key, depth) {
  const text = String(name || "").trim();
  if (!isMeaningfulAppName(text)) return 0;
  const keyWeight = {
    webappname: 50,
    appname: 46,
    workflowname: 44,
    displayname: 42,
    title: 38,
    name: 34
  };
  const normalizedKey = normalizeNameKey(key);
  const base = keyWeight[normalizedKey] || 20;
  const lengthScore = Math.min(12, text.length);
  const depthPenalty = Math.max(0, Number(depth) || 0);
  return base + lengthScore - depthPenalty;
}

function pushAppNameCandidate(bucket, seen, value, key, depth) {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  if (!isMeaningfulAppName(text)) return;
  const marker = text.toLowerCase();
  if (seen.has(marker)) return;
  seen.add(marker);
  bucket.push({
    value: text,
    key: normalizeNameKey(key),
    depth: Number(depth) || 0,
    score: scoreAppNameCandidate(text, key, depth)
  });
}

function collectAppNameCandidatesFromValue(value, depth = 0, bucket = [], seen = new Set(), parentKey = "") {
  if (depth > 8 || value === undefined || value === null) return bucket;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const normalizedParent = normalizeNameKey(parentKey);
    if (normalizedParent === "name" || normalizedParent === "title" || normalizedParent === "appname" || normalizedParent === "webappname" || normalizedParent === "workflowname" || normalizedParent === "displayname") {
      pushAppNameCandidate(bucket, seen, value, normalizedParent, depth);
    }
    if (typeof value === "string") {
      const parsed = parseJsonFromEscapedText(value);
      if (parsed !== undefined) {
        collectAppNameCandidatesFromValue(parsed, depth + 1, bucket, seen, "");
      }
    }
    return bucket;
  }

  if (Array.isArray(value)) {
    value.slice(0, 30).forEach((item) => collectAppNameCandidatesFromValue(item, depth + 1, bucket, seen, parentKey));
    return bucket;
  }

  if (typeof value !== "object") return bucket;

  const directKeys = ["webappName", "appName", "workflowName", "displayName", "title", "name"];
  for (const key of directKeys) {
    if (value[key] !== undefined) pushAppNameCandidate(bucket, seen, value[key], key, depth);
  }

  for (const [key, child] of Object.entries(value)) {
    collectAppNameCandidatesFromValue(child, depth + 1, bucket, seen, key);
  }
  return bucket;
}

function resolveBestAppName(data, fallback = "Unknown App") {
  if (!data || typeof data !== "object") return fallback;
  const candidates = collectAppNameCandidatesFromValue(data, 0, [], new Set(), "");
  if (!Array.isArray(candidates) || candidates.length === 0) return fallback;
  candidates.sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return (a.depth || 0) - (b.depth || 0);
  });
  const best = candidates[0];
  return best && best.value ? best.value : fallback;
}

function extractAppInfoPayload(data) {
  const parsedString = typeof data === "string" ? parseJsonFromEscapedText(data) : undefined;
  if (parsedString && typeof parsedString === "object") return extractAppInfoPayload(parsedString);

  if (Array.isArray(data)) {
    if (data.some(isLikelyInputRecord)) {
      return extractAppInfoPayload({ nodeInfoList: data });
    }
    return {
      payload: { name: "Unknown App", description: "", inputs: [] },
      debug: { candidates: [], selectedPath: "", selectedRawCount: 0, selectedRawPreview: [], curlFound: false, curlNodeInfoCount: 0 }
    };
  }

  if (!data || typeof data !== "object") {
    return {
      payload: { name: "Unknown App", description: "", inputs: [] },
      debug: { candidates: [], selectedPath: "", selectedRawCount: 0, selectedRawPreview: [], curlFound: false, curlNodeInfoCount: 0 }
    };
  }

  const legacySources = [
    data.nodeInfoList,
    data.inputs,
    data.params,
    data.inputParams,
    data.nodeList,
    data.workflow && data.workflow.inputs,
    data.workflow && data.workflow.nodeInfoList,
    data.appInfo && data.appInfo.nodeInfoList,
    data.webappInfo && data.webappInfo.nodeInfoList,
    data.webappInfo && data.webappInfo.nodeList,
    data.workflow && data.workflow.nodeList,
    data.workflow && data.workflow.nodes,
    data.nodeInfo,
    data.nodeInfos,
    data.data && data.data.nodeInfo,
    data.data && data.data.nodeInfos,
    data.data && data.data.nodeInfoList,
    data.data && data.data.inputs,
    data.result && data.result.nodeInfoList,
    data.result && data.result.inputs
  ];

  const legacyCandidates = legacySources
    .map((value, idx) => {
      const list = toInputListFromUnknown(value);
      return {
        path: `legacyCandidate[${idx}]`,
        list,
        inputLikeCount: list.filter(isLikelyInputRecord).length,
        nodeBindingCount: getNodeBindingCount(list)
      };
    })
    .filter((item) => Array.isArray(item.list) && item.list.length > 0);

  const deepCandidates = collectInputCandidates(data, 0, "root", []);
  const candidateList = dedupeCandidates([...legacyCandidates, ...deepCandidates]);
  const selected = candidateList[0] || { path: "", list: [] };
  const rawInputs = Array.isArray(selected.list) ? selected.list : [];

  const primaryInputs = rawInputs
    .map((item, idx) => ({ raw: item, input: normalizeInput(item, idx) }))
    .filter((item) => item && item.input && item.input.key)
    .filter((item) => !isGhostSchemaInput(item.raw, item.input))
    .map((item) => item.input);

  const altCandidates = candidateList.filter((item) => item && item.path && item.path !== selected.path).slice(0, 3);
  const altInputs = altCandidates
    .flatMap((candidate) => {
      const list = Array.isArray(candidate.list) ? candidate.list : [];
      return list
        .map((item, idx) => ({ raw: item, input: normalizeInput(item, idx) }))
        .filter((item) => item && item.input && item.input.key)
        .filter((item) => !isGhostSchemaInput(item.raw, item.input))
        .map((item) => item.input);
    })
    .filter(Boolean);

  const curlDemoText = findCurlDemoText(data);
  const curlNodeInfoList = extractNodeInfoListFromText(curlDemoText);
  const curlInputs = curlNodeInfoList.map((item, idx) => normalizeInput(item, idx)).filter((item) => item.key);
  const fallbackInputs = [...altInputs, ...curlInputs];
  const inputs = mergeInputsWithFallback(primaryInputs, fallbackInputs);

  return {
    payload: {
      name: resolveBestAppName(data, "Unknown App"),
      description: data.description || data.desc || data.summary || "",
      inputs
    },
    debug: {
      candidates: candidateList.map((item) => ({ path: item.path, count: item.list.length, inputLikeCount: item.inputLikeCount || 0 })),
      selectedPath: selected.path || "",
      selectedRawCount: rawInputs.length,
      selectedRawPreview: rawInputs.slice(0, 5).map(sanitizeDebugRawEntry),
      curlFound: Boolean(curlDemoText),
      curlNodeInfoCount: Array.isArray(curlNodeInfoList) ? curlNodeInfoList.length : 0
    }
  };
}

function persistParseDebug(debugPayload) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PARSE_DEBUG_STORAGE_KEY, JSON.stringify(debugPayload));
  } catch (_) {}
}

function buildParseDebugRecord(endpoint, appId, result, source, parseDebug, payload) {
  return {
    endpoint,
    appId,
    topLevelKeys: Object.keys(result || {}),
    dataKeys: source && typeof source === "object" ? Object.keys(source) : [],
    resultKeys: result && result.result && typeof result.result === "object" ? Object.keys(result.result) : [],
    candidateInputArrays: parseDebug.candidates || [],
    selectedCandidatePath: parseDebug.selectedPath || "",
    selectedRawCount: parseDebug.selectedRawCount || 0,
    firstRawEntries: parseDebug.selectedRawPreview || [],
    normalizedInputs: (payload.inputs || []).map((item) => ({
      key: item.key,
      type: inferInputType(item.type || item.fieldType),
      label: item.label || item.name || item.key
    })),
    curl: {
      found: Boolean(parseDebug.curlFound),
      nodeInfoCount: parseDebug.curlNodeInfoCount || 0
    },
    generatedAt: new Date().toISOString()
  };
}

function pushSourceCandidate(bucket, seenMarkers, candidate) {
  if (!candidate || (typeof candidate !== "object" && !Array.isArray(candidate))) return;
  let marker = "";
  if (Array.isArray(candidate)) {
    const first = candidate[0];
    marker = `arr:${candidate.length}:${first && typeof first === "object" ? Object.keys(first).sort().slice(0, 6).join(",") : typeof first}`;
  } else {
    marker = `obj:${Object.keys(candidate).sort().slice(0, 12).join(",")}`;
  }
  if (seenMarkers.has(marker)) return;
  seenMarkers.add(marker);
  bucket.push(candidate);
}

function collectSourceCandidatesFromValue(value, depth = 0, bucket = [], seenMarkers = new Set()) {
  if (depth > 6 || value === null || value === undefined) return bucket;

  if (typeof value === "string") {
    const parsed = parseJsonFromEscapedText(value);
    if (parsed !== undefined) {
      collectSourceCandidatesFromValue(parsed, depth + 1, bucket, seenMarkers);
    }
    return bucket;
  }

  if (Array.isArray(value)) {
    pushSourceCandidate(bucket, seenMarkers, value);
    value.slice(0, 20).forEach((item) => collectSourceCandidatesFromValue(item, depth + 1, bucket, seenMarkers));
    return bucket;
  }

  if (typeof value !== "object") return bucket;
  pushSourceCandidate(bucket, seenMarkers, value);

  const keys = [
    "data",
    "result",
    "payload",
    "content",
    "body",
    "value",
    "appInfo",
    "webappInfo",
    "workflow",
    "nodeInfoList",
    "inputs",
    "params"
  ];
  keys.forEach((key) => {
    if (value[key] !== undefined) collectSourceCandidatesFromValue(value[key], depth + 1, bucket, seenMarkers);
  });

  return bucket;
}

function collectSourceCandidates(result) {
  const bucket = [];
  const seenMarkers = new Set();
  collectSourceCandidatesFromValue(result, 0, bucket, seenMarkers);
  if (result && typeof result === "object") {
    pushSourceCandidate(bucket, seenMarkers, result);
    if (result.data !== undefined) collectSourceCandidatesFromValue(result.data, 0, bucket, seenMarkers);
    if (result.result !== undefined) collectSourceCandidatesFromValue(result.result, 0, bucket, seenMarkers);
  }
  return bucket;
}

function pickBestParsedPayload(candidates) {
  let best = null;
  for (const source of candidates || []) {
    const parsed = extractAppInfoPayload(source);
    const payload = parsed && parsed.payload ? parsed.payload : { name: "Unknown App", description: "", inputs: [] };
    const inputs = Array.isArray(payload.inputs) ? payload.inputs : [];
    const score = inputs.length;
    const rawCount = Number(parsed && parsed.debug && parsed.debug.selectedRawCount) || 0;
    const nameScore = isMeaningfulAppName(payload && payload.name) ? 1 : 0;

    if (!best) {
      best = { source, parsed, payload, score, rawCount, nameScore };
      continue;
    }
    if (score > best.score) {
      best = { source, parsed, payload, score, rawCount, nameScore };
      continue;
    }
    if (score === best.score && nameScore > best.nameScore) {
      best = { source, parsed, payload, score, rawCount, nameScore };
      continue;
    }
    if (score === best.score && nameScore === best.nameScore && rawCount > best.rawCount) {
      best = { source, parsed, payload, score, rawCount, nameScore };
    }
  }
  return best;
}

function hasUsablePayload(result) {
  const candidates = collectSourceCandidates(result);
  const best = pickBestParsedPayload(candidates);
  return Boolean(best && Array.isArray(best.payload && best.payload.inputs) && best.payload.inputs.length > 0);
}

function buildParseUrl(pathname, queryParams) {
  const url = new URL(`${API.BASE_URL}${pathname}`);
  Object.entries(queryParams || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, value);
  });
  return url.toString();
}

function buildFallbackUrls(endpoint, normalizedId) {
  const urls = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  push(`${API.BASE_URL}${endpoint}/${encodeURIComponent(normalizedId)}`);
  push(buildParseUrl(endpoint, { webappId: normalizedId }));
  push(buildParseUrl(endpoint, { webAppId: normalizedId }));
  push(buildParseUrl(endpoint, { appId: normalizedId }));
  push(buildParseUrl(endpoint, { id: normalizedId }));
  return urls;
}

async function fetchAppInfoCore(params = {}) {
  const { appId, apiKey, options = {}, helpers = {} } = params;
  const { fetchImpl, parseJsonResponse, toMessage } = helpers;
  const safeFetch = typeof fetchImpl === "function" ? fetchImpl : fetch;
  const safeParseJsonResponse =
    typeof parseJsonResponse === "function"
      ? parseJsonResponse
      : async (response) => response.json().catch(() => null);
  const safeToMessage = typeof toMessage === "function" ? toMessage : ((result, fallback = "请求失败") => fallback);

  const log = options.log || (() => {});
  const normalizedId = normalizeAppId(appId);
  const reasons = [];
  let lastParseSnapshot = null;

  persistParseDebug({
    endpoint: API.ENDPOINTS.PARSE_APP,
    appId: normalizedId,
    phase: "request_start",
    generatedAt: new Date().toISOString()
  });

  const tryHandleResult = (endpoint, result) => {
    const candidates = collectSourceCandidates(result);
    const best = pickBestParsedPayload(candidates);
    if (!best) return null;

    const payload = best.payload || { name: "Unknown App", description: "", inputs: [] };
    const globalName = resolveBestAppName(result, "");
    if (!isMeaningfulAppName(payload.name) && isMeaningfulAppName(globalName)) {
      payload.name = globalName;
    }
    lastParseSnapshot = buildParseDebugRecord(
      endpoint,
      normalizedId,
      result,
      best.source,
      best.parsed && best.parsed.debug ? best.parsed.debug : {},
      payload
    );
    if (Array.isArray(payload.inputs) && payload.inputs.length > 0) {
      persistParseDebug(lastParseSnapshot);
      return payload;
    }
    return null;
  };

  const parseGetVariants = [
    { apiKey, webappId: normalizedId },
    { apiKey, webAppId: normalizedId },
    { apiKey, appId: normalizedId },
    { apikey: apiKey, webappId: normalizedId }
  ];
  for (const query of parseGetVariants) {
    try {
      log(`解析应用: ${API.ENDPOINTS.PARSE_APP}`, "info");
      const response = await safeFetch(buildParseUrl(API.ENDPOINTS.PARSE_APP, query), {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
      });
      const result = await safeParseJsonResponse(response);
      const payload = tryHandleResult(API.ENDPOINTS.PARSE_APP, result);
      if (payload) return payload;

      if (response.ok && (result && (result.code === 0 || result.success === true || hasUsablePayload(result)))) {
        const retryPayload = tryHandleResult(API.ENDPOINTS.PARSE_APP, result);
        if (retryPayload) return retryPayload;
      }
      reasons.push(`apiCallDemo(GET): ${safeToMessage(result, `HTTP ${response.status}`)}`);
    } catch (error) {
      reasons.push(`apiCallDemo(GET): ${error.message}`);
    }
  }

  const parsePostVariants = [
    { apiKey, webappId: normalizedId },
    { apiKey, webAppId: normalizedId },
    { apiKey, appId: normalizedId }
  ];
  for (const body of parsePostVariants) {
    try {
      const response = await safeFetch(`${API.BASE_URL}${API.ENDPOINTS.PARSE_APP}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await safeParseJsonResponse(response);
      const payload = tryHandleResult(API.ENDPOINTS.PARSE_APP, result);
      if (payload) return payload;
      reasons.push(`apiCallDemo(POST): ${safeToMessage(result, `HTTP ${response.status}`)}`);
    } catch (error) {
      reasons.push(`apiCallDemo(POST): ${error.message}`);
    }
  }

  for (const endpoint of API.PARSE_FALLBACKS) {
    const urls = buildFallbackUrls(endpoint, normalizedId);
    for (const url of urls) {
      try {
        log(`解析应用回退: ${endpoint}`, "info");
        const response = await safeFetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
        });
        const result = await safeParseJsonResponse(response);
        const payload = tryHandleResult(endpoint, result);
        if (payload) return payload;
        if (response.ok && (result && (result.code === 0 || result.success === true || hasUsablePayload(result)))) {
          const retryPayload = tryHandleResult(endpoint, result);
          if (retryPayload) return retryPayload;
        }
        reasons.push(`${endpoint}: ${safeToMessage(result, `HTTP ${response.status}`)}`);
      } catch (error) {
        reasons.push(`${endpoint}: ${error.message}`);
      }
    }
  }

  const message = reasons[0] || "自动解析失败：未识别到可用输入参数";
  if (lastParseSnapshot) {
    persistParseDebug({
      ...lastParseSnapshot,
      phase: "request_failed",
      message,
      generatedAt: new Date().toISOString()
    });
  } else {
    persistParseDebug({
      endpoint: API.ENDPOINTS.PARSE_APP,
      appId: normalizedId,
      phase: "request_failed",
      message,
      generatedAt: new Date().toISOString()
    });
  }
  throw new Error(message);
}

module.exports = {
  fetchAppInfoCore
};
