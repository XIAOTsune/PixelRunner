import assert from "node:assert/strict";

globalThis.document = { getElementById: () => null };
globalThis.window = { PixelRunnerModules: {} };

const storage = new Map();
let idSequence = 0;
let lastSummaryStatus = null;
const form = {
  title: { value: "" },
  content: { value: "" }
};

function normalizeTemplate(template, index = 0) {
  const source = template && typeof template === "object" ? template : {};
  if (!String(source.title || "").trim() || !String(source.content || "").trim()) return null;
  return {
    id: String(source.id || `template-${++idSequence}`),
    title: String(source.title).trim(),
    content: String(source.content),
    categoryId: String(source.categoryId || "default"),
    createdAt: Number(source.createdAt) || index + 1,
    updatedAt: Number(source.updatedAt) || index + 1,
    favorite: source.favorite === true
  };
}

function normalizeCategories(categories, templates = []) {
  const output = [{ id: "default", name: "默认分类" }];
  (Array.isArray(categories) ? categories : []).forEach((category) => {
    if (category && category.id && category.id !== "default") output.push({ ...category });
  });
  (Array.isArray(templates) ? templates : []).forEach((template) => {
    const id = String(template && template.categoryId || "default");
    if (!output.some((category) => category.id === id)) output.push({ id, name: id });
  });
  return output;
}

function bundle(name, templates, categories = [{ id: "default", name: "默认分类" }]) {
  return JSON.stringify({
    schema: "pixelrunner.bundle",
    version: 3,
    name,
    apps: [],
    appsByRegion: { cn: [], global: [] },
    templateCategories: categories,
    templates,
    quickEntries: []
  });
}

const initialTemplate = normalizeTemplate({ id: "a-existing", title: "A 原有预设", content: "已有内容", categoryId: "portrait" });
const otherTemplate = normalizeTemplate({ id: "b-existing", title: "B 原有预设", content: "另一份内容" });
const categoryList = normalizeCategories([{ id: "portrait", name: "人像" }], [initialTemplate]);
storage.set("pixelrunner.promptBundles.v1", JSON.stringify([
  { id: "builtin", name: "内置资料包", builtin: true, content: bundle("A", [initialTemplate], categoryList) },
  { id: "bundle-b", name: "资料包 B", content: bundle("B", [otherTemplate]) }
]));
storage.set("pixelrunner.activePromptBundle.v1", "builtin");
storage.set("rh_prompt_templates", JSON.stringify([initialTemplate]));
storage.set("pixelrunner.promptTemplateCategories.v1", JSON.stringify(categoryList));

const state = {
  apps: [],
  templates: [initialTemplate],
  templateCategories: categoryList,
  quickEntries: [],
  activePromptBundleId: "builtin",
  activePromptBundleName: "内置资料包",
  templateManagerCategoryId: "portrait",
  editingTemplateId: null,
  templatePicker: { categoryId: "portrait", selectedIds: [] },
  templateManagerSort: "manual",
  templateManagerKeyword: ""
};

