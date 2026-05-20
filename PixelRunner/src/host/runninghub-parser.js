const API_BASE_URL = "https://www.runninghub.cn";
const PARSE_ENDPOINT = "/api/webapp/apiCallDemo";
const PARSE_FALLBACKS = ["/uc/openapi/app", "/uc/openapi/community/app", "/uc/openapi/workflow"];
const PARSE_DEBUG_STORAGE_KEY = "rh_last_parse_debug";

function normalizeAppId(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (!/[/?#]/.test(value) && !value.includes("runninghub.cn")) return value;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch (_) {}

  try {
    const url = new URL(decoded);
    const keys = ["webappId", "webappid", "appId", "appid", "workflowId", "workflowid", "id", "code"];
    for (const key of keys) {
      const nextValue = url.searchParams.get(key);
      if (nextValue && nextValue.trim()) return nextValue.trim();
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length > 0) {
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index].toLowerCase();
        if (["app", "workflow", "community", "detail"].includes(segment) && segments[index + 1]) {
          return segments[index + 1].trim();
        }
      }
      return segments[segments.length - 1].trim();
    }
  } catch (_) {}

  const numeric = decoded.match(/\d{5,}/);
  return numeric ? numeric[0] : value;
}

function inferInputType(rawType) {
  const marker = String(rawType || "").toLowerCase();
  if (marker.includes("image") || marker.includes("file") || marker.includes("img")) return "image";
  if (marker.includes("number") || marker.includes("int") || marker.includes("float") || marker.includes("slider")) return "number";
  if (marker === "list") return "select";
  if (marker.includes("select") || marker.includes("enum") || marker.includes("option")) return "select";
  if (marker.includes("bool") || marker.includes("checkbox") || marker.includes("toggle")) return "boolean";
  if (marker.includes("switch")) return "select";
  return "text";
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
    text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\"/g, '"'),
    text.replace(/\\u0022/g, '"')
  ];

  for (const candidate of candidates) {
    const parsed = parseJsonText(candidate);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function createParseError(message, options = {}) {
  const error = new Error(String(message || "应用解析失败"));
  error.code = "PARSE_APP_FAILED";
  error.appId = String(options.appId || "");
  error.endpoint = String(options.endpoint || "");
  error.retryable = true;
  error.reasons = Array.isArray(options.reasons) ? options.reasons.map((item) => String(item)) : [];
  return error;
}

function persistParseDebug(record) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PARSE_DEBUG_STORAGE_KEY, JSON.stringify(record));
  } catch (_) {}
}

function buildParseUrl(pathname, queryParams) {
  const url = new URL(`${API_BASE_URL}${pathname}`);
  Object.entries(queryParams || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, value);
  });
  return url.toString();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let result = null;

  try {
    result = text ? JSON.parse(text) : null;
  } catch (_) {
    result = { rawText: text };
  }

  return { ok: response.ok, status: response.status, result };
}

