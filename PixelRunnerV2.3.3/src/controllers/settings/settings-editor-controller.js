function createSettingsEditorController(options = {}) {
  const dom = options.dom || {};
  const getStore =
    typeof options.getStore === "function" ? options.getStore : () => options.store || null;
  const loadSettingsSnapshotUsecase =
    typeof options.loadSettingsSnapshotUsecase === "function"
      ? options.loadSettingsSnapshotUsecase
      : () => ({
          apiKey: "",
          pollInterval: 2,
          timeout: 180,
          uploadRetryCount: 2,
          uploadTargetBytes: 9000000,
          uploadHardLimitBytes: 10000000,
          uploadAutoCompressEnabled: true,
          uploadCompressFormat: "jpeg",
          pasteStrategy: "",
          cloudConcurrentJobs: 3
        });
  const saveSettingsUsecase =
    typeof options.saveSettingsUsecase === "function" ? options.saveSettingsUsecase : () => ({});
  const saveTemplateUsecase =
    typeof options.saveTemplateUsecase === "function" ? options.saveTemplateUsecase : () => ({ reason: "saved" });
  const normalizeCloudConcurrentJobs =
    typeof options.normalizeCloudConcurrentJobs === "function"
      ? options.normalizeCloudConcurrentJobs
      : (value) => {
          const num = Number(value);
          if (!Number.isFinite(num)) return 3;
          return Math.max(1, Math.min(100, Math.floor(num)));
        };
  const normalizeUploadRetryCount =
    typeof options.normalizeUploadRetryCount === "function"
      ? options.normalizeUploadRetryCount
      : (value) => {
          const num = Number(value);
          if (!Number.isFinite(num)) return 2;
          return Math.max(0, Math.min(5, Math.floor(num)));
        };
  const normalizeUploadTargetBytes =
    typeof options.normalizeUploadTargetBytes === "function"
      ? options.normalizeUploadTargetBytes
      : (value) => {
          const num = Number(value);
          if (!Number.isFinite(num)) return 9000000;
          return Math.max(1000000, Math.min(100000000, Math.floor(num)));
        };
  const normalizeUploadHardLimitBytes =
    typeof options.normalizeUploadHardLimitBytes === "function"
      ? options.normalizeUploadHardLimitBytes
      : (value, _fallback, targetBytes) => {
          const num = Number(value);
          const normalized = Number.isFinite(num) ? Math.max(1000000, Math.min(100000000, Math.floor(num))) : 10000000;
          const target = Number.isFinite(Number(targetBytes)) ? Math.max(1000000, Math.min(100000000, Math.floor(targetBytes))) : 9000000;
          return Math.max(normalized, target);
        };
  const normalizeUploadAutoCompressEnabled =
    typeof options.normalizeUploadAutoCompressEnabled === "function"
      ? options.normalizeUploadAutoCompressEnabled
      : (value) => {
          if (typeof value === "boolean") return value;
          const marker = String(value == null ? "" : value).trim().toLowerCase();
          if (!marker) return true;
          if (["false", "0", "no", "off", "fou", "\u5426"].includes(marker)) return false;
          if (["true", "1", "yes", "on", "shi", "\u662f"].includes(marker)) return true;
          return true;
        };
  const normalizeUploadCompressFormat =
    typeof options.normalizeUploadCompressFormat === "function"
      ? options.normalizeUploadCompressFormat
      : (value) => (String(value || "").trim().toLowerCase() === "jpeg" ? "jpeg" : "jpeg");
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
      saveSettingsSuccess: "\u8bbe\u7f6e\u5df2\u4fdd\u5b58"
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
    if (dom.cloudConcurrentJobsInput) {
      dom.cloudConcurrentJobsInput.value = String(
        normalizeCloudConcurrentJobs(settingsSnapshot.cloudConcurrentJobs)
      );
    }
    if (dom.uploadRetryCountInput) {
      dom.uploadRetryCountInput.value = String(normalizeUploadRetryCount(settingsSnapshot.uploadRetryCount));
    }
    if (dom.uploadTargetBytesInput) {
      dom.uploadTargetBytesInput.value = String(normalizeUploadTargetBytes(settingsSnapshot.uploadTargetBytes));
    }
    if (dom.uploadHardLimitBytesInput) {
      dom.uploadHardLimitBytesInput.value = String(
        normalizeUploadHardLimitBytes(
          settingsSnapshot.uploadHardLimitBytes,
          10000000,
          settingsSnapshot.uploadTargetBytes
        )
      );
    }
    if (dom.uploadAutoCompressEnabledInput) {
      dom.uploadAutoCompressEnabledInput.value = "true";
      dom.uploadAutoCompressEnabledInput.disabled = true;
    }
    if (dom.uploadCompressFormatInput) {
      dom.uploadCompressFormatInput.value = String(
        normalizeUploadCompressFormat(settingsSnapshot.uploadCompressFormat)
      );
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
    const cloudConcurrentJobs = normalizeCloudConcurrentJobs(
      dom.cloudConcurrentJobsInput ? dom.cloudConcurrentJobsInput.value : currentSettings.cloudConcurrentJobs
    );
    const uploadRetryCount = normalizeUploadRetryCount(
      dom.uploadRetryCountInput ? dom.uploadRetryCountInput.value : currentSettings.uploadRetryCount
    );
    const uploadTargetBytes = normalizeUploadTargetBytes(
      dom.uploadTargetBytesInput ? dom.uploadTargetBytesInput.value : currentSettings.uploadTargetBytes
    );
    const uploadHardLimitBytes = normalizeUploadHardLimitBytes(
      dom.uploadHardLimitBytesInput ? dom.uploadHardLimitBytesInput.value : currentSettings.uploadHardLimitBytes,
      currentSettings.uploadHardLimitBytes,
      uploadTargetBytes
    );
    const uploadAutoCompressEnabled = true;
    if (dom.uploadAutoCompressEnabledInput) {
      dom.uploadAutoCompressEnabledInput.value = "true";
      dom.uploadAutoCompressEnabledInput.disabled = true;
    }
    const uploadCompressFormat = normalizeUploadCompressFormat(
      dom.uploadCompressFormatInput ? dom.uploadCompressFormatInput.value : currentSettings.uploadCompressFormat
    );

    const payload = saveSettingsUsecase({
      store,
      apiKey,
      pollInterval,
      timeout,
      uploadRetryCount,
      uploadTargetBytes,
      uploadHardLimitBytes,
      uploadAutoCompressEnabled,
      uploadCompressFormat,
      pasteStrategy: currentSettings.pasteStrategy,
      cloudConcurrentJobs
    });
    emitSettingsChanged(payload);
    alertFn(messages.saveSettingsSuccess);
    return payload;
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
    saveTemplate
  };
}

module.exports = {
  createSettingsEditorController
};
