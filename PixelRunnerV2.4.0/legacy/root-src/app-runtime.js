(function initRuntimeModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  const bridgeState = {
    seq: 0,
    pending: new Map(),
    listenerBound: false
  };

  function isPluginRuntime() {
    return typeof global !== "undefined" && (!!global.uxp || !!global.uxpHost);
  }

  function getById(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function createId(prefix = "id") {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function readBrowserStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function writeBrowserStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function postHostMessage(message) {
    if (typeof global === "undefined") return false;
    if (!global.uxpHost || typeof global.uxpHost.postMessage !== "function") return false;

    try {
      global.uxpHost.postMessage(message);
      return true;
    } catch (_) {
      return false;
    }
  }

  function ensureBridgeListener() {
    if (bridgeState.listenerBound || typeof global === "undefined") return;

    global.addEventListener("message", (event) => {
      const payload = event && event.data;
      if (!payload || typeof payload !== "object") return;
      if (!("id" in payload) || (!("result" in payload) && !("error" in payload))) return;

      const pending = bridgeState.pending.get(payload.id);
      if (!pending) return;

      bridgeState.pending.delete(payload.id);
      clearTimeout(pending.timer);

      if (payload.error) {
        pending.reject(new Error(String(payload.error.message || "Bridge request failed")));
        return;
      }

      pending.resolve(payload.result);
    });

    bridgeState.listenerBound = true;
  }

  function callHost(method, args = [], options = {}) {
    if (!isPluginRuntime()) {
      return Promise.reject(new Error("Host bridge unavailable in browser preview"));
    }

    ensureBridgeListener();

    const id = `bridge-${Date.now()}-${++bridgeState.seq}`;
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 8000);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        bridgeState.pending.delete(id);
        reject(new Error(`Bridge timeout: ${method}`));
      }, timeoutMs);

      bridgeState.pending.set(id, { resolve, reject, timer });

      const posted = postHostMessage({ id, method, args });
      if (!posted) {
        clearTimeout(timer);
        bridgeState.pending.delete(id);
        reject(new Error(`Failed to post host message: ${method}`));
      }
    });
  }

  async function storageGetItem(key) {
    if (isPluginRuntime()) {
      try {
        return await callHost("storage.getItem", [key]);
      } catch (_) {
        return readBrowserStorage(key);
      }
    }

    return readBrowserStorage(key);
  }

  async function storageSetItem(key, value) {
    if (isPluginRuntime()) {
      try {
        return await callHost("storage.setItem", [key, value]);
      } catch (_) {
        return writeBrowserStorage(key, value);
      }
    }

    return writeBrowserStorage(key, value);
  }

  function readJsonText(rawValue, fallback) {
    if (!rawValue) return fallback;
    try {
      return JSON.parse(rawValue);
    } catch (_) {
      return fallback;
    }
  }

  function setSummaryStatus(element, message, type = "info") {
    if (!element) return;
    element.textContent = String(message || "");
    element.dataset.status = String(type || "info");
  }

  modules.runtime = {
    bridgeState,
    isPluginRuntime,
    getById,
    escapeHtml,
    createId,
    postHostMessage,
    callHost,
    storageGetItem,
    storageSetItem,
    readJsonText,
    setSummaryStatus
  };
})(window);