function normalizeFieldToken(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isWeakLabel(label) {
  const text = String(label || "").trim().toLowerCase();
  if (!text) return true;
  return ["value", "text", "string", "number", "int", "float", "double", "bool", "boolean"].includes(text);
}

function resolveDisplayLabel({ key, fieldName, rawLabel, rawName }) {
  const preferred = String(rawLabel || rawName || "").trim();
  if (preferred && !isWeakLabel(preferred)) {
    return { label: preferred, source: "raw", confidence: 1 };
  }

  const labelMap = {
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

  const candidates = [fieldName, key, key && String(key).includes(":") ? String(key).split(":").pop() : ""];
  for (const item of candidates) {
    const mapped = labelMap[normalizeFieldToken(item)];
    if (mapped) return { label: mapped, source: "map", confidence: 0.6 };
  }

  const fallback = preferred || String(fieldName || key || "").trim();
  return { label: fallback, source: "fallback", confidence: 0.4 };
}

function resolveFieldDataLabel(fieldData) {
  if (!fieldData) return "";
  let parsed = fieldData;
  if (typeof fieldData === "string") parsed = parseJsonFromEscapedText(fieldData);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  if (Array.isArray(parsed.options) || Array.isArray(parsed.items) || Array.isArray(parsed.values)) return "";
  return String(parsed.label || parsed.name || parsed.title || parsed.description || "").trim();
}

function parseBooleanLike(value) {
  if (value === true || value === false) return value;
  const marker = String(value == null ? "" : value).trim().toLowerCase();
  if (!marker) return null;
  if (["true", "1", "yes", "y", "on", "是"].includes(marker)) return true;
  if (["false", "0", "no", "n", "off", "否"].includes(marker)) return false;
  return null;
}

function normalizeOptionText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value !== "object" || Array.isArray(value)) return "";

  const keys = ["value", "optionValue", "enumValue", "id", "key", "code", "index", "fastIndex", "name", "label", "title", "text"];
  for (const key of keys) {
    const nextValue = value[key];
    if (typeof nextValue === "string" || typeof nextValue === "number" || typeof nextValue === "boolean") {
      const text = String(nextValue).trim();
      if (text) return text;
    }
  }
  return "";
}

function extractOptionEntries(raw, depth = 0) {
  if (depth > 8 || raw === undefined || raw === null) return [];

  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];

    const parsed = parseJsonFromEscapedText(text);
    if (parsed !== undefined) return extractOptionEntries(parsed, depth + 1);

    if (text.includes("|") || text.includes(",") || text.includes("\n")) {
      return text
        .split(/[|,\r\n]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => ({ value: item, label: item }));
    }
    return [{ value: text, label: text }];
  }

  if (typeof raw === "number" || typeof raw === "boolean") {
    return [{ value: raw, label: String(raw) }];
  }

  if (Array.isArray(raw)) {
    return raw.flatMap((item) => extractOptionEntries(item, depth + 1));
  }

  if (typeof raw !== "object") return [];

  const containerKeys = ["options", "enums", "values", "items", "list", "data", "children", "selectOptions", "optionList", "fieldOptions"];
  const valueKeys = ["value", "optionValue", "enumValue", "id", "key", "code", "index", "fastIndex", "name", "label", "title", "text"];
  const labelKeys = ["label", "title", "text", "description", "descriptionCn", "descriptionEn", "name", "value", "index", "id", "key"];

  const collected = [];
  let hasContainer = false;

  for (const key of containerKeys) {
    if (raw[key] === undefined) continue;
    hasContainer = true;
    collected.push(...extractOptionEntries(raw[key], depth + 1));
  }

  const nextValue = valueKeys.map((key) => raw[key]).find((item) => item !== undefined && item !== null && String(item).trim() !== "");
  const nextLabel = labelKeys.map((key) => raw[key]).find((item) => item !== undefined && item !== null && String(item).trim() !== "");

  if (nextValue !== undefined || nextLabel !== undefined) {
    collected.push({
      value: nextValue !== undefined ? nextValue : nextLabel,
      label: String(nextLabel !== undefined ? nextLabel : nextValue)
    });
  }

  if (!hasContainer) {
    Object.values(raw).forEach((value) => {
      if (!value || typeof value !== "object") return;
      collected.push(...extractOptionEntries(value, depth + 1));
    });
  }

  const seen = new Set();
  return collected.filter((item) => {
    const value = normalizeOptionText(item && item.value);
    if (!value) return false;
    const marker = value.toLowerCase();
    if (seen.has(marker)) return false;
    seen.add(marker);
    item.value = value;
    item.label = normalizeOptionText(item.label) || value;
    return true;
  });
}

