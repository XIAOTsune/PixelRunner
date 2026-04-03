function renderTaskSummary(summaryEl, viewModel = {}) {
  if (!summaryEl) return;
  const tone = String(viewModel.tone || "default");
  const nextText = String(viewModel.text || "");
  const nextTitle = String(viewModel.title || "");

  if (
    summaryEl.__pixelRunnerSummaryText === nextText &&
    summaryEl.__pixelRunnerSummaryTitle === nextTitle &&
    summaryEl.__pixelRunnerSummaryTone === tone
  ) {
    return false;
  }

  summaryEl.__pixelRunnerSummaryText = nextText;
  summaryEl.__pixelRunnerSummaryTitle = nextTitle;
  summaryEl.__pixelRunnerSummaryTone = tone;

  summaryEl.classList.remove("is-warning", "is-success", "is-info");
  summaryEl.textContent = nextText;
  summaryEl.title = nextTitle;

  if (tone === "warning") {
    summaryEl.classList.add("is-warning");
    return true;
  }
  if (tone === "success") {
    summaryEl.classList.add("is-success");
    return true;
  }
  if (tone === "info") {
    summaryEl.classList.add("is-info");
  }
  return true;
}

module.exports = {
  renderTaskSummary
};
