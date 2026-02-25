function createSettingsEditorController(options = {}) {
  const dom = options.dom || {};
  const getStore =
    typeof options.getStore === "function" ? options.getStore : () => options.store || null;
  const loadSettingsSnapshotUsecase =
    typeof options.loadSettingsSnapshotUsecase === "function"
      ? options.loadSettingsSnapshotUsecase
      : () => ({ apiKey: "", pollInterval: 2, timeout: 180, uploadMaxEdge: 0, pasteStrategy: "" });
  const saveSettingsUsecase =
    typeof options.saveSettingsUsecase === "function" ? options.saveSettingsUsecase : () => ({});
  const testApiKeyUsecase =
    typeof options.testApiKeyUsecase === "function" ? options.testApiKeyUsecase : async () => ({ message: "" });
  const saveTemplateUsecase =
    typeof options.saveTemplateUsecase === "function" ? options.saveTemplateUsecase : () => ({ reason: "saved" });
  const normalizeUploadMaxEdge =
    typeof options.normalizeUploadMaxEdge === "function" ? options.normalizeUploadMaxEdge : (value) => Number(value) || 0;
  const buildTemplateLengthHintViewModel =
    typeof options.buildTemplateLengthHintViewModel === "function"
      ? options.buildTemplateLengthHintViewModel
      : () => ({ text: "", color: "", isLarge: false });
  const getClipboardPlainText =
    typeof options.getClipboardPlainText === "function" ? options.getClipboardPlainText : () => "";
  const enforceLongTextCapacityPolicy =
    typeof options.enforceLongTextCapacity === "function" ? options.enforceLongTextCapacity : () => {};
  const insertTextAtCursorPolicy =
    typeof options.insertTextAtCursor === "function" ? options.insertTextAtCursor : () => {};
  const getTextLength = typeof options.getTextLength === "function" ? options.getTextLength : (value) => String(value || "").length;
  const getTailPreview = typeof options.getTailPreview === "function" ? options.getTailPreview : () => "";
  const warningChars = Math.max(0, Number(options.warningChars) || 0);
  const textInputHardMaxChars = Math.max(1, Number(options.textInputHardMaxChars) || 20000);
  const renderTemplateLengthHint =
    typeof options.renderTemplateLengthHint === "function" ? options.renderTemplateLengthHint : () => {};
  const emitSettingsChanged =
    typeof options.emitSettingsChanged === "function" ? options.emitSettingsChanged : () => {};
  const emitTemplatesChanged =
    typeof options.emitTemplatesChanged === "function" ? options.emitTemplatesChanged : () => {};
  const renderSavedTemplates =
    typeof options.renderSavedTemplates === "function" ? options.renderSavedTemplates : () => {};
  const alertFn =
    typeof options.alert === "function"
      ? options.alert
      : typeof alert === "function"
      ? alert
      : () => {};
  const messages = Object.assign(
    {
      saveSettingsSuccess: "\u8bbe\u7f6e\u5df2\u4fdd\u5b58",
      apiKeyRequired: "\u8bf7\u8f93\u5165 API Key",
      testingApiKey: "\u6d4b\u8bd5\u4e2d...",
      testApiKeyAction: "\u6d4b\u8bd5\u8fde\u63a5",
      testApiKeyFailedPrefix: "\u6d4b\u8bd5\u51fa\u9519: "
    },
    options.messages && typeof options.messages === "object" ? options.messages : {}
  );

  function resolveStore() {
    return getStore();
  }

  function enforceLongTextCapacity(inputEl) {
    enforceLongTextCapacityPolicy(inputEl, textInputHardMaxChars);
  }

  function syncSettingsSnapshot() {
    const settingsSnapshot = loadSettingsSnapshotUsecase({
      store: resolveStore()
    });
    if (dom.apiKeyInput) dom.apiKeyInput.value = settingsSnapshot.apiKey;
    if (dom.pollIntervalInput) dom.pollIntervalInput.value = settingsSnapshot.pollInterval;
    if (dom.timeoutInput) dom.timeoutInput.value = settingsSnapshot.timeout;
    if (dom.uploadMaxEdgeSettingSelect) {
      dom.uploadMaxEdgeSettingSelect.value = String(normalizeUploadMaxEdge(settingsSnapshot.uploadMaxEdge));
    }
    enforceLongTextCapacity(dom.templateContentInput);
    return settingsSnapshot;
  }

  function updateTemplateLengthHint() {
    if (!dom.templateLengthHint) return;
    const viewModel = buildTemplateLengthHintViewModel({
      title: dom.templateTitleInput && dom.templateTitleInput.value,
      content: dom.templateContentInput && dom.templateContentInput.value,
      warningChars,
      getTextLength,
      getTailPreview
    });
    renderTemplateLengthHint(dom.templateLengthHint, viewModel);
  }

  function onTemplateContentPaste(event) {
    const clipboardText = getClipboardPlainText(event);
    if (!clipboardText || !dom.templateContentInput) return;
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    insertTextAtCursorPolicy(dom.templateContentInput, clipboardText);
    updateTemplateLengthHint();
  }

  function saveApiKeyAndSettings() {
    const store = resolveStore();
    const apiKey = String((dom.apiKeyInput && dom.apiKeyInput.value) || "").trim();
    const pollInterval = Number((dom.pollIntervalInput && dom.pollIntervalInput.value) || 0) || 2;
    const timeout = Number((dom.timeoutInput && dom.timeoutInput.value) || 0) || 180;
    const currentSettings = loadSettingsSnapshotUsecase({
      store
    });
    const uploadMaxEdge = normalizeUploadMaxEdge(
      dom.uploadMaxEdgeSettingSelect ? dom.uploadMaxEdgeSettingSelect.value : currentSettings.uploadMaxEdge
    );

    const payload = saveSettingsUsecase({
      store,
      apiKey,
      pollInterval,
      timeout,
      uploadMaxEdge,
      pasteStrategy: currentSettings.pasteStrategy
    });
    emitSettingsChanged(payload);
    alertFn(messages.saveSettingsSuccess);
    return payload;
  }

  async function testApiKey() {
    const apiKey = String((dom.apiKeyInput && dom.apiKeyInput.value) || "").trim();
    if (!apiKey) {
      alertFn(messages.apiKeyRequired);
      return null;
    }
    if (dom.btnTestApiKey) {
      dom.btnTestApiKey.textContent = messages.testingApiKey;
    }
    try {
      const result = await testApiKeyUsecase({
        runninghub: resolveStore(),
        apiKey
      });
      alertFn(result && result.message ? result.message : "");
      return result;
    } catch (error) {
      const message = error && error.message ? error.message : String(error || "unknown");
      alertFn(`${messages.testApiKeyFailedPrefix}${message}`);
      return null;
    } finally {
      if (dom.btnTestApiKey) {
        dom.btnTestApiKey.textContent = messages.testApiKeyAction;
      }
    }
  }

  function saveTemplate() {
    try {
      const result = saveTemplateUsecase({
        store: resolveStore(),
        title: String((dom.templateTitleInput && dom.templateTitleInput.value) || ""),
        content: String((dom.templateContentInput && dom.templateContentInput.value) || "")
      });
      emitTemplatesChanged({ reason: result.reason });
      if (dom.templateTitleInput) dom.templateTitleInput.value = "";
      if (dom.templateContentInput) dom.templateContentInput.value = "";
      updateTemplateLengthHint();
      renderSavedTemplates();
      return result;
    } catch (error) {
      alertFn(error && error.message ? error.message : String(error || "unknown"));
      return null;
    }
  }

  return {
    syncSettingsSnapshot,
    enforceLongTextCapacity,
    updateTemplateLengthHint,
    onTemplateContentPaste,
    saveApiKeyAndSettings,
    testApiKey,
    saveTemplate
  };
}

module.exports = {
  createSettingsEditorController
};
