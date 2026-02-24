function normalizeParseResultInputs(inputs) {
  const list = Array.isArray(inputs) ? inputs : [];
  return list.map((input) => ({
    label: String((input && (input.label || input.name || input.key)) || "未命名参数"),
    key: String((input && input.key) || "-")
  }));
}

function normalizeParseFailure(errorOrMessage) {
  const source = errorOrMessage && typeof errorOrMessage === "object" ? errorOrMessage : null;
  const message = source ? String(source.message || "unknown error") : String(errorOrMessage || "unknown error");
  const code = source && source.code ? String(source.code) : "";
  const appId = source && source.appId ? String(source.appId) : "";
  const endpoint = source && source.endpoint ? String(source.endpoint) : "";
  const retryable = source && typeof source.retryable === "boolean" ? source.retryable : null;
  const reasons =
    source && Array.isArray(source.reasons)
      ? source.reasons.filter((item) => item !== undefined && item !== null && item !== "").map((item) => String(item))
      : [];

  return {
    message,
    code,
    appId,
    endpoint,
    retryable,
    reasons
  };
}

function buildParseSuccessViewModel(data) {
  const source = data && typeof data === "object" ? data : {};
  return {
    title: `解析成功: ${String(source.name || "未命名应用")}`,
    items: normalizeParseResultInputs(source.inputs),
    actionLabel: "保存到工作台"
  };
}

function buildParseFailureViewModel(errorOrMessage) {
  const failure = normalizeParseFailure(errorOrMessage);
  return {
    message: `解析失败: ${failure.message}`,
    code: failure.code,
    retryable: failure.retryable,
    reasons: failure.reasons
  };
}

function buildParseFailureDiagnostics(errorOrMessage) {
  const failure = normalizeParseFailure(errorOrMessage);
  const lines = [`Parse failed: ${failure.message}`];
  if (failure.code) lines.push(`code=${failure.code}`);
  if (failure.appId) lines.push(`appId=${failure.appId}`);
  if (failure.endpoint) lines.push(`endpoint=${failure.endpoint}`);
  if (typeof failure.retryable === "boolean") lines.push(`retryable=${failure.retryable ? "true" : "false"}`);
  failure.reasons.forEach((reason, index) => {
    lines.push(`reason[${index + 1}]=${reason}`);
  });
  return lines;
}

module.exports = {
  normalizeParseResultInputs,
  normalizeParseFailure,
  buildParseSuccessViewModel,
  buildParseFailureViewModel,
  buildParseFailureDiagnostics
};