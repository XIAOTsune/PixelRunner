const { normalizeAppId, escapeHtml } = require("../utils");
const { APP_EVENTS, emitAppEvent } = require("../events");
const { DIAGNOSTIC_STORAGE_KEY } = require("../diagnostics/ps-env-doctor");
const { byId, findClosestByClass, encodeDataId, decodeDataId, rebindEvent } = require("../shared/dom-utils");
const textInputPolicy = require("../domain/policies/text-input-policy");
const {
  normalizeUploadMaxEdge,
  normalizeCloudConcurrentJobs
} = require("../domain/policies/run-settings-policy");
const { buildSavedAppsListViewModel, buildSavedTemplatesListViewModel } = require("../application/services/settings-lists");
const {
  buildParseSuccessViewModel,
  buildParseFailureViewModel,
  buildParseFailureDiagnostics
} = require("../application/services/settings-parse-result");
const {
  summarizeDiagnosticReport,
  summarizeParseDebugReport,
  loadStoredJsonReport
} = require("../application/services/settings-diagnostics");
const {
  buildTemplateLengthHintViewModel,
  getClipboardPlainText
} = require("../application/services/settings-template-editor");
const {
  loadSettingsSnapshotUsecase,
  getSavedApiKeyUsecase,
  testApiKeyUsecase,
  saveSettingsUsecase
} = require("../application/usecases/manage-settings");
const { parseRunninghubAppUsecase } = require("../application/usecases/parse-runninghub-app");
const {
  listSavedAppsUsecase,
  findSavedAppByIdUsecase,
  saveParsedAppUsecase,
  loadEditableAppUsecase,
  deleteAppUsecase
} = require("../application/usecases/manage-apps");
const { exportTemplatesJsonUsecase, importTemplatesJsonUsecase } = require("../application/usecases/manage-template-transfer");
const {
  listSavedTemplatesUsecase,
  findSavedTemplateByIdUsecase,
  saveTemplateUsecase,
  importTemplatesUsecase,
  loadEditableTemplateUsecase,
  deleteTemplateUsecase
} = require("../application/usecases/manage-templates");
const { createSettingsGateway } = require("../infrastructure/gateways/settings-gateway");
const { renderParseSuccessHtml, renderParseFailureHtml } = require("./settings/parse-result-view");
const { renderSavedAppsListHtml } = require("./settings/saved-apps-view");
const { renderSavedTemplatesListHtml } = require("./settings/saved-templates-view");
const { resolveSavedAppsListAction, resolveSavedTemplatesListAction } = require("./settings/settings-list-actions");
const { createSettingsListsController } = require("./settings/settings-lists-controller");
const {
  createSettingsDiagnosticsTransferController
} = require("./settings/settings-diagnostics-transfer-controller");
const { createSettingsEditorController } = require("./settings/settings-editor-controller");
const { createSettingsParseController } = require("./settings/settings-parse-controller");
const { createSettingsCollapseTabController } = require("./settings/settings-collapse-tab-controller");
const { createSettingsInitController } = require("./settings/settings-init-controller");
const { createSettingsSubcontrollersRegistry } = require("./settings/settings-subcontrollers-registry");
const { setEnvDoctorOutput, appendEnvDoctorOutput } = require("./settings/env-doctor-view");
const { renderTemplateLengthHint } = require("./settings/template-editor-view");
const { toggleSectionCollapse } = require("./settings/section-toggle-view");
const { safeConfirm } = require("./settings/safe-confirm");
let localFileSystem = null;
try {
  const { storage } = require("uxp");
  localFileSystem = storage && storage.localFileSystem;
} catch (_) {
  localFileSystem = null;
}

const PARSE_DEBUG_STORAGE_KEY = "rh_last_parse_debug";
const LARGE_PROMPT_WARNING_CHARS = textInputPolicy.LARGE_PROMPT_WARNING_CHARS;
const TEXT_INPUT_HARD_MAX_CHARS = textInputPolicy.TEXT_INPUT_HARD_MAX_CHARS;
const TEMPLATE_EXPORT_FILENAME_PREFIX = "pixelrunner_prompt_templates";
const dom = {};
let settingsGateway = createSettingsGateway();
let settingsSubcontrollersRegistry = null;

function log(msg) {
  console.log(`[Settings] ${msg}`);
}

const state = {
  parsedAppData: null,
  currentEditingAppId: null
};

function onToggleApiKey() {
  if (!dom.apiKeyInput) return;
  dom.apiKeyInput.type = dom.apiKeyInput.type === "password" ? "text" : "password";
}

