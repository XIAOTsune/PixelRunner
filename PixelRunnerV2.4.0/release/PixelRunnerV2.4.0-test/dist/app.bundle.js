var PixelRunnerWebviewBundle = (() => {
  // src/webview/runtime.js
  (function initRuntimeModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    const bridgeState = {
      seq: 0,
      pending: /* @__PURE__ */ new Map(),
      listenerBound: false
    };
    function isPluginRuntime() {
      return typeof global !== "undefined" && (!!global.uxp || !!global.uxpHost);
    }
    function getById(id) {
      return document.getElementById(id);
    }
    function escapeHtml(value) {
      return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
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
        if (!("id" in payload) || !("result" in payload) && !("error" in payload)) return;
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
      const timeoutMs = Math.max(1e3, Number(options.timeoutMs) || 8e3);
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

  // src/webview/state.js
  (function initStateModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    const STORAGE_KEYS = {
      API_KEY: "rh_api_key",
      SETTINGS: "rh_settings",
      APPS: "rh_ai_apps_v2",
      PROMPT_TEMPLATES: "rh_prompt_templates",
      LEGACY_APPS: ["rh_ai_apps", "rh_ai_apps_v1", "ai_apps", "runninghub_ai_apps"],
      CURRENT_APP_ID: "pixelrunner.current_app_id"
    };
    const DEFAULT_SETTINGS = {
      apiKey: "",
      pollInterval: 2,
      timeout: 180,
      maxConcurrentTasks: 3
    };
    const state = {
      apps: [],
      currentApp: null,
      templates: [],
      appPickerKeyword: "",
      appManagerKeyword: "",
      appManagerSort: "updated_desc",
      templateManagerKeyword: "",
      templateManagerSort: "updated_desc",
      settings: { ...DEFAULT_SETTINGS },
      settingsLoaded: false,
      hostRuntime: null,
      currentDocumentInfo: null,
      editingAppId: null,
      editingTemplateId: null,
      appEditorSnapshot: "",
      templateEditorSnapshot: "",
      formValues: {},
      templatePicker: {
        open: false,
        targetKey: "",
        selectedIds: [],
        keyword: "",
        mode: "multiple",
        maxSelection: 5,
        applyMode: "replace"
      },
      imageCapture: {
        asset: null,
        assets: [],
        selectedAssetId: "",
        maxDimension: 1536,
        quality: 82
      },
      lastRunPayload: null,
      lastResult: {
        appName: "",
        sourceDocument: null,
        outputUrl: "",
        taskId: "",
        placedAt: 0
      },
      runningTasks: [],
      runningTask: {
        taskId: "",
        appName: "",
        status: "idle"
      }
    };
    function normalizeSettings(settings) {
      const source = settings && typeof settings === "object" ? settings : {};
      const pollInterval = Math.min(15, Math.max(1, Math.floor(Number(source.pollInterval) || DEFAULT_SETTINGS.pollInterval)));
      const timeout = Math.min(600, Math.max(10, Math.floor(Number(source.timeout) || DEFAULT_SETTINGS.timeout)));
      const maxConcurrentTasks = Math.min(100, Math.max(1, Math.floor(Number(source.maxConcurrentTasks) || DEFAULT_SETTINGS.maxConcurrentTasks)));
      return {
        apiKey: String(source.apiKey || "").trim(),
        pollInterval,
        timeout,
        maxConcurrentTasks
      };
    }
    function normalizeAppInputs(inputs) {
      if (!Array.isArray(inputs)) return [];
      return inputs.filter((item) => item && typeof item === "object").map((item, index) => {
        const source = item && typeof item === "object" ? item : {};
        const key = String(source.key || source.name || `param_${index + 1}`).trim();
        if (!key) return null;
        return {
          ...source,
          key,
          label: String(source.label || source.name || key).trim(),
          name: String(source.name || source.label || key).trim(),
          type: String(source.type || "text").trim() || "text",
          required: source.required !== false,
          default: source.default,
          options: Array.isArray(source.options) ? source.options : void 0
        };
      }).filter(Boolean);
    }
    function resolveAppId(source) {
      if (!source || typeof source !== "object") return "";
      const candidates = [
        source.appId,
        source.webappId,
        source.webAppId,
        source.workflowId,
        source.workflowID,
        source.code,
        source.appid,
        source.webappid
      ];
      for (let index = 0; index < candidates.length; index += 1) {
        const value = String(candidates[index] == null ? "" : candidates[index]).trim();
        if (!value) continue;
        if (["null", "undefined"].includes(value.toLowerCase())) continue;
        return value;
      }
      return "";
    }
    function normalizeAppRecord(app, index = 0) {
      const runtime = modules.runtime;
      const source = app && typeof app === "object" ? app : {};
      const now = Date.now();
      const appId = resolveAppId(source);
      const id = String(source.id || "").trim() || runtime.createId("app");
      const fallbackName = `应用 ${index + 1}`;
      const name = String(source.name || source.title || fallbackName).trim() || fallbackName;
      return {
        id,
        appId,
        name,
        description: String(source.description || "").trim(),
        inputs: normalizeAppInputs(source.inputs),
        createdAt: Number(source.createdAt) > 0 ? Number(source.createdAt) : now,
        updatedAt: Number(source.updatedAt) > 0 ? Number(source.updatedAt) : now
      };
    }
    function normalizeTemplateRecord(template, index = 0) {
      const runtime = modules.runtime;
      const source = template && typeof template === "object" ? template : {};
      const id = String(source.id || "").trim() || runtime.createId("tpl");
      const title = String(source.title || "").trim();
      const content = String(source.content == null ? "" : source.content);
      const now = Date.now();
      if (!title || !content.trim()) return null;
      return {
        id,
        title,
        content,
        createdAt: Number(source.createdAt) > 0 ? Number(source.createdAt) : now + index,
        updatedAt: Number(source.updatedAt) > 0 ? Number(source.updatedAt) : now + index
      };
    }
    function normalizeTemplateList(templates) {
      const seenIds = /* @__PURE__ */ new Set();
      return (Array.isArray(templates) ? templates : []).map((item, index) => normalizeTemplateRecord(item, index)).filter((item) => {
        if (!item) return false;
        if (seenIds.has(item.id)) item.id = modules.runtime.createId("tpl");
        seenIds.add(item.id);
        return true;
      });
    }
    function normalizeAppList(apps) {
      return (Array.isArray(apps) ? apps : []).filter((item) => item && typeof item === "object").map((item, index) => normalizeAppRecord(item, index)).filter((item) => item.appId);
    }
    function getAppInputCount(app) {
      return Array.isArray(app && app.inputs) ? app.inputs.length : 0;
    }
    function getAppDisplayName(app) {
      return String(app && (app.name || app.title) || "未命名应用");
    }
    function getAppDisplayId(app) {
      return String(app && (app.appId || app.id) || "-");
    }
    function isPromptLikeInput(input) {
      if (!input || typeof input !== "object") return false;
      const key = String(input.key || "").toLowerCase();
      const label = String(input.label || input.name || "").toLowerCase();
      return /prompt|negative|positive|提示词|负向|正向/.test(`${key} ${label}`);
    }
    function buildDefaultFormValues(app) {
      const values = {};
      const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
      inputs.forEach((input) => {
        const key = String(input.key || "").trim();
        if (!key) return;
        if (input.default != null) {
          values[key] = input.default;
          return;
        }
        if (input.type === "boolean" || input.type === "switch" || input.type === "checkbox") {
          values[key] = false;
          return;
        }
        if (input.type === "image" || input.type === "file") {
          values[key] = null;
          return;
        }
        values[key] = "";
      });
      return values;
    }
    modules.state = {
      STORAGE_KEYS,
      DEFAULT_SETTINGS,
      state,
      normalizeSettings,
      normalizeAppInputs,
      resolveAppId,
      normalizeAppRecord,
      normalizeAppList,
      normalizeTemplateRecord,
      normalizeTemplateList,
      getAppInputCount,
      getAppDisplayName,
      getAppDisplayId,
      isPromptLikeInput,
      buildDefaultFormValues
    };
  })(window);

  // src/webview/ui.js
  (function initUiModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    function logToWorkspace(message, type = "info") {
      const runtime = modules.runtime;
      const logWindow = runtime.getById("logWindow");
      if (!logWindow) return;
      const normalizedType = String(type || "info").toUpperCase();
      const text = `[${normalizedType}] ${String(message || "")}`;
      logWindow.value = logWindow.value ? `${logWindow.value}
${text}` : text;
      logWindow.scrollTop = logWindow.scrollHeight;
      runtime.postHostMessage({
        type: "pixelrunner.webview.log",
        level: String(type || "info"),
        message: String(message || "")
      });
    }
    function setActiveView(activeTabId) {
      Object.entries(modules.main.VIEW_MAP).forEach(([tabId, viewId]) => {
        const tab = modules.runtime.getById(tabId);
        const view = modules.runtime.getById(viewId);
        const isActive = tabId === activeTabId;
        if (tab) tab.classList.toggle("active", isActive);
        if (view) {
          view.classList.toggle("active", isActive);
          view.classList.toggle("is-hidden", !isActive);
        }
      });
    }
    function bindTabs() {
      Object.keys(modules.main.VIEW_MAP).forEach((tabId) => {
        const tab = modules.runtime.getById(tabId);
        if (!tab) return;
        tab.addEventListener("click", () => setActiveView(tabId));
      });
    }
    function bindTactileFeedback() {
      document.querySelectorAll(".ghost-btn, .mini-btn, .secondary-btn, .primary-btn, .nav-tab").forEach((element) => {
        let releaseTimer = null;
        const clearPressed = () => {
          if (releaseTimer) clearTimeout(releaseTimer);
          releaseTimer = null;
          element.classList.remove("is-pressed");
        };
        const setPressed = () => {
          if (releaseTimer) clearTimeout(releaseTimer);
          releaseTimer = null;
          element.classList.add("is-pressed");
        };
        const releasePressed = () => {
          if (releaseTimer) clearTimeout(releaseTimer);
          releaseTimer = setTimeout(() => {
            element.classList.remove("is-pressed");
            releaseTimer = null;
          }, 120);
        };
        element.addEventListener("pointerdown", setPressed);
        element.addEventListener("pointerup", releasePressed);
        element.addEventListener("pointercancel", clearPressed);
        element.addEventListener("pointerleave", clearPressed);
        element.addEventListener("mouseleave", clearPressed);
        element.addEventListener("blur", clearPressed);
      });
    }
    function bindPlaceholderActions() {
      const runtime = modules.runtime;
      const logWindow = runtime.getById("logWindow");
      const donateButtons = ["btnDonate", "btnDonateTools", "btnDonateSettings"].map((id) => runtime.getById(id)).filter(Boolean);
      const clearButton = runtime.getById("btnClearLog");
      donateButtons.forEach((button) => {
        if (!logWindow) return;
        button.addEventListener("click", () => {
          logWindow.value += "\n[提示] 支持项目入口已预留，后续会接入正式弹窗和外链。";
          logWindow.scrollTop = logWindow.scrollHeight;
        });
      });
      if (clearButton && logWindow) {
        clearButton.addEventListener("click", () => {
          logWindow.value = "[系统] 日志已清空，等待新的操作记录。";
        });
      }
    }
    function bindToolActions() {
      const toolConfigs = [
        { id: "btnObserver", payload: { action: "observerLayer", layerName: "黑白观察层" }, pending: "正在创建黑白观察层...", success: (result) => result && result.message ? result.message : "已创建黑白观察层" },
        { id: "btnNeutralGray", payload: { action: "neutralGrayLayer" }, pending: "正在创建中性灰图层...", success: (result) => result && result.message ? result.message : "已创建中性灰图层" },
        { id: "btnGaussianBlur", payload: { action: "gaussianBlur", radius: 4 }, pending: "正在执行高斯模糊...", success: (result) => result && result.message ? result.message : "已执行高斯模糊" },
        { id: "btnSharpen", payload: { action: "sharpen" }, pending: "正在执行锐化...", success: (result) => result && result.message ? result.message : "已执行锐化" },
        { id: "btnHighPass", payload: { action: "highPass", radius: 2 }, pending: "正在执行高反差保留...", success: (result) => result && result.message ? result.message : "已执行高反差保留" },
        { id: "btnStamp", payload: { action: "stampVisible", layerName: "盖印图层" }, pending: "正在生成盖印图层...", success: (result) => result && result.message ? result.message : "已生成盖印图层" },
        { id: "btnContentAwareFill", payload: { action: "contentAwareFill" }, pending: "正在触发内容识别填充...", success: (result) => result && result.message ? result.message : "已触发内容识别填充" },
        { id: "btnSelectAndMask", payload: { action: "selectAndMask" }, pending: "正在触发选择并遮住...", success: (result) => result && result.message ? result.message : "已触发选择并遮住" }
      ];
      toolConfigs.forEach((config) => {
        const button = modules.runtime.getById(config.id);
        if (!button) return;
        button.addEventListener("click", async () => {
          if (!modules.runtime.isPluginRuntime()) {
            logToWorkspace(`浏览器预览模式下不会执行工具动作：${config.id}`, "info");
            return;
          }
          button.disabled = true;
          logToWorkspace(config.pending, "info");
          try {
            const result = await modules.runtime.callHost("photoshop.runToolAction", [config.payload], { timeoutMs: 45e3 });
            logToWorkspace(config.success(result), "success");
          } catch (error) {
            logToWorkspace(`工具执行失败：${error.message}`, "error");
          } finally {
            button.disabled = false;
          }
        });
      });
    }
    modules.ui = { logToWorkspace, setActiveView, bindTabs, bindTactileFeedback, bindPlaceholderActions, bindToolActions };
  })(window);

  // src/webview/workspace.js
  (function initWorkspaceModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    const RUN_BUTTON_COOLDOWN_MS = 1500;
    const TASK_CARD_LIMIT = 24;
    let runButtonCooldownUntil = 0;
    let taskTickerHandle = 0;
    function setModalOpen(modalId, open) {
      const modal = modules.runtime.getById(modalId);
      if (!modal) return;
      modal.classList.toggle("is-open", open);
      document.body.classList.toggle("modal-open", open);
    }
    function isImageInput(input) {
      const type = String(input && input.type || "").trim().toLowerCase();
      return type === "image" || type === "file";
    }
    function isPromptField(input) {
      return modules.state.isPromptLikeInput(input) && !isImageInput(input);
    }
    function hasImageAsset(asset) {
      return Boolean(
        asset && typeof asset === "object" && ((asset.dataUrl || "").trim() || (asset.base64 || "").trim() || (asset.url || "").trim() || (asset.uploadDataUrl || "").trim() || (asset.uploadBase64 || "").trim())
      );
    }
    function findImageInputs(app) {
      return (Array.isArray(app && app.inputs) ? app.inputs : []).filter(isImageInput);
    }
    function getResultDefaultLayerName() {
      const state = modules.state.state;
      const appName = String(state.lastResult && state.lastResult.appName || state.currentApp && state.currentApp.name || "Result").trim();
      return `PixelRunner - ${appName}`;
    }
    function formatSelectionLabel(selectionBounds) {
      if (!selectionBounds) return "整张文档";
      const width = Math.max(0, Number(selectionBounds.right) - Number(selectionBounds.left));
      const height = Math.max(0, Number(selectionBounds.bottom) - Number(selectionBounds.top));
      return `${Math.round(width)}x${Math.round(height)}`;
    }
    function formatDocumentLabel(docInfo) {
      if (!docInfo || !docInfo.hasActiveDocument) return "无活动文档";
      const title = String(docInfo.title || "Untitled");
      const documentId = Number(docInfo.documentId) || 0;
      const sizeText = Number.isFinite(Number(docInfo.width)) && Number.isFinite(Number(docInfo.height)) ? ` ${Math.round(Number(docInfo.width))}x${Math.round(Number(docInfo.height))}` : "";
      return `${title} (#${documentId})${sizeText}`;
    }
    function getImageCaptureSettings() {
      const state = modules.state.state;
      const maxDimensionInput = modules.runtime.getById("imageCaptureMaxDimension");
      const qualityInput = modules.runtime.getById("imageCaptureQuality");
      if (maxDimensionInput) {
        state.imageCapture.maxDimension = Math.max(256, Math.min(4096, Math.floor(Number(maxDimensionInput.value) || 1536)));
      }
      if (qualityInput) {
        state.imageCapture.quality = Math.max(20, Math.min(100, Math.floor(Number(qualityInput.value) || 82)));
      }
      return {
        maxDimension: state.imageCapture.maxDimension,
        quality: state.imageCapture.quality
      };
    }
    function cloneCaptureAsset(asset) {
      if (!hasImageAsset(asset)) return null;
      return {
        assetId: String(asset.assetId || ""),
        capturedAt: Number(asset.capturedAt) || 0,
        capturedFromSelection: Boolean(asset.capturedFromSelection),
        kind: String(asset.kind || "captured-document-image"),
        source: String(asset.source || "photoshop-document"),
        documentId: Number(asset.documentId) || null,
        document: asset.document && typeof asset.document === "object" ? { ...asset.document } : null,
        width: Number(asset.width) || null,
        height: Number(asset.height) || null,
        originalWidth: Number(asset.originalWidth) || null,
        originalHeight: Number(asset.originalHeight) || null,
        quality: Number(asset.quality) || null,
        maxDimension: Number(asset.maxDimension) || null,
        mimeType: String(asset.mimeType || "image/jpeg"),
        dataUrl: String(asset.dataUrl || ""),
        base64: String(asset.base64 || ""),
        url: String(asset.url || ""),
        uploadMimeType: String(asset.uploadMimeType || asset.mimeType || "image/jpeg"),
        uploadDataUrl: String(asset.uploadDataUrl || ""),
        uploadBase64: String(asset.uploadBase64 || ""),
        uploadBytes: Number(asset.uploadBytes) || null,
        uploadQuality: Number(asset.uploadQuality) || null,
        uploadTargetBytes: Number(asset.uploadTargetBytes) || null,
        uploadHardLimitBytes: Number(asset.uploadHardLimitBytes) || null,
        compressionAttempts: Array.isArray(asset.compressionAttempts) ? asset.compressionAttempts.map((attempt) => ({
          quality: Number(attempt && attempt.quality) || null,
          bytes: Number(attempt && attempt.bytes) || null
        })) : []
      };
    }
    function getImageAssetPreviewSrc(asset) {
      if (!asset || typeof asset !== "object") return "";
      const dataUrl = String(asset.dataUrl || "").trim();
      if (dataUrl) return dataUrl;
      const base64 = String(asset.base64 || "").trim();
      if (base64) {
        const mimeType = String(asset.mimeType || "image/jpeg").trim() || "image/jpeg";
        return `data:${mimeType};base64,${base64}`;
      }
      const uploadDataUrl = String(asset.uploadDataUrl || "").trim();
      if (uploadDataUrl) return uploadDataUrl;
      const uploadBase64 = String(asset.uploadBase64 || "").trim();
      if (uploadBase64) {
        const uploadMimeType = String(asset.uploadMimeType || asset.mimeType || "image/jpeg").trim() || "image/jpeg";
        return `data:${uploadMimeType};base64,${uploadBase64}`;
      }
      return String(asset.url || "").trim();
    }
    function buildImageInputPayloadValue(asset) {
      if (!asset || typeof asset !== "object") return asset;
      const uploadDataUrl = String(asset.uploadDataUrl || "").trim();
      const uploadBase64 = String(asset.uploadBase64 || "").trim();
      const uploadMimeType = String(asset.uploadMimeType || asset.mimeType || "image/jpeg").trim() || "image/jpeg";
      const previewDataUrl = String(asset.dataUrl || "").trim();
      const previewBase64 = String(asset.base64 || "").trim();
      const payloadValue = {
        dataUrl: uploadDataUrl || previewDataUrl,
        base64: uploadBase64 || previewBase64,
        url: String(asset.url || "").trim(),
        mimeType: uploadMimeType,
        width: Number(asset.originalWidth) || Number(asset.width) || null,
        height: Number(asset.originalHeight) || Number(asset.height) || null,
        bytes: Number(asset.uploadBytes) || null,
        quality: Number(asset.uploadQuality) || null
      };
      return payloadValue;
    }
    function normalizePayloadInputs(app, formValues) {
      const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
      const source = formValues && typeof formValues === "object" ? formValues : {};
      const out = { ...source };
      inputs.forEach((input) => {
        if (!isImageInput(input)) return;
        const key = String(input && input.key || "").trim();
        if (!key || !(key in out)) return;
        out[key] = buildImageInputPayloadValue(out[key]);
      });
      return out;
    }
    function createCaptureAssetId() {
      return `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    function getCaptureAssets() {
      return Array.isArray(modules.state.state.imageCapture.assets) ? modules.state.state.imageCapture.assets.filter(hasImageAsset) : [];
    }
    function pushCapturedAsset(asset) {
      const state = modules.state.state;
      const nextAsset = cloneCaptureAsset({
        ...asset,
        assetId: asset && asset.assetId ? asset.assetId : createCaptureAssetId(),
        capturedAt: Number(asset && asset.capturedAt) > 0 ? Number(asset.capturedAt) : Date.now()
      });
      if (!nextAsset) return null;
      state.imageCapture.assets = [
        nextAsset,
        ...getCaptureAssets().filter((item) => String(item.assetId || "") !== String(nextAsset.assetId || ""))
      ].slice(0, 12);
      state.imageCapture.selectedAssetId = String(nextAsset.assetId || "");
      state.imageCapture.asset = nextAsset;
      return nextAsset;
    }
    function clearImageInputValue(key) {
      modules.state.state.formValues[key] = null;
      renderWorkspace();
    }
    function logImageCaptureTrace(message, data = null) {
      const detail = data && typeof data === "object" ? ` ${JSON.stringify(data)}` : "";
      modules.ui.logToWorkspace(`[图像捕获] ${message}${detail}`, "info");
    }
    async function captureAndAssignToInput(key) {
      logImageCaptureTrace("开始写入字段", { key });
      const asset = await captureCurrentDocumentImage();
      modules.state.state.formValues[key] = cloneCaptureAsset(asset);
      logImageCaptureTrace("字段写入完成", {
        key,
        width: asset && asset.width ? asset.width : null,
        height: asset && asset.height ? asset.height : null,
        capturedFromSelection: Boolean(asset && asset.capturedFromSelection)
      });
      renderWorkspace();
      return asset;
    }
    function renderImageInputArea() {
      const runtime = modules.runtime;
      const state = modules.state.state;
      const imageInputContainer = runtime.getById("imageInputContainer");
      if (!imageInputContainer) return;
      const imageInputs = findImageInputs(state.currentApp);
      imageInputContainer.hidden = true;
      if (!state.currentApp) {
        imageInputContainer.innerHTML = "";
        return;
      }
      if (imageInputs.length === 0) {
        imageInputContainer.innerHTML = "";
        imageInputContainer.hidden = true;
        return;
      }
      imageInputContainer.innerHTML = "";
    }
    function renderImageField(input) {
      const runtime = modules.runtime;
      const state = modules.state.state;
      const key = String(input.key || "").trim();
      const label = runtime.escapeHtml(input.label || input.name || key);
      const asset = state.formValues[key];
      const hasAssignedAsset = hasImageAsset(asset);
      const previewSrc = getImageAssetPreviewSrc(asset);
      const captureLabel = hasAssignedAsset ? "重新捕获" : "捕获图像";
      const captureSource = hasAssignedAsset ? asset.capturedFromSelection ? "来源：Photoshop 当前选区" : "来源：Photoshop 当前文档" : "点击此区域直接捕获图像";
      const captureMeta = hasAssignedAsset ? [
        `${asset.originalWidth || asset.width || "-"}x${asset.originalHeight || asset.height || "-"}`,
        asset.uploadBytes ? `${(asset.uploadBytes / (1024 * 1024)).toFixed(2)}MB` : "",
        asset.uploadQuality ? `Q${asset.uploadQuality}` : ""
      ].filter(Boolean).join(" · ") : "";
      const requiredMark = input.required ? '<span class="field-required">*</span>' : "";
      return `
      <div class="field dynamic-field image-field">
        <div class="image-binding-card image-capture-field-card" data-action="capture-field-image" data-form-key="${runtime.escapeHtml(key)}">
          <div class="image-capture-stage ${hasAssignedAsset ? "image-capture-stage-filled" : "image-capture-stage-empty"}">
            <div class="image-capture-stage-corners">
              <span class="image-capture-corner-label">${label}${requiredMark}</span>
              <button class="mini-btn image-capture-clear-btn" type="button" data-action="clear-captured-image" data-form-key="${runtime.escapeHtml(key)}" ${hasAssignedAsset ? "" : "disabled"}>清空</button>
            </div>
            ${hasAssignedAsset && previewSrc ? `<div class="image-capture-preview"><img src="${runtime.escapeHtml(previewSrc)}" alt="${label}" /></div>` : `
                  <div class="image-capture-stage-empty-inner">
                    <div class="image-capture-stage-icon">↑</div>
                    <div class="image-capture-stage-text">点击捕获</div>
                  </div>
                `}
            <div class="inline-actions image-capture-stage-actions">
              <button class="mini-btn image-capture-primary-btn" type="button" data-action="capture-field-image" data-form-key="${runtime.escapeHtml(key)}">${captureLabel}</button>
            </div>
          </div>
          <div class="image-capture-stage-note">${runtime.escapeHtml(captureSource)}${captureMeta ? ` · ${runtime.escapeHtml(captureMeta)}` : ""}</div>
        </div>
      </div>
    `;
    }
    function renderPromptHint(value) {
      const text = String(value || "");
      const length = modules.templates.getTextLength(text);
      const tail = modules.templates.getTailPreview(text, 24);
      return `<div class="prompt-length-hint ${length >= modules.templates.PROMPT_WARN_CHARS ? "is-warning" : ""}">长度 ${modules.runtime.escapeHtml(String(length))} 字符 | 末尾预览 ${modules.runtime.escapeHtml(tail)}</div>`;
    }
    function renderAppMeta(app) {
      const runtime = modules.runtime;
      if (!app) return '<div class="workspace-app-placeholder">请先点击右侧切换应用</div>';
      return `<div class="workspace-app-summary"><div class="workspace-app-name">${runtime.escapeHtml(modules.state.getAppDisplayName(app))}</div></div>`;
    }
    function getRunningTasks() {
      return Array.isArray(modules.state.state.runningTasks) ? modules.state.state.runningTasks.filter((item) => item && item.taskId) : [];
    }
    function isTaskTerminalStatus(status) {
      const normalized = String(status || "").trim().toLowerCase();
      return ["succeeded", "success", "done", "failed", "error", "cancelled", "canceled"].includes(normalized);
    }
    function isTaskCancellable(task) {
      if (!task || typeof task !== "object") return false;
      if (isTaskTerminalStatus(task.status)) return false;
      return Boolean(String(task.remoteTaskId || task.taskId || "").trim()) && String(task.status || "").trim().toLowerCase() !== "submitting";
    }
    function isTaskDeletable(task) {
      return Boolean(task && typeof task === "object" && isTaskTerminalStatus(task.status));
    }
    function getActiveRunningTasks() {
      return getRunningTasks().filter((task) => !isTaskTerminalStatus(task.status));
    }
    function getMaxConcurrentTasks() {
      return Math.max(1, Number(modules.state.state.settings.maxConcurrentTasks) || modules.state.DEFAULT_SETTINGS.maxConcurrentTasks || 3);
    }
    function isRunCooldownActive() {
      return Date.now() < runButtonCooldownUntil;
    }
    function formatTaskDuration(ms) {
      const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1e3));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor(totalSeconds % 3600 / 60);
      const seconds = totalSeconds % 60;
      if (hours > 0) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    function getTaskElapsedMs(task) {
      if (!task || typeof task !== "object") return 0;
      const startedAt = Number(task.submittedAt || task.createdAt || 0);
      const endedAt = Number(task.finishedAt || 0);
      if (!startedAt) return 0;
      return Math.max(0, (endedAt || Date.now()) - startedAt);
    }
    function getTaskStatusTone(status) {
      const normalized = String(status || "").trim().toLowerCase();
      if (["succeeded", "success", "done"].includes(normalized)) return "success";
      if (["failed", "error"].includes(normalized)) return "error";
      if (["cancelled", "canceled"].includes(normalized)) return "warn";
      return "info";
    }
    function getTaskStatusLabel(status) {
      const normalized = String(status || "").trim().toLowerCase();
      if (!normalized) return "运行中";
      if (normalized === "submitting") return "提交中";
      if (normalized === "submitted") return "已提交";
      if (normalized === "running") return "运行中";
      if (normalized === "queued") return "排队中";
      if (normalized === "succeeded" || normalized === "success" || normalized === "done") return "已完成";
      if (normalized === "failed" || normalized === "error") return "失败";
      if (normalized === "cancelled" || normalized === "canceled") return "已取消";
      return status;
    }
    function getTaskStatusDetail(task) {
      if (!task || typeof task !== "object") return "";
      if (task.detail) return String(task.detail);
      const normalized = String(task.status || "").trim().toLowerCase();
      if (normalized === "submitting") return "正在提交到 RunningHub...";
      if (normalized === "submitted") return "任务已创建，等待 RunningHub 执行。";
      if (normalized === "running") return "任务执行中，正在等待结果返回。";
      if (normalized === "queued") return "任务排队中，尚未开始执行。";
      if (normalized === "succeeded" || normalized === "success" || normalized === "done") return "任务已完成。";
      if (normalized === "failed" || normalized === "error") return task.errorMessage || "任务执行失败。";
      if (normalized === "cancelled" || normalized === "canceled") return "任务已取消。";
      return "";
    }
    function sortRunningTasks(tasks) {
      return tasks.slice().sort((left, right) => {
        const leftActive = isTaskTerminalStatus(left.status) ? 1 : 0;
        const rightActive = isTaskTerminalStatus(right.status) ? 1 : 0;
        if (leftActive !== rightActive) return leftActive - rightActive;
        return Number(right.updatedAt || right.createdAt || 0) - Number(left.updatedAt || left.createdAt || 0);
      });
    }
    function ensureTaskTickerState() {
      const hasActiveTask = getActiveRunningTasks().length > 0;
      if (hasActiveTask && !taskTickerHandle) {
        taskTickerHandle = window.setInterval(() => {
          updateRunButtonState();
        }, 1e3);
        return;
      }
      if (!hasActiveTask && taskTickerHandle) {
        window.clearInterval(taskTickerHandle);
        taskTickerHandle = 0;
      }
    }
    function renderRunningTaskList(tasks) {
      if (!Array.isArray(tasks) || tasks.length === 0) return "";
      return sortRunningTasks(tasks).map((task, index) => {
        const appName = modules.runtime.escapeHtml(task.appName || `任务 ${index + 1}`);
        const taskId = String(task.remoteTaskId || task.taskId || "").trim();
        const shortTaskId = taskId ? `#${taskId.slice(-8)}` : "等待分配任务 ID";
        const statusLabel = getTaskStatusLabel(task.status || "running");
        const statusTone = getTaskStatusTone(task.status || "running");
        const durationLabel = `${isTaskTerminalStatus(task.status) ? "耗时" : "已运行"} ${formatTaskDuration(getTaskElapsedMs(task))}`;
        const detail = modules.runtime.escapeHtml(getTaskStatusDetail(task));
        const canCancel = isTaskCancellable(task);
        const canDelete = isTaskDeletable(task);
        return `
          <div class="running-task-item">
            <div class="running-task-main">
              <div class="running-task-topline">
                <div class="running-task-title">${appName}</div>
                <div class="running-task-topline-actions">
                  <span class="status-chip running-task-status-chip" data-status="${modules.runtime.escapeHtml(statusTone)}">${modules.runtime.escapeHtml(statusLabel)}</span>
                  ${canCancel ? `<button class="mini-btn running-task-inline-btn" type="button" data-action="cancel-running-task" data-task-id="${modules.runtime.escapeHtml(String(task.taskId || "").trim())}">取消</button>` : canDelete ? `<button class="mini-btn running-task-inline-btn" type="button" data-action="delete-running-task" data-task-id="${modules.runtime.escapeHtml(String(task.taskId || "").trim())}">删除</button>` : ""}
                </div>
              </div>
              <div class="running-task-meta">${modules.runtime.escapeHtml(shortTaskId)} · ${modules.runtime.escapeHtml(durationLabel)}</div>
              <div class="running-task-detail">${detail}</div>
            </div>
          </div>
        `;
      }).join("");
    }
    function updateRunButtonState() {
      const state = modules.state.state;
      const runButton = modules.runtime.getById("btnRun");
      const taskStatusSummary = modules.runtime.getById("taskStatusSummary");
      const runningTaskList = modules.runtime.getById("runningTaskList");
      const hasCurrentApp = !!state.currentApp;
      const runningTasks = getRunningTasks();
      const activeRunningTasks = getActiveRunningTasks();
      const hasRunningTask = runningTasks.length > 0;
      const activeCount = activeRunningTasks.length;
      const maxConcurrentTasks = getMaxConcurrentTasks();
      const concurrencyReached = activeCount >= maxConcurrentTasks;
      const cooldownActive = isRunCooldownActive();
      const cooldownSeconds = Math.max(1, Math.ceil((runButtonCooldownUntil - Date.now()) / 1e3));
      if (runButton) {
        runButton.disabled = !hasCurrentApp || concurrencyReached || cooldownActive;
        if (!hasCurrentApp) {
          runButton.textContent = "开始运行";
        } else if (concurrencyReached) {
          runButton.textContent = `并发已满 ${activeCount}/${maxConcurrentTasks}`;
        } else if (cooldownActive) {
          runButton.textContent = `请稍候 ${cooldownSeconds}s`;
        } else if (activeCount > 0) {
          runButton.textContent = `运行新任务 ${activeCount}/${maxConcurrentTasks}`;
        } else {
          runButton.textContent = `运行 ${modules.state.getAppDisplayName(state.currentApp)}`;
        }
      }
      if (taskStatusSummary) {
        if (!hasCurrentApp) {
          taskStatusSummary.textContent = "后台任务：无，请先选择应用。";
        } else if (concurrencyReached) {
          taskStatusSummary.textContent = `后台任务：进行中 ${activeCount}/${maxConcurrentTasks} 个，已达到并发上限，请等待任务完成或在卡片中取消。`;
        } else if (cooldownActive) {
          taskStatusSummary.textContent = `后台任务：已进入提交冷却，${cooldownSeconds}s 后可继续发送新任务。`;
        } else if (activeCount > 0) {
          taskStatusSummary.textContent = `后台任务：进行中 ${activeCount}/${maxConcurrentTasks} 个，可继续发送新任务，也可在卡片中逐个取消。`;
        } else if (hasRunningTask) {
          taskStatusSummary.textContent = `后台任务：当前无进行中任务，已保留最近 ${runningTasks.length} 条任务卡片。`;
        } else {
          taskStatusSummary.textContent = `后台任务：无，已就绪，可直接运行 ${modules.state.getAppDisplayName(state.currentApp)}。`;
        }
      }
      if (runningTaskList) {
        runningTaskList.hidden = false;
        runningTaskList.innerHTML = hasRunningTask ? renderRunningTaskList(runningTasks) : '<div class="running-task-empty">运行后的任务会显示在这里。</div>';
      }
      ensureTaskTickerState();
    }
    function renderField(input) {
      const runtime = modules.runtime;
      const state = modules.state.state;
      const key = String(input.key || "").trim();
      const label = runtime.escapeHtml(input.label || input.name || key);
      const requiredMark = input.required ? '<span class="field-required">*</span>' : "";
      const value = state.formValues[key];
      const escapedKey = runtime.escapeHtml(key);
      if (isImageInput(input)) return renderImageField(input);
      if (input.type === "textarea" || input.type === "multiline" || isPromptField(input)) {
        const currentValue = String(value ?? "");
        return `
        <label class="field dynamic-field ${isPromptField(input) ? "prompt-field" : ""}">
          <span class="field-label">
            <span>${label}${requiredMark}</span>
            ${isPromptField(input) ? `<button class="mini-btn template-trigger-btn" type="button" data-action="open-template-picker" data-form-key="${escapedKey}">预设</button>` : ""}
          </span>
          <textarea class="field-input field-textarea" rows="4" data-form-key="${escapedKey}">${runtime.escapeHtml(currentValue)}</textarea>
          ${isPromptField(input) ? renderPromptHint(currentValue) : ""}
        </label>
      `;
      }
      if (input.type === "number" || input.type === "int" || input.type === "float") {
        return `<label class="field dynamic-field"><span class="field-label">${label}${requiredMark}</span><input class="field-input" type="number" data-form-key="${escapedKey}" value="${runtime.escapeHtml(String(value ?? ""))}" /></label>`;
      }
      if (input.type === "boolean" || input.type === "switch" || input.type === "checkbox") {
        return `<label class="field toggle-field"><span class="field-label">${label}${requiredMark}</span><label class="checkbox-line"><input type="checkbox" data-form-key="${escapedKey}" ${value ? "checked" : ""} /><span>启用</span></label></label>`;
      }
      if (input.type === "select" || input.type === "enum") {
        const options = Array.isArray(input.options) ? input.options : [];
        return `<label class="field dynamic-field"><span class="field-label">${label}${requiredMark}</span><select class="field-input" data-form-key="${escapedKey}"><option value="">请选择</option>${options.map((option) => {
          const optValue = typeof option === "object" ? option.value : option;
          const optLabel = typeof option === "object" ? option.label : option;
          return `<option value="${runtime.escapeHtml(String(optValue ?? ""))}" ${String(value ?? "") === String(optValue ?? "") ? "selected" : ""}>${runtime.escapeHtml(String(optLabel ?? optValue ?? ""))}</option>`;
        }).join("")}</select></label>`;
      }
      return `<label class="field dynamic-field"><span class="field-label">${label}${requiredMark}</span><input class="field-input" type="text" data-form-key="${escapedKey}" value="${runtime.escapeHtml(String(value ?? ""))}" /></label>`;
    }
    function renderWorkspace() {
      const runtime = modules.runtime;
      const state = modules.state.state;
      const appPickerMeta = runtime.getById("appPickerMeta");
      const dynamicInputContainer = runtime.getById("dynamicInputContainer");
      if (appPickerMeta) {
        appPickerMeta.innerHTML = renderAppMeta(state.currentApp);
      }
      renderImageInputArea();
      if (dynamicInputContainer) {
        if (!state.currentApp) {
          dynamicInputContainer.innerHTML = '<div class="empty-panel"><h4>动态表单区</h4><p>请先选择一个已保存应用，后续这里会根据输入结构动态渲染表单。</p></div>';
        } else if (!Array.isArray(state.currentApp.inputs) || state.currentApp.inputs.length === 0) {
          dynamicInputContainer.innerHTML = `<div class="empty-panel"><h4>${runtime.escapeHtml(modules.state.getAppDisplayName(state.currentApp))}</h4><p>当前应用还没有输入结构。你可以先去设置页编辑应用，手动补齐输入 JSON。</p></div>`;
        } else {
          dynamicInputContainer.innerHTML = `<div class="dynamic-form">${state.currentApp.inputs.map(renderField).join("")}</div>`;
        }
      }
      updateRunButtonState();
    }
    function collectFormValuesFromDom() {
      const state = modules.state.state;
      const container = modules.runtime.getById("dynamicInputContainer");
      if (!container) return;
      container.querySelectorAll("[data-form-key]").forEach((element) => {
        const key = element.getAttribute("data-form-key");
        if (!key) return;
        if (element.matches('input[type="checkbox"]')) {
          state.formValues[key] = Boolean(element.checked);
          return;
        }
        const inputMeta = (state.currentApp?.inputs || []).find((item) => String(item.key || "") === key);
        if (inputMeta && isImageInput(inputMeta)) return;
        if (element.matches("input, textarea, select")) state.formValues[key] = element.value;
      });
    }
    function buildRunPayload() {
      const state = modules.state.state;
      collectFormValuesFromDom();
      const currentAppId = modules.state.resolveAppId(state.currentApp);
      const payload = {
        appId: currentAppId,
        appName: state.currentApp ? state.currentApp.name : "",
        app: state.currentApp ? {
          id: state.currentApp.id,
          appId: currentAppId,
          name: state.currentApp.name,
          inputs: Array.isArray(state.currentApp.inputs) ? state.currentApp.inputs : []
        } : null,
        apiKey: state.settings.apiKey || "",
        inputs: normalizePayloadInputs(state.currentApp, state.formValues),
        settings: {
          pollInterval: state.settings.pollInterval,
          timeout: state.settings.timeout,
          maxConcurrentTasks: state.settings.maxConcurrentTasks
        }
      };
      state.lastRunPayload = payload;
      return payload;
    }
    function syncPrimaryRunningTask() {
      const tasks = Array.isArray(modules.state.state.runningTasks) ? modules.state.state.runningTasks : [];
      const firstTask = tasks[0] || null;
      modules.state.state.runningTask = firstTask ? { taskId: String(firstTask.taskId || ""), appName: String(firstTask.appName || ""), status: String(firstTask.status || "running") } : { taskId: "", appName: "", status: "idle" };
    }
    function createLocalTaskId() {
      return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    function upsertRunningTask(taskOrTaskId, appName = "", status = "running") {
      const state = modules.state.state;
      const patch = taskOrTaskId && typeof taskOrTaskId === "object" ? { ...taskOrTaskId } : {
        taskId: String(taskOrTaskId || "").trim(),
        appName: String(appName || "").trim(),
        status: String(status || "running").trim() || "running"
      };
      const normalizedTaskId = String(patch.taskId || "").trim();
      if (!normalizedTaskId) return null;
      const now = Date.now();
      const nextTask = {
        taskId: normalizedTaskId,
        remoteTaskId: String(patch.remoteTaskId || patch.taskId || "").trim(),
        appName: String(patch.appName || "").trim(),
        status: String(patch.status || "running").trim() || "running",
        detail: String(patch.detail || "").trim(),
        errorMessage: String(patch.errorMessage || "").trim(),
        outputUrl: String(patch.outputUrl || "").trim(),
        sourceDocument: patch.sourceDocument && typeof patch.sourceDocument === "object" ? patch.sourceDocument : null,
        createdAt: Number(patch.createdAt) > 0 ? Number(patch.createdAt) : now,
        submittedAt: Number(patch.submittedAt) > 0 ? Number(patch.submittedAt) : now,
        finishedAt: Number(patch.finishedAt) > 0 ? Number(patch.finishedAt) : 0,
        updatedAt: Number(patch.updatedAt) > 0 ? Number(patch.updatedAt) : now,
        placementDocumentId: Number(patch.placementDocumentId) > 0 ? Number(patch.placementDocumentId) : 0
      };
      const list = Array.isArray(state.runningTasks) ? state.runningTasks.slice() : [];
      const index = list.findIndex((item) => String(item.taskId || "") === normalizedTaskId);
      if (index >= 0) {
        const current = list[index];
        list[index] = {
          ...current,
          ...nextTask,
          createdAt: Number(current.createdAt) > 0 ? Number(current.createdAt) : nextTask.createdAt,
          submittedAt: Number(current.submittedAt) > 0 ? Number(current.submittedAt) : nextTask.submittedAt,
          finishedAt: Number(nextTask.finishedAt) > 0 ? Number(nextTask.finishedAt) : Number(current.finishedAt) || 0,
          placementDocumentId: Number(nextTask.placementDocumentId) > 0 ? Number(nextTask.placementDocumentId) : Number(current.placementDocumentId) || 0
        };
      } else {
        list.unshift(nextTask);
      }
      state.runningTasks = sortRunningTasks(list).slice(0, TASK_CARD_LIMIT);
      syncPrimaryRunningTask();
      updateRunButtonState();
      return state.runningTasks.find((item) => String(item.taskId || "") === normalizedTaskId) || null;
    }
    function replaceRunningTaskId(currentTaskId, nextTaskPatch = {}) {
      const state = modules.state.state;
      const normalizedCurrentTaskId = String(currentTaskId || "").trim();
      const normalizedNextTaskId = String(nextTaskPatch.taskId || "").trim();
      if (!normalizedCurrentTaskId || !normalizedNextTaskId) return null;
      const list = Array.isArray(state.runningTasks) ? state.runningTasks.slice() : [];
      const index = list.findIndex((item) => String(item.taskId || "") === normalizedCurrentTaskId);
      if (index < 0) return upsertRunningTask(nextTaskPatch);
      const current = list[index];
      list[index] = {
        ...current,
        ...nextTaskPatch,
        taskId: normalizedNextTaskId,
        remoteTaskId: String(nextTaskPatch.remoteTaskId || normalizedNextTaskId).trim(),
        finishedAt: Number(nextTaskPatch.finishedAt) > 0 ? Number(nextTaskPatch.finishedAt) : Number(current.finishedAt) || 0,
        updatedAt: Date.now()
      };
      state.runningTasks = sortRunningTasks(list).slice(0, TASK_CARD_LIMIT);
      syncPrimaryRunningTask();
      updateRunButtonState();
      return state.runningTasks.find((item) => String(item.taskId || "") === normalizedNextTaskId) || null;
    }
    function deleteRunningTask(taskId = "") {
      const state = modules.state.state;
      const normalizedTaskId = String(taskId || "").trim();
      if (!normalizedTaskId) return;
      state.runningTasks = (Array.isArray(state.runningTasks) ? state.runningTasks : []).filter(
        (item) => String(item.taskId || "") !== normalizedTaskId
      );
      syncPrimaryRunningTask();
      updateRunButtonState();
    }
    function clearLastResult() {
      modules.state.state.lastResult = { appName: "", sourceDocument: null, outputUrl: "", taskId: "", placedAt: 0 };
      updateRunButtonState();
    }
    function setLastResult(payload) {
      const data = payload && typeof payload === "object" ? payload : {};
      modules.state.state.lastResult = {
        appName: String(data.appName || "").trim(),
        sourceDocument: data.sourceDocument && typeof data.sourceDocument === "object" ? data.sourceDocument : null,
        outputUrl: String(data.outputUrl || "").trim(),
        taskId: String(data.taskId || "").trim(),
        placedAt: Number(data.placedAt) > 0 ? Number(data.placedAt) : 0
      };
      updateRunButtonState();
    }
    async function refreshPhotoshopDocumentStatus(options = {}) {
      const state = modules.state.state;
      if (!modules.runtime.isPluginRuntime()) return null;
      try {
        const info = await modules.runtime.callHost("photoshop.getActiveDocumentInfo", []);
        state.currentDocumentInfo = info && typeof info === "object" ? info : null;
        if (!options.quiet && info && info.ok) modules.ui.logToWorkspace(`Photoshop 当前文档：${info.title} (#${info.documentId})`, "info");
        return state.currentDocumentInfo;
      } catch (_) {
        state.currentDocumentInfo = null;
        return null;
      }
    }
    async function captureSourceDocumentInfo() {
      if (!modules.runtime.isPluginRuntime()) return null;
      return refreshPhotoshopDocumentStatus({ quiet: true });
    }
    async function captureCurrentDocumentImage() {
      if (!modules.runtime.isPluginRuntime()) throw new Error("浏览器预览模式下无法捕获 Photoshop 图像");
      const settings = getImageCaptureSettings();
      logImageCaptureTrace("准备调用宿主捕获", settings);
      const captured = await modules.runtime.callHost("photoshop.captureDocumentPreview", [settings], { timeoutMs: 3e4 });
      logImageCaptureTrace("宿主已返回捕获结果", {
        ok: Boolean(captured && captured.ok),
        width: captured && captured.width,
        height: captured && captured.height,
        hasBase64: Boolean(captured && String(captured.base64 || "").trim()),
        hasDataUrl: Boolean(captured && String(captured.dataUrl || "").trim()),
        uploadBytes: captured && captured.uploadBytes,
        uploadQuality: captured && captured.uploadQuality
      });
      const asset = pushCapturedAsset(captured);
      if (!asset) {
        throw new Error("宿主已返回结果，但未生成可用预览资源");
      }
      modules.ui.logToWorkspace(
        `已捕获 Photoshop 文档图像：预览 ${asset.width}x${asset.height}，上传 ${(asset.uploadBytes || 0) / (1024 * 1024) > 0 ? `${((asset.uploadBytes || 0) / (1024 * 1024)).toFixed(2)}MB` : "-"}`,
        "success"
      );
      renderWorkspace();
      return asset;
    }
    async function handleCaptureFieldClick(actionTarget) {
      const key = actionTarget && actionTarget.getAttribute("data-form-key");
      if (!key) return;
      const triggerButton = actionTarget.matches("button") ? actionTarget : actionTarget.querySelector('.image-capture-primary-btn[data-action="capture-field-image"][data-form-key]');
      const card = actionTarget.closest(".image-capture-field-card");
      if (triggerButton && triggerButton.disabled || card && card.dataset.captureBusy === "true") return;
      if (triggerButton) triggerButton.disabled = true;
      if (card) card.dataset.captureBusy = "true";
      try {
        logImageCaptureTrace("收到点击事件", {
          key,
          trigger: actionTarget.matches("button") ? "button" : "card"
        });
        const asset = await captureAndAssignToInput(key);
        modules.ui.logToWorkspace(
          `已捕获并写入字段：${key} (${asset.capturedFromSelection ? "选区" : "文档"})`,
          "success"
        );
      } catch (error) {
        modules.ui.logToWorkspace(`图像捕获失败：${error.message}`, "error");
      } finally {
        if (card) delete card.dataset.captureBusy;
        if (triggerButton) triggerButton.disabled = false;
      }
    }
    function isMissingRequiredValue(value) {
      if (typeof value === "boolean") return false;
      if (hasImageAsset(value)) return false;
      if (value && typeof value === "object") return true;
      return String(value ?? "").trim() === "";
    }
    function validateRunPayload() {
      const state = modules.state.state;
      const app = state.currentApp;
      if (!app) throw new Error("请先选择一个应用");
      collectFormValuesFromDom();
      const missing = (Array.isArray(app.inputs) ? app.inputs : []).filter((input) => input.required).filter((input) => isMissingRequiredValue(state.formValues[input.key]));
      if (missing.length > 0) throw new Error(`请先填写必填项：${missing.map((item) => item.label || item.key).join("、")}`);
    }
    function buildAutoPlacementPayload(result) {
      const sourceDocument = result && result.sourceDocument && typeof result.sourceDocument === "object" ? result.sourceDocument : null;
      return {
        url: result && result.outputUrl ? result.outputUrl : "",
        taskId: result && result.taskId ? result.taskId : "",
        targetDocumentId: sourceDocument && sourceDocument.hasActiveDocument ? sourceDocument.documentId : null,
        targetBounds: sourceDocument && sourceDocument.selectionBounds ? sourceDocument.selectionBounds : null,
        applyMask: Boolean(sourceDocument && sourceDocument.selectionBounds),
        fitMode: "contain",
        layerName: getResultDefaultLayerName()
      };
    }
    async function autoPlaceResult(result) {
      if (!result || !result.outputUrl) throw new Error("当前没有可自动贴回 Photoshop 的结果");
      if (!modules.runtime.isPluginRuntime()) {
        modules.ui.logToWorkspace(`浏览器预览模式不会自动贴回结果，输出地址：${result.outputUrl}`, "info");
        return null;
      }
      await refreshPhotoshopDocumentStatus({ quiet: true });
      const placementPayload = buildAutoPlacementPayload(result);
      const response = await modules.runtime.callHost("photoshop.placeResultFromUrl", [placementPayload], { timeoutMs: 6e4 });
      modules.state.state.lastResult.placedAt = Date.now();
      if (response && response.document) modules.state.state.currentDocumentInfo = response.document;
      const sourceDocument = result.sourceDocument;
      const placementSummary = sourceDocument && sourceDocument.selectionBounds ? `已按原选区 ${formatSelectionLabel(sourceDocument.selectionBounds)} 自动贴回` : "已自动贴回源文档";
      modules.ui.logToWorkspace(`${placementSummary}，文档 #${response.documentId}，图层：${response.layerName || placementPayload.layerName}`, "success");
      return response;
    }
    async function autoPlaceLastResult() {
      return autoPlaceResult(modules.state.state.lastResult);
    }
    function markRunCooldown() {
      runButtonCooldownUntil = Date.now() + RUN_BUTTON_COOLDOWN_MS;
      updateRunButtonState();
      window.setTimeout(() => {
        updateRunButtonState();
      }, RUN_BUTTON_COOLDOWN_MS + 80);
    }
    async function startRunTaskFlow(payload, sourceDocument) {
      const tempTaskId = createLocalTaskId();
      upsertRunningTask({
        taskId: tempTaskId,
        remoteTaskId: "",
        appName: payload.appName,
        status: "submitting",
        detail: "正在提交到 RunningHub...",
        sourceDocument,
        createdAt: Date.now(),
        submittedAt: Date.now()
      });
      try {
        modules.ui.logToWorkspace(
          `[运行提交] appId=${payload.appId} appName=${payload.appName || "-"} inputCount=${Object.keys(payload.inputs || {}).length}`,
          "info"
        );
        const submitResult = await modules.runtime.callHost("runninghub.submitTask", [payload], {
          timeoutMs: Math.max(1e4, Number(payload.settings.timeout || 180) * 1e3 + 5e3)
        });
        const remoteTaskId = String(submitResult.taskId || "").trim();
        modules.ui.logToWorkspace(`任务已提交：${remoteTaskId}`, "success");
        replaceRunningTaskId(tempTaskId, {
          taskId: remoteTaskId,
          remoteTaskId,
          appName: payload.appName,
          status: "running",
          detail: "任务已提交，正在等待 RunningHub 返回结果。",
          sourceDocument,
          submittedAt: Date.now()
        });
        const pollResult = await modules.runtime.callHost(
          "runninghub.pollTask",
          [{ apiKey: payload.apiKey, taskId: remoteTaskId, settings: payload.settings }],
          { timeoutMs: Math.max(15e3, Number(payload.settings.timeout || 180) * 1e3 + 15e3) }
        );
        upsertRunningTask({
          taskId: remoteTaskId,
          remoteTaskId,
          appName: payload.appName,
          status: "succeeded",
          detail: "任务已完成，结果已返回。",
          outputUrl: String(pollResult.outputUrl || "").trim(),
          sourceDocument,
          finishedAt: Date.now()
        });
        setLastResult({
          appName: payload.appName,
          sourceDocument,
          outputUrl: pollResult.outputUrl,
          taskId: remoteTaskId
        });
        modules.ui.logToWorkspace(`任务已完成，结果地址：${pollResult.outputUrl}`, "success");
        const placementResponse = await autoPlaceResult({
          appName: payload.appName,
          sourceDocument,
          outputUrl: pollResult.outputUrl,
          taskId: remoteTaskId
        });
        upsertRunningTask({
          taskId: remoteTaskId,
          remoteTaskId,
          appName: payload.appName,
          status: "succeeded",
          detail: placementResponse && placementResponse.documentId ? `任务已完成，并已自动贴回 Photoshop 文档 #${placementResponse.documentId}。` : "任务已完成。"
        });
      } catch (error) {
        const message = error && error.message ? error.message : String(error || "任务执行失败");
        const normalizedMessage = String(message).trim();
        const latestTask = getRunningTasks().find((item) => String(item.taskId || "") === tempTaskId);
        const currentTaskId = latestTask ? tempTaskId : String(payload && payload.taskId || "").trim();
        const activeTask = latestTask || getRunningTasks().find((item) => String(item.appName || "") === String(payload.appName || "").trim() && !isTaskTerminalStatus(item.status));
        const targetTaskId = activeTask ? String(activeTask.taskId || "").trim() : tempTaskId;
        const cancelled = /cancel/i.test(normalizedMessage);
        upsertRunningTask({
          taskId: targetTaskId,
          appName: payload.appName,
          status: cancelled ? "cancelled" : "failed",
          detail: cancelled ? "任务已取消。" : normalizedMessage,
          errorMessage: cancelled ? "" : normalizedMessage,
          sourceDocument,
          finishedAt: Date.now()
        });
        modules.ui.logToWorkspace(normalizedMessage, cancelled ? "warn" : "error");
      }
    }
    function bindWorkspaceActions() {
      const runButton = modules.runtime.getById("btnRun");
      const dynamicInputContainer = modules.runtime.getById("dynamicInputContainer");
      if (dynamicInputContainer) {
        dynamicInputContainer.addEventListener("input", (event) => {
          const element = event.target;
          if (!element || !element.matches("[data-form-key]")) return;
          const key = element.getAttribute("data-form-key");
          if (!key) return;
          if (element.matches('input[type="checkbox"]')) {
            modules.state.state.formValues[key] = Boolean(element.checked);
            return;
          }
          const inputMeta = (modules.state.state.currentApp?.inputs || []).find((item) => String(item.key || "") === key);
          if (!inputMeta || !isImageInput(inputMeta)) modules.state.state.formValues[key] = element.value;
        });
        dynamicInputContainer.addEventListener("change", (event) => {
          const element = event.target;
          if (!element || !element.matches("[data-form-key]")) return;
          const key = element.getAttribute("data-form-key");
          if (!key) return;
          if (element.matches('input[type="checkbox"]')) {
            modules.state.state.formValues[key] = Boolean(element.checked);
            return;
          }
          const inputMeta = (modules.state.state.currentApp?.inputs || []).find((item) => String(item.key || "") === key);
          if (!inputMeta || !isImageInput(inputMeta)) modules.state.state.formValues[key] = element.value;
        });
        dynamicInputContainer.addEventListener("click", (event) => {
          const actionTarget = event.target && event.target.closest("[data-action][data-form-key]");
          if (!actionTarget) return;
          const action = actionTarget.getAttribute("data-action");
          const key = actionTarget.getAttribute("data-form-key");
          if (!action || !key) return;
          if (action === "open-template-picker") {
            modules.templates.openTemplatePicker({ mode: "multiple", maxSelection: 5, targetKey: key });
            return;
          }
          if (action === "clear-captured-image") {
            event.preventDefault();
            event.stopPropagation();
            clearImageInputValue(key);
            modules.ui.logToWorkspace(`已清除字段图像：${key}`, "info");
            return;
          }
          if (action === "capture-field-image") {
            event.preventDefault();
            handleCaptureFieldClick(actionTarget);
          }
        });
      }
      if (runButton) {
        runButton.addEventListener("click", async () => {
          try {
            validateRunPayload();
            clearLastResult();
            const payload = buildRunPayload();
            if (!modules.runtime.isPluginRuntime()) {
              modules.ui.logToWorkspace(`浏览器预览模式已生成任务负载：${JSON.stringify(payload)}`, "info");
              return;
            }
            if (!payload.apiKey) throw new Error("请先在设置页保存 RunningHub API Key");
            if (!payload.appId) throw new Error("当前应用缺少有效的 appId，请到设置页重新保存该应用后再运行");
            if (getActiveRunningTasks().length >= getMaxConcurrentTasks()) {
              throw new Error(`已达到最大并发数 ${getMaxConcurrentTasks()}，请等待部分任务完成后再继续发送。`);
            }
            if (isRunCooldownActive()) {
              throw new Error("请不要短时间连续点击运行按钮，稍后再试。");
            }
            markRunCooldown();
            const sourceDocument = await captureSourceDocumentInfo();
            startRunTaskFlow(payload, sourceDocument);
          } catch (error) {
            modules.ui.logToWorkspace(error.message, "warn");
            updateRunButtonState();
          }
        });
      }
      document.addEventListener("click", async (event) => {
        const target = event.target && event.target.closest("[data-action][data-task-id]");
        if (!target) return;
        const action = target.getAttribute("data-action");
        if (action === "cancel-running-task") {
          const taskId = String(target.getAttribute("data-task-id") || "").trim();
          const apiKey = modules.state.state.settings.apiKey;
          if (!taskId) return;
          const currentTask = getRunningTasks().find((item) => String(item.taskId || "") === taskId);
          const remoteTaskId = String(currentTask && (currentTask.remoteTaskId || currentTask.taskId) || taskId).trim();
          if (!remoteTaskId) return;
          target.disabled = true;
          try {
            await modules.runtime.callHost("runninghub.cancelTask", [{ apiKey, taskId: remoteTaskId }], { timeoutMs: 2e4 });
            upsertRunningTask({
              taskId,
              remoteTaskId,
              appName: currentTask && currentTask.appName ? currentTask.appName : "",
              status: "cancelled",
              detail: "任务已取消。",
              finishedAt: Date.now()
            });
            modules.ui.logToWorkspace(`任务已取消：${remoteTaskId}`, "warn");
          } catch (error) {
            modules.ui.logToWorkspace(`取消任务失败：${error.message}`, "error");
          } finally {
            target.disabled = false;
          }
          return;
        }
        if (action === "delete-running-task") {
          const taskId = String(target.getAttribute("data-task-id") || "").trim();
          if (!taskId) return;
          deleteRunningTask(taskId);
          modules.ui.logToWorkspace(`已删除任务卡片：${taskId}`, "info");
        }
      });
    }
    modules.workspace = {
      setModalOpen,
      updateRunButtonState,
      renderWorkspace,
      buildRunPayload,
      bindWorkspaceActions,
      refreshPhotoshopDocumentStatus
    };
  })(window);

  // src/webview/apps.js
  (function initAppsModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    function normalizeAppId(rawValue) {
      const text = String(rawValue || "").trim();
      if (!text) return "";
      if (/^\d+$/.test(text)) return text;
      try {
        const decoded = decodeURIComponent(text);
        const url = new URL(decoded);
        const queryKeys = ["appId", "webappId", "id", "workflowId", "code"];
        for (const key of queryKeys) {
          const value = url.searchParams.get(key);
          if (value && value.trim()) return value.trim();
        }
        const pathMatch = decoded.match(/\/(\d+)(?:[/?#]|$)/);
        if (pathMatch) return pathMatch[1];
      } catch (_) {
        const queryMatch = text.match(/[?&](?:appId|webappId|id|workflowId|code)=([^&#]+)/i);
        if (queryMatch) return decodeURIComponent(queryMatch[1]).trim();
        const pathMatch = text.match(/\/(\d+)(?:[/?#]|$)/);
        if (pathMatch) return pathMatch[1];
      }
      return text;
    }
    function getAppEditorDraft() {
      const runtime = modules.runtime;
      return JSON.stringify({
        id: modules.state.state.editingAppId || "",
        name: String(runtime.getById("appEditorNameInput")?.value || "").trim(),
        appId: normalizeAppId(runtime.getById("appEditorAppIdInput")?.value || ""),
        description: String(runtime.getById("appEditorDescriptionInput")?.value || "").trim(),
        inputsText: String(runtime.getById("appEditorInputsInput")?.value || "").trim()
      });
    }
    function markAppEditorPristine() {
      modules.state.state.appEditorSnapshot = getAppEditorDraft();
    }
    function isAppEditorDirty() {
      return getAppEditorDraft() !== String(modules.state.state.appEditorSnapshot || "");
    }
    function confirmDiscardAppEditorChanges() {
      if (!isAppEditorDirty()) return true;
      return global.confirm("当前应用编辑区里有未保存修改，确定放弃这些内容吗？");
    }
    async function persistCurrentAppId(appId) {
      await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.CURRENT_APP_ID, String(appId || ""));
    }
    function analyzeAppInputsText(text) {
      const marker = String(text || "").trim();
      if (!marker) return { normalized: [], summary: "当前应用还没有输入结构。", status: "info" };
      const parsed = JSON.parse(marker);
      if (!Array.isArray(parsed)) throw new Error("输入结构必须是 JSON 数组");
      const normalized = modules.state.normalizeAppInputs(parsed);
      const imageCount = normalized.filter((item) => item.type === "image" || item.type === "file").length;
      const promptCount = normalized.filter((item) => modules.state.isPromptLikeInput(item)).length;
      const requiredCount = normalized.filter((item) => item.required).length;
      const optionalCount = Math.max(0, normalized.length - requiredCount);
      const selectCount = normalized.filter((item) => item.type === "select" || item.type === "enum").length;
      const booleanCount = normalized.filter((item) => ["boolean", "switch", "checkbox"].includes(String(item.type || "").toLowerCase())).length;
      const previewKeys = normalized.slice(0, 5).map((item) => item.label || item.name || item.key).filter(Boolean).join("、");
      return {
        normalized,
        summary: normalized.length > 0 ? `已识别 ${normalized.length} 个输入项，其中必填 ${requiredCount} 个、选填 ${optionalCount} 个、图像 ${imageCount} 个、提示词 ${promptCount} 个、选项 ${selectCount} 个、布尔 ${booleanCount} 个。${previewKeys ? `字段预览：${previewKeys}${normalized.length > 5 ? "等" : ""}。` : ""}` : "已解析输入结构，但暂未识别到可用字段。",
        status: normalized.length > 0 ? "success" : "info"
      };
    }
    function summarizeParsedApp(result) {
      const inputs = Array.isArray(result && result.inputs) ? result.inputs : [];
      const analysis = analyzeAppInputsText(JSON.stringify(inputs));
      const summary = String(analysis.summary || "").replace(/^已识别\s*/, "");
      return {
        name: String(result && (result.name || result.appId) || "未命名应用"),
        inputCount: inputs.length,
        summary
      };
    }
    function renderAppInputsSummary(text) {
      const summaryEl = modules.runtime.getById("appEditorSchemaSummary");
      if (!summaryEl) return;
      try {
        const result = analyzeAppInputsText(text);
        summaryEl.classList.remove("is-hidden");
        modules.runtime.setSummaryStatus(summaryEl, result.summary, result.status);
      } catch (error) {
        summaryEl.classList.remove("is-hidden");
        modules.runtime.setSummaryStatus(summaryEl, `输入结构格式错误：${error.message}`, "error");
      }
    }
    function parseAppInputsText(text) {
      return analyzeAppInputsText(text).normalized;
    }
    async function loadAppsFromStorage() {
      const runtime = modules.runtime;
      const keys = modules.state.STORAGE_KEYS;
      const primaryRaw = await runtime.storageGetItem(keys.APPS);
      const primaryApps = modules.state.normalizeAppList(runtime.readJsonText(primaryRaw, []));
      if (primaryApps.length > 0) return primaryApps;
      for (const legacyKey of keys.LEGACY_APPS) {
        const legacyRaw = await runtime.storageGetItem(legacyKey);
        const legacyApps = modules.state.normalizeAppList(runtime.readJsonText(legacyRaw, []));
        if (legacyApps.length > 0) return legacyApps;
      }
      return [];
    }
    async function saveAppsToStorage(apps) {
      const normalizedApps = modules.state.normalizeAppList(apps).map((item) => ({
        id: item.id,
        appId: item.appId,
        name: item.name,
        description: item.description,
        inputs: item.inputs,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt || Date.now()
      }));
      await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.APPS, JSON.stringify(normalizedApps));
      modules.state.state.apps = normalizedApps;
      await hydrateCurrentApp({ quiet: true });
      renderSavedAppsList();
      modules.workspace.renderWorkspace();
      renderAppPickerList();
    }
    function getVisibleApps() {
      const state = modules.state.state;
      const keyword = String(state.appManagerKeyword || "").trim().toLowerCase();
      const list = !keyword ? [...state.apps] : state.apps.filter((item) => {
        const marker = `${modules.state.getAppDisplayName(item)} ${modules.state.getAppDisplayId(item)} ${item.description || ""}`.toLowerCase();
        return marker.includes(keyword);
      });
      const sortMode = String(state.appManagerSort || "updated_desc");
      list.sort((a, b) => {
        if (sortMode === "name_asc") return modules.state.getAppDisplayName(a).localeCompare(modules.state.getAppDisplayName(b), "zh-CN");
        if (sortMode === "name_desc") return modules.state.getAppDisplayName(b).localeCompare(modules.state.getAppDisplayName(a), "zh-CN");
        if (sortMode === "created_desc") return Number(b.createdAt || 0) - Number(a.createdAt || 0);
        return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
      });
      return list;
    }
    function renderAppPickerList() {
      const runtime = modules.runtime;
      const state = modules.state.state;
      const listEl = runtime.getById("appPickerList");
      const statsEl = runtime.getById("appPickerStats");
      if (!listEl) return;
      const keyword = String(state.appPickerKeyword || "").trim().toLowerCase();
      const visibleApps = !keyword ? state.apps : state.apps.filter((item) => `${modules.state.getAppDisplayName(item)} ${modules.state.getAppDisplayId(item)}`.toLowerCase().includes(keyword));
      if (statsEl) statsEl.textContent = `${visibleApps.length} / ${state.apps.length}`;
      if (visibleApps.length === 0) {
        listEl.innerHTML = state.apps.length === 0 ? `<div class="picker-empty"><strong>还没有已保存应用</strong><p>请先在设置页添加应用。</p></div>` : `<div class="picker-empty"><strong>没有匹配结果</strong><p>换个关键词再试试。</p></div>`;
        return;
      }
      listEl.innerHTML = visibleApps.map((app) => {
        const isActive = state.currentApp && String(state.currentApp.id) === String(app.id);
        return `<button class="picker-item ${isActive ? "active" : ""}" type="button" value="${runtime.escapeHtml(String(app.id || ""))}"><span class="picker-item-title">${runtime.escapeHtml(modules.state.getAppDisplayName(app))}</span><span class="picker-item-meta"><span>应用 ID：${runtime.escapeHtml(modules.state.getAppDisplayId(app))}</span><span>输入项：${runtime.escapeHtml(String(modules.state.getAppInputCount(app)))}</span></span></button>`;
      }).join("");
    }
    function renderSavedAppsList() {
      const runtime = modules.runtime;
      const state = modules.state.state;
      const listEl = runtime.getById("savedAppsList");
      const summaryEl = runtime.getById("savedAppsSummary");
      if (!listEl || !summaryEl) return;
      const visibleApps = getVisibleApps();
      const keyword = String(state.appManagerKeyword || "").trim();
      runtime.setSummaryStatus(summaryEl, keyword ? `已保存应用：${visibleApps.length} / ${state.apps.length} 个` : `已保存应用：${state.apps.length} 个`, "info");
      if (visibleApps.length === 0) {
        listEl.innerHTML = state.apps.length === 0 ? `<div class="picker-empty"><strong>还没有已保存应用</strong><p>输入应用 ID 或链接后解析并保存。</p></div>` : `<div class="picker-empty"><strong>没有匹配到应用</strong><p>调整搜索词后再试一次。</p></div>`;
        return;
      }
      listEl.innerHTML = visibleApps.map((app) => {
        const isEditing = String(modules.state.state.editingAppId || "") === String(app.id);
        const isCurrent = state.currentApp && String(state.currentApp.id) === String(app.id);
        const description = String(app.description || "").trim();
        return `<article class="list-item saved-app-item compact-card ${isEditing ? "is-editing" : ""}" data-app-id="${runtime.escapeHtml(String(app.id))}"><div class="saved-app-main compact-card-main"><div class="compact-card-topline"><strong>${runtime.escapeHtml(modules.state.getAppDisplayName(app))}</strong><div class="inline-actions compact-card-actions"><button class="mini-btn" type="button" data-action="edit-app" data-app-id="${runtime.escapeHtml(String(app.id))}">修改</button><button class="mini-btn" type="button" data-action="delete-app" data-app-id="${runtime.escapeHtml(String(app.id))}">删除</button></div></div><span>应用 ID：${runtime.escapeHtml(modules.state.getAppDisplayId(app))}</span><span>输入项：${runtime.escapeHtml(String(modules.state.getAppInputCount(app)))}${isCurrent ? " · 当前使用" : ""}${isEditing ? " · 正在编辑" : ""}</span>${description ? `<span>${runtime.escapeHtml(description)}</span>` : ""}</div></article>`;
      }).join("");
    }
    async function setCurrentAppById(appId, options = {}) {
      const state = modules.state.state;
      const nextApp = state.apps.find((item) => String(item.id) === String(appId));
      if (!nextApp) return false;
      state.currentApp = nextApp;
      state.formValues = modules.state.buildDefaultFormValues(nextApp);
      await persistCurrentAppId(nextApp.id || "");
      modules.workspace.renderWorkspace();
      renderSavedAppsList();
      renderAppPickerList();
      if (!options.quiet) modules.ui.logToWorkspace(`已选择应用：${modules.state.getAppDisplayName(nextApp)}`);
      return true;
    }
    async function hydrateCurrentApp(options = {}) {
      const state = modules.state.state;
      const currentId = state.currentApp && state.currentApp.id;
      if (currentId && await setCurrentAppById(currentId, { quiet: true })) return;
      const persistedId = await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.CURRENT_APP_ID);
      if (persistedId && await setCurrentAppById(persistedId, { quiet: true })) return;
      state.currentApp = null;
      state.formValues = {};
      if (state.apps[0]) return setCurrentAppById(state.apps[0].id, { quiet: true });
      modules.workspace.renderWorkspace();
      if (!options.quiet) modules.ui.logToWorkspace("当前还没有可用的已保存应用。", "warn");
    }
    async function refreshWorkspaceApps(options = {}) {
      modules.state.state.apps = await loadAppsFromStorage();
      await hydrateCurrentApp({ quiet: true });
      renderSavedAppsList();
      renderAppPickerList();
      if (!options.quiet) modules.ui.logToWorkspace(`应用列表已刷新，共 ${modules.state.state.apps.length} 个应用。`);
    }
    function bindAppPicker() {
      const runtime = modules.runtime;
      const state = modules.state.state;
      const openButton = runtime.getById("btnOpenAppPicker");
      const refreshButton = runtime.getById("btnRefreshWorkspaceApps");
      const closeButton = runtime.getById("appPickerModalClose");
      const searchInput = runtime.getById("appPickerSearchInput");
      const listEl = runtime.getById("appPickerList");
      if (openButton) {
        openButton.addEventListener("click", () => {
          state.appPickerKeyword = "";
          if (searchInput) searchInput.value = "";
          renderAppPickerList();
          modules.workspace.setModalOpen("appPickerModal", true);
        });
      }
      if (refreshButton) {
        refreshButton.addEventListener("click", async () => {
          await refreshWorkspaceApps();
          modules.settings.renderSettingsDiagnostics("应用列表已从宿主本地存储刷新。", {
            runtime: state.hostRuntime,
            hasApiKey: Boolean(state.settings.apiKey)
          });
        });
      }
      if (closeButton) closeButton.addEventListener("click", () => modules.workspace.setModalOpen("appPickerModal", false));
      document.addEventListener("click", async (event) => {
        if (event.target && event.target.closest("#appPickerBackdrop")) {
          modules.workspace.setModalOpen("appPickerModal", false);
          return;
        }
        const item = event.target && event.target.closest(".picker-item");
        if (!item || !listEl || !listEl.contains(item)) return;
        const appId = item.getAttribute("value");
        if (!appId) return;
        if (await setCurrentAppById(appId)) {
          renderAppPickerList();
          modules.workspace.setModalOpen("appPickerModal", false);
        }
      });
      if (searchInput) {
        searchInput.addEventListener("input", () => {
          state.appPickerKeyword = searchInput.value || "";
          renderAppPickerList();
        });
      }
    }
    function fillAppEditor(app) {
      const runtime = modules.runtime;
      const safeApp = app && typeof app === "object" ? app : null;
      modules.state.state.editingAppId = safeApp ? String(safeApp.id) : null;
      if (runtime.getById("appEditorNameInput")) runtime.getById("appEditorNameInput").value = safeApp ? safeApp.name || "" : "";
      if (runtime.getById("appEditorAppIdInput")) runtime.getById("appEditorAppIdInput").value = safeApp ? safeApp.appId || "" : "";
      if (runtime.getById("appEditorDescriptionInput")) runtime.getById("appEditorDescriptionInput").value = safeApp ? safeApp.description || "" : "";
      if (runtime.getById("appEditorInputsInput")) runtime.getById("appEditorInputsInput").value = safeApp ? JSON.stringify(safeApp.inputs || [], null, 2) : "[]";
      renderAppInputsSummary(runtime.getById("appEditorInputsInput")?.value || "[]");
      const deleteButton = runtime.getById("btnDeleteEditingApp");
      if (deleteButton) deleteButton.hidden = !safeApp;
      modules.runtime.setSummaryStatus(runtime.getById("appEditorStatus"), safeApp ? `正在编辑应用：${modules.state.getAppDisplayName(safeApp)}` : "输入应用 ID 或链接后解析，确认名称后保存。", "info");
      markAppEditorPristine();
      renderSavedAppsList();
    }
    function openAppEditor(appId = null, options = {}) {
      if (!options.force && !confirmDiscardAppEditorChanges()) return false;
      const app = appId ? modules.state.state.apps.find((item) => String(item.id) === String(appId)) : null;
      fillAppEditor(app || null);
      modules.runtime.getById("appEditorAppIdInput")?.focus();
      modules.runtime.getById("appEditorAppIdInput")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return true;
    }
    function closeAppEditor(options = {}) {
      if (!options.force && !confirmDiscardAppEditorChanges()) return false;
      modules.state.state.editingAppId = null;
      modules.state.state.appEditorSnapshot = "";
      fillAppEditor(null);
      return true;
    }
    async function parseAppReference() {
      const runtime = modules.runtime;
      const inputEl = runtime.getById("appEditorAppIdInput");
      const nameEl = runtime.getById("appEditorNameInput");
      const descriptionEl = runtime.getById("appEditorDescriptionInput");
      const inputsEl = runtime.getById("appEditorInputsInput");
      const normalizedAppId = normalizeAppId(inputEl?.value || "");
      if (!normalizedAppId) throw new Error("请先输入有效的应用 ID 或 URL");
      if (inputEl) inputEl.value = normalizedAppId;
      const preferredName = String(nameEl?.value || "").trim();
      const apiKey = String(modules.state.state.settings.apiKey || "").trim();
      const statusEl = runtime.getById("appEditorStatus");
      runtime.setSummaryStatus(statusEl, `正在解析应用 ${normalizedAppId}...`, "info");
      if (!modules.runtime.isPluginRuntime()) {
        runtime.setSummaryStatus(statusEl, `当前是浏览器预览模式，已提取应用 ID：${normalizedAppId}。完整解析请在 UXP 插件内测试。`, "warn");
        return { ok: true, appId: normalizedAppId, name: preferredName || "", description: "", inputs: [] };
      }
      const result = await modules.runtime.callHost("runninghub.parseApp", [{ appId: normalizedAppId, apiKey, preferredName }], { timeoutMs: 45e3 });
      if (nameEl) nameEl.value = result && result.name ? result.name : preferredName;
      if (descriptionEl) descriptionEl.value = result && result.description ? result.description : "";
      if (inputsEl) inputsEl.value = JSON.stringify(result && result.inputs || [], null, 2);
      renderAppInputsSummary(inputsEl?.value || "[]");
      const parsedSummary = summarizeParsedApp(result);
      runtime.setSummaryStatus(statusEl, `解析成功：${parsedSummary.name}。${parsedSummary.summary} 请确认名称和输入结构后保存。`, "success");
      modules.ui.logToWorkspace(`应用解析成功：${parsedSummary.name}。${parsedSummary.summary}`, "success");
      return result;
    }
    function readAppEditorForm() {
      const runtime = modules.runtime;
      const appId = normalizeAppId(runtime.getById("appEditorAppIdInput")?.value || "");
      const name = String(runtime.getById("appEditorNameInput")?.value || "").trim();
      if (!appId) throw new Error("请先填写应用 ID");
      if (!name) throw new Error("请先填写应用名称");
      return {
        id: modules.state.state.editingAppId || runtime.createId("app"),
        appId,
        name,
        description: String(runtime.getById("appEditorDescriptionInput")?.value || "").trim(),
        inputs: parseAppInputsText(runtime.getById("appEditorInputsInput")?.value || "[]")
      };
    }
    async function saveEditedApp() {
      const formValue = readAppEditorForm();
      const apps = modules.state.state.apps;
      const existingIndex = apps.findIndex((item) => String(item.id) === String(formValue.id));
      const duplicateIndex = apps.findIndex((item) => String(item.appId) === String(formValue.appId) && String(item.id) !== String(formValue.id));
      const now = Date.now();
      const nextApp = modules.state.normalizeAppRecord({
        ...formValue,
        id: duplicateIndex >= 0 ? apps[duplicateIndex].id : formValue.id,
        createdAt: existingIndex >= 0 ? apps[existingIndex].createdAt : duplicateIndex >= 0 ? apps[duplicateIndex].createdAt : now,
        updatedAt: now
      });
      const nextApps = [...apps];
      if (existingIndex >= 0) nextApps[existingIndex] = nextApp;
      else if (duplicateIndex >= 0) nextApps[duplicateIndex] = nextApp;
      else nextApps.unshift(nextApp);
      await saveAppsToStorage(nextApps);
      await setCurrentAppById(nextApp.id, { quiet: true });
      modules.runtime.setSummaryStatus(modules.runtime.getById("appEditorStatus"), `应用已保存：${nextApp.name}`, "success");
      modules.ui.logToWorkspace(`应用已保存：${nextApp.name}`, "success");
      fillAppEditor(null);
    }
    async function deleteAppById(appId) {
      const target = modules.state.state.apps.find((item) => String(item.id) === String(appId));
      if (!target) return;
      const nextApps = modules.state.state.apps.filter((item) => String(item.id) !== String(appId));
      await saveAppsToStorage(nextApps);
      if (String(modules.state.state.editingAppId || "") === String(appId)) {
        modules.state.state.editingAppId = null;
        modules.state.state.appEditorSnapshot = "";
        fillAppEditor(null);
      }
      if (modules.state.state.currentApp && String(modules.state.state.currentApp.id) === String(appId)) {
        if (nextApps[0]) await setCurrentAppById(nextApps[0].id, { quiet: true });
        else {
          modules.state.state.currentApp = null;
          modules.state.state.formValues = {};
          await persistCurrentAppId("");
          modules.workspace.renderWorkspace();
          renderSavedAppsList();
          renderAppPickerList();
        }
      }
      modules.ui.logToWorkspace(`应用已删除：${target.name}`, "warn");
    }
    async function importAppsFromTextarea() {
      const input = modules.runtime.getById("appTransferInput");
      if (!input) return;
      const marker = String(input.value || "").trim();
      if (!marker) throw new Error("请先粘贴应用列表 JSON");
      let parsed = JSON.parse(marker);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.apps)) parsed = parsed.apps;
      const importedApps = modules.state.normalizeAppList(parsed);
      if (importedApps.length === 0) throw new Error("没有解析到可导入的应用记录");
      await saveAppsToStorage(importedApps);
      input.dataset.userEdited = "";
      input.value = JSON.stringify(importedApps, null, 2);
    }
    function exportAppsToTextarea() {
      const input = modules.runtime.getById("appTransferInput");
      if (!input) return;
      input.dataset.userEdited = "";
      input.value = JSON.stringify(modules.state.state.apps, null, 2);
    }
    modules.apps = {
      loadAppsFromStorage,
      saveAppsToStorage,
      renderAppInputsSummary,
      bindAppPicker,
      renderSavedAppsList,
      renderAppPickerList,
      setCurrentAppById,
      hydrateCurrentApp,
      refreshWorkspaceApps,
      openAppEditor,
      closeAppEditor,
      fillAppEditor,
      parseAppReference,
      saveEditedApp,
      deleteAppById,
      importAppsFromTextarea,
      exportAppsToTextarea,
      isAppEditorDirty,
      confirmDiscardAppEditorChanges,
      markAppEditorPristine
    };
  })(window);

  // src/webview/templates.js
  (function initTemplatesModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    const PROMPT_WARN_CHARS = 4e3;
    function getTemplateEditorDraft() {
      const runtime = modules.runtime;
      return JSON.stringify({
        id: modules.state.state.editingTemplateId || "",
        title: String(runtime.getById("templateTitleInput")?.value || "").trim(),
        content: String(runtime.getById("templateContentInput")?.value || "")
      });
    }
    function markTemplateEditorPristine() {
      modules.state.state.templateEditorSnapshot = getTemplateEditorDraft();
    }
    function isTemplateEditorDirty() {
      return getTemplateEditorDraft() !== String(modules.state.state.templateEditorSnapshot || "");
    }
    function confirmDiscardTemplateChanges() {
      if (!isTemplateEditorDirty()) return true;
      return global.confirm("当前模板编辑区里有未保存修改，确定放弃这些内容吗？");
    }
    function getTextLength(value) {
      return Array.from(String(value || "")).length;
    }
    function getTailPreview(value, maxChars = 20) {
      return Array.from(String(value || "")).slice(-Math.max(0, Number(maxChars) || 0)).join("").replace(/\r?\n/g, "\\n");
    }
    function buildTemplateLengthHint(title, content) {
      const titleLen = getTextLength(title);
      const contentLen = getTextLength(content);
      const tailPreview = getTailPreview(content, 20);
      const warning = titleLen >= PROMPT_WARN_CHARS || contentLen >= PROMPT_WARN_CHARS;
      return {
        text: warning ? `提示：标题 ${titleLen} / 内容 ${contentLen} 字符，末尾预览 ${tailPreview}。建议控制在 ${PROMPT_WARN_CHARS} 字符内。` : `提示：标题 ${titleLen} / 内容 ${contentLen} 字符，末尾预览 ${tailPreview}。插件本地不会截断模板内容。`,
        warning
      };
    }
    function getTemplatePreview(content, maxChars = 48) {
      const text = String(content || "").replace(/\s+/g, " ").trim();
      if (!text) return "暂无内容预览";
      const preview = Array.from(text).slice(0, Math.max(1, Number(maxChars) || 48)).join("");
      return preview.length < text.length ? `${preview}...` : preview;
    }
    function fillTemplateEditor(template, options = {}) {
      if (!options.force && !confirmDiscardTemplateChanges()) return false;
      const runtime = modules.runtime;
      const item = template && typeof template === "object" ? template : null;
      modules.state.state.editingTemplateId = item ? String(item.id) : null;
      if (runtime.getById("templateTitleInput")) runtime.getById("templateTitleInput").value = item ? item.title || "" : "";
      if (runtime.getById("templateContentInput")) runtime.getById("templateContentInput").value = item ? item.content || "" : "";
      updateTemplateLengthHint();
      runtime.setSummaryStatus(runtime.getById("templateStatusSummary"), item ? `正在编辑模板：${item.title}` : "填写标题和内容后即可保存模板。", "info");
      markTemplateEditorPristine();
      renderSavedTemplatesList();
      return true;
    }
    function updateTemplateLengthHint() {
      const hintEl = modules.runtime.getById("templateLengthHint");
      if (!hintEl) return;
      const title = modules.runtime.getById("templateTitleInput")?.value || "";
      const content = modules.runtime.getById("templateContentInput")?.value || "";
      const hint = buildTemplateLengthHint(title, content);
      hintEl.textContent = hint.text;
      hintEl.classList.toggle("is-warning", hint.warning);
    }
    async function loadTemplatesFromStorage() {
      const raw = await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.PROMPT_TEMPLATES);
      return modules.state.normalizeTemplateList(modules.runtime.readJsonText(raw, []));
    }
    async function saveTemplatesToStorage(templates) {
      const normalized = modules.state.normalizeTemplateList(templates);
      await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.PROMPT_TEMPLATES, JSON.stringify(normalized));
      modules.state.state.templates = normalized;
      renderSavedTemplatesList();
      renderTemplatePickerList();
      return normalized;
    }
    async function refreshTemplates(options = {}) {
      modules.state.state.templates = await loadTemplatesFromStorage();
      renderSavedTemplatesList();
      renderTemplatePickerList();
      if (!options.quiet) modules.ui.logToWorkspace(`模板列表已刷新，共 ${modules.state.state.templates.length} 条。`, "info");
    }
    function readTemplateEditorForm() {
      const title = String(modules.runtime.getById("templateTitleInput")?.value || "").trim();
      const content = String(modules.runtime.getById("templateContentInput")?.value || "");
      if (!title) throw new Error("请先填写模板标题");
      if (!content.trim()) throw new Error("请先填写模板内容");
      return { id: modules.state.state.editingTemplateId || modules.runtime.createId("tpl"), title, content };
    }
    async function saveEditedTemplate() {
      const formValue = readTemplateEditorForm();
      const templates = modules.state.state.templates.slice();
      const existingIndex = templates.findIndex((item) => String(item.id) === String(formValue.id));
      const now = Date.now();
      const nextItem = modules.state.normalizeTemplateRecord({
        ...formValue,
        createdAt: existingIndex >= 0 ? templates[existingIndex].createdAt : now,
        updatedAt: now
      });
      if (!nextItem) throw new Error("模板标题和内容不能为空");
      if (existingIndex >= 0) templates[existingIndex] = nextItem;
      else templates.unshift(nextItem);
      await saveTemplatesToStorage(templates);
      modules.runtime.setSummaryStatus(modules.runtime.getById("templateStatusSummary"), `模板已保存：${nextItem.title}`, "success");
      modules.runtime.setSummaryStatus(modules.runtime.getById("savedTemplatesSummary"), `已保存模板：${templates.length} 条`, "success");
      modules.ui.logToWorkspace(`模板已保存：${nextItem.title}`, "success");
      fillTemplateEditor(null, { force: true });
    }
    async function deleteTemplateById(templateId) {
      const target = modules.state.state.templates.find((item) => String(item.id) === String(templateId));
      if (!target) return;
      const nextTemplates = modules.state.state.templates.filter((item) => String(item.id) !== String(templateId));
      await saveTemplatesToStorage(nextTemplates);
      if (String(modules.state.state.editingTemplateId || "") === String(templateId)) fillTemplateEditor(null, { force: true });
      modules.ui.logToWorkspace(`模板已删除：${target.title}`, "warn");
      modules.runtime.setSummaryStatus(modules.runtime.getById("templateStatusSummary"), "模板已删除。", "warn");
      modules.runtime.setSummaryStatus(modules.runtime.getById("savedTemplatesSummary"), `已保存模板：${nextTemplates.length} 条`, "warn");
    }
    function exportTemplatesToTextarea() {
      const input = modules.runtime.getById("templateTransferInput");
      if (!input) return;
      input.dataset.userEdited = "";
      input.value = JSON.stringify(
        {
          format: "pixelrunner.prompt-templates",
          version: 1,
          exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
          templates: modules.state.state.templates
        },
        null,
        2
      );
    }
    async function importTemplatesFromTextarea() {
      const input = modules.runtime.getById("templateTransferInput");
      if (!input) return;
      const text = String(input.value || "").trim();
      if (!text) throw new Error("请先粘贴模板 JSON");
      let parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.templates)) parsed = parsed.templates;
      const templates = modules.state.normalizeTemplateList(parsed);
      if (templates.length === 0) throw new Error("没有解析到可导入的模板");
      await saveTemplatesToStorage(templates);
      input.dataset.userEdited = "";
      input.value = JSON.stringify(
        {
          format: "pixelrunner.prompt-templates",
          version: 1,
          exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
          templates
        },
        null,
        2
      );
    }
    function getVisibleTemplates() {
      const state = modules.state.state;
      const keyword = String(state.templateManagerKeyword || "").trim().toLowerCase();
      const list = !keyword ? [...state.templates] : state.templates.filter((item) => `${item.title || ""}
${item.content || ""}`.toLowerCase().includes(keyword));
      const sortMode = String(state.templateManagerSort || "updated_desc");
      list.sort((a, b) => {
        if (sortMode === "title_asc") return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
        if (sortMode === "title_desc") return String(b.title || "").localeCompare(String(a.title || ""), "zh-CN");
        if (sortMode === "created_desc") return Number(b.createdAt || 0) - Number(a.createdAt || 0);
        return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
      });
      return list;
    }
    function renderSavedTemplatesList() {
      const listEl = modules.runtime.getById("savedTemplatesList");
      const summaryEl = modules.runtime.getById("savedTemplatesSummary");
      if (!listEl || !summaryEl) return;
      const templates = getVisibleTemplates();
      const keyword = String(modules.state.state.templateManagerKeyword || "").trim();
      modules.runtime.setSummaryStatus(
        summaryEl,
        keyword ? `已保存模板：${templates.length} / ${modules.state.state.templates.length} 条` : `已保存模板：${templates.length} 条`,
        "info"
      );
      if (templates.length === 0) {
        listEl.innerHTML = modules.state.state.templates.length === 0 ? `<div class="picker-empty"><strong>还没有已保存模板</strong><p>点击“创建模板”开始整理常用提示词。</p></div>` : `<div class="picker-empty"><strong>没有匹配的模板</strong><p>换个关键词再试试。</p></div>`;
        return;
      }
      listEl.innerHTML = templates.map((item) => {
        const isEditing = String(modules.state.state.editingTemplateId || "") === String(item.id);
        return `<article class="list-item saved-template-item compact-card ${isEditing ? "is-editing" : ""}" data-template-id="${modules.runtime.escapeHtml(String(item.id))}"><div class="saved-template-main compact-card-main"><div class="compact-card-topline"><strong>${modules.runtime.escapeHtml(item.title)}</strong><div class="inline-actions compact-card-actions"><button class="mini-btn" type="button" data-action="edit-template" data-template-id="${modules.runtime.escapeHtml(String(item.id))}">修改</button><button class="mini-btn" type="button" data-action="delete-template" data-template-id="${modules.runtime.escapeHtml(String(item.id))}">删除</button></div></div><span>${modules.runtime.escapeHtml(`${getTextLength(item.content)} 字符`)}</span><span>${modules.runtime.escapeHtml(getTemplatePreview(item.content))}</span></div></article>`;
      }).join("");
    }
    function normalizePickerConfig(config = {}) {
      const mode = config.mode === "single" ? "single" : "multiple";
      return {
        mode,
        targetKey: String(config.targetKey || ""),
        maxSelection: mode === "single" ? 1 : Math.max(1, Math.min(10, Number(config.maxSelection) || 5)),
        applyMode: config.applyMode === "append" ? "append" : "replace"
      };
    }
    function openTemplatePicker(config = {}) {
      const picker = modules.state.state.templatePicker;
      const next = normalizePickerConfig(config);
      picker.open = true;
      picker.targetKey = next.targetKey;
      picker.mode = next.mode;
      picker.maxSelection = next.maxSelection;
      picker.keyword = "";
      picker.selectedIds = [];
      picker.applyMode = next.applyMode;
      modules.workspace.setModalOpen("templatePickerModal", true);
      syncTemplatePickerUi();
      renderTemplatePickerList();
    }
    function closeTemplatePicker() {
      const picker = modules.state.state.templatePicker;
      picker.open = false;
      picker.targetKey = "";
      picker.keyword = "";
      picker.selectedIds = [];
      picker.mode = "multiple";
      picker.maxSelection = 5;
      picker.applyMode = "replace";
      modules.workspace.setModalOpen("templatePickerModal", false);
    }
    function getPickerSelectionInfo() {
      const picker = modules.state.state.templatePicker;
      return picker.mode === "single" ? "单选模式：点击模板后会立即写入目标字段。" : `已选择 ${picker.selectedIds.length} / ${picker.maxSelection}，可组合写入同一个字段。`;
    }
    function syncTemplatePickerUi() {
      const titleEl = modules.runtime.getById("templatePickerTitle");
      const infoEl = modules.runtime.getById("templatePickerSelectionInfo");
      const applyButton = modules.runtime.getById("btnApplyTemplateSelection");
      const searchInput = modules.runtime.getById("templatePickerSearchInput");
      const applyModeInput = modules.runtime.getById("templatePickerApplyMode");
      const picker = modules.state.state.templatePicker;
      if (titleEl) titleEl.textContent = picker.mode === "single" ? "选择提示词模板" : "组合提示词模板";
      if (infoEl) infoEl.textContent = getPickerSelectionInfo();
      if (searchInput) searchInput.value = picker.keyword || "";
      if (applyModeInput) {
        applyModeInput.value = picker.applyMode || "replace";
        applyModeInput.disabled = picker.mode === "single";
      }
      if (applyButton) {
        applyButton.hidden = picker.mode === "single";
        applyButton.disabled = picker.selectedIds.length === 0;
      }
    }
    function renderTemplatePickerList() {
      const listEl = modules.runtime.getById("templatePickerList");
      const statsEl = modules.runtime.getById("templatePickerStats");
      if (!listEl) return;
      const picker = modules.state.state.templatePicker;
      const templates = modules.state.state.templates;
      const keyword = String(picker.keyword || "").trim().toLowerCase();
      const visibleTemplates = !keyword ? templates : templates.filter((item) => `${item.title || ""}
${item.content || ""}`.toLowerCase().includes(keyword));
      if (statsEl) statsEl.textContent = `${visibleTemplates.length} / ${templates.length}`;
      if (templates.length === 0) {
        listEl.innerHTML = `<div class="picker-empty"><strong>还没有可用模板</strong><p>先去设置页创建模板，再回到工作台选择。</p></div>`;
        syncTemplatePickerUi();
        return;
      }
      if (visibleTemplates.length === 0) {
        listEl.innerHTML = `<div class="picker-empty"><strong>没有匹配的模板</strong><p>换个关键词再试试。</p></div>`;
        syncTemplatePickerUi();
        return;
      }
      listEl.innerHTML = visibleTemplates.map((item) => {
        const isSelected = picker.selectedIds.includes(String(item.id));
        return `<button class="picker-item ${isSelected ? "active" : ""}" type="button" data-template-id="${modules.runtime.escapeHtml(String(item.id))}"><span class="picker-item-title">${modules.runtime.escapeHtml(item.title)}</span><span class="picker-item-meta"><span>${modules.runtime.escapeHtml(`${getTextLength(item.content)} 字符`)}</span><span>${modules.runtime.escapeHtml(getTailPreview(item.content, 30))}</span></span></button>`;
      }).join("");
      syncTemplatePickerUi();
    }
    function toggleTemplateSelection(templateId) {
      const picker = modules.state.state.templatePicker;
      const id = String(templateId || "");
      const exists = picker.selectedIds.includes(id);
      if (exists) {
        picker.selectedIds = picker.selectedIds.filter((item) => item !== id);
        renderTemplatePickerList();
        return true;
      }
      if (picker.selectedIds.length >= picker.maxSelection) return false;
      picker.selectedIds = [...picker.selectedIds, id];
      renderTemplatePickerList();
      return true;
    }
    function applyTemplatesToField(fieldKey, templateIds, options = {}) {
      const key = String(fieldKey || "").trim();
      if (!key) throw new Error("未找到目标字段");
      const selected = (Array.isArray(templateIds) ? templateIds : []).map((id) => modules.state.state.templates.find((item) => String(item.id) === String(id))).filter(Boolean);
      if (selected.length === 0) throw new Error("请至少选择一个模板");
      const applyMode = options.applyMode === "append" ? "append" : "replace";
      const existingValue = String(modules.state.state.formValues[key] || "");
      const incomingContent = selected.map((item) => String(item.content || "")).join("\n");
      const content = applyMode === "append" && existingValue.trim() ? `${existingValue.replace(/\s+$/g, "")}

${incomingContent}` : incomingContent;
      const length = getTextLength(content);
      if (length > PROMPT_WARN_CHARS) {
        throw new Error(`组合后的提示词长度 ${length} 超出建议上限 ${PROMPT_WARN_CHARS}`);
      }
      modules.state.state.formValues[key] = content;
      modules.workspace.renderWorkspace();
      modules.runtime.setSummaryStatus(
        modules.runtime.getById("templatePickerSelectionInfo"),
        `${applyMode === "append" ? "已追加" : "已写入"} ${selected.length} 条模板到字段 ${key}`,
        "success"
      );
      modules.ui.logToWorkspace(`${applyMode === "append" ? "已追加" : "已写入"} ${selected.length} 条模板到字段：${key}`, "success");
    }
    function bindTemplateActions() {
      const runtime = modules.runtime;
      const titleInput = runtime.getById("templateTitleInput");
      const contentInput = runtime.getById("templateContentInput");
      const saveButton = runtime.getById("btnSaveTemplate");
      const resetButton = runtime.getById("btnResetTemplateEditor");
      const pickerCloseButton = runtime.getById("templatePickerModalClose");
      const pickerApplyButton = runtime.getById("btnApplyTemplateSelection");
      const pickerList = runtime.getById("templatePickerList");
      const pickerSearchInput = runtime.getById("templatePickerSearchInput");
      const pickerApplyMode = runtime.getById("templatePickerApplyMode");
      const managerSearchInput = runtime.getById("templateManagerSearchInput");
      const managerSortInput = runtime.getById("templateManagerSortInput");
      [titleInput, contentInput].filter(Boolean).forEach((element) => {
        element.addEventListener("input", () => {
          updateTemplateLengthHint();
          runtime.setSummaryStatus(runtime.getById("templateStatusSummary"), modules.state.state.editingTemplateId ? "已修改当前模板，记得保存后再切换。" : "正在填写新模板，保存后会加入下方列表。", "pending");
        });
      });
      if (managerSearchInput) {
        managerSearchInput.addEventListener("input", () => {
          modules.state.state.templateManagerKeyword = managerSearchInput.value || "";
          renderSavedTemplatesList();
        });
      }
      if (managerSortInput) {
        managerSortInput.addEventListener("change", () => {
          modules.state.state.templateManagerSort = managerSortInput.value || "updated_desc";
          renderSavedTemplatesList();
        });
      }
      if (saveButton) {
        saveButton.addEventListener("click", async () => {
          try {
            await saveEditedTemplate();
          } catch (error) {
            runtime.setSummaryStatus(runtime.getById("templateStatusSummary"), `保存失败：${error.message}`, "error");
          }
        });
      }
      if (resetButton) resetButton.addEventListener("click", () => fillTemplateEditor(null));
      document.addEventListener("click", async (event) => {
        const actionTarget = event.target && event.target.closest("[data-action][data-template-id]");
        if (actionTarget) {
          const action = actionTarget.getAttribute("data-action");
          const templateId = actionTarget.getAttribute("data-template-id");
          if (action === "edit-template") {
            const target = modules.state.state.templates.find((item) => String(item.id) === String(templateId));
            fillTemplateEditor(target || null);
            return;
          }
          if (action === "delete-template") {
            await deleteTemplateById(templateId);
            return;
          }
        }
        if (event.target && event.target.closest("#templatePickerBackdrop")) closeTemplatePicker();
      });
      if (pickerCloseButton) pickerCloseButton.addEventListener("click", closeTemplatePicker);
      if (pickerList) {
        pickerList.addEventListener("click", (event) => {
          const item = event.target && event.target.closest("[data-template-id]");
          if (!item) return;
          const templateId = item.getAttribute("data-template-id");
          if (!templateId) return;
          const picker = modules.state.state.templatePicker;
          if (picker.mode === "single") {
            try {
              applyTemplatesToField(picker.targetKey, [templateId], { applyMode: "replace" });
              closeTemplatePicker();
            } catch (error) {
              modules.ui.logToWorkspace(error.message, "warn");
            }
            return;
          }
          if (!toggleTemplateSelection(templateId)) {
            modules.ui.logToWorkspace(`最多只能选择 ${picker.maxSelection} 条模板`, "warn");
          }
        });
      }
      if (pickerSearchInput) {
        pickerSearchInput.addEventListener("input", () => {
          modules.state.state.templatePicker.keyword = pickerSearchInput.value || "";
          renderTemplatePickerList();
        });
      }
      if (pickerApplyMode) {
        pickerApplyMode.addEventListener("change", () => {
          modules.state.state.templatePicker.applyMode = pickerApplyMode.value === "append" ? "append" : "replace";
          syncTemplatePickerUi();
        });
      }
      if (pickerApplyButton) {
        pickerApplyButton.addEventListener("click", () => {
          try {
            const picker = modules.state.state.templatePicker;
            applyTemplatesToField(picker.targetKey, picker.selectedIds, { applyMode: picker.applyMode });
            closeTemplatePicker();
          } catch (error) {
            modules.ui.logToWorkspace(error.message, "warn");
          }
        });
      }
      fillTemplateEditor(null, { force: true });
      updateTemplateLengthHint();
    }
    modules.templates = {
      PROMPT_WARN_CHARS,
      getTextLength,
      getTailPreview,
      buildTemplateLengthHint,
      fillTemplateEditor,
      updateTemplateLengthHint,
      refreshTemplates,
      renderSavedTemplatesList,
      saveEditedTemplate,
      deleteTemplateById,
      importTemplatesFromTextarea,
      exportTemplatesToTextarea,
      openTemplatePicker,
      closeTemplatePicker,
      applyTemplatesToField,
      bindTemplateActions,
      isTemplateEditorDirty,
      confirmDiscardTemplateChanges,
      markTemplateEditorPristine
    };
  })(window);

  // src/webview/settings.js
  (function initSettingsModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    function renderSettingsStatus(message, type = "info") {
      modules.runtime.setSummaryStatus(modules.runtime.getById("settingsStatusSummary"), message, type);
    }
    function renderSettingsDiagnostics(message, options = {}) {
      const box = modules.runtime.getById("settingsDiagnosticBox");
      if (!box) return;
      const runtimeText = options.runtime ? `<p>宿主环境：${modules.runtime.escapeHtml(options.runtime)}</p>` : "";
      const apiKeyText = options.hasApiKey ? "<p>API Key：已配置，会写入宿主本地存储。</p>" : "<p>API Key：尚未配置。</p>";
      const appText = `<p>已保存应用：${modules.runtime.escapeHtml(String(modules.state.state.apps.length))} 个。</p>`;
      const templateText = `<p>已保存模板：${modules.runtime.escapeHtml(String(modules.state.state.templates.length))} 条。</p>`;
      const currentApp = modules.state.state.currentApp;
      const currentAppText = currentApp ? `<p>当前应用：${modules.runtime.escapeHtml(modules.state.getAppDisplayName(currentApp))}。</p>` : "<p>当前应用：尚未选择。</p>";
      box.innerHTML = `<p>${modules.runtime.escapeHtml(String(message || ""))}</p>${runtimeText}${apiKeyText}${appText}${templateText}${currentAppText}`;
    }
    function updateAccountSummary(account) {
      const balanceEl = modules.runtime.getById("accountBalanceValue");
      const coinsEl = modules.runtime.getById("accountCoinsValue");
      const summaryEl = modules.runtime.getById("accountSummary");
      if (!balanceEl || !coinsEl || !summaryEl) return;
      const hasAccount = account && account.ok;
      balanceEl.textContent = hasAccount && account.balance != null ? String(account.balance) : "--";
      coinsEl.textContent = hasAccount && account.coins != null ? String(account.coins) : "--";
      summaryEl.classList.toggle("is-empty", !hasAccount);
    }
    function formatParseDebug(debugRecord) {
      if (!debugRecord || typeof debugRecord !== "object") return "暂无解析调试记录。";
      return JSON.stringify(debugRecord, null, 2);
    }
    async function loadParseDebug() {
      const box = modules.runtime.getById("parseDebugOutput");
      const raw = await modules.runtime.storageGetItem("rh_last_parse_debug");
      const parsed = modules.runtime.readJsonText(raw, null);
      const text = formatParseDebug(parsed);
      if (box) box.textContent = text;
      return parsed;
    }
    function fillSettingsForm(settings) {
      if (modules.runtime.getById("settingsApiKeyInput")) modules.runtime.getById("settingsApiKeyInput").value = settings.apiKey || "";
      if (modules.runtime.getById("settingsPollIntervalInput")) {
        modules.runtime.getById("settingsPollIntervalInput").value = String(
          settings.pollInterval ?? modules.state.DEFAULT_SETTINGS.pollInterval
        );
      }
      if (modules.runtime.getById("settingsTimeoutInput")) {
        modules.runtime.getById("settingsTimeoutInput").value = String(
          settings.timeout ?? modules.state.DEFAULT_SETTINGS.timeout
        );
      }
      if (modules.runtime.getById("settingsMaxConcurrentTasksInput")) {
        modules.runtime.getById("settingsMaxConcurrentTasksInput").value = String(
          settings.maxConcurrentTasks ?? modules.state.DEFAULT_SETTINGS.maxConcurrentTasks
        );
      }
    }
    function readSettingsForm() {
      return modules.state.normalizeSettings({
        apiKey: modules.runtime.getById("settingsApiKeyInput")?.value || "",
        pollInterval: modules.runtime.getById("settingsPollIntervalInput")?.value,
        timeout: modules.runtime.getById("settingsTimeoutInput")?.value,
        maxConcurrentTasks: modules.runtime.getById("settingsMaxConcurrentTasksInput")?.value
      });
    }
    async function loadSettingsSnapshot() {
      const apiKey = String(await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.API_KEY) || "").trim();
      const rawSettings = modules.runtime.readJsonText(await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.SETTINGS), {});
      return modules.state.normalizeSettings({
        apiKey,
        pollInterval: rawSettings && rawSettings.pollInterval,
        timeout: rawSettings && rawSettings.timeout,
        maxConcurrentTasks: rawSettings && rawSettings.maxConcurrentTasks
      });
    }
    async function saveSettingsSnapshot(settings) {
      const normalized = modules.state.normalizeSettings(settings);
      await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.API_KEY, normalized.apiKey);
      await modules.runtime.storageSetItem(
        modules.state.STORAGE_KEYS.SETTINGS,
        JSON.stringify({
          pollInterval: normalized.pollInterval,
          timeout: normalized.timeout,
          maxConcurrentTasks: normalized.maxConcurrentTasks
        })
      );
      modules.state.state.settings = normalized;
      modules.state.state.settingsLoaded = true;
      fillSettingsForm(normalized);
      if (modules.workspace && typeof modules.workspace.updateRunButtonState === "function") {
        modules.workspace.updateRunButtonState();
      }
      renderSettingsStatus("设置已保存到宿主本地存储。", "success");
      renderSettingsDiagnostics("当前设置已同步。", {
        runtime: modules.state.state.hostRuntime,
        hasApiKey: Boolean(normalized.apiKey)
      });
      modules.ui.logToWorkspace(
        `设置已保存：轮询 ${normalized.pollInterval}s，超时 ${normalized.timeout}s，并发 ${normalized.maxConcurrentTasks} 个。`,
        "success"
      );
    }
    async function initializeSettings() {
      renderSettingsStatus("正在读取本地设置...", "info");
      try {
        if (modules.runtime.isPluginRuntime()) {
          const hostInfo = await modules.runtime.callHost("host.ping");
          modules.state.state.hostRuntime = hostInfo && hostInfo.runtime ? String(hostInfo.runtime) : "uxp-host";
        } else {
          modules.state.state.hostRuntime = "browser-preview";
        }
      } catch (_) {
        modules.state.state.hostRuntime = modules.runtime.isPluginRuntime() ? "uxp-host" : "browser-preview";
      }
      const snapshot = await loadSettingsSnapshot();
      modules.state.state.settings = snapshot;
      modules.state.state.settingsLoaded = true;
      fillSettingsForm(snapshot);
      renderSettingsStatus("设置已加载，可以直接修改并保存。", "success");
      renderSettingsDiagnostics("当前设置快照已读取完成。", {
        runtime: modules.state.state.hostRuntime,
        hasApiKey: Boolean(snapshot.apiKey)
      });
      if (snapshot.apiKey && modules.runtime.isPluginRuntime()) {
        try {
          updateAccountSummary(await modules.runtime.callHost("runninghub.fetchAccountStatus", [{ apiKey: snapshot.apiKey }]));
        } catch (_) {
          updateAccountSummary(null);
        }
      } else {
        updateAccountSummary(null);
      }
    }
    function bindAppManagerControls() {
      const runtime = modules.runtime;
      const searchInput = runtime.getById("appManagerSearchInput");
      const sortInput = runtime.getById("appManagerSortInput");
      if (searchInput) {
        searchInput.addEventListener("input", () => {
          modules.state.state.appManagerKeyword = searchInput.value || "";
          modules.apps.renderSavedAppsList();
        });
      }
      if (sortInput) {
        sortInput.addEventListener("change", () => {
          modules.state.state.appManagerSort = sortInput.value || "updated_desc";
          modules.apps.renderSavedAppsList();
        });
      }
    }
    function bindSettingsActions() {
      const runtime = modules.runtime;
      const saveButton = runtime.getById("btnSaveSettings");
      const resetButton = runtime.getById("btnResetSettings");
      const parseAppButton = runtime.getById("btnParseApp");
      const saveEditingAppButton = runtime.getById("btnSaveEditingApp");
      const deleteEditingAppButton = runtime.getById("btnDeleteEditingApp");
      const saveTemplateButton = runtime.getById("btnSaveTemplate");
      const resetTemplateButton = runtime.getById("btnResetTemplateEditor");
      const loadParseDebugButton = runtime.getById("btnLoadParseDebug");
      const fieldIds = ["settingsApiKeyInput", "settingsPollIntervalInput", "settingsTimeoutInput", "settingsMaxConcurrentTasksInput"];
      bindAppManagerControls();
      fieldIds.forEach((id) => {
        const element = runtime.getById(id);
        if (!element) return;
        element.addEventListener("input", () => renderSettingsStatus("检测到未保存修改。", "pending"));
      });
      if (saveButton) {
        saveButton.addEventListener("click", async () => {
          saveButton.disabled = true;
          renderSettingsStatus("正在保存设置...", "info");
          try {
            await saveSettingsSnapshot(readSettingsForm());
            if (modules.state.state.settings.apiKey && modules.runtime.isPluginRuntime()) {
              updateAccountSummary(
                await modules.runtime.callHost("runninghub.fetchAccountStatus", [{ apiKey: modules.state.state.settings.apiKey }])
              );
            } else {
              updateAccountSummary(null);
            }
          } catch (error) {
            renderSettingsStatus(`设置保存失败：${error.message}`, "error");
            renderSettingsDiagnostics("保存设置时发生错误，请检查宿主桥接与当前环境。", {
              runtime: modules.state.state.hostRuntime,
              hasApiKey: Boolean(runtime.getById("settingsApiKeyInput")?.value)
            });
            modules.ui.logToWorkspace(`设置保存失败：${error.message}`, "error");
          } finally {
            saveButton.disabled = false;
          }
        });
      }
      if (resetButton) {
        resetButton.addEventListener("click", () => {
          fillSettingsForm(modules.state.state.settingsLoaded ? modules.state.state.settings : modules.state.DEFAULT_SETTINGS);
          renderSettingsStatus("表单已恢复为当前已加载设置。", "info");
        });
      }
      if (parseAppButton) {
        parseAppButton.addEventListener("click", async () => {
          parseAppButton.disabled = true;
          try {
            const parsed = await modules.apps.parseAppReference();
            if (parsed) {
              renderSettingsDiagnostics(
                `应用解析完成：${parsed.name || parsed.appId || "未命名应用"}。`,
                {
                  runtime: modules.state.state.hostRuntime,
                  hasApiKey: Boolean(modules.state.state.settings.apiKey)
                }
              );
            }
          } catch (error) {
            runtime.setSummaryStatus(runtime.getById("appEditorStatus"), error.message, "error");
          } finally {
            parseAppButton.disabled = false;
          }
        });
      }
      ["appEditorAppIdInput", "appEditorNameInput", "appEditorDescriptionInput", "appEditorInputsInput"].forEach((id) => {
        const element = runtime.getById(id);
        if (!element) return;
        element.addEventListener("input", () => {
          if (id === "appEditorInputsInput") {
            modules.apps.renderAppInputsSummary(element.value || "[]");
          }
          runtime.setSummaryStatus(
            runtime.getById("appEditorStatus"),
            modules.state.state.editingAppId ? "已修改当前应用，记得保存。" : "输入应用 ID 或链接后解析，确认名称后保存。",
            "pending"
          );
        });
      });
      if (saveEditingAppButton) {
        saveEditingAppButton.addEventListener("click", async () => {
          try {
            await modules.apps.saveEditedApp();
            runtime.setSummaryStatus(runtime.getById("savedAppsSummary"), "应用已保存。", "success");
          } catch (error) {
            runtime.setSummaryStatus(runtime.getById("appEditorStatus"), `保存失败：${error.message}`, "error");
          }
        });
      }
      if (deleteEditingAppButton) {
        deleteEditingAppButton.addEventListener("click", async () => {
          if (!modules.state.state.editingAppId) return;
          await modules.apps.deleteAppById(modules.state.state.editingAppId);
          runtime.setSummaryStatus(runtime.getById("savedAppsSummary"), "应用已删除。", "warn");
        });
      }
      if (resetTemplateButton) {
        resetTemplateButton.addEventListener("click", () => {
          modules.templates.fillTemplateEditor(null);
        });
      }
      if (loadParseDebugButton) {
        loadParseDebugButton.addEventListener("click", async () => {
          try {
            const debug = await loadParseDebug();
            renderSettingsDiagnostics(
              debug ? "已加载最近一次应用解析调试记录。" : "当前还没有解析调试记录，请先解析一次应用。",
              {
                runtime: modules.state.state.hostRuntime,
                hasApiKey: Boolean(modules.state.state.settings.apiKey)
              }
            );
          } catch (error) {
            renderSettingsDiagnostics(`读取解析调试记录失败：${error.message}`, {
              runtime: modules.state.state.hostRuntime,
              hasApiKey: Boolean(modules.state.state.settings.apiKey)
            });
          }
        });
      }
      ["templateTitleInput", "templateContentInput"].forEach((id) => {
        const element = runtime.getById(id);
        if (!element) return;
        element.addEventListener("input", () => {
          modules.templates.updateTemplateLengthHint();
        });
      });
      if (saveTemplateButton) {
        saveTemplateButton.addEventListener("click", async () => {
          try {
            await modules.templates.saveEditedTemplate();
            runtime.setSummaryStatus(runtime.getById("savedTemplatesSummary"), "模板已保存。", "success");
          } catch (error) {
            runtime.setSummaryStatus(runtime.getById("templateStatusSummary"), `保存失败：${error.message}`, "error");
          }
        });
      }
      document.addEventListener("click", async (event) => {
        const actionTarget = event.target && event.target.closest("[data-action]");
        if (!actionTarget) return;
        const action = actionTarget.getAttribute("data-action");
        const appId = actionTarget.getAttribute("data-app-id");
        if (action === "edit-app" && appId) {
          modules.apps.openAppEditor(appId);
          return;
        }
        if (action === "delete-app" && appId) {
          await modules.apps.deleteAppById(appId);
          runtime.setSummaryStatus(runtime.getById("savedAppsSummary"), "应用已删除。", "warn");
        }
      });
    }
    modules.settings = {
      renderSettingsStatus,
      renderSettingsDiagnostics,
      loadParseDebug,
      initializeSettings,
      bindSettingsActions
    };
  })(window);

  // src/webview/main.js
  window.PixelRunnerModules = window.PixelRunnerModules || {};
  window.PixelRunnerModules.main = {
    VIEW_MAP: {
      tabWorkspace: "viewWorkspace",
      tabTools: "viewTools",
      tabSettings: "viewSettings"
    }
  };
  document.addEventListener("DOMContentLoaded", () => {
    const modules = window.PixelRunnerModules;
    document.body.classList.toggle("is-browser-preview", !modules.runtime.isPluginRuntime());
    modules.ui.bindTabs();
    modules.ui.bindTactileFeedback();
    modules.ui.bindToolActions();
    modules.apps.bindAppPicker();
    modules.workspace.bindWorkspaceActions();
    modules.ui.bindPlaceholderActions();
    modules.templates.bindTemplateActions();
    modules.settings.bindSettingsActions();
    Promise.all([
      modules.apps.refreshWorkspaceApps({ quiet: true }),
      modules.templates.refreshTemplates({ quiet: true }),
      modules.settings.initializeSettings()
    ]).then(() => {
      modules.apps.renderSavedAppsList();
      modules.templates.renderSavedTemplatesList();
      modules.workspace.renderWorkspace();
      modules.ui.setActiveView("tabWorkspace");
      if (modules.runtime.isPluginRuntime()) {
        modules.workspace.refreshPhotoshopDocumentStatus({ quiet: true });
      }
      modules.runtime.postHostMessage({
        type: "pixelrunner.webview.ready",
        version: "2.4.0"
      });
    }).catch((error) => {
      modules.settings.renderSettingsStatus(`初始化失败：${error.message}`, "error");
      modules.settings.renderSettingsDiagnostics("应用初始化未完成，请先检查 src/webview-entry.js 与宿主桥接。", {
        runtime: modules.state.state.hostRuntime,
        hasApiKey: false
      });
      modules.ui.logToWorkspace(`初始化失败：${error.message}`, "error");
    });
  });
})();
//# sourceMappingURL=app.bundle.js.map
