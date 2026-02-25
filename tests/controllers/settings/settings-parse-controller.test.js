const test = require("node:test");
const assert = require("node:assert/strict");
const { createSettingsParseController } = require("../../../src/controllers/settings/settings-parse-controller");

function createFixture(options = {}) {
  const state = {
    parsedAppData: options.parsedAppData === undefined ? null : options.parsedAppData,
    currentEditingAppId: options.currentEditingAppId === undefined ? null : options.currentEditingAppId
  };
  const dom = {
    appIdInput: { value: options.appIdInput || "" },
    appNameInput: { value: options.appNameInput || "" },
    btnParseApp: { disabled: false, textContent: "parse" },
    parseResultContainer: { innerHTML: "" },
    envDoctorOutput: {}
  };
  const saveButton = {
    listeners: new Map(),
    addEventListener: (eventName, handler) => {
      saveButton.listeners.set(eventName, handler);
    }
  };
  const store = options.store || { tag: "store" };
  const parseResult = options.parseResult || { id: "parsed-1", name: "Demo App" };
  const calls = {
    parseArgs: [],
    saveArgs: [],
    appendLines: [],
    emitted: [],
    renderSavedAppsList: 0,
    alerts: [],
    reportedErrors: []
  };
  const messages = Object.assign(
    {
      invalidAppId: "invalid app id",
      apiKeyMissing: "api key missing",
      parseBusyText: "parsing...",
      parseActionText: "parse",
      saveAppSuccess: "app saved"
    },
    options.messages || {}
  );

  const controller = createSettingsParseController({
    state,
    dom,
    getStore: () => store,
    normalizeAppId: (value) => String(value || "").trim(),
    getSavedApiKeyUsecase: () => (options.apiKey === undefined ? "api-key" : options.apiKey),
    parseRunninghubAppUsecase: async (args) => {
      calls.parseArgs.push(args);
      if (options.parseError) throw options.parseError;
      return parseResult;
    },
    saveParsedAppUsecase: (args) => {
      calls.saveArgs.push(args);
      return options.savePayload || { reason: "saved", id: "app-1" };
    },
    buildParseSuccessViewModel: (data) => ({ title: data && data.name ? data.name : "unknown" }),
    buildParseFailureViewModel: (errorOrMessage) => ({
      message: errorOrMessage && errorOrMessage.message ? errorOrMessage.message : String(errorOrMessage || "")
    }),
    buildParseFailureDiagnostics: () => (Array.isArray(options.diagLines) ? options.diagLines : ["diag-1", "diag-2"]),
    renderParseSuccessHtml: (viewModel) => `success:${viewModel.title}`,
    renderParseFailureHtml: (viewModel) => `failure:${viewModel.message}`,
    appendEnvDoctorOutput: (_target, line) => {
      calls.appendLines.push(String(line || ""));
    },
    byId: (id) => (id === "btnSaveParsedApp" ? saveButton : null),
    emitAppsChanged: (payload) => {
      calls.emitted.push(payload);
    },
    renderSavedAppsList: () => {
      calls.renderSavedAppsList += 1;
    },
    reportError: (error) => {
      calls.reportedErrors.push(error);
    },
    log: () => {},
    escapeHtml: (value) => String(value || ""),
    alert: (message) => {
      calls.alerts.push(String(message || ""));
    },
    messages
  });

  return {
    controller,
    state,
    dom,
    saveButton,
    store,
    calls
  };
}

test("settings parse controller blocks parse when app id is missing", async () => {
  const fixture = createFixture({
    appIdInput: "   "
  });
  const { controller, calls, dom } = fixture;

  await controller.parseApp();

  assert.deepEqual(calls.alerts, ["invalid app id"]);
  assert.equal(calls.parseArgs.length, 0);
  assert.equal(dom.btnParseApp.disabled, false);
  assert.equal(dom.btnParseApp.textContent, "parse");
});

