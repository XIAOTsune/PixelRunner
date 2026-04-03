(function initTemplatesModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const PROMPT_WARN_CHARS = 4000;

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
        ? `标题 ${titleLen} / 内容 ${contentLen} 字符，末尾预览 ${tailPreview}。建议控制在 ${PROMPT_WARN_CHARS} 字符内。`
        : `标题 ${titleLen} / 内容 ${contentLen} 字符，末尾预览 ${tailPreview}。插件本地不会截断模板内容。`,
      warning
    };
  }

  function fillTemplateEditor(template) {
    const runtime = modules.runtime;
    const item = template && typeof template === "object" ? template : null;
    modules.state.state.editingTemplateId = item ? String(item.id) : null;

    const titleInput = runtime.getById("templateTitleInput");
    const contentInput = runtime.getById("templateContentInput");
    if (titleInput) titleInput.value = item ? item.title || "" : "";
    if (contentInput) contentInput.value = item ? item.content || "" : "";
    updateTemplateLengthHint();

    runtime.setSummaryStatus(
      runtime.getById("templateStatusSummary"),
      item ? `正在编辑模板：${item.title}` : "填写标题和内容后即可保存为新模板",
      "info"
    );
  }

  function updateTemplateLengthHint() {
    const runtime = modules.runtime;
    const hintEl = runtime.getById("templateLengthHint");
    if (!hintEl) return;
    const title = runtime.getById("templateTitleInput")?.value || "";
    const content = runtime.getById("templateContentInput")?.value || "";
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
      modules.ui.logToWorkspace(`模板列表已刷新，共 ${modules.state.state.templates.length} 条`, "info");
    }
  }

  function readTemplateEditorForm() {
    const runtime = modules.runtime;
    const title = String(runtime.getById("templateTitleInput")?.value || "").trim();
    const content = String(runtime.getById("templateContentInput")?.value || "");
    if (!title) throw new Error("请先填写模板标题");
    if (!content.trim()) throw new Error("请先填写模板内容");

    return {
      id: modules.state.state.editingTemplateId || runtime.createId("tpl"),
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
    fillTemplateEditor(null);
    modules.ui.logToWorkspace(`模板已保存：${nextItem.title}`, "success");
    modules.runtime.setSummaryStatus(modules.runtime.getById("templateStatusSummary"), "模板已保存并同步到工作台选择器", "success");
  }

  async function deleteTemplateById(templateId) {
    const target = modules.state.state.templates.find((item) => String(item.id) === String(templateId));
    if (!target) return;
    const nextTemplates = modules.state.state.templates.filter((item) => String(item.id) !== String(templateId));
    await saveTemplatesToStorage(nextTemplates);
    if (String(modules.state.state.editingTemplateId || "") === String(templateId)) {
      fillTemplateEditor(null);
    }
    modules.ui.logToWorkspace(`模板已删除：${target.title}`, "warn");
    modules.runtime.setSummaryStatus(modules.runtime.getById("templateStatusSummary"), "模板已删除", "warn");
  }

  function exportTemplatesToTextarea() {
    const runtime = modules.runtime;
    const input = runtime.getById("templateTransferInput");
    if (!input) return;
    input.dataset.userEdited = "";
    input.value = JSON.stringify({
      format: "pixelrunner.prompt-templates",
      version: 1,
      exportedAt: new Date().toISOString(),
      templates: modules.state.state.templates
    }, null, 2);
  }

  async function importTemplatesFromTextarea() {
    const runtime = modules.runtime;
    const input = runtime.getById("templateTransferInput");
    if (!input) return;
    const text = String(input.value || "").trim();
    if (!text) throw new Error("请先在文本框中粘贴模板 JSON");

    let parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.templates)) {
      parsed = parsed.templates;
    }
    const templates = modules.state.normalizeTemplateList(parsed);
    if (templates.length === 0) throw new Error("没有解析到可导入的模板");

    await saveTemplatesToStorage(templates);
    input.dataset.userEdited = "";
    input.value = JSON.stringify({
      format: "pixelrunner.prompt-templates",
      version: 1,
      exportedAt: new Date().toISOString(),
      templates
    }, null, 2);
    modules.runtime.setSummaryStatus(runtime.getById("templateStatusSummary"), `模板导入完成，共 ${templates.length} 条`, "success");
    modules.ui.logToWorkspace(`模板导入完成，共 ${templates.length} 条`, "success");
  }

  function renderSavedTemplatesList() {
    const runtime = modules.runtime;
    const listEl = runtime.getById("savedTemplatesList");
    const summaryEl = runtime.getById("savedTemplatesSummary");
    const transferInput = runtime.getById("templateTransferInput");
    const templates = modules.state.state.templates;
    if (!listEl || !summaryEl) return;

    runtime.setSummaryStatus(summaryEl, `已保存模板：${templates.length} 条`, "info");
    if (transferInput && !transferInput.dataset.userEdited && templates.length > 0) {
      exportTemplatesToTextarea();
    }

    if (templates.length === 0) {
      listEl.innerHTML = `
        <div class="picker-empty">
          <strong>还没有已保存模板</strong>
          <p>可先创建常用提示词模板，工作台里的 prompt 字段会直接接入模板选择器。</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = templates.map((item) => `
      <article class="list-item saved-template-item" data-template-id="${runtime.escapeHtml(String(item.id))}">
        <div class="saved-template-main">
          <strong>${runtime.escapeHtml(item.title)}</strong>
          <span>${runtime.escapeHtml(`${getTextLength(item.content)} 字符`)}</span>
          <span>${runtime.escapeHtml(getTailPreview(item.content, 28))}</span>
        </div>
        <div class="inline-actions">
          <button class="mini-btn" type="button" data-action="edit-template" data-template-id="${runtime.escapeHtml(String(item.id))}">编辑</button>
          <button class="mini-btn" type="button" data-action="delete-template" data-template-id="${runtime.escapeHtml(String(item.id))}">删除</button>
        </div>
      </article>
    `).join("");
  }

  function normalizePickerConfig(config = {}) {
    const mode = config.mode === "single" ? "single" : "multiple";
    return {
      mode,
      targetKey: String(config.targetKey || ""),
      maxSelection: mode === "single" ? 1 : Math.max(1, Math.min(10, Number(config.maxSelection) || 5))
    };
  }

  function openTemplatePicker(config = {}) {
    const picker = modules.state.state.templatePicker;
    const next = normalizePickerConfig(config);
    picker.open = true;
    picker.targetKey = next.targetKey;
    picker.mode = next.mode;
    picker.maxSelection = next.maxSelection;
    picker.selectedIds = [];
    modules.workspace.setModalOpen("templatePickerModal", true);
    syncTemplatePickerUi();
    renderTemplatePickerList();
  }

  function closeTemplatePicker() {
    const picker = modules.state.state.templatePicker;
    picker.open = false;
    picker.targetKey = "";
    picker.selectedIds = [];
    picker.mode = "multiple";
    picker.maxSelection = 5;
    modules.workspace.setModalOpen("templatePickerModal", false);
  }

  function getPickerSelectionInfo() {
    const picker = modules.state.state.templatePicker;
    return picker.mode === "single"
      ? "单选模式：点击模板后立即写入字段"
      : `已选择 ${picker.selectedIds.length} / ${picker.maxSelection}`;
  }

  function syncTemplatePickerUi() {
    const runtime = modules.runtime;
    const titleEl = runtime.getById("templatePickerTitle");
    const infoEl = runtime.getById("templatePickerSelectionInfo");
    const applyButton = runtime.getById("btnApplyTemplateSelection");
    const picker = modules.state.state.templatePicker;
    if (titleEl) titleEl.textContent = picker.mode === "single" ? "选择提示词模板" : "组合提示词模板";
    if (infoEl) infoEl.textContent = getPickerSelectionInfo();
    if (applyButton) applyButton.hidden = picker.mode === "single";
    if (applyButton) applyButton.disabled = picker.selectedIds.length === 0;
  }

  function renderTemplatePickerList() {
    const runtime = modules.runtime;
    const listEl = runtime.getById("templatePickerList");
    if (!listEl) return;
    const templates = modules.state.state.templates;
    const picker = modules.state.state.templatePicker;

    if (templates.length === 0) {
      listEl.innerHTML = `
        <div class="picker-empty">
          <strong>还没有可用模板</strong>
          <p>先去 Settings 创建模板，再回到工作台选择。</p>
        </div>
      `;
      syncTemplatePickerUi();
      return;
    }

    listEl.innerHTML = templates.map((item) => {
      const isSelected = picker.selectedIds.includes(String(item.id));
      return `
        <button class="picker-item ${isSelected ? "active" : ""}" type="button" data-template-id="${runtime.escapeHtml(String(item.id))}">
          <span class="picker-item-title">${runtime.escapeHtml(item.title)}</span>
          <span class="picker-item-meta">
            <span>${runtime.escapeHtml(`${getTextLength(item.content)} 字符`)}</span>
            <span>${runtime.escapeHtml(getTailPreview(item.content, 30))}</span>
          </span>
        </button>
      `;
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

  function applyTemplatesToField(fieldKey, templateIds) {
    const key = String(fieldKey || "").trim();
    if (!key) throw new Error("未找到目标字段");
    const selected = (Array.isArray(templateIds) ? templateIds : [])
      .map((id) => modules.state.state.templates.find((item) => String(item.id) === String(id)))
      .filter(Boolean);
    if (selected.length === 0) throw new Error("请至少选择一个模板");

    const content = selected.map((item) => String(item.content || "")).join("\n");
    const length = getTextLength(content);
    if (length > PROMPT_WARN_CHARS) {
      throw new Error(`组合后的提示词长度 ${length} 超出建议上限 ${PROMPT_WARN_CHARS}`);
    }

    modules.state.state.formValues[key] = content;
    modules.workspace.renderWorkspace();
    modules.ui.logToWorkspace(`已将 ${selected.length} 条模板写入字段：${key}`, "success");
  }

  function bindTemplateActions() {
    const runtime = modules.runtime;
    const titleInput = runtime.getById("templateTitleInput");
    const contentInput = runtime.getById("templateContentInput");
    const transferInput = runtime.getById("templateTransferInput");
    const saveButton = runtime.getById("btnSaveTemplate");
    const resetButton = runtime.getById("btnResetTemplateEditor");
    const importButton = runtime.getById("btnImportTemplates");
    const exportButton = runtime.getById("btnExportTemplates");
    const pickerCloseButton = runtime.getById("templatePickerModalClose");
    const pickerApplyButton = runtime.getById("btnApplyTemplateSelection");
    const pickerList = runtime.getById("templatePickerList");

    [titleInput, contentInput].filter(Boolean).forEach((element) => {
      element.addEventListener("input", updateTemplateLengthHint);
    });

    if (transferInput) {
      transferInput.addEventListener("input", () => {
        transferInput.dataset.userEdited = "true";
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

    if (importButton) {
      importButton.addEventListener("click", async () => {
        try {
          await importTemplatesFromTextarea();
        } catch (error) {
          runtime.setSummaryStatus(runtime.getById("templateStatusSummary"), `导入失败：${error.message}`, "error");
        }
      });
    }

    if (exportButton) {
      exportButton.addEventListener("click", () => {
        exportTemplatesToTextarea();
        runtime.setSummaryStatus(runtime.getById("templateStatusSummary"), "模板 JSON 已导出到下方文本框", "success");
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

      if (event.target && event.target.closest("#templatePickerBackdrop")) {
        closeTemplatePicker();
      }
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
            applyTemplatesToField(picker.targetKey, [templateId]);
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

    if (pickerApplyButton) {
      pickerApplyButton.addEventListener("click", () => {
        try {
          const picker = modules.state.state.templatePicker;
          applyTemplatesToField(picker.targetKey, picker.selectedIds);
          closeTemplatePicker();
        } catch (error) {
          modules.ui.logToWorkspace(error.message, "warn");
        }
      });
    }

    fillTemplateEditor(null);
    updateTemplateLengthHint();
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
    importTemplatesFromTextarea,
    exportTemplatesToTextarea,
    openTemplatePicker,
    closeTemplatePicker,
    applyTemplatesToField,
    bindTemplateActions
  };
})(window);
