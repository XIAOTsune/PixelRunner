const {
  getLogText: getLogTextDefault,
  buildLogLine: buildLogLineDefault,
  renderLogLine: renderLogLineDefault,
  clearLogView: clearLogViewDefault
} = require("./log-view");
const { buildPromptLengthLogSummary: buildPromptLengthLogSummaryDefault } = require("../../application/services/prompt-log");

function hasSelectionRange(logWindow) {
  return (
    logWindow &&
    typeof logWindow.selectionStart === "number" &&
    typeof logWindow.selectionEnd === "number"
  );
}

function nodeContains(container, node) {
  if (!container || !node || typeof container.contains !== "function") return false;
  try {
    return container === node || container.contains(node);
  } catch (_) {
    return false;
  }
}

function selectionBelongsToLogWindow(selection, logWindow) {
  if (!selection || !logWindow) return false;

  if (typeof selection.rangeCount === "number" && selection.rangeCount > 0 && typeof selection.getRangeAt === "function") {
    for (let i = 0; i < selection.rangeCount; i += 1) {
      try {
        const range = selection.getRangeAt(i);
        if (!range) continue;
        if (nodeContains(logWindow, range.startContainer) && nodeContains(logWindow, range.endContainer)) {
          return true;
        }
      } catch (_) {}
    }
  }

  const anchorNode = selection.anchorNode || null;
  const focusNode = selection.focusNode || null;
  if (!anchorNode || !focusNode) return false;
  return nodeContains(logWindow, anchorNode) && nodeContains(logWindow, focusNode);
}

function pickSelectedLogText(logWindow, fullText, windowRef) {
  if (!logWindow) return "";
  const text = String(fullText || "");
  if (hasSelectionRange(logWindow)) {
    const start = Math.max(0, Math.min(text.length, logWindow.selectionStart));
    const end = Math.max(start, Math.min(text.length, logWindow.selectionEnd));
    if (end > start) return text.slice(start, end);
  }

  const runtimeWindow = windowRef || (typeof window !== "undefined" ? window : null);
  if (runtimeWindow && typeof runtimeWindow.getSelection === "function") {
    const selection = runtimeWindow.getSelection();
    if (
      selection &&
      typeof selection.toString === "function" &&
      selectionBelongsToLogWindow(selection, logWindow)
    ) {
      const selected = String(selection.toString() || "");
      if (selected.length > 0) return selected;
    }
  }
  return "";
}

function copyViaLogWindowSelection(payload, documentRef, logWindow) {
  if (!documentRef || typeof documentRef.execCommand !== "function" || !logWindow || !hasSelectionRange(logWindow)) {
    return false;
  }

  let originalStart = logWindow.selectionStart;
  let originalEnd = logWindow.selectionEnd;

  try {
    if (typeof logWindow.focus === "function") logWindow.focus();
    if (typeof logWindow.select === "function") {
      logWindow.select();
    } else if (typeof logWindow.setSelectionRange === "function") {
      logWindow.setSelectionRange(0, payload.length);
    }
    return Boolean(documentRef.execCommand("copy"));
  } catch (_) {
    return false;
  } finally {
    if (typeof logWindow.setSelectionRange === "function") {
      try {
        logWindow.setSelectionRange(originalStart, originalEnd);
      } catch (_) {}
    }
  }
}

