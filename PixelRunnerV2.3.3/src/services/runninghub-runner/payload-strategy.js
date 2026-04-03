const { isEmptyValue } = require("../../utils");
const { resolveInputType, getInputOptionEntries } = require("../../shared/input-schema");

function isImageLikeInput(input) {
  const typeMarker = String((input && (input.type || input.fieldType)) || "").toLowerCase();
  const fieldMarker = String((input && input.fieldName) || "").toLowerCase();
  return typeMarker.includes("image") || typeMarker.includes("img") || fieldMarker === "image";
}

function isPromptLikeInputForPayload(input, runtimeType) {
  if (runtimeType === "image") return false;
  const key = String((input && input.key) || "").toLowerCase();
  const fieldName = String((input && input.fieldName) || "").toLowerCase();
  const label = String((input && (input.label || input.name || "")) || "").toLowerCase();
  const marker = `${key} ${fieldName} ${label}`;
  return /prompt|negative|positive|hint/.test(marker);
}

function shouldAttachFieldData(input, runtimeType) {
  if (isImageLikeInput(input)) return false;
  if (input.fieldData === undefined) return false;
  // Prompt-like text is sensitive to backend side coercion; avoid sending extra field metadata.
  if (runtimeType === "text" || isPromptLikeInputForPayload(input, runtimeType)) return false;
  return runtimeType === "select" || runtimeType === "boolean" || runtimeType === "number";
}

function isAiInput(input) {
  return Boolean(input && input.nodeId && input.fieldName);
}

function buildNodeInfoPayload(input, value, runtimeType) {
  const payload = {
    nodeId: input.nodeId,
    fieldName: input.fieldName,
    fieldValue: value
  };
  if (input.fieldType) payload.fieldType = input.fieldType;
  if (shouldAttachFieldData(input, runtimeType)) {
    payload.fieldData = input.fieldData;
  }
  return payload;
}

function resolveRuntimeInputType(input) {
  return resolveInputType(input || {});
}

function resolveInputValue(input, inputValues, options = {}) {
  const key = String((input && input.key) || "").trim();
  if (!key) return { key: "", aliasKey: "", value: undefined };

  const aliasKey = key.includes(":") ? key.split(":").pop() : "";
  let value = inputValues[key];
  const allowAlias = options.allowAlias !== false;
  if (allowAlias && isEmptyValue(value) && aliasKey) value = inputValues[aliasKey];

  return { key, aliasKey, value };
}

function parseBooleanValue(value) {
  if (value === true || value === false) return value;
  const marker = String(value == null ? "" : value).trim().toLowerCase();
  if (!marker) return null;
  if (["true", "1", "yes", "y", "on", "shi", "\u662f"].includes(marker)) return true;
  if (["false", "0", "no", "n", "off", "fou", "\u5426"].includes(marker)) return false;
  return null;
}

function normalizeSelectValue(input, value) {
  const entries = getInputOptionEntries(input || {});
  if (!Array.isArray(entries) || entries.length === 0) return value;

  const marker = String(value == null ? "" : value).trim().toLowerCase();
  if (!marker) return value;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const valueMarker = String(entry.value == null ? "" : entry.value).trim().toLowerCase();
    const labelMarker = String(entry.label == null ? "" : entry.label).trim().toLowerCase();
    if (valueMarker === marker || labelMarker === marker) {
      return entry.value;
    }
  }

  return value;
}

function isNumericLike(value) {
  return /^-?\d+(?:\.\d+)?$/.test(String(value == null ? "" : value).trim());
}

function hasNumericFieldHint(input) {
  const marker = String((input && input.fieldType) || "");
  return /(?:^|[^a-z])(int|integer|float|double|decimal|number)(?:[^a-z]|$)/i.test(marker);
}

function coerceSelectValue(input, value) {
  const normalized = normalizeSelectValue(input, value);
  const entries = getInputOptionEntries(input || {});

  const allBooleanOptions =
    Array.isArray(entries) && entries.length > 0 && entries.every((entry) => parseBooleanValue(entry && entry.value) !== null);
  if (allBooleanOptions) {
    const boolValue = parseBooleanValue(normalized);
    if (boolValue !== null) return boolValue;
  }

  const allNumericOptions =
    Array.isArray(entries) && entries.length > 0 && entries.every((entry) => isNumericLike(entry && entry.value));
  if ((allNumericOptions || hasNumericFieldHint(input)) && isNumericLike(normalized)) {
    const n = Number(normalized);
    if (Number.isFinite(n)) return n;
  }

  return normalized;
}

function getTextLength(value) {
  return Array.from(String(value == null ? "" : value)).length;
}

function getTailPreview(value, maxChars = 20) {
  const chars = Array.from(String(value == null ? "" : value));
  if (chars.length === 0) return "(empty)";
  const tail = chars.slice(Math.max(0, chars.length - maxChars)).join("");
  const singleLineTail = tail.replace(/\r/g, "").replace(/\n/g, "\\n");
  return chars.length > maxChars ? `...${singleLineTail}` : singleLineTail;
}

module.exports = {
  isAiInput,
  buildNodeInfoPayload,
  resolveRuntimeInputType,
  resolveInputValue,
  parseBooleanValue,
  coerceSelectValue,
  getTextLength,
  getTailPreview
};
