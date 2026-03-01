function getLogText(logEl) {
  if (!logEl) return "";
  if (typeof logEl.value === "string") return String(logEl.value || "");
  return String(logEl.textContent || "");
}

function setLogText(logEl, text) {
  if (!logEl) return;
  const nextText = String(text || "");
  if (typeof logEl.value === "string") {
    logEl.value = nextText;
    return;
  }
  logEl.textContent = nextText;
}

function isNearLogBottom(logEl, threshold = 12) {
  if (!logEl) return true;
  const maxScrollTop = Math.max(0, logEl.scrollHeight - logEl.clientHeight);
  return maxScrollTop - logEl.scrollTop <= threshold;
}

function buildLogLine({ message, type = "info", now = new Date() }) {
  const time = now.toLocaleTimeString();
  const level = String(type || "info").toUpperCase();
  return `[${time}] [${level}] ${String(message || "")}`;
}

function renderLogLine(logEl, line) {
  if (!logEl) return;
  const current = getLogText(logEl);
  setLogText(logEl, current ? `${current}\n${line}` : line);
  // Always follow latest log for progress visibility.
  logEl.scrollTop = logEl.scrollHeight;
  if (typeof setTimeout === "function") {
    setTimeout(() => {
      if (!logEl) return;
      logEl.scrollTop = logEl.scrollHeight;
      setTimeout(() => {
        if (!logEl) return;
        logEl.scrollTop = logEl.scrollHeight;
      }, 16);
    }, 0);
  }
}

function clearLogView(logEl) {
  if (!logEl) return;
  setLogText(logEl, "");
}

module.exports = {
  getLogText,
  setLogText,
  isNearLogBottom,
  buildLogLine,
  renderLogLine,
  clearLogView
};
