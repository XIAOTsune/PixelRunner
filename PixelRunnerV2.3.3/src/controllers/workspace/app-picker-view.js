function getEscapeHtml(escapeHtml) {
  if (typeof escapeHtml === "function") return escapeHtml;
  return (value) => String(value ?? "");
}

function getEncodeDataId(encodeDataId) {
  if (typeof encodeDataId === "function") return encodeDataId;
  return (value) => String(value ?? "");
}

function renderAppPickerEmptyHtml(emptyState = {}, helpers = {}) {
  const escapeHtml = getEscapeHtml(helpers.escapeHtml);
  const kind = String(emptyState.kind || "");
  if (kind === "no_apps") {
    return `
        <div class="empty-state">
          <div style="margin-bottom:10px;">${escapeHtml(emptyState.message || "No saved apps.")}</div>
          <button class="main-btn" type="button" data-action="goto-settings">${escapeHtml(
            emptyState.actionLabel || "Go to Settings"
          )}</button>
        </div>
      `;
  }
  return `<div class="empty-state">${escapeHtml(emptyState.message || "No matching apps.")}</div>`;
}

function renderAppPickerItemsHtml(items = [], helpers = {}) {
  const escapeHtml = getEscapeHtml(helpers.escapeHtml);
  const encodeDataId = getEncodeDataId(helpers.encodeDataId);
  return items
    .map((item) => {
      const active = item && item.active ? "active" : "";
      const name = escapeHtml(item && item.name ? item.name : "Unnamed App");
      return `
        <button type="button" class="app-picker-item ${active}" data-id="${encodeDataId(item && item.id)}">
          <span class="app-picker-item-label">${name}</span>
        </button>
      `;
    })
    .join("");
}

function renderAppPickerListHtml(viewModel = {}, helpers = {}) {
  if (viewModel && viewModel.empty) {
    return renderAppPickerEmptyHtml(viewModel.emptyState || {}, helpers);
  }
  return renderAppPickerItemsHtml(viewModel && viewModel.items ? viewModel.items : [], helpers);
}

module.exports = {
  renderAppPickerListHtml
};