function buildSettingsDelegates() {
  return {
    saveApiKeyAndSettings: () =>
      getSettingsSubcontrollersRegistry().getSettingsEditorController().saveApiKeyAndSettings(),
    testApiKey: () => getSettingsSubcontrollersRegistry().getSettingsEditorController().testApiKey(),
    parseApp: () => getSettingsSubcontrollersRegistry().getSettingsParseController().parseApp(),
    onToggleApiKey,
    saveTemplate: () => getSettingsSubcontrollersRegistry().getSettingsEditorController().saveTemplate(),
    exportTemplatesJson: () =>
      getSettingsSubcontrollersRegistry().getSettingsDiagnosticsTransferController().exportTemplatesJson(),
    importTemplatesJson: () =>
      getSettingsSubcontrollersRegistry().getSettingsDiagnosticsTransferController().importTemplatesJson(),
    loadDiagnosticsSummary: () =>
      getSettingsSubcontrollersRegistry().getSettingsDiagnosticsTransferController().loadDiagnosticsSummary(),
    updateTemplateLengthHint: () =>
      getSettingsSubcontrollersRegistry().getSettingsEditorController().updateTemplateLengthHint(),
    onTemplateContentPaste: (event) =>
      getSettingsSubcontrollersRegistry().getSettingsEditorController().onTemplateContentPaste(event),
    onSavedAppsListClick: (event) =>
      getSettingsSubcontrollersRegistry().getSettingsListsController().onSavedAppsListClick(event),
    onSavedTemplatesListClick: (event) =>
      getSettingsSubcontrollersRegistry().getSettingsListsController().onSavedTemplatesListClick(event),
    onAppsChanged: () => getSettingsSubcontrollersRegistry().getSettingsListsController().onAppsChanged(),
    onTemplatesChanged: () =>
      getSettingsSubcontrollersRegistry().getSettingsListsController().onTemplatesChanged(),
    renderSavedTemplates: () =>
      getSettingsSubcontrollersRegistry().getSettingsListsController().renderSavedTemplates(),
    renderSavedAppsList: () =>
      getSettingsSubcontrollersRegistry().getSettingsListsController().renderSavedAppsList(),
    syncSettingsLists: () => getSettingsSubcontrollersRegistry().getSettingsListsController().syncSettingsLists()
  };
}

function getSettingsSubcontrollersRegistry() {
  if (!settingsSubcontrollersRegistry) {
    settingsSubcontrollersRegistry = createSettingsSubcontrollersRegistry({
      state,
      dom,
      getStore: () => settingsGateway,
      appEvents: APP_EVENTS,
      emitAppEvent,
      byId,
      rebindEvent,
      toggleSectionCollapse,
      createSettingsListsController,
      createSettingsDiagnosticsTransferController,
      createSettingsParseController,
      createSettingsEditorController,
      createSettingsCollapseTabController,
      createSettingsInitController,
      listsDeps: {
        buildSavedAppsListViewModel,
        buildSavedTemplatesListViewModel,
        listSavedAppsUsecase,
        findSavedAppByIdUsecase,
        loadEditableAppUsecase,
        deleteAppUsecase,
        listSavedTemplatesUsecase,
        findSavedTemplateByIdUsecase,
        loadEditableTemplateUsecase,
        deleteTemplateUsecase,
        renderSavedAppsListHtml,
        renderSavedTemplatesListHtml,
        resolveSavedAppsListAction,
        resolveSavedTemplatesListAction,
        findClosestByClass,
        decodeDataId,
        escapeHtml,
        encodeDataId,
        appendEnvDoctorOutput,
        safeConfirm
      },
      diagnosticsTransferDeps: {
        summarizeDiagnosticReport,
        summarizeParseDebugReport,
        loadStoredJsonReport,
        diagnosticStorageKey: DIAGNOSTIC_STORAGE_KEY,
        parseDebugStorageKey: PARSE_DEBUG_STORAGE_KEY,
        setEnvDoctorOutput,
        appendEnvDoctorOutput,
        exportTemplatesJsonUsecase,
        importTemplatesJsonUsecase,
        importTemplatesUsecase,
        localFileSystem,
        filenamePrefix: TEMPLATE_EXPORT_FILENAME_PREFIX
      },
      parseDeps: {
        normalizeAppId,
        getSavedApiKeyUsecase,
        parseRunninghubAppUsecase,
        saveParsedAppUsecase,
        buildParseSuccessViewModel,
        buildParseFailureViewModel,
        buildParseFailureDiagnostics,
        renderParseSuccessHtml,
        renderParseFailureHtml,
        appendEnvDoctorOutput,
        byId,
        escapeHtml,
        reportError: (error) => {
          console.error(error);
        }
      },
      editorDeps: {
        loadSettingsSnapshotUsecase,
        saveSettingsUsecase,
        testApiKeyUsecase,
        saveTemplateUsecase,
        normalizeUploadMaxEdge,
        normalizeCloudConcurrentJobs,
        buildTemplateLengthHintViewModel,
        getClipboardPlainText,
        enforceLongTextCapacity: textInputPolicy.enforceLongTextCapacity,
        insertTextAtCursor: textInputPolicy.insertTextAtCursor,
        getTextLength: textInputPolicy.getTextLength,
        getTailPreview: textInputPolicy.getTailPreview,
        warningChars: LARGE_PROMPT_WARNING_CHARS,
        textInputHardMaxChars: TEXT_INPUT_HARD_MAX_CHARS,
        renderTemplateLengthHint
      },
      delegates: buildSettingsDelegates(),
      log,
      getAlert: () => (typeof alert === "function" ? alert : () => {})
    });
  }
  return settingsSubcontrollersRegistry;
}

function resolveSettingsGateway(options = {}) {
  if (options && options.gateway && typeof options.gateway === "object") {
    return options.gateway;
  }
  return createSettingsGateway();
}

function initSettingsController(options = {}) {
  settingsGateway = resolveSettingsGateway(options);
  settingsSubcontrollersRegistry = null;

  getSettingsSubcontrollersRegistry().getSettingsInitController().initialize();

  return settingsGateway;
}

module.exports = { initSettingsController };
