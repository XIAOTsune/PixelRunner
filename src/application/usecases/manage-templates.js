const DEFAULT_EXPORT_FILENAME_PREFIX = "pixelrunner_prompt_templates";

function requireStoreMethod(store, methodName) {
  if (!store || typeof store !== "object" || typeof store[methodName] !== "function") {
    throw new Error(`manageTemplatesUsecase requires store.${methodName}`);
  }
}

function getTemplateTitleKey(title) {
  return String(title || "").trim().toLowerCase();
}

function saveTemplateUsecase(options = {}) {
  const store = options.store;
  requireStoreMethod(store, "getPromptTemplates");
  requireStoreMethod(store, "deletePromptTemplate");
  requireStoreMethod(store, "addPromptTemplate");

  const title = String(options.title || "").trim();
  const content = String(options.content || "");
  if (!title || !content.trim()) {
    throw new Error("Template title and content are required");
  }

  const titleKey = getTemplateTitleKey(title);
  const existingByTitle = store
    .getPromptTemplates()
    .find((item) => getTemplateTitleKey(item && item.title) === titleKey);

  if (existingByTitle && existingByTitle.id) {
    store.deletePromptTemplate(existingByTitle.id);
  }

  store.addPromptTemplate({ title, content });
  return {
    reason: existingByTitle ? "updated" : "saved"
  };
}

function importTemplatesUsecase(options = {}) {
  const store = options.store;
  requireStoreMethod(store, "getPromptTemplates");
  requireStoreMethod(store, "savePromptTemplates");
  requireStoreMethod(store, "parsePromptTemplatesBundle");

  const importedTemplates = store.parsePromptTemplatesBundle(options.payload);
  const mergedTemplates = [...store.getPromptTemplates()];
  const titleIndexMap = new Map();
  mergedTemplates.forEach((template, index) => {
    const key = getTemplateTitleKey(template && template.title);
    if (!key) return;
    if (!titleIndexMap.has(key)) titleIndexMap.set(key, index);
  });

  let added = 0;
  let replaced = 0;
  importedTemplates.forEach((template) => {
    const key = getTemplateTitleKey(template && template.title);
    if (key && titleIndexMap.has(key)) {
      const targetIndex = titleIndexMap.get(key);
      const previous = mergedTemplates[targetIndex] || {};
      mergedTemplates[targetIndex] = {
        ...template,
        id: previous.id || template.id,
        createdAt: previous.createdAt || template.createdAt
      };
      replaced += 1;
      return;
    }
    mergedTemplates.push(template);
    if (key) titleIndexMap.set(key, mergedTemplates.length - 1);
    added += 1;
  });

  store.savePromptTemplates(mergedTemplates);

  return {
    reason: "imported",
    added,
    replaced,
    total: mergedTemplates.length
  };
}

function buildTemplateExportUsecase(options = {}) {
  const store = options.store;
  requireStoreMethod(store, "buildPromptTemplatesBundle");

  const now = options.now instanceof Date ? options.now : new Date();
  const filenamePrefix = String(options.filenamePrefix || DEFAULT_EXPORT_FILENAME_PREFIX).trim();
  const dateTag = now.toISOString().slice(0, 10);

  return {
    bundle: store.buildPromptTemplatesBundle(),
    defaultName: `${filenamePrefix}_${dateTag}.json`
  };
}

function loadEditableTemplateUsecase(options = {}) {
  const template = options.template;
  if (!template || typeof template !== "object") {
    return {
      found: false,
      title: "",
      content: ""
    };
  }

  return {
    found: true,
    title: String(template.title || ""),
    content: String(template.content || "")
  };
}

function deleteTemplateUsecase(options = {}) {
  const store = options.store;
  requireStoreMethod(store, "deletePromptTemplate");
  const id = String(options.id || "").trim();
  if (!id) {
    return {
      deleted: false,
      id: ""
    };
  }
  return {
    deleted: !!store.deletePromptTemplate(id),
    id
  };
}

module.exports = {
  getTemplateTitleKey,
  saveTemplateUsecase,
  importTemplatesUsecase,
  buildTemplateExportUsecase,
  loadEditableTemplateUsecase,
  deleteTemplateUsecase
};
