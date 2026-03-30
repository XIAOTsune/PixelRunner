const test = require("node:test");
const assert = require("node:assert/strict");
const { createSettingsEditorController } = require("../../../src/controllers/settings/settings-editor-controller");

function createFixture(options = {}) {
  const dom = {
    apiKeyInput: { value: options.apiKeyInputValue || "" },
    pollIntervalInput: { value: options.pollIntervalInputValue || "" },
    timeoutInput: { value: options.timeoutInputValue || "" },
    cloudConcurrentJobsInput: { value: options.cloudConcurrentJobsInputValue || "" },
    uploadRetryCountInput: { value: options.uploadRetryCountInputValue || "" },
    uploadTargetBytesInput: { value: options.uploadTargetBytesInputValue || "" },
    uploadHardLimitBytesInput: { value: options.uploadHardLimitBytesInputValue || "" },
    uploadAutoCompressEnabledInput: { value: options.uploadAutoCompressEnabledInputValue || "", disabled: false },
    uploadCompressFormatInput: { value: options.uploadCompressFormatInputValue || "" },
    templateTitleInput: { value: options.templateTitleValue || "" },
    templateContentInput: { value: options.templateContentValue || "" },
    templateLengthHint: {}
  };
  const store = options.store || { tag: "store" };
  const snapshot =
    options.settingsSnapshot || {
      apiKey: "stored-key",
      pollInterval: 3,
      timeout: 120,
      uploadRetryCount: 2,
      uploadTargetBytes: 9000000,
      uploadHardLimitBytes: 10000000,
      uploadAutoCompressEnabled: true,
      uploadCompressFormat: "jpeg",
      pasteStrategy: "normal",
      cloudConcurrentJobs: 5
    };
  const calls = {
    loadSnapshotArgs: [],
    saveSettingsArgs: [],
    saveTemplateArgs: [],
    normalizeCloudConcurrentCalls: [],
    normalizeUploadRetryCountCalls: [],
    normalizeUploadTargetBytesCalls: [],
    normalizeUploadHardLimitBytesCalls: [],
    normalizeUploadAutoCompressEnabledCalls: [],
    normalizeUploadCompressFormatCalls: [],
    enforceCalls: [],
    insertCalls: [],
    buildHintArgs: [],
    renderHintArgs: [],
    emitSettings: [],
    emitTemplates: [],
    renderSavedTemplates: 0,
    alerts: []
  };
  const messages = Object.assign(
    {
      saveSettingsSuccess: "saved settings"
    },
    options.messages || {}
  );

  const controller = createSettingsEditorController({
    dom,
    getStore: () => store,
    loadSettingsSnapshotUsecase: (args) => {
      calls.loadSnapshotArgs.push(args);
      return snapshot;
    },
    saveSettingsUsecase: (args) => {
      calls.saveSettingsArgs.push(args);
      return options.saveSettingsPayload || { apiKeyChanged: true, settingsChanged: true };
    },
    saveTemplateUsecase: (args) => {
      calls.saveTemplateArgs.push(args);
      if (options.saveTemplateError) throw options.saveTemplateError;
      return options.saveTemplateResult || { reason: "saved" };
    },
    normalizeCloudConcurrentJobs: (value) => {
      calls.normalizeCloudConcurrentCalls.push(value);
      if (options.normalizedCloudConcurrentJobs !== undefined) return options.normalizedCloudConcurrentJobs;
      return Number(value) || 2;
    },
    normalizeUploadRetryCount: (value) => {
      calls.normalizeUploadRetryCountCalls.push(value);
      if (options.normalizedUploadRetryCount !== undefined) return options.normalizedUploadRetryCount;
      return Number(value) || 2;
    },
    normalizeUploadTargetBytes: (value) => {
      calls.normalizeUploadTargetBytesCalls.push(value);
      if (options.normalizedUploadTargetBytes !== undefined) return options.normalizedUploadTargetBytes;
      return Number(value) || 9000000;
    },
    normalizeUploadHardLimitBytes: (value, fallback, targetBytes) => {
      calls.normalizeUploadHardLimitBytesCalls.push({ value, fallback, targetBytes });
      if (options.normalizedUploadHardLimitBytes !== undefined) return options.normalizedUploadHardLimitBytes;
      return Math.max(Number(value) || Number(fallback) || 10000000, Number(targetBytes) || 0);
    },
    normalizeUploadAutoCompressEnabled: (value) => {
      calls.normalizeUploadAutoCompressEnabledCalls.push(value);
      if (options.normalizedUploadAutoCompressEnabled !== undefined) return options.normalizedUploadAutoCompressEnabled;
      if (value === true || value === "true") return true;
      if (value === false || value === "false") return false;
      return true;
    },
    normalizeUploadCompressFormat: (value) => {
      calls.normalizeUploadCompressFormatCalls.push(value);
      if (options.normalizedUploadCompressFormat !== undefined) return options.normalizedUploadCompressFormat;
      return String(value || "jpeg");
    },
    buildTemplateLengthHintViewModel: (args) => {
      calls.buildHintArgs.push(args);
      return options.hintViewModel || { text: "hint", color: "#999", isLarge: false };
    },
    getClipboardPlainText: () => String(options.clipboardText || ""),
    enforceLongTextCapacity: (inputEl, maxChars) => {
      calls.enforceCalls.push({ inputEl, maxChars });
    },
    insertTextAtCursor: (inputEl, text) => {
      calls.insertCalls.push({ inputEl, text });
    },
    getTextLength: (value) => String(value || "").length,
    getTailPreview: (value, maxChars) => String(value || "").slice(-Math.max(0, Number(maxChars) || 0)),
    warningChars: options.warningChars === undefined ? 4000 : options.warningChars,
    textInputHardMaxChars: options.textInputHardMaxChars === undefined ? 20000 : options.textInputHardMaxChars,
    renderTemplateLengthHint: (hintEl, viewModel) => {
      calls.renderHintArgs.push({ hintEl, viewModel });
    },
    emitSettingsChanged: (payload) => {
      calls.emitSettings.push(payload);
    },
    emitTemplatesChanged: (payload) => {
      calls.emitTemplates.push(payload);
    },
    renderSavedTemplates: () => {
      calls.renderSavedTemplates += 1;
    },
    alert: (message) => {
      calls.alerts.push(String(message || ""));
    },
    messages
  });

  return {
    controller,
    dom,
    store,
    snapshot,
    calls
  };
}

