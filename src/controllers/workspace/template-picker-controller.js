function createTemplatePickerController(options = {}) {
  const state = options.state || {};
  const dom = options.dom || {};
  const store = options.store || null;
  const byId = typeof options.byId === "function" ? options.byId : () => null;
  const decodeDataId = typeof options.decodeDataId === "function" ? options.decodeDataId : (value) => String(value || "");
  const escapeHtml = typeof options.escapeHtml === "function" ? options.escapeHtml : (value) => String(value || "");
  const encodeDataId = typeof options.encodeDataId === "function" ? options.encodeDataId : (value) => String(value || "");
  const renderTemplatePickerListHtml =
    typeof options.renderTemplatePickerListHtml === "function"
      ? options.renderTemplatePickerListHtml
      : () => "";
  const normalizeTemplatePickerConfig =
    typeof options.normalizeTemplatePickerConfig === "function"
      ? options.normalizeTemplatePickerConfig
      : (config) => config || {};
  const toggleTemplateSelectionState =
    typeof options.toggleTemplateSelectionState === "function"
      ? options.toggleTemplateSelectionState
      : () => ({ changed: false, selectedIds: [] });
  const sanitizeTemplateSelectionIds =
    typeof options.sanitizeTemplateSelectionIds === "function"
      ? options.sanitizeTemplateSelectionIds
      : (ids) => (Array.isArray(ids) ? ids.slice() : []);
  const buildSingleTemplateSelectionPayload =
    typeof options.buildSingleTemplateSelectionPayload === "function"
      ? options.buildSingleTemplateSelectionPayload
      : () => "";
  const buildMultipleTemplateSelectionPayload =
    typeof options.buildMultipleTemplateSelectionPayload === "function"
      ? options.buildMultipleTemplateSelectionPayload
      : () => ({ ok: false, reason: "unknown" });
  const buildTemplatePickerUiState =
    typeof options.buildTemplatePickerUiState === "function"
      ? options.buildTemplatePickerUiState
      : () => ({ title: "", actionsDisplay: "none", selectionInfoText: "", applyDisabled: true });
  const buildTemplatePickerListViewModel =
    typeof options.buildTemplatePickerListViewModel === "function"
      ? options.buildTemplatePickerListViewModel
      : () => ({ empty: true, emptyState: { message: "No templates available." } });
  const maxTemplateCombineCount = Number(options.maxTemplateCombineCount) || 1;
  const promptMaxChars = Number(options.promptMaxChars) || 4000;
  const refreshModalOpenState =
    typeof options.refreshModalOpenState === "function" ? options.refreshModalOpenState : () => {};
  const alertFn =
    typeof options.alert === "function"
      ? options.alert
      : typeof alert === "function"
      ? alert
      : () => {};

  function getTemplates() {
    if (!store || typeof store.getPromptTemplates !== "function") return [];
    const templates = store.getPromptTemplates();
    return Array.isArray(templates) ? templates : [];
  }

  function isMultipleMode() {
    return state.templatePickerMode === "multiple";
  }

  function updateSelectionInfo() {
    if (!dom.templateModalSelectionInfo) return;
    const uiState = buildTemplatePickerUiState({
      mode: state.templatePickerMode,
      selectedCount: state.templatePickerSelectedIds.length,
      maxSelection: state.templatePickerMaxSelection
    });
    dom.templateModalSelectionInfo.textContent = uiState.selectionInfoText;
    if (dom.btnApplyTemplateSelection) dom.btnApplyTemplateSelection.disabled = uiState.applyDisabled;
  }

  function syncUiState() {
    const uiState = buildTemplatePickerUiState({
      mode: state.templatePickerMode,
      selectedCount: state.templatePickerSelectedIds.length,
      maxSelection: state.templatePickerMaxSelection
    });
    if (dom.templateModalTitle) {
      dom.templateModalTitle.textContent = uiState.title;
    }
    if (dom.templateModalActions) {
      dom.templateModalActions.style.display = uiState.actionsDisplay;
    }
    if (dom.templateModalSelectionInfo) {
      dom.templateModalSelectionInfo.textContent = uiState.selectionInfoText;
    }
    if (dom.btnApplyTemplateSelection) dom.btnApplyTemplateSelection.disabled = uiState.applyDisabled;
  }

  function renderList() {
    if (!dom.templateList) return;
    const viewModel = buildTemplatePickerListViewModel({
      templates: getTemplates(),
      selectedIds: state.templatePickerSelectedIds,
      multipleMode: isMultipleMode()
    });
    dom.templateList.innerHTML = renderTemplatePickerListHtml(viewModel, {
      escapeHtml,
      encodeDataId
    });
    updateSelectionInfo();
  }

  function reset() {
    state.templateSelectCallback = null;
    state.templatePickerMode = "single";
    state.templatePickerMaxSelection = 1;
    state.templatePickerSelectedIds = [];
    syncUiState();
  }

  function close() {
    if (dom.templateModal && dom.templateModal.classList) {
      dom.templateModal.classList.remove("active");
    }
    reset();
    refreshModalOpenState();
  }

  function open(config = {}) {
    const next = normalizeTemplatePickerConfig(config, {
      maxCombineCount: maxTemplateCombineCount
    });

    state.templateSelectCallback = next.onApply;
    state.templatePickerMode = next.mode;
    state.templatePickerMaxSelection = next.maxSelection;
    state.templatePickerSelectedIds = [];
    syncUiState();
    renderList();
    if (dom.templateModal && dom.templateModal.classList) {
      dom.templateModal.classList.add("active");
    }
    refreshModalOpenState();
  }

  function toggleSelection(id) {
    const next = toggleTemplateSelectionState({
      selectedIds: state.templatePickerSelectedIds,
      id,
      maxSelection: state.templatePickerMaxSelection
    });

    if (next.limitReached) {
      alertFn(`You can select up to ${state.templatePickerMaxSelection} template(s).`);
      return;
    }
    if (!next.changed) return;

    state.templatePickerSelectedIds = next.selectedIds;
    renderList();
  }

  function applySelection() {
    if (!isMultipleMode()) return;

    const result = buildMultipleTemplateSelectionPayload({
      templates: getTemplates(),
      selectedIds: state.templatePickerSelectedIds,
      maxChars: promptMaxChars
    });

    if (!result.ok) {
      if (result.reason === "empty_selection") {
        alertFn("Please select at least one template.");
        return;
      }
      if (result.reason === "templates_not_found") {
        alertFn("Selected templates were not found. Please refresh and retry.");
        return;
      }
      if (result.reason === "too_long") {
        alertFn(`Combined prompt length ${result.length} exceeds limit ${result.limit}.`);
        return;
      }
      alertFn("Failed to apply template selection.");
      return;
    }

    if (typeof state.templateSelectCallback === "function") {
      state.templateSelectCallback(result.payload);
    }
    close();
  }

  function handleListClick(event) {
    const target = event && event.target;
    if (!target || typeof target.closest !== "function") return;

    const gotoSettingsBtn = target.closest("button[data-action='goto-settings']");
    if (gotoSettingsBtn) {
      close();
      const tabSettings = byId("tabSettings");
      if (tabSettings && typeof tabSettings.click === "function") tabSettings.click();
      return;
    }

    const item = target.closest(".app-picker-item[data-template-id]");
    if (!item || !dom.templateList || typeof dom.templateList.contains !== "function" || !dom.templateList.contains(item)) {
      return;
    }

    const id = decodeDataId((item.dataset && item.dataset.templateId) || "");
    if (!id) return;
    const template = getTemplates().find((tpl) => String(tpl.id) === String(id));
    if (!template) return;

    if (isMultipleMode()) {
      toggleSelection(id);
      return;
    }

    const payload = buildSingleTemplateSelectionPayload({
      template,
      maxChars: promptMaxChars
    });
    if (typeof state.templateSelectCallback === "function") {
      state.templateSelectCallback(payload);
    }
    close();
  }

  function onModalClick(event) {
    if (event && event.target === dom.templateModal) close();
  }

  function onApplyButtonClick() {
    applySelection();
  }

  function onTemplatesChanged() {
    if (!dom.templateModal || !dom.templateModal.classList || !dom.templateModal.classList.contains("active")) {
      return;
    }
    state.templatePickerSelectedIds = sanitizeTemplateSelectionIds(
      state.templatePickerSelectedIds,
      getTemplates()
    );
    renderList();
  }

  return {
    reset,
    open,
    close,
    syncUiState,
    renderList,
    handleListClick,
    onModalClick,
    onApplyButtonClick,
    onTemplatesChanged
  };
}

module.exports = {
  createTemplatePickerController
};