function resolveInputType(input) {
  const rawType = inferInputType(input && (input.type || input.fieldType));
  const entries = extractOptionEntries(input && input.options);
  const optionValues = entries.map((entry) => entry.value);
  const optionBooleans = optionValues.length > 0 && optionValues.every((item) => parseBooleanLike(item) !== null);
  const optionNumbers = optionValues.length > 0 && optionValues.every((item) => /^-?\d+(?:\.\d+)?$/.test(String(item)));
  const defaultValue = input && input.default;
  const defaultBoolean = parseBooleanLike(defaultValue) !== null;
  const defaultNumber = defaultValue !== undefined && defaultValue !== null && /^-?\d+(?:\.\d+)?$/.test(String(defaultValue).trim());
  const fieldType = String((input && input.fieldType) || "");
  const numericHint = /(?:^|[^a-z])(int|integer|float|double|decimal|number)(?:[^a-z]|$)/i.test(fieldType);
  const booleanHint = /(?:^|[^a-z])(bool|boolean|checkbox|toggle|switch)(?:[^a-z]|$)/i.test(fieldType);

  if (rawType === "image" || rawType === "number") return rawType;
  if (rawType === "select") {
    if (optionBooleans) return "boolean";
    if (entries.length > 0) return "select";
    if (defaultBoolean && booleanHint) return "boolean";
    if (defaultNumber && numericHint) return "number";
    return "text";
  }
  if (rawType === "boolean") {
    if (optionNumbers) return "number";
    if (optionBooleans || defaultBoolean || booleanHint) return "boolean";
    return "boolean";
  }
  if (rawType === "text" && entries.length > 1) {
    if (optionBooleans) return "boolean";
    return "select";
  }
  if (rawType === "text" && numericHint) return "number";
  if (rawType === "text" && (optionBooleans || (booleanHint && defaultBoolean))) return "boolean";
  return rawType;
}

function isPromptLikeText(text) {
  return /prompt|提示词|negative|正向|负向/i.test(String(text || ""));
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
  const keys = ["required", "isRequired", "must", "need", "needRequired", "mandatory"];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(raw || {}, key)) continue;
    const parsed = parseExplicitRequired(raw[key]);
    if (parsed !== null) return { required: parsed, explicit: true };
  }
  if (type === "image") return { required: false, explicit: false };
  return { required: true, explicit: false };
}

function normalizeInput(raw, index = 0) {
  const source = raw && typeof raw === "object" ? raw : {};
  const nodeId = String(source.nodeId || source.nodeID || source.node || source.node_id || "").trim();
  const fieldName = String(source.fieldName || source.field || source.name || "").trim();
  const derivedKey = nodeId && fieldName ? `${nodeId}:${fieldName}` : "";
  const key = String(source.key || source.paramKey || derivedKey || source.fieldName || `param_${index + 1}`).trim();

  let options = [
    ...extractOptionEntries(source.options),
    ...extractOptionEntries(source.enums),
    ...extractOptionEntries(source.values),
    ...extractOptionEntries(source.selectOptions),
    ...extractOptionEntries(source.optionList),
    ...extractOptionEntries(source.fieldOptions)
  ];

  if (options.length === 0) {
    options = extractOptionEntries(source.fieldData);
  }

  const normalizedOptions = [];
  const seen = new Set();
  options.forEach((item) => {
    const value = normalizeOptionText(item && item.value);
    if (!value) return;
    const marker = value.toLowerCase();
    if (seen.has(marker)) return;
    seen.add(marker);
    normalizedOptions.push({ value, label: normalizeOptionText(item.label) || value });
  });

  const hintText = `${key} ${source.fieldName || ""} ${source.label || ""} ${source.name || ""} ${source.description || ""}`;
  const looksPromptLike = isPromptLikeText(hintText);
  const provisionalType = resolveInputType({
    type: inferInputType(source.type || source.valueType || source.widget || source.inputType || source.fieldType),
    fieldType: source.fieldType,
    options: normalizedOptions,
    default: source.default ?? source.fieldValue
  });
  const type = looksPromptLike ? "text" : provisionalType;

  const fieldDataLabel = resolveFieldDataLabel(source.fieldData);
  const baseName = String(source.name || source.label || source.title || fieldDataLabel || source.description || fieldName || key).trim();
  const baseLabel = String(source.label || source.name || source.title || fieldDataLabel || source.description || fieldName || key).trim();
  const labelMeta = resolveDisplayLabel({
    key,
    fieldName,
    rawLabel: baseLabel,
    rawName: baseName
  });
  const requiredSpec = resolveRequiredSpec(source, type);

  return {
    key,
    name: baseName,
    label: labelMeta.label || baseLabel || baseName || key,
    type,
    required: requiredSpec.required,
    requiredExplicit: requiredSpec.explicit,
    default: source.default ?? source.fieldValue,
    options: type === "select" && normalizedOptions.length > 0 ? normalizedOptions : undefined,
    nodeId: nodeId || undefined,
    fieldName: fieldName || undefined,
    fieldType: source.fieldType || undefined,
    fieldData: source.fieldData || undefined,
    labelSource: labelMeta.source,
    labelConfidence: labelMeta.confidence
  };
}

