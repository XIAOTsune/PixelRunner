function defaultResolveInputType(input) {
  const safeInput = input && typeof input === "object" ? input : {};
  const marker = String(safeInput.type || safeInput.fieldType || "").toLowerCase();
  if (/image|img|file/.test(marker)) return "image";
  if (/bool/.test(marker)) return "boolean";
  if (/select|enum|list/.test(marker)) return "select";
  if (/number|int|float|double/.test(marker)) return "number";
  return "text";
}

function createInputPolicy(options = {}) {
  const inputSchema = options.inputSchema && typeof options.inputSchema === "object" ? options.inputSchema : {};
  const isPromptLikeInput = typeof options.isPromptLikeInput === "function" ? options.isPromptLikeInput : () => false;

  function resolveUiInputType(input) {
    if (typeof inputSchema.resolveInputType === "function") {
      return inputSchema.resolveInputType(input || {});
    }
    return defaultResolveInputType(input);
  }

  function getInputOptions(input) {
    if (typeof inputSchema.getInputOptions === "function") {
      return inputSchema.getInputOptions(input);
    }
    const raw = input && input.options;
    return Array.isArray(raw) ? raw : [];
  }

  function getInputOptionEntries(input) {
    if (typeof inputSchema.getInputOptionEntries === "function") {
      return inputSchema.getInputOptionEntries(input);
    }
    const optionsList = getInputOptions(input);
    return (Array.isArray(optionsList) ? optionsList : []).map((value) => ({ value, label: String(value) }));
  }

  function isPromptLikeField(input) {
    const safeInput = input && typeof input === "object" ? input : {};
    const resolvedType = resolveUiInputType(safeInput);
    if (resolvedType === "image") return false;
    const key = String(safeInput.key || "").toLowerCase();
    const label = String(safeInput.label || safeInput.name || "").toLowerCase();
    const typeHint = String(safeInput.type || safeInput.fieldType || "").toLowerCase();
    return (
      isPromptLikeInput(safeInput) ||
      (resolvedType === "text" && (key.includes("prompt") || label.includes("提示"))) ||
      /prompt|text|string/.test(typeHint)
    );
  }

  function isLongTextInput(input) {
    return resolveUiInputType(input) === "text" && getInputOptions(input).length === 0;
  }

  function splitImageAndOtherInputs(inputs) {
    const list = Array.isArray(inputs) ? inputs : [];
    const imageInputs = [];
    const otherInputs = [];
    list.forEach((input) => {
      if (resolveUiInputType(input) === "image") {
        imageInputs.push(input);
      } else {
        otherInputs.push(input);
      }
    });
    return { imageInputs, otherInputs };
  }

  return {
    getInputOptions,
    getInputOptionEntries,
    resolveUiInputType,
    isPromptLikeField,
    isLongTextInput,
    splitImageAndOtherInputs
  };
}

module.exports = {
  createInputPolicy
};
