function createAppPickerController(options = {}) {
  const state = options.state || {};
  const dom = options.dom || {};
  const store = options.store || null;
  const byId = typeof options.byId === "function" ? options.byId : () => null;
  const decodeDataId =
    typeof options.decodeDataId === "function" ? options.decodeDataId : (value) => String(value || "");
  const escapeHtml = typeof options.escapeHtml === "function" ? options.escapeHtml : (value) => String(value || "");
  const encodeDataId =
    typeof options.encodeDataId === "function" ? options.encodeDataId : (value) => String(value || "");
  const renderAppPickerListHtml =
    typeof options.renderAppPickerListHtml === "function" ? options.renderAppPickerListHtml : () => "";
  const buildAppPickerViewModel =
    typeof options.buildAppPickerViewModel === "function"
      ? options.buildAppPickerViewModel
      : () => ({ totalCount: 0, visibleCount: 0, empty: true, emptyState: null, items: [] });
  const renderDynamicInputs =
    typeof options.renderDynamicInputs === "function" ? options.renderDynamicInputs : () => {};
  const updateCurrentAppMeta =
    typeof options.updateCurrentAppMeta === "function" ? options.updateCurrentAppMeta : () => {};
  const updateRunButtonUI =
    typeof options.updateRunButtonUI === "function" ? options.updateRunButtonUI : () => {};
  const refreshModalOpenState =
    typeof options.refreshModalOpenState === "function" ? options.refreshModalOpenState : () => {};
  const alertFn =
    typeof options.alert === "function"
      ? options.alert
      : typeof alert === "function"
      ? alert
      : () => {};

  function getApps() {
    if (!store || typeof store.getAiApps !== "function") return [];
    const apps = store.getAiApps();
    return (Array.isArray(apps) ? apps : []).filter((app) => app && typeof app === "object");
  }

  function renderList() {
    if (!dom.appPickerList) return;

    const viewModel = buildAppPickerViewModel({
      apps: getApps(),
      keyword: state.appPickerKeyword,
      currentAppId: state.currentApp && state.currentApp.id
    });

    if (dom.appPickerStats) {
      dom.appPickerStats.textContent = `${viewModel.visibleCount} / ${viewModel.totalCount}`;
    }

    dom.appPickerList.innerHTML = renderAppPickerListHtml(viewModel, {
      escapeHtml,
      encodeDataId
    });
  }

  function close() {
    if (dom.appPickerModal && dom.appPickerModal.classList) {
      dom.appPickerModal.classList.remove("active");
    }
    refreshModalOpenState();
  }

  function open() {
    state.appPickerKeyword = "";
    if (dom.appPickerSearchInput) dom.appPickerSearchInput.value = "";
    renderList();
    if (dom.appPickerModal && dom.appPickerModal.classList) {
      dom.appPickerModal.classList.add("active");
    }
    refreshModalOpenState();
  }

  function select(id, options = {}) {
    const quiet = !!options.quiet;
    const closeModal = options.closeModal !== false;
    try {
      const app = getApps().find((item) => String(item.id) === String(id));
      if (!app) {
        if (!quiet) alertFn("应用不存在，请刷新后重试");
        return false;
      }
      renderDynamicInputs(app);
      if (closeModal) close();
      return true;
    } catch (error) {
      console.error(error);
      if (!quiet) {
        const message = error && error.message ? error.message : String(error || "unknown error");
        alertFn(`加载应用失败: ${message}`);
      }
      return false;
    }
  }

  function sync(options = {}) {
    const forceRerender = !!options.forceRerender;
    const apps = getApps();

    if (apps.length === 0) {
      if (state.currentApp || forceRerender) {
        renderDynamicInputs(null);
      } else {
        updateCurrentAppMeta();
        updateRunButtonUI();
      }
      renderList();
      return;
    }

    const currentId = state.currentApp && state.currentApp.id;
    if (!currentId) {
      select(apps[0].id, { quiet: true, closeModal: false });
      renderList();
      return;
    }

    const matched = apps.find((item) => item.id === currentId);
    if (!matched) {
      select(apps[0].id, { quiet: true, closeModal: false });
      renderList();
      return;
    }

    state.currentApp = matched;
    if (forceRerender) {
      renderDynamicInputs(matched);
    } else {
      updateCurrentAppMeta();
      updateRunButtonUI();
    }
    renderList();
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

    const item = target.closest(".app-picker-item[data-id]");
    if (!item || !dom.appPickerList || typeof dom.appPickerList.contains !== "function" || !dom.appPickerList.contains(item)) {
      return;
    }

    const id = decodeDataId((item.dataset && item.dataset.id) || "");
    if (!id) return;
    select(id);
  }

  function onSearchInput() {
    const keywordValue = dom.appPickerSearchInput ? dom.appPickerSearchInput.value : "";
    state.appPickerKeyword = String(keywordValue || "");
    renderList();
  }

  function onModalClick(event) {
    if (event && event.target === dom.appPickerModal) close();
  }

  return {
    open,
    close,
    sync,
    select,
    renderList,
    handleListClick,
    onSearchInput,
    onModalClick
  };
}

module.exports = {
  createAppPickerController
};
