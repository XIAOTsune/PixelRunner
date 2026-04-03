const { inferInputType } = require("../utils");

const OPTION_CONTAINER_KEYS = ["options", "enums", "values", "items", "list", "data", "children", "selectOptions", "optionList", "fieldOptions"];
const OPTION_VALUE_KEYS = ["value", "optionValue", "enumValue", "id", "key", "code", "index", "fastIndex", "name", "label", "title", "text"];
const OPTION_LABEL_KEYS = ["label", "title", "text", "description", "descriptionCn", "descriptionEn", "name", "value", "index", "id", "key"];

function isPrimitive(value) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function shouldIgnoreOptionText(text) {
  const marker = String(text || "").trim().toLowerCase();
  if (!marker) return true;
  if (marker === "ignore" || marker === "ignored") return true;
  if (marker === "default" || marker === "description" || marker === "descriptionen" || marker === "descriptioncn") return true;
  return false;
}

function normalizeOptionValue(value) {
  if (value === true || value === false) return value;
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text;
}

function normalizeOptionLabel(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text || shouldIgnoreOptionText(text)) return "";
  return text;
}

function buildOptionEntry(value, label) {
  const normalizedValue = normalizeOptionValue(value);
  if (normalizedValue === "") return null;
  const normalizedLabel = normalizeOptionLabel(label);
  return {
    value: normalizedValue,
    label: normalizedLabel || String(normalizedValue)
  };
}

function findObjectFieldValue(obj, keys) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const value = obj[key];
    if (!isPrimitive(value)) continue;
    const text = String(value).trim();
    if (!text && value !== false) continue;
    return value;
  }
  return undefined;
}

function parseOptionEntryFromObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const value = findObjectFieldValue(obj, OPTION_VALUE_KEYS);
  const label = findObjectFieldValue(obj, OPTION_LABEL_KEYS);
  if (value === undefined && label === undefined) return null;
  return buildOptionEntry(value !== undefined ? value : label, label !== undefined ? label : value);
}

function markerFromValue(value) {
  if (value === true || value === false) return `b:${value}`;
  return `s:${String(value).trim().toLowerCase()}`;
}

function dedupeOptionEntries(entries) {
  const out = [];
  const seen = new Set();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const value = normalizeOptionValue(entry.value);
    if (value === "") return;
    const label = normalizeOptionLabel(entry.label || value) || String(value);
    const marker = markerFromValue(value);
    if (seen.has(marker)) return;
    seen.add(marker);
    out.push({ value, label });
  });
  return out;
}

function extractOptionEntriesFromUnknown(raw, depth = 0) {
  if (depth > 8 || raw === undefined || raw === null) return [];

  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return extractOptionEntriesFromUnknown(parsed, depth + 1);
    } catch (_) {}

    if (text.includes("|") || text.includes(",") || text.includes("\n")) {
      const values = text.split(/[|,\r\n]+/).map((item) => item.trim()).filter(Boolean);
      return dedupeOptionEntries(values.map((value) => buildOptionEntry(value, value)).filter(Boolean));
    }

    const entry = buildOptionEntry(text, text);
    return entry ? [entry] : [];
  }

  if (isPrimitive(raw)) {
    const entry = buildOptionEntry(raw, raw);
    return entry ? [entry] : [];
  }

  if (Array.isArray(raw)) {
    const list = [];
    raw.forEach((item) => {
      list.push(...extractOptionEntriesFromUnknown(item, depth + 1));
    });
    return dedupeOptionEntries(list);
  }

  if (!raw || typeof raw !== "object") return [];

  const directEntry = parseOptionEntryFromObject(raw);
  const nestedEntries = [];

  let hasContainer = false;
  OPTION_CONTAINER_KEYS.forEach((key) => {
    if (raw[key] === undefined) return;
    hasContainer = true;
    nestedEntries.push(...extractOptionEntriesFromUnknown(raw[key], depth + 1));
  });

  if (hasContainer) {
    if (directEntry) nestedEntries.push(directEntry);
    return dedupeOptionEntries(nestedEntries);
  }

  const keys = Object.keys(raw);
  const isNumericList =
    keys.length > 0 &&
    keys.every((key) => /^\d+$/.test(key) && isPrimitive(raw[key]));
  if (isNumericList) {
    const list = keys
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => buildOptionEntry(raw[key], raw[key]))
      .filter(Boolean);
    return dedupeOptionEntries(list);
  }

  if (directEntry) return [directEntry];
  return [];
}

function parseOptionsFromUnknown(raw) {
  return extractOptionEntriesFromUnknown(raw).map((entry) => entry.label);
}