window.PixelRunnerModules = {
  state: {
    state,
    STORAGE_KEYS: {
      PROMPT_TEMPLATES: "rh_prompt_templates",
      PROMPT_TEMPLATE_CATEGORIES: "pixelrunner.promptTemplateCategories.v1",
      PROMPT_BUNDLES: "pixelrunner.promptBundles.v1",
      ACTIVE_PROMPT_BUNDLE: "pixelrunner.activePromptBundle.v1",
      BUILTIN_BUNDLE_MARKER: "pixelrunner.builtinBundle.v1",
      APPS: "rh_ai_apps_v2",
      QUICK_ENTRIES: "pixelrunner.quickEntries.v1"
    },
    DEFAULT_TEMPLATE_CATEGORY_ID: "default",
    DEFAULT_TEMPLATE_CATEGORY_NAME: "默认分类",
    RUNNINGHUB_REGIONS: { CN: "cn", GLOBAL: "global" },
    normalizeRunningHubRegion: (value) => value === "global" ? "global" : "cn",
    normalizeTemplateRecord: normalizeTemplate,
    normalizeTemplateList: (items) => (Array.isArray(items) ? items : []).map(normalizeTemplate).filter(Boolean),
    normalizeTemplateCategoryRecord: (category) => ({ ...category }),
    normalizeTemplateCategoryList: normalizeCategories,
    normalizeAppRecord: (app) => app,
    normalizeAppList: (apps) => Array.isArray(apps) ? apps : []
  },
  runtime: {
    isPluginRuntime: () => false,
    getById(id) {
      if (id === "templateTitleInput") return form.title;
      if (id === "templateContentInput") return form.content;
      return null;
    },
    createId: (prefix) => `${prefix}-${++idSequence}`,
    escapeHtml: (value) => String(value),
    readJsonText(raw, fallback) {
      try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
    },
    async storageGetItem(key) { return storage.has(key) ? storage.get(key) : null; },
    async storageSetItem(key, value) { storage.set(key, String(value)); return true; },
    async backupWorkspaceFromState() { return true; },
    setSummaryStatus(_element, message, type) { lastSummaryStatus = { message, type }; },
    saveTextFile: async () => ({ outcome: "unsupported" })
  },
  ui: { logToWorkspace() {} },
  bundleCompat: {
    parseTransferPackageText(text) {
      const parsed = JSON.parse(text);
      return {
        kind: "bundle",
        apps: parsed.apps || [],
        templateCategories: parsed.templateCategories || [],
        templates: parsed.templates || [],
        quickEntries: parsed.quickEntries || []
      };
    }
  },
  apps: {
    async saveAppsToStorage(apps) { state.apps = apps; },
    async hydrateMissingAppPreviews() {}
  },
  quickEntries: {
    normalizeQuickEntryList: (items) => Array.isArray(items) ? items : [],
    mergeImportedQuickEntries: (items) => ({ entries: items || [], added: (items || []).length, replaced: 0 }),
    async saveQuickEntriesToStorage(items) { state.quickEntries = items; }
  }
};

window.PixelRunnerModules.bundleCompat.parseTransferPackageText = window.PixelRunnerModules.bundleCompat.parseTransferPackageText;
await import("../src/webview/templates.js");
const templates = window.PixelRunnerModules.templates;

form.title.value = "A 新建预设";
form.content.value = "新建内容";
state.templateManagerCategoryId = "portrait";
await templates.saveEditedTemplate();
const createdId = state.templates.find((item) => item.title === "A 新建预设").id;

state.editingTemplateId = createdId;
form.title.value = "A 编辑后的预设";
form.content.value = "编辑后的内容";
state.templateManagerCategoryId = "portrait";
await templates.saveEditedTemplate();

await templates.switchPromptBundle("bundle-b");
assert.deepEqual(state.templates.map((item) => item.title), ["B 原有预设"]);
await templates.switchPromptBundle("builtin");

const restored = state.templates.find((item) => item.id === createdId);
assert.ok(restored, "the edited template remains in bundle A after switching away and back");
assert.equal(restored.title, "A 编辑后的预设");
assert.equal(restored.content, "编辑后的内容");
assert.equal(restored.categoryId, "portrait");
assert.ok(state.templateCategories.some((category) => category.id === "portrait"));

window.PixelRunnerModules.runtime.isPluginRuntime = () => true;
window.PixelRunnerModules.runtime.storageSetItem = async (key, value) => {
  if (key === "pixelrunner.promptBundles.v1") throw new Error("Host storage unavailable");
  storage.set(key, String(value));
  return true;
};
form.title.value = "A 未能保存的修改";
form.content.value = "这次修改不应显示成功";
state.templateManagerCategoryId = "portrait";
await assert.rejects(() => templates.saveEditedTemplate(), /Host storage unavailable/);
assert.equal(lastSummaryStatus.type, "error");
assert.equal(state.templates.find((item) => item.id === createdId).title, "A 编辑后的预设");

console.log("Prompt bundle persistence regression test passed.");
