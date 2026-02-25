function createSettingsListsController(options = {}) {
  const state = options.state || {};
  const dom = options.dom || {};
  const getStore =
    typeof options.getStore === "function" ? options.getStore : () => options.store || null;
  const appEvents = options.appEvents || {};
  const emitAppEvent =
    typeof options.emitAppEvent === "function" ? options.emitAppEvent : () => {};
  const buildSavedAppsListViewModel =
    typeof options.buildSavedAppsListViewModel === "function"
      ? options.buildSavedAppsListViewModel
      : (value) => value;
  const buildSavedTemplatesListViewModel =
    typeof options.buildSavedTemplatesListViewModel === "function"
      ? options.buildSavedTemplatesListViewModel
      : (value) => value;
  const listSavedAppsUsecase =
    typeof options.listSavedAppsUsecase === "function" ? options.listSavedAppsUsecase : () => [];
  const findSavedAppByIdUsecase =
    typeof options.findSavedAppByIdUsecase === "function" ? options.findSavedAppByIdUsecase : () => null;
  const loadEditableAppUsecase =
    typeof options.loadEditableAppUsecase === "function"
      ? options.loadEditableAppUsecase
      : () => ({ found: false, appId: "", appName: "", currentEditingAppId: null, parsedAppData: null });
  const deleteAppUsecase =
    typeof options.deleteAppUsecase === "function" ? options.deleteAppUsecase : () => ({ deleted: false });
  const listSavedTemplatesUsecase =
    typeof options.listSavedTemplatesUsecase === "function" ? options.listSavedTemplatesUsecase : () => [];
  const findSavedTemplateByIdUsecase =
    typeof options.findSavedTemplateByIdUsecase === "function"
      ? options.findSavedTemplateByIdUsecase
      : () => null;
  const loadEditableTemplateUsecase =
    typeof options.loadEditableTemplateUsecase === "function"
      ? options.loadEditableTemplateUsecase
      : () => ({ found: false, title: "", content: "" });
  const deleteTemplateUsecase =
    typeof options.deleteTemplateUsecase === "function"
      ? options.deleteTemplateUsecase
      : () => ({ deleted: false });
  const renderSavedAppsListHtml =
    typeof options.renderSavedAppsListHtml === "function" ? options.renderSavedAppsListHtml : () => "";
  const renderSavedTemplatesListHtml =
    typeof options.renderSavedTemplatesListHtml === "function"
      ? options.renderSavedTemplatesListHtml
      : () => "";
  const resolveSavedAppsListAction =
    typeof options.resolveSavedAppsListAction === "function"
      ? options.resolveSavedAppsListAction
      : () => ({ kind: "none", id: "" });
  const resolveSavedTemplatesListAction =
    typeof options.resolveSavedTemplatesListAction === "function"
      ? options.resolveSavedTemplatesListAction
      : () => ({ kind: "none", id: "" });
  const findClosestByClass =
    typeof options.findClosestByClass === "function" ? options.findClosestByClass : () => null;
  const decodeDataId =
    typeof options.decodeDataId === "function" ? options.decodeDataId : (value) => String(value || "");
  const escapeHtml = typeof options.escapeHtml === "function" ? options.escapeHtml : (value) => String(value || "");
  const encodeDataId =
    typeof options.encodeDataId === "function" ? options.encodeDataId : (value) => String(value || "");
  const appendEnvDoctorOutput =
    typeof options.appendEnvDoctorOutput === "function" ? options.appendEnvDoctorOutput : () => {};
  const updateTemplateLengthHint =
    typeof options.updateTemplateLengthHint === "function" ? options.updateTemplateLengthHint : () => {};
  const log = typeof options.log === "function" ? options.log : () => {};
  const alertFn =
    typeof options.alert === "function"
      ? options.alert
      : typeof alert === "function"
      ? alert
      : () => {};

  function renderSavedAppsList() {
    if (!dom.savedAppsList) return;
    const viewModel = buildSavedAppsListViewModel(
      listSavedAppsUsecase({
        store: getStore()
      })
    );
    dom.savedAppsList.innerHTML = renderSavedAppsListHtml(viewModel, {
      escapeHtml,
      encodeDataId
    });
  }

  function renderSavedTemplates() {
    if (!dom.savedTemplatesList) return;
    const viewModel = buildSavedTemplatesListViewModel(
      listSavedTemplatesUsecase({
        store: getStore()
      })
    );
    dom.savedTemplatesList.innerHTML = renderSavedTemplatesListHtml(viewModel, {
      escapeHtml,
      encodeDataId
    });
  }

  function onSavedAppsListClick(event) {
    const action = resolveSavedAppsListAction(event, {
      container: dom.savedAppsList,
      findClosestByClass,
      decodeDataId
    });
    if (action.kind === "none") return;

    if (action.kind === "edit-app") {
      const id = action.id;
      const app = findSavedAppByIdUsecase({
        store: getStore(),
        id
      });
      const editable = loadEditableAppUsecase({ app });
      if (!editable.found) {
        alertFn("App record not found.");
        return;
      }
      if (dom.appIdInput) dom.appIdInput.value = editable.appId;
      if (dom.appNameInput) dom.appNameInput.value = editable.appName;
      state.currentEditingAppId = editable.currentEditingAppId;
      state.parsedAppData = editable.parsedAppData;
      if (dom.parseResultContainer) {
        dom.parseResultContainer.innerHTML =
          `<div style="color:#aaa; font-size:11px; margin:6px 0;">App loaded. Click Parse to refresh parameters before saving.</div>`;
      }
      return;
    }

    const id = action.id;
    if (!id) {
      appendEnvDoctorOutput(dom.envDoctorOutput, "Delete app failed: missing app id in clicked row.");
      alertFn("Delete app failed: missing app ID.");
      return;
    }

    log(`Delete app requested: id=${id}`);

    const result = deleteAppUsecase({
      store: getStore(),
      id
    });
    if (!result.deleted) {
      appendEnvDoctorOutput(dom.envDoctorOutput, `Delete app not found: id=${id}`);
      alertFn("App not found or already deleted.");
    } else {
      appendEnvDoctorOutput(dom.envDoctorOutput, `Delete app success: id=${id}`);
      emitAppEvent(appEvents.APPS_CHANGED, { reason: "deleted", id });
    }

    renderSavedAppsList();
  }

  function onSavedTemplatesListClick(event) {
    const action = resolveSavedTemplatesListAction(event, {
      container: dom.savedTemplatesList,
      decodeDataId
    });
    if (action.kind === "none") return;

    if (action.kind === "edit-template") {
      const id = action.id;
      const template = findSavedTemplateByIdUsecase({
        store: getStore(),
        id
      });
      const editable = loadEditableTemplateUsecase({ template });
      if (!editable.found) {
        alertFn("Template record not found.");
        return;
      }
      if (dom.templateTitleInput) dom.templateTitleInput.value = editable.title;
      if (dom.templateContentInput) dom.templateContentInput.value = editable.content;
      updateTemplateLengthHint();
      return;
    }

    const id = action.id;
    if (!id) {
      appendEnvDoctorOutput(dom.envDoctorOutput, "Delete template failed: missing template id.");
      return;
    }

    log(`Delete template requested: id=${id}`);

    const result = deleteTemplateUsecase({
      store: getStore(),
      id
    });
    if (!result.deleted) {
      appendEnvDoctorOutput(dom.envDoctorOutput, `Delete template not found: id=${id}`);
      alertFn("Template not found or already deleted.");
    } else {
      appendEnvDoctorOutput(dom.envDoctorOutput, `Delete template success: id=${id}`);
      emitAppEvent(appEvents.TEMPLATES_CHANGED, { reason: "deleted", id });
    }

    renderSavedTemplates();
  }

  function syncSettingsLists() {
    renderSavedAppsList();
    renderSavedTemplates();
  }

  function onAppsChanged() {
    renderSavedAppsList();
  }

  function onTemplatesChanged() {
    renderSavedTemplates();
  }

  return {
    renderSavedAppsList,
    renderSavedTemplates,
    onSavedAppsListClick,
    onSavedTemplatesListClick,
    syncSettingsLists,
    onAppsChanged,
    onTemplatesChanged
  };
}

module.exports = {
  createSettingsListsController
};
