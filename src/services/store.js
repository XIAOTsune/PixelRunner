const { STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_PROMPT_TEMPLATES } = require("../config");
const { generateId, safeJsonParse, normalizeAppId, inferInputType } = require("../utils");
const { normalizeCloudConcurrentJobs } = require("../domain/policies/run-settings-policy");
const PASTE_STRATEGY_CHOICES = ["normal", "smart", "smartEnhanced"];
const SETTINGS_SCHEMA_VERSION = 4;
const PROMPT_TEMPLATE_BUNDLE_FORMAT = "pixelrunner.prompt-templates";
const PROMPT_TEMPLATE_BUNDLE_VERSION = 1;
const LEGACY_PASTE_STRATEGY_MAP = {
  stretch: "normal",
  contain: "normal",
  cover: "normal",
  alphaTrim: "smart",
  edgeAuto: "smart"
};

function toPositiveInteger(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function normalizePollInterval(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.pollInterval;
  return Math.max(1, Math.min(15, Math.floor(num)));
}

function normalizeTimeout(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.timeout;
  return Math.max(10, Math.min(600, Math.floor(num)));
}

function readJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  return safeJsonParse(raw, fallback);
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getApiKey() {
  return localStorage.getItem(STORAGE_KEYS.API_KEY) || "";
}

function saveApiKey(apiKey) {
  localStorage.setItem(STORAGE_KEYS.API_KEY, String(apiKey || "").trim());
}

function getSettings() {
  const rawValue = readJson(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  const value = rawValue && typeof rawValue === "object" ? rawValue : {};
  const uploadMaxEdgeRaw = Number(value.uploadMaxEdge);
  let uploadMaxEdge = [0, 1024, 2048, 4096].includes(uploadMaxEdgeRaw) ? uploadMaxEdgeRaw : DEFAULT_SETTINGS.uploadMaxEdge;
  let pasteStrategy = String(value.pasteStrategy || "").trim();
  if (LEGACY_PASTE_STRATEGY_MAP[pasteStrategy]) {
    pasteStrategy = LEGACY_PASTE_STRATEGY_MAP[pasteStrategy];
  }
  pasteStrategy = PASTE_STRATEGY_CHOICES.includes(pasteStrategy) ? pasteStrategy : DEFAULT_SETTINGS.pasteStrategy;
  let timeout = normalizeTimeout(value.timeout);
  const cloudConcurrentJobs = normalizeCloudConcurrentJobs(value.cloudConcurrentJobs, DEFAULT_SETTINGS.cloudConcurrentJobs);
  const schemaVersion = toPositiveInteger(value.schemaVersion, 0);
  let shouldPersistMigration = false;

  // Migrate legacy settings written before schemaVersion existed.
  // Older releases often persisted 90s timeout; raise to current default to reduce timeout failures.
  if (schemaVersion < SETTINGS_SCHEMA_VERSION) {
    if (timeout < DEFAULT_SETTINGS.timeout) timeout = DEFAULT_SETTINGS.timeout;
    // Since upload resolution cap moved to advanced settings, reset legacy values to default unlimited once.
    if (schemaVersion < 3) uploadMaxEdge = DEFAULT_SETTINGS.uploadMaxEdge;
    shouldPersistMigration = true;
  }

  const normalizedSettings = {
    pollInterval: normalizePollInterval(value.pollInterval),
    timeout,
    uploadMaxEdge,
    pasteStrategy,
    cloudConcurrentJobs
  };

  if (shouldPersistMigration) {
    writeJson(STORAGE_KEYS.SETTINGS, {
      ...normalizedSettings,
      schemaVersion: SETTINGS_SCHEMA_VERSION
    });
  }

  return normalizedSettings;
}

function saveSettings(settings) {
  const uploadMaxEdgeRaw = Number(settings.uploadMaxEdge);
  const uploadMaxEdge = [0, 1024, 2048, 4096].includes(uploadMaxEdgeRaw) ? uploadMaxEdgeRaw : DEFAULT_SETTINGS.uploadMaxEdge;
  let pasteStrategy = String(settings.pasteStrategy || "").trim();
  if (LEGACY_PASTE_STRATEGY_MAP[pasteStrategy]) {
    pasteStrategy = LEGACY_PASTE_STRATEGY_MAP[pasteStrategy];
  }
  pasteStrategy = PASTE_STRATEGY_CHOICES.includes(pasteStrategy) ? pasteStrategy : DEFAULT_SETTINGS.pasteStrategy;
  writeJson(STORAGE_KEYS.SETTINGS, {
    pollInterval: normalizePollInterval(settings.pollInterval),
    timeout: normalizeTimeout(settings.timeout),
    uploadMaxEdge,
    pasteStrategy,
    cloudConcurrentJobs: normalizeCloudConcurrentJobs(settings.cloudConcurrentJobs, DEFAULT_SETTINGS.cloudConcurrentJobs),
    schemaVersion: SETTINGS_SCHEMA_VERSION
  });
}

function getAiApps() {
  const apps = readJson(STORAGE_KEYS.AI_APPS, []);
  return Array.isArray(apps) ? apps : [];
}

function saveAiApps(apps) {
  writeJson(STORAGE_KEYS.AI_APPS, Array.isArray(apps) ? apps : []);
}

function addAiApp(appData) {
  const list = getAiApps();
  const item = {
    ...appData,
    id: generateId(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  list.push(item);
  saveAiApps(list);
  return item.id;
}

function updateAiApp(id, appData) {
  const list = getAiApps();
  const idx = list.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  list[idx] = {
    ...list[idx],
    ...appData,
    id,
    updatedAt: Date.now()
  };
  saveAiApps(list);
  return true;
}

function deleteAiApp(id) {
  const list = getAiApps();
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  saveAiApps(next);
  return true;
}

function getPromptTemplates() {
  const value = readJson(STORAGE_KEYS.PROMPT_TEMPLATES, DEFAULT_PROMPT_TEMPLATES);
  const sourceList = Array.isArray(value) && value.length > 0 ? value : DEFAULT_PROMPT_TEMPLATES;
  const normalized = normalizePromptTemplates(sourceList);
  if (normalized.length === 0) {
    return normalizePromptTemplates(DEFAULT_PROMPT_TEMPLATES);
  }
  if (!isSamePromptTemplateList(sourceList, normalized)) {
    writeJson(STORAGE_KEYS.PROMPT_TEMPLATES, normalized);
  }
  return normalized;
}

function savePromptTemplates(templates) {
  const normalized = normalizePromptTemplates(templates);
  writeJson(STORAGE_KEYS.PROMPT_TEMPLATES, normalized);
}

function addPromptTemplate(template) {
  const list = getPromptTemplates();
  list.push({
    ...(template && typeof template === "object" ? template : {}),
    id: template && template.id ? String(template.id) : generateId(),
    title: String((template && template.title) || "").trim(),
    content: String((template && template.content) || ""),
    createdAt: toPositiveInteger(template && template.createdAt, Date.now())
  });
  savePromptTemplates(list);
}

function deletePromptTemplate(id) {
  const list = getPromptTemplates();
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  savePromptTemplates(next);
  return true;
}

function normalizePromptTemplate(source, index = 0, seenIds = new Set()) {
  const safeSource = source && typeof source === "object" ? source : {};
  const title = String(safeSource.title || "").trim();
  const content = String(safeSource.content == null ? "" : safeSource.content);
  if (!title || !content) return null;

  let id = String(safeSource.id || "").trim();
  if (!id || seenIds.has(id)) id = generateId();
  seenIds.add(id);

  const now = Date.now();
  const createdAt = toPositiveInteger(safeSource.createdAt, now + index);
  const updatedAt = toPositiveInteger(safeSource.updatedAt, 0);
  const normalized = {
    id,
    title,
    content,
    createdAt
  };
  if (updatedAt > 0) normalized.updatedAt = updatedAt;
  return normalized;
}

function normalizePromptTemplates(templates) {
  const list = Array.isArray(templates) ? templates : [];
  const seenIds = new Set();
  const normalized = [];
  list.forEach((item, index) => {
    const next = normalizePromptTemplate(item, index, seenIds);
    if (next) normalized.push(next);
  });
  return normalized;
}

function isSamePromptTemplateList(sourceList, normalizedList) {
  if (!Array.isArray(sourceList) || !Array.isArray(normalizedList)) return false;
  if (sourceList.length !== normalizedList.length) return false;
  for (let i = 0; i < sourceList.length; i += 1) {
    const source = sourceList[i] && typeof sourceList[i] === "object" ? sourceList[i] : {};
    const normalized = normalizedList[i] && typeof normalizedList[i] === "object" ? normalizedList[i] : {};
    if (String(source.id || "").trim() !== String(normalized.id || "").trim()) return false;
    if (String(source.title || "").trim() !== String(normalized.title || "")) return false;
    if (String(source.content == null ? "" : source.content) !== String(normalized.content || "")) return false;
    if (toPositiveInteger(source.createdAt, 0) !== toPositiveInteger(normalized.createdAt, 0)) return false;
    if (toPositiveInteger(source.updatedAt, 0) !== toPositiveInteger(normalized.updatedAt, 0)) return false;
  }
  return true;
}

function buildPromptTemplatesBundle() {
  const templates = getPromptTemplates().map((template) => ({
    id: template.id,
    title: template.title,
    content: template.content,
    createdAt: template.createdAt
  }));
  return {
    format: PROMPT_TEMPLATE_BUNDLE_FORMAT,
    version: PROMPT_TEMPLATE_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    templates
  };
}

function parsePromptTemplatesBundle(payload) {
  let parsed = payload;
  if (typeof payload === "string") {
    parsed = safeJsonParse(payload, null);
  }
  if (!parsed) throw new Error("JSON 解析失败");

  let templatesSource = null;
  if (Array.isArray(parsed)) {
    templatesSource = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.templates)) {
    if (parsed.format && String(parsed.format) !== PROMPT_TEMPLATE_BUNDLE_FORMAT) {
      throw new Error(`不支持的模板格式: ${parsed.format}`);
    }
    templatesSource = parsed.templates;
  }

  if (!Array.isArray(templatesSource)) {
    throw new Error("JSON 文件中未找到 templates 数组");
  }

  const templates = normalizePromptTemplates(templatesSource);
  if (templates.length === 0) {
    throw new Error("未解析到可导入的模板（需要包含 title 与 content）");
  }
  return templates;
}

function migrateLegacyWorkflows(log) {
  const currentApps = getAiApps();
  if (currentApps.length > 0) return;

  const legacyAiAppKeys = Array.isArray(STORAGE_KEYS.LEGACY_AI_APPS) ? STORAGE_KEYS.LEGACY_AI_APPS : [];
  for (const legacyKey of legacyAiAppKeys) {
    const legacyApps = readJson(legacyKey, []);
    if (!Array.isArray(legacyApps) || legacyApps.length === 0) continue;

    const convertedApps = legacyApps
      .map((app, appIndex) => {
        const appId = normalizeAppId(app.appId || app.workflowId || app.webappId || app.id || app.code || "");
        if (!appId) return null;

        const rawInputs = Array.isArray(app.inputs)
          ? app.inputs
          : Array.isArray(app.params)
          ? app.params
          : Array.isArray(app.mappings)
          ? app.mappings
          : [];

        const inputs = rawInputs
          .map((input, inputIndex) => {
            const key = String(
              input.key || input.paramKey || input.fieldName || input.name || `param_${inputIndex + 1}`
            ).trim();
            if (!key) return null;

            const label = String(input.label || input.title || input.name || input.description || key).trim();
            return {
              key,
              name: label,
              label,
              type: inferInputType(input.type || input.fieldType),
              required: input.required !== false,
              default: input.default,
              options: Array.isArray(input.options) ? [...input.options] : undefined
            };
          })
          .filter(Boolean);

        return {
          id: generateId(),
          appId,
          name: String(app.name || app.title || app.appName || `应用 ${appIndex + 1}`),
          description: String(app.description || ""),
          inputs,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      })
      .filter(Boolean);

    if (convertedApps.length > 0) {
      saveAiApps(convertedApps);
      if (typeof log === "function") log(`已迁移 ${convertedApps.length} 个旧版应用（${legacyKey}）`, "success");
      return;
    }
  }

  const legacy = readJson(STORAGE_KEYS.LEGACY_WORKFLOWS, []);
  if (!Array.isArray(legacy) || legacy.length === 0) return;

  const converted = legacy
    .map((w) => ({
      id: generateId(),
      appId: normalizeAppId(w.workflowId || w.appId || ""),
      name: String(w.name || "未命名应用"),
      description: "",
      inputs: Array.isArray(w.mappings)
        ? w.mappings
            .map((m, idx) => {
              const key = String(m.key || m.name || `param_${idx + 1}`).trim();
              const label = String(m.label || key || "参数").trim();
              return {
                key,
                name: label,
                label,
                type: inferInputType(m.type),
                required: true
              };
            })
            .filter((x) => x.key)
        : [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }))
    .filter((x) => x.appId);

  if (converted.length > 0) {
    saveAiApps(converted);
    if (typeof log === "function") log(`已迁移 ${converted.length} 个旧工作流`, "success");
  }
}

module.exports = {
  getApiKey,
  saveApiKey,
  getSettings,
  saveSettings,
  getAiApps,
  saveAiApps,
  addAiApp,
  updateAiApp,
  deleteAiApp,
  getPromptTemplates,
  savePromptTemplates,
  addPromptTemplate,
  deletePromptTemplate,
  buildPromptTemplatesBundle,
  parsePromptTemplatesBundle,
  migrateLegacyWorkflows
};