test("settings parse controller blocks parse when api key is missing", async () => {
  const fixture = createFixture({
    appIdInput: "app-1",
    apiKey: ""
  });
  const { controller, calls, dom } = fixture;

  await controller.parseApp();

  assert.deepEqual(calls.alerts, ["api key missing"]);
  assert.equal(calls.parseArgs.length, 0);
  assert.equal(dom.btnParseApp.disabled, false);
  assert.equal(dom.btnParseApp.textContent, "parse");
});

test("settings parse controller parses app and binds save action", async () => {
  const fixture = createFixture({
    appIdInput: "  app-99  ",
    appNameInput: "  Portrait  ",
    parseResult: {
      id: "parsed-99",
      name: "Portrait"
    }
  });
  const { controller, state, dom, saveButton, calls, store } = fixture;

  await controller.parseApp();

  assert.equal(calls.parseArgs.length, 1);
  assert.equal(calls.parseArgs[0].runninghub, store);
  assert.equal(calls.parseArgs[0].appId, "app-99");
  assert.equal(calls.parseArgs[0].apiKey, "api-key");
  assert.equal(calls.parseArgs[0].preferredName, "Portrait");
  assert.equal(typeof calls.parseArgs[0].log, "function");
  assert.deepEqual(state.parsedAppData, { id: "parsed-99", name: "Portrait" });
  assert.equal(dom.parseResultContainer.innerHTML, "success:Portrait");
  assert.equal(typeof saveButton.listeners.get("click"), "function");
  assert.equal(dom.btnParseApp.disabled, false);
  assert.equal(dom.btnParseApp.textContent, "parse");
  assert.deepEqual(calls.alerts, []);
});

test("settings parse controller saveParsedApp emits event, clears editor and rerenders list", () => {
  const fixture = createFixture({
    parsedAppData: { id: "parsed-1", name: "Portrait" },
    currentEditingAppId: "editing-app"
  });
  const { controller, state, dom, calls, store } = fixture;
  dom.appIdInput.value = "12345";
  dom.appNameInput.value = "Portrait";
  dom.parseResultContainer.innerHTML = "success:Portrait";

  controller.saveParsedApp();

  assert.equal(calls.saveArgs.length, 1);
  assert.equal(calls.saveArgs[0].store, store);
  assert.deepEqual(calls.saveArgs[0].parsedAppData, { id: "parsed-1", name: "Portrait" });
  assert.deepEqual(calls.emitted, [{ reason: "saved", id: "app-1" }]);
  assert.deepEqual(calls.alerts, ["app saved"]);
  assert.equal(calls.renderSavedAppsList, 1);
  assert.equal(dom.appIdInput.value, "");
  assert.equal(dom.appNameInput.value, "");
  assert.equal(dom.parseResultContainer.innerHTML, "");
  assert.equal(state.parsedAppData, null);
  assert.equal(state.currentEditingAppId, null);
});

test("settings parse controller saveParsedApp is noop when parsed data is empty", () => {
  const fixture = createFixture({
    parsedAppData: null
  });
  const { controller, calls } = fixture;

  controller.saveParsedApp();

  assert.equal(calls.saveArgs.length, 0);
  assert.equal(calls.emitted.length, 0);
  assert.equal(calls.renderSavedAppsList, 0);
  assert.equal(calls.alerts.length, 0);
});

test("settings parse controller renders parse failure and appends diagnostics", async () => {
  const error = new Error("parse boom");
  const fixture = createFixture({
    appIdInput: "app-2",
    parseError: error,
    diagLines: ["diag-a", "diag-b"]
  });
  const { controller, dom, calls } = fixture;

  await controller.parseApp();

  assert.equal(calls.reportedErrors.length, 1);
  assert.equal(calls.reportedErrors[0], error);
  assert.equal(dom.parseResultContainer.innerHTML, "failure:parse boom");
  assert.deepEqual(calls.appendLines, ["diag-a", "diag-b"]);
  assert.equal(dom.btnParseApp.disabled, false);
  assert.equal(dom.btnParseApp.textContent, "parse");
});
