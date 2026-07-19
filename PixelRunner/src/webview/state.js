import {
  GRS_CHAT_MODEL_IDS,
  GRS_IMAGE_MODEL_IDS,
  GRS_REGIONS,
  getGrsApiUrl,
  getGrsImageModelCapabilities,
  getGrsImageModelLabel,
  getGrsRegionConfig,
  isGrsGptImageModel as isSharedGrsGptImageModel,
  isGrsNanoBananaModel as isSharedGrsNanoBananaModel,
  normalizeGrsModelId as normalizeSharedGrsModelId,
  normalizeGrsRegion
} from "../shared/grs-config.js";

(function initStateModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  const STORAGE_KEYS = {
    API_KEY: "rh_api_key",
    API_PROFILES: "pixelrunner.runninghub.apiProfiles.v1",
    SETTINGS: "rh_settings",
    APPS: "rh_ai_apps_v2",
    PROMPT_TEMPLATES: "rh_prompt_templates",
    PROMPT_TEMPLATE_CATEGORIES: "pixelrunner.promptTemplateCategories.v1",
    LEGACY_APPS: ["rh_ai_apps", "rh_ai_apps_v1", "ai_apps", "runninghub_ai_apps"],
    CURRENT_APP_ID: "pixelrunner.current_app_id",
    WORKSPACE_MODE: "pixelrunner.workspaceMode",
    QUICK_ENTRIES: "pixelrunner.quickEntries.v1",
    SOUND_ENABLED: "pixelrunner.sound_enabled",
    SOUND_VOLUME: "pixelrunner.sound_volume",
    SOUND_MUTED: "pixelrunner.sound_muted",
    THEME: "pixelrunner.theme.v1",
    BLEND_MATCH_SETTINGS: "pixelrunner.blendMatch.settings.v1",
    THIRD_PARTY_SETTINGS: "pixelrunner.thirdParty.settings.v1",
    THIRD_PARTY_GRS_API_KEY: "pixelrunner.thirdParty.grs.apiKey",
    THIRD_PARTY_LAST_SELECTION: "pixelrunner.thirdParty.lastSelection.v1"
  };

  const DEFAULT_AI_OPTIMIZE_APP_ID = "2042544874578251778";
  const DEFAULT_GENERATIVE_FILL_APP_ID = "2072190882207584257";
  const DEFAULT_GLOBAL_AI_OPTIMIZE_APP_ID = "2077336528350871553";
  const DEFAULT_GLOBAL_GENERATIVE_FILL_APP_ID = "2077331388482748417";
  const RUNNINGHUB_REGIONS = {
    CN: "cn",
    GLOBAL: "global"
  };

  function normalizeRunningHubRegion(value) {
    const marker = String(value || "").trim().toLowerCase();
    return ["global", "international", "intl", "overseas", "ai"].includes(marker)
      ? RUNNINGHUB_REGIONS.GLOBAL
      : RUNNINGHUB_REGIONS.CN;
  }

  function getDefaultAiOptimizeAppId(region) {
    return normalizeRunningHubRegion(region) === RUNNINGHUB_REGIONS.CN
      ? DEFAULT_AI_OPTIMIZE_APP_ID
      : DEFAULT_GLOBAL_AI_OPTIMIZE_APP_ID;
  }

  function getDefaultGenerativeFillAppId(region) {
    return normalizeRunningHubRegion(region) === RUNNINGHUB_REGIONS.CN
      ? DEFAULT_GENERATIVE_FILL_APP_ID
      : DEFAULT_GLOBAL_GENERATIVE_FILL_APP_ID;
  }

  const DEFAULT_SETTINGS = {
    apiKey: "",
    runningHubRegion: RUNNINGHUB_REGIONS.CN,
    pollInterval: 2,
    timeout: 180,
    maxConcurrentTasks: 3,
    localQueueEnabled: false,
    aiOptimizeAppId: DEFAULT_AI_OPTIMIZE_APP_ID,
    aiOptimizeAppIds: {
      cn: DEFAULT_AI_OPTIMIZE_APP_ID,
      global: DEFAULT_GLOBAL_AI_OPTIMIZE_APP_ID
    },
    generativeFillAppId: DEFAULT_GENERATIVE_FILL_APP_ID,
    generativeFillAppIds: {
      cn: DEFAULT_GENERATIVE_FILL_APP_ID,
      global: DEFAULT_GLOBAL_GENERATIVE_FILL_APP_ID
    },
    generativeFillContextExpansion: 128,
    generativeFillMaskExpansion: 4,
    generativeFillFeather: 36,
    generativeFillColorCorrectionEnabled: true,
    appPickerLayout: "visual",
    plusModeEnabled: false
  };

  const DEFAULT_THIRD_PARTY_SETTINGS = {
    enabled: false,
    provider: "grs",
    grs: {
      region: GRS_REGIONS.CN,
      apiUrl: getGrsApiUrl(GRS_REGIONS.CN),
      apiKey: "",
      imageModels: [...GRS_IMAGE_MODEL_IDS],
      chatModel: "gpt-5.5",
      selectedModel: "gpt-image-2",
      aspectRatio: "auto",
      resolution: "1K",
      adapter: "grs-image-generate"
    }
  };

  const THIRD_PARTY_APP_ID = "__pixelrunner_third_party_api__";
  const GENERATIVE_FILL_APP_ID = "__pixelrunner_generative_fill__";

  const DEFAULT_THEME = {
    preset: "classic",
    basePreset: "classic",
    customImage: "",
    customImageName: "",
    glass: false
  };

  const DEFAULT_TEMPLATE_CATEGORY_ID = "default";
  const DEFAULT_TEMPLATE_CATEGORY_NAME = "默认分类";

  const state = {
    apps: [],
    currentApp: null,
    workspaceMode: "app",
    quickEntries: [],
    templates: [],
    templateCategories: [],
    appPickerKeyword: "",
    appPickerView: "picker",
    appPickerEditingAppId: null,
    appPickerEditorSnapshot: "",
    appPickerPendingDeleteId: "",
    appPickerConfirm: null,
    appManagerKeyword: "",
    appManagerSort: "manual",
    templateManagerKeyword: "",
    templateManagerSort: "manual",
    templateManagerCategoryId: DEFAULT_TEMPLATE_CATEGORY_ID,
    settings: { ...DEFAULT_SETTINGS },
    apiProfiles: [],
    activeApiProfileId: "",
    thirdPartySettings: normalizeThirdPartySettings(DEFAULT_THIRD_PARTY_SETTINGS),
    settingsLoaded: false,
    accountSummary: {
      balance: null,
      coins: null,
      region: RUNNINGHUB_REGIONS.CN,
      currency: "R",
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
      categoryId: DEFAULT_TEMPLATE_CATEGORY_ID,
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
    generativeFill: {
      prompt: "",
      selection: null,
      schema: null,
      schemaLoadedForAppId: "",
      status: "idle",
      statusMessage: "先在 Photoshop 中框选区域。",
      lastTaskId: ""
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
      volume: 80,
      muted: false,
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
    const runningHubRegion = normalizeRunningHubRegion(source.runningHubRegion || source.region);
    const sourceAiOptimizeAppIds = source.aiOptimizeAppIds && typeof source.aiOptimizeAppIds === "object"
      ? source.aiOptimizeAppIds
      : {};
    const hasRegionalCnId = Object.prototype.hasOwnProperty.call(sourceAiOptimizeAppIds, RUNNINGHUB_REGIONS.CN);
    const hasRegionalGlobalId = Object.prototype.hasOwnProperty.call(sourceAiOptimizeAppIds, RUNNINGHUB_REGIONS.GLOBAL);
    const legacyAiOptimizeAppId = String(source.aiOptimizeAppId == null ? "" : source.aiOptimizeAppId).trim();
    const aiOptimizeAppIds = {
      cn: String(
        hasRegionalCnId
          ? sourceAiOptimizeAppIds.cn
          : runningHubRegion === RUNNINGHUB_REGIONS.CN
            ? legacyAiOptimizeAppId || DEFAULT_AI_OPTIMIZE_APP_ID
            : DEFAULT_AI_OPTIMIZE_APP_ID
      ).trim(),
      global: String(
        hasRegionalGlobalId && String(sourceAiOptimizeAppIds.global || "").trim()
          ? sourceAiOptimizeAppIds.global
          : runningHubRegion === RUNNINGHUB_REGIONS.GLOBAL
            ? legacyAiOptimizeAppId || DEFAULT_GLOBAL_AI_OPTIMIZE_APP_ID
            : DEFAULT_GLOBAL_AI_OPTIMIZE_APP_ID
      ).trim()
    };
    const sourceGenerativeFillAppIds = source.generativeFillAppIds && typeof source.generativeFillAppIds === "object"
      ? source.generativeFillAppIds
      : {};
    const hasGenerativeFillCnId = Object.prototype.hasOwnProperty.call(sourceGenerativeFillAppIds, RUNNINGHUB_REGIONS.CN);
    const hasGenerativeFillGlobalId = Object.prototype.hasOwnProperty.call(sourceGenerativeFillAppIds, RUNNINGHUB_REGIONS.GLOBAL);
    const legacyGenerativeFillAppId = String(source.generativeFillAppId == null ? "" : source.generativeFillAppId).trim();
    const generativeFillAppIds = {
      cn: String(
        hasGenerativeFillCnId
          ? sourceGenerativeFillAppIds.cn
          : runningHubRegion === RUNNINGHUB_REGIONS.CN
            ? legacyGenerativeFillAppId || DEFAULT_GENERATIVE_FILL_APP_ID
            : DEFAULT_GENERATIVE_FILL_APP_ID
      ).trim(),
      global: String(
        hasGenerativeFillGlobalId && String(sourceGenerativeFillAppIds.global || "").trim()
          ? sourceGenerativeFillAppIds.global
          : runningHubRegion === RUNNINGHUB_REGIONS.GLOBAL
            ? legacyGenerativeFillAppId || DEFAULT_GLOBAL_GENERATIVE_FILL_APP_ID
            : DEFAULT_GLOBAL_GENERATIVE_FILL_APP_ID
      ).trim()
    };
    const pollInterval = Math.min(15, Math.max(1, Math.floor(Number(source.pollInterval) || DEFAULT_SETTINGS.pollInterval)));
    const timeout = Math.min(600, Math.max(10, Math.floor(Number(source.timeout) || DEFAULT_SETTINGS.timeout)));
    const maxConcurrentTasks = Math.min(100, Math.max(1, Math.floor(Number(source.maxConcurrentTasks) || DEFAULT_SETTINGS.maxConcurrentTasks)));
    const rawGenerativeFillFeather = Number(source.generativeFillFeather);
    const rawGenerativeFillContextExpansion = Number(source.generativeFillContextExpansion);
    const rawGenerativeFillMaskExpansion = Number(source.generativeFillMaskExpansion);
    const generativeFillContextExpansion = Number.isFinite(rawGenerativeFillContextExpansion)
      ? Math.min(2048, Math.max(0, Math.floor(rawGenerativeFillContextExpansion)))
      : DEFAULT_SETTINGS.generativeFillContextExpansion;
    const generativeFillMaskExpansion = Number.isFinite(rawGenerativeFillMaskExpansion)
      ? Math.min(128, Math.max(0, Math.floor(rawGenerativeFillMaskExpansion)))
      : DEFAULT_SETTINGS.generativeFillMaskExpansion;
    const generativeFillFeather = Number.isFinite(rawGenerativeFillFeather)
      ? Math.min(128, Math.max(0, Math.floor(rawGenerativeFillFeather)))
      : DEFAULT_SETTINGS.generativeFillFeather;

    return {
      apiKey: String(source.apiKey || "").trim(),
      runningHubRegion,
      pollInterval,
      timeout,
      maxConcurrentTasks,
      localQueueEnabled: source.localQueueEnabled === true,
      aiOptimizeAppId: aiOptimizeAppIds[runningHubRegion],
      aiOptimizeAppIds,
      generativeFillAppId: generativeFillAppIds[runningHubRegion],
      generativeFillAppIds,
      generativeFillContextExpansion,
      generativeFillMaskExpansion,
      generativeFillFeather,
      generativeFillColorCorrectionEnabled: source.generativeFillColorCorrectionEnabled !== false,
      appPickerLayout: String(source.appPickerLayout || "") === "compact" ? "compact" : DEFAULT_SETTINGS.appPickerLayout,
      plusModeEnabled: source.plusModeEnabled === true,
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
      region: normalizeRunningHubRegion(source.region || source.runningHubRegion),
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
        const key = `${item.region}:${item.apiKey.toLowerCase()}`;
        if (!item.apiKey || seenKeys.has(key)) return false;
        seenKeys.add(key);
        if (seenIds.has(item.id)) item.id = modules.runtime.createId("api");
        seenIds.add(item.id);
        return true;
      });
  }

  function getActiveApiProfile() {
    const activeId = String(state.activeApiProfileId || state.settings.activeApiProfileId || "").trim();
    const region = normalizeRunningHubRegion(state.settings.runningHubRegion);
    return (
      state.apiProfiles.find((item) => String(item.id) === activeId && item.region === region) ||
      state.apiProfiles.find((item) => item.region === region) ||
      null
    );
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
    const storedModels = Array.isArray(grsSource.imageModels || grsSource.models)
      ? (grsSource.imageModels || grsSource.models)
      : String(grsSource.imageModels || grsSource.models || "").split(",");
    const requestedModel = normalizeSharedGrsModelId(grsSource.selectedModel || fallback.selectedModel);
    const imageModels = normalizeModelList([...fallback.imageModels, ...storedModels, requestedModel], fallback.imageModels)
      .map(normalizeSharedGrsModelId)
      .filter((model, index, models) => Boolean(model) && models.indexOf(model) === index);
    const selectedModel = requestedModel || imageModels[0] || fallback.selectedModel;
    const capabilities = getGrsImageModelCapabilities(selectedModel);
    const requestedAspectRatio = String(grsSource.aspectRatio || fallback.aspectRatio).trim();
    const requestedResolution = String(grsSource.resolution || fallback.resolution).trim();
    const aspectRatio = capabilities.aspectRatios.includes(requestedAspectRatio) || capabilities.allowCustomAspectRatio
      ? requestedAspectRatio
      : capabilities.defaultAspectRatio;
    const resolution = capabilities.resolutions.includes(requestedResolution)
      ? requestedResolution
      : capabilities.defaultResolution;
    const region = normalizeGrsRegion(grsSource.region, grsSource.apiUrl);
    return {
      enabled: Boolean(source.enabled),
      provider: "grs",
      grs: {
        region,
        apiUrl: getGrsApiUrl(region),
        apiKey: String(grsSource.apiKey || "").trim(),
        imageModels,
        chatModel: String(grsSource.chatModel || fallback.chatModel).trim() || fallback.chatModel,
        selectedModel: selectedModel || fallback.selectedModel,
        aspectRatio: aspectRatio || capabilities.defaultAspectRatio,
        resolution: resolution || capabilities.defaultResolution,
        adapter: fallback.adapter
      }
    };
  }

  function isThirdPartyApp(app) {
    return Boolean(app && String(app.id || "") === THIRD_PARTY_APP_ID);
  }

  function normalizeGrsModelId(value) {
    return normalizeSharedGrsModelId(value);
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_\-·.。:：/\\|()[\]{}"'`~!！?？,，;；]+/g, "");
  }

  function fuzzyMatchText(target, query) {
    const rawQuery = String(query || "").trim();
    if (!rawQuery) return true;
    const rawTarget = String(target || "").trim();
    if (!rawTarget) return false;

    const normalizedTarget = normalizeSearchText(rawTarget);
    const normalizedQuery = normalizeSearchText(rawQuery);
    if (!normalizedQuery) return true;
    if (!normalizedTarget) return false;
    if (normalizedTarget.includes(normalizedQuery)) return true;

    let queryIndex = 0;
    for (let index = 0; index < normalizedTarget.length && queryIndex < normalizedQuery.length; index += 1) {
      if (normalizedTarget[index] === normalizedQuery[queryIndex]) queryIndex += 1;
    }
    return queryIndex === normalizedQuery.length;
  }

  function isGrsNanoBananaModel(value) {
    return isSharedGrsNanoBananaModel(value);
  }

  function isGrsGptImageModel(value) {
    return isSharedGrsGptImageModel(value);
  }

  function getThirdPartyModelCapabilities(model) {
    return getGrsImageModelCapabilities(model);
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
        {
          key: "model",
          label: "模型",
          name: "模型",
          type: "select",
          required: true,
          options: grs.imageModels.map((model) => ({ value: model, label: getGrsImageModelLabel(model) }))
        },
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
    const previewImage = String(
      source.previewImage ||
      source.thumbnail ||
      source.preview ||
      source.cover ||
      source.coverUrl ||
      source.image ||
      source.imageUrl ||
      source.icon ||
      ""
    ).trim();

    return {
      id,
      appId,
      region: normalizeRunningHubRegion(source.region || source.runningHubRegion),
      name,
      description: String(source.description || "").trim(),
      previewImage,
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
    const categoryId = String(source.categoryId || source.groupId || source.pageId || DEFAULT_TEMPLATE_CATEGORY_ID).trim() || DEFAULT_TEMPLATE_CATEGORY_ID;
    const now = Date.now();
    if (!title || !content.trim()) return null;

    return {
      id,
      title,
      content,
      categoryId,
      createdAt: Number(source.createdAt) > 0 ? Number(source.createdAt) : now + index,
      updatedAt: Number(source.updatedAt) > 0 ? Number(source.updatedAt) : now + index
    };
  }

  function normalizeTemplateCategoryRecord(category, index = 0) {
    const source = category && typeof category === "object" ? category : {};
    const id = String(source.id || source.categoryId || source.key || "").trim() || (index === 0 ? DEFAULT_TEMPLATE_CATEGORY_ID : modules.runtime.createId("tplcat"));
    const name = String(source.name || source.title || source.label || "").trim() || (id === DEFAULT_TEMPLATE_CATEGORY_ID ? DEFAULT_TEMPLATE_CATEGORY_NAME : `分类 ${index + 1}`);
    const now = Date.now();
    return {
      id,
      name,
      createdAt: Number(source.createdAt) > 0 ? Number(source.createdAt) : now + index,
      updatedAt: Number(source.updatedAt) > 0 ? Number(source.updatedAt) : now + index
    };
  }

  function normalizeTemplateCategoryList(categories, templates = []) {
    const seenIds = new Set();
    const out = [];
    const pushCategory = (category, index = out.length) => {
      const item = normalizeTemplateCategoryRecord(category, index);
      if (!item) return;
      if (seenIds.has(item.id)) item.id = modules.runtime.createId("tplcat");
      seenIds.add(item.id);
      out.push(item);
    };

    pushCategory({ id: DEFAULT_TEMPLATE_CATEGORY_ID, name: DEFAULT_TEMPLATE_CATEGORY_NAME }, 0);
    (Array.isArray(categories) ? categories : []).forEach((item, index) => {
      const normalized = normalizeTemplateCategoryRecord(item, index + 1);
      if (normalized.id === DEFAULT_TEMPLATE_CATEGORY_ID) {
        out[0] = { ...out[0], ...normalized, id: DEFAULT_TEMPLATE_CATEGORY_ID, name: normalized.name || DEFAULT_TEMPLATE_CATEGORY_NAME };
        return;
      }
      if (!seenIds.has(normalized.id)) {
        seenIds.add(normalized.id);
        out.push(normalized);
      }
    });

    (Array.isArray(templates) ? templates : []).forEach((template) => {
      const categoryId = String(template && template.categoryId || "").trim();
      if (!categoryId || seenIds.has(categoryId)) return;
      pushCategory({ id: categoryId, name: String(template.categoryName || template.group || template.page || "").trim() || "导入分类" }, out.length);
    });

    return out;
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
    DEFAULT_GENERATIVE_FILL_APP_ID,
    DEFAULT_GLOBAL_AI_OPTIMIZE_APP_ID,
    DEFAULT_GLOBAL_GENERATIVE_FILL_APP_ID,
    RUNNINGHUB_REGIONS,
    GRS_REGIONS,
    GRS_CHAT_MODEL_IDS,
    GRS_IMAGE_MODEL_IDS,
    DEFAULT_SETTINGS,
    DEFAULT_THIRD_PARTY_SETTINGS,
    THIRD_PARTY_APP_ID,
    GENERATIVE_FILL_APP_ID,
    DEFAULT_THEME,
    DEFAULT_TEMPLATE_CATEGORY_ID,
    DEFAULT_TEMPLATE_CATEGORY_NAME,
    state,
    normalizeTheme,
    normalizeRunningHubRegion,
    normalizeGrsRegion,
    getGrsRegionConfig,
    getGrsApiUrl,
    getGrsImageModelLabel,
    getDefaultAiOptimizeAppId,
    getDefaultGenerativeFillAppId,
    normalizeSettings,
    normalizeApiProfileRecord,
    normalizeApiProfileList,
    getActiveApiProfile,
    normalizeThirdPartySettings,
    isThirdPartyApp,
    normalizeGrsModelId,
    normalizeSearchText,
    fuzzyMatchText,
    isGrsNanoBananaModel,
    isGrsGptImageModel,
    getThirdPartyModelCapabilities,
    getThirdPartyApp,
    normalizeAppInputs,
    resolveAppId,
    normalizeAppRecord,
    normalizeAppList,
    normalizeTemplateRecord,
    normalizeTemplateCategoryRecord,
    normalizeTemplateCategoryList,
    normalizeTemplateList,
    getAppInputCount,
    getAppDisplayName,
    getAppDisplayId,
    isPromptLikeInput,
    buildDefaultFormValues
  };
})(window);
