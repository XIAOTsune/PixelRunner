(function initStateModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  const STORAGE_KEYS = {
    API_KEY: "rh_api_key",
    API_PROFILES: "pixelrunner.runninghub.apiProfiles.v1",
    SETTINGS: "rh_settings",
    APPS: "rh_ai_apps_v2",
    PROMPT_TEMPLATES: "rh_prompt_templates",
    LEGACY_APPS: ["rh_ai_apps", "rh_ai_apps_v1", "ai_apps", "runninghub_ai_apps"],
    CURRENT_APP_ID: "pixelrunner.current_app_id",
    WORKSPACE_MODE: "pixelrunner.workspaceMode",
    QUICK_ENTRIES: "pixelrunner.quickEntries.v1",
    SOUND_ENABLED: "pixelrunner.sound_enabled",
    THEME: "pixelrunner.theme.v1",
    THIRD_PARTY_SETTINGS: "pixelrunner.thirdParty.settings.v1",
    THIRD_PARTY_GRS_API_KEY: "pixelrunner.thirdParty.grs.apiKey",
    THIRD_PARTY_LAST_SELECTION: "pixelrunner.thirdParty.lastSelection.v1"
  };

  const DEFAULT_AI_OPTIMIZE_APP_ID = "2042544874578251778";

  const DEFAULT_SETTINGS = {
    apiKey: "",
    pollInterval: 2,
    timeout: 180,
    maxConcurrentTasks: 3,
    aiOptimizeAppId: DEFAULT_AI_OPTIMIZE_APP_ID
  };

  const DEFAULT_THIRD_PARTY_SETTINGS = {
    enabled: false,
    provider: "grs",
    grs: {
      apiUrl: "https://grsaiapi.com",
      apiKey: "",
      imageModels: ["gpt-image-2", "gpt-image-2-vip", "nano-banana-pro", "nano-banana", "nano-banana-2"],
      chatModel: "gpt-5.5",
      selectedModel: "gpt-image-2",
      aspectRatio: "auto",
      resolution: "1K",
      adapter: "grs-image-generate"
    }
  };

  const THIRD_PARTY_APP_ID = "__pixelrunner_third_party_api__";

  const GRS_COMMON_BANANA_RATIOS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21"];
  const GRS_GPT_IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536", "1774x887", "887x1774"];

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
    apiProfiles: [],
    activeApiProfileId: "",
    thirdPartySettings: normalizeThirdPartySettings(DEFAULT_THIRD_PARTY_SETTINGS),
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
    const preset = ["classic", "aurora", "graphite", "rose", "studio"].includes(String(source.preset || ""))
      ? String(source.preset)
      : DEFAULT_THEME.preset;
    const customImage = String(source.customImage || "").trim();
    const basePreset = ["classic", "aurora", "graphite", "rose", "studio"].includes(String(source.basePreset || ""))
      ? String(source.basePreset)
      : preset;
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
      aiOptimizeAppId: String(source.aiOptimizeAppId || DEFAULT_AI_OPTIMIZE_APP_ID).trim() || DEFAULT_AI_OPTIMIZE_APP_ID,
      activeApiProfileId: String(source.activeApiProfileId || "").trim()
    };
  }

  function normalizeApiProfileRecord(profile, index = 0) {
    const source = profile && typeof profile === "object" ? profile : {};
    const apiKey = String(source.apiKey || "").trim();
    const name = String(source.name || source.title || `API ${index + 1}`).trim() || `API ${index + 1}`;
    const id = String(source.id || "").trim() || modules.runtime.createId("api");
    const now = Date.now();
    return {
      id,
      name,
      apiKey,
      createdAt: Number(source.createdAt) > 0 ? Number(source.createdAt) : now + index,
      updatedAt: Number(source.updatedAt) > 0 ? Number(source.updatedAt) : now + index
    };
  }

  function normalizeApiProfileList(profiles) {
    const seenIds = new Set();
    const seenKeys = new Set();
    return (Array.isArray(profiles) ? profiles : [])
      .map((item, index) => normalizeApiProfileRecord(item, index))
      .filter((item) => {
        const key = item.apiKey.toLowerCase();
        if (!item.apiKey || seenKeys.has(key)) return false;
        seenKeys.add(key);
        if (seenIds.has(item.id)) item.id = modules.runtime.createId("api");
        seenIds.add(item.id);
        return true;
      });
  }

  function getActiveApiProfile() {
    const activeId = String(state.activeApiProfileId || state.settings.activeApiProfileId || "").trim();
    return state.apiProfiles.find((item) => String(item.id) === activeId) || state.apiProfiles[0] || null;
  }

  function normalizeModelList(models, fallback) {
    const source = Array.isArray(models) ? models : String(models || "").split(",");
    const seen = new Set();
    const out = [];
    source.forEach((item) => {
      const text = String(item || "").trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) return;
      seen.add(key);
      out.push(text);
    });
    return out.length ? out : fallback.slice();
  }

  function normalizeThirdPartySettings(settings) {
    const source = settings && typeof settings === "object" ? settings : {};
    const grsSource = source.grs && typeof source.grs === "object" ? source.grs : {};
    const fallback = DEFAULT_THIRD_PARTY_SETTINGS.grs;
    const imageModels = normalizeModelList(grsSource.imageModels || grsSource.models, fallback.imageModels);
    const selectedModel = String(grsSource.selectedModel || imageModels[0] || fallback.selectedModel).trim();
    return {
      enabled: Boolean(source.enabled),
      provider: "grs",
      grs: {
        apiUrl: String(grsSource.apiUrl || fallback.apiUrl).trim() || fallback.apiUrl,
        apiKey: String(grsSource.apiKey || "").trim(),
        imageModels,
        chatModel: String(grsSource.chatModel || fallback.chatModel).trim() || fallback.chatModel,
        selectedModel: selectedModel || fallback.selectedModel,
        aspectRatio: String(grsSource.aspectRatio || fallback.aspectRatio).trim() || fallback.aspectRatio,
        resolution: String(grsSource.resolution || fallback.resolution).trim() || fallback.resolution,
        adapter: String(grsSource.adapter || fallback.adapter).trim() || fallback.adapter
      }
    };
  }

  function isThirdPartyApp(app) {
    return Boolean(app && String(app.id || "") === THIRD_PARTY_APP_ID);
  }

  function normalizeGrsModelId(value) {
    const text = String(value || "").trim().toLowerCase();
    const compact = text.replace(/[\s_-]/g, "");
    const aliases = {
      gptimage2: "gpt-image-2",
      gptimage2vip: "gpt-image-2-vip",
      nanobanana: "nano-banana",
      nanobananapro: "nano-banana-pro",
      nanobananafast: "nano-banana-fast",
      nanobanana2: "nano-banana-2",
      nanobanana2cl: "nano-banana-2-cl",
      nanobananaprocl: "nano-banana-pro-cl",
      nanobanana24kcl: "nano-banana-2-4k-cl",
      nanobananaprovip: "nano-banana-pro-vip",
      nanobananapro4kvip: "nano-banana-pro-4k-vip",
      nanobananaprovt: "nano-banana-pro-vt"
    };
    return aliases[compact] || text;
  }

  function isGrsNanoBananaModel(value) {
    return /^nano-banana(?:$|-)/i.test(normalizeGrsModelId(value));
  }

  function isGrsGptImageModel(value) {
    return /^gpt-image-2(?:-vip)?$/i.test(normalizeGrsModelId(value));
  }

  function getThirdPartyModelCapabilities(model) {
    const normalized = normalizeGrsModelId(model);
    if (isGrsGptImageModel(normalized)) {
      return {
        model: normalized,
        aspectRatios: GRS_GPT_IMAGE_SIZES,
        resolutions: normalized === "gpt-image-2-vip" ? ["1K", "2K", "4K"] : ["1K"],
        allowCustomAspectRatio: false,
        defaultAspectRatio: "1024x1024",
        defaultResolution: "1K"
      };
    }
    if (isGrsNanoBananaModel(normalized)) {
      const hasHighResolution = /(?:^nano-banana-(?:2|pro)|4k|vip)/i.test(normalized);
      return {
        model: normalized,
        aspectRatios: GRS_COMMON_BANANA_RATIOS,
        resolutions: hasHighResolution ? ["1K", "2K", "4K"] : ["1K"],
        allowCustomAspectRatio: true,
        defaultAspectRatio: "auto",
        defaultResolution: "1K"
      };
    }
    return {
      model: normalized,
      aspectRatios: ["1:1"],
      resolutions: ["1K"],
      allowCustomAspectRatio: false,
      defaultAspectRatio: "1:1",
      defaultResolution: "1K"
    };
  }

  function getThirdPartyApp() {
    const grs = state.thirdPartySettings && state.thirdPartySettings.grs ? state.thirdPartySettings.grs : DEFAULT_THIRD_PARTY_SETTINGS.grs;
    const capabilities = getThirdPartyModelCapabilities(grs.selectedModel || grs.imageModels[0]);
    return {
      id: THIRD_PARTY_APP_ID,
      appId: THIRD_PARTY_APP_ID,
      name: "第三方 API",
      description: "GRS 第三方生图入口",
      provider: "grs",
      thirdParty: true,
      inputs: [
        { key: "mainImage", label: "主图", name: "主图", type: "image", required: false },
        { key: "referenceImage", label: "参考图", name: "参考图", type: "image", required: false },
        { key: "prompt", label: "提示词", name: "提示词", type: "textarea", required: true },
        { key: "model", label: "模型", name: "模型", type: "select", required: true, options: grs.imageModels },
        {
          key: "aspectRatio",
          label: "比例",
          name: "比例",
          type: "select",
          required: true,
          options: capabilities.allowCustomAspectRatio ? [...capabilities.aspectRatios, { value: "__custom__", label: "自定义比例" }] : capabilities.aspectRatios,
          allowCustom: capabilities.allowCustomAspectRatio,
          customKey: "aspectRatioCustom",
          customPlaceholder: "例如 5:4、7:5 或 1328x768"
        },
        { key: "resolution", label: "分辨率", name: "分辨率", type: "select", required: true, options: capabilities.resolutions }
      ]
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
    const seenIds = new Set();
    return (Array.isArray(templates) ? templates : [])
      .map((item, index) => normalizeTemplateRecord(item, index))
      .filter((item) => {
        if (!item) return false;
        if (seenIds.has(item.id)) item.id = modules.runtime.createId("tpl");
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
    DEFAULT_THIRD_PARTY_SETTINGS,
    THIRD_PARTY_APP_ID,
    DEFAULT_THEME,
    state,
    normalizeTheme,
    normalizeSettings,
    normalizeApiProfileRecord,
    normalizeApiProfileList,
    getActiveApiProfile,
    normalizeThirdPartySettings,
    isThirdPartyApp,
    normalizeGrsModelId,
    isGrsNanoBananaModel,
    isGrsGptImageModel,
    getThirdPartyModelCapabilities,
    getThirdPartyApp,
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
