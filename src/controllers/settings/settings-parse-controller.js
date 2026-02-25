function createSettingsParseController(options = {}) {
  const state = options.state || {};
  const dom = options.dom || {};
  const getStore =
    typeof options.getStore === "function" ? options.getStore : () => options.store || null;
  const normalizeAppId =
    typeof options.normalizeAppId === "function"
      ? options.normalizeAppId
      : (value) => String(value || "").trim();
  const getSavedApiKeyUsecase =
    typeof options.getSavedApiKeyUsecase === "function" ? options.getSavedApiKeyUsecase : () => "";
  const parseRunninghubAppUsecase =
    typeof options.parseRunninghubAppUsecase === "function"
      ? options.parseRunninghubAppUsecase
      : async () => null;
  const saveParsedAppUsecase =
    typeof options.saveParsedAppUsecase === "function" ? options.saveParsedAppUsecase : () => ({});
  const buildParseSuccessViewModel =
    typeof options.buildParseSuccessViewModel === "function"
      ? options.buildParseSuccessViewModel
      : (value) => value;
  const buildParseFailureViewModel =
    typeof options.buildParseFailureViewModel === "function"
      ? options.buildParseFailureViewModel
      : (value) => value;
  const buildParseFailureDiagnostics =
    typeof options.buildParseFailureDiagnostics === "function" ? options.buildParseFailureDiagnostics : () => [];
  const renderParseSuccessHtml =
    typeof options.renderParseSuccessHtml === "function" ? options.renderParseSuccessHtml : () => "";
  const renderParseFailureHtml =
    typeof options.renderParseFailureHtml === "function" ? options.renderParseFailureHtml : () => "";
  const appendEnvDoctorOutput =
    typeof options.appendEnvDoctorOutput === "function" ? options.appendEnvDoctorOutput : () => {};
  const byId = typeof options.byId === "function" ? options.byId : () => null;
  const emitAppsChanged =
    typeof options.emitAppsChanged === "function" ? options.emitAppsChanged : () => {};
  const renderSavedAppsList =
    typeof options.renderSavedAppsList === "function" ? options.renderSavedAppsList : () => {};
  const reportError =
    typeof options.reportError === "function"
      ? options.reportError
      : (error) => {
          if (typeof console !== "undefined" && console && typeof console.error === "function") {
            console.error(error);
          }
        };
  const log = typeof options.log === "function" ? options.log : () => {};
  const escapeHtml = typeof options.escapeHtml === "function" ? options.escapeHtml : (value) => String(value || "");
  const alertFn =
    typeof options.alert === "function"
      ? options.alert
      : typeof alert === "function"
      ? alert
      : () => {};
  const messages = Object.assign(
    {
      invalidAppId: "\u8bf7\u8f93\u5165\u6709\u6548\u7684\u5e94\u7528 ID \u6216 URL",
      apiKeyMissing: "\u8bf7\u5148\u4fdd\u5b58 API Key",
      parseBusyText: "\u89e3\u6790\u4e2d...",
      parseActionText: "\u89e3\u6790",
      saveAppSuccess: "\u5e94\u7528\u5df2\u4fdd\u5b58"
    },
    options.messages && typeof options.messages === "object" ? options.messages : {}
  );

  function resolveStore() {
    return getStore();
  }

  function renderParseResult(data) {
    const viewModel = buildParseSuccessViewModel(data);
    if (dom.parseResultContainer) {
      dom.parseResultContainer.innerHTML = renderParseSuccessHtml(viewModel, {
        escapeHtml
      });
    }

    const saveBtn = byId("btnSaveParsedApp");
    if (saveBtn && typeof saveBtn.addEventListener === "function") {
      saveBtn.addEventListener("click", saveParsedApp);
    }
  }

  function clearAppEditorUI() {
    if (dom.appIdInput) dom.appIdInput.value = "";
    if (dom.appNameInput) dom.appNameInput.value = "";
    if (dom.parseResultContainer) dom.parseResultContainer.innerHTML = "";
    state.parsedAppData = null;
    state.currentEditingAppId = null;
  }

  function saveParsedApp() {
    if (!state.parsedAppData) return;
    const payload = saveParsedAppUsecase({
      store: resolveStore(),
      parsedAppData: state.parsedAppData
    });
    emitAppsChanged(payload);
    alertFn(messages.saveAppSuccess);
    clearAppEditorUI();
    renderSavedAppsList();
  }

  function showParseFailure(errorOrMessage) {
    const viewModel = buildParseFailureViewModel(errorOrMessage);
    if (dom.parseResultContainer) {
      dom.parseResultContainer.innerHTML = renderParseFailureHtml(viewModel, {
        escapeHtml
      });
    }
  }

  async function parseApp() {
    const store = resolveStore();
    const apiKey = getSavedApiKeyUsecase({
      store
    });
    const appId = normalizeAppId(dom.appIdInput ? dom.appIdInput.value : "");

    if (!appId) {
      alertFn(messages.invalidAppId);
      return;
    }
    if (!apiKey) {
      alertFn(messages.apiKeyMissing);
      return;
    }
    if (dom.btnParseApp) {
      dom.btnParseApp.disabled = true;
      dom.btnParseApp.textContent = messages.parseBusyText;
    }

    try {
      if (dom.appIdInput) dom.appIdInput.value = appId;
      state.parsedAppData = await parseRunninghubAppUsecase({
        runninghub: store,
        appId,
        apiKey,
        preferredName: dom.appNameInput ? String(dom.appNameInput.value || "").trim() : "",
        log
      });
      renderParseResult(state.parsedAppData);
    } catch (error) {
      reportError(error);
      showParseFailure(error);
      const diagnosticLines = buildParseFailureDiagnostics(error);
      diagnosticLines.forEach((line) => appendEnvDoctorOutput(dom.envDoctorOutput, line));
    } finally {
      if (dom.btnParseApp) {
        dom.btnParseApp.disabled = false;
        dom.btnParseApp.textContent = messages.parseActionText;
      }
    }
  }

  return {
    parseApp,
    renderParseResult,
    saveParsedApp,
    showParseFailure,
    clearAppEditorUI
  };
}

module.exports = {
  createSettingsParseController
};
