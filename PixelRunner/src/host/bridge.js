import { getRunningHubSafeError } from "../shared/runninghub-error-hints.js";

export function getById(id) {
  return document.getElementById(id);
}

export function registerListener(target, type, listener) {
  if (!target || typeof target.addEventListener !== "function") {
    return () => {};
  }

  target.addEventListener(type, listener);
  return () => {
    try {
      target.removeEventListener(type, listener);
    } catch (_) {
      // Ignore listener cleanup failures in the thin host shell.
    }
  };
}

export function setHostStatus(message, level = "info") {
  const statusEl = getById("hostStatus");
  if (!statusEl) return;

  statusEl.textContent = String(message || "");
  statusEl.classList.remove("is-info", "is-success", "is-warning");
  statusEl.classList.add(`is-${level}`);
}

export function createBridgeResponse(message, result, error) {
  if (error && String(message?.method || "").startsWith("runninghub.")) {
    const safe = getRunningHubSafeError(error.message, error.errorCode);
    error = { message: safe.message, errorCode: safe.errorCode, errorMessage: safe.message };
  }
  return {
    id: message && message.id,
    result: error ? null : result,
    error: error
      ? {
          message: String(error && error.message ? error.message : error || "Unknown bridge error"),
          errorCode: error && error.errorCode != null ? error.errorCode : null,
          errorMessage: error && error.errorMessage != null ? String(error.errorMessage) : "",
          raw: error && error.raw != null ? error.raw : null
        }
      : null
  };
}
