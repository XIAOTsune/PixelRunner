const SETTINGS_DOM_IDS = [
  "apiKeyInput",
  "pollIntervalInput",
  "timeoutInput",
  "cloudConcurrentJobsInput",
  "uploadMaxEdgeSettingSelect",
  "toggleApiKey",
  "btnSaveApiKey",
  "btnTestApiKey",
  "appIdInput",
  "appNameInput",
  "btnParseApp",
  "parseResultContainer",
  "savedAppsList",
  "templateTitleInput",
  "templateContentInput",
  "btnSaveTemplate",
  "btnExportTemplatesJson",
  "btnImportTemplatesJson",
  "savedTemplatesList",
  "templateLengthHint",
  "btnLoadDiagnosticsSummary",
  "envDoctorOutput",
  "advancedSettingsHeader",
  "advancedSettingsToggle",
  "advancedSettingsSection",
  "envDiagnosticsHeader",
  "envDiagnosticsToggle",
  "envDiagnosticsSection"
];

function createSettingsInitController(options = {}) {
  const dom = options.dom || {};
  const byId = typeof options.byId === "function" ? options.byId : () => null;
  const rebindEvent = typeof options.rebindEvent === "function" ? options.rebindEvent : () => {};
  const handlers = options.handlers || {};
  const appEvents = options.appEvents || {};
  const documentRef =
    options.documentRef || (typeof document !== "undefined" ? document : null);
  const initializeCollapseState =
    typeof options.initializeCollapseState === "function" ? options.initializeCollapseState : () => {};
  const bindCollapseAndTabSyncEvents =
    typeof options.bindCollapseAndTabSyncEvents === "function"
      ? options.bindCollapseAndTabSyncEvents
      : () => {};
  const syncSettingsSnapshot =
    typeof options.syncSettingsSnapshot === "function" ? options.syncSettingsSnapshot : () => {};
  const syncSettingsLists =
    typeof options.syncSettingsLists === "function" ? options.syncSettingsLists : () => {};
  const updateTemplateLengthHint =
    typeof options.updateTemplateLengthHint === "function" ? options.updateTemplateLengthHint : () => {};
  const loadDiagnosticsSummary =
    typeof options.loadDiagnosticsSummary === "function" ? options.loadDiagnosticsSummary : () => {};

  function collectDomRefs() {
    SETTINGS_DOM_IDS.forEach((id) => {
      dom[id] = byId(id);
    });
  }

  function bindCoreEvents() {
    rebindEvent(dom.btnSaveApiKey, "click", handlers.onSaveApiKeyAndSettings);
    rebindEvent(dom.btnTestApiKey, "click", handlers.onTestApiKey);
    rebindEvent(dom.btnParseApp, "click", handlers.onParseApp);
    rebindEvent(dom.toggleApiKey, "click", handlers.onToggleApiKey);
    rebindEvent(dom.btnSaveTemplate, "click", handlers.onSaveTemplate);
    rebindEvent(dom.btnExportTemplatesJson, "click", handlers.onExportTemplatesJson);
    rebindEvent(dom.btnImportTemplatesJson, "click", handlers.onImportTemplatesJson);
    rebindEvent(dom.btnLoadDiagnosticsSummary, "click", handlers.onLoadDiagnosticsSummary);
    rebindEvent(dom.templateTitleInput, "input", handlers.onUpdateTemplateLengthHint);
    rebindEvent(dom.templateContentInput, "input", handlers.onUpdateTemplateLengthHint);
    rebindEvent(dom.templateContentInput, "paste", handlers.onTemplateContentPaste);
    rebindEvent(dom.savedAppsList, "click", handlers.onSavedAppsListClick);
    rebindEvent(dom.savedTemplatesList, "click", handlers.onSavedTemplatesListClick);
    rebindEvent(documentRef, appEvents.APPS_CHANGED, handlers.onAppsChanged);
    rebindEvent(documentRef, appEvents.TEMPLATES_CHANGED, handlers.onTemplatesChanged);
    bindCollapseAndTabSyncEvents();
  }

  function initialize() {
    collectDomRefs();
    initializeCollapseState();
    syncSettingsSnapshot();
    bindCoreEvents();
    syncSettingsLists();
    updateTemplateLengthHint();
    loadDiagnosticsSummary();
  }

  return {
    collectDomRefs,
    bindCoreEvents,
    initialize
  };
}

module.exports = {
  SETTINGS_DOM_IDS,
  createSettingsInitController
};
