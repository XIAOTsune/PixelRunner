function renderTaskSummary(summaryEl, viewModel = {}) {
  if (!summaryEl) return;
  const tone = String(viewModel.tone || "default");
  summaryEl.classList.remove("is-warning", "is-success", "is-info");
  summaryEl.textContent = String(viewModel.text || "");
  summaryEl.title = String(viewModel.title || "");

  if (tone === "warning") {
    summaryEl.classList.add("is-warning");
    return;
  }
  if (tone === "success") {
    summaryEl.classList.add("is-success");
    return;
  }
  if (tone === "info") {
    summaryEl.classList.add("is-info");
  }
}

module.exports = {
  renderTaskSummary
};
