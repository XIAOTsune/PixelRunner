function noop() {}

function createSettingsSubcontrollersRegistry(options = {}) {
  const state = options.state || {};
  const dom = options.dom || {};
  const getStore =
    typeof options.getStore === "function" ? options.getStore : () => options.store || null;
  const appEvents = options.appEvents || {};
  const emitAppEvent =
    typeof options.emitAppEvent === "function" ? options.emitAppEvent : noop;
  const byId = typeof options.byId === "function" ? options.byId : () => null;
  const rebindEvent =
    typeof options.rebindEvent === "function" ? options.rebindEvent : noop;
  const toggleSectionCollapse =
    typeof options.toggleSectionCollapse === "function"
      ? options.toggleSectionCollapse
      : noop;
  const createSettingsListsController =
    typeof options.createSettingsListsController === "function"
      ? options.createSettingsListsController
      : () => ({});
  const createSettingsDiagnosticsTransferController =
    typeof options.createSettingsDiagnosticsTransferController === "function"
      ? options.createSettingsDiagnosticsTransferController
      : () => ({});
  const createSettingsParseController =
    typeof options.createSettingsParseController === "function"
      ? options.createSettingsParseController
      : () => ({});
  const createSettingsEditorController =
    typeof options.createSettingsEditorController === "function"
      ? options.createSettingsEditorController
      : () => ({});
  const createSettingsCollapseTabController =
    typeof options.createSettingsCollapseTabController === "function"
      ? options.createSettingsCollapseTabController
      : () => ({});
  const createSettingsInitController =
    typeof options.createSettingsInitController === "function"
      ? options.createSettingsInitController
      : () => ({});
  const listsDeps = options.listsDeps || {};
  const diagnosticsTransferDeps = options.diagnosticsTransferDeps || {};
  const parseDeps = options.parseDeps || {};
  const editorDeps = options.editorDeps || {};
  const delegates = options.delegates || {};
  const log = typeof options.log === "function" ? options.log : noop;
  const getAlert =
    typeof options.getAlert === "function"
      ? options.getAlert
      : () => (typeof alert === "function" ? alert : noop);

  let settingsListsController = null;
  let settingsDiagnosticsTransferController = null;
  let settingsParseController = null;
  let settingsEditorController = null;
  let settingsCollapseTabController = null;
  let settingsInitController = null;

  function resolveDelegate(name) {
    const delegate = delegates[name];
    return typeof delegate === "function" ? delegate : noop;
  }

  function resolveAlert() {
    const alertFn = getAlert();
    return typeof alertFn === "function" ? alertFn : noop;
  }

  function getSettingsListsController() {
    if (!settingsListsController) {
      settingsListsController = createSettingsListsController({
        state,
        dom,
        getStore,
        appEvents,
        emitAppEvent,
        ...listsDeps,
        updateTemplateLengthHint: resolveDelegate("updateTemplateLengthHint"),
        log,
        alert: resolveAlert()
      });
    }
    return settingsListsController;
  }

  function getSettingsDiagnosticsTransferController() {
    if (!settingsDiagnosticsTransferController) {
      settingsDiagnosticsTransferController = createSettingsDiagnosticsTransferController({
        dom,
        getStore,
        ...diagnosticsTransferDeps,
        emitTemplatesChanged: (payload) => {
          emitAppEvent(appEvents.TEMPLATES_CHANGED, payload);
        },
        renderSavedTemplates: resolveDelegate("renderSavedTemplates"),
        alert: resolveAlert()
      });
    }
    return settingsDiagnosticsTransferController;
  }

  function getSettingsParseController() {
    if (!settingsParseController) {
      settingsParseController = createSettingsParseController({
        state,
        dom,
        getStore,
        ...parseDeps,
        emitAppsChanged: (payload) => {
          emitAppEvent(appEvents.APPS_CHANGED, payload);
        },
        renderSavedAppsList: resolveDelegate("renderSavedAppsList"),
        log,
        alert: resolveAlert()
      });
    }
    return settingsParseController;
  }

  function getSettingsEditorController() {
    if (!settingsEditorController) {
      settingsEditorController = createSettingsEditorController({
        dom,
        getStore,
        ...editorDeps,
        emitSettingsChanged: (payload) => {
          emitAppEvent(appEvents.SETTINGS_CHANGED, payload);
        },
        emitTemplatesChanged: (payload) => {
          emitAppEvent(appEvents.TEMPLATES_CHANGED, payload);
        },
        renderSavedTemplates: resolveDelegate("renderSavedTemplates"),
        alert: resolveAlert()
      });
    }
    return settingsEditorController;
  }

  function getSettingsCollapseTabController() {
    if (!settingsCollapseTabController) {
      settingsCollapseTabController = createSettingsCollapseTabController({
        dom,
        byId,
        rebindEvent,
        toggleSectionCollapse,
        syncSettingsLists: resolveDelegate("syncSettingsLists")
      });
    }
    return settingsCollapseTabController;
  }

  function getSettingsInitController() {
    if (!settingsInitController) {
      settingsInitController = createSettingsInitController({
        dom,
        byId,
        rebindEvent,
        appEvents,
        initializeCollapseState: () => {
          getSettingsCollapseTabController().initializeSectionCollapseState();
        },
        bindCollapseAndTabSyncEvents: () => {
          getSettingsCollapseTabController().bindCollapseAndTabSyncEvents();
        },
        syncSettingsSnapshot: () => {
          getSettingsEditorController().syncSettingsSnapshot();
        },
        syncSettingsLists: resolveDelegate("syncSettingsLists"),
        updateTemplateLengthHint: resolveDelegate("updateTemplateLengthHint"),
        loadDiagnosticsSummary: resolveDelegate("loadDiagnosticsSummary"),
        handlers: {
          onSaveApiKeyAndSettings: resolveDelegate("saveApiKeyAndSettings"),
          onTestApiKey: resolveDelegate("testApiKey"),
          onParseApp: resolveDelegate("parseApp"),
          onToggleApiKey: resolveDelegate("onToggleApiKey"),
          onSaveTemplate: resolveDelegate("saveTemplate"),
          onExportTemplatesJson: resolveDelegate("exportTemplatesJson"),
          onImportTemplatesJson: resolveDelegate("importTemplatesJson"),
          onLoadDiagnosticsSummary: resolveDelegate("loadDiagnosticsSummary"),
          onUpdateTemplateLengthHint: resolveDelegate("updateTemplateLengthHint"),
          onTemplateContentPaste: resolveDelegate("onTemplateContentPaste"),
          onSavedAppsListClick: resolveDelegate("onSavedAppsListClick"),
          onSavedTemplatesListClick: resolveDelegate("onSavedTemplatesListClick"),
          onAppsChanged: resolveDelegate("onAppsChanged"),
          onTemplatesChanged: resolveDelegate("onTemplatesChanged")
        }
      });
    }
    return settingsInitController;
  }

  function reset() {
    settingsListsController = null;
    settingsDiagnosticsTransferController = null;
    settingsParseController = null;
    settingsEditorController = null;
    settingsCollapseTabController = null;
    settingsInitController = null;
  }

  return {
    reset,
    getSettingsListsController,
    getSettingsDiagnosticsTransferController,
    getSettingsParseController,
    getSettingsEditorController,
    getSettingsCollapseTabController,
    getSettingsInitController
  };
}

module.exports = {
  createSettingsSubcontrollersRegistry
};
