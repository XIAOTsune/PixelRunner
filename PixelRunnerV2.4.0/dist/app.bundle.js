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
    function getUxpFileSystem() {
      return global && global.uxp && global.uxp.storage && global.uxp.storage.localFileSystem ? global.uxp.storage.localFileSystem : null;
    }
    async function saveTextFile(defaultName, text, options = {}) {
      const filename = String(defaultName || "export.txt").trim() || "export.txt";
      const content = String(text == null ? "" : text);
      const fileSystem = getUxpFileSystem();
      if (fileSystem && typeof fileSystem.getFileForSaving === "function") {
        const entry = await fileSystem.getFileForSaving(filename);
        if (!entry) return { outcome: "cancelled", savedPath: "" };
        await entry.write(content);
        return {
          outcome: "saved",
          savedPath: String(entry.nativePath || entry.name || filename)
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
          return { outcome: "saved", savedPath: String(handle.name || filename) };
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
        return { outcome: "saved", savedPath: filename };
      }
      return { outcome: "unsupported", savedPath: "" };
    }
    async function openTextFile(options = {}) {
      const fileSystem = getUxpFileSystem();
      if (fileSystem && typeof fileSystem.getFileForOpening === "function") {
        const picked = await fileSystem.getFileForOpening();
        const entry = Array.isArray(picked) ? picked[0] : picked;
        if (!entry) return { outcome: "cancelled", name: "", text: "" };
        const text = await entry.read();
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

  // src/webview/state.js
  (function initStateModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    const STORAGE_KEYS = {
      API_KEY: "rh_api_key",
      SETTINGS: "rh_settings",
      APPS: "rh_ai_apps_v2",
      PROMPT_TEMPLATES: "rh_prompt_templates",
      LEGACY_APPS: ["rh_ai_apps", "rh_ai_apps_v1", "ai_apps", "runninghub_ai_apps"],
      CURRENT_APP_ID: "pixelrunner.current_app_id",
      WORKSPACE_MODE: "pixelrunner.workspaceMode",
      QUICK_ENTRIES: "pixelrunner.quickEntries.v1",
      SOUND_ENABLED: "pixelrunner.sound_enabled",
      THEME: "pixelrunner.theme.v1"
    };
    const DEFAULT_AI_OPTIMIZE_APP_ID = "2042544874578251778";
    const DEFAULT_SETTINGS = {
      apiKey: "",
      pollInterval: 2,
      timeout: 180,
      maxConcurrentTasks: 3,
      aiOptimizeAppId: DEFAULT_AI_OPTIMIZE_APP_ID
    };
    const DEFAULT_THEME = {
      preset: "classic",
      basePreset: "classic",
      customImage: "",
      customImageName: "",
      glass: false
    };
    const state = {
      apps: [],
      currentApp: null,
      workspaceMode: "app",
      quickEntries: [],
      templates: [],
      appPickerKeyword: "",
      appManagerKeyword: "",
      appManagerSort: "manual",
      templateManagerKeyword: "",
      templateManagerSort: "manual",
      settings: { ...DEFAULT_SETTINGS },
      settingsLoaded: false,
      accountSummary: {
        balance: null,
        coins: null,
        updatedAt: 0
      },
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
      },
      sound: {
        enabled: true,
        playerReady: false
      },
      theme: { ...DEFAULT_THEME }
    };
    function normalizeTheme(theme) {
      const source = theme && typeof theme === "object" ? theme : {};
      const preset = ["classic", "aurora", "graphite", "rose", "studio"].includes(String(source.preset || "")) ? String(source.preset) : DEFAULT_THEME.preset;
      const customImage = String(source.customImage || "").trim();
      const basePreset = ["classic", "aurora", "graphite", "rose", "studio"].includes(String(source.basePreset || "")) ? String(source.basePreset) : preset;
      return {
        preset: customImage ? "custom" : preset,
        basePreset: customImage ? basePreset : preset,
        customImage,
        customImageName: String(source.customImageName || "").trim(),
        glass: Boolean(source.glass || customImage)
      };
    }
    function normalizeSettings(settings) {
      const source = settings && typeof settings === "object" ? settings : {};
      const pollInterval = Math.min(15, Math.max(1, Math.floor(Number(source.pollInterval) || DEFAULT_SETTINGS.pollInterval)));
      const timeout = Math.min(600, Math.max(10, Math.floor(Number(source.timeout) || DEFAULT_SETTINGS.timeout)));
      const maxConcurrentTasks = Math.min(100, Math.max(1, Math.floor(Number(source.maxConcurrentTasks) || DEFAULT_SETTINGS.maxConcurrentTasks)));
      return {
        apiKey: String(source.apiKey || "").trim(),
        pollInterval,
        timeout,
        maxConcurrentTasks,
        aiOptimizeAppId: String(source.aiOptimizeAppId || DEFAULT_AI_OPTIMIZE_APP_ID).trim() || DEFAULT_AI_OPTIMIZE_APP_ID
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
      const fieldType = String(input.fieldType || input.type || "").toLowerCase();
      const hint = `${key} ${label} ${fieldType}`;
      if (/prompt|negative|positive|hint/.test(hint)) return true;
      if (/提示词|负向|正向|输入文本|文本输入/.test(hint)) return true;
      if ((fieldType.includes("text") || fieldType.includes("string")) && /(input|text|string|文本|输入)/.test(hint)) return true;
      return false;
    }
    function buildDefaultFormValues(app) {
      const values = {};
      const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
      inputs.forEach((input) => {
        const key = String(input.key || "").trim();
        if (!key) return;
        if (input.type === "image" || input.type === "file") {
          values[key] = null;
          return;
        }
        if (input.default != null) {
          values[key] = input.default;
          return;
        }
        if (input.type === "boolean" || input.type === "switch" || input.type === "checkbox") {
          values[key] = false;
          return;
        }
        values[key] = "";
      });
      return values;
    }
    modules.state = {
      STORAGE_KEYS,
      DEFAULT_AI_OPTIMIZE_APP_ID,
      DEFAULT_SETTINGS,
      DEFAULT_THEME,
      state,
      normalizeTheme,
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

  // src/webview/glow/presets.js
  (function initGlowPresetsModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    function clamp(value, min, max, fallback = min) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(max, Math.max(min, parsed));
    }
    function normalizeStyle(style) {
      const key = String(style || "").trim().toLowerCase();
      if (key === "none") return "none";
      if (key === "whitesoft" || key === "soft") return "whiteSoft";
      if (key === "shine" || key === "dreamy") return "shine";
      return "darkSoft";
    }
    const STYLE_PRESETS = {
      none: {
        thresholdBias: 0,
        whiteProtect: 1,
        skinProtect: 1,
        darkProtect: 1,
        knee: 0.18,
        chromaBoost: 0,
        smallWeight: 0,
        mediumWeight: 0,
        largeWeight: 0,
        softAddMix: 0,
        warmth: 0,
        scatter: 0
      },
      darkSoft: {
        thresholdBias: 0.02,
        whiteProtect: 0.86,
        skinProtect: 0.78,
        darkProtect: 0.42,
        knee: 0.24,
        chromaBoost: 0.28,
        smallWeight: 0.42,
        mediumWeight: 0.88,
        largeWeight: 0.48,
        softAddMix: 0.42,
        warmth: 0.035,
        scatter: 0.88
      },
      whiteSoft: {
        thresholdBias: -0.02,
        whiteProtect: 0.92,
        skinProtect: 0.86,
        darkProtect: 0.46,
        knee: 0.28,
        chromaBoost: 0.2,
        smallWeight: 0.32,
        mediumWeight: 0.94,
        largeWeight: 0.56,
        softAddMix: 0.52,
        warmth: 0.025,
        scatter: 1
      },
      shine: {
        thresholdBias: -0.06,
        whiteProtect: 0.78,
        skinProtect: 0.74,
        darkProtect: 0.5,
        knee: 0.32,
        chromaBoost: 0.36,
        smallWeight: 0.3,
        mediumWeight: 0.9,
        largeWeight: 0.72,
        softAddMix: 0.64,
        warmth: 0.06,
        scatter: 1.18
      }
    };
    function normalizeGlowParams(config = {}) {
      const style = normalizeStyle(config.style);
      const preset = STYLE_PRESETS[style];
      const strength = style === "none" ? 0 : clamp(config.strength, 0, 100, 47);
      const radius = clamp(config.radius, 1, 120, 81);
      const threshold = clamp(config.threshold, 0, 100, 81);
      const saturation = clamp(config.saturation, -100, 100, 81);
      const brightnessBias = clamp(config.brightnessBias, -50, 50, 0);
      const radiusRatio = radius / 120;
      const thresholdRatio = threshold / 100;
      const brightnessLift = brightnessBias / 50;
      return {
        style,
        strength,
        radius,
        threshold,
        saturation,
        brightnessBias,
        source: {
          thresholdLow: clamp(0.36 + thresholdRatio * 0.32 + preset.thresholdBias - brightnessLift * 0.065, 0.2, 0.86, 0.62),
          thresholdHigh: clamp(0.55 + thresholdRatio * 0.29 + preset.thresholdBias - brightnessLift * 0.085, 0.32, 0.96, 0.78),
          thresholdKnee: clamp(preset.knee * (1.08 - thresholdRatio * 0.38) + radiusRatio * 0.04, 0.08, 0.34, 0.2),
          localRadius: Math.max(3, Math.round(4 + radiusRatio * 10)),
          contrastLow: 0.025,
          contrastHigh: clamp(0.095 - thresholdRatio * 0.035, 0.038, 0.11, 0.07),
          specularLow: 0.06,
          specularHigh: 0.28,
          chromaBoost: clamp(preset.chromaBoost + saturation / 100 * 0.22, 0, 0.62, preset.chromaBoost),
          whiteProtect: preset.whiteProtect,
          skinProtect: preset.skinProtect,
          darkProtect: preset.darkProtect
        },
        blur: {
          smallRadius: Math.max(1, Math.round(1.5 + radiusRatio * 4)),
          mediumRadius: Math.max(2, Math.round(5 + radiusRatio * 14)),
          largeRadius: Math.max(3, Math.round(7 + radiusRatio * 24)),
          smallWeight: preset.smallWeight,
          mediumWeight: preset.mediumWeight,
          largeWeight: preset.largeWeight * (0.7 + radiusRatio * preset.scatter),
          passes: radius > 72 ? 2 : 1
        },
        composite: {
          intensity: strength / 100 * 2.35,
          softAddMix: preset.softAddMix,
          warmth: preset.warmth,
          saturation: clamp(1.16 + saturation / 100 * 0.46 + preset.chromaBoost * 0.22, 0.72, 1.62, 1),
          highlightProtect: clamp(0.58 + thresholdRatio * 0.22, 0.48, 0.86, 0.68),
          shadowProtect: preset.darkProtect,
          colorProtect: 0.18,
          shoulder: clamp(0.64 - strength / 100 * 0.18, 0.42, 0.72, 0.58)
        }
      };
    }
    modules.glowPresets = {
      clamp,
      normalizeGlowParams
    };
  })(window);

  // src/webview/glow/source-mask.js
  (function initGlowSourceMaskModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }
    function smoothstep(edge0, edge1, value) {
      const t = clamp((value - edge0) / Math.max(1e-4, edge1 - edge0), 0, 1);
      return t * t * (3 - 2 * t);
    }
    function softThresholdMask(value, threshold, knee) {
      const safeKnee = Math.max(1e-4, knee);
      const soft = clamp(value - threshold + safeKnee, 0, safeKnee * 2);
      const curved = soft * soft / (safeKnee * 4);
      return clamp(Math.max(curved, value - threshold) / Math.max(value, 1e-4), 0, 1);
    }
    function boostSaturation(r, g, b, amount) {
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      return [
        clamp(luma + (r - luma) * (1 + amount), 0, 1),
        clamp(luma + (g - luma) * (1 + amount), 0, 1),
        clamp(luma + (b - luma) * (1 + amount), 0, 1)
      ];
    }
    function createLayer(width, height) {
      return {
        width,
        height,
        r: new Float32Array(width * height),
        g: new Float32Array(width * height),
        b: new Float32Array(width * height)
      };
    }
    function blurFloatHorizontal(src, width, height, radius) {
      const out = new Float32Array(src.length);
      const size = radius * 2 + 1;
      for (let y = 0; y < height; y += 1) {
        const row = y * width;
        let sum = 0;
        for (let x = -radius; x <= radius; x += 1) {
          sum += src[row + clamp(x, 0, width - 1)];
        }
        for (let x = 0; x < width; x += 1) {
          out[row + x] = sum / size;
          const removeX = clamp(x - radius, 0, width - 1);
          const addX = clamp(x + radius + 1, 0, width - 1);
          sum += src[row + addX] - src[row + removeX];
        }
      }
      return out;
    }
    function blurFloat(src, width, height, radius) {
      const r = Math.max(1, Math.floor(radius));
      const horizontal = blurFloatHorizontal(src, width, height, r);
      const out = new Float32Array(src.length);
      const size = r * 2 + 1;
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let y = -r; y <= r; y += 1) {
          sum += horizontal[clamp(y, 0, height - 1) * width + x];
        }
        for (let y = 0; y < height; y += 1) {
          out[y * width + x] = sum / size;
          const removeY = clamp(y - r, 0, height - 1);
          const addY = clamp(y + r + 1, 0, height - 1);
          sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
        }
      }
      return out;
    }
    function rgbToHsv(r, g, b) {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      let h = 0;
      if (delta > 1e-4) {
        if (max === r) h = (g - b) / delta % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h *= 60;
        if (h < 0) h += 360;
      }
      return { h, s: max === 0 ? 0 : delta / max, v: max };
    }
    function createMaskImageData(mask, width, height, tint = null) {
      const out = new ImageData(width, height);
      const tr = tint ? tint[0] : 255;
      const tg = tint ? tint[1] : 255;
      const tb = tint ? tint[2] : 255;
      for (let pixel = 0, index = 0; pixel < mask.length; pixel += 1, index += 4) {
        const value = clamp(mask[pixel], 0, 1);
        out.data[index] = Math.round(tr * value);
        out.data[index + 1] = Math.round(tg * value);
        out.data[index + 2] = Math.round(tb * value);
        out.data[index + 3] = 255;
      }
      return out;
    }
    function buildSourceMask(imageData, params, options = {}) {
      const { width, height, data } = imageData;
      const total = width * height;
      const luma = new Float32Array(total);
      const maxChannelMap = new Float32Array(total);
      const saturationMap = new Float32Array(total);
      for (let index = 0, pixel = 0; pixel < total; pixel += 1, index += 4) {
        const r = data[index] / 255;
        const g = data[index + 1] / 255;
        const b = data[index + 2] / 255;
        const maxChannel = Math.max(r, g, b);
        const minChannel = Math.min(r, g, b);
        luma[pixel] = r * 0.2126 + g * 0.7152 + b * 0.0722;
        maxChannelMap[pixel] = maxChannel;
        saturationMap[pixel] = maxChannel <= 0 ? 0 : (maxChannel - minChannel) / maxChannel;
      }
      const localMean = blurFloat(luma, width, height, params.source.localRadius);
      const localContrast = new Float32Array(total);
      const lumaMask = new Float32Array(total);
      const contrastMask = new Float32Array(total);
      const whiteFlatMask = new Float32Array(total);
      const skinLikeMask = new Float32Array(total);
      const darkProtect = new Float32Array(total);
      const protectMask = new Float32Array(total);
      const sourceMask = new Float32Array(total);
      const sourceLayer = createLayer(width, height);
      for (let index = 0, pixel = 0; pixel < total; pixel += 1, index += 4) {
        const r = data[index] / 255;
        const g = data[index + 1] / 255;
        const b = data[index + 2] / 255;
        const lum = luma[pixel];
        const sat = saturationMap[pixel];
        const contrast = Math.max(0, lum - localMean[pixel]);
        const specular = Math.max(0, maxChannelMap[pixel] - localMean[pixel]);
        const hsv = rgbToHsv(r, g, b);
        const brightness = Math.max(lum * 0.82 + maxChannelMap[pixel] * 0.18, maxChannelMap[pixel] * 0.88);
        const lumaScore = softThresholdMask(brightness, params.source.thresholdLow, params.source.thresholdKnee) * smoothstep(params.source.thresholdLow - params.source.thresholdKnee * 0.92, params.source.thresholdHigh, brightness);
        const contrastScore = smoothstep(params.source.contrastLow, params.source.contrastHigh, contrast);
        const specularScore = smoothstep(params.source.specularLow, params.source.specularHigh, specular);
        const highLightness = smoothstep(0.72, 0.94, lum);
        const lowContrast = 1 - smoothstep(0.012, 0.075, contrast);
        const lowSat = 1 - smoothstep(0.12, 0.36, sat);
        const whiteFlat = highLightness * lowContrast * lowSat;
        const skinHue = hsv.h >= 5 && hsv.h <= 52 ? 1 : 0;
        const skinColor = skinHue * smoothstep(0.16, 0.36, sat) * (1 - smoothstep(0.78, 0.96, sat)) * smoothstep(0.38, 0.74, lum) * (1 - smoothstep(0.9, 1, lum));
        const dark = 1 - smoothstep(0.08, 0.28, lum);
        const protection = clamp(
          whiteFlat * params.source.whiteProtect + skinColor * params.source.skinProtect + dark * params.source.darkProtect,
          0,
          1
        );
        const chromaSource = smoothstep(0.08, 0.46, sat) * smoothstep(0.44, 0.84, brightness);
        const reflectiveBoost = clamp(0.5 + contrastScore * 0.46 + specularScore * 0.42 + chromaSource * 0.22, 0, 1.22);
        const edgeSource = Math.max(contrastScore * 0.22, specularScore * 0.36) * smoothstep(0.44, 0.88, brightness);
        const combinedSource = lumaScore * 0.88 + edgeSource * 0.32;
        const mask = clamp(combinedSource * reflectiveBoost * (1 - protection * 0.78), 0, 1);
        const colorGain = Math.pow(mask, 0.78);
        const chromaBoost = params.source.chromaBoost * smoothstep(0.06, 0.58, sat) * (0.62 + contrastScore * 0.26 + specularScore * 0.18);
        const [sourceR, sourceG, sourceB] = boostSaturation(r, g, b, chromaBoost);
        localContrast[pixel] = contrast;
        lumaMask[pixel] = lumaScore;
        contrastMask[pixel] = Math.max(contrastScore, specularScore * 0.72);
        whiteFlatMask[pixel] = whiteFlat;
        skinLikeMask[pixel] = skinColor;
        darkProtect[pixel] = dark;
        protectMask[pixel] = protection;
        sourceMask[pixel] = mask;
        sourceLayer.r[pixel] = sourceR * colorGain;
        sourceLayer.g[pixel] = sourceG * colorGain;
        sourceLayer.b[pixel] = sourceB * colorGain;
      }
      return {
        width,
        height,
        sourceLayer,
        masks: {
          luma,
          localContrast,
          lumaMask,
          contrastMask,
          whiteFlatMask,
          skinLikeMask,
          darkProtect,
          protectMask,
          sourceMask
        },
        debugImages: options.includeDebug === false ? null : {
          luma: createMaskImageData(lumaMask, width, height),
          contrast: createMaskImageData(contrastMask, width, height),
          whiteFlat: createMaskImageData(whiteFlatMask, width, height),
          skinLike: createMaskImageData(skinLikeMask, width, height, [255, 188, 126]),
          darkProtect: createMaskImageData(darkProtect, width, height, [120, 172, 255]),
          sourceMask: createMaskImageData(sourceMask, width, height, [255, 244, 190]),
          protectMask: createMaskImageData(protectMask, width, height, [142, 207, 255])
        }
      };
    }
    modules.glowSourceMask = {
      buildSourceMask,
      createMaskImageData
    };
  })(window);

  // src/webview/glow/pyramid-blur.js
  (function initGlowPyramidBlurModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    function createLayer(width, height) {
      return {
        width,
        height,
        r: new Float32Array(width * height),
        g: new Float32Array(width * height),
        b: new Float32Array(width * height)
      };
    }
    function downsampleLayer(layer) {
      const nextWidth = Math.max(1, Math.floor(layer.width / 2));
      const nextHeight = Math.max(1, Math.floor(layer.height / 2));
      const out = createLayer(nextWidth, nextHeight);
      for (let y = 0; y < nextHeight; y += 1) {
        for (let x = 0; x < nextWidth; x += 1) {
          const sx = x * 2;
          const sy = y * 2;
          const target = y * nextWidth + x;
          let r = 0;
          let g = 0;
          let b = 0;
          let weightTotal = 0;
          for (let oy = -1; oy <= 2; oy += 1) {
            const yy = Math.min(layer.height - 1, Math.max(0, sy + oy));
            const wy = oy === 0 || oy === 1 ? 3 : 1;
            for (let ox = -1; ox <= 2; ox += 1) {
              const xx = Math.min(layer.width - 1, Math.max(0, sx + ox));
              const wx = ox === 0 || ox === 1 ? 3 : 1;
              const weight = wx * wy;
              const source = yy * layer.width + xx;
              r += layer.r[source] * weight;
              g += layer.g[source] * weight;
              b += layer.b[source] * weight;
              weightTotal += weight;
            }
          }
          out.r[target] = r / weightTotal;
          out.g[target] = g / weightTotal;
          out.b[target] = b / weightTotal;
        }
      }
      return out;
    }
    function blurChannelHorizontal(src, width, height, radius) {
      const out = new Float32Array(src.length);
      const size = radius * 2 + 1;
      for (let y = 0; y < height; y += 1) {
        const row = y * width;
        let sum = 0;
        for (let x = -radius; x <= radius; x += 1) {
          sum += src[row + Math.min(width - 1, Math.max(0, x))];
        }
        for (let x = 0; x < width; x += 1) {
          out[row + x] = sum / size;
          const removeX = Math.max(0, x - radius);
          const addX = Math.min(width - 1, x + radius + 1);
          sum += src[row + addX] - src[row + removeX];
        }
      }
      return out;
    }
    function blurChannelVertical(src, width, height, radius) {
      const out = new Float32Array(src.length);
      const size = radius * 2 + 1;
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let y = -radius; y <= radius; y += 1) {
          sum += src[Math.min(height - 1, Math.max(0, y)) * width + x];
        }
        for (let y = 0; y < height; y += 1) {
          out[y * width + x] = sum / size;
          const removeY = Math.max(0, y - radius);
          const addY = Math.min(height - 1, y + radius + 1);
          sum += src[addY * width + x] - src[removeY * width + x];
        }
      }
      return out;
    }
    function boxBlurLayer(layer, radius, passes = 1) {
      const blurRadius = Math.max(1, Math.floor(radius));
      let r = layer.r;
      let g = layer.g;
      let b = layer.b;
      for (let pass = 0; pass < passes; pass += 1) {
        r = blurChannelVertical(blurChannelHorizontal(r, layer.width, layer.height, blurRadius), layer.width, layer.height, blurRadius);
        g = blurChannelVertical(blurChannelHorizontal(g, layer.width, layer.height, blurRadius), layer.width, layer.height, blurRadius);
        b = blurChannelVertical(blurChannelHorizontal(b, layer.width, layer.height, blurRadius), layer.width, layer.height, blurRadius);
      }
      return { width: layer.width, height: layer.height, r, g, b };
    }
    function addUpsampled(target, source, weight) {
      const xScale = source.width / target.width;
      const yScale = source.height / target.height;
      for (let y = 0; y < target.height; y += 1) {
        const sy = Math.min(source.height - 1, Math.max(0, (y + 0.5) * yScale - 0.5));
        const y0 = Math.floor(sy);
        const y1 = Math.min(source.height - 1, y0 + 1);
        const ty = sy - y0;
        for (let x = 0; x < target.width; x += 1) {
          const sx = Math.min(source.width - 1, Math.max(0, (x + 0.5) * xScale - 0.5));
          const x0 = Math.floor(sx);
          const x1 = Math.min(source.width - 1, x0 + 1);
          const tx = sx - x0;
          const a = y0 * source.width + x0;
          const b = y0 * source.width + x1;
          const c = y1 * source.width + x0;
          const d = y1 * source.width + x1;
          const targetIndex = y * target.width + x;
          const wa = (1 - tx) * (1 - ty);
          const wb = tx * (1 - ty);
          const wc = (1 - tx) * ty;
          const wd = tx * ty;
          target.r[targetIndex] += (source.r[a] * wa + source.r[b] * wb + source.r[c] * wc + source.r[d] * wd) * weight;
          target.g[targetIndex] += (source.g[a] * wa + source.g[b] * wb + source.g[c] * wc + source.g[d] * wd) * weight;
          target.b[targetIndex] += (source.b[a] * wa + source.b[b] * wb + source.b[c] * wc + source.b[d] * wd) * weight;
        }
      }
    }
    function buildMultiScaleGlow(sourceLayer, params) {
      const level1 = downsampleLayer(sourceLayer);
      const level2 = downsampleLayer(level1);
      const level3 = downsampleLayer(level2);
      const small = boxBlurLayer(sourceLayer, params.blur.smallRadius, 1);
      const medium = boxBlurLayer(level1, params.blur.mediumRadius, params.blur.passes);
      const large = boxBlurLayer(level2.width > 1 && level2.height > 1 ? level2 : level3, params.blur.largeRadius, 2);
      const out = createLayer(sourceLayer.width, sourceLayer.height);
      addUpsampled(out, small, params.blur.smallWeight);
      addUpsampled(out, medium, params.blur.mediumWeight);
      addUpsampled(out, large, params.blur.largeWeight);
      return { glowLayer: out, levels: { small, medium, large } };
    }
    modules.glowPyramidBlur = {
      createLayer,
      buildMultiScaleGlow
    };
  })(window);

  // src/webview/glow/compositor.js
  (function initGlowCompositorModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }
    function applySaturation(r, g, b, saturation) {
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      return [
        luma + (r - luma) * saturation,
        luma + (g - luma) * saturation,
        luma + (b - luma) * saturation
      ];
    }
    function softShoulder(value, shoulder) {
      const safeShoulder = clamp(shoulder, 0.1, 0.95);
      return value / (1 + value * safeShoulder);
    }
    function composeProtected(baseImageData, glowLayer, masks, params) {
      const { width, height, data } = baseImageData;
      const out = new ImageData(width, height);
      for (let pixel = 0, index = 0; pixel < glowLayer.r.length; pixel += 1, index += 4) {
        const baseR = data[index] / 255;
        const baseG = data[index + 1] / 255;
        const baseB = data[index + 2] / 255;
        const baseLuma = masks.luma[pixel];
        const source = masks.sourceMask[pixel];
        const protect = masks.protectMask[pixel];
        const darkProtect = masks.darkProtect[pixel];
        const highlightProtect = protect * params.composite.highlightProtect * (0.45 + baseLuma * 0.72);
        const shadowProtect = darkProtect * params.composite.shadowProtect;
        const sourceAnchor = 0.62 + source * 0.38;
        const protectGain = clamp((1 - highlightProtect * 0.72) * (1 - shadowProtect * 0.82) * sourceAnchor, 0, 1);
        const warmedR = glowLayer.r[pixel] * (1 + params.composite.warmth);
        const warmedG = glowLayer.g[pixel] * (1 + params.composite.warmth * 0.35);
        const warmedB = glowLayer.b[pixel] * (1 - params.composite.warmth * 0.28);
        const [satR, satG, satB] = applySaturation(warmedR, warmedG, warmedB, params.composite.saturation);
        const glowR = clamp(softShoulder(Math.max(0, satR) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);
        const glowG = clamp(softShoulder(Math.max(0, satG) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);
        const glowB = clamp(softShoulder(Math.max(0, satB) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);
        const screenR = 1 - (1 - baseR) * (1 - glowR);
        const screenG = 1 - (1 - baseG) * (1 - glowG);
        const screenB = 1 - (1 - baseB) * (1 - glowB);
        const softR = clamp(baseR + glowR * (1 - baseR * (0.58 + protect * 0.34)), 0, 1);
        const softG = clamp(baseG + glowG * (1 - baseG * (0.58 + protect * 0.34)), 0, 1);
        const softB = clamp(baseB + glowB * (1 - baseB * (0.58 + protect * 0.34)), 0, 1);
        const mix = params.composite.softAddMix;
        const colorProtect = clamp(1 - Math.max(glowR, glowG, glowB) * params.composite.colorProtect, 0.84, 1);
        const resultR = (screenR * (1 - mix) + softR * mix) * colorProtect + baseR * (1 - colorProtect);
        const resultG = (screenG * (1 - mix) + softG * mix) * colorProtect + baseG * (1 - colorProtect);
        const resultB = (screenB * (1 - mix) + softB * mix) * colorProtect + baseB * (1 - colorProtect);
        out.data[index] = Math.round(clamp(resultR, 0, 1) * 255);
        out.data[index + 1] = Math.round(clamp(resultG, 0, 1) * 255);
        out.data[index + 2] = Math.round(clamp(resultB, 0, 1) * 255);
        out.data[index + 3] = data[index + 3];
      }
      return out;
    }
    modules.glowCompositor = {
      composeProtected
    };
  })(window);

  // src/webview/glow/preview-engine.js
  (function initGlowPreviewEngineModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    function createCanvas(width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(width));
      canvas.height = Math.max(1, Math.floor(height));
      return canvas;
    }
    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Failed to load glow source image"));
        image.src = src;
      });
    }
    function getImageDataFromImage(image) {
      const canvas = createCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas 2D is unavailable for Glow Lab");
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return {
        width: canvas.width,
        height: canvas.height,
        imageData: ctx.getImageData(0, 0, canvas.width, canvas.height)
      };
    }
    function imageDataToDataUrl(imageData, type = "image/png", quality = 0.9) {
      const canvas = createCanvas(imageData.width, imageData.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D is unavailable for Glow Lab output");
      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL(type, quality);
    }
    async function createPreview(sourceDataUrl, config = {}, options = {}) {
      if (!sourceDataUrl) throw new Error("Glow source image is missing");
      const jobId = Number(options.jobId) || 0;
      const startedAt = performance.now();
      const image = await loadImage(sourceDataUrl);
      const source = getImageDataFromImage(image);
      const params = modules.glowPresets.normalizeGlowParams(config);
      const sourceStartedAt = performance.now();
      const includeDebug = options.includeDebug !== false;
      const sourceResult = modules.glowSourceMask.buildSourceMask(source.imageData, params, { includeDebug });
      const sourceMs = performance.now() - sourceStartedAt;
      const blurStartedAt = performance.now();
      const blurResult = modules.glowPyramidBlur.buildMultiScaleGlow(sourceResult.sourceLayer, params);
      const blurMs = performance.now() - blurStartedAt;
      const compositeStartedAt = performance.now();
      const previewImageData = modules.glowCompositor.composeProtected(
        source.imageData,
        blurResult.glowLayer,
        sourceResult.masks,
        params
      );
      const compositeMs = performance.now() - compositeStartedAt;
      return {
        ok: true,
        jobId,
        width: source.width,
        height: source.height,
        baseDataUrl: sourceDataUrl,
        previewDataUrl: imageDataToDataUrl(previewImageData, "image/jpeg", 0.9),
        sourceMaskDataUrl: sourceResult.debugImages ? imageDataToDataUrl(sourceResult.debugImages.sourceMask) : "",
        protectMaskDataUrl: sourceResult.debugImages ? imageDataToDataUrl(sourceResult.debugImages.protectMask) : "",
        debugDataUrls: sourceResult.debugImages ? {
          luma: imageDataToDataUrl(sourceResult.debugImages.luma),
          contrast: imageDataToDataUrl(sourceResult.debugImages.contrast),
          whiteFlat: imageDataToDataUrl(sourceResult.debugImages.whiteFlat),
          skinLike: imageDataToDataUrl(sourceResult.debugImages.skinLike),
          darkProtect: imageDataToDataUrl(sourceResult.debugImages.darkProtect)
        } : {},
        timings: {
          sourceMs: Math.round(sourceMs),
          blurMs: Math.round(blurMs),
          compositeMs: Math.round(compositeMs),
          totalMs: Math.round(performance.now() - startedAt)
        },
        params
      };
    }
    modules.glowPreviewEngine = {
      createPreview
    };
  })(window);

  // src/webview/glow-cpu.js
  (function initGlowCpuCompatModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    async function createGlowPng(sourceDataUrl, config = {}) {
      if (!modules.glowPreviewEngine || typeof modules.glowPreviewEngine.createPreview !== "function") {
        throw new Error("Glow preview engine is unavailable");
      }
      const result = await modules.glowPreviewEngine.createPreview(sourceDataUrl, config);
      return {
        dataUrl: result.previewDataUrl,
        previewDataUrl: result.previewDataUrl,
        baseDataUrl: result.baseDataUrl,
        sourceMaskDataUrl: result.sourceMaskDataUrl,
        protectMaskDataUrl: result.protectMaskDataUrl,
        debugDataUrls: result.debugDataUrls,
        timings: result.timings,
        width: result.width,
        height: result.height,
        elapsedMs: result.timings ? result.timings.totalMs : 0,
        layerMode: "webview-preview-only"
      };
    }
    modules.glowCpu = {
      createGlowPng
    };
  })(window);

  // src/webview/ui.js
  (function initUiModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    const DONATION_LINKS = {
      wx: "wxp://f2f0xp-V9KpvqacwxxGZ3zXDCGI_z11NO-xT2ukCb4JHZyI",
      zfb: "https://qr.alipay.com/fkx12142r0sdwj4kizujk2f",
      runninghub: "https://www.runninghub.cn",
      tutorial: "./pages/runninghub-guide.html"
    };
    const GLOW_DEFAULTS = {
      style: "darkSoft",
      strength: 40,
      radius: 20,
      threshold: 20,
      saturation: 0,
      brightnessBias: 0
    };
    const GLOW_PREVIEW_LAYER_NAME = "PixelRunner Glow Preview";
    const GLOW_STYLE_LABELS = {
      none: "无",
      darksoft: "黑柔",
      darkSoft: "黑柔",
      whitesoft: "白柔",
      whiteSoft: "白柔",
      shine: "辉光",
      natural: "黑柔",
      soft: "白柔",
      dreamy: "辉光"
    };
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
      document.querySelectorAll(".ghost-btn, .mini-btn, .secondary-btn, .primary-btn, .nav-tab, .donation-card").forEach((element) => {
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
      const clearButton = runtime.getById("btnClearLog");
      const donateButtons = ["btnDonate", "btnDonateTools", "btnDonateSettings"].map((id) => runtime.getById(id)).filter(Boolean);
      const donationModalClose = runtime.getById("donationModalClose");
      const donationStatusHint = runtime.getById("donationStatusHint");
      const donationCards = ["donationWxCard", "donationZfbCard"].map((id) => runtime.getById(id)).filter(Boolean);
      const btnOpenRunningHubSite = runtime.getById("btnOpenRunningHubSite");
      const btnOpenTutorialSite = runtime.getById("btnOpenTutorialSite");
      const setDonationStatus = (message, type = "info") => {
        runtime.setSummaryStatus(donationStatusHint, message, type);
      };
      const openDonationModal = () => {
        modules.workspace.setModalOpen("donationModal", true);
        setDonationStatus("二维码已就绪，可点击二维码尝试打开链接。", "info");
      };
      const closeDonationModal = () => {
        modules.workspace.setModalOpen("donationModal", false);
      };
      const openLinkInPreview = (url, label) => {
        try {
          global.open(String(url || "").trim(), "_blank", "noopener");
          setDonationStatus(`已尝试打开 ${label}。`, "success");
        } catch (_) {
          setDonationStatus(`打开 ${label} 失败，请直接扫码或手动访问。`, "error");
        }
      };
      const openExternalLink = async (url, label, developerText) => {
        const target = String(url || "").trim();
        if (!target) return;
        if (!runtime.isPluginRuntime()) {
          openLinkInPreview(target, label);
          return;
        }
        try {
          const result = await runtime.callHost("shell.openExternal", [target, developerText], { timeoutMs: 15e3 });
          if (result && result.ok) {
            setDonationStatus(`已打开 ${label}。`, "success");
            return;
          }
          setDonationStatus(`打开 ${label} 失败，请直接扫码或手动访问。`, "error");
        } catch (error) {
          setDonationStatus(`打开 ${label} 失败：${error.message}`, "error");
        }
      };
      const openTutorialPage = async () => {
        if (!runtime.isPluginRuntime()) {
          openLinkInPreview(DONATION_LINKS.tutorial, "教程页面");
          return;
        }
        try {
          const resolved = await runtime.callHost("shell.resolveTutorialPath", [], { timeoutMs: 15e3 });
          const tutorialPath = String(resolved && resolved.path || "").trim();
          const tutorialUrl = String(resolved && resolved.url || "").trim();
          if (!tutorialPath && !tutorialUrl) {
            setDonationStatus("无法定位本地教程文件，请检查 pages/runninghub-guide.html。", "error");
            return;
          }
          const opened = tutorialUrl ? await runtime.callHost(
            "shell.openExternal",
            [tutorialUrl, "将使用系统默认浏览器打开本地教程页面。"],
            { timeoutMs: 15e3 }
          ) : await runtime.callHost(
            "shell.openPath",
            [tutorialPath, "将使用系统默认浏览器打开本地教程页面。"],
            { timeoutMs: 15e3 }
          );
          if (opened && opened.ok) {
            setDonationStatus("已打开教程页面。", "success");
            return;
          }
          setDonationStatus("打开教程失败，请检查系统默认浏览器设置。", "error");
        } catch (error) {
          setDonationStatus(`打开教程失败：${error.message}`, "error");
        }
      };
      donateButtons.forEach((button) => {
        button.addEventListener("click", openDonationModal);
      });
      if (donationModalClose) donationModalClose.addEventListener("click", closeDonationModal);
      document.addEventListener("click", (event) => {
        if (event.target && event.target.closest("#donationBackdrop")) closeDonationModal();
      });
      donationCards.forEach((card) => {
        card.addEventListener("click", () => {
          const label = card.id === "donationWxCard" ? "微信赞助链接" : "支付宝赞助链接";
          void openExternalLink(card.getAttribute("data-donation-url"), label, `将尝试打开 ${label}。`);
        });
      });
      if (btnOpenRunningHubSite) {
        btnOpenRunningHubSite.addEventListener("click", () => {
          void openExternalLink(DONATION_LINKS.runninghub, "RunningHub", "将使用系统默认浏览器打开 RunningHub 官网。");
        });
      }
      if (btnOpenTutorialSite) {
        btnOpenTutorialSite.addEventListener("click", () => {
          void openTutorialPage();
        });
      }
      if (clearButton && logWindow) {
        clearButton.addEventListener("click", () => {
          logWindow.value = "[系统] 日志已清空，等待新的操作记录。";
        });
      }
    }
    function bindToolActions() {
      const runtime = modules.runtime;
      const glowStyleInput = runtime.getById("glowStyleInput");
      const glowStrengthInput = runtime.getById("glowStrengthInput");
      const glowRadiusInput = runtime.getById("glowRadiusInput");
      const glowThresholdInput = runtime.getById("glowThresholdInput");
      const glowBrightnessBiasInput = runtime.getById("glowBrightnessBiasInput");
      const glowStrengthValue = runtime.getById("glowStrengthValue");
      const glowStrengthParamValue = runtime.getById("glowStrengthParamValue");
      const glowRadiusParamValue = runtime.getById("glowRadiusParamValue");
      const glowThresholdParamValue = runtime.getById("glowThresholdParamValue");
      const glowExposureParamValue = runtime.getById("glowExposureParamValue");
      const glowStyleBadge = runtime.getById("glowStyleBadge");
      const glowRadiusValue = runtime.getById("glowRadiusValue");
      const glowThresholdValue = runtime.getById("glowThresholdValue");
      const glowPreviewState = runtime.getById("glowPreviewState");
      const glowHint = runtime.getById("glowHint");
      const glowQuickHint = runtime.getById("glowQuickHint");
      const glowOpenButton = runtime.getById("btnOpenGlowPanel");
      const glowApplyButton = runtime.getById("btnGlowPreviewApply");
      const glowCancelButton = runtime.getById("btnGlowPreviewCancel");
      const glowModalClose = runtime.getById("glowModalClose");
      const glowInlinePreview = runtime.getById("glowInlinePreview");
      const glowPreviewBaseImage = runtime.getById("glowPreviewBaseImage");
      const glowPreviewResultImage = runtime.getById("glowPreviewResultImage");
      const glowPreviewSourceMaskImage = runtime.getById("glowPreviewSourceMaskImage");
      const glowPreviewProtectMaskImage = runtime.getById("glowPreviewProtectMaskImage");
      const glowDebugPanel = document.querySelector(".glow-debug-panel");
      const glowPreviewLumaImage = runtime.getById("glowPreviewLumaImage");
      const glowPreviewContrastImage = runtime.getById("glowPreviewContrastImage");
      const glowPreviewWhiteFlatImage = runtime.getById("glowPreviewWhiteFlatImage");
      const glowPreviewSkinLikeImage = runtime.getById("glowPreviewSkinLikeImage");
      const glowPreviewDarkProtectImage = runtime.getById("glowPreviewDarkProtectImage");
      const glowPreviewMeta = runtime.getById("glowPreviewMeta");
      let glowPreviewTimer = 0;
      let glowPreviewInFlight = false;
      let glowPreviewNeedsReplay = false;
      let glowPreviewOpen = false;
      let glowLastPreviewSignature = "";
      let glowCpuSourceAsset = null;
      let glowPreviewJobId = 0;
      const readGlowSlider = (input, fallback, min, max) => {
        if (!input) return fallback;
        const parsed = Number(input.value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(min, Math.min(max, Math.round(parsed)));
      };
      const readGlowStyle = () => {
        const nextStyle = String(glowStyleInput && glowStyleInput.value || GLOW_DEFAULTS.style).trim();
        return GLOW_STYLE_LABELS[nextStyle] ? nextStyle : GLOW_DEFAULTS.style;
      };
      const getGlowStyleLabel = (style) => GLOW_STYLE_LABELS[String(style || "").trim().toLowerCase()] || GLOW_STYLE_LABELS[GLOW_DEFAULTS.style];
      const readGlowState = () => ({
        style: readGlowStyle(),
        strength: readGlowSlider(glowStrengthInput, GLOW_DEFAULTS.strength, 0, 100),
        radius: readGlowSlider(glowRadiusInput, GLOW_DEFAULTS.radius, 1, 120),
        threshold: readGlowSlider(glowThresholdInput, GLOW_DEFAULTS.threshold, 0, 100),
        saturation: 0,
        brightnessBias: readGlowSlider(glowBrightnessBiasInput, GLOW_DEFAULTS.brightnessBias, -50, 50)
      });
      const setGlowButtonsDisabled = (disabled) => {
        [glowOpenButton, glowApplyButton, glowCancelButton, glowModalClose].filter(Boolean).forEach((button) => {
          button.disabled = disabled;
        });
      };
      const setGlowStatus = (message, type = "info") => {
        if (glowHint) runtime.setSummaryStatus(glowHint, message, type);
      };
      const setQuickGlowStatus = (message, type = "info") => {
        if (glowQuickHint) runtime.setSummaryStatus(glowQuickHint, message, type);
      };
      const setGlowPreviewBadge = (message, type = "info") => {
        if (!glowPreviewState) return;
        glowPreviewState.textContent = message;
        glowPreviewState.dataset.status = type;
      };
      const updateGlowLabels = () => {
        const state = readGlowState();
        if (glowStrengthValue) glowStrengthValue.textContent = `${getGlowStyleLabel(state.style)} ${state.strength}%`;
        if (glowStyleBadge) glowStyleBadge.textContent = `风格 ${getGlowStyleLabel(state.style)}`;
        if (glowRadiusValue) glowRadiusValue.textContent = `半径 ${state.radius}`;
        if (glowThresholdValue) glowThresholdValue.textContent = `阈值 ${(state.threshold / 100).toFixed(2)}`;
        if (glowStrengthParamValue) glowStrengthParamValue.textContent = String(state.strength);
        if (glowRadiusParamValue) glowRadiusParamValue.textContent = String(state.radius);
        if (glowThresholdParamValue) glowThresholdParamValue.textContent = (state.threshold / 100).toFixed(2);
        if (glowExposureParamValue) glowExposureParamValue.textContent = String(state.brightnessBias);
      };
      const captureGlowCpuSource = async (maxDimension) => {
        const captured = await runtime.callHost("photoshop.captureDocumentPreview", [{
          maxDimension,
          quality: 92,
          uploadTargetBytes: 9e6,
          uploadHardLimitBytes: 1e7
        }], { timeoutMs: 45e3 });
        if (!captured || !String(captured.dataUrl || "").trim()) {
          throw new Error("未能捕获当前 Photoshop 图像用于 CPU 辉光。");
        }
        return captured;
      };
      const clearGlowPreviewLayer = async () => {
        try {
          await runtime.callHost("photoshop.runToolAction", [{ action: "glowPreviewCancel" }], { timeoutMs: 3e4 });
        } catch (_) {
        }
      };
      const clearInlineGlowPreview = () => {
        if (glowInlinePreview) glowInlinePreview.hidden = true;
        [
          glowPreviewBaseImage,
          glowPreviewResultImage,
          glowPreviewSourceMaskImage,
          glowPreviewProtectMaskImage,
          glowPreviewLumaImage,
          glowPreviewContrastImage,
          glowPreviewWhiteFlatImage,
          glowPreviewSkinLikeImage,
          glowPreviewDarkProtectImage
        ].filter(Boolean).forEach((image) => image.removeAttribute("src"));
        if (glowPreviewMeta) glowPreviewMeta.textContent = "Glow Lab 等待捕获图像";
      };
      const updateInlineGlowPreview = (asset, glowResult) => {
        if (!asset || !glowResult) return;
        const sourceDataUrl = String(asset.dataUrl || "").trim();
        if (glowPreviewBaseImage) glowPreviewBaseImage.src = String(glowResult.baseDataUrl || "").trim() || sourceDataUrl;
        if (glowPreviewResultImage) glowPreviewResultImage.src = String(glowResult.previewDataUrl || "").trim() || sourceDataUrl;
        if (glowPreviewSourceMaskImage) glowPreviewSourceMaskImage.src = String(glowResult.sourceMaskDataUrl || "").trim();
        if (glowPreviewProtectMaskImage) glowPreviewProtectMaskImage.src = String(glowResult.protectMaskDataUrl || "").trim();
        if (glowPreviewLumaImage) glowPreviewLumaImage.src = String(glowResult.debugDataUrls && glowResult.debugDataUrls.luma || "").trim();
        if (glowPreviewContrastImage) glowPreviewContrastImage.src = String(glowResult.debugDataUrls && glowResult.debugDataUrls.contrast || "").trim();
        if (glowPreviewWhiteFlatImage) glowPreviewWhiteFlatImage.src = String(glowResult.debugDataUrls && glowResult.debugDataUrls.whiteFlat || "").trim();
        if (glowPreviewSkinLikeImage) glowPreviewSkinLikeImage.src = String(glowResult.debugDataUrls && glowResult.debugDataUrls.skinLike || "").trim();
        if (glowPreviewDarkProtectImage) glowPreviewDarkProtectImage.src = String(glowResult.debugDataUrls && glowResult.debugDataUrls.darkProtect || "").trim();
        if (glowInlinePreview) glowInlinePreview.hidden = false;
        if (glowPreviewMeta) {
          const state = readGlowState();
          const timings = glowResult.timings || {};
          glowPreviewMeta.textContent = `预览 · ${glowResult.width}x${glowResult.height} · total ${timings.totalMs || glowResult.elapsedMs || 0}ms · source ${timings.sourceMs || 0}ms / blur ${timings.blurMs || 0}ms / composite ${timings.compositeMs || 0}ms · 强度 ${state.strength} / 半径 ${state.radius} / 阈值 ${(state.threshold / 100).toFixed(2)} / 曝光 ${state.brightnessBias}`;
        }
      };
      const callGlowCpuPreviewAction = async (action) => {
        const state = readGlowState();
        if (action === "glowPreviewStart" || !glowCpuSourceAsset) {
          glowCpuSourceAsset = await captureGlowCpuSource(320);
        }
        const sourceDataUrl = String(glowCpuSourceAsset.dataUrl || "").trim();
        const jobId = glowPreviewJobId + 1;
        glowPreviewJobId = jobId;
        const glowResult = await modules.glowPreviewEngine.createPreview(sourceDataUrl, state, {
          jobId,
          includeDebug: Boolean(glowDebugPanel && glowDebugPanel.open)
        });
        if (Number(glowResult.jobId) !== Number(glowPreviewJobId)) {
          return {
            ok: false,
            stale: true,
            message: "已丢弃过期辉光预览结果。"
          };
        }
        updateInlineGlowPreview(glowCpuSourceAsset, glowResult);
        const timings = glowResult.timings || {};
        return {
          ok: true,
          message: `Glow Lab 已更新：${glowResult.width}x${glowResult.height}，source ${timings.sourceMs || 0}ms / blur ${timings.blurMs || 0}ms / composite ${timings.compositeMs || 0}ms / total ${timings.totalMs || 0}ms。`,
          layerName: GLOW_PREVIEW_LAYER_NAME,
          elapsedMs: timings.totalMs || 0
        };
      };
      const commitGlowCpuResult = async () => {
        const state = readGlowState();
        const layerName = `Glow ${state.strength}%`;
        const commitStrength = state.style === "none" ? 0 : state.strength;
        const result = await runtime.callHost("photoshop.runToolAction", [{
          action: "glowPreviewCommit",
          style: state.style,
          strength: commitStrength,
          radius: state.radius,
          threshold: state.threshold,
          saturation: state.saturation,
          brightnessBias: state.brightnessBias,
          layerName
        }], { timeoutMs: 12e4 });
        glowCpuSourceAsset = null;
        return {
          ok: true,
          message: result && result.message ? result.message : `已按 Photoshop 原生管线生成 ${layerName}。`,
          layerName: result && result.layerName ? result.layerName : layerName
        };
      };
      const getGlowStateSignature = () => {
        const state = readGlowState();
        return [state.style, state.strength, state.radius, state.threshold, state.brightnessBias].join("|");
      };
      const getGlowPreviewDelay = () => {
        const state = readGlowState();
        let delay = 220;
        if (state.radius >= 72) delay = 280;
        if (state.radius >= 92 || state.strength >= 76) delay = 340;
        if (state.brightnessBias >= 32) delay += 20;
        if (state.style === "shine") delay += 20;
        return delay;
      };
      const runGlowPreviewUpdate = async (action = "glowPreviewUpdate") => {
        if (!glowPreviewOpen || !runtime.isPluginRuntime()) return;
        const nextSignature = getGlowStateSignature();
        if (action === "glowPreviewUpdate" && nextSignature === glowLastPreviewSignature && !glowPreviewNeedsReplay) {
          return;
        }
        if (glowPreviewInFlight) {
          glowPreviewNeedsReplay = true;
          glowPreviewJobId += 1;
          return;
        }
        glowPreviewInFlight = true;
        glowPreviewNeedsReplay = false;
        const state = readGlowState();
        setGlowPreviewBadge("正在预览", "pending");
        setGlowStatus(`正在更新辉光预览：${getGlowStyleLabel(state.style)} / 强度 ${state.strength}% / 半径 ${state.radius} / 阈值 ${state.threshold}%`, "pending");
        try {
          const result = await callGlowCpuPreviewAction(action);
          if (result && result.stale) return;
          const message = result && result.message ? result.message : "辉光预览已更新。";
          glowLastPreviewSignature = nextSignature;
          setGlowPreviewBadge("Glow Lab", "success");
          setGlowStatus(message, "success");
        } catch (error) {
          const message = `辉光预览失败：${error.message}`;
          setGlowPreviewBadge("预览失败", "error");
          setGlowStatus(message, "error");
          logToWorkspace(message, "error");
        } finally {
          glowPreviewInFlight = false;
        }
        if (glowPreviewNeedsReplay && glowPreviewOpen) {
          glowPreviewNeedsReplay = false;
          void runGlowPreviewUpdate("glowPreviewUpdate");
        }
      };
      const scheduleGlowPreviewUpdate = () => {
        if (!glowPreviewOpen || !runtime.isPluginRuntime()) return;
        if (glowPreviewTimer) clearTimeout(glowPreviewTimer);
        glowPreviewJobId += 1;
        const delay = getGlowPreviewDelay();
        glowPreviewTimer = window.setTimeout(() => {
          glowPreviewTimer = 0;
          void runGlowPreviewUpdate("glowPreviewUpdate");
        }, delay);
      };
      const flushGlowPreviewUpdate = async () => {
        if (!glowPreviewOpen || !runtime.isPluginRuntime()) return;
        if (glowPreviewTimer) {
          clearTimeout(glowPreviewTimer);
          glowPreviewTimer = 0;
        }
        if (glowPreviewInFlight) {
          glowPreviewNeedsReplay = true;
        }
        while (glowPreviewInFlight || glowPreviewNeedsReplay) {
          if (!glowPreviewInFlight && glowPreviewNeedsReplay) {
            glowPreviewNeedsReplay = false;
            await runGlowPreviewUpdate("glowPreviewUpdate");
          } else {
            await new Promise((resolve) => window.setTimeout(resolve, 80));
          }
        }
        await runGlowPreviewUpdate("glowPreviewUpdate");
      };
      const openGlowModal = async () => {
        glowPreviewOpen = true;
        glowLastPreviewSignature = "";
        glowPreviewJobId += 1;
        modules.workspace.setModalOpen("glowModal", true);
        updateGlowLabels();
        if (!runtime.isPluginRuntime()) {
          setGlowPreviewBadge("浏览器预览", "warn");
          setGlowStatus("浏览器预览模式下不会真正生成 Photoshop 预览层。", "warn");
          setQuickGlowStatus("浏览器预览模式下可查看 UI，但不会执行实际辉光。", "warn");
          return;
        }
        setGlowButtonsDisabled(true);
        try {
          await runGlowPreviewUpdate("glowPreviewStart");
          setQuickGlowStatus(`辉光面板已打开，当前风格为 ${getGlowStyleLabel(readGlowState().style)}。`, "success");
        } finally {
          setGlowButtonsDisabled(false);
        }
      };
      const closeGlowModal = async (discardPreview = true) => {
        glowPreviewOpen = false;
        glowLastPreviewSignature = "";
        glowCpuSourceAsset = null;
        glowPreviewJobId += 1;
        clearInlineGlowPreview();
        if (glowPreviewTimer) {
          clearTimeout(glowPreviewTimer);
          glowPreviewTimer = 0;
        }
        if (discardPreview) {
          setQuickGlowStatus("已取消插件内辉光预览，未写回 Photoshop。", "info");
        }
        modules.workspace.setModalOpen("glowModal", false);
      };
      updateGlowLabels();
      [glowStyleInput, glowStrengthInput, glowRadiusInput, glowThresholdInput, glowBrightnessBiasInput].filter(Boolean).forEach((input) => {
        input.addEventListener("input", () => {
          updateGlowLabels();
          scheduleGlowPreviewUpdate();
        });
        input.addEventListener("change", () => {
          updateGlowLabels();
          scheduleGlowPreviewUpdate();
        });
      });
      if (glowOpenButton) {
        glowOpenButton.addEventListener("click", () => {
          void openGlowModal();
        });
      }
      if (glowApplyButton) {
        glowApplyButton.addEventListener("click", async () => {
          const state = readGlowState();
          if (!runtime.isPluginRuntime()) {
            setGlowStatus("浏览器预览模式下不会把辉光应用到 Photoshop。", "warn");
            await closeGlowModal(false);
            return;
          }
          setGlowButtonsDisabled(true);
          try {
            await flushGlowPreviewUpdate();
            const result = await commitGlowCpuResult();
            const successMessage = result && result.message ? result.message : `已生成 Glow ${state.strength}%`;
            logToWorkspace(successMessage, "success");
            setGlowStatus(successMessage, "success");
            setQuickGlowStatus(`${getGlowStyleLabel(state.style)} / 强度 ${state.strength}% / 半径 ${state.radius} / 阈值 ${state.threshold}%`, "success");
            glowPreviewOpen = false;
            modules.workspace.setModalOpen("glowModal", false);
          } catch (error) {
            const message = `应用辉光失败：${error.message}`;
            logToWorkspace(message, "error");
            setGlowStatus(message, "error");
          } finally {
            setGlowButtonsDisabled(false);
          }
        });
      }
      if (glowCancelButton) {
        glowCancelButton.addEventListener("click", () => {
          void closeGlowModal(true);
        });
      }
      if (glowModalClose) {
        glowModalClose.addEventListener("click", () => {
          void closeGlowModal(true);
        });
      }
      if (glowDebugPanel) {
        glowDebugPanel.addEventListener("toggle", () => {
          if (glowDebugPanel.open) {
            glowLastPreviewSignature = "";
            scheduleGlowPreviewUpdate();
          }
        });
      }
      document.addEventListener("click", (event) => {
        if (event.target && event.target.closest("#glowBackdrop")) {
          void closeGlowModal(true);
        }
      });
      const toolConfigs = [
        { id: "btnObserver", payload: { action: "observerLayer", layerName: "黑白观察层" }, pending: "正在创建黑白观察层...", success: (result) => result && result.message ? result.message : "已创建黑白观察层" },
        { id: "btnNeutralGray", payload: { action: "neutralGrayLayer" }, pending: "正在创建中性灰图层...", success: (result) => result && result.message ? result.message : "已创建中性灰图层" },
        { id: "btnGaussianBlur", payload: { action: "gaussianBlur", radius: 4 }, pending: "正在打开高斯模糊...", success: (result) => result && result.message ? result.message : "已打开高斯模糊" },
        { id: "btnSharpen", payload: { action: "sharpen" }, pending: "正在打开锐化...", success: (result) => result && result.message ? result.message : "已打开锐化" },
        { id: "btnHighPass", payload: { action: "highPass", radius: 2 }, pending: "正在打开高反差保留...", success: (result) => result && result.message ? result.message : "已打开高反差保留" },
        { id: "btnStamp", payload: { action: "stampVisible", layerName: "盖印图层" }, pending: "正在生成盖印图层...", success: (result) => result && result.message ? result.message : "已生成盖印图层" },
        { id: "btnContentAwareFill", payload: { action: "contentAwareFill" }, pending: "正在触发内容识别填充...", success: (result) => result && result.message ? result.message : "已触发内容识别填充" },
        { id: "btnSelectAndMask", payload: { action: "selectAndMask" }, pending: "正在触发选择并遮住...", success: (result) => result && result.message ? result.message : "已触发选择并遮住" }
      ];
      toolConfigs.forEach((config) => {
        const button = runtime.getById(config.id);
        if (!button) return;
        button.addEventListener("click", async () => {
          if (!runtime.isPluginRuntime()) {
            logToWorkspace(`浏览器预览模式下不会执行工具动作：${config.id}`, "info");
            return;
          }
          button.disabled = true;
          logToWorkspace(config.pending, "info");
          try {
            const result = await runtime.callHost("photoshop.runToolAction", [config.payload], { timeoutMs: 45e3 });
            logToWorkspace(config.success(result), "success");
          } catch (error) {
            logToWorkspace(`工具执行失败：${error.message}`, "error");
          } finally {
            button.disabled = false;
          }
        });
      });
    }
    modules.ui = {
      logToWorkspace,
      setActiveView,
      bindTabs,
      bindTactileFeedback,
      bindPlaceholderActions,
      bindToolActions
    };
  })(window);

  // src/webview/sound.js
  (function initSoundModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    const PLAYER_READY = "pixelrunner.sound.ready";
    const PLAYER_PLAYBACK = "pixelrunner.sound.playback";
    const localState = {
      initialized: false,
      enabled: true,
      playerReady: false,
      lastActiveTaskCount: 0,
      queueArmed: false,
      preferenceLoaded: false,
      preferenceVersion: 0
    };
    function getStorageKey() {
      return modules.state && modules.state.STORAGE_KEYS && modules.state.STORAGE_KEYS.SOUND_ENABLED || "pixelrunner.sound_enabled";
    }
    function getToggleButton() {
      return modules.runtime.getById("btnSoundToggle");
    }
    function getPlayerFrame() {
      return modules.runtime.getById("soundPlayerFrame");
    }
    function syncState() {
      if (modules.state && modules.state.state && modules.state.state.sound) {
        modules.state.state.sound.enabled = Boolean(localState.enabled);
        modules.state.state.sound.playerReady = Boolean(localState.playerReady);
      }
    }
    function updateToggleUi() {
      const button = getToggleButton();
      if (!button) return;
      const enabled = Boolean(localState.enabled);
      button.dataset.enabled = enabled ? "true" : "false";
      button.setAttribute("aria-pressed", enabled ? "true" : "false");
      button.title = enabled ? "任务完成提示音已开启" : "任务完成提示音已关闭";
    }
    function postToPlayer(message) {
      const frame = getPlayerFrame();
      if (!frame || !frame.contentWindow) return false;
      try {
        frame.contentWindow.postMessage(message, "*");
        return true;
      } catch (_) {
        return false;
      }
    }
    function syncPlayerConfig() {
      postToPlayer({
        type: "pixelrunner.sound.config",
        enabled: Boolean(localState.enabled)
      });
    }
    async function persistEnabledState() {
      try {
        await modules.runtime.storageSetItem(getStorageKey(), localState.enabled ? "true" : "false");
      } catch (_) {
      }
    }
    async function loadEnabledState() {
      const currentVersion = ++localState.preferenceVersion;
      let enabled = true;
      try {
        const raw = await modules.runtime.storageGetItem(getStorageKey());
        if (raw != null) {
          const marker = String(raw).trim().toLowerCase();
          enabled = !["false", "0", "off", "no"].includes(marker);
        }
      } catch (_) {
      }
      if (currentVersion !== localState.preferenceVersion) return;
      localState.enabled = enabled;
      localState.preferenceLoaded = true;
      syncState();
      updateToggleUi();
      syncPlayerConfig();
    }
    function logSoundMessage(message, type = "info") {
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace(message, type);
      }
    }
    async function playCompletionSound(reason = "queue-empty") {
      if (!localState.enabled) return false;
      const posted = postToPlayer({
        type: "pixelrunner.sound.play",
        reason
      });
      if (posted) return true;
      try {
        const audio = new Audio("./video/提示音.MP3");
        audio.currentTime = 0;
        await audio.play();
        return true;
      } catch (error) {
        logSoundMessage(`提示音播放失败：${error.message || error}`, "warn");
        return false;
      }
    }
    async function toggleEnabled() {
      localState.preferenceVersion += 1;
      localState.preferenceLoaded = true;
      localState.enabled = !localState.enabled;
      syncState();
      updateToggleUi();
      syncPlayerConfig();
      await persistEnabledState();
      if (localState.enabled) {
        await playCompletionSound("toggle-preview");
      }
    }
    function handleQueueState(activeCount) {
      const count = Math.max(0, Number(activeCount) || 0);
      if (count > 0) {
        localState.queueArmed = true;
      } else if (localState.queueArmed && localState.lastActiveTaskCount > 0) {
        localState.queueArmed = false;
        void playCompletionSound("queue-empty");
      }
      localState.lastActiveTaskCount = count;
    }
    function handleWindowMessage(event) {
      const payload = event && event.data;
      if (!payload || typeof payload !== "object") return;
      if (payload.type === PLAYER_READY) {
        localState.playerReady = true;
        syncState();
        syncPlayerConfig();
        return;
      }
      if (payload.type === PLAYER_PLAYBACK && payload.ok === false) {
        logSoundMessage(`提示音播放失败：${payload.message || "未知原因"}`, "warn");
      }
    }
    function bindEvents() {
      const button = getToggleButton();
      if (button && !button.dataset.soundBound) {
        button.dataset.soundBound = "true";
        button.addEventListener("click", () => {
          void toggleEnabled();
        });
      }
      const frame = getPlayerFrame();
      if (frame && !frame.dataset.soundFrameBound) {
        frame.dataset.soundFrameBound = "true";
        frame.addEventListener("load", () => {
          syncPlayerConfig();
        });
      }
      if (!localState.initialized) {
        global.addEventListener("message", handleWindowMessage);
      }
    }
    function initialize() {
      bindEvents();
      syncState();
      updateToggleUi();
      void loadEnabledState();
      localState.initialized = true;
    }
    modules.sound = {
      initialize,
      handleQueueState,
      playCompletionSound,
      updateToggleUi
    };
  })(window);

  // src/webview/quick-entries.js
  (function initQuickEntriesModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    function isImageInput(input) {
      const type = String(input && input.type || "").trim().toLowerCase();
      return type === "image" || type === "file";
    }
    function normalizeImageBindings(bindings, app = null) {
      const explicit = (Array.isArray(bindings) ? bindings : []).filter((item) => item && typeof item === "object").map((item) => ({
        inputKey: String(item.inputKey || item.key || "").trim(),
        source: "selectionRequired"
      })).filter((item) => item.inputKey);
      if (explicit.length > 0) return explicit;
      const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
      const imageInputs = inputs.filter(isImageInput);
      const preferred = imageInputs.find((item) => item.required) || imageInputs[0] || null;
      return preferred && preferred.key ? [{ inputKey: String(preferred.key), source: "selectionRequired" }] : [];
    }
    function clonePlainValue(value) {
      if (value == null) return value;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
      if (Array.isArray(value)) return value.map(clonePlainValue);
      if (value && typeof value === "object") {
        const out = {};
        Object.keys(value).forEach((key) => {
          out[key] = clonePlainValue(value[key]);
        });
        return out;
      }
      return value;
    }
    function normalizeInputValues(values, app = null) {
      const source = values && typeof values === "object" ? values : {};
      const out = {};
      const imageKeys = new Set((Array.isArray(app && app.inputs) ? app.inputs : []).filter(isImageInput).map((item) => String(item.key || "")));
      Object.keys(source).forEach((key) => {
        if (!key || imageKeys.has(key)) return;
        const value = source[key];
        if (value && typeof value === "object") {
          const marker = `${value.dataUrl || ""}${value.base64 || ""}${value.uploadDataUrl || ""}${value.uploadBase64 || ""}`;
          if (marker) return;
        }
        out[key] = clonePlainValue(value);
      });
      return out;
    }
    function normalizeQuickEntryRecord(entry, index = 0) {
      const runtime = modules.runtime;
      const source = entry && typeof entry === "object" ? entry : {};
      const now = Date.now();
      const appRef = source.appRef && typeof source.appRef === "object" ? source.appRef : {};
      const savedAppId = String(appRef.savedAppId || source.savedAppId || "").trim();
      const appId = String(appRef.appId || source.appId || "").trim();
      const appName = String(appRef.appName || source.appName || "未命名应用").trim() || "未命名应用";
      const title = String(source.title || source.name || `快捷入口 ${index + 1}`).trim() || `快捷入口 ${index + 1}`;
      if (!savedAppId && !appId) return null;
      return {
        id: String(source.id || "").trim() || runtime.createId("quick"),
        title,
        appRef: {
          savedAppId,
          appId,
          appName
        },
        inputValues: normalizeInputValues(source.inputValues || source.values || {}),
        imageBindings: normalizeImageBindings(source.imageBindings),
        meta: {
          createdAt: Number(source.meta && source.meta.createdAt) > 0 ? Number(source.meta.createdAt) : Number(source.createdAt) || now,
          updatedAt: Number(source.meta && source.meta.updatedAt) > 0 ? Number(source.meta.updatedAt) : Number(source.updatedAt) || now,
          lastRunAt: Number(source.meta && source.meta.lastRunAt) || 0,
          runCount: Number(source.meta && source.meta.runCount) || 0
        }
      };
    }
    function normalizeQuickEntryList(entries) {
      const seenIds = /* @__PURE__ */ new Set();
      return (Array.isArray(entries) ? entries : []).map((item, index) => normalizeQuickEntryRecord(item, index)).filter((item) => {
        if (!item) return false;
        if (seenIds.has(item.id)) item.id = modules.runtime.createId("quick");
        seenIds.add(item.id);
        return true;
      });
    }
    async function loadQuickEntriesFromStorage() {
      const raw = await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.QUICK_ENTRIES);
      const parsed = modules.runtime.readJsonText(raw, []);
      const list = parsed && typeof parsed === "object" && Array.isArray(parsed.entries) ? parsed.entries : parsed;
      return normalizeQuickEntryList(list);
    }
    async function saveQuickEntriesToStorage(entries) {
      const normalized = normalizeQuickEntryList(entries);
      await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.QUICK_ENTRIES, JSON.stringify({ version: 1, entries: normalized }));
      modules.state.state.quickEntries = normalized;
      if (modules.apps && typeof modules.apps.renderAppPickerList === "function") modules.apps.renderAppPickerList();
      if (modules.workspace && typeof modules.workspace.renderWorkspace === "function") modules.workspace.renderWorkspace();
      return normalized;
    }
    async function loadWorkspaceModeFromStorage() {
      const mode = String(await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.WORKSPACE_MODE) || "").trim();
      modules.state.state.workspaceMode = mode === "quick" ? "quick" : "app";
      return modules.state.state.workspaceMode;
    }
    async function setWorkspaceMode(mode, options = {}) {
      modules.state.state.workspaceMode = mode === "quick" ? "quick" : "app";
      await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.WORKSPACE_MODE, modules.state.state.workspaceMode);
      if (!options.skipRender && modules.workspace && typeof modules.workspace.renderWorkspace === "function") {
        modules.workspace.renderWorkspace();
      }
      return modules.state.state.workspaceMode;
    }
    async function initializeQuickEntries() {
      const [entries] = await Promise.all([loadQuickEntriesFromStorage(), loadWorkspaceModeFromStorage()]);
      modules.state.state.quickEntries = entries;
      return entries;
    }
    function buildEntryFromCurrentApp(title) {
      const state = modules.state.state;
      const app = state.currentApp;
      if (!app) throw new Error("请先选择一个应用");
      const name = String(title || "").trim();
      if (!name) throw new Error("请先填写快捷入口名称");
      if (!modules.state.resolveAppId(app)) throw new Error("当前应用缺少有效的 RunningHub appId");
      if (modules.workspace && typeof modules.workspace.collectFormValuesFromDom === "function") {
        modules.workspace.collectFormValuesFromDom();
      }
      const now = Date.now();
      return normalizeQuickEntryRecord({
        id: modules.runtime.createId("quick"),
        title: name,
        appRef: {
          savedAppId: String(app.id || ""),
          appId: modules.state.resolveAppId(app),
          appName: modules.state.getAppDisplayName(app)
        },
        inputValues: normalizeInputValues(state.formValues, app),
        imageBindings: normalizeImageBindings([], app),
        meta: {
          createdAt: now,
          updatedAt: now,
          lastRunAt: 0,
          runCount: 0
        }
      }, 0);
    }
    async function createFromCurrentApp(title) {
      const entry = buildEntryFromCurrentApp(title);
      const next = [entry, ...Array.isArray(modules.state.state.quickEntries) ? modules.state.state.quickEntries : []];
      await saveQuickEntriesToStorage(next);
      return entry;
    }
    async function renameQuickEntry(entryId, title) {
      const id = String(entryId || "").trim();
      const nextTitle = String(title || "").trim();
      if (!id) throw new Error("未找到快捷入口");
      if (!nextTitle) throw new Error("快捷入口名称不能为空");
      const list = modules.state.state.quickEntries.slice();
      const index = list.findIndex((item) => String(item.id) === id);
      if (index < 0) throw new Error("未找到快捷入口");
      list[index] = {
        ...list[index],
        title: nextTitle,
        meta: {
          ...list[index].meta || {},
          updatedAt: Date.now()
        }
      };
      await saveQuickEntriesToStorage(list);
      return list[index];
    }
    async function deleteQuickEntry(entryId) {
      const id = String(entryId || "").trim();
      if (!id) return false;
      const list = modules.state.state.quickEntries.filter((item) => String(item.id) !== id);
      await saveQuickEntriesToStorage(list);
      return true;
    }
    async function markQuickEntryRan(entryId) {
      const id = String(entryId || "").trim();
      const list = modules.state.state.quickEntries.slice();
      const index = list.findIndex((item) => String(item.id) === id);
      if (index < 0) return null;
      list[index] = {
        ...list[index],
        meta: {
          ...list[index].meta || {},
          lastRunAt: Date.now(),
          runCount: Number(list[index].meta && list[index].meta.runCount || 0) + 1
        }
      };
      await saveQuickEntriesToStorage(list);
      return list[index];
    }
    function getQuickEntryTitleKey(entry) {
      return String(entry && entry.title || "").trim().toLowerCase();
    }
    function mergeImportedQuickEntries(entries) {
      const current = Array.isArray(modules.state.state.quickEntries) ? modules.state.state.quickEntries.slice() : [];
      const existingIds = new Set(current.map((item) => String(item.id || "")));
      const titleIndexMap = /* @__PURE__ */ new Map();
      current.forEach((entry, index) => {
        const key = getQuickEntryTitleKey(entry);
        if (key && !titleIndexMap.has(key)) titleIndexMap.set(key, index);
      });
      let added = 0;
      let replaced = 0;
      normalizeQuickEntryList(entries).forEach((entry, index) => {
        const key = getQuickEntryTitleKey(entry);
        const previousIndex = key ? titleIndexMap.get(key) : -1;
        const previous = previousIndex >= 0 ? current[previousIndex] : null;
        const nextEntry = normalizeQuickEntryRecord({
          ...entry,
          id: previous ? previous.id : entry.id,
          meta: {
            ...entry.meta || {},
            createdAt: previous && previous.meta ? previous.meta.createdAt : entry.meta && entry.meta.createdAt,
            updatedAt: Date.now(),
            lastRunAt: previous && previous.meta ? previous.meta.lastRunAt : entry.meta && entry.meta.lastRunAt,
            runCount: previous && previous.meta ? previous.meta.runCount : entry.meta && entry.meta.runCount
          }
        }, index);
        if (!nextEntry) return;
        if (previous) {
          current[previousIndex] = nextEntry;
          replaced += 1;
          return;
        }
        if (!nextEntry.id || existingIds.has(nextEntry.id)) nextEntry.id = modules.runtime.createId("quick");
        existingIds.add(nextEntry.id);
        if (key) titleIndexMap.set(key, current.length);
        current.push(nextEntry);
        added += 1;
      });
      return { entries: normalizeQuickEntryList(current), added, replaced };
    }
    modules.quickEntries = {
      normalizeQuickEntryRecord,
      normalizeQuickEntryList,
      loadQuickEntriesFromStorage,
      saveQuickEntriesToStorage,
      loadWorkspaceModeFromStorage,
      setWorkspaceMode,
      initializeQuickEntries,
      createFromCurrentApp,
      renameQuickEntry,
      deleteQuickEntry,
      markQuickEntryRan,
      mergeImportedQuickEntries,
      appendImportedQuickEntries: mergeImportedQuickEntries
    };
  })(window);

  // src/webview/workspace.js
  (function initWorkspaceModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    const RUN_BUTTON_COOLDOWN_MS = 1500;
    const TASK_CARD_LIMIT = 24;
    const TASK_TRACKING_INTERVAL_MS = 15e3;
    const TASK_TRACKING_MAX_TEMP_FAILURES = 6;
    let runButtonCooldownUntil = 0;
    let taskTickerHandle = 0;
    let accountRefreshTimer = 0;
    let accountSettlementChain = Promise.resolve(null);
    let autoPlacementRetryTimer = 0;
    let autoPlacementProcessing = false;
    const taskTrackingTimers = /* @__PURE__ */ new Map();
    const taskTrackingFailureCounts = /* @__PURE__ */ new Map();
    const pendingAutoPlacements = /* @__PURE__ */ new Map();
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
    function getNumericInputKind(input, rawValue = void 0) {
      if (!input || typeof input !== "object") return "";
      const typeMarker = String(input.type || input.fieldType || "").trim().toLowerCase();
      if (!typeMarker) return "";
      if (/(^|[^a-z])(int|integer)([^a-z]|$)/.test(typeMarker)) return "int";
      if (/(^|[^a-z])(float|double|decimal)([^a-z]|$)/.test(typeMarker)) return "float";
      if (typeMarker !== "number") return "";
      const precision = Number(input.precision ?? input.decimals);
      if (Number.isFinite(precision)) return precision > 0 ? "float" : "int";
      const explicitStep = Number(input.step);
      if (Number.isFinite(explicitStep) && explicitStep > 0) {
        return Number.isInteger(explicitStep) ? "int" : "float";
      }
      const numericCandidates = [rawValue, input.default, input.min, input.max];
      if (numericCandidates.some((candidate) => {
        const num = Number(candidate);
        return Number.isFinite(num) && !Number.isInteger(num);
      })) {
        return "float";
      }
      return "int";
    }
    function isNumericInput(input, rawValue = void 0) {
      return Boolean(getNumericInputKind(input, rawValue));
    }
    function isFloatNumericInput(input, rawValue = void 0) {
      const kind = getNumericInputKind(input, rawValue);
      return kind === "float";
    }
    function isIntegerNumericInput(input, rawValue = void 0) {
      const kind = getNumericInputKind(input, rawValue);
      return kind === "int";
    }
    function isNumericInputInterimValue(value) {
      const text = String(value ?? "").trim();
      return text === "" || /^[+-]$/.test(text) || /^[+-]?\.$/.test(text) || /^[+-]?\d+\.$/.test(text);
    }
    function normalizeNumericValue(input, rawValue) {
      const kind = getNumericInputKind(input, rawValue);
      if (!kind) return rawValue;
      if (typeof rawValue === "number") {
        if (!Number.isFinite(rawValue)) return "";
        return kind === "int" ? Math.round(rawValue) : rawValue;
      }
      const text = String(rawValue ?? "").trim();
      if (!text) return "";
      if (isNumericInputInterimValue(text)) return text;
      const numericValue = Number(text);
      if (!Number.isFinite(numericValue)) return text;
      return kind === "int" ? Math.round(numericValue) : numericValue;
    }
    function formatNumericInputValue(input, rawValue) {
      const normalizedValue = normalizeNumericValue(input, rawValue);
      if (normalizedValue === "" || isNumericInputInterimValue(normalizedValue)) {
        return String(normalizedValue ?? "");
      }
      if (typeof normalizedValue === "number") {
        return isFloatNumericInput(input, rawValue) ? String(normalizedValue) : String(normalizedValue);
      }
      const parsed = Number(normalizedValue);
      if (!Number.isFinite(parsed)) return String(normalizedValue ?? "");
      return isFloatNumericInput(input, rawValue) ? String(parsed) : String(Math.round(parsed));
    }
    function getNumericInputStep(input, rawValue = void 0) {
      const explicitStep = Number(input && input.step);
      if (Number.isFinite(explicitStep) && explicitStep > 0) return explicitStep;
      return isFloatNumericInput(input, rawValue) ? 0.1 : 1;
    }
    function getNormalizedFieldValue(input, rawValue) {
      if (isImageInput(input)) return rawValue;
      if (isNumericInput(input)) return normalizeNumericValue(input, rawValue);
      if (input && (input.type === "boolean" || input.type === "switch" || input.type === "checkbox")) {
        return Boolean(rawValue);
      }
      return rawValue;
    }
    function isPromptField(input) {
      return modules.state.isPromptLikeInput(input) && !isImageInput(input);
    }
    function isPrimaryPromptField(input) {
      if (!isPromptField(input) || !modules.aiOptimize || typeof modules.aiOptimize.getPrimaryPromptInput !== "function") {
        return false;
      }
      const primaryPrompt = modules.aiOptimize.getPrimaryPromptInput(modules.state.state.currentApp);
      return Boolean(primaryPrompt && String(primaryPrompt.key || "") === String(input && input.key || ""));
    }
    function hasImageAsset(asset) {
      return Boolean(
        asset && typeof asset === "object" && ((asset.dataUrl || "").trim() || (asset.base64 || "").trim() || (asset.url || "").trim() || (asset.uploadDataUrl || "").trim() || (asset.uploadBase64 || "").trim())
      );
    }
    function hasImageFieldValue(value) {
      if (hasImageAsset(value)) return true;
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
      if (typeof value === "string") {
        const text = value.trim();
        return Boolean(text && (/^https?:\/\//i.test(text) || /^data:[^;,]+;base64,/i.test(text)));
      }
      if (value && typeof value === "object") {
        return Boolean(
          typeof value.dataUrl === "string" && value.dataUrl.trim() || typeof value.base64 === "string" && value.base64.trim() || typeof value.url === "string" && value.url.trim()
        );
      }
      return false;
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
    function cloneSelectionBounds(bounds) {
      if (!bounds || typeof bounds !== "object") return null;
      const left = Number(bounds.left);
      const top = Number(bounds.top);
      const right = Number(bounds.right);
      const bottom = Number(bounds.bottom);
      if (![left, top, right, bottom].every(Number.isFinite)) return null;
      if (right <= left || bottom <= top) return null;
      return { left, top, right, bottom };
    }
    function cloneDocumentInfo(docInfo) {
      if (!docInfo || typeof docInfo !== "object") return null;
      return {
        ...docInfo,
        selectionBounds: cloneSelectionBounds(docInfo.selectionBounds)
      };
    }
    function getDocumentCanvasBounds(docInfo) {
      if (!docInfo || typeof docInfo !== "object") return null;
      const width = Number(docInfo.width);
      const height = Number(docInfo.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
      return {
        left: 0,
        top: 0,
        right: width,
        bottom: height
      };
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
        document: cloneDocumentInfo(asset.document),
        selectionBounds: cloneSelectionBounds(asset.selectionBounds),
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
        uploadWidth: Number(asset.uploadWidth) || null,
        uploadHeight: Number(asset.uploadHeight) || null,
        uploadQuality: Number(asset.uploadQuality) || null,
        uploadTargetBytes: Number(asset.uploadTargetBytes) || null,
        uploadHardLimitBytes: Number(asset.uploadHardLimitBytes) || null,
        compressionAttempts: Array.isArray(asset.compressionAttempts) ? asset.compressionAttempts.map((attempt) => ({
          quality: Number(attempt && attempt.quality) || null,
          bytes: Number(attempt && attempt.bytes) || null,
          width: Number(attempt && attempt.width) || null,
          height: Number(attempt && attempt.height) || null
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
        width: Number(asset.uploadWidth) || Number(asset.originalWidth) || Number(asset.width) || null,
        height: Number(asset.uploadHeight) || Number(asset.originalHeight) || Number(asset.height) || null,
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
        const key = String(input && input.key || "").trim();
        if (!key || !(key in out)) return;
        if (!isImageInput(input)) return;
        out[key] = buildImageInputPayloadValue(out[key]);
      });
      inputs.forEach((input) => {
        if (!isNumericInput(input)) return;
        const key = String(input && input.key || "").trim();
        if (!key || !(key in out)) return;
        out[key] = normalizeNumericValue(input, out[key]);
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
      if (state.workspaceMode === "quick" || !state.currentApp) {
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
    function renderQuickModeMeta() {
      const count = Array.isArray(modules.state.state.quickEntries) ? modules.state.state.quickEntries.length : 0;
      return `<div class="workspace-app-summary workspace-quick-summary"><div class="workspace-app-name">快捷入口</div><span class="workspace-quick-count">已保存 ${modules.runtime.escapeHtml(String(count))} 个</span></div>`;
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
      if (normalized === "tracking") return "追踪中";
      if (normalized === "remote-running") return "云端运行中";
      if (normalized === "timeout") return "等待超时";
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
      if (normalized === "tracking") return "本地等待已超时，插件正在后台追踪云端状态。";
      if (normalized === "remote-running") return "云端仍在运行，本地已切换为后台追踪。";
      if (normalized === "timeout") return "本地等待超时，尚未确认云端最终状态。";
      if (normalized === "succeeded" || normalized === "success" || normalized === "done") return "任务已完成。";
      if (normalized === "failed" || normalized === "error") return task.errorMessage || "任务执行失败。";
      if (normalized === "cancelled" || normalized === "canceled") return "任务已取消。";
      return "";
    }
    function normalizeTaskChargeValue(value) {
      if (value == null) return null;
      if (typeof value === "number") return Number.isFinite(value) ? Math.abs(Number(value.toFixed(3))) : null;
      const text = String(value).trim();
      if (!text) return null;
      const matched = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
      if (!matched) return null;
      const parsed = Number(matched[0]);
      return Number.isFinite(parsed) ? Math.abs(Number(parsed.toFixed(3))) : null;
    }
    function formatTaskChargeDisplay(task) {
      if (!task || typeof task !== "object") return "";
      const explicit = String(task.chargeDisplay || "").trim();
      if (explicit) return explicit;
      const balanceCharge = normalizeTaskChargeValue(task.balanceCharge != null ? task.balanceCharge : task.charge);
      const coinsCharge = normalizeTaskChargeValue(task.coinsCharge);
      const parts = [];
      if (balanceCharge !== null) parts.push(`-${balanceCharge.toFixed(3)}R`);
      if (coinsCharge !== null) parts.push(Number.isInteger(coinsCharge) ? `-${coinsCharge}RH` : `-${coinsCharge.toFixed(3)}RH`);
      return parts.join(" · ");
    }
    function getCurrentAccountSnapshot() {
      const accountSummary = modules.state.state.accountSummary || {};
      return {
        balance: Number.isFinite(Number(accountSummary.balance)) ? Number(accountSummary.balance) : null,
        coins: Number.isFinite(Number(accountSummary.coins)) ? Number(accountSummary.coins) : null,
        updatedAt: Number(accountSummary.updatedAt) || 0
      };
    }
    function buildTaskChargePatchFromAccounts(beforeAccount, afterAccount) {
      const beforeBalance = Number(beforeAccount && beforeAccount.balance);
      const afterBalance = Number(afterAccount && afterAccount.balance);
      const beforeCoins = Number(beforeAccount && beforeAccount.coins);
      const afterCoins = Number(afterAccount && afterAccount.coins);
      const balanceCharge = Number.isFinite(beforeBalance) && Number.isFinite(afterBalance) && beforeBalance > afterBalance ? Number((beforeBalance - afterBalance).toFixed(3)) : null;
      const coinsCharge = Number.isFinite(beforeCoins) && Number.isFinite(afterCoins) && beforeCoins > afterCoins ? Number((beforeCoins - afterCoins).toFixed(3)) : null;
      if (balanceCharge === null && coinsCharge === null) return null;
      return {
        charge: balanceCharge,
        balanceCharge,
        coinsCharge,
        chargeDisplay: formatTaskChargeDisplay({ balanceCharge, coinsCharge })
      };
    }
    async function refreshAccountAndPatchTaskCharge(taskId) {
      const normalizedTaskId = String(taskId || "").trim();
      if (!normalizedTaskId || !modules.settings || typeof modules.settings.refreshAccountSummary !== "function") return null;
      accountSettlementChain = accountSettlementChain.catch(() => null).then(async () => {
        const beforeAccount = getCurrentAccountSnapshot();
        const account = await modules.settings.refreshAccountSummary({ quiet: true, force: true });
        const chargePatch = buildTaskChargePatchFromAccounts(beforeAccount, account || getCurrentAccountSnapshot());
        if (chargePatch) {
          upsertRunningTask({
            taskId: normalizedTaskId,
            ...chargePatch
          });
        }
        return chargePatch;
      });
      return accountSettlementChain;
    }
    function inferTaskFailureCode(task) {
      if (!task || typeof task !== "object") return "";
      const explicit = String(task.failureCode || "").trim().toLowerCase();
      if (explicit) return explicit;
      const status = String(task.status || "").trim().toLowerCase();
      const text = `${task.failureLabel || ""} ${task.errorMessage || ""} ${task.detail || ""}`.toLowerCase();
      if (status === "timeout" || /timeout|超时/.test(text)) return "timeout";
      if (status === "cancelled" || status === "canceled" || /cancel|取消/.test(text)) return "cancelled";
      if (/欠费|余额不足|insufficient|not enough balance|lack of balance|recharge|quota/.test(text)) return "insufficient_balance";
      if (/违规|violation|forbidden|policy|safety|sensitive|blocked|ban/.test(text)) return "violation";
      if (status === "failed" || status === "error") return "failed";
      return "";
    }
    function getTaskFailureLabel(task) {
      if (!task || typeof task !== "object") return "";
      const explicit = String(task.failureLabel || "").trim();
      if (explicit) return explicit;
      const code = inferTaskFailureCode(task);
      if (code === "timeout") return "超时";
      if (code === "cancelled") return "已取消";
      if (code === "insufficient_balance") return "欠费";
      if (code === "violation") return "违规";
      if (code === "failed") return "失败";
      return "";
    }
    function isPermanentTrackingErrorMessage(message) {
      const text = String(message || "").trim().toLowerCase();
      if (!text) return false;
      return text.includes("api key") || text.includes("apikey") || text.includes("unauthorized") || text.includes("forbidden") || text.includes("access denied") || text.includes("invalid token") || text.includes("token is invalid") || text.includes("taskid is missing") || text.includes("task id is missing") || text.includes("task not found") || text.includes("not found") || text.includes("does not exist") || text.includes("unknown task") || text.includes("unknown bridge method");
    }
    function shouldStopTrackingFromStatusResult(statusResult) {
      if (!statusResult || typeof statusResult !== "object") return false;
      if (String(statusResult.outputUrl || "").trim()) return false;
      if (statusResult.stillRunning || statusResult.failed) return false;
      return statusResult.ok === false;
    }
    function scheduleAccountSummaryRefresh(delayMs = 1200) {
      if (!modules.runtime.isPluginRuntime()) return;
      if (!modules.settings || typeof modules.settings.refreshAccountSummary !== "function") return;
      if (accountRefreshTimer) window.clearTimeout(accountRefreshTimer);
      accountRefreshTimer = window.setTimeout(() => {
        accountRefreshTimer = 0;
        void modules.settings.refreshAccountSummary({ quiet: true, force: true });
      }, Math.max(0, Number(delayMs) || 0));
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
        const chargeDisplay = formatTaskChargeDisplay(task);
        const failureLabel = getTaskFailureLabel(task);
        const detailPrefix = failureLabel && ["failed", "error", "cancelled", "canceled", "timeout"].includes(String(task.status || "").trim().toLowerCase()) ? `失败原因：${failureLabel}${detail ? " · " : ""}` : "";
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
              <div class="running-task-meta">${modules.runtime.escapeHtml(shortTaskId)} · ${modules.runtime.escapeHtml(durationLabel)}${chargeDisplay ? ` · ${modules.runtime.escapeHtml(chargeDisplay)}` : ""}</div>
              <div class="running-task-detail">${modules.runtime.escapeHtml(detailPrefix)}${detail}</div>
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
      const quickMode = state.workspaceMode === "quick";
      if (runButton) {
        runButton.disabled = quickMode || !hasCurrentApp || concurrencyReached || cooldownActive;
        if (quickMode) {
          runButton.textContent = "点击快捷入口运行";
        } else if (!hasCurrentApp) {
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
        if (quickMode) {
          taskStatusSummary.textContent = activeCount > 0 ? `后台任务：进行中 ${activeCount}/${maxConcurrentTasks} 个，快捷入口仍可在并发未满时继续提交。` : "后台任务：选择一个快捷入口即可直接运行。";
        } else if (!hasCurrentApp) {
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
      if (modules.sound && typeof modules.sound.handleQueueState === "function") {
        modules.sound.handleQueueState(activeCount);
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
        const showAiOptimizeButton = isPrimaryPromptField(input);
        const aiOptimizeAvailability = showAiOptimizeButton && modules.aiOptimize && typeof modules.aiOptimize.getAvailability === "function" ? modules.aiOptimize.getAvailability(key) : { available: false, reason: "" };
        return `
        <label class="field dynamic-field ${isPromptField(input) ? "prompt-field" : ""}">
          <span class="field-label">
            <span>${label}${requiredMark}</span>
            ${isPromptField(input) ? `
                  <span class="prompt-action-group">
                    <button class="mini-btn template-trigger-btn" type="button" data-action="open-template-picker" data-form-key="${escapedKey}">预设</button>
                    ${showAiOptimizeButton ? `<button class="mini-btn ai-optimize-trigger-btn" type="button" data-action="open-ai-optimize" data-form-key="${escapedKey}" ${aiOptimizeAvailability.available ? "" : "disabled"} title="${runtime.escapeHtml(aiOptimizeAvailability.available ? "基于当前图片和主 prompt 生成优化建议" : aiOptimizeAvailability.reason || "当前不可用")}">AI优化</button>` : ""}
                  </span>
                ` : ""}
          </span>
          <textarea class="field-input field-textarea" rows="4" data-form-key="${escapedKey}">${runtime.escapeHtml(currentValue)}</textarea>
          ${isPromptField(input) ? renderPromptHint(currentValue) : ""}
        </label>
      `;
      }
      if (input.type === "number" || input.type === "int" || input.type === "float") {
        const numberKind = getNumericInputKind(input, value) || "int";
        const step = getNumericInputStep(input, value);
        const formattedValue = formatNumericInputValue(input, value);
        return `<label class="field dynamic-field"><span class="field-label">${label}${requiredMark}</span><input class="field-input" type="number" data-form-key="${escapedKey}" data-number-kind="${runtime.escapeHtml(numberKind)}" step="${runtime.escapeHtml(String(step))}" value="${runtime.escapeHtml(formattedValue)}" /></label>`;
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
    function getQuickEntryDisplayTitle(entry, index, entries) {
      const title = String(entry && entry.title || "未命名快捷入口").trim() || "未命名快捷入口";
      const sameBefore = entries.slice(0, index).filter((item) => String(item && item.title || "").trim() === title).length;
      return sameBefore > 0 ? `${title} (${sameBefore + 1})` : title;
    }
    function renderQuickEntriesPanel() {
      const runtime = modules.runtime;
      const entries = Array.isArray(modules.state.state.quickEntries) ? modules.state.state.quickEntries : [];
      if (entries.length === 0) {
        return `
        <div class="quick-entry-panel">
          <div class="empty-panel">
            <h4>还没有快捷入口</h4>
            <p>切回普通应用，填好参数后点击“快捷”，即可把当前应用和非图片参数保存成一个入口。</p>
          </div>
        </div>
      `;
      }
      return `
      <div class="quick-entry-panel">
        <div class="quick-entry-list">
          ${entries.map((entry, index) => {
        const id = runtime.escapeHtml(String(entry.id || ""));
        const title = runtime.escapeHtml(getQuickEntryDisplayTitle(entry, index, entries));
        const appName = runtime.escapeHtml(String(entry.appRef && entry.appRef.appName || "未命名应用"));
        const runCount = Number(entry.meta && entry.meta.runCount) || 0;
        return `
                <article class="quick-entry-card" data-quick-entry-id="${id}">
                  <div class="quick-entry-main">
                    <strong>${title}</strong>
                    <span>${appName} · 需要选区${runCount > 0 ? ` · 已运行 ${runtime.escapeHtml(String(runCount))} 次` : ""}</span>
                  </div>
                  <div class="inline-actions quick-entry-actions">
                    <button class="mini-btn quick-entry-run-btn" type="button" data-action="run-quick-entry" data-quick-entry-id="${id}">运行</button>
                    <button class="mini-btn" type="button" data-action="rename-quick-entry" data-quick-entry-id="${id}">改名</button>
                    <button class="mini-btn" type="button" data-action="delete-quick-entry" data-quick-entry-id="${id}">删</button>
                  </div>
                </article>
              `;
      }).join("")}
        </div>
      </div>
    `;
    }
    function renderWorkspace() {
      const runtime = modules.runtime;
      const state = modules.state.state;
      const appPickerMeta = runtime.getById("appPickerMeta");
      const dynamicInputContainer = runtime.getById("dynamicInputContainer");
      const workspaceInputArea = runtime.getById("workspaceInputArea");
      const createQuickEntryButton = runtime.getById("btnCreateQuickEntry");
      const quickMode = state.workspaceMode === "quick";
      if (appPickerMeta) {
        appPickerMeta.innerHTML = quickMode ? renderQuickModeMeta() : renderAppMeta(state.currentApp);
      }
      document.body.classList.toggle("workspace-mode-quick", quickMode);
      if (workspaceInputArea) workspaceInputArea.classList.toggle("workspace-quick-card", quickMode);
      if (createQuickEntryButton) {
        createQuickEntryButton.hidden = quickMode;
        createQuickEntryButton.disabled = !state.currentApp;
      }
      renderImageInputArea();
      if (dynamicInputContainer) {
        if (quickMode) {
          dynamicInputContainer.innerHTML = renderQuickEntriesPanel();
        } else if (!state.currentApp) {
          dynamicInputContainer.innerHTML = '<div class="empty-panel"><h4>动态表单区</h4><p>请先选择一个已保存应用，后续这里会根据输入结构动态渲染表单。</p></div>';
        } else if (!Array.isArray(state.currentApp.inputs) || state.currentApp.inputs.length === 0) {
          dynamicInputContainer.innerHTML = `<div class="empty-panel"><h4>${runtime.escapeHtml(modules.state.getAppDisplayName(state.currentApp))}</h4><p>当前应用还没有输入结构。你可以先去设置页编辑应用，手动补齐输入 JSON。</p></div>`;
        } else {
          dynamicInputContainer.innerHTML = `<div class="dynamic-form">${state.currentApp.inputs.map(renderField).join("")}</div>`;
        }
      }
      updateRunButtonState();
      if (modules.settings && typeof modules.settings.refreshThemeSkin === "function") {
        modules.settings.refreshThemeSkin();
      }
    }
    function cloneWorkspaceFormValue(value) {
      if (value == null) return value;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
      if (hasImageAsset(value)) return cloneCaptureAsset(value);
      if (Array.isArray(value)) return value.map(cloneWorkspaceFormValue);
      if (value && typeof value === "object") {
        const out = {};
        Object.keys(value).forEach((key) => {
          out[key] = cloneWorkspaceFormValue(value[key]);
        });
        return out;
      }
      return value;
    }
    function captureWorkspaceFormSnapshot() {
      const state = modules.state.state;
      collectFormValuesFromDom();
      return {
        appId: String(state.currentApp && state.currentApp.id || ""),
        formValues: cloneWorkspaceFormValue(state.formValues || {})
      };
    }
    function restoreWorkspaceFormSnapshot(snapshot) {
      const state = modules.state.state;
      const currentAppId = String(state.currentApp && state.currentApp.id || "");
      if (!snapshot || typeof snapshot !== "object" || !snapshot.formValues || currentAppId !== String(snapshot.appId || "")) {
        return false;
      }
      state.formValues = {
        ...modules.state.buildDefaultFormValues(state.currentApp),
        ...cloneWorkspaceFormValue(snapshot.formValues)
      };
      renderWorkspace();
      return true;
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
        if (element.matches("input, textarea, select")) {
          const nextValue = inputMeta ? getNormalizedFieldValue(inputMeta, element.value) : element.value;
          state.formValues[key] = nextValue;
          if (inputMeta && isNumericInput(inputMeta) && element.matches('input[type="number"]') && !isNumericInputInterimValue(nextValue)) {
            element.value = formatNumericInputValue(inputMeta, nextValue);
          }
        }
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
      const hasOwn = (key) => Object.prototype.hasOwnProperty.call(patch, key);
      const now = Date.now();
      const nextTask = {
        taskId: normalizedTaskId,
        remoteTaskId: String(patch.remoteTaskId || patch.taskId || "").trim(),
        appName: String(patch.appName || "").trim(),
        status: String(patch.status || "running").trim() || "running",
        detail: String(patch.detail || "").trim(),
        errorMessage: String(patch.errorMessage || "").trim(),
        charge: hasOwn("charge") ? normalizeTaskChargeValue(patch.charge) : void 0,
        balanceCharge: hasOwn("balanceCharge") ? normalizeTaskChargeValue(patch.balanceCharge) : void 0,
        coinsCharge: hasOwn("coinsCharge") ? normalizeTaskChargeValue(patch.coinsCharge) : void 0,
        chargeDisplay: hasOwn("chargeDisplay") ? String(patch.chargeDisplay || "").trim() : void 0,
        accountSnapshot: hasOwn("accountSnapshot") ? patch.accountSnapshot && typeof patch.accountSnapshot === "object" ? { ...patch.accountSnapshot } : null : void 0,
        failureCode: String(patch.failureCode || "").trim(),
        failureLabel: String(patch.failureLabel || "").trim(),
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
          charge: nextTask.charge !== void 0 ? nextTask.charge : current.charge,
          balanceCharge: nextTask.balanceCharge !== void 0 ? nextTask.balanceCharge : current.balanceCharge,
          coinsCharge: nextTask.coinsCharge !== void 0 ? nextTask.coinsCharge : current.coinsCharge,
          chargeDisplay: nextTask.chargeDisplay !== void 0 ? nextTask.chargeDisplay : current.chargeDisplay,
          accountSnapshot: nextTask.accountSnapshot !== void 0 ? nextTask.accountSnapshot : current.accountSnapshot,
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
      stopTaskStatusTracking(normalizedTaskId);
      state.runningTasks = (Array.isArray(state.runningTasks) ? state.runningTasks : []).filter(
        (item) => String(item.taskId || "") !== normalizedTaskId
      );
      syncPrimaryRunningTask();
      updateRunButtonState();
    }
    function stopTaskStatusTracking(taskId = "") {
      const normalizedTaskId = String(taskId || "").trim();
      if (!normalizedTaskId) return;
      const timerId = taskTrackingTimers.get(normalizedTaskId);
      if (timerId) {
        window.clearInterval(timerId);
        taskTrackingTimers.delete(normalizedTaskId);
      }
      taskTrackingFailureCounts.delete(normalizedTaskId);
    }
    async function finalizeTrackedTaskSuccess(taskId, payload, sourceDocument, statusResult) {
      const remoteTaskId = String(taskId || "").trim();
      const outputUrl = String(statusResult && statusResult.outputUrl || "").trim();
      if (!remoteTaskId || !outputUrl) return;
      const completedAt = Date.now();
      stopTaskStatusTracking(remoteTaskId);
      upsertRunningTask({
        taskId: remoteTaskId,
        remoteTaskId,
        appName: payload.appName,
        status: "succeeded",
        detail: "后台追踪确认任务已完成，结果已返回。",
        charge: statusResult && statusResult.charge,
        balanceCharge: statusResult && statusResult.balanceCharge,
        coinsCharge: statusResult && statusResult.coinsCharge,
        chargeDisplay: statusResult && statusResult.chargeDisplay,
        outputUrl,
        sourceDocument,
        finishedAt: completedAt
      });
      if (statusResult && (statusResult.chargeDisplay || statusResult.balanceCharge != null || statusResult.coinsCharge != null)) {
        scheduleAccountSummaryRefresh();
      } else {
        await refreshAccountAndPatchTaskCharge(remoteTaskId);
      }
      setLastResult({
        appName: payload.appName,
        sourceDocument,
        outputUrl,
        taskId: remoteTaskId
      });
      modules.ui.logToWorkspace(`后台追踪发现任务已完成，结果地址：${outputUrl}`, "success");
      try {
        const placementResponse = await autoPlaceResult({
          appName: payload.appName,
          sourceDocument,
          outputUrl,
          taskId: remoteTaskId
        });
        if (placementResponse && placementResponse.queued) {
          upsertRunningTask({
            taskId: remoteTaskId,
            remoteTaskId,
            appName: payload.appName,
            status: "succeeded",
            detail: "任务已完成，但 Photoshop 当前正忙，返图已暂停，稍后会自动继续贴回。"
          });
          return;
        }
        upsertRunningTask({
          taskId: remoteTaskId,
          remoteTaskId,
          appName: payload.appName,
          status: "succeeded",
          detail: placementResponse && placementResponse.documentId ? `后台追踪确认完成，并已自动贴回 Photoshop 文档 #${placementResponse.documentId}。` : "后台追踪确认完成，可继续查看结果。"
        });
      } catch (placementError) {
        const placementMessage = placementError && placementError.message ? placementError.message : String(placementError || "自动贴回 Photoshop 失败");
        modules.ui.logToWorkspace(`后台追踪确认任务完成，但自动贴回失败：${placementMessage}`, "warn");
        upsertRunningTask({
          taskId: remoteTaskId,
          remoteTaskId,
          appName: payload.appName,
          status: "succeeded",
          detail: `后台追踪确认任务已完成，但自动贴回失败：${placementMessage}`
        });
      }
    }
    function startTaskStatusTracking(taskId, payload, sourceDocument) {
      const remoteTaskId = String(taskId || "").trim();
      if (!remoteTaskId || taskTrackingTimers.has(remoteTaskId) || !modules.runtime.isPluginRuntime()) return;
      taskTrackingFailureCounts.set(remoteTaskId, 0);
      const trackOnce = async () => {
        try {
          const statusResult = await modules.runtime.callHost(
            "runninghub.fetchTaskStatus",
            [{ apiKey: payload.apiKey, taskId: remoteTaskId, timeoutMs: 3e4 }],
            { timeoutMs: 35e3 }
          );
          const remoteStatus = String(statusResult && statusResult.status || "").trim().toUpperCase();
          if (statusResult && String(statusResult.outputUrl || "").trim()) {
            await finalizeTrackedTaskSuccess(remoteTaskId, payload, sourceDocument, statusResult);
            return;
          }
          if (shouldStopTrackingFromStatusResult(statusResult)) {
            stopTaskStatusTracking(remoteTaskId);
            const finishedAt = Date.now();
            const failMessage = String(
              statusResult && statusResult.message || "后台追踪已停止：RunningHub 未返回可继续追踪的有效状态。"
            ).trim();
            upsertRunningTask({
              taskId: remoteTaskId,
              remoteTaskId,
              appName: payload.appName,
              status: "failed",
              detail: `后台追踪已停止：${failMessage}`,
              errorMessage: failMessage,
              failureLabel: getTaskFailureLabel({
                status: "failed",
                errorMessage: failMessage,
                detail: failMessage
              }),
              sourceDocument,
              finishedAt
            });
            modules.ui.logToWorkspace(`后台追踪已停止：${failMessage}`, "error");
            return;
          }
          if (statusResult && statusResult.failed) {
            stopTaskStatusTracking(remoteTaskId);
            const finishedAt = Date.now();
            const failMessage = String(
              statusResult && statusResult.message || `RunningHub 返回失败状态 ${remoteStatus || "FAILED"}`
            ).trim();
            upsertRunningTask({
              taskId: remoteTaskId,
              remoteTaskId,
              appName: payload.appName,
              status: "failed",
              detail: `后台追踪确认云端任务失败：${failMessage}`,
              errorMessage: failMessage,
              charge: statusResult && statusResult.charge,
              balanceCharge: statusResult && statusResult.balanceCharge,
              coinsCharge: statusResult && statusResult.coinsCharge,
              chargeDisplay: statusResult && statusResult.chargeDisplay,
              failureLabel: getTaskFailureLabel({
                status: "failed",
                errorMessage: failMessage,
                detail: failMessage
              }),
              sourceDocument,
              finishedAt
            });
            if (statusResult.chargeDisplay || statusResult.balanceCharge != null || statusResult.coinsCharge != null) {
              scheduleAccountSummaryRefresh();
            } else {
              await refreshAccountAndPatchTaskCharge(remoteTaskId);
            }
            modules.ui.logToWorkspace(`后台追踪确认任务失败：${failMessage}`, "error");
            return;
          }
          taskTrackingFailureCounts.set(remoteTaskId, 0);
          const nextStatus = statusResult && statusResult.stillRunning ? remoteStatus === "QUEUED" || remoteStatus === "QUEUE" ? "queued" : "remote-running" : "tracking";
          const nextDetail = statusResult && statusResult.stillRunning ? `云端状态：${remoteStatus || "RUNNING"}，插件继续后台追踪中。` : `暂未获取到终态结果${statusResult && statusResult.message ? `：${statusResult.message}` : "，插件继续后台追踪中。"}`;
          upsertRunningTask({
            taskId: remoteTaskId,
            remoteTaskId,
            appName: payload.appName,
            status: nextStatus,
            detail: nextDetail,
            sourceDocument
          });
        } catch (error) {
          const message = String(error && error.message ? error.message : error || "后台追踪失败").trim();
          const nextFailureCount = Number(taskTrackingFailureCounts.get(remoteTaskId) || 0) + 1;
          taskTrackingFailureCounts.set(remoteTaskId, nextFailureCount);
          if (isPermanentTrackingErrorMessage(message) || nextFailureCount >= TASK_TRACKING_MAX_TEMP_FAILURES) {
            stopTaskStatusTracking(remoteTaskId);
            const finalMessage = isPermanentTrackingErrorMessage(message) ? message : `${message}（已连续失败 ${nextFailureCount} 次，停止自动重试）`;
            upsertRunningTask({
              taskId: remoteTaskId,
              remoteTaskId,
              appName: payload.appName,
              status: "failed",
              detail: `后台追踪已停止：${finalMessage}`,
              errorMessage: finalMessage,
              failureLabel: getTaskFailureLabel({
                status: "failed",
                errorMessage: finalMessage,
                detail: finalMessage
              }),
              sourceDocument,
              finishedAt: Date.now()
            });
            modules.ui.logToWorkspace(`后台追踪已停止：${finalMessage}`, "error");
            return;
          }
          upsertRunningTask({
            taskId: remoteTaskId,
            remoteTaskId,
            appName: payload.appName,
            status: "tracking",
            detail: `后台追踪暂时失败：${message}，稍后会继续重试（${nextFailureCount}/${TASK_TRACKING_MAX_TEMP_FAILURES}）。`,
            sourceDocument
          });
        }
      };
      const timerId = window.setInterval(() => {
        void trackOnce();
      }, TASK_TRACKING_INTERVAL_MS);
      taskTrackingTimers.set(remoteTaskId, timerId);
      void trackOnce();
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
    function resolveSourceDocumentFromImageInputs(app, formValues, fallbackDocument = null) {
      const imageInputs = findImageInputs(app);
      const values = formValues && typeof formValues === "object" ? formValues : {};
      const resolveFromInput = (input) => {
        const key = String(input && input.key || "").trim();
        if (!key) return null;
        const asset = values[key];
        if (!hasImageAsset(asset)) return null;
        const assetDocument = cloneDocumentInfo(asset.document);
        if (assetDocument && assetDocument.hasActiveDocument && Number(assetDocument.documentId) > 0) {
          return assetDocument;
        }
        const documentId = Number(asset.documentId) || 0;
        if (documentId <= 0) return null;
        return {
          ok: true,
          hasActiveDocument: true,
          documentId,
          title: assetDocument && assetDocument.title ? assetDocument.title : "Captured Document",
          width: assetDocument && Number.isFinite(Number(assetDocument.width)) ? Number(assetDocument.width) : null,
          height: assetDocument && Number.isFinite(Number(assetDocument.height)) ? Number(assetDocument.height) : null,
          selectionBounds: cloneSelectionBounds(asset.selectionBounds) || cloneSelectionBounds(assetDocument && assetDocument.selectionBounds)
        };
      };
      for (const input of imageInputs) {
        const sourceDocument = resolveFromInput(input);
        if (sourceDocument) return sourceDocument;
      }
      return cloneDocumentInfo(fallbackDocument);
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
        uploadWidth: captured && captured.uploadWidth,
        uploadHeight: captured && captured.uploadHeight,
        uploadQuality: captured && captured.uploadQuality
      });
      const asset = pushCapturedAsset(captured);
      if (!asset) {
        throw new Error("宿主已返回结果，但未生成可用预览资源");
      }
      modules.ui.logToWorkspace(
        `已捕获 Photoshop 文档图像：预览 ${asset.width}x${asset.height}，上传 ${asset.uploadWidth || "-"}x${asset.uploadHeight || "-"} · ${(asset.uploadBytes || 0) / (1024 * 1024) > 0 ? `${((asset.uploadBytes || 0) / (1024 * 1024)).toFixed(2)}MB` : "-"}`,
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
    function isMissingRequiredValue(input, value) {
      if (typeof value === "boolean") return false;
      if (isImageInput(input)) return !hasImageFieldValue(value);
      if (hasImageAsset(value)) return false;
      if (value && typeof value === "object") return true;
      return String(value ?? "").trim() === "";
    }
    function validateRunPayload() {
      const state = modules.state.state;
      const app = state.currentApp;
      if (!app) throw new Error("请先选择一个应用");
      collectFormValuesFromDom();
      const missing = (Array.isArray(app.inputs) ? app.inputs : []).filter((input) => input.required).filter((input) => isMissingRequiredValue(input, state.formValues[input.key]));
      if (missing.length > 0) throw new Error(`请先填写必填项：${missing.map((item) => item.label || item.key).join("、")}`);
    }
    function validateAppValues(app, values) {
      const missing = (Array.isArray(app && app.inputs) ? app.inputs : []).filter((input) => input.required).filter((input) => isMissingRequiredValue(input, values[input.key]));
      if (missing.length > 0) throw new Error(`请先填写必填项：${missing.map((item) => item.label || item.key).join("、")}`);
    }
    function findQuickEntryApp(entry) {
      const appRef = entry && entry.appRef ? entry.appRef : {};
      const savedAppId = String(appRef.savedAppId || "").trim();
      const runningHubAppId = String(appRef.appId || "").trim();
      return modules.state.state.apps.find((app) => savedAppId && String(app.id || "") === savedAppId) || modules.state.state.apps.find((app) => runningHubAppId && String(modules.state.resolveAppId(app)) === runningHubAppId) || null;
    }
    function getQuickEntryImageInput(entry, app) {
      const imageInputs = findImageInputs(app);
      if (imageInputs.length === 0) return null;
      const bindings = Array.isArray(entry && entry.imageBindings) ? entry.imageBindings : [];
      for (const binding of bindings) {
        const key = String(binding && binding.inputKey || "").trim();
        const matched = imageInputs.find((input) => String(input.key || "") === key);
        if (matched) return matched;
      }
      return imageInputs.find((input) => input.required) || imageInputs[0] || null;
    }
    function buildQuickRunPayload(entry, app, values) {
      const currentAppId = modules.state.resolveAppId(app) || String(entry.appRef && entry.appRef.appId || "").trim();
      const payload = {
        appId: currentAppId,
        appName: String(entry && entry.title || modules.state.getAppDisplayName(app)),
        app: {
          id: app.id,
          appId: currentAppId,
          name: app.name,
          inputs: Array.isArray(app.inputs) ? app.inputs : []
        },
        apiKey: modules.state.state.settings.apiKey || "",
        inputs: normalizePayloadInputs(app, values),
        settings: {
          pollInterval: modules.state.state.settings.pollInterval,
          timeout: modules.state.state.settings.timeout,
          maxConcurrentTasks: modules.state.state.settings.maxConcurrentTasks
        }
      };
      modules.state.state.lastRunPayload = payload;
      return payload;
    }
    async function ensureSelectionForQuickEntry(entry) {
      const docInfo = await refreshPhotoshopDocumentStatus({ quiet: true });
      if (!docInfo || !docInfo.hasActiveDocument) {
        throw new Error("请先打开 Photoshop 文档，再运行快捷入口。");
      }
      if (!cloneSelectionBounds(docInfo.selectionBounds)) {
        const title = String(entry && entry.title || "该快捷入口").trim() || "该快捷入口";
        throw new Error(`未检测到 Photoshop 选区。
请先框选要处理的区域，再运行“${title}”。`);
      }
      return docInfo;
    }
    async function runQuickEntry(entryId) {
      const entry = modules.state.state.quickEntries.find((item) => String(item.id || "") === String(entryId || ""));
      if (!entry) throw new Error("未找到快捷入口");
      const app = findQuickEntryApp(entry);
      if (!app) throw new Error(`快捷入口引用的应用不存在：${entry.appRef && entry.appRef.appName ? entry.appRef.appName : entry.title}`);
      if (!modules.runtime.isPluginRuntime()) throw new Error("浏览器预览模式下无法运行快捷入口");
      if (!modules.state.state.settings.apiKey) throw new Error("请先在设置页保存 RunningHub API Key");
      if (!modules.state.resolveAppId(app)) throw new Error("快捷入口引用的应用缺少有效的 appId，请重新保存应用后再创建快捷入口");
      if (getActiveRunningTasks().length >= getMaxConcurrentTasks()) {
        throw new Error(`已达到最大并发数 ${getMaxConcurrentTasks()}，请等待部分任务完成后再继续发送。`);
      }
      if (isRunCooldownActive()) throw new Error("请不要短时间连续点击运行按钮，稍后再试。");
      const imageInput = getQuickEntryImageInput(entry, app);
      if (!imageInput) throw new Error("快捷入口引用的应用没有可绑定的图片字段");
      await ensureSelectionForQuickEntry(entry);
      markRunCooldown();
      clearLastResult();
      const asset = await captureCurrentDocumentImage();
      const values = {
        ...modules.state.buildDefaultFormValues(app),
        ...entry.inputValues && typeof entry.inputValues === "object" ? entry.inputValues : {},
        [String(imageInput.key || "")]: cloneCaptureAsset(asset)
      };
      validateAppValues(app, values);
      const payload = buildQuickRunPayload(entry, app, values);
      const sourceDocument = resolveSourceDocumentFromImageInputs(app, values, asset.document || null);
      await modules.quickEntries.markQuickEntryRan(entry.id);
      startRunTaskFlow(payload, sourceDocument);
    }
    function buildAutoPlacementPayload(result) {
      const sourceDocument = result && result.sourceDocument && typeof result.sourceDocument === "object" ? result.sourceDocument : null;
      const selectionBounds = sourceDocument && sourceDocument.selectionBounds ? sourceDocument.selectionBounds : null;
      const documentBounds = getDocumentCanvasBounds(sourceDocument);
      const targetBounds = selectionBounds || documentBounds || null;
      const useFullDocumentBounds = !selectionBounds && !!documentBounds;
      return {
        url: result && result.outputUrl ? result.outputUrl : "",
        taskId: result && result.taskId ? result.taskId : "",
        targetDocumentId: sourceDocument && sourceDocument.hasActiveDocument ? sourceDocument.documentId : null,
        targetBounds,
        applyMask: Boolean(selectionBounds),
        fitMode: useFullDocumentBounds ? "stretch" : "contain",
        layerName: getResultDefaultLayerName()
      };
    }
    function isAutoPlacementBlockedError(error) {
      const message = String(error && error.message || error || "").toLowerCase();
      if (!message) return false;
      return message.includes("modal") || message.includes("executeasmodal") || message.includes("host is in a modal state") || message.includes("photoshop is busy") || message.includes("another modal") || message.includes("command is currently unavailable") || message.includes("the object is currently in use");
    }
    function schedulePendingAutoPlacementRetry(delayMs = 4e3) {
      if (autoPlacementRetryTimer || pendingAutoPlacements.size === 0) return;
      autoPlacementRetryTimer = window.setTimeout(() => {
        autoPlacementRetryTimer = 0;
        void flushPendingAutoPlacements();
      }, Math.max(1e3, Number(delayMs) || 4e3));
    }
    function queueAutoPlacement(result) {
      if (!result || !result.outputUrl) return null;
      const taskId = String(result.taskId || "").trim() || `placement-${Date.now()}`;
      pendingAutoPlacements.set(taskId, {
        ...result,
        taskId,
        queuedAt: Date.now(),
        attempts: Number(pendingAutoPlacements.get(taskId) && pendingAutoPlacements.get(taskId).attempts || 0)
      });
      schedulePendingAutoPlacementRetry();
      return pendingAutoPlacements.get(taskId);
    }
    async function flushPendingAutoPlacements() {
      if (autoPlacementProcessing || pendingAutoPlacements.size === 0 || !modules.runtime.isPluginRuntime()) return;
      autoPlacementProcessing = true;
      try {
        for (const [taskId, queued] of Array.from(pendingAutoPlacements.entries())) {
          try {
            const placementPayload = buildAutoPlacementPayload(queued);
            const response = await modules.runtime.callHost("photoshop.placeResultFromUrl", [placementPayload], { timeoutMs: 6e4 });
            pendingAutoPlacements.delete(taskId);
            modules.state.state.lastResult.placedAt = Date.now();
            if (response && response.document) modules.state.state.currentDocumentInfo = response.document;
            upsertRunningTask({
              taskId,
              remoteTaskId: taskId,
              detail: response && response.documentId ? `任务已完成，并已在 Photoshop 空闲后自动贴回文档 #${response.documentId}。` : "任务已完成，并已在 Photoshop 空闲后自动贴回。"
            });
            modules.ui.logToWorkspace(`返图已恢复执行并贴回 Photoshop：${taskId}`, "success");
          } catch (error) {
            if (isAutoPlacementBlockedError(error)) {
              pendingAutoPlacements.set(taskId, {
                ...queued,
                attempts: Number(queued.attempts || 0) + 1
              });
              continue;
            }
            pendingAutoPlacements.delete(taskId);
            const message = error && error.message ? error.message : String(error || "自动贴回 Photoshop 失败");
            upsertRunningTask({
              taskId,
              remoteTaskId: taskId,
              detail: `任务已完成，但自动贴回失败：${message}`
            });
            modules.ui.logToWorkspace(`返图重试失败：${message}`, "warn");
          }
        }
      } finally {
        autoPlacementProcessing = false;
        if (pendingAutoPlacements.size > 0) {
          schedulePendingAutoPlacementRetry(4e3);
        }
      }
    }
    async function autoPlaceResult(result) {
      if (!result || !result.outputUrl) throw new Error("当前没有可自动贴回 Photoshop 的结果");
      if (!modules.runtime.isPluginRuntime()) {
        modules.ui.logToWorkspace(`浏览器预览模式不会自动贴回结果，输出地址：${result.outputUrl}`, "info");
        return null;
      }
      await refreshPhotoshopDocumentStatus({ quiet: true });
      const placementPayload = buildAutoPlacementPayload(result);
      let response = null;
      try {
        response = await modules.runtime.callHost("photoshop.placeResultFromUrl", [placementPayload], { timeoutMs: 6e4 });
      } catch (error) {
        if (isAutoPlacementBlockedError(error)) {
          queueAutoPlacement(result);
          return {
            ok: false,
            queued: true,
            blocked: true,
            message: "Photoshop 当前正在执行液化或其他模态操作，返图已暂停，待可执行时会自动继续。"
          };
        }
        throw error;
      }
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
      let activeTaskId = tempTaskId;
      let activeRemoteTaskId = "";
      upsertRunningTask({
        taskId: tempTaskId,
        remoteTaskId: "",
        appName: payload.appName,
        status: "submitting",
        detail: "正在提交到 RunningHub...",
        accountSnapshot: getCurrentAccountSnapshot(),
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
        activeTaskId = remoteTaskId || tempTaskId;
        activeRemoteTaskId = remoteTaskId;
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
        scheduleAccountSummaryRefresh(600);
        const pollResult = await modules.runtime.callHost(
          "runninghub.pollTask",
          [{ apiKey: payload.apiKey, taskId: remoteTaskId, settings: payload.settings }],
          { timeoutMs: Math.max(15e3, Number(payload.settings.timeout || 180) * 1e3 + 15e3) }
        );
        if (pollResult && pollResult.timedOut) {
          const timeoutDetail = pollResult.stillRunning ? `本地等待超时，但云端状态仍为 ${pollResult.status || "RUNNING"}，已切换为后台追踪。` : `本地等待超时，当前状态：${pollResult.status || "未知"}。已切换为后台追踪继续确认。`;
          upsertRunningTask({
            taskId: remoteTaskId,
            remoteTaskId,
            appName: payload.appName,
            status: pollResult.stillRunning ? "remote-running" : "tracking",
            detail: timeoutDetail,
            sourceDocument
          });
          modules.ui.logToWorkspace(timeoutDetail, "warn");
          startTaskStatusTracking(remoteTaskId, payload, sourceDocument);
          return;
        }
        if (pollResult && pollResult.failed) {
          const finishedAt = Date.now();
          const failedMessage = String(pollResult.message || "任务执行失败").trim();
          const failureLabel = getTaskFailureLabel({
            status: pollResult.status || "failed",
            errorMessage: failedMessage,
            detail: failedMessage
          });
          upsertRunningTask({
            taskId: remoteTaskId,
            remoteTaskId,
            appName: payload.appName,
            status: "failed",
            detail: failedMessage,
            errorMessage: failedMessage,
            charge: pollResult.charge,
            balanceCharge: pollResult.balanceCharge,
            coinsCharge: pollResult.coinsCharge,
            chargeDisplay: pollResult.chargeDisplay,
            failureLabel,
            sourceDocument,
            finishedAt
          });
          if (pollResult.chargeDisplay || pollResult.balanceCharge != null || pollResult.coinsCharge != null) {
            scheduleAccountSummaryRefresh();
          } else {
            await refreshAccountAndPatchTaskCharge(remoteTaskId);
          }
          modules.ui.logToWorkspace(`任务失败：${failureLabel || failedMessage}`, "error");
          return;
        }
        const completedAt = Date.now();
        upsertRunningTask({
          taskId: remoteTaskId,
          remoteTaskId,
          appName: payload.appName,
          status: "succeeded",
          detail: "任务已完成，结果已返回。",
          charge: pollResult && pollResult.charge,
          balanceCharge: pollResult && pollResult.balanceCharge,
          coinsCharge: pollResult && pollResult.coinsCharge,
          chargeDisplay: pollResult && pollResult.chargeDisplay,
          outputUrl: String(pollResult.outputUrl || "").trim(),
          sourceDocument,
          finishedAt: completedAt
        });
        if (pollResult && (pollResult.chargeDisplay || pollResult.balanceCharge != null || pollResult.coinsCharge != null)) {
          scheduleAccountSummaryRefresh();
        } else {
          await refreshAccountAndPatchTaskCharge(remoteTaskId);
        }
        setLastResult({
          appName: payload.appName,
          sourceDocument,
          outputUrl: pollResult.outputUrl,
          taskId: remoteTaskId
        });
        modules.ui.logToWorkspace(`任务已完成，结果地址：${pollResult.outputUrl}`, "success");
        let placementResponse = null;
        try {
          placementResponse = await autoPlaceResult({
            appName: payload.appName,
            sourceDocument,
            outputUrl: pollResult.outputUrl,
            taskId: remoteTaskId
          });
          if (placementResponse && placementResponse.queued) {
            upsertRunningTask({
              taskId: remoteTaskId,
              remoteTaskId,
              appName: payload.appName,
              status: "succeeded",
              detail: "任务已完成，但 Photoshop 当前正忙，返图已暂停，稍后会自动继续贴回。"
            });
            return;
          }
        } catch (placementError) {
          const placementMessage = placementError && placementError.message ? placementError.message : String(placementError || "自动贴回 Photoshop 失败");
          modules.ui.logToWorkspace(`任务已完成，但自动贴回失败：${placementMessage}`, "warn");
        }
        upsertRunningTask({
          taskId: remoteTaskId,
          remoteTaskId,
          appName: payload.appName,
          status: "succeeded",
          detail: placementResponse && placementResponse.documentId ? `任务已完成，并已自动贴回 Photoshop 文档 #${placementResponse.documentId}。` : "任务已完成，可在任务结果地址基础上手动继续处理。"
        });
      } catch (error) {
        const message = error && error.message ? error.message : String(error || "任务执行失败");
        const normalizedMessage = String(message).trim();
        const cancelled = /cancel/i.test(normalizedMessage);
        const failureLabel = getTaskFailureLabel({
          status: cancelled ? "cancelled" : "failed",
          errorMessage: normalizedMessage,
          detail: normalizedMessage
        });
        if (cancelled && activeRemoteTaskId) {
          stopTaskStatusTracking(activeRemoteTaskId);
          pendingAutoPlacements.delete(activeRemoteTaskId);
        }
        upsertRunningTask({
          taskId: activeTaskId,
          remoteTaskId: activeRemoteTaskId,
          appName: payload.appName,
          status: cancelled ? "cancelled" : "failed",
          detail: cancelled ? "任务已取消。" : normalizedMessage,
          errorMessage: cancelled ? "" : normalizedMessage,
          failureLabel,
          sourceDocument,
          finishedAt: Date.now()
        });
        scheduleAccountSummaryRefresh();
        modules.ui.logToWorkspace(normalizedMessage, cancelled ? "warn" : "error");
      }
    }
    function bindWorkspaceActions() {
      const runButton = modules.runtime.getById("btnRun");
      const dynamicInputContainer = modules.runtime.getById("dynamicInputContainer");
      const createQuickEntryButton = modules.runtime.getById("btnCreateQuickEntry");
      const quickEntryNameTitle = modules.runtime.getById("quickEntryNameTitle");
      const quickEntryNameInput = modules.runtime.getById("quickEntryNameInput");
      const quickEntryNameClose = modules.runtime.getById("quickEntryNameModalClose");
      const quickEntryNameCancel = modules.runtime.getById("btnCancelQuickEntryName");
      const quickEntryNameSave = modules.runtime.getById("btnSaveQuickEntryName");
      const quickEntryNameHint = modules.runtime.getById("quickEntryNameHint");
      const quickEntryDeleteClose = modules.runtime.getById("quickEntryDeleteModalClose");
      const quickEntryDeleteCancel = modules.runtime.getById("btnCancelQuickEntryDelete");
      const quickEntryDeleteConfirm = modules.runtime.getById("btnConfirmQuickEntryDelete");
      const quickEntryDeleteHint = modules.runtime.getById("quickEntryDeleteHint");
      const quickEntryDialogState = {
        nameMode: "create",
        targetEntryId: "",
        deleteEntryId: ""
      };
      function openQuickEntryNameModal() {
        collectFormValuesFromDom();
        if (!modules.state.state.currentApp) {
          modules.ui.logToWorkspace("请先选择一个应用，再保存快捷入口。", "warn");
          return;
        }
        quickEntryDialogState.nameMode = "create";
        quickEntryDialogState.targetEntryId = "";
        if (quickEntryNameTitle) quickEntryNameTitle.textContent = "添加到快捷入口";
        if (quickEntryNameInput) {
          quickEntryNameInput.value = modules.state.getAppDisplayName(modules.state.state.currentApp);
        }
        if (quickEntryNameSave) quickEntryNameSave.textContent = "保存";
        if (quickEntryNameHint) {
          modules.runtime.setSummaryStatus(quickEntryNameHint, "将保存当前应用和全部非图片参数。运行时会要求先框选 Photoshop 区域。", "info");
        }
        setModalOpen("quickEntryNameModal", true);
        window.setTimeout(() => quickEntryNameInput && quickEntryNameInput.focus(), 0);
      }
      function closeQuickEntryNameModal() {
        setModalOpen("quickEntryNameModal", false);
      }
      function openQuickEntryRenameModal(entry) {
        if (!entry) return;
        quickEntryDialogState.nameMode = "rename";
        quickEntryDialogState.targetEntryId = String(entry.id || "");
        if (quickEntryNameTitle) quickEntryNameTitle.textContent = "重命名快捷入口";
        if (quickEntryNameInput) quickEntryNameInput.value = String(entry.title || "");
        if (quickEntryNameSave) quickEntryNameSave.textContent = "保存";
        if (quickEntryNameHint) {
          modules.runtime.setSummaryStatus(quickEntryNameHint, "只修改快捷入口名称，不改变保存的应用和参数。", "info");
        }
        setModalOpen("quickEntryNameModal", true);
        window.setTimeout(() => {
          if (!quickEntryNameInput) return;
          quickEntryNameInput.focus();
          quickEntryNameInput.select();
        }, 0);
      }
      function openQuickEntryDeleteModal(entry) {
        if (!entry) return;
        quickEntryDialogState.deleteEntryId = String(entry.id || "");
        if (quickEntryDeleteHint) {
          modules.runtime.setSummaryStatus(quickEntryDeleteHint, `确定删除快捷入口“${entry.title || "未命名快捷入口"}”吗？这个操作不会删除应用卡片或提示词。`, "warn");
        }
        setModalOpen("quickEntryDeleteModal", true);
      }
      function closeQuickEntryDeleteModal() {
        quickEntryDialogState.deleteEntryId = "";
        setModalOpen("quickEntryDeleteModal", false);
      }
      async function saveQuickEntryFromModal() {
        if (!quickEntryNameInput) return;
        try {
          if (quickEntryDialogState.nameMode === "rename") {
            const entry = await modules.quickEntries.renameQuickEntry(quickEntryDialogState.targetEntryId, quickEntryNameInput.value);
            modules.runtime.setSummaryStatus(quickEntryNameHint, `快捷入口已重命名：${entry.title}`, "success");
            modules.ui.logToWorkspace(`快捷入口已重命名：${entry.title}`, "success");
          } else {
            const entry = await modules.quickEntries.createFromCurrentApp(quickEntryNameInput.value);
            modules.runtime.setSummaryStatus(quickEntryNameHint, `快捷入口已保存：${entry.title}`, "success");
            modules.ui.logToWorkspace(`快捷入口已保存：${entry.title}`, "success");
          }
          closeQuickEntryNameModal();
        } catch (error) {
          modules.runtime.setSummaryStatus(quickEntryNameHint, `${quickEntryDialogState.nameMode === "rename" ? "重命名" : "保存"}失败：${error.message}`, "error");
          modules.ui.logToWorkspace(`快捷入口保存失败：${error.message}`, "error");
        }
      }
      if (dynamicInputContainer) {
        dynamicInputContainer.addEventListener("input", (event) => {
          const element = event.target;
          if (!element || !element.matches("[data-form-key]")) return;
          const key = element.getAttribute("data-form-key");
          if (!key) return;
          if (element.matches('input[type="checkbox"]')) {
            modules.state.state.formValues[key] = Boolean(element.checked);
            if (modules.aiOptimize && typeof modules.aiOptimize.handleWorkspacePromptChange === "function") {
              modules.aiOptimize.handleWorkspacePromptChange(key, modules.state.state.formValues[key]);
            }
            return;
          }
          const inputMeta = (modules.state.state.currentApp?.inputs || []).find((item) => String(item.key || "") === key);
          if (!inputMeta || isImageInput(inputMeta)) return;
          const nextValue = getNormalizedFieldValue(inputMeta, element.value);
          modules.state.state.formValues[key] = nextValue;
          if (modules.aiOptimize && typeof modules.aiOptimize.handleWorkspacePromptChange === "function") {
            modules.aiOptimize.handleWorkspacePromptChange(key, nextValue);
          }
        });
        dynamicInputContainer.addEventListener("change", (event) => {
          const element = event.target;
          if (!element || !element.matches("[data-form-key]")) return;
          const key = element.getAttribute("data-form-key");
          if (!key) return;
          if (element.matches('input[type="checkbox"]')) {
            modules.state.state.formValues[key] = Boolean(element.checked);
            if (modules.aiOptimize && typeof modules.aiOptimize.handleWorkspacePromptChange === "function") {
              modules.aiOptimize.handleWorkspacePromptChange(key, modules.state.state.formValues[key]);
            }
            return;
          }
          const inputMeta = (modules.state.state.currentApp?.inputs || []).find((item) => String(item.key || "") === key);
          if (!inputMeta || isImageInput(inputMeta)) return;
          const nextValue = getNormalizedFieldValue(inputMeta, element.value);
          modules.state.state.formValues[key] = nextValue;
          if (modules.aiOptimize && typeof modules.aiOptimize.handleWorkspacePromptChange === "function") {
            modules.aiOptimize.handleWorkspacePromptChange(key, nextValue);
          }
          if (isNumericInput(inputMeta) && element.matches('input[type="number"]')) {
            element.value = formatNumericInputValue(inputMeta, nextValue);
          }
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
          if (action === "open-ai-optimize") {
            event.preventDefault();
            modules.aiOptimize.openModal(key);
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
        dynamicInputContainer.addEventListener("click", async (event) => {
          const actionTarget = event.target && event.target.closest("[data-action][data-quick-entry-id]");
          if (!actionTarget) return;
          const action = actionTarget.getAttribute("data-action");
          const entryId = actionTarget.getAttribute("data-quick-entry-id");
          if (!action || !entryId) return;
          if (action === "run-quick-entry") {
            actionTarget.disabled = true;
            try {
              await runQuickEntry(entryId);
            } catch (error) {
              const message = error && error.message ? error.message : String(error || "快捷入口运行失败");
              if (message.includes("\n") && typeof global.alert === "function") global.alert(message);
              modules.ui.logToWorkspace(`快捷入口运行失败：${message.replace(/\s+/g, " ")}`, "warn");
              updateRunButtonState();
            } finally {
              actionTarget.disabled = false;
            }
            return;
          }
          if (action === "rename-quick-entry") {
            const entry = modules.state.state.quickEntries.find((item) => String(item.id || "") === String(entryId));
            openQuickEntryRenameModal(entry);
            return;
          }
          if (action === "delete-quick-entry") {
            const entry = modules.state.state.quickEntries.find((item) => String(item.id || "") === String(entryId));
            openQuickEntryDeleteModal(entry);
          }
        });
      }
      if (createQuickEntryButton) createQuickEntryButton.addEventListener("click", openQuickEntryNameModal);
      if (quickEntryNameClose) quickEntryNameClose.addEventListener("click", closeQuickEntryNameModal);
      if (quickEntryNameCancel) quickEntryNameCancel.addEventListener("click", closeQuickEntryNameModal);
      if (quickEntryNameSave) quickEntryNameSave.addEventListener("click", saveQuickEntryFromModal);
      if (quickEntryNameInput) {
        quickEntryNameInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void saveQuickEntryFromModal();
          }
        });
      }
      if (quickEntryDeleteClose) quickEntryDeleteClose.addEventListener("click", closeQuickEntryDeleteModal);
      if (quickEntryDeleteCancel) quickEntryDeleteCancel.addEventListener("click", closeQuickEntryDeleteModal);
      if (quickEntryDeleteConfirm) {
        quickEntryDeleteConfirm.addEventListener("click", async () => {
          const entryId = quickEntryDialogState.deleteEntryId;
          const entry = modules.state.state.quickEntries.find((item) => String(item.id || "") === String(entryId));
          try {
            await modules.quickEntries.deleteQuickEntry(entryId);
            modules.ui.logToWorkspace(`快捷入口已删除：${entry ? entry.title : entryId}`, "warn");
            closeQuickEntryDeleteModal();
          } catch (error) {
            modules.runtime.setSummaryStatus(quickEntryDeleteHint, `删除失败：${error.message}`, "error");
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
            const fallbackSourceDocument = await captureSourceDocumentInfo();
            const sourceDocument = resolveSourceDocumentFromImageInputs(
              modules.state.state.currentApp,
              modules.state.state.formValues,
              fallbackSourceDocument
            );
            startRunTaskFlow(payload, sourceDocument);
          } catch (error) {
            modules.ui.logToWorkspace(error.message, "warn");
            updateRunButtonState();
          }
        });
      }
      document.addEventListener("click", async (event) => {
        if (event.target && event.target.closest("#quickEntryNameBackdrop")) {
          closeQuickEntryNameModal();
          return;
        }
        if (event.target && event.target.closest("#quickEntryDeleteBackdrop")) {
          closeQuickEntryDeleteModal();
          return;
        }
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
            stopTaskStatusTracking(remoteTaskId);
            pendingAutoPlacements.delete(remoteTaskId);
            await modules.runtime.callHost("runninghub.cancelTask", [{ apiKey, taskId: remoteTaskId }], { timeoutMs: 2e4 });
            upsertRunningTask({
              taskId,
              remoteTaskId,
              appName: currentTask && currentTask.appName ? currentTask.appName : "",
              status: "cancelled",
              detail: "任务已取消。",
              failureLabel: "已取消",
              finishedAt: Date.now()
            });
            scheduleAccountSummaryRefresh();
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
      collectFormValuesFromDom,
      captureWorkspaceFormSnapshot,
      restoreWorkspaceFormSnapshot,
      bindWorkspaceActions,
      refreshPhotoshopDocumentStatus
    };
  })(window);

  // src/webview/ai-optimize.js
  (function initAiOptimizeModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    const DEFAULT_UPLOAD_MAX_DIMENSION = 1536;
    const DEFAULT_UPLOAD_TARGET_BYTES = 9e6;
    const DEFAULT_UPLOAD_HARD_LIMIT_BYTES = 1e7;
    const DEFAULT_UPLOAD_QUALITY_STEPS = [0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6, 0.56, 0.52, 0.48];
    let taskTicker = 0;
    let composeSequence = 0;
    const state = {
      open: false,
      promptKey: "",
      promptLabel: "",
      promptValue: "",
      imageKey: "",
      imageLabel: "",
      imageAsset: null,
      extraRequirement: "",
      resultText: "",
      statusMessage: "点击“开始优化”后，这里会显示 AI 返回的优化提示词。",
      statusType: "info",
      running: false,
      canceling: false,
      taskId: "",
      taskStatus: "idle",
      taskDetail: "等待开始运行。",
      taskStartedAt: 0,
      taskUpdatedAt: 0,
      balanceCharge: null,
      coinsCharge: null,
      chargeDisplay: "",
      txtUrl: "",
      availableImages: [],
      selectedImageKey: "",
      selectedImageMode: "single",
      composingImage: false
    };
    function isImageInput(input) {
      const type = String(input && input.type || "").trim().toLowerCase();
      return type === "image" || type === "file";
    }
    function hasImageAsset(asset) {
      return Boolean(
        asset && typeof asset === "object" && (String(asset.dataUrl || "").trim() || String(asset.base64 || "").trim() || String(asset.url || "").trim() || String(asset.uploadDataUrl || "").trim() || String(asset.uploadBase64 || "").trim())
      );
    }
    function cloneValue(value) {
      if (value == null) return value;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
      if (Array.isArray(value)) return value.map(cloneValue);
      if (value && typeof value === "object") {
        const out = {};
        Object.keys(value).forEach((key) => {
          out[key] = cloneValue(value[key]);
        });
        return out;
      }
      return value;
    }
    function getPrimaryPromptInput(app) {
      const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
      const promptLike = inputs.filter((input) => modules.state.isPromptLikeInput(input) && !isImageInput(input));
      if (promptLike.length === 0) return null;
      const priority = ["prompt", "positive_prompt"];
      for (const key of priority) {
        const matched = promptLike.find((input) => String(input && input.key || "").trim().toLowerCase() === key);
        if (matched) return matched;
      }
      return promptLike[0];
    }
    function getFilledImageInputs(app, formValues) {
      const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
      return inputs.filter(isImageInput).map((input) => {
        const key = String(input && input.key || "").trim();
        const value = formValues && typeof formValues === "object" ? formValues[key] : null;
        if (!key || !hasImageAsset(value)) return null;
        return {
          key,
          label: String(input.label || input.name || key),
          asset: cloneValue(value),
          input
        };
      }).filter(Boolean);
    }
    function getImagePreviewSrc(asset) {
      if (!asset || typeof asset !== "object") return "";
      const candidates = [asset.dataUrl, asset.uploadDataUrl, asset.url];
      for (const candidate of candidates) {
        const text = String(candidate || "").trim();
        if (text) return text;
      }
      const base64 = String(asset.base64 || asset.uploadBase64 || "").trim();
      if (!base64) return "";
      const mimeType = String(asset.mimeType || asset.uploadMimeType || "image/jpeg").trim() || "image/jpeg";
      return `data:${mimeType};base64,${base64}`;
    }
    function getAssetSizeLabel(asset) {
      if (!asset || typeof asset !== "object") return "";
      const width = Number(asset.width || asset.originalWidth || 0);
      const height = Number(asset.height || asset.originalHeight || 0);
      if (!width || !height) return "";
      return `${width}x${height}`;
    }
    function getTaskStatusLabel(status) {
      const normalized = String(status || "").trim().toLowerCase();
      if (normalized === "running") return "运行中";
      if (normalized === "success") return "已完成";
      if (normalized === "cancelled" || normalized === "canceled") return "已取消";
      if (normalized === "error") return "失败";
      return "待开始";
    }
    function getTaskStatusTone(status) {
      const normalized = String(status || "").trim().toLowerCase();
      if (normalized === "running") return "pending";
      if (normalized === "success") return "success";
      if (normalized === "cancelled" || normalized === "canceled") return "warn";
      if (normalized === "error") return "error";
      return "info";
    }
    function normalizeTaskChargeValue(value) {
      if (value == null) return null;
      if (typeof value === "number") return Number.isFinite(value) ? Math.abs(Number(value.toFixed(3))) : null;
      const text = String(value || "").trim();
      if (!text) return null;
      const matched = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
      if (!matched) return null;
      const parsed = Number(matched[0]);
      return Number.isFinite(parsed) ? Math.abs(Number(parsed.toFixed(3))) : null;
    }
    function formatTaskChargeDisplay() {
      const explicit = String(state.chargeDisplay || "").trim();
      if (explicit) return explicit;
      const balanceCharge = normalizeTaskChargeValue(state.balanceCharge);
      const coinsCharge = normalizeTaskChargeValue(state.coinsCharge);
      const parts = [];
      if (balanceCharge !== null) parts.push(`-${balanceCharge.toFixed(3)}R`);
      if (coinsCharge !== null) parts.push(Number.isInteger(coinsCharge) ? `-${coinsCharge}RH` : `-${coinsCharge.toFixed(3)}RH`);
      return parts.join(" · ");
    }
    function setTaskCharge(result) {
      state.balanceCharge = result && result.balanceCharge != null ? normalizeTaskChargeValue(result.balanceCharge) : null;
      state.coinsCharge = result && result.coinsCharge != null ? normalizeTaskChargeValue(result.coinsCharge) : null;
      state.chargeDisplay = String(result && result.chargeDisplay || "").trim();
    }
    function formatElapsed(startedAt, updatedAt = Date.now()) {
      const diff = Math.max(0, Number(updatedAt || 0) - Number(startedAt || 0));
      const seconds = Math.floor(diff / 1e3);
      const minutes = Math.floor(seconds / 60);
      const remainSeconds = seconds % 60;
      if (minutes <= 0) return `${remainSeconds}s`;
      return `${minutes}m ${remainSeconds}s`;
    }
    function looksLikeTxtUrl(value) {
      return /\.txt(?:$|[?#])/i.test(String(value || "").trim());
    }
    function looksLikeTxtName(value) {
      return /\.txt$/i.test(String(value || "").trim());
    }
    function collectTxtResultCandidates(payload, results = [], seen = /* @__PURE__ */ new Set(), depth = 0) {
      if (!payload || depth > 6) return results;
      if (typeof payload === "string") {
        if (looksLikeTxtUrl(payload) && !seen.has(payload)) {
          seen.add(payload);
          results.push({ url: payload, fileName: "" });
        }
        return results;
      }
      if (Array.isArray(payload)) {
        payload.forEach((item) => collectTxtResultCandidates(item, results, seen, depth + 1));
        return results;
      }
      if (typeof payload !== "object") return results;
      const source = payload;
      const fileName = String(
        source.fileName || source.filename || source.name || source.title || source.label || source.key || ""
      ).trim();
      const directUrl = String(
        source.url || source.fileUrl || source.downloadUrl || source.download_url || source.resultUrl || source.textUrl || ""
      ).trim();
      if (directUrl && (looksLikeTxtUrl(directUrl) || looksLikeTxtName(fileName))) {
        const marker = `${directUrl}|${fileName}`;
        if (!seen.has(marker)) {
          seen.add(marker);
          results.push({ url: directUrl, fileName });
        }
      }
      Object.values(source).forEach((value) => {
        if (value && typeof value === "object") {
          collectTxtResultCandidates(value, results, seen, depth + 1);
          return;
        }
        if (typeof value === "string" && looksLikeTxtUrl(value) && !seen.has(value)) {
          seen.add(value);
          results.push({ url: value, fileName });
        }
      });
      return results;
    }
    function pickPreferredPromptInput(inputs) {
      const list = Array.isArray(inputs) ? inputs : [];
      const promptLike = list.filter((input) => {
        const hint = `${input && input.key ? input.key : ""} ${input && input.label ? input.label : ""} ${input && input.name ? input.name : ""}`.toLowerCase();
        return /prompt|positive/.test(hint) && !/negative/.test(hint);
      });
      if (promptLike.length === 0) return null;
      const priority = ["prompt", "positive_prompt"];
      for (const key of priority) {
        const matched = promptLike.find((input) => String(input && input.key || "").trim().toLowerCase() === key);
        if (matched) return matched;
      }
      return promptLike[0];
    }
    function pickPreferredTextInput(inputs) {
      const list = Array.isArray(inputs) ? inputs : [];
      const promptInput = pickPreferredPromptInput(list);
      if (promptInput) return promptInput;
      return list.find((input) => !isImageInput(input)) || null;
    }
    function buildAiOptimizePromptText() {
      const basePrompt = String(state.promptValue || "").trim();
      const extraRequirement = String(state.extraRequirement || "").trim();
      const sections = [
        "请基于参考图和以下文本，优化为可直接用于图像生成或修图工作流的正向 prompt。",
        `【当前主 prompt】
${basePrompt || "（未填写）"}`,
        `【附加优化要求】
${extraRequirement || "无。"}`
      ];
      sections.push(`【输出要求】
1. 只输出优化后的 prompt 正文，不要输出解释、标题、Markdown 或编号。
2. 保留当前主 prompt 中明确的人物、主体、构图、风格、材质、色彩和限制条件。
3. 根据参考图补充清晰、可执行的画面细节，让结果适合直接提交给 RunningHub 图像工作流。
4. 不要编造与参考图或当前主 prompt 冲突的主体信息。`);
      return sections.join("\n\n");
    }
    function getBase64ByteLength(base64) {
      const text = String(base64 || "").trim();
      if (!text) return 0;
      const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
      return Math.max(0, Math.floor(text.length * 3 / 4) - padding);
    }
    function getAssetUploadPayload(asset) {
      if (!asset || typeof asset !== "object") return null;
      const dataUrl = String(asset.uploadDataUrl || asset.dataUrl || "").trim();
      const base64 = String(asset.uploadBase64 || asset.base64 || "").trim();
      const mimeType = String(asset.uploadMimeType || asset.mimeType || "image/jpeg").trim() || "image/jpeg";
      if (!dataUrl && !base64 && !String(asset.url || "").trim()) return null;
      return {
        dataUrl,
        base64,
        url: String(asset.url || "").trim(),
        mimeType,
        width: Number(asset.originalWidth) || Number(asset.width) || null,
        height: Number(asset.originalHeight) || Number(asset.height) || null,
        bytes: Number(asset.uploadBytes) || getBase64ByteLength(base64),
        quality: Number(asset.uploadQuality) || null
      };
    }
    function getScaledDimensions(width, height, maxDimension) {
      const safeWidth = Math.max(1, Math.round(Number(width) || 1));
      const safeHeight = Math.max(1, Math.round(Number(height) || 1));
      const longEdge = Math.max(safeWidth, safeHeight);
      if (longEdge <= maxDimension) {
        return { width: safeWidth, height: safeHeight };
      }
      const scale = maxDimension / longEdge;
      return {
        width: Math.max(1, Math.round(safeWidth * scale)),
        height: Math.max(1, Math.round(safeHeight * scale))
      };
    }
    function canvasToBlob(canvas, quality) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("AI优化图片压缩失败，请换一张图片或降低图片尺寸后重试。"));
            return;
          }
          resolve(blob);
        }, "image/jpeg", quality);
      });
    }
    function readBlobAsDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("AI优化图片读取失败，请重新导入图片后重试。"));
        reader.readAsDataURL(blob);
      });
    }
    async function buildCompressedUploadPayload(asset) {
      const src = getImagePreviewSrc(asset);
      if (!src) {
        throw new Error("当前参考图缺少可提交的数据，请重新导入图片。");
      }
      const image = await loadImageElement(src);
      const targetSize = getScaledDimensions(image.width, image.height, DEFAULT_UPLOAD_MAX_DIMENSION);
      const canvas = document.createElement("canvas");
      canvas.width = targetSize.width;
      canvas.height = targetSize.height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("浏览器无法创建图片压缩画布，请重启插件后重试。");
      }
      context.fillStyle = "#101720";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let fallbackPayload = null;
      for (const quality of DEFAULT_UPLOAD_QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, quality);
        const dataUrl = await readBlobAsDataUrl(blob);
        const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : "";
        const payload = {
          dataUrl,
          base64,
          url: "",
          mimeType: "image/jpeg",
          width: canvas.width,
          height: canvas.height,
          bytes: blob.size,
          quality: Math.round(quality * 100)
        };
        fallbackPayload = payload;
        if (blob.size <= DEFAULT_UPLOAD_TARGET_BYTES) {
          return payload;
        }
        if (blob.size <= DEFAULT_UPLOAD_HARD_LIMIT_BYTES) {
          fallbackPayload = payload;
        }
      }
      if (fallbackPayload) return fallbackPayload;
      throw new Error("AI优化参考图压缩后仍超过大小限制，请换一张更小的图片后重试。");
    }
    async function prepareImageForSubmission(asset) {
      const payload = getAssetUploadPayload(asset);
      if (payload && String(asset && asset.uploadDataUrl || "").trim()) {
        return payload;
      }
      return payload && payload.bytes > 0 && payload.bytes <= DEFAULT_UPLOAD_HARD_LIMIT_BYTES ? payload : buildCompressedUploadPayload(asset);
    }
    async function resolveResultText(pollResult, timeoutSeconds) {
      const txtCandidates = collectTxtResultCandidates(pollResult && pollResult.result || null);
      const txtCandidate = txtCandidates[0] || null;
      if (!txtCandidate || !txtCandidate.url) {
        throw new Error("AI优化应用未返回可解析的 .txt 文本结果，请检查工作流输出配置。");
      }
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutMs = Math.max(1e4, Number(timeoutSeconds || 180) * 1e3);
      const timer = controller ? global.setTimeout(() => controller.abort(), timeoutMs) : 0;
      try {
        const response = await fetch(txtCandidate.url, {
          method: "GET",
          signal: controller ? controller.signal : void 0
        });
        if (!response.ok) {
          throw new Error(`读取优化结果失败 (HTTP ${response.status})`);
        }
        const text = String(await response.text()).trim();
        if (!text) {
          throw new Error("AI优化应用返回的 .txt 结果为空。");
        }
        return {
          text,
          txtUrl: txtCandidate.url,
          txtFileName: txtCandidate.fileName || ""
        };
      } finally {
        if (timer) global.clearTimeout(timer);
      }
    }
    function updateWorkspacePromptHint(field, text) {
      if (!field || !modules.templates) return;
      const hint = field.querySelector(".prompt-length-hint");
      if (!hint) return;
      const value = String(text || "");
      const length = modules.templates.getTextLength(value);
      const tail = modules.templates.getTailPreview(value, 24);
      hint.textContent = `长度 ${length} 字符 | 末尾预览 ${tail}`;
      hint.classList.toggle("is-warning", length >= modules.templates.PROMPT_WARN_CHARS);
    }
    function syncPromptToWorkspace(value) {
      if (!state.promptKey) return;
      const nextValue = String(value ?? "");
      modules.state.state.formValues[state.promptKey] = nextValue;
      const container = modules.runtime.getById("dynamicInputContainer");
      if (!container) return;
      const target = Array.from(container.querySelectorAll("[data-form-key]")).find((element) => {
        return String(element.getAttribute("data-form-key") || "") === state.promptKey;
      });
      if (!target) return;
      if ("value" in target && target.value !== nextValue) {
        target.value = nextValue;
      }
      updateWorkspacePromptHint(target.closest(".prompt-field"), nextValue);
    }
    function renderTaskCard() {
      const container = modules.runtime.getById("aiOptimizeTaskCard");
      if (!container) return;
      const taskId = String(state.taskId || "").trim();
      const status = getTaskStatusLabel(state.taskStatus);
      const tone = getTaskStatusTone(state.taskStatus);
      const duration = state.taskStartedAt ? formatElapsed(state.taskStartedAt, state.taskUpdatedAt || Date.now()) : "--";
      const chargeDisplay = formatTaskChargeDisplay();
      const shortTaskId = taskId ? `#${taskId.slice(-8)}` : "尚未创建任务";
      const detail = modules.runtime.escapeHtml(state.taskDetail || "等待开始。");
      const showCancel = state.running && taskId;
      const showClear = !state.running && taskId;
      container.innerHTML = `
      <div class="running-task-item ai-optimize-task-item">
        <div class="running-task-main">
          <div class="running-task-topline">
            <div class="running-task-title">AI优化任务</div>
            <div class="running-task-topline-actions">
              <span class="status-chip running-task-status-chip" data-status="${modules.runtime.escapeHtml(tone)}">${modules.runtime.escapeHtml(status)}</span>
              ${showCancel ? `<button id="btnCancelAiOptimizeTask" class="mini-btn running-task-inline-btn" type="button" ${state.canceling ? "disabled" : ""}>${state.canceling ? "取消中" : "取消"}</button>` : showClear ? `<button id="btnClearAiOptimizeTask" class="mini-btn running-task-inline-btn" type="button">清空</button>` : ""}
            </div>
          </div>
          <div class="running-task-meta">${modules.runtime.escapeHtml(shortTaskId)} · 耗时 ${modules.runtime.escapeHtml(duration)}${chargeDisplay ? ` · ${modules.runtime.escapeHtml(chargeDisplay)}` : ""}</div>
          <div class="running-task-detail">${detail}</div>
        </div>
      </div>
    `;
      const cancelButton = modules.runtime.getById("btnCancelAiOptimizeTask");
      if (cancelButton) {
        cancelButton.addEventListener("click", () => {
          void cancelTask();
        });
      }
      const clearButton = modules.runtime.getById("btnClearAiOptimizeTask");
      if (clearButton) {
        clearButton.addEventListener("click", () => {
          state.taskId = "";
          state.taskStatus = "idle";
          state.taskDetail = "等待开始运行。";
          state.taskStartedAt = 0;
          state.taskUpdatedAt = 0;
          state.balanceCharge = null;
          state.coinsCharge = null;
          state.chargeDisplay = "";
          renderModal();
        });
      }
    }
    function syncTaskTicker() {
      if (state.running && !taskTicker) {
        taskTicker = global.setInterval(() => {
          state.taskUpdatedAt = Date.now();
          renderTaskCard();
        }, 1e3);
        return;
      }
      if (!state.running && taskTicker) {
        global.clearInterval(taskTicker);
        taskTicker = 0;
      }
    }
    function setStatus(message, type = "info") {
      state.statusMessage = String(message || "");
      state.statusType = String(type || "info");
      const statusEl = modules.runtime.getById("aiOptimizeStatus");
      if (statusEl) {
        modules.runtime.setSummaryStatus(statusEl, state.statusMessage, state.statusType);
      }
    }
    function getErrorMessage(error, fallback = "AI优化失败，请稍后重试。") {
      const raw = String(error && error.message || error || "").trim();
      if (!raw) return fallback;
      if (/runninghub api key is missing/i.test(raw)) return "请先在设置页保存 RunningHub API Key。";
      if (/runninghub app id is missing|ai optimize appid is missing/i.test(raw)) {
        return "当前未配置 AI优化应用 ID，请到设置页高级设置中填写。";
      }
      if (/ai optimize image is missing/i.test(raw)) return "当前没有可提交的参考图，请先选择图片。";
      if (/runninghub taskid is missing/i.test(raw)) return "RunningHub 未返回有效任务 ID，请稍后重试。";
      if (/task polling timed out/i.test(raw)) return "AI优化任务等待超时，请稍后在 RunningHub 查看任务状态或重试。";
      if (/runninghub task submission failed/i.test(raw)) return "RunningHub 任务提交失败，请检查 API Key、应用 ID 和网络状态。";
      return raw;
    }
    function isCancelMessage(message) {
      return /cancel|取消/i.test(String(message || ""));
    }
    function syncContextFromWorkspace(promptKey = "") {
      if (modules.workspace && typeof modules.workspace.captureWorkspaceFormSnapshot === "function") {
        modules.workspace.captureWorkspaceFormSnapshot();
      }
      const app = modules.state.state.currentApp;
      const promptInput = getPrimaryPromptInput(app);
      const filledImages = getFilledImageInputs(app, modules.state.state.formValues);
      const resolvedPromptKey = String(promptKey || promptInput && promptInput.key || "").trim();
      const resolvedPromptInput = (Array.isArray(app && app.inputs) ? app.inputs : []).find((input) => String(input && input.key || "") === resolvedPromptKey) || promptInput;
      state.promptKey = resolvedPromptInput ? String(resolvedPromptInput.key || "") : "";
      state.promptLabel = resolvedPromptInput ? String(resolvedPromptInput.label || resolvedPromptInput.name || resolvedPromptInput.key || "") : "";
      state.promptValue = String(state.promptKey && modules.state.state.formValues[state.promptKey] || "");
      state.availableImages = filledImages;
      if (!filledImages.some((item) => item.key === state.selectedImageKey)) {
        state.selectedImageKey = filledImages[0] ? filledImages[0].key : "";
        state.selectedImageMode = "single";
      }
    }
    function getAvailability(promptKey = "") {
      syncContextFromWorkspace(promptKey);
      if (!modules.state.state.currentApp) {
        return { available: false, reason: "请先在工作台选择一个应用。" };
      }
      if (!state.promptKey) {
        return { available: false, reason: "当前应用未检测到可写入的主提示词字段。" };
      }
      if (state.availableImages.length === 0) {
        return { available: true, reason: "请先在当前应用里导入至少一张图片，然后再开始 AI优化。" };
      }
      return { available: true, reason: "" };
    }
    async function loadImageElement(src) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("图片加载失败，无法拼接多图。"));
        image.src = src;
      });
    }
    async function composeImageAssets(entries) {
      const validEntries = (Array.isArray(entries) ? entries : []).filter((item) => item && hasImageAsset(item.asset));
      if (validEntries.length === 0) throw new Error("当前没有可拼接的图片。");
      if (validEntries.length === 1) return cloneValue(validEntries[0].asset);
      const images = await Promise.all(
        validEntries.map(async (item) => {
          const src = getImagePreviewSrc(item.asset);
          if (!src) throw new Error(`图片 ${item.label || item.key} 缺少预览源，无法拼接。`);
          return {
            image: await loadImageElement(src),
            label: item.label || item.key,
            asset: item.asset
          };
        })
      );
      const columnCount = images.length <= 2 ? images.length : 2;
      const rowCount = Math.ceil(images.length / columnCount);
      const cellSize = 512;
      const canvas = document.createElement("canvas");
      canvas.width = columnCount * cellSize;
      canvas.height = rowCount * cellSize;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前环境不支持图片拼接。");
      context.fillStyle = "#101720";
      context.fillRect(0, 0, canvas.width, canvas.height);
      images.forEach((item, index) => {
        const col = index % columnCount;
        const row = Math.floor(index / columnCount);
        const x = col * cellSize;
        const y = row * cellSize;
        const scale = Math.min(cellSize / item.image.width, cellSize / item.image.height);
        const width = Math.max(1, Math.round(item.image.width * scale));
        const height = Math.max(1, Math.round(item.image.height * scale));
        const offsetX = x + Math.round((cellSize - width) / 2);
        const offsetY = y + Math.round((cellSize - height) / 2);
        context.fillStyle = "#131c25";
        context.fillRect(x, y, cellSize, cellSize);
        context.drawImage(item.image, offsetX, offsetY, width, height);
        context.strokeStyle = "rgba(126, 154, 181, 0.6)";
        context.lineWidth = 4;
        context.strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
      });
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : "";
      return {
        dataUrl,
        base64,
        mimeType: "image/jpeg",
        width: canvas.width,
        height: canvas.height,
        originalWidth: canvas.width,
        originalHeight: canvas.height,
        source: "ai-optimize-collage",
        kind: "collage-image"
      };
    }
    async function refreshSelectedImageAsset() {
      const currentComposeId = ++composeSequence;
      if (state.selectedImageMode === "composite" && state.availableImages.length > 1) {
        state.composingImage = true;
        state.imageKey = "composite";
        state.imageLabel = `拼接全部 ${state.availableImages.length} 张图`;
        renderModal();
        try {
          const composed = await composeImageAssets(state.availableImages);
          if (currentComposeId !== composeSequence) return;
          state.imageAsset = composed;
          state.composingImage = false;
          renderModal();
        } catch (error) {
          if (currentComposeId !== composeSequence) return;
          state.composingImage = false;
          state.imageAsset = null;
          setStatus(error.message || "多图拼接失败。", "error");
          renderModal();
        }
        return;
      }
      const selected = state.availableImages.find((item) => item.key === state.selectedImageKey) || state.availableImages[0] || null;
      state.imageKey = selected ? selected.key : "";
      state.imageLabel = selected ? selected.label : "";
      state.imageAsset = selected ? cloneValue(selected.asset) : null;
      state.composingImage = false;
      renderModal();
    }
    function buildUsageHint() {
      const imageCount = state.availableImages.length;
      if (imageCount <= 0) {
        return "请先回到工作台，在当前应用中导入图片并填写主提示词后，再打开这个窗口。";
      }
      if (imageCount === 1) {
        return "当前会使用这张已导入图片和“原始提示词”作为 AI优化输入。你可以在“附加优化要求”里补充希望强化的方向。";
      }
      return "当前应用里已检测到多张图片。你可以选择任意一张作为优化参考，或切换为“拼接全部图片”后再运行优化。";
    }
    function renderImagePicker() {
      const container = modules.runtime.getById("aiOptimizeImagePicker");
      const modeContainer = modules.runtime.getById("aiOptimizeImageMode");
      if (!container || !modeContainer) return;
      const canCompose = state.availableImages.length > 1;
      modeContainer.innerHTML = `
      <button class="mini-btn ${state.selectedImageMode === "single" ? "is-selected" : ""}" type="button" data-ai-opt-mode="single">单图</button>
      ${canCompose ? `<button class="mini-btn ${state.selectedImageMode === "composite" ? "is-selected" : ""}" type="button" data-ai-opt-mode="composite">拼接全部</button>` : ""}
    `;
      if (state.availableImages.length <= 1) {
        container.innerHTML = state.availableImages[0] ? `<div class="summary-strip">当前已检测到 1 张图片：${modules.runtime.escapeHtml(state.availableImages[0].label)}</div>` : `<div class="summary-strip">当前还没有可用图片。</div>`;
        return;
      }
      container.innerHTML = state.availableImages.map((item) => {
        const active = state.selectedImageMode === "single" && item.key === state.selectedImageKey;
        const sizeText = getAssetSizeLabel(item.asset);
        return `
          <button class="picker-item ${active ? "active" : ""}" type="button" data-ai-opt-image-key="${modules.runtime.escapeHtml(item.key)}">
            <span class="picker-item-title">${modules.runtime.escapeHtml(item.label)}</span>
            <span class="picker-item-meta">
              <span>${modules.runtime.escapeHtml(item.key)}</span>
              ${sizeText ? `<span>${modules.runtime.escapeHtml(sizeText)}</span>` : ""}
            </span>
          </button>
        `;
      }).join("");
    }
    function renderModal() {
      const previewImg = modules.runtime.getById("aiOptimizeImagePreview");
      const imageMeta = modules.runtime.getById("aiOptimizeImageMeta");
      const intro = modules.runtime.getById("aiOptimizeGuide");
      const promptInput = modules.runtime.getById("aiOptimizePromptInput");
      const extraInput = modules.runtime.getById("aiOptimizeExtraInput");
      const resultInput = modules.runtime.getById("aiOptimizeResultInput");
      const startButton = modules.runtime.getById("btnStartAiOptimize");
      const replaceButton = modules.runtime.getById("btnAiOptimizeReplace");
      const appendButton = modules.runtime.getById("btnAiOptimizeAppend");
      const modeHint = modules.runtime.getById("aiOptimizeImageModeHint");
      if (previewImg) {
        const src = getImagePreviewSrc(state.imageAsset);
        previewImg.src = src || "";
        previewImg.hidden = !src;
      }
      if (imageMeta) {
        imageMeta.textContent = state.composingImage ? "正在生成拼接预览..." : state.imageKey ? `${state.imageLabel || state.imageKey}${getAssetSizeLabel(state.imageAsset) ? ` · ${getAssetSizeLabel(state.imageAsset)}` : ""}` : "未检测到可用图片输入";
      }
      if (intro) intro.textContent = buildUsageHint();
      if (modeHint) {
        modeHint.textContent = state.selectedImageMode === "composite" ? "当前会把所有已输入图片拼接为一张，再作为 AI优化参考图。" : "当前会使用你选中的这张图作为 AI优化参考图。";
      }
      if (promptInput && promptInput.value !== String(state.promptValue || "")) promptInput.value = state.promptValue || "";
      if (extraInput && extraInput.value !== String(state.extraRequirement || "")) extraInput.value = state.extraRequirement || "";
      if (resultInput && resultInput.value !== String(state.resultText || "")) resultInput.value = state.resultText || "";
      if (startButton) startButton.disabled = state.running || state.composingImage || !hasImageAsset(state.imageAsset);
      if (replaceButton) replaceButton.disabled = state.running || !String(state.resultText || "").trim();
      if (appendButton) appendButton.disabled = state.running || !String(state.resultText || "").trim();
      syncTaskTicker();
      renderImagePicker();
      renderTaskCard();
      setStatus(state.statusMessage, state.statusType);
    }
    function openModal(promptKey = "") {
      const availability = getAvailability(promptKey);
      if (!availability.available) {
        modules.ui.logToWorkspace(availability.reason, "warn");
        return false;
      }
      state.open = true;
      state.extraRequirement = "";
      state.resultText = "";
      state.running = false;
      state.canceling = false;
      state.taskId = "";
      state.taskStatus = "idle";
      state.taskDetail = "等待开始运行。";
      state.taskStartedAt = 0;
      state.taskUpdatedAt = 0;
      state.balanceCharge = null;
      state.coinsCharge = null;
      state.chargeDisplay = "";
      state.txtUrl = "";
      if (state.availableImages.length === 0) {
        state.statusMessage = "当前还没有检测到图片。可以先编辑提示词，导入图片后再开始优化。";
        state.statusType = "warn";
      } else if (String(state.promptValue || "").trim()) {
        state.statusMessage = "点击“开始优化”后，这里会显示 AI 返回的优化提示词。";
        state.statusType = "info";
      } else {
        state.statusMessage = "当前主 prompt 为空。请先填写原始提示词，或在弹窗中补齐后再开始优化。";
        state.statusType = "warn";
      }
      modules.workspace.setModalOpen("aiOptimizeModal", true);
      void refreshSelectedImageAsset();
      return true;
    }
    function closeModal() {
      state.open = false;
      state.running = false;
      state.canceling = false;
      syncTaskTicker();
      modules.workspace.setModalOpen("aiOptimizeModal", false);
    }
    async function cancelTask() {
      const taskId = String(state.taskId || "").trim();
      const apiKey = String(modules.state.state.settings.apiKey || "").trim();
      if (!state.running || !taskId || !apiKey || state.canceling) return;
      state.canceling = true;
      state.taskDetail = "正在取消 AI优化任务...";
      renderModal();
      try {
        await modules.runtime.callHost("runninghub.cancelTask", [{ apiKey, taskId }], { timeoutMs: 2e4 });
        state.running = false;
        state.canceling = false;
        state.taskStatus = "cancelled";
        state.taskUpdatedAt = Date.now();
        state.taskDetail = "任务已取消。";
        setStatus("AI优化任务已取消。", "warn");
        modules.ui.logToWorkspace(`AI优化任务已取消：${taskId}`, "warn");
      } catch (error) {
        state.canceling = false;
        const message = getErrorMessage(error, "取消 AI优化任务失败");
        setStatus(message, "error");
        modules.ui.logToWorkspace(message, "error");
      } finally {
        renderModal();
      }
    }
    function applyResult(mode) {
      const text = String(state.resultText || "").trim();
      if (!state.promptKey) {
        setStatus("未找到可写回的主 prompt 字段，请重新打开 AI优化窗口。", "error");
        renderModal();
        return;
      }
      if (!text) {
        setStatus("当前还没有可写回的 AI优化结果。", "warn");
        renderModal();
        return;
      }
      const currentValue = String(modules.state.state.formValues[state.promptKey] || "");
      const nextValue = mode === "append" && currentValue.trim() ? `${currentValue.replace(/\s+$/g, "")}

${text}` : text;
      modules.state.state.formValues[state.promptKey] = nextValue;
      state.promptValue = nextValue;
      syncPromptToWorkspace(nextValue);
      modules.workspace.renderWorkspace();
      modules.ui.logToWorkspace(mode === "append" ? "AI优化结果已追加到当前 prompt。" : "AI优化结果已替换当前 prompt。", "success");
      closeModal();
    }
    function bindModalEvents() {
      const promptInput = modules.runtime.getById("aiOptimizePromptInput");
      const extraInput = modules.runtime.getById("aiOptimizeExtraInput");
      const resultInput = modules.runtime.getById("aiOptimizeResultInput");
      const closeButton = modules.runtime.getById("aiOptimizeModalClose");
      const startButton = modules.runtime.getById("btnStartAiOptimize");
      const replaceButton = modules.runtime.getById("btnAiOptimizeReplace");
      const appendButton = modules.runtime.getById("btnAiOptimizeAppend");
      const imagePicker = modules.runtime.getById("aiOptimizeImagePicker");
      const imageMode = modules.runtime.getById("aiOptimizeImageMode");
      if (promptInput) {
        promptInput.addEventListener("input", () => {
          state.promptValue = promptInput.value || "";
        });
      }
      if (extraInput) {
        extraInput.addEventListener("input", () => {
          state.extraRequirement = extraInput.value || "";
        });
      }
      if (resultInput) {
        resultInput.addEventListener("input", () => {
          state.resultText = resultInput.value || "";
          renderModal();
        });
      }
      if (closeButton) {
        closeButton.addEventListener("click", closeModal);
      }
      if (imageMode) {
        imageMode.addEventListener("click", (event) => {
          const button = event.target && event.target.closest("[data-ai-opt-mode]");
          if (!button || state.running) return;
          const nextMode = String(button.getAttribute("data-ai-opt-mode") || "single");
          state.selectedImageMode = nextMode === "composite" ? "composite" : "single";
          void refreshSelectedImageAsset();
        });
      }
      if (imagePicker) {
        imagePicker.addEventListener("click", (event) => {
          const button = event.target && event.target.closest("[data-ai-opt-image-key]");
          if (!button || state.running) return;
          state.selectedImageMode = "single";
          state.selectedImageKey = String(button.getAttribute("data-ai-opt-image-key") || "");
          void refreshSelectedImageAsset();
        });
      }
      document.addEventListener("click", (event) => {
        if (event.target && event.target.closest("#aiOptimizeBackdrop")) {
          closeModal();
        }
      });
      if (startButton) {
        startButton.addEventListener("click", async () => {
          const localPromptValue = promptInput ? promptInput.value : state.promptValue;
          const availability = getAvailability(state.promptKey);
          state.promptValue = String(localPromptValue || "");
          if (!availability.available) {
            setStatus(availability.reason, "warn");
            renderModal();
            return;
          }
          if (!modules.runtime.isPluginRuntime()) {
            setStatus("浏览器预览模式下无法调用宿主执行 AI优化。", "warn");
            renderModal();
            return;
          }
          const apiKey = String(modules.state.state.settings.apiKey || "").trim();
          const aiOptimizeAppId = String(modules.state.state.settings.aiOptimizeAppId || modules.state.DEFAULT_AI_OPTIMIZE_APP_ID || "").trim();
          if (!apiKey) {
            setStatus("请先在设置页保存 RunningHub API Key。", "warn");
            renderModal();
            return;
          }
          if (!aiOptimizeAppId) {
            setStatus("当前未配置 AI优化应用 ID，请到设置页高级设置中填写。", "warn");
            renderModal();
            return;
          }
          if (!hasImageAsset(state.imageAsset)) {
            setStatus("当前没有可提交的参考图，请先选择图片。", "warn");
            renderModal();
            return;
          }
          if (!String(state.promptValue || "").trim()) {
            setStatus("请先填写当前主 prompt，再开始 AI优化。", "warn");
            renderModal();
            return;
          }
          state.running = true;
          state.canceling = false;
          state.resultText = "";
          state.taskId = "";
          state.taskStatus = "running";
          state.taskStartedAt = Date.now();
          state.taskUpdatedAt = state.taskStartedAt;
          state.taskDetail = "正在提交 AI优化任务...";
          state.balanceCharge = null;
          state.coinsCharge = null;
          state.chargeDisplay = "";
          state.txtUrl = "";
          setStatus("正在根据参考图、原始提示词和附加优化要求生成优化建议...", "pending");
          renderModal();
          const settings = {
            pollInterval: modules.state.state.settings.pollInterval,
            timeout: modules.state.state.settings.timeout,
            maxConcurrentTasks: modules.state.state.settings.maxConcurrentTasks
          };
          try {
            const parsedApp = await modules.runtime.callHost("runninghub.parseApp", [{
              appId: aiOptimizeAppId,
              apiKey,
              preferredName: "AI优化"
            }], {
              timeoutMs: Math.max(3e4, Number(modules.state.state.settings.timeout || 180) * 1e3 + 15e3)
            });
            const inputs = Array.isArray(parsedApp && parsedApp.inputs) ? parsedApp.inputs : [];
            const imageInput = inputs.find((input) => isImageInput(input));
            if (!imageInput) {
              throw new Error("AI优化应用未识别到图片输入项。");
            }
            const textInput = pickPreferredTextInput(inputs);
            if (!textInput) {
              throw new Error("AI优化应用未识别到可写入的提示词输入项。");
            }
            const submitPayload = {
              apiKey,
              appId: aiOptimizeAppId,
              appName: "AI优化",
              app: {
                id: `ai-optimize-${aiOptimizeAppId}`,
                appId: aiOptimizeAppId,
                name: "AI优化",
                inputs
              },
              inputs: {
                [imageInput.key]: await prepareImageForSubmission(state.imageAsset),
                [textInput.key]: buildAiOptimizePromptText()
              },
              settings
            };
            const submitResult = await modules.runtime.callHost("runninghub.submitTask", [submitPayload], {
              timeoutMs: Math.max(3e4, Number(modules.state.state.settings.timeout || 180) * 1e3 + 15e3)
            });
            state.taskId = String(submitResult && submitResult.taskId || "").trim();
            if (!state.taskId) {
              throw new Error("RunningHub 未返回有效任务 ID，请稍后重试。");
            }
            state.taskUpdatedAt = Date.now();
            state.taskDetail = "任务已提交，正在等待 RunningHub 返回结果。";
            renderModal();
            const pollResult = await modules.runtime.callHost("runninghub.pollTask", [{
              apiKey,
              taskId: state.taskId,
              settings
            }], {
              timeoutMs: Math.max(3e4, Number(modules.state.state.settings.timeout || 180) * 1e3 + 15e3)
            });
            if (!pollResult || pollResult.failed) {
              throw new Error(String(pollResult && pollResult.message || "AI优化任务执行失败"));
            }
            if (pollResult && pollResult.timedOut) {
              throw new Error(String(pollResult && pollResult.message || "AI优化任务超时"));
            }
            const result = await resolveResultText(pollResult, modules.state.state.settings.timeout);
            state.taskStatus = "success";
            state.taskUpdatedAt = Date.now();
            state.taskDetail = "任务已完成，已成功解析返回的 .txt 文本结果。";
            setTaskCharge(pollResult);
            state.txtUrl = String(result && result.txtUrl || "").trim();
            state.resultText = String(result && result.text || "").trim();
            if (!state.resultText) {
              throw new Error("AI优化应用未返回有效文本结果。");
            }
            setStatus("AI优化完成。先检查结果，确认后再选择“替换当前”或“追加到当前”。", "success");
            modules.ui.logToWorkspace("AI优化完成，结果已加载到弹窗。", "success");
          } catch (error) {
            const message = getErrorMessage(error);
            const cancelled = isCancelMessage(message);
            state.taskStatus = cancelled ? "cancelled" : "error";
            state.taskUpdatedAt = Date.now();
            state.taskDetail = cancelled ? "任务已取消。" : message;
            setStatus(cancelled ? "AI优化任务已取消。" : message, cancelled ? "warn" : "error");
            modules.ui.logToWorkspace(cancelled ? "AI优化任务已取消。" : message, cancelled ? "warn" : "error");
          } finally {
            state.running = false;
            state.canceling = false;
            renderModal();
          }
        });
      }
      if (replaceButton) {
        replaceButton.addEventListener("click", () => applyResult("replace"));
      }
      if (appendButton) {
        appendButton.addEventListener("click", () => applyResult("append"));
      }
    }
    modules.aiOptimize = {
      getAvailability,
      getPrimaryPromptInput,
      isOpen() {
        return state.open;
      },
      handleWorkspacePromptChange(promptKey, value) {
        if (!state.open || !state.promptKey || String(promptKey || "") !== String(state.promptKey || "")) return;
        state.promptValue = String(value ?? "");
        renderModal();
      },
      openModal,
      closeModal,
      renderModal,
      bindModalEvents
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
      const sortMode = String(state.appManagerSort || "manual");
      if (sortMode === "manual") return list;
      list.sort((a, b) => {
        if (sortMode === "name_asc") return modules.state.getAppDisplayName(a).localeCompare(modules.state.getAppDisplayName(b), "zh-CN");
        if (sortMode === "name_desc") return modules.state.getAppDisplayName(b).localeCompare(modules.state.getAppDisplayName(a), "zh-CN");
        if (sortMode === "created_desc") return Number(b.createdAt || 0) - Number(a.createdAt || 0);
        return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
      });
      return list;
    }
    async function reorderAppById(draggedId, targetId) {
      const dragged = String(draggedId || "");
      const target = String(targetId || "");
      if (!dragged || !target || dragged === target) return false;
      const apps = modules.state.state.apps.slice();
      const fromIndex = apps.findIndex((item2) => String(item2.id) === dragged);
      const toIndex = apps.findIndex((item2) => String(item2.id) === target);
      if (fromIndex < 0 || toIndex < 0) return false;
      const [item] = apps.splice(fromIndex, 1);
      const nextIndex = apps.findIndex((entry) => String(entry.id) === target);
      apps.splice(nextIndex < 0 ? toIndex : nextIndex, 0, item);
      modules.state.state.appManagerSort = "manual";
      const sortInput = modules.runtime.getById("appManagerSortInput");
      if (sortInput) sortInput.value = "manual";
      await saveAppsToStorage(apps);
      modules.runtime.setSummaryStatus(modules.runtime.getById("savedAppsSummary"), "应用顺序已同步到本地设置。", "success");
      modules.ui.logToWorkspace("应用卡片顺序已保存。", "success");
      return true;
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
      const quickEntryButton = `<button class="picker-item picker-item-special ${state.workspaceMode === "quick" ? "active" : ""}" type="button" data-action="select-quick-mode"><span class="picker-item-title">快捷入口</span><span class="picker-item-meta"><span>先框选 Photoshop 区域，点击入口即跑</span><span>${modules.runtime.escapeHtml(String(state.quickEntries.length || 0))} 个入口</span></span></button>`;
      if (visibleApps.length === 0) {
        listEl.innerHTML = state.apps.length === 0 ? `${quickEntryButton}<div class="picker-empty"><strong>还没有已保存应用</strong><p>请先在设置页添加应用。</p></div>` : `${quickEntryButton}<div class="picker-empty"><strong>没有匹配结果</strong><p>换个关键词再试试。</p></div>`;
        return;
      }
      listEl.innerHTML = quickEntryButton + visibleApps.map((app) => {
        const isActive = state.currentApp && String(state.currentApp.id) === String(app.id);
        return `<button class="picker-item is-draggable ${isActive ? "active" : ""}" type="button" draggable="true" value="${runtime.escapeHtml(String(app.id || ""))}" data-app-id="${runtime.escapeHtml(String(app.id || ""))}"><span class="picker-item-title">${runtime.escapeHtml(modules.state.getAppDisplayName(app))}</span><span class="picker-item-meta"><span>应用 ID：${runtime.escapeHtml(modules.state.getAppDisplayId(app))}</span><span>输入项：${runtime.escapeHtml(String(modules.state.getAppInputCount(app)))}</span></span></button>`;
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
        return `<article class="list-item saved-app-item compact-card is-draggable ${isEditing ? "is-editing" : ""}" draggable="true" data-app-id="${runtime.escapeHtml(String(app.id))}"><div class="drag-handle" aria-hidden="true">≡</div><div class="saved-app-main compact-card-main"><div class="compact-card-topline"><strong>${runtime.escapeHtml(modules.state.getAppDisplayName(app))}</strong><div class="inline-actions compact-card-actions"><button class="mini-btn" type="button" data-action="edit-app" data-app-id="${runtime.escapeHtml(String(app.id))}">修改</button><button class="mini-btn" type="button" data-action="delete-app" data-app-id="${runtime.escapeHtml(String(app.id))}">删除</button></div></div><span>应用 ID：${runtime.escapeHtml(modules.state.getAppDisplayId(app))}</span><span>输入项：${runtime.escapeHtml(String(modules.state.getAppInputCount(app)))}${isCurrent ? " · 当前使用" : ""}${isEditing ? " · 正在编辑" : ""}</span>${description ? `<span>${runtime.escapeHtml(description)}</span>` : ""}</div></article>`;
      }).join("");
    }
    function bindAppDragSorting(container) {
      if (!container || container.dataset.appDragBound === "true") return;
      container.dataset.appDragBound = "true";
      let draggedId = "";
      container.addEventListener("dragstart", (event) => {
        if (event.target && event.target.closest(".compact-card-actions, input, textarea, select")) return;
        const item = event.target && event.target.closest("[data-app-id][draggable='true']");
        if (!item || item.classList.contains("picker-item-special")) return;
        draggedId = String(item.getAttribute("data-app-id") || item.getAttribute("value") || "");
        item.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", draggedId);
        }
      });
      container.addEventListener("dragover", (event) => {
        const item = event.target && event.target.closest("[data-app-id][draggable='true']");
        if (!draggedId || !item || item.classList.contains("picker-item-special")) return;
        event.preventDefault();
        item.classList.add("is-drag-over");
      });
      container.addEventListener("dragleave", (event) => {
        const item = event.target && event.target.closest("[data-app-id][draggable='true']");
        if (item) item.classList.remove("is-drag-over");
      });
      container.addEventListener("drop", async (event) => {
        const item = event.target && event.target.closest("[data-app-id][draggable='true']");
        if (!draggedId || !item || item.classList.contains("picker-item-special")) return;
        event.preventDefault();
        const targetId = String(item.getAttribute("data-app-id") || item.getAttribute("value") || "");
        container.querySelectorAll(".is-drag-over").forEach((node) => node.classList.remove("is-drag-over"));
        await reorderAppById(draggedId, targetId);
        draggedId = "";
      });
      container.addEventListener("dragend", () => {
        draggedId = "";
        container.querySelectorAll(".is-dragging, .is-drag-over").forEach((node) => {
          node.classList.remove("is-dragging", "is-drag-over");
        });
      });
    }
    async function setCurrentAppById(appId, options = {}) {
      const state = modules.state.state;
      const nextApp = state.apps.find((item) => String(item.id) === String(appId));
      if (!nextApp) return false;
      state.currentApp = nextApp;
      state.formValues = modules.state.buildDefaultFormValues(nextApp);
      await persistCurrentAppId(nextApp.id || "");
      if (!options.preserveWorkspaceMode && modules.quickEntries && typeof modules.quickEntries.setWorkspaceMode === "function") {
        await modules.quickEntries.setWorkspaceMode("app", { skipRender: true });
      } else if (!options.preserveWorkspaceMode) {
        state.workspaceMode = "app";
        await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.WORKSPACE_MODE, "app");
      }
      modules.workspace.renderWorkspace();
      renderSavedAppsList();
      renderAppPickerList();
      if (!options.quiet) modules.ui.logToWorkspace(`已选择应用：${modules.state.getAppDisplayName(nextApp)}`);
      return true;
    }
    async function hydrateCurrentApp(options = {}) {
      const state = modules.state.state;
      const currentId = state.currentApp && state.currentApp.id;
      if (currentId && await setCurrentAppById(currentId, { quiet: true, preserveWorkspaceMode: true })) return;
      const persistedId = await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.CURRENT_APP_ID);
      if (persistedId && await setCurrentAppById(persistedId, { quiet: true, preserveWorkspaceMode: true })) return;
      state.currentApp = null;
      state.formValues = {};
      if (state.apps[0]) return setCurrentAppById(state.apps[0].id, { quiet: true, preserveWorkspaceMode: true });
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
    async function refreshCurrentWorkspaceApp(options = {}) {
      const state = modules.state.state;
      const currentApp = state.currentApp;
      if (!currentApp) {
        await refreshWorkspaceApps(options);
        return false;
      }
      const alternateApp = state.apps.find((item) => String(item.id || "") !== String(currentApp.id || ""));
      if (alternateApp) {
        await setCurrentAppById(alternateApp.id, { quiet: true });
      } else {
        state.currentApp = null;
        state.formValues = {};
        modules.workspace.renderWorkspace();
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await setCurrentAppById(currentApp.id, { quiet: true });
      if (!options.quiet) {
        modules.ui.logToWorkspace(`已刷新当前应用：${modules.state.getAppDisplayName(currentApp)}，表单参数已重置。`, "info");
      }
      return true;
    }
    function bindAppPicker() {
      const runtime = modules.runtime;
      const state = modules.state.state;
      const openButton = runtime.getById("btnOpenAppPicker");
      const refreshButton = runtime.getById("btnRefreshWorkspaceApps");
      const closeButton = runtime.getById("appPickerModalClose");
      const searchInput = runtime.getById("appPickerSearchInput");
      const listEl = runtime.getById("appPickerList");
      bindAppDragSorting(listEl);
      bindAppDragSorting(runtime.getById("savedAppsList"));
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
          await refreshCurrentWorkspaceApp({ quiet: true });
          modules.ui.logToWorkspace("工作台应用已刷新，当前应用表单已回到默认参数。", "info");
          modules.settings.renderSettingsDiagnostics("工作台应用已刷新，当前应用表单已回到默认参数。", {
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
        if (item.getAttribute("data-action") === "select-quick-mode") {
          await modules.quickEntries.setWorkspaceMode("quick");
          renderAppPickerList();
          modules.workspace.setModalOpen("appPickerModal", false);
          modules.ui.logToWorkspace("已切换到快捷入口模式。", "info");
          return;
        }
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
      const nextApps = modules.state.state.apps.slice();
      const existingIds = new Set(nextApps.map((item) => String(item.id || "")));
      const nameIndexMap = /* @__PURE__ */ new Map();
      nextApps.forEach((app, index) => {
        const key = String(app && (app.name || app.title) || "").trim().toLowerCase();
        if (key && !nameIndexMap.has(key)) nameIndexMap.set(key, index);
      });
      importedApps.forEach((app) => {
        const key = String(app && (app.name || app.title) || "").trim().toLowerCase();
        const previousIndex = key ? nameIndexMap.get(key) : -1;
        const previous = previousIndex >= 0 ? nextApps[previousIndex] : null;
        const nextId = previous ? previous.id : app.id && !existingIds.has(String(app.id)) ? app.id : modules.runtime.createId("app");
        const nextApp = modules.state.normalizeAppRecord({
          ...app,
          id: nextId,
          createdAt: previous ? previous.createdAt : app.createdAt || Date.now(),
          updatedAt: Date.now()
        });
        if (previous) {
          nextApps[previousIndex] = nextApp;
          return;
        }
        existingIds.add(String(nextId));
        if (key) nameIndexMap.set(key, nextApps.length);
        nextApps.push(nextApp);
      });
      await saveAppsToStorage(nextApps);
      input.dataset.userEdited = "";
      input.value = JSON.stringify(nextApps, null, 2);
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
      reorderAppById,
      importAppsFromTextarea,
      exportAppsToTextarea,
      refreshCurrentWorkspaceApp,
      isAppEditorDirty,
      confirmDiscardAppEditorChanges,
      markAppEditorPristine
    };
  })(window);

  // src/webview/templates.js
  (function initTemplatesModule(global) {
    const modules = global.PixelRunnerModules = global.PixelRunnerModules || {};
    const PROMPT_WARN_CHARS = 4e3;
    const TEMPLATE_FILE_PREFIX = "pixelrunner_bundle";
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
    function buildTemplateBundle(templates) {
      return {
        schema: "pixelrunner.bundle",
        version: 1,
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        name: "PixelRunner 资料包",
        apps: Array.isArray(modules.state.state.apps) ? modules.state.state.apps : [],
        templates: Array.isArray(templates) ? templates : [],
        quickEntries: Array.isArray(modules.state.state.quickEntries) ? modules.state.state.quickEntries : []
      };
    }
    function buildTemplateExportFilename() {
      const now = /* @__PURE__ */ new Date();
      const yyyy = String(now.getFullYear());
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      return `${TEMPLATE_FILE_PREFIX}_${yyyy}-${mm}-${dd}.json`;
    }
    function getTemplateTitleKey(template) {
      return String(template && template.title || "").trim().toLowerCase();
    }
    function fillTemplateEditor(template, options = {}) {
      if (!options.force && !confirmDiscardTemplateChanges()) return false;
      const runtime = modules.runtime;
      const item = template && typeof template === "object" ? template : null;
      modules.state.state.editingTemplateId = item ? String(item.id) : null;
      if (runtime.getById("templateTitleInput")) runtime.getById("templateTitleInput").value = item ? item.title || "" : "";
      if (runtime.getById("templateContentInput")) runtime.getById("templateContentInput").value = item ? item.content || "" : "";
      updateTemplateLengthHint();
      runtime.setSummaryStatus(
        runtime.getById("templateStatusSummary"),
        item ? `正在编辑模板：${item.title}` : "填写标题和内容后即可保存模板。",
        "info"
      );
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
      if (!options.quiet) {
        modules.ui.logToWorkspace(`模板列表已刷新，共 ${modules.state.state.templates.length} 条。`, "info");
      }
    }
    function readTemplateEditorForm() {
      const title = String(modules.runtime.getById("templateTitleInput")?.value || "").trim();
      const content = String(modules.runtime.getById("templateContentInput")?.value || "");
      if (!title) throw new Error("请先填写模板标题");
      if (!content.trim()) throw new Error("请先填写模板内容");
      return {
        id: modules.state.state.editingTemplateId || modules.runtime.createId("tpl"),
        title,
        content
      };
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
      if (String(modules.state.state.editingTemplateId || "") === String(templateId)) {
        fillTemplateEditor(null, { force: true });
      }
      modules.ui.logToWorkspace(`模板已删除：${target.title}`, "warn");
      modules.runtime.setSummaryStatus(modules.runtime.getById("templateStatusSummary"), "模板已删除。", "warn");
      modules.runtime.setSummaryStatus(modules.runtime.getById("savedTemplatesSummary"), `已保存模板：${nextTemplates.length} 条`, "warn");
    }
    function exportTemplatesToTextarea() {
      const input = modules.runtime.getById("templateTransferInput");
      if (!input) return;
      input.dataset.userEdited = "";
      input.value = JSON.stringify(buildTemplateBundle(modules.state.state.templates), null, 2);
    }
    function mergeImportedTemplates(importedTemplates) {
      const currentTemplates = Array.isArray(modules.state.state.templates) ? modules.state.state.templates.slice() : [];
      const existingIds = new Set(currentTemplates.map((item) => String(item.id || "")));
      const titleIndexMap = /* @__PURE__ */ new Map();
      currentTemplates.forEach((template, index) => {
        const key = getTemplateTitleKey(template);
        if (key && !titleIndexMap.has(key)) titleIndexMap.set(key, index);
      });
      let added = 0;
      let replaced = 0;
      importedTemplates.forEach((template) => {
        const key = getTemplateTitleKey(template);
        const previousIndex = key ? titleIndexMap.get(key) : -1;
        const previous = previousIndex >= 0 ? currentTemplates[previousIndex] : null;
        const nextId = previous ? previous.id : template.id && !existingIds.has(String(template.id)) ? template.id : modules.runtime.createId("tpl");
        const nextItem = modules.state.normalizeTemplateRecord({
          ...template,
          id: nextId,
          createdAt: previous ? previous.createdAt : template.createdAt || Date.now(),
          updatedAt: Date.now()
        });
        if (!nextItem) return;
        if (previous) {
          currentTemplates[previousIndex] = nextItem;
          replaced += 1;
          return;
        }
        existingIds.add(String(nextItem.id || ""));
        if (key) titleIndexMap.set(key, currentTemplates.length);
        currentTemplates.push(nextItem);
        added += 1;
      });
      return {
        templates: modules.state.normalizeTemplateList(currentTemplates),
        added,
        replaced
      };
    }
    function getAppNameKey(app) {
      return String(app && (app.name || app.title) || "").trim().toLowerCase();
    }
    function mergeImportedApps(importedApps) {
      const currentApps = Array.isArray(modules.state.state.apps) ? modules.state.state.apps.slice() : [];
      const existingIds = new Set(currentApps.map((item) => String(item.id || "")));
      const nameIndexMap = /* @__PURE__ */ new Map();
      currentApps.forEach((app, index) => {
        const key = getAppNameKey(app);
        if (key && !nameIndexMap.has(key)) nameIndexMap.set(key, index);
      });
      let added = 0;
      let replaced = 0;
      modules.state.normalizeAppList(importedApps).forEach((app) => {
        const key = getAppNameKey(app);
        const previousIndex = key ? nameIndexMap.get(key) : -1;
        const previous = previousIndex >= 0 ? currentApps[previousIndex] : null;
        const nextId = previous ? previous.id : app.id && !existingIds.has(String(app.id)) ? app.id : modules.runtime.createId("app");
        const nextApp = modules.state.normalizeAppRecord({
          ...app,
          id: nextId,
          createdAt: previous ? previous.createdAt : app.createdAt || Date.now(),
          updatedAt: Date.now()
        });
        if (!nextApp || !nextApp.appId) return;
        if (previous) {
          currentApps[previousIndex] = nextApp;
          replaced += 1;
          return;
        }
        existingIds.add(String(nextApp.id || ""));
        if (key) nameIndexMap.set(key, currentApps.length);
        currentApps.push(nextApp);
        added += 1;
      });
      return {
        apps: modules.state.normalizeAppList(currentApps),
        added,
        replaced
      };
    }
    function parseTransferPackageText(text) {
      const parsed = JSON.parse(String(text || "").trim());
      if (parsed && typeof parsed === "object" && parsed.schema === "pixelrunner.bundle") {
        return {
          kind: "bundle",
          apps: Array.isArray(parsed.apps) ? parsed.apps : [],
          templates: Array.isArray(parsed.templates) ? parsed.templates : [],
          quickEntries: Array.isArray(parsed.quickEntries) ? parsed.quickEntries : []
        };
      }
      return {
        kind: "templates",
        apps: [],
        templates: parsed && typeof parsed === "object" && Array.isArray(parsed.templates) ? parsed.templates : parsed,
        quickEntries: []
      };
    }
    function parseImportedTemplatesText(text) {
      let parsed = JSON.parse(String(text || "").trim());
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.templates)) parsed = parsed.templates;
      const templates = modules.state.normalizeTemplateList(parsed);
      if (templates.length === 0) throw new Error("没有解析到可导入的模板");
      return templates;
    }
    async function importTemplatesFromTextarea() {
      const input = modules.runtime.getById("templateTransferInput");
      if (!input) return;
      const text = String(input.value || "").trim();
      if (!text) throw new Error("请先粘贴模板 JSON");
      const transfer = parseTransferPackageText(text);
      const importedTemplates = modules.state.normalizeTemplateList(transfer.templates);
      if (transfer.kind !== "bundle" && importedTemplates.length === 0) throw new Error("没有解析到可导入的模板");
      if (transfer.kind === "bundle" && importedTemplates.length === 0 && transfer.apps.length === 0 && transfer.quickEntries.length === 0) {
        throw new Error("没有解析到可导入的资料包内容");
      }
      const mergedApps = transfer.kind === "bundle" ? mergeImportedApps(transfer.apps) : { apps: modules.state.state.apps, added: 0 };
      const mergedTemplates = mergeImportedTemplates(importedTemplates);
      const mergedQuickEntries = transfer.kind === "bundle" && modules.quickEntries ? modules.quickEntries.mergeImportedQuickEntries(transfer.quickEntries) : { entries: modules.state.state.quickEntries, added: 0, replaced: 0 };
      if (transfer.kind === "bundle") await modules.apps.saveAppsToStorage(mergedApps.apps);
      await saveTemplatesToStorage(mergedTemplates.templates);
      if (transfer.kind === "bundle") await modules.quickEntries.saveQuickEntriesToStorage(mergedQuickEntries.entries);
      input.dataset.userEdited = "";
      input.value = JSON.stringify(buildTemplateBundle(modules.state.state.templates), null, 2);
      return {
        appsAdded: mergedApps.added,
        appsReplaced: mergedApps.replaced,
        added: mergedTemplates.added,
        replaced: mergedTemplates.replaced,
        quickEntriesAdded: mergedQuickEntries.added,
        quickEntriesReplaced: mergedQuickEntries.replaced,
        total: modules.state.state.templates.length,
        appsTotal: modules.state.state.apps.length,
        quickEntriesTotal: modules.state.state.quickEntries.length,
        kind: transfer.kind
      };
    }
    async function exportTemplatesAsJson() {
      exportTemplatesToTextarea();
      const text = String(modules.runtime.getById("templateTransferInput")?.value || "");
      const result = await modules.runtime.saveTextFile(buildTemplateExportFilename(), text, {
        mimeType: "application/json",
        extension: ".json",
        description: "JSON Files"
      });
      if (result.outcome === "cancelled") return result;
      if (result.outcome === "unsupported") {
        throw new Error("当前环境不支持导出文件");
      }
      modules.runtime.setSummaryStatus(
        modules.runtime.getById("templateStatusSummary"),
        `资料包 JSON 已导出：${result.savedPath || buildTemplateExportFilename()}`,
        "success"
      );
      modules.ui.logToWorkspace(`资料包 JSON 已导出：${result.savedPath || buildTemplateExportFilename()}`, "success");
      return result;
    }
    async function importTemplatesFromJsonFile() {
      const result = await modules.runtime.openTextFile({
        mimeType: "application/json",
        extension: ".json",
        description: "JSON Files",
        accept: ".json,application/json,text/plain"
      });
      if (result.outcome === "cancelled") return result;
      if (result.outcome === "unsupported") {
        throw new Error("当前环境不支持导入文件");
      }
      const input = modules.runtime.getById("templateTransferInput");
      if (input) input.value = String(result.text || "");
      const summary = await importTemplatesFromTextarea();
      const message = summary.kind === "bundle" ? `资料包 JSON 已导入：应用新增 ${summary.appsAdded} 个、覆盖 ${summary.appsReplaced} 个；提示词新增 ${summary.added} 条、覆盖 ${summary.replaced} 条；快捷入口新增 ${summary.quickEntriesAdded} 个、覆盖 ${summary.quickEntriesReplaced} 个。` : `模板 JSON 已导入：新增 ${summary.added} 条，覆盖 ${summary.replaced} 条，总计 ${summary.total} 条。`;
      modules.runtime.setSummaryStatus(
        modules.runtime.getById("templateStatusSummary"),
        message,
        "success"
      );
      modules.runtime.setSummaryStatus(
        modules.runtime.getById("savedTemplatesSummary"),
        `已保存模板：${summary.total} 条`,
        "success"
      );
      modules.ui.logToWorkspace(message, "success");
      return summary;
    }
    function getVisibleTemplates() {
      const state = modules.state.state;
      const keyword = String(state.templateManagerKeyword || "").trim().toLowerCase();
      const list = !keyword ? [...state.templates] : state.templates.filter((item) => `${item.title || ""}
${item.content || ""}`.toLowerCase().includes(keyword));
      const sortMode = String(state.templateManagerSort || "manual");
      if (sortMode === "manual") return list;
      list.sort((a, b) => {
        if (sortMode === "title_asc") return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
        if (sortMode === "title_desc") return String(b.title || "").localeCompare(String(a.title || ""), "zh-CN");
        if (sortMode === "created_desc") return Number(b.createdAt || 0) - Number(a.createdAt || 0);
        return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
      });
      return list;
    }
    async function reorderTemplateById(draggedId, targetId) {
      const dragged = String(draggedId || "");
      const target = String(targetId || "");
      if (!dragged || !target || dragged === target) return false;
      const templates = modules.state.state.templates.slice();
      const fromIndex = templates.findIndex((item2) => String(item2.id) === dragged);
      const toIndex = templates.findIndex((item2) => String(item2.id) === target);
      if (fromIndex < 0 || toIndex < 0) return false;
      const [item] = templates.splice(fromIndex, 1);
      const nextIndex = templates.findIndex((entry) => String(entry.id) === target);
      templates.splice(nextIndex < 0 ? toIndex : nextIndex, 0, item);
      modules.state.state.templateManagerSort = "manual";
      const sortInput = modules.runtime.getById("templateManagerSortInput");
      if (sortInput) sortInput.value = "manual";
      await saveTemplatesToStorage(templates);
      modules.runtime.setSummaryStatus(modules.runtime.getById("savedTemplatesSummary"), "提示词顺序已同步到本地设置。", "success");
      modules.ui.logToWorkspace("提示词卡片顺序已保存。", "success");
      return true;
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
        return `<article class="list-item saved-template-item compact-card is-draggable ${isEditing ? "is-editing" : ""}" draggable="true" data-template-id="${modules.runtime.escapeHtml(String(item.id))}"><div class="drag-handle" aria-hidden="true">≡</div><div class="saved-template-main compact-card-main"><div class="compact-card-topline"><strong>${modules.runtime.escapeHtml(item.title)}</strong><div class="inline-actions compact-card-actions"><button class="mini-btn" type="button" data-action="edit-template" data-template-id="${modules.runtime.escapeHtml(String(item.id))}">修改</button><button class="mini-btn" type="button" data-action="delete-template" data-template-id="${modules.runtime.escapeHtml(String(item.id))}">删除</button></div></div><span>${modules.runtime.escapeHtml(`${getTextLength(item.content)} 字符`)}</span><span>${modules.runtime.escapeHtml(getTemplatePreview(item.content))}</span></div></article>`;
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
      return picker.mode === "single" ? "单选模式：点击模板后会立刻写入目标字段。" : `已选择 ${picker.selectedIds.length} / ${picker.maxSelection}，可组合写入同一个字段。`;
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
        return `<button class="picker-item is-draggable ${isSelected ? "active" : ""}" type="button" draggable="true" data-template-id="${modules.runtime.escapeHtml(String(item.id))}"><span class="picker-item-title">${modules.runtime.escapeHtml(item.title)}</span><span class="picker-item-meta"><span>${modules.runtime.escapeHtml(`${getTextLength(item.content)} 字符`)}</span><span>${modules.runtime.escapeHtml(getTailPreview(item.content, 30))}</span></span></button>`;
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
      const exportButton = runtime.getById("btnExportTemplatesJson");
      const importButton = runtime.getById("btnImportTemplatesJson");
      const pickerCloseButton = runtime.getById("templatePickerModalClose");
      const pickerApplyButton = runtime.getById("btnApplyTemplateSelection");
      const pickerList = runtime.getById("templatePickerList");
      const pickerSearchInput = runtime.getById("templatePickerSearchInput");
      const pickerApplyMode = runtime.getById("templatePickerApplyMode");
      const managerSearchInput = runtime.getById("templateManagerSearchInput");
      const managerSortInput = runtime.getById("templateManagerSortInput");
      bindTemplateDragSorting(pickerList);
      bindTemplateDragSorting(runtime.getById("savedTemplatesList"));
      [titleInput, contentInput].filter(Boolean).forEach((element) => {
        element.addEventListener("input", () => {
          updateTemplateLengthHint();
          runtime.setSummaryStatus(
            runtime.getById("templateStatusSummary"),
            modules.state.state.editingTemplateId ? "已修改当前模板，记得保存后再切换。" : "正在填写新模板，保存后会加入下方列表。",
            "pending"
          );
        });
      });
      if (managerSearchInput) {
        managerSearchInput.addEventListener("input", () => {
          modules.state.state.templateManagerKeyword = managerSearchInput.value || "";
          renderSavedTemplatesList();
        });
      }
      if (managerSortInput) {
        managerSortInput.value = modules.state.state.templateManagerSort || "manual";
        managerSortInput.addEventListener("change", () => {
          modules.state.state.templateManagerSort = managerSortInput.value || "manual";
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
      if (resetButton) {
        resetButton.addEventListener("click", () => fillTemplateEditor(null));
      }
      if (exportButton) {
        exportButton.addEventListener("click", async () => {
          exportButton.disabled = true;
          try {
            await exportTemplatesAsJson();
          } catch (error) {
            runtime.setSummaryStatus(runtime.getById("templateStatusSummary"), `导出失败：${error.message}`, "error");
            modules.ui.logToWorkspace(`模板导出失败：${error.message}`, "error");
          } finally {
            exportButton.disabled = false;
          }
        });
      }
      if (importButton) {
        importButton.addEventListener("click", async () => {
          importButton.disabled = true;
          try {
            await importTemplatesFromJsonFile();
          } catch (error) {
            runtime.setSummaryStatus(runtime.getById("templateStatusSummary"), `导入失败：${error.message}`, "error");
            modules.ui.logToWorkspace(`模板导入失败：${error.message}`, "error");
          } finally {
            importButton.disabled = false;
          }
        });
      }
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
    function bindTemplateDragSorting(container) {
      if (!container || container.dataset.templateDragBound === "true") return;
      container.dataset.templateDragBound = "true";
      let draggedId = "";
      container.addEventListener("dragstart", (event) => {
        if (event.target && event.target.closest(".compact-card-actions, input, textarea, select")) return;
        const item = event.target && event.target.closest("[data-template-id][draggable='true']");
        if (!item) return;
        draggedId = String(item.getAttribute("data-template-id") || "");
        item.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", draggedId);
        }
      });
      container.addEventListener("dragover", (event) => {
        const item = event.target && event.target.closest("[data-template-id][draggable='true']");
        if (!draggedId || !item) return;
        event.preventDefault();
        item.classList.add("is-drag-over");
      });
      container.addEventListener("dragleave", (event) => {
        const item = event.target && event.target.closest("[data-template-id][draggable='true']");
        if (item) item.classList.remove("is-drag-over");
      });
      container.addEventListener("drop", async (event) => {
        const item = event.target && event.target.closest("[data-template-id][draggable='true']");
        if (!draggedId || !item) return;
        event.preventDefault();
        const targetId = String(item.getAttribute("data-template-id") || "");
        container.querySelectorAll(".is-drag-over").forEach((node) => node.classList.remove("is-drag-over"));
        await reorderTemplateById(draggedId, targetId);
        draggedId = "";
      });
      container.addEventListener("dragend", () => {
        draggedId = "";
        container.querySelectorAll(".is-dragging, .is-drag-over").forEach((node) => {
          node.classList.remove("is-dragging", "is-drag-over");
        });
      });
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
      reorderTemplateById,
      importTemplatesFromTextarea,
      exportTemplatesToTextarea,
      importTemplatesFromJsonFile,
      exportTemplatesAsJson,
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
    let accountRefreshPromise = null;
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
      modules.state.state.accountSummary = {
        balance: hasAccount && account.balance != null ? Number(account.balance) : null,
        coins: hasAccount && account.coins != null ? Number(account.coins) : null,
        updatedAt: Date.now()
      };
    }
    function setApiKeyVisibility(visible) {
      const input = modules.runtime.getById("settingsApiKeyInput");
      const toggleButton = modules.runtime.getById("btnResetSettings");
      const nextVisible = Boolean(visible);
      if (input) {
        input.type = nextVisible ? "text" : "password";
      }
      if (toggleButton) {
        toggleButton.dataset.visible = nextVisible ? "true" : "false";
        toggleButton.setAttribute("aria-pressed", nextVisible ? "true" : "false");
        toggleButton.setAttribute("aria-label", nextVisible ? "隐藏 API Key" : "显示 API Key");
        toggleButton.setAttribute("title", nextVisible ? "隐藏 API Key" : "显示 API Key");
      }
    }
    async function refreshAccountSummary(options = {}) {
      const apiKey = String((options.apiKey != null ? options.apiKey : modules.state.state.settings.apiKey) || "").trim();
      if (!apiKey || !modules.runtime.isPluginRuntime()) {
        updateAccountSummary(null);
        return null;
      }
      if (!options.force && accountRefreshPromise) {
        return accountRefreshPromise;
      }
      accountRefreshPromise = modules.runtime.callHost("runninghub.fetchAccountStatus", [{ apiKey }], { timeoutMs: 15e3 }).then((account) => {
        updateAccountSummary(account);
        return account;
      }).catch((error) => {
        if (!options.quiet && modules.ui && typeof modules.ui.logToWorkspace === "function") {
          modules.ui.logToWorkspace(`余额刷新失败：${error.message || error}`, "warn");
        }
        updateAccountSummary(null);
        return null;
      }).finally(() => {
        accountRefreshPromise = null;
      });
      return accountRefreshPromise;
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
      if (modules.runtime.getById("settingsAiOptimizeAppIdInput")) {
        modules.runtime.getById("settingsAiOptimizeAppIdInput").value = String(
          settings.aiOptimizeAppId ?? modules.state.DEFAULT_AI_OPTIMIZE_APP_ID
        );
      }
    }
    const THEME_PRESETS = {
      classic: {
        "--bg-top": "#111822",
        "--bg-mid": "#18212d",
        "--bg-bottom": "#0c1219",
        "--panel": "#18222d",
        "--panel-soft": "#1f2b37",
        "--panel-strong": "#243342",
        "--ink": "#304150",
        "--surface-rgb": "31, 45, 59",
        "--surface-soft-rgb": "35, 49, 62",
        "--control-rgb": "68, 96, 121",
        "--control-edge": "#35506a",
        "--control-ink": "#203648",
        "--surface-alpha": "0.96",
        "--surface-soft-alpha": "0.9",
        "--surface-glass-alpha": "0.62",
        "--theme-image-overlay": "rgba(8, 12, 18, 0.48)",
        "--accent": "#63d67b",
        "--accent-strong": "#28c45b",
        "--accent-soft": "rgba(99, 214, 123, 0.16)",
        "--accent-wash": "rgba(99, 214, 123, 0.09)",
        "--cta": "#a9def2",
        "--cta-strong": "#8ac6df"
      },
      aurora: {
        "--bg-top": "#0b1a20",
        "--bg-mid": "#14333b",
        "--bg-bottom": "#081318",
        "--panel": "#12313a",
        "--panel-soft": "#1a4550",
        "--panel-strong": "#245966",
        "--ink": "#2f6270",
        "--surface-rgb": "22, 58, 68",
        "--surface-soft-rgb": "27, 73, 84",
        "--control-rgb": "42, 116, 126",
        "--control-edge": "#2d7582",
        "--control-ink": "#082b2c",
        "--surface-alpha": "0.96",
        "--surface-soft-alpha": "0.9",
        "--surface-glass-alpha": "0.62",
        "--theme-image-overlay": "rgba(4, 24, 28, 0.46)",
        "--accent": "#74d8c7",
        "--accent-strong": "#35bfa8",
        "--accent-soft": "rgba(116, 216, 199, 0.18)",
        "--accent-wash": "rgba(116, 216, 199, 0.1)",
        "--cta": "#f4d47d",
        "--cta-strong": "#dbb95f"
      },
      graphite: {
        "--bg-top": "#12151a",
        "--bg-mid": "#202832",
        "--bg-bottom": "#0b0e13",
        "--panel": "#202832",
        "--panel-soft": "#2b3540",
        "--panel-strong": "#354250",
        "--ink": "#4b5c6d",
        "--surface-rgb": "35, 43, 52",
        "--surface-soft-rgb": "45, 56, 68",
        "--control-rgb": "77, 92, 108",
        "--control-edge": "#56687a",
        "--control-ink": "#172331",
        "--surface-alpha": "0.96",
        "--surface-soft-alpha": "0.9",
        "--surface-glass-alpha": "0.62",
        "--theme-image-overlay": "rgba(8, 11, 15, 0.48)",
        "--accent": "#9ab0c6",
        "--accent-strong": "#7f99b4",
        "--accent-soft": "rgba(154, 176, 198, 0.2)",
        "--accent-wash": "rgba(154, 176, 198, 0.11)",
        "--cta": "#d7e1ea",
        "--cta-strong": "#b7c7d5"
      },
      rose: {
        "--bg-top": "#1d1420",
        "--bg-mid": "#302234",
        "--bg-bottom": "#120d16",
        "--panel": "#2b1f30",
        "--panel-soft": "#3b2b41",
        "--panel-strong": "#513b58",
        "--ink": "#65496e",
        "--surface-rgb": "50, 36, 56",
        "--surface-soft-rgb": "66, 48, 73",
        "--control-rgb": "114, 76, 106",
        "--control-edge": "#7f5576",
        "--control-ink": "#371827",
        "--surface-alpha": "0.96",
        "--surface-soft-alpha": "0.9",
        "--surface-glass-alpha": "0.62",
        "--theme-image-overlay": "rgba(27, 10, 22, 0.46)",
        "--accent": "#ff9bb4",
        "--accent-strong": "#e87595",
        "--accent-soft": "rgba(255, 155, 180, 0.18)",
        "--accent-wash": "rgba(255, 155, 180, 0.1)",
        "--cta": "#aee7dd",
        "--cta-strong": "#7dd3c4"
      },
      studio: {
        "--bg-top": "#17171a",
        "--bg-mid": "#252823",
        "--bg-bottom": "#101111",
        "--panel": "#252823",
        "--panel-soft": "#33362e",
        "--panel-strong": "#424638",
        "--ink": "#585d4a",
        "--surface-rgb": "42, 45, 39",
        "--surface-soft-rgb": "58, 61, 51",
        "--control-rgb": "91, 99, 71",
        "--control-edge": "#69724d",
        "--control-ink": "#302a10",
        "--surface-alpha": "0.96",
        "--surface-soft-alpha": "0.9",
        "--surface-glass-alpha": "0.62",
        "--theme-image-overlay": "rgba(16, 16, 12, 0.46)",
        "--accent": "#ffd56a",
        "--accent-strong": "#e8b93b",
        "--accent-soft": "rgba(255, 213, 106, 0.18)",
        "--accent-wash": "rgba(255, 213, 106, 0.1)",
        "--cta": "#8fd6ff",
        "--cta-strong": "#65bce9"
      }
    };
    const CUSTOM_THEME_SKIN_SELECTORS = [
      ".view-nav",
      ".panel-header-strip",
      ".overlay-card",
      ".workspace-app-card",
      ".workspace-input-card",
      ".workspace-run-card",
      ".log-card",
      ".selection-meta",
      ".diagnostic-box",
      ".list-shell",
      ".picker-list",
      ".input-zone",
      ".field-input",
      ".summary-strip",
      ".picker-item",
      ".list-item",
      ".tool-item"
    ];
    const CUSTOM_THEME_DEEP_SELECTORS = [
      ".workspace-app-card",
      ".workspace-input-card",
      ".workspace-run-card",
      ".log-card",
      ".overlay-card"
    ];
    const CUSTOM_THEME_LIGHT_SELECTORS = [
      ".input-zone",
      ".field-input",
      ".workspace-app-meta",
      ".image-capture-stage",
      ".image-capture-preview"
    ];
    function makeThemeImageValue(dataUrl) {
      const value = String(dataUrl || "").trim();
      if (!value) return "";
      return `url(${JSON.stringify(value)})`;
    }
    function clearInlineThemeImages() {
      document.body.style.removeProperty("background-image");
      document.body.style.removeProperty("background-size");
      document.body.style.removeProperty("background-position");
      document.body.removeAttribute("data-custom-theme-image-ready");
      const elements = document.querySelectorAll(
        [...CUSTOM_THEME_SKIN_SELECTORS, ...CUSTOM_THEME_DEEP_SELECTORS, ...CUSTOM_THEME_LIGHT_SELECTORS].join(",")
      );
      elements.forEach((element) => {
        element.style.removeProperty("background-image");
        element.style.removeProperty("background-size");
        element.style.removeProperty("background-position");
        element.style.removeProperty("background-blend-mode");
      });
    }
    function applyInlineThemeImages(dataUrl) {
      const imageValue = makeThemeImageValue(dataUrl);
      clearInlineThemeImages();
      if (!imageValue) return false;
      document.body.style.backgroundImage = [
        "linear-gradient(180deg, rgba(9, 13, 18, 0.04), rgba(9, 13, 18, 0.1))",
        imageValue,
        "linear-gradient(180deg, var(--bg-top), var(--bg-bottom))"
      ].join(", ");
      document.body.style.backgroundSize = "cover";
      document.body.style.backgroundPosition = "center";
      document.body.dataset.customThemeImageReady = "true";
      return true;
    }
    function refreshThemeSkin() {
      const theme = modules.state && modules.state.state ? modules.state.state.theme : null;
      if (!theme || !theme.customImage) {
        clearInlineThemeImages();
        return false;
      }
      return applyInlineThemeImages(theme.customImage);
    }
    function applyTheme(theme) {
      const normalized = modules.state.normalizeTheme(theme);
      const root = document.documentElement;
      const presetName = normalized.preset === "custom" ? normalized.basePreset : normalized.preset;
      const preset = THEME_PRESETS[presetName] || THEME_PRESETS.classic;
      Object.entries(preset).forEach(([key, value]) => root.style.setProperty(key, value));
      document.body.classList.toggle("has-custom-theme-image", Boolean(normalized.customImage));
      document.body.classList.toggle("has-glass-theme", Boolean(normalized.glass));
      if (normalized.customImage) {
        const imageValue = makeThemeImageValue(normalized.customImage);
        root.style.setProperty("--theme-image", imageValue);
        root.style.setProperty("--surface-alpha", "0.24");
        root.style.setProperty("--surface-soft-alpha", "0.18");
        root.style.setProperty("--surface-glass-alpha", "0.14");
        applyInlineThemeImages(normalized.customImage);
      } else {
        root.style.removeProperty("--theme-image");
        clearInlineThemeImages();
      }
      modules.state.state.theme = normalized;
      const swatches = document.querySelectorAll("[data-theme-preset]");
      swatches.forEach((button) => {
        button.classList.toggle("is-selected", String(button.getAttribute("data-theme-preset")) === presetName);
      });
      const statusEl = modules.runtime.getById("themeStatusSummary");
      if (statusEl) {
        modules.runtime.setSummaryStatus(
          statusEl,
          normalized.customImage ? `自定义主题已启用：${normalized.customImageName || "背景照片"}，背景已写入界面皮肤。` : `已启用${normalized.preset === "classic" ? "经典" : "预设"}主题。`,
          "success"
        );
      }
    }
    async function saveThemeSnapshot(theme) {
      const normalized = modules.state.normalizeTheme(theme);
      await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.THEME, JSON.stringify(normalized));
      applyTheme(normalized);
      return normalized;
    }
    async function loadThemeSnapshot() {
      const raw = await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.THEME);
      return modules.state.normalizeTheme(modules.runtime.readJsonText(raw, modules.state.DEFAULT_THEME));
    }
    function readImageFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取主题照片失败，请换一张图片重试。"));
        reader.readAsDataURL(file);
      });
    }
    function compressThemeImageDataUrl(dataUrl, options = {}) {
      const source = String(dataUrl || "").trim();
      if (!source) return Promise.resolve("");
      const maxWidth = Math.max(640, Number(options.maxWidth) || 1600);
      const quality = Math.max(0.55, Math.min(0.92, Number(options.quality) || 0.82));
      return new Promise((resolve) => {
        if (typeof Image === "undefined" || typeof document === "undefined") {
          resolve(source);
          return;
        }
        const image = new Image();
        image.onload = () => {
          const width = Number(image.naturalWidth || image.width || 0);
          const height = Number(image.naturalHeight || image.height || 0);
          if (!width || !height) {
            resolve(source);
            return;
          }
          const scale = Math.min(1, maxWidth / width);
          const targetWidth = Math.max(1, Math.round(width * scale));
          const targetHeight = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const context = canvas.getContext("2d");
          if (!context) {
            resolve(source);
            return;
          }
          context.drawImage(image, 0, 0, targetWidth, targetHeight);
          try {
            const compressed = canvas.toDataURL("image/jpeg", quality);
            resolve(compressed && compressed.length < source.length ? compressed : source);
          } catch (_) {
            resolve(source);
          }
        };
        image.onerror = () => resolve(source);
        image.src = source;
      });
    }
    function readSettingsForm() {
      return modules.state.normalizeSettings({
        apiKey: modules.runtime.getById("settingsApiKeyInput")?.value || "",
        pollInterval: modules.runtime.getById("settingsPollIntervalInput")?.value,
        timeout: modules.runtime.getById("settingsTimeoutInput")?.value,
        maxConcurrentTasks: modules.runtime.getById("settingsMaxConcurrentTasksInput")?.value,
        aiOptimizeAppId: modules.runtime.getById("settingsAiOptimizeAppIdInput")?.value || ""
      });
    }
    async function loadSettingsSnapshot() {
      const apiKey = String(await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.API_KEY) || "").trim();
      const rawSettings = modules.runtime.readJsonText(await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.SETTINGS), {});
      return modules.state.normalizeSettings({
        apiKey,
        pollInterval: rawSettings && rawSettings.pollInterval,
        timeout: rawSettings && rawSettings.timeout,
        maxConcurrentTasks: rawSettings && rawSettings.maxConcurrentTasks,
        aiOptimizeAppId: rawSettings && rawSettings.aiOptimizeAppId
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
          maxConcurrentTasks: normalized.maxConcurrentTasks,
          aiOptimizeAppId: normalized.aiOptimizeAppId
        })
      );
      modules.state.state.settings = normalized;
      modules.state.state.settingsLoaded = true;
      fillSettingsForm(normalized);
      if (modules.workspace && typeof modules.workspace.updateRunButtonState === "function") {
        modules.workspace.updateRunButtonState();
      }
      if (modules.workspace && typeof modules.workspace.renderWorkspace === "function") {
        modules.workspace.renderWorkspace();
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
      const theme = await loadThemeSnapshot();
      modules.state.state.settings = snapshot;
      modules.state.state.settingsLoaded = true;
      fillSettingsForm(snapshot);
      applyTheme(theme);
      setApiKeyVisibility(false);
      renderSettingsStatus("设置已加载，可以直接修改并保存。", "success");
      renderSettingsDiagnostics("当前设置快照已读取完成。", {
        runtime: modules.state.state.hostRuntime,
        hasApiKey: Boolean(snapshot.apiKey)
      });
      await refreshAccountSummary({ apiKey: snapshot.apiKey, quiet: true });
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
        sortInput.value = modules.state.state.appManagerSort || "manual";
        sortInput.addEventListener("change", () => {
          modules.state.state.appManagerSort = sortInput.value || "manual";
          modules.apps.renderSavedAppsList();
        });
      }
    }
    function bindSettingsActions() {
      const runtime = modules.runtime;
      const saveButton = runtime.getById("btnSaveSettings");
      const resetButton = runtime.getById("btnResetSettings");
      const resetAiOptimizeButton = runtime.getById("btnResetAiOptimizeAppId");
      const parseAppButton = runtime.getById("btnParseApp");
      const saveEditingAppButton = runtime.getById("btnSaveEditingApp");
      const deleteEditingAppButton = runtime.getById("btnDeleteEditingApp");
      const saveTemplateButton = runtime.getById("btnSaveTemplate");
      const resetTemplateButton = runtime.getById("btnResetTemplateEditor");
      const loadParseDebugButton = runtime.getById("btnLoadParseDebug");
      const themeImageInput = runtime.getById("themeImageInput");
      const clearThemeImageButton = runtime.getById("btnClearThemeImage");
      const fieldIds = [
        "settingsApiKeyInput",
        "settingsPollIntervalInput",
        "settingsTimeoutInput",
        "settingsMaxConcurrentTasksInput",
        "settingsAiOptimizeAppIdInput"
      ];
      bindAppManagerControls();
      document.querySelectorAll("[data-theme-preset]").forEach((button) => {
        button.addEventListener("click", async () => {
          const preset = String(button.getAttribute("data-theme-preset") || "classic");
          try {
            await saveThemeSnapshot({
              ...modules.state.state.theme,
              preset,
              basePreset: preset,
              customImage: "",
              customImageName: "",
              glass: false
            });
          } catch (error) {
            runtime.setSummaryStatus(runtime.getById("themeStatusSummary"), `主题保存失败：${error.message}`, "error");
          }
        });
      });
      if (themeImageInput) {
        themeImageInput.addEventListener("change", async () => {
          const file = themeImageInput.files && themeImageInput.files[0];
          if (!file) return;
          try {
            const dataUrl = await readImageFileAsDataUrl(file);
            const skinDataUrl = await compressThemeImageDataUrl(dataUrl);
            await saveThemeSnapshot({
              ...modules.state.state.theme,
              preset: "custom",
              basePreset: modules.state.state.theme.preset === "custom" ? modules.state.state.theme.basePreset || "classic" : modules.state.state.theme.preset || "classic",
              customImage: skinDataUrl,
              customImageName: String(file.name || "自定义照片"),
              glass: true
            });
            runtime.setSummaryStatus(
              runtime.getById("themeStatusSummary"),
              `自定义主题已启用：${file.name || "背景照片"}，皮肤图片约 ${Math.ceil(skinDataUrl.length / 1024)} KB。`,
              "success"
            );
          } catch (error) {
            runtime.setSummaryStatus(runtime.getById("themeStatusSummary"), `主题照片应用失败：${error.message}`, "error");
          } finally {
            themeImageInput.value = "";
          }
        });
      }
      if (clearThemeImageButton) {
        clearThemeImageButton.addEventListener("click", async () => {
          await saveThemeSnapshot({
            ...modules.state.state.theme,
            preset: modules.state.state.theme.preset === "custom" ? modules.state.state.theme.basePreset || "classic" : modules.state.state.theme.preset,
            basePreset: modules.state.state.theme.basePreset || "classic",
            customImage: "",
            customImageName: "",
            glass: false
          });
        });
      }
      fieldIds.forEach((id) => {
        const element = runtime.getById(id);
        if (!element) return;
        if (id === "settingsMaxConcurrentTasksInput") {
          element.addEventListener("input", () => {
            const previewSettings = modules.state.normalizeSettings({
              ...modules.state.state.settings,
              maxConcurrentTasks: element.value
            });
            modules.state.state.settings.maxConcurrentTasks = previewSettings.maxConcurrentTasks;
            if (modules.workspace && typeof modules.workspace.updateRunButtonState === "function") {
              modules.workspace.updateRunButtonState();
            }
          });
        }
        element.addEventListener("input", () => renderSettingsStatus("检测到未保存修改。", "pending"));
      });
      if (saveButton) {
        saveButton.addEventListener("click", async () => {
          saveButton.disabled = true;
          renderSettingsStatus("正在保存设置...", "info");
          try {
            await saveSettingsSnapshot(readSettingsForm());
            await refreshAccountSummary({ quiet: true, force: true });
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
        setApiKeyVisibility(false);
        resetButton.addEventListener("click", () => {
          const input = runtime.getById("settingsApiKeyInput");
          const visible = input ? input.type !== "password" : false;
          setApiKeyVisibility(!visible);
          renderSettingsStatus("表单已恢复为当前已加载设置。", "info");
        });
      }
      if (resetAiOptimizeButton) {
        resetAiOptimizeButton.addEventListener("click", () => {
          const input = runtime.getById("settingsAiOptimizeAppIdInput");
          if (input) input.value = modules.state.DEFAULT_AI_OPTIMIZE_APP_ID;
          renderSettingsStatus("AI 优化应用 ID 已恢复为内置默认值，记得保存设置。", "pending");
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
      updateAccountSummary,
      refreshAccountSummary,
      loadParseDebug,
      initializeSettings,
      refreshThemeSkin,
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
    modules.aiOptimize.bindModalEvents();
    modules.ui.bindPlaceholderActions();
    modules.templates.bindTemplateActions();
    modules.settings.bindSettingsActions();
    modules.sound.initialize();
    Promise.all([
      modules.apps.refreshWorkspaceApps({ quiet: true }),
      modules.quickEntries.initializeQuickEntries(),
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
        version: "2.4.3"
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
