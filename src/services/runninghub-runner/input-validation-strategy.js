const { isEmptyValue } = require("../../utils");

function createLocalValidationError(message, code = "LOCAL_VALIDATION") {
  const error = new Error(String(message || "Validation failed"));
  error.code = code;
  error.localValidation = true;
  return error;
}

function resolveInputDisplayName(input, key = "") {
  return String((input && (input.label || input.name)) || key || "unnamed parameter");
}

function collectMissingRequiredImageInputs(inputs, inputValues, helpers = {}) {
  const safeResolveRuntimeInputType =
    typeof helpers.resolveRuntimeInputType === "function" ? helpers.resolveRuntimeInputType : () => "text";
  const safeResolveInputValue =
    typeof helpers.resolveInputValue === "function" ? helpers.resolveInputValue : () => ({ key: "", value: undefined });

  const missing = [];
  (Array.isArray(inputs) ? inputs : []).forEach((input) => {
    const type = safeResolveRuntimeInputType(input);
    const strictRequired = Boolean(input && input.required && input.requiredExplicit === true);
    if (type !== "image" || !strictRequired) return;
    const resolved = safeResolveInputValue(input, inputValues || {}, { allowAlias: false });
    if (isEmptyValue(resolved.value)) {
      missing.push(resolveInputDisplayName(input, resolved.key));
    }
  });
  return missing;
}

function coerceNonImageInputValue(params = {}) {
  const {
    input,
    type,
    value,
    key,
    coerceSelectValue,
    parseBooleanValue
  } = params;
  const safeCoerceSelectValue =
    typeof coerceSelectValue === "function" ? coerceSelectValue : (_input, nextValue) => nextValue;
  const safeParseBooleanValue =
    typeof parseBooleanValue === "function"
      ? parseBooleanValue
      : (raw) => {
          if (raw === true || raw === false) return raw;
          return null;
        };
  const displayName = resolveInputDisplayName(input, key);

  if (type !== "image" && input && input.required && isEmptyValue(value)) {
    throw createLocalValidationError(
      `Missing required parameter: ${displayName}`,
      "MISSING_REQUIRED_PARAMETER"
    );
  }

  if (type === "select" && !isEmptyValue(value)) {
    return safeCoerceSelectValue(input, value);
  }

  if (type === "number" && !isEmptyValue(value)) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw createLocalValidationError(`Invalid number parameter: ${displayName}`, "INVALID_NUMBER_PARAMETER");
    }
    return n;
  }

  if (type === "boolean") {
    const boolValue = safeParseBooleanValue(value);
    if (boolValue === null) {
      throw createLocalValidationError(`Invalid boolean parameter: ${displayName}`, "INVALID_BOOLEAN_PARAMETER");
    }
    return boolValue;
  }

  return value;
}

module.exports = {
  createLocalValidationError,
  resolveInputDisplayName,
  collectMissingRequiredImageInputs,
  coerceNonImageInputValue
};
