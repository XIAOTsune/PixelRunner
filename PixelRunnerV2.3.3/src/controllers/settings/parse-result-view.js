function getEscapeHtml(escapeHtml) {
  if (typeof escapeHtml === "function") return escapeHtml;
  return (value) => String(value ?? "");
}

function renderParseSuccessHtml(viewModel = {}, helpers = {}) {
  const escapeHtml = getEscapeHtml(helpers.escapeHtml);
  const items = Array.isArray(viewModel.items) ? viewModel.items : [];
  const html = items
    .map(
      (item) => `
        <div class="parse-result-item" style="margin-bottom:2px; font-size:10px; color:#aaa;">
            - ${escapeHtml(item && item.label)} (${escapeHtml(item && item.key)})
        </div>
    `
    )
    .join("");

  return `
        <div style="background:#2a2a2a; padding:8px; border-radius:4px; margin-top:8px;">
            <div style="color:#4caf50; font-weight:bold; font-size:11px; margin-bottom:4px;">${escapeHtml(
              viewModel.title || "解析成功"
            )}</div>
            <div style="max-height:80px; overflow-y:auto; margin-bottom:8px;">${html}</div>
            <button id="btnSaveParsedApp" class="main-btn main-btn-primary" type="button">${escapeHtml(
              viewModel.actionLabel || "保存到工作台"
            )}</button>
        </div>
    `;
}

function renderParseFailureHtml(viewModel = {}, helpers = {}) {
  const escapeHtml = getEscapeHtml(helpers.escapeHtml);
  const reasons = Array.isArray(viewModel.reasons) ? viewModel.reasons : [];
  const metaRows = [];
  if (viewModel.code) metaRows.push(`Code: ${String(viewModel.code)}`);
  if (typeof viewModel.retryable === "boolean") {
    metaRows.push(`Retryable: ${viewModel.retryable ? "Yes" : "No"}`);
  }
  const metaHtml = metaRows.length
    ? `<div style="margin-top:4px; color:#ffb3b3; font-size:10px;">${metaRows.map((line) => escapeHtml(line)).join("<br/>")}</div>`
    : "";
  const reasonHtml = reasons.length
    ? `<div style="margin-top:4px; color:#ffb3b3; font-size:10px;">${reasons
        .map((reason, index) => `${index + 1}. ${escapeHtml(reason)}`)
        .join("<br/>")}</div>`
    : "";

  return `<div style="color:#ff6b6b; font-size:11px; margin:8px 0;">${escapeHtml(
    viewModel.message || "解析失败: 未知错误"
  )}${metaHtml}${reasonHtml}</div>`;
}

module.exports = {
  renderParseSuccessHtml,
  renderParseFailureHtml
};