function isGhostSchemaInput(raw, input) {
  if (!raw || !input) return false;
  const hint = `${input.key || ""} ${input.fieldName || ""} ${input.label || ""}`;
  if (!isPromptLikeText(hint)) return false;

  const hasBinding = Boolean(String(input.nodeId || "").trim() && String(input.fieldName || "").trim());
  if (hasBinding) return false;

  const rawType = String(raw.type || raw.valueType || raw.widget || raw.inputType || raw.fieldType || "").toLowerCase();
  const defaultMarker = String(input.default || "").trim().toLowerCase();
  return /string|text|schema/.test(rawType) && (!input.options || input.options.length <= 1) && /string|text/.test(defaultMarker || rawType);
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
  const primary = Array.isArray(primaryInputs) ? primaryInputs : [];
  const fallback = Array.isArray(fallbackInputs) ? fallbackInputs : [];
  if (primary.length === 0) return fallback;
  if (fallback.length === 0) return primary;

  const fallbackMap = new Map();
  fallback.forEach((item) => {
    const marker = buildInputMergeKey(item);
    if (!marker || fallbackMap.has(marker)) return;
    fallbackMap.set(marker, item);
  });

  const merged = primary.map((input) => {
    const marker = buildInputMergeKey(input);
    const alt = marker ? fallbackMap.get(marker) : null;
    if (!alt) return input;

    const needsOptions =
      input.type === "select" &&
      (!Array.isArray(input.options) || input.options.length <= 1) &&
      Array.isArray(alt.options) &&
      alt.options.length > 1;
    const betterLabel =
      typeof alt.labelConfidence === "number" &&
      (!input.labelConfidence || alt.labelConfidence > input.labelConfidence + 0.2) &&
      !isWeakLabel(alt.label);

    if (!needsOptions && !betterLabel) return input;
    return {
      ...input,
      options: needsOptions ? alt.options : input.options,
      label: betterLabel ? alt.label : input.label,
      labelSource: betterLabel ? alt.labelSource : input.labelSource,
      labelConfidence: betterLabel ? alt.labelConfidence : input.labelConfidence
    };
  });

  const seen = new Set(merged.map((item) => buildInputMergeKey(item)).filter(Boolean));
  fallback.forEach((item) => {
    const marker = buildInputMergeKey(item);
    if (!marker || seen.has(marker)) return;
    merged.push(item);
    seen.add(marker);
  });
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

function buildSourceCandidateMarker(candidate) {
  if (Array.isArray(candidate)) {
    const first = candidate[0];
    const firstShape =
      first && typeof first === "object" ? Object.keys(first).sort().slice(0, 6).join(",") : typeof first;
    return `arr:${candidate.length}:${firstShape}`;
  }
  return `obj:${Object.keys(candidate || {}).sort().slice(0, 12).join(",")}`;
}

function collectSourceCandidatesFromValue(value, depth = 0, bucket = [], seen = new Set()) {
  if (depth > 6 || value === undefined || value === null) return bucket;

  if (typeof value === "string") {
    const parsed = parseJsonFromEscapedText(value);
    if (parsed !== undefined) collectSourceCandidatesFromValue(parsed, depth + 1, bucket, seen);
    return bucket;
  }

  if (Array.isArray(value)) {
    const marker = buildSourceCandidateMarker(value);
    if (!seen.has(marker)) {
      seen.add(marker);
      bucket.push(value);
    }
    value.slice(0, 20).forEach((item) => collectSourceCandidatesFromValue(item, depth + 1, bucket, seen));
    return bucket;
  }

  if (typeof value !== "object") return bucket;

  const marker = buildSourceCandidateMarker(value);
  if (!seen.has(marker)) {
    seen.add(marker);
    bucket.push(value);
  }

  ["data", "result", "payload", "content", "body", "value", "appInfo", "webappInfo", "workflow", "nodeInfoList", "inputs", "params"].forEach((key) => {
    if (value[key] !== undefined) collectSourceCandidatesFromValue(value[key], depth + 1, bucket, seen);
  });
  return bucket;
}

function isLikelyInputRecord(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  if (String(item.key || item.paramKey || "").trim()) return true;
  if (String(item.fieldName || "").trim()) return true;
  if (String(item.nodeId || item.nodeID || "").trim() && String(item.fieldName || "").trim()) return true;
  if (item.fieldData !== undefined && (item.fieldName || item.key || item.paramKey)) return true;
  if ((item.default !== undefined || item.fieldValue !== undefined) && (item.name || item.label || item.fieldName || item.key)) return true;
  return Boolean(String(item.type || item.fieldType || item.inputType || item.widget || item.valueType || "").trim());
}

function toInputListFromUnknown(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const values = Object.values(value);
  const inputLike = values.filter(isLikelyInputRecord);
  return inputLike.length > 0 ? inputLike : [];
}

function getNodeBindingCount(list) {
  if (!Array.isArray(list)) return 0;
  return list.reduce((count, item) => {
    if (!item || typeof item !== "object") return count;
    return String(item.nodeId || item.nodeID || "").trim() && String(item.fieldName || item.field || "").trim() ? count + 1 : count;
  }, 0);
}

function collectInputCandidates(source, depth = 0, path = "root", out = []) {
  if (!source || depth > 8) return out;
  if (Array.isArray(source)) {
    const inputLikeCount = source.filter(isLikelyInputRecord).length;
    if (source.length > 0 && inputLikeCount > 0) {
      out.push({ path, list: source, inputLikeCount, nodeBindingCount: getNodeBindingCount(source) });
    }
    source.forEach((item, index) => collectInputCandidates(item, depth + 1, `${path}[${index}]`, out));
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

  Object.entries(source).forEach(([key, value]) => {
    collectInputCandidates(value, depth + 1, `${path}.${key}`, out);
  });
  return out;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return (candidates || [])
    .filter((item) => item && Array.isArray(item.list) && item.list.length > 0)
    .filter((item) => {
      const marker = `${item.path}|${item.list.length}|${item.inputLikeCount || 0}`;
      if (seen.has(marker)) return false;
      seen.add(marker);
      return true;
    })
    .sort((a, b) => {
      if ((b.nodeBindingCount || 0) !== (a.nodeBindingCount || 0)) return (b.nodeBindingCount || 0) - (a.nodeBindingCount || 0);
      if ((b.inputLikeCount || 0) !== (a.inputLikeCount || 0)) return (b.inputLikeCount || 0) - (a.inputLikeCount || 0);
      return b.list.length - a.list.length;
    });
}

function collectAppNameCandidates(value, depth = 0, bucket = [], seen = new Set(), parentKey = "") {
  if (depth > 8 || value === undefined || value === null) return bucket;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const key = normalizeFieldToken(parentKey);
    if (["name", "title", "appname", "webappname", "workflowname", "displayname"].includes(key)) {
      const text = String(value).trim();
      if (text && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase());
        const weights = { webappname: 50, appname: 46, workflowname: 44, displayname: 42, title: 38, name: 34 };
        bucket.push({ value: text, depth, score: (weights[key] || 20) + Math.min(12, text.length) - depth });
      }
    }

    if (typeof value === "string") {
      const parsed = parseJsonFromEscapedText(value);
      if (parsed !== undefined) collectAppNameCandidates(parsed, depth + 1, bucket, seen, "");
    }
    return bucket;
  }

  if (Array.isArray(value)) {
    value.slice(0, 30).forEach((item) => collectAppNameCandidates(item, depth + 1, bucket, seen, parentKey));
    return bucket;
  }

  if (typeof value !== "object") return bucket;

  ["webappName", "appName", "workflowName", "displayName", "title", "name"].forEach((key) => {
    if (value[key] !== undefined) collectAppNameCandidates(value[key], depth, bucket, seen, key);
  });

  Object.entries(value).forEach(([key, child]) => collectAppNameCandidates(child, depth + 1, bucket, seen, key));
  return bucket;
}

