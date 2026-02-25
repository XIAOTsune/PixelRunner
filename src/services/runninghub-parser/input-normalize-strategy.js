const { inferInputType } = require("../../utils");
const { resolveInputType } = require("../../shared/input-schema");
const { parseJsonFromEscapedText } = require("./json-utils");
const {
  isWeakLabel,
  resolveDisplayLabel,
  resolveFieldDataLabel
} = require("./label-strategy");

const DEFAULT_FIELD_LABEL_MAP = {
  aspectratio: "\u6bd4\u4f8b",
  resolution: "\u5206\u8fa8\u7387",
  channel: "\u901a\u9053",
  prompt: "\u63d0\u793a\u8bcd",
  negativeprompt: "\u53cd\u5411\u63d0\u793a\u8bcd",
  seed: "\u968f\u673a\u79cd\u5b50",
  steps: "\u6b65\u6570",
  cfg: "CFG",
  cfgscale: "CFG \u5f3a\u5ea6",
  sampler: "\u91c7\u6837\u5668",
  scheduler: "\u8c03\u5ea6\u5668",
  width: "\u5bbd\u5ea6",
  height: "\u9ad8\u5ea6",
  model: "\u6a21\u578b",
  style: "\u98ce\u683c",
  strength: "\u5f3a\u5ea6",
  denoise: "\u964d\u566a\u5f3a\u5ea6"
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

const OPTION_IGNORE_MARKERS = new Set(["ignore", "ignored", "\u5ffd\u7565"]);
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

    const label =
      item.description ||
      item.descriptionCn ||
      item.descriptionEn ||
      item.label ||
      item.name ||
      item.title ||
      item.text ||
      value;
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
      const tokens = text
        .split(/[|,\r\n]+/)
        .map((x) => x.trim())
        .filter(Boolean);
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
      optionLikeKeys.forEach((key) => pushOptionValue(bucket, seen, key));
    }

    const primitiveValues = keys
      .map((key) => source[key])
      .filter((value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean");
    if (primitiveValues.length >= 2) {
      primitiveValues.forEach((value) => pushOptionValue(bucket, seen, value));
    }

    const nestedValues = keys.map((key) => source[key]).filter((value) => value && (Array.isArray(value) || typeof value === "object"));
    if (nestedValues.length > 0) {
      nestedValues.forEach((value) => collectOptionValues(value, bucket, seen, depth + 1));
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
  const preferAspect = /aspect|ratio|\u6bd4\u4f8b/.test(hint);
  const preferResolution = /resolution|\u5206\u8fa8\u7387/.test(hint);
  if (!preferAspect && !preferResolution) return [];

  if (preferAspect) {
    if (/\bauto\b/i.test(text) || /\u81ea\u52a8/.test(text)) {
      pushUniqueText(bucket, seen, "auto");
    }
    const ratioMatches = text.match(/\b\d{1,2}\s*:\s*\d{1,2}\b/g) || [];
    ratioMatches.forEach((match) => pushUniqueText(bucket, seen, match.replace(/\s+/g, "")));
  }

  if (preferResolution) {
    const kMatches = text.match(/\b\d+(?:\.\d+)?k\b/gi) || [];
    const sizeMatches = text.match(/\b\d{3,5}\s*[xX]\s*\d{3,5}\b/g) || [];
    kMatches.forEach((match) => pushUniqueText(bucket, seen, match.toLowerCase()));
    sizeMatches.forEach((match) => pushUniqueText(bucket, seen, match.replace(/\s+/g, "").toLowerCase()));
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
  return /prompt|\u63d0\u793a\u8bcd|negative|\u6b63\u5411|\u8d1f\u5411/.test(hint);
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
  const markers = new Set(["true", "false", "yes", "no", "\u662f", "\u5426"]);
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

function normalizeDefaultValueByType(value, type) {
  if (type === "number" && value !== undefined && value !== null && String(value).trim() !== "") {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  if (type === "boolean") {
    if (value === true || value === false) return value;
    const marker = String(value || "")
      .trim()
      .toLowerCase();
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
  const marker = String(value || "")
    .trim()
    .toLowerCase();
  if (!marker) return false;
  if (["true", "1", "yes", "y", "on", "required", "\u662f"].includes(marker)) return true;
  if (["false", "0", "no", "n", "off", "optional", "\u5426"].includes(marker)) return false;
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

function normalizeInput(raw, index = 0, options = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const nodeId = String(source.nodeId || source.nodeID || source.node || source.node_id || "").trim();
  const fieldName = String(source.fieldName || source.field || source.name || "").trim();
  const derivedKey = nodeId && fieldName ? `${nodeId}:${fieldName}` : "";
  const key = String(source.key || source.paramKey || derivedKey || source.fieldName || `param_${index + 1}`).trim();
  const explicitOptionFields = [
    parseFieldOptions(source.options),
    parseFieldOptions(source.enums),
    parseFieldOptions(source.values),
    parseFieldOptions(source.selectOptions),
    parseFieldOptions(source.optionList),
    parseFieldOptions(source.fieldOptions)
  ];

  let inlineFieldOptions = parseFieldOptions(source.fieldData);
  if (!inlineFieldOptions && source.fieldData && typeof source.fieldData === "object" && !Array.isArray(source.fieldData)) {
    const fieldDataValues = Object.values(source.fieldData);
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
  const secondaryOptionCandidates = [parseFieldOptions(source.config), parseFieldOptions(source.extra), parseFieldOptions(source.schema)];
  const indexedSwitchOptions = parseIndexedSwitchOptions(source.fieldData);
  let optionsValue =
    (Array.isArray(indexedSwitchOptions) && indexedSwitchOptions.length > 0 && indexedSwitchOptions) ||
    pickBestOptionList(primaryOptionCandidates) ||
    pickBestOptionList(secondaryOptionCandidates);

  const hasStructuredOptions =
    Array.isArray(optionsValue) &&
    optionsValue.some((item) => item && typeof item === "object" && !Array.isArray(item));

  if (!hasStructuredOptions) {
    const optionCount = Array.isArray(optionsValue) ? optionsValue.length : 0;
    if (optionCount <= 1) {
      const hintText = `${key} ${source.fieldName || ""} ${source.label || ""} ${source.name || ""} ${source.description || ""}`;
      const textFallback = inferOptionsFromRawText(source.fieldData, hintText);
      optionsValue = mergeOptionLists(optionsValue, textFallback);
    }
    optionsValue = sanitizeOptionList(optionsValue);
  }

  const inferredType = inferInputType(source.type || source.valueType || source.widget || source.inputType || source.fieldType);
  const keyHint = `${key} ${source.fieldName || ""} ${source.label || ""} ${source.name || ""} ${source.description || ""}`.toLowerCase();
  const looksPromptLike = isPromptLikeText(keyHint);
  let normalizedType = inferredType;
  if (inferredType === "text" && Array.isArray(optionsValue) && optionsValue.length > 1) normalizedType = "select";
  if (inferredType === "select" && looksPromptLike && (!Array.isArray(optionsValue) || optionsValue.length <= 1)) {
    normalizedType = "text";
  }

  const numericDefault = source.default ?? source.fieldValue;
  const numericMarker = numericDefault !== undefined && numericDefault !== null && String(numericDefault).trim() !== "";
  const numericValue = numericMarker ? Number(numericDefault) : NaN;
  if (!looksPromptLike && normalizedType === "text" && Number.isFinite(numericValue)) {
    normalizedType = "number";
  }

  if (looksPromptLike) {
    normalizedType = "text";
    optionsValue = undefined;
  }

  const mappedInput = {
    type: normalizedType,
    fieldType: source.fieldType || "",
    options: optionsValue,
    fieldData: source.fieldData,
    default: source.default ?? source.fieldValue
  };
  const type = resolveInputType(mappedInput);
  const fieldDataLabel = resolveFieldDataLabel(source.fieldData, parseJsonFromEscapedText);
  const rawDescription = String(source.description || source.desc || "").trim();
  const baseName = String(source.name || source.label || source.title || fieldDataLabel || rawDescription || fieldName || key).trim();
  const baseLabel = String(source.label || source.name || source.title || fieldDataLabel || rawDescription || fieldName || key).trim();
  const explicitTitle = String(source.label || source.name || source.title || fieldDataLabel || "").trim();
  const labelMap =
    options && options.labelMap && typeof options.labelMap === "object"
      ? options.labelMap
      : DEFAULT_FIELD_LABEL_MAP;
  const displayMeta = resolveDisplayLabel({
    key,
    fieldName,
    rawLabel: baseLabel,
    rawName: baseName,
    labelMap
  });
  const displayLabel = displayMeta.label;
  const normalizedLabel = isWeakLabel(displayLabel) ? explicitTitle || rawDescription || displayLabel : displayLabel;
  const labelSource = isWeakLabel(displayLabel) ? "fallback" : displayMeta.source;
  const labelConfidence = isWeakLabel(displayLabel) ? 0.3 : displayMeta.confidence;
  const requiredSpec = resolveRequiredSpec(source, type);

  return {
    key,
    name: baseName,
    label: normalizedLabel || baseLabel || baseName || key,
    type,
    required: requiredSpec.required,
    requiredExplicit: requiredSpec.explicit,
    default: normalizeDefaultValueByType(source.default ?? source.fieldValue, type),
    options: Array.isArray(optionsValue) && optionsValue.length > 0 ? optionsValue : undefined,
    min: typeof source.min === "number" ? source.min : undefined,
    max: typeof source.max === "number" ? source.max : undefined,
    step: typeof source.step === "number" ? source.step : undefined,
    nodeId: nodeId || undefined,
    fieldName: fieldName || undefined,
    fieldType: source.fieldType || undefined,
    fieldData: source.fieldData || undefined,
    labelSource,
    labelConfidence
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
    const shouldReplaceLabel =
      typeof alt.labelConfidence === "number" &&
      (typeof input.labelConfidence !== "number" || alt.labelConfidence > input.labelConfidence + 0.2) &&
      !isWeakLabel(String(alt.label || ""));

    if (!needsSelectOptions && !shouldReplaceLabel) return input;
    return {
      ...input,
      options: needsSelectOptions ? alt.options : input.options,
      label: shouldReplaceLabel ? alt.label : input.label,
      labelSource: shouldReplaceLabel ? alt.labelSource : input.labelSource,
      labelConfidence: shouldReplaceLabel ? alt.labelConfidence : input.labelConfidence
    };
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

module.exports = {
  normalizeInput,
  isGhostSchemaInput,
  mergeInputsWithFallback
};
