const { RUNNINGHUB_ERROR_CODES } = require("../runninghub-error-codes");

function fallbackToMessage(result, fallback = "Request failed") {
  if (!result || typeof result !== "object") return fallback;
  return String(result.msg || result.message || fallback);
}

function extractNodeValidationSummary(result) {
  if (!result || typeof result !== "object") return "";
  const raw = result.node_errors || result.nodeErrors || (result.data && (result.data.node_errors || result.data.nodeErrors));
  if (!raw || typeof raw !== "object") return "";

  const lines = [];
  Object.values(raw)
    .slice(0, 4)
    .forEach((node) => {
      if (!node || typeof node !== "object") return;
      const nodeName = String(node.node_name || node.nodeName || node.class_type || "node").trim();
      const errs = Array.isArray(node.errors) ? node.errors : [];
      errs.slice(0, 2).forEach((err) => {
        if (!err || typeof err !== "object") return;
        const msg = String(err.message || err.type || "validation error").trim();
        const details = String(err.details || "").trim();
        lines.push(details ? `${nodeName}: ${msg} (${details})` : `${nodeName}: ${msg}`);
      });
    });

  return lines.join("; ");
}

function toAiAppErrorMessage(result, fallback = "AI app request failed") {
  if (!result || typeof result !== "object") return fallback;
  if (result.msg) return String(result.msg);
  if (result.message) return String(result.message);
  if (result.error && typeof result.error === "object" && (result.error.message || result.error.type)) {
    const errMsg = String(result.error.message || result.error.type || "").trim();
    if (errMsg) return errMsg;
  }
  const summary = extractNodeValidationSummary(result);
  if (summary) return summary;
  return fallback;
}

function isParameterShapeError(message) {
  const marker = String(message || "").toLowerCase();
  if (!marker) return false;
  return (
    marker.includes("webappid cannot be null") ||
    marker.includes("param apikey is required") ||
    marker.includes("param api key is required")
  );
}

function createAiAppRejectedError(message, apiResult) {
  const terminalError = new Error(String(message || "AI app request rejected"));
  terminalError.code = RUNNINGHUB_ERROR_CODES.AI_APP_REJECTED;
  terminalError.apiResult = apiResult;
  return terminalError;
}

function isPrimaryAiAppVariant(body) {
  if (!body || typeof body !== "object") return false;
  return Boolean(body.apiKey && body.webappId);
}

function normalizeAiAppFailure({ body, result, responseStatus, toMessage }) {
  const safeToMessage = typeof toMessage === "function" ? toMessage : fallbackToMessage;
  const marker = body && typeof body === "object" ? Object.keys(body).join(",") : "";
  const message = toAiAppErrorMessage(result, safeToMessage(result, `HTTP ${responseStatus}`));
  const terminal = isPrimaryAiAppVariant(body) && !isParameterShapeError(message);
  return {
    message,
    terminal,
    reason: `ai-app/run(${marker}): ${message}`
  };
}

function buildAiAppExceptionReason(error) {
  const message = error && error.message ? error.message : String(error || "unknown error");
  return `ai-app/run: ${message}`;
}

module.exports = {
  fallbackToMessage,
  extractNodeValidationSummary,
  toAiAppErrorMessage,
  isParameterShapeError,
  createAiAppRejectedError,
  normalizeAiAppFailure,
  buildAiAppExceptionReason
};
