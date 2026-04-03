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
      const title = escapeHtml(item && item.title ? item.title : "Untitled Template");
      return `
        <button type="button" class="app-picker-item ${selectedClass}" data-template-id="${marker}">
          <span class="app-picker-item-label">${title}</span>
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