function resolveBestAppName(data) {
  const candidates = collectAppNameCandidates(data, 0, [], new Set(), "");
  candidates.sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return (a.depth || 0) - (b.depth || 0);
  });
  return candidates[0] && candidates[0].value ? candidates[0].value : "未命名应用";
}

function extractNodeInfoListFromText(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) return [];
  const parsed = parseJsonFromEscapedText(rawText);
  if (parsed && Array.isArray(parsed.nodeInfoList)) return parsed.nodeInfoList;

  const fragment = rawText.match(/"nodeInfoList"\s*:\s*(\[[\s\S]*?\])\s*(?:,|\})/);
  if (!fragment || !fragment[1]) return [];
  const list = parseJsonFromEscapedText(fragment[1]);
  return Array.isArray(list) ? list : [];
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

function extractAppInfoPayload(data) {
  if (typeof data === "string") {
    const parsedString = parseJsonFromEscapedText(data);
    if (parsedString && typeof parsedString === "object") return extractAppInfoPayload(parsedString);
  }

  if (!data || typeof data !== "object") {
    return {
      payload: { name: "未命名应用", description: "", inputs: [] },
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
    .map((value, index) => {
      const list = toInputListFromUnknown(value);
      return {
        path: `legacyCandidate[${index}]`,
        list,
        inputLikeCount: list.filter(isLikelyInputRecord).length,
        nodeBindingCount: getNodeBindingCount(list)
      };
    })
    .filter((item) => Array.isArray(item.list) && item.list.length > 0);

  const candidateList = dedupeCandidates([...legacyCandidates, ...collectInputCandidates(data, 0, "root", [])]);
  const selected = candidateList[0] || { path: "", list: [] };
  const rawInputs = Array.isArray(selected.list) ? selected.list : [];

  const primaryInputs = rawInputs
    .map((item, index) => ({ raw: item, input: normalizeInput(item, index) }))
    .filter((item) => item && item.input && item.input.key)
    .filter((item) => !isGhostSchemaInput(item.raw, item.input))
    .map((item) => item.input);

  const altInputs = candidateList
    .filter((item) => item && item.path && item.path !== selected.path)
    .slice(0, 3)
    .flatMap((candidate) =>
      (candidate.list || [])
        .map((item, index) => ({ raw: item, input: normalizeInput(item, index) }))
        .filter((item) => item && item.input && item.input.key)
        .filter((item) => !isGhostSchemaInput(item.raw, item.input))
        .map((item) => item.input)
    );

  const curlDemoText = findCurlDemoText(data);
  const curlNodeInfoList = extractNodeInfoListFromText(curlDemoText);
  const curlInputs = curlNodeInfoList.map((item, index) => normalizeInput(item, index)).filter((item) => item.key);
  const inputs = mergeInputsWithFallback(primaryInputs, [...altInputs, ...curlInputs]);

  return {
    payload: {
      name: resolveBestAppName(data),
      description: String(data.description || data.desc || data.summary || "").trim(),
      inputs
    },
    debug: {
      candidates: candidateList.map((item) => ({ path: item.path, count: item.list.length, inputLikeCount: item.inputLikeCount || 0 })),
      selectedPath: selected.path || "",
      selectedRawCount: rawInputs.length,
      selectedRawPreview: rawInputs.slice(0, 5).map(sanitizeDebugRawEntry),
      curlFound: Boolean(curlDemoText),
      curlNodeInfoCount: curlNodeInfoList.length
    }
  };
}

function pickBestParsedPayload(candidates) {
  let best = null;
  (candidates || []).forEach((source) => {
    const parsed = extractAppInfoPayload(source);
    const payload = parsed && parsed.payload ? parsed.payload : { name: "未命名应用", description: "", inputs: [] };
    const inputs = Array.isArray(payload.inputs) ? payload.inputs : [];
    const score = inputs.length;
    const rawCount = Number(parsed && parsed.debug && parsed.debug.selectedRawCount) || 0;
    const nameScore = payload && payload.name && payload.name !== "未命名应用" ? 1 : 0;

    if (!best || score > best.score || (score === best.score && nameScore > best.nameScore) || (score === best.score && nameScore === best.nameScore && rawCount > best.rawCount)) {
      best = { source, parsed, payload, score, rawCount, nameScore };
    }
  });
  return best;
}

function buildFallbackUrls(endpoint, normalizedId) {
  const urls = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  push(`${API_BASE_URL}${endpoint}/${encodeURIComponent(normalizedId)}`);
  push(buildParseUrl(endpoint, { webappId: normalizedId }));
  push(buildParseUrl(endpoint, { webAppId: normalizedId }));
  push(buildParseUrl(endpoint, { appId: normalizedId }));
  push(buildParseUrl(endpoint, { id: normalizedId }));
  return urls;
}

function buildDebugRecord(endpoint, appId, result, best) {
  const payload = best && best.payload ? best.payload : { inputs: [] };
  const source = best && best.source ? best.source : null;
  const debug = best && best.parsed && best.parsed.debug ? best.parsed.debug : {};

  return {
    endpoint,
    appId,
    topLevelKeys: Object.keys(result || {}),
    dataKeys: source && typeof source === "object" ? Object.keys(source) : [],
    selectedCandidatePath: debug.selectedPath || "",
    selectedRawCount: debug.selectedRawCount || 0,
    firstRawEntries: debug.selectedRawPreview || [],
    normalizedInputs: (payload.inputs || []).map((item) => ({
      key: item.key,
      type: inferInputType(item.type || item.fieldType),
      label: item.label || item.name || item.key
    })),
    curl: {
      found: Boolean(debug.curlFound),
      nodeInfoCount: debug.curlNodeInfoCount || 0
    },
    generatedAt: new Date().toISOString()
  };
}

function resolveMessage(result, fallback) {
  return String((result && (result.message || result.msg || result.error)) || fallback);
}

export async function parseRunningHubApp(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || "").trim();
  const preferredName = String(payload.preferredName || "").trim();
  const normalizedId = normalizeAppId(payload.appId);

  if (!normalizedId) throw new Error("请先输入有效的应用 ID 或 URL");
  if (!apiKey) throw new Error("请先在设置页保存 RunningHub API Key");

  persistParseDebug({
    endpoint: PARSE_ENDPOINT,
    appId: normalizedId,
    phase: "request_start",
    generatedAt: new Date().toISOString()
  });

  const reasons = [];
  let lastDebugRecord = null;

  const tryHandleResult = (endpoint, result) => {
    const candidates = collectSourceCandidatesFromValue(result, 0, [], new Set());
    const best = pickBestParsedPayload(candidates);
    if (!best) return null;

    const nextPayload = {
      ...best.payload,
      appId: normalizedId,
      name: preferredName || best.payload.name || "未命名应用"
    };

    lastDebugRecord = buildDebugRecord(endpoint, normalizedId, result, best);
    if (Array.isArray(nextPayload.inputs) && nextPayload.inputs.length > 0) {
      persistParseDebug(lastDebugRecord);
      return nextPayload;
    }
    return null;
  };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };

  const getVariants = [
    { apiKey, webappId: normalizedId },
    { apiKey, webAppId: normalizedId },
    { apiKey, appId: normalizedId },
    { apikey: apiKey, webappId: normalizedId }
  ];

  for (const query of getVariants) {
    try {
      const { ok, status, result } = await fetchJson(buildParseUrl(PARSE_ENDPOINT, query), { method: "GET", headers });
      const parsed = tryHandleResult(PARSE_ENDPOINT, result);
      if (parsed) {
        return { ok: true, appId: normalizedId, name: parsed.name, description: parsed.description || "", inputs: parsed.inputs, source: "remote-parse" };
      }
      reasons.push(`apiCallDemo(GET): ${resolveMessage(result, `HTTP ${status}`)}`);
      if (ok && result && (result.code === 0 || result.success === true)) {
        const retry = tryHandleResult(PARSE_ENDPOINT, result);
        if (retry) {
          return { ok: true, appId: normalizedId, name: retry.name, description: retry.description || "", inputs: retry.inputs, source: "remote-parse" };
        }
      }
    } catch (error) {
      reasons.push(`apiCallDemo(GET): ${error.message}`);
    }
  }

  const postVariants = [
    { apiKey, webappId: normalizedId },
    { apiKey, webAppId: normalizedId },
    { apiKey, appId: normalizedId }
  ];

  for (const body of postVariants) {
    try {
      const { status, result } = await fetchJson(`${API_BASE_URL}${PARSE_ENDPOINT}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
      const parsed = tryHandleResult(PARSE_ENDPOINT, result);
      if (parsed) {
        return { ok: true, appId: normalizedId, name: parsed.name, description: parsed.description || "", inputs: parsed.inputs, source: "remote-parse" };
      }
      reasons.push(`apiCallDemo(POST): ${resolveMessage(result, `HTTP ${status}`)}`);
    } catch (error) {
      reasons.push(`apiCallDemo(POST): ${error.message}`);
    }
  }

  for (const endpoint of PARSE_FALLBACKS) {
    for (const url of buildFallbackUrls(endpoint, normalizedId)) {
      try {
        const { ok, status, result } = await fetchJson(url, { method: "GET", headers });
        const parsed = tryHandleResult(endpoint, result);
        if (parsed) {
          return { ok: true, appId: normalizedId, name: parsed.name, description: parsed.description || "", inputs: parsed.inputs, source: "remote-parse" };
        }
        reasons.push(`${endpoint}: ${resolveMessage(result, `HTTP ${status}`)}`);
        if (ok && result && (result.code === 0 || result.success === true)) {
          const retry = tryHandleResult(endpoint, result);
          if (retry) {
            return { ok: true, appId: normalizedId, name: retry.name, description: retry.description || "", inputs: retry.inputs, source: "remote-parse" };
          }
        }
      } catch (error) {
        reasons.push(`${endpoint}: ${error.message}`);
      }
    }
  }

  const message = reasons[0] || "自动解析失败：未识别到可用输入参数";
  persistParseDebug({
    ...(lastDebugRecord || {}),
    endpoint: PARSE_ENDPOINT,
    appId: normalizedId,
    phase: "request_failed",
    message,
    reasons,
    generatedAt: new Date().toISOString()
  });

  throw createParseError(message, { appId: normalizedId, endpoint: PARSE_ENDPOINT, reasons });
}
