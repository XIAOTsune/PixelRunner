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
  return {
    id: message && message.id,
    result: error ? null : result,
    error: error
      ? {
          message: String(error && error.message ? error.message : error || "Unknown bridge error")
        }
      : null
  };
}
