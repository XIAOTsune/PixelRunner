function normalizeParseResultInputs(inputs) {
  const list = Array.isArray(inputs) ? inputs : [];
  return list.map((input) => ({
    label: String((input && (input.label || input.name || input.key)) || "未命名参数"),
    key: String((input && input.key) || "-")
  }));
}

function buildParseSuccessViewModel(data) {
  const source = data && typeof data === "object" ? data : {};
  return {
    title: `解析成功: ${String(source.name || "未命名应用")}`,
    items: normalizeParseResultInputs(source.inputs),
    actionLabel: "保存到工作台"
  };
}

function buildParseFailureViewModel(message) {
  return {
    message: `解析失败: ${String(message || "未知错误")}`
  };
}

module.exports = {
  normalizeParseResultInputs,
  buildParseSuccessViewModel,
  buildParseFailureViewModel
};
