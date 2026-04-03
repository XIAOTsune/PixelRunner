function renderTemplateLengthHint(hintEl, viewModel) {
  if (!hintEl || !viewModel) return;
  hintEl.textContent = String(viewModel.text || "");
  hintEl.style.color = String(viewModel.color || "");
}

module.exports = {
  renderTemplateLengthHint
};