function getInputOptionEntries(input) {
  const source = input || {};
  const merged = [];
  const fieldDataEntries = extractOptionEntriesFromUnknown(source.fieldData);
  const sources = [
    source.options,
    source.enums,
    source.values,
    source.selectOptions,
    source.optionList,
    source.fieldOptions
  ];

  sources.forEach((item) => {
    merged.push(...extractOptionEntriesFromUnknown(item));
  });

  const normalizedFieldDataEntries = dedupeOptionEntries(fieldDataEntries);
  if (normalizedFieldDataEntries.length > 1) {
    const defaultValue = source.default;
    const defaultLooksNumeric = /^-?\d+(?:\.\d+)?$/.test(String(defaultValue == null ? "" : defaultValue).trim());
    const allFieldValuesNumeric = normalizedFieldDataEntries.every((entry) =>
      /^-?\d+(?:\.\d+)?$/.test(String(entry && entry.value == null ? "" : entry.value).trim())
    );

    // Prefer fieldData-derived options when it clearly encodes numeric indexes (e.g. ImpactSwitch).
    if (defaultLooksNumeric && allFieldValuesNumeric) {
      return normalizedFieldDataEntries;
    }
  }

  if (merged.length === 0) return normalizedFieldDataEntries;
  return dedupeOptionEntries(merged);
}

function getInputOptions(input) {
  const source = input || {};
  const merged = [];
  const sources = [
    source.options,
    source.enums,
    source.values,
    source.selectOptions,
    source.optionList,
    source.fieldOptions
  ];

  sources.forEach((item) => {
    merged.push(...extractOptionEntriesFromUnknown(item));
  });

  return dedupeOptionEntries(merged).map((entry) => entry.label);
}

function isNumericLike(value) {
  return /^-?\d+(?:\.\d+)?$/.test(String(value == null ? "" : value).trim());
}

function parseBooleanLike(value) {
  if (value === true || value === false) return value;
  const marker = String(value == null ? "" : value).trim().toLowerCase();
  if (!marker) return null;
  if (["true", "1", "yes", "y", "on", "是"].includes(marker)) return true;
  if (["false", "0", "no", "n", "off", "否"].includes(marker)) return false;
  return null;
}

function isBooleanOptionEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return false;
  if (entries.length > 4) return false;
  return entries.every((entry) => parseBooleanLike(entry && entry.value) !== null);
}

function hasNumericFieldHint(fieldType) {
  return /(?:^|[^a-z])(int|integer|float|double|decimal|number)(?:[^a-z]|$)/i.test(String(fieldType || ""));
}

function hasBooleanFieldHint(fieldType) {
  return /(?:^|[^a-z])(bool|boolean|checkbox|toggle|switch)(?:[^a-z]|$)/i.test(String(fieldType || ""));
}

function resolveInputType(input) {
  const rawType = inferInputType(input && (input.type || input.fieldType));
  const entries = getInputOptionEntries(input);
  const optionValues = entries.map((entry) => entry.value);
  const optionsNumeric = optionValues.length > 0 && optionValues.every(isNumericLike);
  const optionsBoolean = isBooleanOptionEntries(entries);

  const defaultValue = input && input.default;
  const defaultNumeric = defaultValue !== undefined && defaultValue !== null && isNumericLike(defaultValue);
  const defaultBoolean = parseBooleanLike(defaultValue) !== null;

  const fieldType = String((input && input.fieldType) || "");
  const numericHint = hasNumericFieldHint(fieldType);
  const booleanHint = hasBooleanFieldHint(fieldType);

  if (rawType === "image" || rawType === "number") return rawType;

  if (rawType === "boolean") {
    if (entries.length > 1) {
      if (optionsBoolean) return "boolean";
      return "select";
    }
    if (optionsNumeric || (numericHint && !optionsBoolean)) return "number";
    if (optionsBoolean || defaultBoolean || booleanHint) return "boolean";
    return "boolean";
  }

  if (rawType === "select") {
    if (entries.length > 0) {
      if (optionsBoolean) return "boolean";
      return "select";
    }
    if (defaultBoolean && booleanHint) return "boolean";
    if (optionsNumeric || (numericHint && defaultNumeric)) return "number";
    if (booleanHint && defaultBoolean) return "boolean";
    return "text";
  }

  if (rawType === "text" && entries.length > 1) {
    if (optionsBoolean) return "boolean";
    return "select";
  }

  if ((rawType === "boolean" || rawType === "text" || rawType === "select") && numericHint) {
    return "number";
  }

  if (rawType === "text" && (optionsBoolean || (booleanHint && defaultBoolean))) {
    return "boolean";
  }

  return rawType;
}

module.exports = {
  parseOptionsFromUnknown,
  getInputOptionEntries,
  getInputOptions,
  resolveInputType
};
