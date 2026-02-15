const { inferInputType } = require("../utils");

function parseOptionsFromUnknown(raw) {
  const pickOptionTextFromObject = (obj) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "";
    const keys = ["index", "name", "label", "title", "value", "text", "id", "key", "optionValue", "enumValue"];
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        const text = String(v).trim();
        if (text) return text;
      }
    }
    return "";
  };

  const shouldIgnoreOption = (text) => {
    const marker = String(text || "").trim().toLowerCase();
    if (!marker) return true;
    if (marker === "ignore" || marker === "ignored") return true;
    if (marker === "default" || marker === "description" || marker === "descriptionen" || marker === "descriptioncn") return true;
    return false;
  };

  if (Array.isArray(raw)) {
    const list = [];
    const seen = new Set();
    const push = (value) => {
      const text = String(value == null ? "" : value).trim();
      if (shouldIgnoreOption(text)) return;
      const marker = text.toLowerCase();
      if (seen.has(marker)) return;
      seen.add(marker);
      list.push(text);
    };
    raw.forEach((item) => {
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
        push(item);
        return;
      }
      if (item && typeof item === "object") {
        const direct = pickOptionTextFromObject(item);
        if (direct) {
          push(direct);
          return;
        }
        parseOptionsFromUnknown(item).forEach(push);
      }
    });
    return list;
  }

  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parseOptionsFromUnknown(parsed);
      if (parsed && typeof parsed === "object") return parseOptionsFromUnknown(parsed);
    } catch (_) {}

    if (text.includes("|") || text.includes(",") || text.includes("\n")) {
      return text.split(/[|,\r\n]+/).map((item) => item.trim()).filter(Boolean);
    }
    return [];
  }

  if (!raw || typeof raw !== "object") return [];

  const containerKeys = ["options", "enums", "values", "items", "list", "data", "children", "selectOptions", "optionList", "fieldOptions"];
  const values = [];
  const seen = new Set();
  const push = (value) => {
    const text = String(value == null ? "" : value).trim();
    if (shouldIgnoreOption(text)) return;
    const marker = text.toLowerCase();
    if (seen.has(marker)) return;
    seen.add(marker);
    values.push(text);
  };
  containerKeys.forEach((key) => {
    if (raw[key] !== undefined) parseOptionsFromUnknown(raw[key]).forEach(push);
  });
  Object.keys(raw).forEach((key) => {
    const v = raw[key];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") push(v);
  });
  return values;
}

function getInputOptions(input) {
  const fromOptions = parseOptionsFromUnknown(input && input.options);
  if (fromOptions.length > 0) return fromOptions;
  return parseOptionsFromUnknown(input && input.fieldData);
}

function resolveInputType(input) {
  const rawType = inferInputType(input && (input.type || input.fieldType));
  if (rawType === "select") {
    const options = getInputOptions(input);
    const defaultValue = input && input.default;
    const defaultLooksNumeric =
      defaultValue !== undefined &&
      defaultValue !== null &&
      /^-?\d+(?:\.\d+)?$/.test(String(defaultValue).trim());
    const allOptionsNumeric =
      options.length > 0 &&
      options.every((opt) => /^-?\d+(?:\.\d+)?$/.test(String(opt).trim()));
    if (defaultLooksNumeric && (options.length === 0 || allOptionsNumeric)) return "number";
    if (options.length === 0) return "text";
    return "select";
  }
  if (rawType === "text" && getInputOptions(input).length > 1) return "select";
  if (
    (rawType === "boolean" || rawType === "text") &&
    /(?:^|[^a-z])(int|integer|float|double|decimal|number)(?:[^a-z]|$)/i.test(String((input && input.fieldType) || ""))
  ) {
    return "number";
  }
  return rawType;
}

module.exports = {
  parseOptionsFromUnknown,
  getInputOptions,
  resolveInputType
};
