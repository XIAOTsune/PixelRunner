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
        pending.reject(new Error(String(payload.error.message || "宿主通信请求失败")));
        return;
      }

      pending.resolve(payload.result);
    });

    bridgeState.listenerBound = true;
  }

  function callHost(method, args = [], options = {}) {
    if (!isPluginRuntime()) {
      return Promise.reject(new Error("浏览器预览模式下不可使用宿主桥接能力"));
    }

    ensureBridgeListener();

    const id = `bridge-${Date.now()}-${++bridgeState.seq}`;
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 8000);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        bridgeState.pending.delete(id);
        reject(new Error(`宿主通信超时：${method}`));
      }, timeoutMs);

      bridgeState.pending.set(id, { resolve, reject, timer });

      const posted = postHostMessage({ id, method, args });
      if (!posted) {
        clearTimeout(timer);
        bridgeState.pending.delete(id);
        reject(new Error(`发送宿主消息失败：${method}`));
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

  function getUxpFileSystem() {
    return global && global.uxp && global.uxp.storage && global.uxp.storage.localFileSystem
      ? global.uxp.storage.localFileSystem
      : null;
  }

  function getUtf8ByteLength(value) {
    let length = 0;
    for (const character of String(value == null ? "" : value)) {
      const codePoint = character.codePointAt(0);
      if (codePoint <= 0x7f) length += 1;
      else if (codePoint <= 0x7ff) length += 2;
      else if (codePoint <= 0xffff) length += 3;
      else length += 4;
    }
    return length;
  }

  function getUxpUtf8Options() {
    const format = global && global.uxp && global.uxp.storage && global.uxp.storage.formats
      ? global.uxp.storage.formats.utf8
      : null;
    return format ? { format } : null;
  }

  function hasHostMessageBridge() {
    return Boolean(global && global.uxpHost && typeof global.uxpHost.postMessage === "function");
  }

  async function saveTextFile(defaultName, text, options = {}) {
    const filename = String(defaultName || "export.txt").trim() || "export.txt";
    const content = String(text == null ? "" : text);
    if (!content) throw new Error("没有可导出的文件内容");

    if (hasHostMessageBridge()) {
      return callHost(
        "file.saveText",
        [{
          filename,
          content,
          extension: String(options.extension || ".txt"),
          mimeType: String(options.mimeType || "text/plain")
        }],
        { timeoutMs: 600000 }
      );
    }

    const fileSystem = getUxpFileSystem();
    if (fileSystem && typeof fileSystem.getFileForSaving === "function") {
      const entry = await fileSystem.getFileForSaving(filename);
      if (!entry) return { outcome: "cancelled", savedPath: "" };
      const utf8Options = getUxpUtf8Options();
      if (!utf8Options) throw new Error("当前 UXP 版本未提供 UTF-8 文件格式");
      await entry.write(content, utf8Options);
      const persisted = typeof entry.read === "function" ? String(await entry.read(utf8Options)) : "";
      if (persisted !== content) {
        throw new Error(`资料包写入校验失败：预计 ${getUtf8ByteLength(content)} 字节，实际 ${getUtf8ByteLength(persisted)} 字节`);
      }
      return {
        outcome: "saved",
        savedPath: String(entry.nativePath || entry.name || filename),
        byteLength: getUtf8ByteLength(persisted)
      };
    }

    if (typeof global.showSaveFilePicker === "function") {
      try {
        const handle = await global.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: String(options.description || "Text File"),
              accept: { [String(options.mimeType || "text/plain")]: [String(options.extension || ".txt")] }
            }
          ]
        });
        if (!handle) return { outcome: "cancelled", savedPath: "" };
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        const savedFile = typeof handle.getFile === "function" ? await handle.getFile() : null;
        if (savedFile && Number(savedFile.size) !== getUtf8ByteLength(content)) {
          throw new Error(`资料包写入校验失败：预计 ${getUtf8ByteLength(content)} 字节，实际 ${Number(savedFile.size) || 0} 字节`);
        }
        return {
          outcome: "saved",
          savedPath: String(handle.name || filename),
          byteLength: savedFile ? Number(savedFile.size) || 0 : getUtf8ByteLength(content)
        };
      } catch (error) {
        if (error && error.name === "AbortError") return { outcome: "cancelled", savedPath: "" };
        throw error;
      }
    }

    if (typeof document !== "undefined" && typeof global.URL !== "undefined" && typeof global.Blob !== "undefined") {
      const blob = new Blob([content], { type: String(options.mimeType || "text/plain") });
      const href = global.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filename;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      global.setTimeout(() => global.URL.revokeObjectURL(href), 0);
      return { outcome: "saved", savedPath: filename, byteLength: getUtf8ByteLength(content) };
    }

    return { outcome: "unsupported", savedPath: "" };
  }

  async function openTextFile(options = {}) {
    if (hasHostMessageBridge()) {
      return callHost(
        "file.openText",
        [{
          extension: String(options.extension || ".txt"),
          mimeType: String(options.mimeType || "text/plain")
        }],
        { timeoutMs: 600000 }
      );
    }

    const fileSystem = getUxpFileSystem();
    if (fileSystem && typeof fileSystem.getFileForOpening === "function") {
      const picked = await fileSystem.getFileForOpening();
      const entry = Array.isArray(picked) ? picked[0] : picked;
      if (!entry) return { outcome: "cancelled", name: "", text: "" };
      const utf8Options = getUxpUtf8Options();
      if (!utf8Options) throw new Error("当前 UXP 版本未提供 UTF-8 文件格式");
      const text = await entry.read(utf8Options);
      return {
        outcome: "loaded",
        name: String(entry.name || ""),
        text: String(text == null ? "" : text)
      };
    }

    if (typeof global.showOpenFilePicker === "function") {
      try {
        const handles = await global.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: String(options.description || "Text File"),
              accept: { [String(options.mimeType || "text/plain")]: [String(options.extension || ".txt")] }
            }
          ]
        });
        const handle = Array.isArray(handles) ? handles[0] : null;
        if (!handle) return { outcome: "cancelled", name: "", text: "" };
        const file = await handle.getFile();
        return {
          outcome: "loaded",
          name: String(file.name || ""),
          text: await file.text()
        };
      } catch (error) {
        if (error && error.name === "AbortError") return { outcome: "cancelled", name: "", text: "" };
        throw error;
      }
    }

    if (typeof document !== "undefined") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = String(options.accept || ".json,application/json,text/plain");
      input.style.display = "none";
      document.body.appendChild(input);

      const result = await new Promise((resolve, reject) => {
        input.addEventListener(
          "change",
          async () => {
            try {
              const file = input.files && input.files[0];
              if (!file) {
                resolve({ outcome: "cancelled", name: "", text: "" });
                return;
              }
              resolve({
                outcome: "loaded",
                name: String(file.name || ""),
                text: await file.text()
              });
            } catch (error) {
              reject(error);
            }
          },
          { once: true }
        );
        input.click();
      });

      document.body.removeChild(input);
      return result;
    }

    return { outcome: "unsupported", name: "", text: "" };
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
    setSummaryStatus,
    saveTextFile,
    openTextFile
  };
})(window);
