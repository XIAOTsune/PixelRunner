import assert from "node:assert/strict";
let idSequence = 0;

const persisted = new Map();
const savedTemplate = { id: "template-1" };
const templateCalls = [];
const historyRecord = {
  id: "history-1",
  appId: "app-1",
  appName: "测试应用",
  fieldKey: "prompt",
  fieldLabel: "提示词",
  content: "完整提示词内容",
  createdAt: 100,
  lastUsedAt: 200
};
const badge = { textContent: "" };
const status = { textContent: "" };
const list = { innerHTML: "", parentElement: { classList: { add() {} } } };

const modules = {
  state: {
    STORAGE_KEYS: { PROMPT_HISTORY: "prompt-history", PROMPT_TEMPLATES: "prompt-templates", PROMPT_TEMPLATE_CATEGORIES: "prompt-template-categories" },
    DEFAULT_TEMPLATE_CATEGORY_ID: "default",
    DEFAULT_TEMPLATE_CATEGORY_NAME: "默认分类",
    state: {
      promptHistory: [],
      currentApp: null,
      templates: [],
      templateCategories: [{ id: "default", name: "默认分类" }],
      templateManagerCategoryId: "default",
      templatePicker: { categoryId: "default", selectedIds: [] }
    },
    resolveAppId() { return ""; },
    normalizeTemplateRecord(template, index = 0) {
      if (!template || !template.title || !String(template.content || "").trim()) return null;
      return { ...template, createdAt: template.createdAt || 100 + index, updatedAt: template.updatedAt || 100 + index, favorite: template.favorite === true };
    },
    normalizeTemplateCategoryList(categories, templates = []) {
      const items = Array.isArray(categories) ? categories.slice() : [];
      if (!items.some((item) => item.id === "default")) items.unshift({ id: "default", name: "默认分类" });
      templates.forEach((item) => {
        const id = String(item.categoryId || "default");
        if (!items.some((category) => String(category.id) === id)) items.push({ id, name: "测试分类" });
      });
      return items;
    }
  },
  runtime: {
    createId(prefix) { return `${prefix}-generated-${++idSequence}`; },
    async storageGetItem(key) { return persisted.has(key) ? persisted.get(key) : JSON.stringify([historyRecord]); },
    async storageSetItem(key, value) { persisted.set(key, value); },
    async backupWorkspaceFromState() {},
    readJsonText(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } },
    escapeHtml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
    getById(id) {
      return ({ promptHistorySettingsSummary: badge, promptHistorySettingsStatus: status, promptHistorySettingsList: list })[id] || null;
    },
    setSummaryStatus(element, message) { element.textContent = message; }
  },
  templates: {
    async savePromptHistoryToDefaultCategory(item) {
      templateCalls.push(["save", item.id]);
      return { template: savedTemplate, owned: true, previousFavorite: false };
    },
    async removePromptHistoryTemplate(item) { templateCalls.push(["remove", item.id, item.savedTemplateId]); }
  },
  ui: { logToWorkspace() {} }
};

globalThis.window = { PixelRunnerModules: modules };
await import("../src/webview/prompt-history.js");
await modules.promptHistory.initialize();

const item = modules.state.state.promptHistory[0];
assert.equal(item.savedAsTemplate, false);
await modules.promptHistory.toggleSavedTemplate(item.id);
assert.equal(item.savedAsTemplate, true);
assert.equal(item.savedTemplateId, "template-1");
assert.equal(item.savedTemplateOwned, true);
assert.match(list.innerHTML, /aria-pressed="true"/);
assert.doesNotMatch(list.innerHTML, /disabled/);

await modules.promptHistory.toggleSavedTemplate(item.id);
const unstarredItem = modules.state.state.promptHistory[0];
assert.equal(unstarredItem.savedAsTemplate, false);
assert.equal(unstarredItem.savedTemplateId, "");
assert.deepEqual(templateCalls, [["save", "history-1"], ["remove", "history-1", "template-1"]]);
assert.match(list.innerHTML, /aria-pressed="false"/);
assert.equal(JSON.parse(persisted.get("prompt-history"))[0].savedAsTemplate, false);

await import("../src/webview/templates.js");
modules.state.state.promptHistory = [];
const createdFavorite = await modules.templates.savePromptHistoryToDefaultCategory({ id: "history-created", appName: "测试应用", fieldLabel: "提示词", content: "由历史新建的模板" });
assert.equal(createdFavorite.owned, true);
assert.equal(createdFavorite.template.source, "prompt-history");
assert.equal(modules.state.state.templates.length, 1);
await modules.templates.removePromptHistoryTemplate({ id: "history-created", content: "由历史新建的模板", savedTemplateId: createdFavorite.template.id, savedTemplateOwned: true });
assert.equal(modules.state.state.templates.length, 0);

const sharedFavorite = await modules.templates.savePromptHistoryToDefaultCategory({ id: "history-owner", appName: "测试应用", fieldLabel: "提示词", content: "被两条历史引用的模板" });
modules.state.state.promptHistory = [
  { id: "history-owner", content: "被两条历史引用的模板", savedAsTemplate: true, savedTemplateId: sharedFavorite.template.id, savedTemplateOwned: true },
  { id: "history-secondary", content: "被两条历史引用的模板", savedAsTemplate: true, savedTemplateId: sharedFavorite.template.id, savedTemplateOwned: false }
];
await modules.templates.removePromptHistoryTemplate(modules.state.state.promptHistory[0]);
assert.equal(modules.state.state.templates.length, 1);
modules.state.state.promptHistory[0].savedAsTemplate = false;
await modules.templates.removePromptHistoryTemplate(modules.state.state.promptHistory[1]);
assert.equal(modules.state.state.templates.length, 0);

modules.state.state.templates = [{ id: "existing-template", title: "已有模板", content: "本来未收藏", categoryId: "default", favorite: false }];
const existingFavorite = await modules.templates.savePromptHistoryToDefaultCategory({ id: "history-existing", appName: "测试应用", fieldLabel: "提示词", content: "本来未收藏" });
assert.equal(existingFavorite.owned, false);
assert.equal(existingFavorite.previousFavorite, false);
assert.equal(modules.state.state.templates[0].favorite, true);
await modules.templates.removePromptHistoryTemplate({ id: "history-existing", content: "本来未收藏", savedTemplateId: existingFavorite.template.id, savedTemplateOwned: false, savedTemplatePreviousFavorite: false });
assert.equal(modules.state.state.templates.length, 1);
assert.equal(modules.state.state.templates[0].favorite, false);

modules.state.state.templates[0].favorite = true;
const preexistingFavorite = await modules.templates.savePromptHistoryToDefaultCategory({ id: "history-pre-favorite", appName: "测试应用", fieldLabel: "提示词", content: "本来未收藏" });
assert.equal(preexistingFavorite.previousFavorite, true);
await modules.templates.removePromptHistoryTemplate({ id: "history-pre-favorite", content: "本来未收藏", savedTemplateId: preexistingFavorite.template.id, savedTemplateOwned: false, savedTemplatePreviousFavorite: true });
assert.equal(modules.state.state.templates[0].favorite, true);

delete globalThis.window;
console.log("Prompt history favorite toggle tests passed.");
