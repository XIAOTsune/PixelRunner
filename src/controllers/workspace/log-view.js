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

function appendLogText(logEl, line) {
  if (!logEl) return;
  const nextLine = String(line || "");
  if (!nextLine) return;

  if (typeof logEl.value === "string") {
    logEl.value = logEl.value ? `${logEl.value}\n${nextLine}` : nextLine;
    return;
  }

  const current = getLogText(logEl);
  logEl.textContent = current ? `${current}\n${nextLine}` : nextLine;
}

function clearPendingLogScroll(logEl) {
  if (!logEl) return;
  if (typeof cancelAnimationFrame === "function" && logEl.__pixelRunnerLogScrollFrameId) {
    cancelAnimationFrame(logEl.__pixelRunnerLogScrollFrameId);
  }
  if (typeof clearTimeout === "function" && logEl.__pixelRunnerLogScrollTimeoutId) {
    clearTimeout(logEl.__pixelRunnerLogScrollTimeoutId);
  }
  logEl.__pixelRunnerLogScrollFrameId = null;
  logEl.__pixelRunnerLogScrollTimeoutId = null;
}

function scrollLogToBottom(logEl) {
  if (!logEl) return;
  logEl.scrollTop = logEl.scrollHeight;
}

function scheduleLogScrollToBottom(logEl) {
  if (!logEl) return;
  clearPendingLogScroll(logEl);

  if (typeof requestAnimationFrame === "function") {
    logEl.__pixelRunnerLogScrollFrameId = requestAnimationFrame(() => {
      logEl.__pixelRunnerLogScrollFrameId = null;
      scrollLogToBottom(logEl);
    });
    return;
  }

  if (typeof setTimeout === "function") {
    logEl.__pixelRunnerLogScrollTimeoutId = setTimeout(() => {
      logEl.__pixelRunnerLogScrollTimeoutId = null;
      scrollLogToBottom(logEl);
    }, 16);
  }
}

function renderLogLine(logEl, line) {
  if (!logEl) return;
  appendLogText(logEl, line);
  // Always follow latest log for progress visibility, but collapse follow-up scroll work.
  scrollLogToBottom(logEl);
  scheduleLogScrollToBottom(logEl);
}

function clearLogView(logEl) {
  if (!logEl) return;
  clearPendingLogScroll(logEl);
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
