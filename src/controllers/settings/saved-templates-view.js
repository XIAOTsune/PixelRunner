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
        ? `<span style="margin-left:6px; font-size:10px; color:#ffb74d;">重复 ${duplicate.index}/${duplicate.total}</span>`
        : "";

      return `
            <div class="saved-item" data-id="${encodedRawId}" style="background:#2a2a2a; border:1px solid #333; padding:6px; margin-top:4px; border-radius:3px; display:flex; justify-content:space-between; align-items:center;">
                <div style="max-width:70%;">
                    <div style="font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(
                      item && item.title
                    )}</div>
                    <div style="font-size:10px; color:#777;">记录ID: ${escapeHtml(item && item.recordId)}${duplicateTag}</div>
                </div>
                <div style="display:flex; gap:6px;">
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
