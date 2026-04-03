function getEscapeHtml(escapeHtml) {
  if (typeof escapeHtml === "function") return escapeHtml;
  return (value) => String(value ?? "");
}

function getEncodeDataId(encodeDataId) {
  if (typeof encodeDataId === "function") return encodeDataId;
  return (value) => String(value ?? "");
}

function renderSavedTemplatesListHtml(viewModel = {}, helpers = {}) {
  const escapeHtml = getEscapeHtml(helpers.escapeHtml);
  const encodeDataId = getEncodeDataId(helpers.encodeDataId);

  if (viewModel && viewModel.empty) {
    return `<div class="empty-state" style="padding:8px; font-size:11px; color:#777;">${escapeHtml(
      viewModel.emptyText || "暂无模板"
    )}</div>`;
  }

  return (viewModel && Array.isArray(viewModel.items) ? viewModel.items : [])
    .map((item) => {
      const encodedRawId = encodeDataId(item && item.id);
      const duplicate = item && item.duplicate ? item.duplicate : { isDuplicate: false, index: 1, total: 1 };
      const duplicateTag = duplicate.isDuplicate
        ? `<span class="saved-item-duplicate">重复 ${duplicate.index}/${duplicate.total}</span>`
        : "";

      return `
            <div class="saved-item saved-item-template" data-id="${encodedRawId}">
                <div class="saved-item-body">
                    <div class="saved-item-title saved-item-title-truncate">${escapeHtml(item && item.title)}</div>
                    <div class="saved-item-meta">记录ID: ${escapeHtml(item && item.recordId)}${duplicateTag}</div>
                </div>
                <div class="saved-item-actions">
                    <button class="tiny-btn" type="button" data-action="edit-template" data-id="${encodedRawId}" ${
                      item && item.editDisabled ? "disabled" : ""
                    }>修改</button>
                    <button class="tiny-btn" type="button" data-action="delete-template" data-id="${encodedRawId}" ${
                      item && item.deleteDisabled ? "disabled" : ""
                    }>删除</button>
                </div>
            </div>
        `;
    })
    .join("");
}

module.exports = {
  renderSavedTemplatesListHtml
};
