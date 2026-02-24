const textInputPolicy = require("../../domain/policies/text-input-policy");

function resolvePromptLogValue(input, inputValues = {}, isEmptyValue = null) {
  const key = String((input && input.key) || "").trim();
  if (!key) return { key: "", value: "" };
  const aliasKey = key.includes(":") ? key.split(":").pop() : "";
  const values = inputValues && typeof inputValues === "object" ? inputValues : {};
  let value = values[key];
  if (typeof isEmptyValue === "function" && isEmptyValue(value) && aliasKey) {
    value = values[aliasKey];
  }
  return { key, value: String(value == null ? "" : value) };
}

function isPromptLikeForLog(input, deps = {}) {
  const inputSchema = deps.inputSchema;
  const isPromptLikeInput = deps.isPromptLikeInput;
  const resolveInputType =
    inputSchema && typeof inputSchema.resolveInputType === "function"
      ? inputSchema.resolveInputType.bind(inputSchema)
      : () => "text";
  const promptLikePredicate = typeof isPromptLikeInput === "function" ? isPromptLikeInput : () => false;

  const resolvedType = resolveInputType(input || {});
  if (resolvedType === "image") return false;
  const key = String((input && input.key) || "").toLowerCase();
  const label = String((input && (input.label || input.name || "")) || "").toLowerCase();
  const typeHint = String((input && (input.type || input.fieldType || "")) || "").toLowerCase();
  return (
    promptLikePredicate(input) ||
    (resolvedType === "text" && (key.includes("prompt") || label.includes("提示"))) ||
    /prompt|text|string/.test(typeHint)
  );
}

function buildPromptLengthLogSummary(options = {}) {
  const appItem = options.appItem;
  if (!appItem || !Array.isArray(appItem.inputs)) return null;

  const inputValues = options.inputValues && typeof options.inputValues === "object" ? options.inputValues : {};
  const maxItems = Math.max(1, Number(options.maxItems) || 12);
  const deps = {
    inputSchema: options.inputSchema,
    isPromptLikeInput: options.isPromptLikeInput
  };
  const promptInputs = appItem.inputs.filter((input) => isPromptLikeForLog(input, deps));
  if (promptInputs.length === 0) return null;

  const entries = promptInputs.slice(0, maxItems).map((input) => {
    const { key, value } = resolvePromptLogValue(input, inputValues, options.isEmptyValue);
    const label = String((input && (input.label || input.name || key)) || key || "unknown");
    return {
      label,
      key,
      length: textInputPolicy.getTextLength(value),
      tail: textInputPolicy.getTailPreview(value, 20)
    };
  });

  return {
    totalPromptInputs: promptInputs.length,
    hiddenCount: Math.max(0, promptInputs.length - entries.length),
    entries
  };
}

module.exports = {
  resolvePromptLogValue,
  isPromptLikeForLog,
  buildPromptLengthLogSummary
};
