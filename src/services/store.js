const { STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_PROMPT_TEMPLATES } = require("../config");
const { generateId, safeJsonParse, normalizeAppId, inferInputType } = require("../utils");
const PASTE_STRATEGY_CHOICES = ["normal", "smart"];
const LEGACY_PASTE_STRATEGY_MAP = {
  stretch: "normal",
  contain: "normal",
  cover: "normal",
  alphaTrim: "smart",
  edgeAuto: "smart"
};

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
  const value = readJson(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  const uploadMaxEdgeRaw = Number(value.uploadMaxEdge);
  const uploadMaxEdge = [0, 1024, 2048, 4096].includes(uploadMaxEdgeRaw) ? uploadMaxEdgeRaw : DEFAULT_SETTINGS.uploadMaxEdge;
  let pasteStrategy = String(value.pasteStrategy || "").trim();
  if (LEGACY_PASTE_STRATEGY_MAP[pasteStrategy]) {
    pasteStrategy = LEGACY_PASTE_STRATEGY_MAP[pasteStrategy];
  }
  pasteStrategy = PASTE_STRATEGY_CHOICES.includes(pasteStrategy) ? pasteStrategy : DEFAULT_SETTINGS.pasteStrategy;
  return {
    pollInterval: Number(value.pollInterval) || DEFAULT_SETTINGS.pollInterval,
    timeout: Number(value.timeout) || DEFAULT_SETTINGS.timeout,
    uploadMaxEdge,
    pasteStrategy
  };
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
    pollInterval: Number(settings.pollInterval) || DEFAULT_SETTINGS.pollInterval,
    timeout: Number(settings.timeout) || DEFAULT_SETTINGS.timeout,
    uploadMaxEdge,
    pasteStrategy
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
  if (!Array.isArray(value) || value.length === 0) return [...DEFAULT_PROMPT_TEMPLATES];
  return value;
}

function savePromptTemplates(templates) {
  const normalized = (Array.isArray(templates) ? templates : []).map((item) => {
    const source = item && typeof item === "object" ? item : {};
    return {
      ...source,
      title: String(source.title || "").trim(),
      content: String(source.content || "")
    };
  });
  writeJson(STORAGE_KEYS.PROMPT_TEMPLATES, normalized);
}

function addPromptTemplate(template) {
  const list = getPromptTemplates();
  list.push({
    id: generateId(),
    title: String(template.title || "").trim(),
    content: String(template.content || ""),
    createdAt: Date.now()
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
  migrateLegacyWorkflows
};
