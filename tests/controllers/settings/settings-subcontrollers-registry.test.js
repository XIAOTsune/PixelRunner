const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSettingsSubcontrollersRegistry
} = require("../../../src/controllers/settings/settings-subcontrollers-registry");

function createNoopDelegates() {
  return {
    saveApiKeyAndSettings: () => {},
    testApiKey: () => {},
    parseApp: () => {},
    onToggleApiKey: () => {},
    saveTemplate: () => {},
    exportTemplatesJson: () => {},
    importTemplatesJson: () => {},
    loadDiagnosticsSummary: () => {},
    updateTemplateLengthHint: () => {},
    onTemplateContentPaste: () => {},
    onSavedAppsListClick: () => {},
    onSavedTemplatesListClick: () => {},
    onAppsChanged: () => {},
    onTemplatesChanged: () => {},
    renderSavedTemplates: () => {},
    renderSavedAppsList: () => {},
    syncSettingsLists: () => {}
  };
}

test("settings subcontrollers registry lazily creates controllers and rebuilds after reset", () => {
  const calls = {
    lists: 0,
    diagnostics: 0,
    parse: 0,
    editor: 0,
    collapse: 0,
    init: 0
  };
  const registry = createSettingsSubcontrollersRegistry({
    delegates: createNoopDelegates(),
    createSettingsListsController: () => {
      calls.lists += 1;
      return { type: "lists", seq: calls.lists };
    },
    createSettingsDiagnosticsTransferController: () => {
      calls.diagnostics += 1;
      return { type: "diagnostics", seq: calls.diagnostics };
    },
    createSettingsParseController: () => {
      calls.parse += 1;
      return { type: "parse", seq: calls.parse };
    },
    createSettingsEditorController: () => {
      calls.editor += 1;
      return { type: "editor", seq: calls.editor };
    },
    createSettingsCollapseTabController: () => {
      calls.collapse += 1;
      return {
        type: "collapse",
        seq: calls.collapse,
        initializeSectionCollapseState: () => {},
        bindCollapseAndTabSyncEvents: () => {}
      };
    },
    createSettingsInitController: () => {
      calls.init += 1;
      return { type: "init", seq: calls.init };
    }
  });

  const listsFirst = registry.getSettingsListsController();
  const listsSecond = registry.getSettingsListsController();
  assert.equal(listsFirst, listsSecond);
  assert.equal(calls.lists, 1);

  const diagnosticsFirst = registry.getSettingsDiagnosticsTransferController();
  const diagnosticsSecond = registry.getSettingsDiagnosticsTransferController();
  assert.equal(diagnosticsFirst, diagnosticsSecond);
  assert.equal(calls.diagnostics, 1);

  const parseFirst = registry.getSettingsParseController();
  const parseSecond = registry.getSettingsParseController();
  assert.equal(parseFirst, parseSecond);
  assert.equal(calls.parse, 1);

  const editorFirst = registry.getSettingsEditorController();
  const editorSecond = registry.getSettingsEditorController();
  assert.equal(editorFirst, editorSecond);
  assert.equal(calls.editor, 1);

  const collapseFirst = registry.getSettingsCollapseTabController();
  const collapseSecond = registry.getSettingsCollapseTabController();
  assert.equal(collapseFirst, collapseSecond);
  assert.equal(calls.collapse, 1);

  const initFirst = registry.getSettingsInitController();
  const initSecond = registry.getSettingsInitController();
  assert.equal(initFirst, initSecond);
  assert.equal(calls.init, 1);

  registry.reset();

  const listsAfterReset = registry.getSettingsListsController();
  const initAfterReset = registry.getSettingsInitController();
  assert.notEqual(listsAfterReset, listsFirst);
  assert.notEqual(initAfterReset, initFirst);
  assert.equal(calls.lists, 2);
  assert.equal(calls.init, 2);
});