test("settings editor controller syncs settings snapshot to dom and enforces content max length", () => {
  const fixture = createFixture({
    normalizedCloudConcurrentJobs: 9,
    normalizedUploadRetryCount: 3,
    normalizedUploadTargetBytes: 8_800_000,
    normalizedUploadHardLimitBytes: 9_900_000,
    normalizedUploadAutoCompressEnabled: false,
    normalizedUploadCompressFormat: "jpeg",
    settingsSnapshot: {
      apiKey: "stored-key",
      pollInterval: 3,
      timeout: 120,
      uploadRetryCount: 2,
      uploadTargetBytes: 9_000_000,
      uploadHardLimitBytes: 10_000_000,
      uploadAutoCompressEnabled: true,
      uploadCompressFormat: "jpeg",
      pasteStrategy: "normal",
      cloudConcurrentJobs: 5
    },
    textInputHardMaxChars: 12345
  });
  const { controller, dom, store, snapshot, calls } = fixture;

  const result = controller.syncSettingsSnapshot();

  assert.equal(calls.loadSnapshotArgs.length, 1);
  assert.equal(calls.loadSnapshotArgs[0].store, store);
  assert.deepEqual(result, snapshot);
  assert.equal(dom.apiKeyInput.value, "stored-key");
  assert.equal(dom.pollIntervalInput.value, 3);
  assert.equal(dom.timeoutInput.value, 120);
  assert.equal(dom.cloudConcurrentJobsInput.value, "9");
  assert.equal(dom.uploadRetryCountInput.value, "3");
  assert.equal(dom.uploadTargetBytesInput.value, "8800000");
  assert.equal(dom.uploadHardLimitBytesInput.value, "9900000");
  assert.equal(dom.uploadAutoCompressEnabledInput.value, "true");
  assert.equal(dom.uploadAutoCompressEnabledInput.disabled, true);
  assert.equal(dom.uploadCompressFormatInput.value, "jpeg");
  assert.deepEqual(calls.normalizeCloudConcurrentCalls, [5]);
  assert.deepEqual(calls.normalizeUploadRetryCountCalls, [2]);
  assert.deepEqual(calls.normalizeUploadTargetBytesCalls, [9000000]);
  assert.deepEqual(calls.normalizeUploadHardLimitBytesCalls, [{ value: 10000000, fallback: 10000000, targetBytes: 9000000 }]);
  assert.deepEqual(calls.normalizeUploadAutoCompressEnabledCalls, []);
  assert.deepEqual(calls.normalizeUploadCompressFormatCalls, ["jpeg"]);
  assert.equal(calls.enforceCalls.length, 1);
  assert.equal(calls.enforceCalls[0].inputEl, dom.templateContentInput);
  assert.equal(calls.enforceCalls[0].maxChars, 12345);
});

