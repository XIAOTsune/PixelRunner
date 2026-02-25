function getEscapeHtml(escapeHtml) {
  if (typeof escapeHtml === "function") return escapeHtml;
  return (value) => String(value ?? "");
}

function getEncodeDataId(encodeDataId) {
  if (typeof encodeDataId === "function") return encodeDataId;
  return (value) => String(value ?? "");
}

function renderTemplatePickerEmptyHtml(emptyState = {}, helpers = {}) {
  const escapeHtml = getEscapeHtml(helpers.escapeHtml);
  const message = escapeHtml(emptyState.message || "No templates available.");
  const actionLabel = escapeHtml(emptyState.actionLabel || "Go to Settings");
  return `
      <div class="empty-state">
        ${message}
        <br><button class="tiny-btn" style="margin-top:8px" type="button" data-action="goto-settings">${actionLabel}</button>
      </div>
    `;
}

function renderTemplatePickerItemsHtml(items = [], helpers = {}) {
  const escapeHtml = getEscapeHtml(helpers.escapeHtml);
  const encodeDataId = getEncodeDataId(helpers.encodeDataId);
  return items
    .map((item) => {
      const selectedClass = item && item.selected ? "active" : "";
      const marker = encodeDataId(item && item.id);
      return `
        <button type="button" class="app-picker-item ${selectedClass}" data-template-id="${marker}">
          <div>
            <div style="font-weight:bold;font-size:12px">${escapeHtml(item && item.title)}</div>
            <div style="font-size:10px;color:#777; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">${escapeHtml(item && item.content)}</div>
          </div>
          <div style="font-size:12px;color:var(--accent-color)">${escapeHtml(item && item.actionLabel)}</div>
        </button>
      `;
    })
    .join("");
}

function renderTemplatePickerListHtml(viewModel = {}, helpers = {}) {
  if (viewModel && viewModel.empty) {
    return renderTemplatePickerEmptyHtml(viewModel.emptyState || {}, helpers);
  }
  return renderTemplatePickerItemsHtml(viewModel && viewModel.items ? viewModel.items : [], helpers);
}

module.exports = {
  renderTemplatePickerListHtml
};
