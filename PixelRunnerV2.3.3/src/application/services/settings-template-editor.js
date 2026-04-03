function fallbackGetTextLength(value) {
  return Array.from(String(value || "")).length;
}

function fallbackGetTailPreview(value, maxChars = 20) {
  const chars = Array.from(String(value || ""));
  const tail = chars.slice(-Math.max(0, Number(maxChars) || 0)).join("");
  return tail.replace(/\r?\n/g, "\\n");
}

function buildTemplateLengthHintViewModel(options = {}) {
  const title = String(options.title || "");
  const content = String(options.content || "");
  const warningChars = Number(options.warningChars) || 0;
  const getTextLength = typeof options.getTextLength === "function"
    ? options.getTextLength
    : fallbackGetTextLength;
  const getTailPreview = typeof options.getTailPreview === "function"
    ? options.getTailPreview
    : fallbackGetTailPreview;

  const titleLen = getTextLength(title);
  const contentLen = getTextLength(content);
  const tailPreview = getTailPreview(content, 20);
  const isLarge = titleLen >= warningChars || contentLen >= warningChars;
  const baseMessage = `提示：标题 ${titleLen} / 内容 ${contentLen} 字符，末尾预览 ${tailPreview}。插件本地不会截断模板内容。`;

  if (isLarge) {
    return {
      text: `${baseMessage} 建议控制在 4000 字符内，避免 RunningHub 侧拒绝。`,
      color: "#ffb74d",
      isLarge: true
    };
  }

  return {
    text: `${baseMessage} 建议单条提示词控制在 4000 字符内。`,
    color: "",
    isLarge: false
  };
}

function getClipboardPlainText(event) {
  if (!event || !event.clipboardData || typeof event.clipboardData.getData !== "function") return "";
  return event.clipboardData.getData("text/plain");
}

module.exports = {
  buildTemplateLengthHintViewModel,
  getClipboardPlainText
};