test("settings editor controller updates template length hint via view model", () => {
  const fixture = createFixture({
    templateTitleValue: "Title",
    templateContentValue: "Content",
    warningChars: 5000,
    hintViewModel: { text: "len", color: "#abc", isLarge: false }
  });
  const { controller, dom, calls } = fixture;

  controller.updateTemplateLengthHint();

  assert.equal(calls.buildHintArgs.length, 1);
  assert.equal(calls.buildHintArgs[0].title, "Title");
  assert.equal(calls.buildHintArgs[0].content, "Content");
  assert.equal(calls.buildHintArgs[0].warningChars, 5000);
  assert.equal(typeof calls.buildHintArgs[0].getTextLength, "function");
  assert.equal(typeof calls.buildHintArgs[0].getTailPreview, "function");
  assert.equal(calls.renderHintArgs.length, 1);
  assert.equal(calls.renderHintArgs[0].hintEl, dom.templateLengthHint);
  assert.deepEqual(calls.renderHintArgs[0].viewModel, { text: "len", color: "#abc", isLarge: false });
});

test("settings editor controller handles template paste with plain text and refreshes hint", () => {
  const fixture = createFixture({
    clipboardText: "pasted-text"
  });
  const { controller, dom, calls } = fixture;
  let prevented = 0;

  controller.onTemplateContentPaste({
    preventDefault: () => {
      prevented += 1;
    }
  });

  assert.equal(prevented, 1);
  assert.equal(calls.insertCalls.length, 1);
  assert.equal(calls.insertCalls[0].inputEl, dom.templateContentInput);
  assert.equal(calls.insertCalls[0].text, "pasted-text");
  assert.equal(calls.buildHintArgs.length, 1);
  assert.equal(calls.renderHintArgs.length, 1);
});

