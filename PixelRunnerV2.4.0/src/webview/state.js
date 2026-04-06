(function initStateModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

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
    timeout: 180
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

    return {
      apiKey: String(source.apiKey || "").trim(),
      pollInterval,
      timeout
    };
  }

  function normalizeAppInputs(inputs) {
    if (!Array.isArray(inputs)) return [];

    return inputs
      .filter((item) => item && typeof item === "object")
      .map((item, index) => {
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
          options: Array.isArray(source.options) ? source.options : undefined
        };
      })
      .filter(Boolean);
  }

  function normalizeAppRecord(app, index = 0) {
    const runtime = modules.runtime;
    const source = app && typeof app === "object" ? app : {};
    const now = Date.now();
    const appId = String(source.appId || source.webappId || source.id || "").trim();
    const id = String(source.id || "").trim() || runtime.createId("app");
    const name = String(source.name || source.title || `应用 ${index + 1}`).trim() || `应用 ${index + 1}`;

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
    const seenIds = new Set();
    return (Array.isArray(templates) ? templates : [])
      .map((item, index) => normalizeTemplateRecord(item, index))
      .filter((item) => {
        if (!item) return false;
        if (seenIds.has(item.id)) {
          item.id = modules.runtime.createId("tpl");
        }
        seenIds.add(item.id);
        return true;
      });
  }

  function normalizeAppList(apps) {
    return (Array.isArray(apps) ? apps : [])
      .filter((item) => item && typeof item === "object")
      .map((item, index) => normalizeAppRecord(item, index))
      .filter((item) => item.appId);
  }

  function getAppInputCount(app) {
    return Array.isArray(app && app.inputs) ? app.inputs.length : 0;
  }

  function getAppDisplayName(app) {
    return String((app && (app.name || app.title)) || "未命名应用");
  }

  function getAppDisplayId(app) {
    return String((app && (app.appId || app.id)) || "-");
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
