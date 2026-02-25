const {
  buildLogLine: buildLogLineDefault,
  renderLogLine: renderLogLineDefault,
  clearLogView: clearLogViewDefault
} = require("./log-view");
const { buildPromptLengthLogSummary: buildPromptLengthLogSummaryDefault } = require("../../application/services/prompt-log");

function createWorkspaceLogController(options = {}) {
  const dom = options.dom || {};
  const byId = typeof options.byId === "function" ? options.byId : () => null;
  const buildLogLine = typeof options.buildLogLine === "function" ? options.buildLogLine : buildLogLineDefault;
  const renderLogLine = typeof options.renderLogLine === "function" ? options.renderLogLine : renderLogLineDefault;
  const clearLogView = typeof options.clearLogView === "function" ? options.clearLogView : clearLogViewDefault;
  const buildPromptLengthLogSummary =
    typeof options.buildPromptLengthLogSummary === "function"
      ? options.buildPromptLengthLogSummary
      : buildPromptLengthLogSummaryDefault;
  const inputSchema = options.inputSchema || {};
  const isPromptLikeInput = typeof options.isPromptLikeInput === "function" ? options.isPromptLikeInput : () => false;
  const isEmptyValue = typeof options.isEmptyValue === "function" ? options.isEmptyValue : (value) => value == null;
  const consoleLog = typeof options.consoleLog === "function" ? options.consoleLog : console.log;

  function resolveLogWindow() {
    return dom.logWindow || byId("logWindow");
  }

  function log(message, type = "info") {
    const normalizedMessage = String(message || "");
    consoleLog(`[Workspace][${type}] ${normalizedMessage}`);
    const logWindow = resolveLogWindow();
    if (!logWindow) return;
    if (normalizedMessage === "CLEAR") {
      clearLogView(logWindow);
      return;
    }
    const line = buildLogLine({ message: normalizedMessage, type, now: new Date() });
    renderLogLine(logWindow, line);
  }

  function onClearLogClick() {
    log("CLEAR");
  }

  function logPromptLengthsBeforeRun(appItem, inputValues, prefix = "") {
    const summary = buildPromptLengthLogSummary({
      appItem,
      inputValues,
      inputSchema,
      isPromptLikeInput,
      isEmptyValue,
      maxItems: 12
    });
    if (!summary) return;

    const head = prefix ? `${prefix} ` : "";
    log(`${head}Prompt length check before run: ${summary.totalPromptInputs} prompt input(s)`, "info");
    summary.entries.forEach((item) => {
      log(`${head}Input ${item.label} (${item.key}): length ${item.length}, tail ${item.tail}`, "info");
    });
    if (summary.hiddenCount > 0) {
      log(`${head}${summary.hiddenCount} additional prompt input(s) not expanded`, "info");
    }
  }

  return {
    log,
    onClearLogClick,
    logPromptLengthsBeforeRun
  };
}

module.exports = {
  createWorkspaceLogController
};