test("settings editor controller saves api key/settings and emits settings changed", () => {
  const fixture = createFixture({
    apiKeyInputValue: "  key-1  ",
    pollIntervalInputValue: "5",
    timeoutInputValue: "90",
    cloudConcurrentJobsInputValue: "7",
    uploadRetryCountInputValue: "4",
    uploadTargetBytesInputValue: "8700000",
    uploadHardLimitBytesInputValue: "9600000",
    uploadAutoCompressEnabledInputValue: "false",
    uploadCompressFormatInputValue: "jpeg",
    settingsSnapshot: {
      apiKey: "stored",
      pollInterval: 2,
      timeout: 180,
      uploadRetryCount: 2,
      uploadTargetBytes: 9000000,
      uploadHardLimitBytes: 10000000,
      uploadAutoCompressEnabled: true,
      uploadCompressFormat: "jpeg",
      pasteStrategy: "smart",
      cloudConcurrentJobs: 3
    },
    normalizedCloudConcurrentJobs: 11,
    normalizedUploadRetryCount: 4,
    normalizedUploadTargetBytes: 8_700_000,
    normalizedUploadHardLimitBytes: 9_600_000,
    normalizedUploadAutoCompressEnabled: false,
    normalizedUploadCompressFormat: "jpeg",
    saveSettingsPayload: { apiKeyChanged: true, settingsChanged: true }
  });
  const { controller, store, calls } = fixture;

  const payload = controller.saveApiKeyAndSettings();

  assert.deepEqual(payload, { apiKeyChanged: true, settingsChanged: true });
  assert.equal(calls.loadSnapshotArgs.length, 1);
  assert.equal(calls.saveSettingsArgs.length, 1);
  assert.equal(calls.saveSettingsArgs[0].store, store);
  assert.equal(calls.saveSettingsArgs[0].apiKey, "key-1");
  assert.equal(calls.saveSettingsArgs[0].pollInterval, 5);
  assert.equal(calls.saveSettingsArgs[0].timeout, 90);
  assert.equal(calls.saveSettingsArgs[0].uploadRetryCount, 4);
  assert.equal(calls.saveSettingsArgs[0].uploadTargetBytes, 8700000);
  assert.equal(calls.saveSettingsArgs[0].uploadHardLimitBytes, 9600000);
  assert.equal(calls.saveSettingsArgs[0].uploadAutoCompressEnabled, true);
  assert.equal(calls.saveSettingsArgs[0].uploadCompressFormat, "jpeg");
  assert.equal(calls.saveSettingsArgs[0].pasteStrategy, "smart");
  assert.equal(calls.saveSettingsArgs[0].cloudConcurrentJobs, 11);
  assert.deepEqual(calls.emitSettings, [{ apiKeyChanged: true, settingsChanged: true }]);
  assert.deepEqual(calls.alerts, ["saved settings"]);
});

test("settings editor controller saves template and clears editor inputs", () => {
  const fixture = createFixture({
    templateTitleValue: "  Portrait  ",
    templateContentValue: "prompt text",
    saveTemplateResult: { reason: "updated" }
  });
  const { controller, store, dom, calls } = fixture;

  const result = controller.saveTemplate();

  assert.deepEqual(result, { reason: "updated" });
  assert.equal(calls.saveTemplateArgs.length, 1);
  assert.equal(calls.saveTemplateArgs[0].store, store);
  assert.equal(calls.saveTemplateArgs[0].title, "  Portrait  ");
  assert.equal(calls.saveTemplateArgs[0].content, "prompt text");
  assert.deepEqual(calls.emitTemplates, [{ reason: "updated" }]);
  assert.equal(dom.templateTitleInput.value, "");
  assert.equal(dom.templateContentInput.value, "");
  assert.equal(calls.renderSavedTemplates, 1);
  assert.equal(calls.buildHintArgs.length, 1);
  assert.equal(calls.renderHintArgs.length, 1);
  assert.deepEqual(calls.alerts, []);
});

test("settings editor controller saveTemplate surfaces errors and does not mutate lists", () => {
  const fixture = createFixture({
    templateTitleValue: "Title",
    templateContentValue: "Content",
    saveTemplateError: new Error("template failed")
  });
  const { controller, dom, calls } = fixture;

  const result = controller.saveTemplate();

  assert.equal(result, null);
  assert.equal(dom.templateTitleInput.value, "Title");
  assert.equal(dom.templateContentInput.value, "Content");
  assert.equal(calls.emitTemplates.length, 0);
  assert.equal(calls.renderSavedTemplates, 0);
  assert.equal(calls.buildHintArgs.length, 0);
  assert.equal(calls.renderHintArgs.length, 0);
  assert.deepEqual(calls.alerts, ["template failed"]);
});
