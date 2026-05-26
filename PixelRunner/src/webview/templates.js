(function initTemplatesModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const PROMPT_WARN_CHARS = 4000;
  const TEMPLATE_FILE_PREFIX = "pixelrunner_bundle";
  const modalState = {
    resolver: null,
    action: null
  };

  function getTemplateEditorDraft() {
    const runtime = modules.runtime;
    return JSON.stringify({
      id: modules.state.state.editingTemplateId || "",
      title: String(runtime.getById("templateTitleInput")?.value || "").trim(),
      content: String(runtime.getById("templateContentInput")?.value || ""),
      categoryId: getActiveManagerCategoryId()
    });
  }

  function markTemplateEditorPristine() {
    modules.state.state.templateEditorSnapshot = getTemplateEditorDraft();
  }

  function isTemplateEditorDirty() {
    return getTemplateEditorDraft() !== String(modules.state.state.templateEditorSnapshot || "");
  }

  async function confirmDiscardTemplateChanges() {
    if (!isTemplateEditorDirty()) return true;
    return showTemplateConfirmDialog({
      title: "放弃未保存修改",
      message: "当前模板编辑区里有未保存修改，确定放弃这些内容吗？",
      submitLabel: "放弃修改",
      tone: "warn"
    });
  }

  function getTextLength(value) {
    return Array.from(String(value || "")).length;
  }

  function getTailPreview(value, maxChars = 20) {
    return Array.from(String(value || ""))
      .slice(-Math.max(0, Number(maxChars) || 0))
      .join("")
      .replace(/\r?\n/g, "\\n");
  }

  function buildTemplateLengthHint(title, content) {
    const titleLen = getTextLength(title);
    const contentLen = getTextLength(content);
    const tailPreview = getTailPreview(content, 20);
    const warning = titleLen >= PROMPT_WARN_CHARS || contentLen >= PROMPT_WARN_CHARS;
    return {
      text: warning
        ? `提示：标题 ${titleLen} / 内容 ${contentLen} 字符，末尾预览 ${tailPreview}。建议控制在 ${PROMPT_WARN_CHARS} 字符内。`
        : `提示：标题 ${titleLen} / 内容 ${contentLen} 字符，末尾预览 ${tailPreview}。插件本地不会截断模板内容。`,
      warning
    };
  }

  function getTemplatePreview(content, maxChars = 48) {
    const text = String(content || "").replace(/\s+/g, " ").trim();
    if (!text) return "暂无内容预览";
    const preview = Array.from(text).slice(0, Math.max(1, Number(maxChars) || 48)).join("");
    return preview.length < text.length ? `${preview}...` : preview;
  }

  function getCategoryOptionsMarkup(selectedId) {
    const activeId = String(selectedId || getDefaultCategoryId());
    return (modules.state.state.templateCategories || [])
      .map((category) => `<option value="${modules.runtime.escapeHtml(String(category.id))}" ${String(category.id) === activeId ? "selected" : ""}>${modules.runtime.escapeHtml(category.name)}</option>`)
      .join("");
  }

  function setTemplateFormOpen(open) {
    const modal = modules.runtime.getById("templateFormModal");
    if (!modal) return;
    modal.classList.toggle("is-open", Boolean(open));
    document.body.classList.toggle("modal-open", Boolean(open) || Boolean(document.querySelector(".overlay-modal.is-open")));
  }

  function closeTemplateFormModal(result) {
    const resolver = modalState.resolver;
    modalState.resolver = null;
    modalState.action = null;
    setTemplateFormOpen(false);
    if (resolver) resolver(result);
  }

  function configureTemplateFormModal(config = {}) {
    const titleEl = modules.runtime.getById("templateFormTitle");
    const kickerEl = modules.runtime.getById("templateFormKicker");
    const messageEl = modules.runtime.getById("templateFormMessage");
    const bodyEl = modules.runtime.getById("templateFormBody");
    const submitEl = modules.runtime.getById("templateFormSubmit");
    const cancelEl = modules.runtime.getById("templateFormCancel");
    const cardEl = document.querySelector("#templateFormModal .template-form-card");

    if (titleEl) titleEl.textContent = config.title || "提示词预设";
    if (kickerEl) kickerEl.textContent = config.kicker || "工作台";
    if (messageEl) {
      const message = String(config.message || "").trim();
      messageEl.hidden = !message;
      messageEl.textContent = message;
      messageEl.dataset.status = config.tone || "info";
    }
    if (bodyEl) bodyEl.innerHTML = config.bodyHtml || "";
    if (submitEl) {
      submitEl.textContent = config.submitLabel || "保存";
      submitEl.dataset.tone = config.tone || "";
    }
    if (cancelEl) cancelEl.textContent = config.cancelLabel || "取消";
    if (cardEl) cardEl.dataset.mode = config.mode || "form";
  }

  function showTemplateFormDialog(config = {}) {
    if (modalState.resolver) closeTemplateFormModal(null);
    configureTemplateFormModal(config);
    modalState.action = typeof config.onSubmit === "function" ? config.onSubmit : null;
    setTemplateFormOpen(true);
    window.setTimeout(() => {
      const focusTarget = modules.runtime.getById("templateFormBody")?.querySelector("input, textarea, select, button");
      if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
    }, 0);
    return new Promise((resolve) => {
      modalState.resolver = resolve;
    });
  }

  function showTemplateConfirmDialog(config = {}) {
    return showTemplateFormDialog({
      ...config,
      mode: "confirm",
      bodyHtml: "",
      onSubmit: () => true
    });
  }

  function readTemplateFormValues() {
    const body = modules.runtime.getById("templateFormBody");
    return {
      title: String(body?.querySelector("[data-template-form-field='title']")?.value || "").trim(),
      content: String(body?.querySelector("[data-template-form-field='content']")?.value || ""),
      categoryId: String(body?.querySelector("[data-template-form-field='categoryId']")?.value || getDefaultCategoryId()).trim() || getDefaultCategoryId(),
      name: String(body?.querySelector("[data-template-form-field='name']")?.value || "").trim()
    };
  }

  function buildPresetFormBody({ title = "", content = "", categoryId = getDefaultCategoryId() } = {}) {
    return `
      <label class="field">
        <span class="field-label">预设名称</span>
        <input class="field-input" type="text" data-template-form-field="title" value="${modules.runtime.escapeHtml(title)}" placeholder="例如：自然磨皮" />
      </label>
      <label class="field">
        <span class="field-label">所属分类</span>
        <select class="field-input" data-template-form-field="categoryId">${getCategoryOptionsMarkup(categoryId)}</select>
      </label>
      <label class="field">
        <span class="field-label">提示词内容</span>
        <textarea class="field-input field-textarea" rows="8" data-template-form-field="content" placeholder="输入提示词内容">${modules.runtime.escapeHtml(content)}</textarea>
      </label>
    `;
  }

  function buildNameFormBody({ label = "名称", value = "", placeholder = "" } = {}) {
    return `
      <label class="field">
        <span class="field-label">${modules.runtime.escapeHtml(label)}</span>
        <input class="field-input" type="text" data-template-form-field="name" value="${modules.runtime.escapeHtml(value)}" placeholder="${modules.runtime.escapeHtml(placeholder)}" />
      </label>
    `;
  }

  function buildActionMenuBody(actions = []) {
    return `<div class="template-action-menu">${actions
      .map((action) => `<button class="template-action-menu-item ${action.tone ? `is-${modules.runtime.escapeHtml(action.tone)}` : ""}" type="button" data-template-form-menu-action="${modules.runtime.escapeHtml(action.id)}"><span>${modules.runtime.escapeHtml(action.label)}</span>${action.hint ? `<small>${modules.runtime.escapeHtml(action.hint)}</small>` : ""}</button>`)
      .join("")}</div>`;
  }

  function getPickerInlineMenu() {
    const picker = modules.state.state.templatePicker || {};
    const menu = picker.inlineMenu || {};
    return {
      type: String(menu.type || ""),
      id: String(menu.id || "")
    };
  }

  function setPickerInlineMenu(type, id) {
    const picker = modules.state.state.templatePicker || {};
    picker.inlineMenu = type && id ? { type: String(type), id: String(id) } : null;
    modules.state.state.templatePicker = picker;
  }

  function isPickerInlineMenuOpen(type, id) {
    const menu = getPickerInlineMenu();
    return menu.type === String(type || "") && menu.id === String(id || "");
  }

  function buildInlineActionMenu(actions = [], contextAttrs = "") {
    return `<div class="template-inline-menu" role="menu">${actions
      .map((action) => `<button class="template-inline-menu-item ${action.tone ? `is-${modules.runtime.escapeHtml(action.tone)}` : ""}" type="button" role="menuitem" data-template-inline-action="${modules.runtime.escapeHtml(action.id)}" ${contextAttrs}>${modules.runtime.escapeHtml(action.label)}</button>`)
      .join("")}</div>`;
  }

  function getDefaultCategoryId() {
    return modules.state.DEFAULT_TEMPLATE_CATEGORY_ID || "default";
  }

  function getActiveManagerCategoryId() {
    return String(modules.state.state.templateManagerCategoryId || getDefaultCategoryId()).trim() || getDefaultCategoryId();
  }

  function getActivePickerCategoryId() {
    return String(modules.state.state.templatePicker.categoryId || getDefaultCategoryId()).trim() || getDefaultCategoryId();
  }

  function getCategoryById(categoryId) {
    const id = String(categoryId || "").trim() || getDefaultCategoryId();
    return (modules.state.state.templateCategories || []).find((item) => String(item.id) === id) || modules.state.state.templateCategories[0] || null;
  }

  function getCategoryName(categoryId) {
    const category = getCategoryById(categoryId);
    return category ? category.name : modules.state.DEFAULT_TEMPLATE_CATEGORY_NAME || "默认分类";
  }

  function normalizeTemplateWithFallback(template, index = 0, fallbackCategoryId = getDefaultCategoryId()) {
    const normalized = modules.state.normalizeTemplateRecord(
      {
        ...template,
        categoryId: String((template && (template.categoryId || template.groupId || template.pageId)) || fallbackCategoryId || getDefaultCategoryId()).trim() || getDefaultCategoryId()
      },
      index
    );
    return normalized;
  }

  function normalizeTemplateListWithFallback(templates, fallbackCategoryId = getDefaultCategoryId()) {
    const seenIds = new Set();
    return (Array.isArray(templates) ? templates : [])
      .map((item, index) => normalizeTemplateWithFallback(item, index, fallbackCategoryId))
      .filter((item) => {
        if (!item) return false;
        if (seenIds.has(item.id)) item.id = modules.runtime.createId("tpl");
        seenIds.add(item.id);
        return true;
      });
  }

  function buildTemplateBundle(templates) {
    return {
      schema: "pixelrunner.bundle",
      version: 2,
      exportedAt: new Date().toISOString(),
      name: "PixelRunner 资料包",
      apps: sanitizeAppsForBundle(modules.state.state.apps),
      templateCategories: Array.isArray(modules.state.state.templateCategories) ? modules.state.state.templateCategories : [],
      templates: sanitizeTemplatesForBundle(templates),
      quickEntries: sanitizeQuickEntriesForBundle(modules.state.state.quickEntries)
    };
  }

  function sanitizeAppInputsForBundle(inputs) {
    return (Array.isArray(inputs) ? inputs : []).map((input) => {
      if (!input || typeof input !== "object") return input;
      return sanitizePlainObjectForBundle(input);
    });
  }

  function isSensitiveBundleKey(key) {
    return /(?:api[_-]?key|apikey|token|access[_-]?token|secret|authorization|password|bearer|cookie|credential)/i.test(String(key || ""));
  }

  function sanitizePlainObjectForBundle(value) {
    if (value == null) return value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map(sanitizePlainObjectForBundle);
    if (value && typeof value === "object") {
      const out = {};
      Object.keys(value).forEach((key) => {
        if (isSensitiveBundleKey(key)) return;
        out[key] = sanitizePlainObjectForBundle(value[key]);
      });
      return out;
    }
    return value;
  }

  function sanitizeAppsForBundle(apps) {
    return modules.state.normalizeAppList(apps).map((app) => ({
      id: app.id,
      appId: app.appId,
      name: app.name,
      description: app.description,
      previewImage: app.previewImage,
      inputs: sanitizeAppInputsForBundle(app.inputs),
      createdAt: app.createdAt,
      updatedAt: app.updatedAt
    }));
  }

  function sanitizeTemplatesForBundle(templates) {
    return normalizeTemplateListWithFallback(templates).map((template) => ({
      id: template.id,
      title: template.title,
      content: template.content,
      categoryId: template.categoryId,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt
    }));
  }

  function sanitizeQuickEntriesForBundle(entries) {
    const normalized = modules.quickEntries && typeof modules.quickEntries.normalizeQuickEntryList === "function"
      ? modules.quickEntries.normalizeQuickEntryList(entries)
      : Array.isArray(entries)
        ? entries
        : [];
    return normalized.map((entry) => {
      const cleanEntry = sanitizePlainObjectForBundle(entry);
      if (cleanEntry && cleanEntry.inputValues && typeof cleanEntry.inputValues === "object") {
        Object.keys(cleanEntry.inputValues).forEach((key) => {
          if (isSensitiveBundleKey(key)) delete cleanEntry.inputValues[key];
        });
      }
      return cleanEntry;
    });
  }

  function buildTemplateExportFilename() {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${TEMPLATE_FILE_PREFIX}_${yyyy}-${mm}-${dd}.json`;
  }

  function getTemplateTitleKey(template) {
    return String((template && template.title) || "").trim().toLowerCase();
  }

  async function fillTemplateEditor(template, options = {}) {
    if (!options.force && !(await confirmDiscardTemplateChanges())) return false;
    const runtime = modules.runtime;
    const item = template && typeof template === "object" ? template : null;
    modules.state.state.editingTemplateId = item ? String(item.id) : null;
    if (item && item.categoryId) modules.state.state.templateManagerCategoryId = String(item.categoryId);
    if (runtime.getById("templateTitleInput")) runtime.getById("templateTitleInput").value = item ? item.title || "" : "";
    if (runtime.getById("templateContentInput")) runtime.getById("templateContentInput").value = item ? item.content || "" : "";
    renderTemplateCategoryControls();
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
    return normalizeTemplateListWithFallback(modules.runtime.readJsonText(raw, []));
  }

  async function loadTemplateCategoriesFromStorage(templates = []) {
    const raw = await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.PROMPT_TEMPLATE_CATEGORIES);
    return modules.state.normalizeTemplateCategoryList(modules.runtime.readJsonText(raw, []), templates);
  }

  async function saveTemplateCategoriesToStorage(categories) {
    const normalized = modules.state.normalizeTemplateCategoryList(categories, modules.state.state.templates);
    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.PROMPT_TEMPLATE_CATEGORIES, JSON.stringify(normalized));
    modules.state.state.templateCategories = normalized;
    syncActiveCategoryIds();
    renderTemplateCategoryControls();
    renderSavedTemplatesList();
    renderTemplatePickerList();
    return normalized;
  }

  async function saveTemplatesToStorage(templates) {
    const normalized = normalizeTemplateListWithFallback(templates);
    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.PROMPT_TEMPLATES, JSON.stringify(normalized));
    modules.state.state.templates = normalized;
    modules.state.state.templateCategories = modules.state.normalizeTemplateCategoryList(modules.state.state.templateCategories, normalized);
    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.PROMPT_TEMPLATE_CATEGORIES, JSON.stringify(modules.state.state.templateCategories));
    syncActiveCategoryIds();
    renderTemplateCategoryControls();
    renderSavedTemplatesList();
    renderTemplatePickerList();
    return normalized;
  }

  async function refreshTemplates(options = {}) {
    const templates = await loadTemplatesFromStorage();
    modules.state.state.templates = templates;
    modules.state.state.templateCategories = await loadTemplateCategoriesFromStorage(templates);
    syncActiveCategoryIds();
    renderTemplateCategoryControls();
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
      content,
      categoryId: getActiveManagerCategoryId()
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

  function syncActiveCategoryIds() {
    const categories = modules.state.state.templateCategories || [];
    const categoryIds = new Set(categories.map((item) => String(item.id)));
    const fallbackId = categories[0] ? String(categories[0].id) : getDefaultCategoryId();
    if (!categoryIds.has(getActiveManagerCategoryId())) modules.state.state.templateManagerCategoryId = fallbackId;
    if (!categoryIds.has(getActivePickerCategoryId())) modules.state.state.templatePicker.categoryId = fallbackId;
  }

  function getCategoryTemplateCount(categoryId) {
    const id = String(categoryId || getDefaultCategoryId());
    return (modules.state.state.templates || []).filter((template) => String(template.categoryId || getDefaultCategoryId()) === id).length;
  }

  function renderTemplateCategoryTabs(targetId, activeId, options = {}) {
    const target = modules.runtime.getById(targetId);
    if (!target) return;
    const action = options.action || "select-template-category";
    const allowInlineManage = Boolean(options.inlineManage);
    const categoryMarkup = (modules.state.state.templateCategories || [])
      .map((category) => {
        const id = String(category.id);
        const escapedId = modules.runtime.escapeHtml(id);
        const tab = `<button class="template-category-tab ${allowInlineManage ? "has-menu" : ""} ${String(activeId) === id ? "is-active" : ""}" type="button" data-action="${modules.runtime.escapeHtml(action)}" data-template-category-id="${escapedId}"><span>${modules.runtime.escapeHtml(category.name)}</span><small>${modules.runtime.escapeHtml(String(getCategoryTemplateCount(id)))}</small></button>`;
        if (!allowInlineManage) return tab;
        const isMenuOpen = isPickerInlineMenuOpen("category", id);
        const menu = isMenuOpen
          ? buildInlineActionMenu(
              [
                { id: "rename-category", label: "重命名分类" },
                { id: "delete-category", label: "删除分类", tone: "danger" }
              ],
              `data-template-category-id="${escapedId}"`
            )
          : "";
        return `<span class="template-category-tab-wrap ${isMenuOpen ? "has-open-menu" : ""}">${tab}<button class="template-card-menu template-category-menu" type="button" data-action="open-picker-category-menu" data-template-category-id="${escapedId}" title="分类操作" aria-label="分类操作">•••</button>${menu}</span>`;
      })
      .join("");
    const createMarkup = allowInlineManage
      ? `<button class="template-category-tab template-category-create" type="button" data-action="create-picker-template-category"><span>+ 分类</span></button>`
      : "";
    target.innerHTML = `${categoryMarkup}${createMarkup}`;
  }

  function renderTemplateCategoryControls() {
    syncActiveCategoryIds();
    renderTemplateCategoryTabs("templateCategoryTabs", getActiveManagerCategoryId(), { action: "select-template-category" });
    renderTemplateCategoryTabs("templatePickerCategoryTabs", getActivePickerCategoryId(), { action: "select-picker-template-category", inlineManage: true });

    const select = modules.runtime.getById("templateCategorySelect");
    if (select) {
      const activeId = getActiveManagerCategoryId();
      select.innerHTML = (modules.state.state.templateCategories || [])
        .map((category) => `<option value="${modules.runtime.escapeHtml(String(category.id))}" ${String(category.id) === activeId ? "selected" : ""}>${modules.runtime.escapeHtml(category.name)}</option>`)
        .join("");
    }
  }

  async function createTemplateCategory() {
    const result = await showTemplateFormDialog({
      title: "新建分类",
      message: "分类会显示在工作台预设弹窗顶部，用来快速筛选提示词。",
      bodyHtml: buildNameFormBody({ label: "分类名称", placeholder: "例如：人像、场景、产品" }),
      submitLabel: "创建分类",
      onSubmit: () => {
        const { name } = readTemplateFormValues();
        if (!name) throw new Error("请填写分类名称");
        return { name };
      }
    });
    const name = String(result && result.name || "").trim();
    if (!name) return null;
    const category = modules.state.normalizeTemplateCategoryRecord({
      id: modules.runtime.createId("tplcat"),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    modules.state.state.templateManagerCategoryId = category.id;
    await saveTemplateCategoriesToStorage([...(modules.state.state.templateCategories || []), category]);
    modules.runtime.setSummaryStatus(modules.runtime.getById("templateStatusSummary"), `已创建分类：${category.name}`, "success");
    return category;
  }

  async function createTemplateCategoryForPicker() {
    const category = await createTemplateCategory();
    if (!category) return null;
    modules.state.state.templatePicker.categoryId = category.id;
    renderTemplatePickerList();
    return category;
  }

  async function renameActiveTemplateCategory() {
    const activeId = getActiveManagerCategoryId();
    const category = getCategoryById(activeId);
    if (!category) return null;
    const result = await showTemplateFormDialog({
      title: "重命名分类",
      bodyHtml: buildNameFormBody({ label: "分类名称", value: category.name }),
      submitLabel: "保存分类",
      onSubmit: () => {
        const { name } = readTemplateFormValues();
        if (!name) throw new Error("请填写分类名称");
        return { name };
      }
    });
    const name = String(result && result.name || "").trim();
    if (!name || name === category.name) return null;
    await saveTemplateCategoriesToStorage((modules.state.state.templateCategories || []).map((item) =>
      String(item.id) === activeId ? { ...item, name, updatedAt: Date.now() } : item
    ));
    modules.runtime.setSummaryStatus(modules.runtime.getById("templateStatusSummary"), `分类已重命名：${name}`, "success");
    return getCategoryById(activeId);
  }

  async function deleteActiveTemplateCategory() {
    const activeId = getActiveManagerCategoryId();
    const defaultId = getDefaultCategoryId();
    if (activeId === defaultId) {
      modules.runtime.setSummaryStatus(modules.runtime.getById("templateStatusSummary"), "默认分类不能删除。", "warn");
      return false;
    }
    const category = getCategoryById(activeId);
    if (!category) return false;
    const count = getCategoryTemplateCount(activeId);
    const confirmed = await showTemplateConfirmDialog({
      title: "删除分类",
      message: `确定删除分类“${category.name}”吗？其中 ${count} 条提示词会移动到默认分类。`,
      submitLabel: "删除分类",
      tone: "warn"
    });
    if (!confirmed) return false;
    modules.state.state.templateManagerCategoryId = defaultId;
    modules.state.state.templatePicker.categoryId = defaultId;
    await saveTemplateCategoriesToStorage((modules.state.state.templateCategories || []).filter((item) => String(item.id) !== activeId));
    await saveTemplatesToStorage((modules.state.state.templates || []).map((template) =>
      String(template.categoryId || defaultId) === activeId ? { ...template, categoryId: defaultId, updatedAt: Date.now() } : template
    ));
    modules.runtime.setSummaryStatus(modules.runtime.getById("templateStatusSummary"), `已删除分类：${category.name}，提示词已移到默认分类。`, "warn");
    return true;
  }

  async function deleteActivePickerTemplateCategory() {
    const previousManagerCategoryId = getActiveManagerCategoryId();
    modules.state.state.templateManagerCategoryId = getActivePickerCategoryId();
    const deleted = await deleteActiveTemplateCategory();
    modules.state.state.templateManagerCategoryId = previousManagerCategoryId;
    if (deleted) {
      modules.state.state.templatePicker.categoryId = getDefaultCategoryId();
      modules.state.state.templatePicker.selectedIds = [];
      renderTemplatePickerList();
    }
    return deleted;
  }

  function getPickerTargetFieldValue() {
    const key = String(modules.state.state.templatePicker.targetKey || "").trim();
    if (!key) return "";
    return String(modules.state.state.formValues[key] || "");
  }

  async function saveCurrentFieldAsTemplateFromPicker() {
    const content = getPickerTargetFieldValue();
    if (!content.trim()) {
      modules.runtime.setSummaryStatus(modules.runtime.getById("templatePickerSelectionInfo"), "当前提示词字段为空，不能保存为预设。", "warn");
      return null;
    }
    const defaultTitle = Array.from(content.replace(/\s+/g, " ").trim()).slice(0, 18).join("") || "新提示词预设";
    const result = await showTemplateFormDialog({
      title: "新建预设",
      message: "将当前工作台提示词字段保存为预设，之后可从分类中快速调用。",
      bodyHtml: buildPresetFormBody({ title: defaultTitle, content, categoryId: getActivePickerCategoryId() }),
      submitLabel: "保存预设",
      onSubmit: () => {
        const values = readTemplateFormValues();
        if (!values.title) throw new Error("请填写预设名称");
        if (!values.content.trim()) throw new Error("请填写提示词内容");
        return values;
      }
    });
    if (!result) return null;
    const now = Date.now();
    const template = modules.state.normalizeTemplateRecord({
      id: modules.runtime.createId("tpl"),
      title: result.title,
      content: result.content,
      categoryId: result.categoryId,
      createdAt: now,
      updatedAt: now
    });
    if (!template) return null;
    await saveTemplatesToStorage([template, ...(modules.state.state.templates || [])]);
    modules.state.state.templatePicker.categoryId = template.categoryId;
    modules.state.state.templatePicker.selectedIds = [template.id];
    modules.runtime.setSummaryStatus(modules.runtime.getById("templatePickerSelectionInfo"), `已保存预设：${template.title}`, "success");
    return template;
  }

  async function deleteTemplateFromPicker(templateId) {
    const target = modules.state.state.templates.find((item) => String(item.id) === String(templateId));
    if (!target) return;
    const confirmed = await showTemplateConfirmDialog({
      title: "删除预设",
      message: `确定删除预设“${target.title}”？这个操作不会影响当前工作台字段内容。`,
      submitLabel: "删除预设",
      tone: "warn"
    });
    if (!confirmed) return;
    await deleteTemplateById(templateId);
    modules.state.state.templatePicker.selectedIds = modules.state.state.templatePicker.selectedIds.filter((id) => String(id) !== String(templateId));
    renderTemplatePickerList();
    modules.runtime.setSummaryStatus(modules.runtime.getById("templatePickerSelectionInfo"), `已删除预设：${target.title}`, "warn");
  }

  async function editTemplateFromPicker(templateId) {
    const target = modules.state.state.templates.find((item) => String(item.id) === String(templateId));
    if (!target) return null;
    const result = await showTemplateFormDialog({
      title: "编辑预设",
      message: "可以在这里修改名称、内容，并移动到其他分类。",
      bodyHtml: buildPresetFormBody({ title: target.title || "", content: target.content || "", categoryId: target.categoryId || getActivePickerCategoryId() }),
      submitLabel: "保存预设",
      onSubmit: () => {
        const values = readTemplateFormValues();
        if (!values.title) throw new Error("请填写预设名称");
        if (!values.content.trim()) throw new Error("请填写提示词内容");
        return values;
      }
    });
    if (!result) return null;
    const templates = (modules.state.state.templates || []).map((template) =>
      String(template.id) === String(templateId)
        ? modules.state.normalizeTemplateRecord({
            ...template,
            title: result.title,
            content: result.content,
            categoryId: result.categoryId,
            updatedAt: Date.now()
          })
        : template
    ).filter(Boolean);
    await saveTemplatesToStorage(templates);
    modules.state.state.templatePicker.categoryId = result.categoryId;
    modules.runtime.setSummaryStatus(modules.runtime.getById("templatePickerSelectionInfo"), `已保存预设：${result.title}`, "success");
    return templates.find((item) => String(item.id) === String(templateId)) || null;
  }

  async function openPickerTemplateMenu(templateId) {
    const target = modules.state.state.templates.find((item) => String(item.id) === String(templateId));
    if (!target) return;
    setPickerInlineMenu(isPickerInlineMenuOpen("template", templateId) ? "" : "template", templateId);
    renderTemplatePickerList();
  }

  async function openPickerCategoryMenu(categoryId) {
    const id = String(categoryId || "").trim();
    const category = getCategoryById(id);
    if (!category) return;
    modules.state.state.templatePicker.categoryId = id;
    setPickerInlineMenu(isPickerInlineMenuOpen("category", id) ? "" : "category", id);
    renderTemplatePickerList();
  }

  async function handlePickerInlineMenuAction(action, target) {
    const templateId = target && target.getAttribute("data-template-id");
    const categoryId = target && target.getAttribute("data-template-category-id");
    setPickerInlineMenu("", "");
    if (action === "edit-template" && templateId) {
      renderTemplatePickerList();
      await editTemplateFromPicker(templateId);
      return;
    }
    if (action === "delete-template" && templateId) {
      renderTemplatePickerList();
      await deleteTemplateFromPicker(templateId);
      return;
    }
    if (action === "rename-category" && categoryId) {
      const previousManagerCategoryId = getActiveManagerCategoryId();
      modules.state.state.templateManagerCategoryId = categoryId;
      await renameActiveTemplateCategory();
      modules.state.state.templateManagerCategoryId = previousManagerCategoryId;
      renderTemplatePickerList();
      return;
    }
    if (action === "delete-category" && categoryId) {
      modules.state.state.templatePicker.categoryId = categoryId;
      await deleteActivePickerTemplateCategory();
      return;
    }
    renderTemplatePickerList();
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
    const titleIndexMap = new Map();
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
        categoryId: String(template.categoryId || getDefaultCategoryId()).trim() || getDefaultCategoryId(),
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
    return String((app && (app.name || app.title)) || "").trim().toLowerCase();
  }

  function mergeImportedApps(importedApps) {
    const currentApps = Array.isArray(modules.state.state.apps) ? modules.state.state.apps.slice() : [];
    const existingIds = new Set(currentApps.map((item) => String(item.id || "")));
    const nameIndexMap = new Map();
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
        templateCategories: Array.isArray(parsed.templateCategories)
          ? parsed.templateCategories
          : Array.isArray(parsed.promptTemplateCategories)
            ? parsed.promptTemplateCategories
            : Array.isArray(parsed.categories)
              ? parsed.categories
              : [],
        templates: Array.isArray(parsed.templates) ? parsed.templates : [],
        quickEntries: Array.isArray(parsed.quickEntries) ? parsed.quickEntries : []
      };
    }
    return {
      kind: "templates",
      apps: [],
      templateCategories: parsed && typeof parsed === "object" && Array.isArray(parsed.templateCategories) ? parsed.templateCategories : [],
      templates: parsed && typeof parsed === "object" && Array.isArray(parsed.templates) ? parsed.templates : parsed,
      quickEntries: []
    };
  }

  function parseImportedTemplatesText(text) {
    let parsed = JSON.parse(String(text || "").trim());
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.templates)) parsed = parsed.templates;
    const templates = normalizeTemplateListWithFallback(parsed);
    if (templates.length === 0) throw new Error("没有解析到可导入的模板");
    return templates;
  }

  async function importTemplatesFromTextarea() {
    const input = modules.runtime.getById("templateTransferInput");
    if (!input) return;
    const text = String(input.value || "").trim();
    if (!text) throw new Error("请先粘贴模板 JSON");

    const transfer = parseTransferPackageText(text);
    const importedTemplates = normalizeTemplateListWithFallback(transfer.templates);
    if (transfer.kind !== "bundle" && importedTemplates.length === 0) throw new Error("没有解析到可导入的模板");
    if (transfer.kind === "bundle" && importedTemplates.length === 0 && transfer.apps.length === 0 && transfer.quickEntries.length === 0) {
      throw new Error("没有解析到可导入的资料包内容");
    }

    const mergedApps = transfer.kind === "bundle" ? mergeImportedApps(transfer.apps) : { apps: modules.state.state.apps, added: 0 };
    const mergedCategories = modules.state.normalizeTemplateCategoryList(
      [...(modules.state.state.templateCategories || []), ...(transfer.templateCategories || [])],
      [...(modules.state.state.templates || []), ...importedTemplates]
    );
    modules.state.state.templateCategories = mergedCategories;
    const mergedTemplates = mergeImportedTemplates(importedTemplates);
    const mergedQuickEntries =
      transfer.kind === "bundle" && modules.quickEntries
        ? modules.quickEntries.mergeImportedQuickEntries(transfer.quickEntries)
        : { entries: modules.state.state.quickEntries, added: 0, replaced: 0 };

    if (transfer.kind === "bundle") {
      await modules.apps.saveAppsToStorage(mergedApps.apps);
      if (modules.apps && typeof modules.apps.hydrateMissingAppPreviews === "function") {
        void modules.apps.hydrateMissingAppPreviews({ quiet: true });
      }
    }
    await saveTemplateCategoriesToStorage(mergedCategories);
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
    const message =
      summary.kind === "bundle"
        ? `资料包 JSON 已导入：应用新增 ${summary.appsAdded} 个、覆盖 ${summary.appsReplaced} 个；提示词新增 ${summary.added} 条、覆盖 ${summary.replaced} 条；快捷入口新增 ${summary.quickEntriesAdded} 个、覆盖 ${summary.quickEntriesReplaced} 个。`
        : `模板 JSON 已导入：新增 ${summary.added} 条，覆盖 ${summary.replaced} 条，总计 ${summary.total} 条。`;
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
    const keyword = String(state.templateManagerKeyword || "").trim();
    const activeCategoryId = getActiveManagerCategoryId();
    const categoryTemplates = state.templates.filter((item) => String(item.categoryId || getDefaultCategoryId()) === activeCategoryId);
    const list = !keyword
      ? [...categoryTemplates]
      : categoryTemplates.filter((item) => modules.state.fuzzyMatchText(`${item.title || ""}\n${item.content || ""}`, keyword));

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
    const fromIndex = templates.findIndex((item) => String(item.id) === dragged);
    const toIndex = templates.findIndex((item) => String(item.id) === target);
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
      keyword ? `${getCategoryName(getActiveManagerCategoryId())}：${templates.length} / ${getCategoryTemplateCount(getActiveManagerCategoryId())} 条` : `${getCategoryName(getActiveManagerCategoryId())}：${templates.length} 条`,
      "info"
    );

    if (templates.length === 0) {
      listEl.innerHTML =
        modules.state.state.templates.length === 0
          ? `<div class="picker-empty"><strong>还没有已保存模板</strong><p>点击“创建模板”开始整理常用提示词。</p></div>`
          : `<div class="picker-empty"><strong>当前分类没有匹配模板</strong><p>切换分类或换个关键词再试试。</p></div>`;
      return;
    }

    listEl.innerHTML = templates
      .map((item) => {
        const isEditing = String(modules.state.state.editingTemplateId || "") === String(item.id);
        return `<article class="list-item saved-template-item compact-card is-draggable ${isEditing ? "is-editing" : ""}" draggable="true" data-template-id="${modules.runtime.escapeHtml(String(item.id))}"><div class="drag-handle" aria-hidden="true">≡</div><div class="saved-template-main compact-card-main"><div class="compact-card-topline"><strong>${modules.runtime.escapeHtml(item.title)}</strong><div class="inline-actions compact-card-actions"><button class="mini-btn" type="button" data-action="edit-template" data-template-id="${modules.runtime.escapeHtml(String(item.id))}">修改</button><button class="mini-btn" type="button" data-action="delete-template" data-template-id="${modules.runtime.escapeHtml(String(item.id))}">删除</button></div></div><span>${modules.runtime.escapeHtml(`${getTextLength(item.content)} 字符 · ${getCategoryName(item.categoryId)}`)}</span><span>${modules.runtime.escapeHtml(getTemplatePreview(item.content))}</span></div></article>`;
      })
      .join("");
  }

  function normalizePickerConfig(config = {}) {
    const mode = config.mode === "single" ? "single" : "multiple";
    return {
      mode,
      targetKey: String(config.targetKey || ""),
      maxSelection: mode === "single" ? 1 : Math.max(1, Math.min(10, Number(config.maxSelection) || 5)),
      applyMode: "replace"
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
    picker.categoryId = getActiveManagerCategoryId();
    picker.selectedIds = [];
    picker.applyMode = next.applyMode;
    modules.workspace.setModalOpen("templatePickerModal", true);
    renderTemplateCategoryControls();
    syncTemplatePickerUi();
    renderTemplatePickerList();
  }

  function closeTemplatePicker() {
    const picker = modules.state.state.templatePicker;
    picker.open = false;
    picker.targetKey = "";
    picker.keyword = "";
    picker.categoryId = getDefaultCategoryId();
    picker.selectedIds = [];
    picker.mode = "multiple";
    picker.maxSelection = 5;
    picker.applyMode = "replace";
    modules.workspace.setModalOpen("templatePickerModal", false);
  }

  function getPickerSelectionInfo() {
    const picker = modules.state.state.templatePicker;
    return picker.mode === "single"
      ? "单选模式：点击模板后会立刻写入目标字段。"
      : `已选择 ${picker.selectedIds.length} / ${picker.maxSelection}，可组合写入同一个字段。`;
  }

  function syncTemplatePickerUi() {
    const titleEl = modules.runtime.getById("templatePickerTitle");
    const infoEl = modules.runtime.getById("templatePickerSelectionInfo");
    const applyButton = modules.runtime.getById("btnApplyTemplateSelection");
    const searchInput = modules.runtime.getById("templatePickerSearchInput");
    const picker = modules.state.state.templatePicker;

    if (titleEl) titleEl.textContent = picker.mode === "single" ? "选择提示词模板" : "组合提示词模板";
    if (infoEl) infoEl.textContent = getPickerSelectionInfo();
    if (searchInput) searchInput.value = picker.keyword || "";
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
    const keyword = String(picker.keyword || "").trim();
    const activeCategoryId = getActivePickerCategoryId();
    const categoryTemplates = templates.filter((item) => String(item.categoryId || getDefaultCategoryId()) === activeCategoryId);
    const visibleTemplates = !keyword
      ? categoryTemplates
      : categoryTemplates.filter((item) => modules.state.fuzzyMatchText(`${item.title || ""}\n${item.content || ""}`, keyword));

    if (statsEl) statsEl.textContent = `${getCategoryName(activeCategoryId)} · ${visibleTemplates.length} / ${categoryTemplates.length} · 替换写入`;
    renderTemplateCategoryTabs("templatePickerCategoryTabs", activeCategoryId, { action: "select-picker-template-category", inlineManage: true });

    const createCard = `<article class="picker-item template-preset-tile template-preset-create"><button class="template-preset-select" type="button" data-action="create-picker-template"><span class="picker-item-title">+ 新建预设</span><span class="picker-item-meta"><span>${modules.runtime.escapeHtml(getCategoryName(activeCategoryId))}</span><span>保存当前字段内容</span></span></button></article>`;
    const emptyCard =
      visibleTemplates.length === 0
        ? `<div class="picker-empty template-picker-inline-empty"><strong>${templates.length === 0 ? "还没有可用模板" : "当前分类没有匹配模板"}</strong><p>${templates.length === 0 ? "点击“新建预设”保存当前字段内容。" : "切换分类或换个关键词再试试。"}</p></div>`
        : "";
    const templateCards = visibleTemplates
      .map((item) => {
        const isSelected = picker.selectedIds.includes(String(item.id));
        const escapedId = modules.runtime.escapeHtml(String(item.id));
        const isMenuOpen = isPickerInlineMenuOpen("template", item.id);
        const menu = isMenuOpen
          ? buildInlineActionMenu(
              [
                { id: "edit-template", label: "编辑预设" },
                { id: "delete-template", label: "删除预设", tone: "danger" }
              ],
              `data-template-id="${escapedId}"`
            )
          : "";
        return `<article class="picker-item template-preset-tile is-draggable ${isSelected ? "active" : ""} ${isMenuOpen ? "has-open-menu" : ""}" draggable="true" data-template-id="${escapedId}" title="${modules.runtime.escapeHtml(item.title)}"><button class="template-preset-select" type="button" data-template-id="${escapedId}"><span class="picker-item-title">${modules.runtime.escapeHtml(item.title)}</span><span class="picker-item-meta"><span>${modules.runtime.escapeHtml(`${getTextLength(item.content)} 字`)}</span><span>${modules.runtime.escapeHtml(getTailPreview(item.content, 20))}</span></span></button><button class="template-card-menu template-preset-menu" type="button" data-action="open-picker-template-menu" data-template-id="${escapedId}" title="预设操作" aria-label="预设操作">•••</button>${menu}</article>`;
      })
      .join("");
    listEl.innerHTML = `${createCard}${emptyCard}${templateCards}`;

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

    const selected = (Array.isArray(templateIds) ? templateIds : [])
      .map((id) => modules.state.state.templates.find((item) => String(item.id) === String(id)))
      .filter(Boolean);
    if (selected.length === 0) throw new Error("请至少选择一个模板");

    const applyMode = options.applyMode === "append" ? "append" : "replace";
    const existingValue = String(modules.state.state.formValues[key] || "");
    const incomingContent = selected.map((item) => String(item.content || "")).join("\n");
    const content =
      applyMode === "append" && existingValue.trim()
        ? `${existingValue.replace(/\s+$/g, "")}\n\n${incomingContent}`
        : incomingContent;
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
    const formCloseButton = runtime.getById("templateFormClose");
    const formCancelButton = runtime.getById("templateFormCancel");
    const formSubmitButton = runtime.getById("templateFormSubmit");
    const formBackdrop = runtime.getById("templateFormBackdrop");
    const managerSearchInput = runtime.getById("templateManagerSearchInput");
    const managerSortInput = runtime.getById("templateManagerSortInput");
    const managerCategorySelect = runtime.getById("templateCategorySelect");
    const addCategoryButton = runtime.getById("btnAddTemplateCategory");
    const renameCategoryButton = runtime.getById("btnRenameTemplateCategory");
    const deleteCategoryButton = runtime.getById("btnDeleteTemplateCategory");
    bindTemplateDragSorting(pickerList);
    bindTemplateDragSorting(runtime.getById("savedTemplatesList"));

    [titleInput, contentInput].filter(Boolean).forEach((element) => {
      element.addEventListener("input", () => {
        updateTemplateLengthHint();
        runtime.setSummaryStatus(
          runtime.getById("templateStatusSummary"),
          modules.state.state.editingTemplateId
            ? "已修改当前模板，记得保存后再切换。"
            : "正在填写新模板，保存后会加入下方列表。",
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

    if (managerCategorySelect) {
      managerCategorySelect.addEventListener("change", async () => {
        modules.state.state.templateManagerCategoryId = managerCategorySelect.value || getDefaultCategoryId();
        await fillTemplateEditor(null, { force: true });
        renderTemplateCategoryControls();
        renderSavedTemplatesList();
      });
    }

    if (addCategoryButton) {
      addCategoryButton.addEventListener("click", async () => {
        await createTemplateCategory();
        await fillTemplateEditor(null, { force: true });
      });
    }

    if (renameCategoryButton) {
      renameCategoryButton.addEventListener("click", async () => {
        await renameActiveTemplateCategory();
      });
    }

    if (deleteCategoryButton) {
      deleteCategoryButton.addEventListener("click", async () => {
        await deleteActiveTemplateCategory();
        await fillTemplateEditor(null, { force: true });
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
      resetButton.addEventListener("click", async () => {
        await fillTemplateEditor(null);
      });
    }

    if (formCloseButton) formCloseButton.addEventListener("click", () => closeTemplateFormModal(null));
    if (formCancelButton) formCancelButton.addEventListener("click", () => closeTemplateFormModal(null));
    if (formBackdrop) formBackdrop.addEventListener("click", () => closeTemplateFormModal(null));
    if (formSubmitButton) {
      formSubmitButton.addEventListener("click", async () => {
        try {
          const result = modalState.action ? await modalState.action() : true;
          closeTemplateFormModal(result === undefined ? true : result);
        } catch (error) {
          const messageEl = runtime.getById("templateFormMessage");
          if (messageEl) {
            messageEl.hidden = false;
            messageEl.textContent = error.message || "操作失败";
            messageEl.dataset.status = "error";
          }
        }
      });
    }

    document.addEventListener("click", (event) => {
      const menuAction = event.target && event.target.closest("[data-template-form-menu-action]");
      if (!menuAction) return;
      event.preventDefault();
      closeTemplateFormModal(menuAction.getAttribute("data-template-form-menu-action") || "");
    });

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
      const inlineMenuAction = event.target && event.target.closest("[data-template-inline-action]");
      if (inlineMenuAction) {
        event.preventDefault();
        event.stopPropagation();
        await handlePickerInlineMenuAction(inlineMenuAction.getAttribute("data-template-inline-action") || "", inlineMenuAction);
        return;
      }

      const actionTarget = event.target && event.target.closest("[data-action][data-template-id]");
      if (actionTarget) {
        const action = actionTarget.getAttribute("data-action");
        const templateId = actionTarget.getAttribute("data-template-id");
        if (action === "open-picker-template-menu") {
          event.preventDefault();
          event.stopPropagation();
          await openPickerTemplateMenu(templateId);
          return;
        }
        if (action === "edit-template") {
          const target = modules.state.state.templates.find((item) => String(item.id) === String(templateId));
          await fillTemplateEditor(target || null);
          return;
        }
        if (action === "delete-template") {
          await deleteTemplateById(templateId);
          return;
        }
      }

      if (event.target && !event.target.closest(".template-inline-menu, .template-card-menu")) {
        const menu = getPickerInlineMenu();
        if (menu.type || menu.id) {
          setPickerInlineMenu("", "");
          renderTemplatePickerList();
        }
      }

      if (event.target && event.target.closest("#templatePickerBackdrop")) closeTemplatePicker();

      const pickerCreateTemplateTarget = event.target && event.target.closest("[data-action='create-picker-template']");
      if (pickerCreateTemplateTarget) {
        event.preventDefault();
        await saveCurrentFieldAsTemplateFromPicker();
        return;
      }

      const pickerCreateCategoryTarget = event.target && event.target.closest("[data-action='create-picker-template-category']");
      if (pickerCreateCategoryTarget) {
        event.preventDefault();
        await createTemplateCategoryForPicker();
        return;
      }

      const pickerCategoryMenuTarget = event.target && event.target.closest("[data-action='open-picker-category-menu'][data-template-category-id]");
      if (pickerCategoryMenuTarget) {
        event.preventDefault();
        event.stopPropagation();
        await openPickerCategoryMenu(pickerCategoryMenuTarget.getAttribute("data-template-category-id"));
        return;
      }

      const managerCategoryTarget = event.target && event.target.closest("[data-action='select-template-category'][data-template-category-id]");
      if (managerCategoryTarget) {
        modules.state.state.templateManagerCategoryId = managerCategoryTarget.getAttribute("data-template-category-id") || getDefaultCategoryId();
        await fillTemplateEditor(null, { force: true });
        renderTemplateCategoryControls();
        renderSavedTemplatesList();
        return;
      }

      const pickerCategoryTarget = event.target && event.target.closest("[data-action='select-picker-template-category'][data-template-category-id]");
      if (pickerCategoryTarget) {
        modules.state.state.templatePicker.categoryId = pickerCategoryTarget.getAttribute("data-template-category-id") || getDefaultCategoryId();
        modules.state.state.templatePicker.selectedIds = [];
        renderTemplatePickerList();
        return;
      }
    });

    if (pickerCloseButton) pickerCloseButton.addEventListener("click", closeTemplatePicker);

    if (pickerList) {
      pickerList.addEventListener("click", (event) => {
        if (event.target && event.target.closest("[data-action]")) return;
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

    if (pickerApplyButton) {
      pickerApplyButton.addEventListener("click", () => {
        try {
          const picker = modules.state.state.templatePicker;
          applyTemplatesToField(picker.targetKey, picker.selectedIds, { applyMode: "replace" });
          closeTemplatePicker();
        } catch (error) {
          modules.ui.logToWorkspace(error.message, "warn");
        }
      });
    }

    void fillTemplateEditor(null, { force: true });
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
    saveTemplateCategoriesToStorage,
    renderTemplateCategoryControls,
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
