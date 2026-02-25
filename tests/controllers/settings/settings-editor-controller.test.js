const test = require("node:test");
const assert = require("node:assert/strict");
const { createSettingsEditorController } = require("../../../src/controllers/settings/settings-editor-controller");

function createFixture(options = {}) {
  const dom = {
    apiKeyInput: { value: options.apiKeyInputValue || "" },
    pollIntervalInput: { value: options.pollIntervalInputValue || "" },
    timeoutInput: { value: options.timeoutInputValue || "" },
    cloudConcurrentJobsInput: { value: options.cloudConcurrentJobsInputValue || "" },
    uploadMaxEdgeSettingSelect: { value: options.uploadMaxEdgeInputValue || "" },
    btnTestApiKey: { textContent: "test" },
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
      uploadMaxEdge: 768,
      pasteStrategy: "normal",
      cloudConcurrentJobs: 5
    };
  const calls = {
    loadSnapshotArgs: [],
    saveSettingsArgs: [],
    testApiKeyArgs: [],
    saveTemplateArgs: [],
    normalizeUploadCalls: [],
    normalizeCloudConcurrentCalls: [],
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
      saveSettingsSuccess: "saved settings",
      apiKeyRequired: "api key required",
      testingApiKey: "testing",
      testApiKeyAction: "test",
      testApiKeyFailedPrefix: "test failed: "
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
    testApiKeyUsecase: async (args) => {
      calls.testApiKeyArgs.push(args);
      if (options.testApiKeyError) throw options.testApiKeyError;
      return options.testApiKeyResult || { message: "ok" };
    },
    saveTemplateUsecase: (args) => {
      calls.saveTemplateArgs.push(args);
      if (options.saveTemplateError) throw options.saveTemplateError;
      return options.saveTemplateResult || { reason: "saved" };
    },
    normalizeUploadMaxEdge: (value) => {
      calls.normalizeUploadCalls.push(value);
      if (options.normalizedUploadMaxEdge !== undefined) return options.normalizedUploadMaxEdge;
      return Number(value) || 0;
    },
    normalizeCloudConcurrentJobs: (value) => {
      calls.normalizeCloudConcurrentCalls.push(value);
      if (options.normalizedCloudConcurrentJobs !== undefined) return options.normalizedCloudConcurrentJobs;
      return Number(value) || 2;
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
    normalizedUploadMaxEdge: 1024,
    normalizedCloudConcurrentJobs: 9,
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
  assert.equal(dom.uploadMaxEdgeSettingSelect.value, "1024");
  assert.deepEqual(calls.normalizeUploadCalls, [768]);
  assert.deepEqual(calls.normalizeCloudConcurrentCalls, [5]);
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
    uploadMaxEdgeInputValue: "2048",
    settingsSnapshot: {
      apiKey: "stored",
      pollInterval: 2,
      timeout: 180,
      uploadMaxEdge: 512,
      pasteStrategy: "smart",
      cloudConcurrentJobs: 3
    },
    normalizedUploadMaxEdge: 1536,
    normalizedCloudConcurrentJobs: 11,
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
  assert.equal(calls.saveSettingsArgs[0].uploadMaxEdge, 1536);
  assert.equal(calls.saveSettingsArgs[0].pasteStrategy, "smart");
  assert.equal(calls.saveSettingsArgs[0].cloudConcurrentJobs, 11);
  assert.deepEqual(calls.emitSettings, [{ apiKeyChanged: true, settingsChanged: true }]);
  assert.deepEqual(calls.alerts, ["saved settings"]);
});

test("settings editor controller testApiKey validates empty key and skips request", async () => {
  const fixture = createFixture({
    apiKeyInputValue: "   "
  });
  const { controller, calls, dom } = fixture;

  const result = await controller.testApiKey();

  assert.equal(result, null);
  assert.equal(calls.testApiKeyArgs.length, 0);
  assert.deepEqual(calls.alerts, ["api key required"]);
  assert.equal(dom.btnTestApiKey.textContent, "test");
});

test("settings editor controller testApiKey restores button text on success and failure", async () => {
  const successFixture = createFixture({
    apiKeyInputValue: "  key-ok "
  });
  const successResult = await successFixture.controller.testApiKey();
  assert.deepEqual(successResult, { message: "ok" });
  assert.equal(successFixture.calls.testApiKeyArgs.length, 1);
  assert.equal(successFixture.calls.testApiKeyArgs[0].apiKey, "key-ok");
  assert.equal(successFixture.calls.testApiKeyArgs[0].runninghub, successFixture.store);
  assert.deepEqual(successFixture.calls.alerts, ["ok"]);
  assert.equal(successFixture.dom.btnTestApiKey.textContent, "test");

  const failedFixture = createFixture({
    apiKeyInputValue: "key-fail",
    testApiKeyError: new Error("network down")
  });
  const failedResult = await failedFixture.controller.testApiKey();
  assert.equal(failedResult, null);
  assert.equal(failedFixture.calls.testApiKeyArgs.length, 1);
  assert.deepEqual(failedFixture.calls.alerts, ["test failed: network down"]);
  assert.equal(failedFixture.dom.btnTestApiKey.textContent, "test");
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