test("settings subcontrollers registry bridges emitted settings events to APP_EVENTS", () => {
  const emitted = [];
  let diagnosticsOptions = null;
  let parseOptions = null;
  let editorOptions = null;
  const registry = createSettingsSubcontrollersRegistry({
    appEvents: {
      APPS_CHANGED: "apps_changed",
      TEMPLATES_CHANGED: "templates_changed",
      SETTINGS_CHANGED: "settings_changed"
    },
    emitAppEvent: (eventName, payload) => {
      emitted.push({ eventName, payload });
    },
    delegates: createNoopDelegates(),
    createSettingsDiagnosticsTransferController: (options) => {
      diagnosticsOptions = options;
      return {};
    },
    createSettingsParseController: (options) => {
      parseOptions = options;
      return {};
    },
    createSettingsEditorController: (options) => {
      editorOptions = options;
      return {};
    }
  });

  registry.getSettingsDiagnosticsTransferController();
  registry.getSettingsParseController();
  registry.getSettingsEditorController();

  diagnosticsOptions.emitTemplatesChanged({ from: "diagnostics" });
  parseOptions.emitAppsChanged({ from: "parse" });
  editorOptions.emitSettingsChanged({ from: "editor-settings" });
  editorOptions.emitTemplatesChanged({ from: "editor-templates" });

  assert.deepEqual(emitted, [
    { eventName: "templates_changed", payload: { from: "diagnostics" } },
    { eventName: "apps_changed", payload: { from: "parse" } },
    { eventName: "settings_changed", payload: { from: "editor-settings" } },
    { eventName: "templates_changed", payload: { from: "editor-templates" } }
  ]);
});

test("settings subcontrollers registry wires init controller to collapse and editor delegates", () => {
  const calls = {
    collapseInit: 0,
    collapseBind: 0,
    editorSnapshot: 0
  };
  let collapseOptions = null;
  let initOptions = null;
  const delegates = createNoopDelegates();
  const registry = createSettingsSubcontrollersRegistry({
    dom: { marker: "dom" },
    byId: () => null,
    rebindEvent: () => {},
    appEvents: {
      APPS_CHANGED: "apps_changed",
      TEMPLATES_CHANGED: "templates_changed"
    },
    toggleSectionCollapse: () => {},
    delegates,
    createSettingsCollapseTabController: (options) => {
      collapseOptions = options;
      return {
        initializeSectionCollapseState: () => {
          calls.collapseInit += 1;
        },
        bindCollapseAndTabSyncEvents: () => {
          calls.collapseBind += 1;
        }
      };
    },
    createSettingsEditorController: () => ({
      syncSettingsSnapshot: () => {
        calls.editorSnapshot += 1;
      }
    }),
    createSettingsInitController: (options) => {
      initOptions = options;
      return {};
    }
  });

  registry.getSettingsInitController();

  assert.equal(typeof initOptions.initializeCollapseState, "function");
  assert.equal(typeof initOptions.bindCollapseAndTabSyncEvents, "function");
  assert.equal(typeof initOptions.syncSettingsSnapshot, "function");
  assert.equal(initOptions.syncSettingsLists, delegates.syncSettingsLists);
  assert.equal(initOptions.updateTemplateLengthHint, delegates.updateTemplateLengthHint);
  assert.equal(initOptions.loadDiagnosticsSummary, delegates.loadDiagnosticsSummary);
  assert.equal(initOptions.handlers.onSaveApiKeyAndSettings, delegates.saveApiKeyAndSettings);
  assert.equal(initOptions.handlers.onSavedAppsListClick, delegates.onSavedAppsListClick);
  assert.equal(initOptions.handlers.onTemplatesChanged, delegates.onTemplatesChanged);
  assert.equal(initOptions.handlers.onLoadDiagnosticsSummary, delegates.loadDiagnosticsSummary);

  initOptions.initializeCollapseState();
  initOptions.bindCollapseAndTabSyncEvents();
  initOptions.syncSettingsSnapshot();

  assert.equal(calls.collapseInit, 1);
  assert.equal(calls.collapseBind, 1);
  assert.equal(calls.editorSnapshot, 1);
  assert.equal(collapseOptions.syncSettingsLists, delegates.syncSettingsLists);
});