function copyViaTemporaryTextarea(payload, documentRef) {
  if (
    !documentRef ||
    typeof documentRef.execCommand !== "function" ||
    typeof documentRef.createElement !== "function" ||
    !documentRef.body ||
    typeof documentRef.body.appendChild !== "function" ||
    typeof documentRef.body.removeChild !== "function"
  ) {
    return false;
  }

  let helperEl = null;
  try {
    helperEl = documentRef.createElement("textarea");
    if (!helperEl) return false;
    helperEl.value = payload;
    helperEl.setAttribute("readonly", "readonly");
    helperEl.style.position = "fixed";
    helperEl.style.opacity = "0";
    helperEl.style.pointerEvents = "none";
    helperEl.style.left = "-9999px";
    helperEl.style.top = "0";
    documentRef.body.appendChild(helperEl);
    if (typeof helperEl.focus === "function") helperEl.focus();
    if (typeof helperEl.select === "function") helperEl.select();
    if (typeof helperEl.setSelectionRange === "function") helperEl.setSelectionRange(0, payload.length);
    return Boolean(documentRef.execCommand("copy"));
  } catch (_) {
    return false;
  } finally {
    if (helperEl && helperEl.parentNode === documentRef.body) {
      try {
        documentRef.body.removeChild(helperEl);
      } catch (_) {}
    }
  }
}

async function writeClipboardTextDefault(text, options = {}) {
  const payload = String(text || "");
  if (!payload) return false;

  async function tryInvokeClipboardMethod(method, ...args) {
    if (typeof method !== "function") return false;
    try {
      const result = method(...args);
      if (result && typeof result.then === "function") {
        await result;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  const navigatorRef = options.navigatorRef || (typeof navigator !== "undefined" ? navigator : null);
  if (navigatorRef && navigatorRef.clipboard && typeof navigatorRef.clipboard.writeText === "function") {
    try {
      await navigatorRef.clipboard.writeText(payload);
      return true;
    } catch (_) {}
  }

  if (typeof require === "function") {
    try {
      const uxp = require("uxp");
      const clipboard = uxp && uxp.clipboard;
      if (clipboard && (await tryInvokeClipboardMethod(clipboard.writeText, payload))) return true;
      if (clipboard && (await tryInvokeClipboardMethod(clipboard.copyText, payload))) return true;
      if (clipboard && (await tryInvokeClipboardMethod(clipboard.setContent, { "text/plain": payload }))) return true;
    } catch (_) {}
  }

  const documentRef = options.documentRef || (typeof document !== "undefined" ? document : null);
  const logWindow = options.logWindow || null;
  if (copyViaLogWindowSelection(payload, documentRef, logWindow)) return true;
  if (copyViaTemporaryTextarea(payload, documentRef)) return true;

  return false;
}

function createWorkspaceLogController(options = {}) {
  const dom = options.dom || {};
  const byId = typeof options.byId === "function" ? options.byId : () => null;
  const getLogText = typeof options.getLogText === "function" ? options.getLogText : getLogTextDefault;
  const buildLogLine = typeof options.buildLogLine === "function" ? options.buildLogLine : buildLogLineDefault;
  const renderLogLine = typeof options.renderLogLine === "function" ? options.renderLogLine : renderLogLineDefault;
  const clearLogView = typeof options.clearLogView === "function" ? options.clearLogView : clearLogViewDefault;
  const writeClipboardText =
    typeof options.writeClipboardText === "function" ? options.writeClipboardText : writeClipboardTextDefault;
  const windowRef = options.windowRef || (typeof window !== "undefined" ? window : null);
  const navigatorRef = options.navigatorRef || (typeof navigator !== "undefined" ? navigator : null);
  const documentRef = options.documentRef || (typeof document !== "undefined" ? document : null);
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

  async function onCopyLogClick() {
    const logWindow = resolveLogWindow();
    if (!logWindow) return false;

    const fullText = getLogText(logWindow);
    if (!fullText) {
      log("No log content to copy.", "warn");
      return false;
    }
    const selectedText = pickSelectedLogText(logWindow, fullText, windowRef);
    const payload = selectedText || fullText;
    const copied = await writeClipboardText(payload, {
      logWindow,
      navigatorRef,
      documentRef
    });
    if (!copied) {
      log("Copy failed: clipboard API unavailable.", "warn");
      return false;
    }

    log(`Log copied (${selectedText ? "selection" : "all"}; ${payload.length} chars).`, "info");
    return true;
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
    onCopyLogClick,
    logPromptLengthsBeforeRun
  };
}

module.exports = {
  createWorkspaceLogController
};
