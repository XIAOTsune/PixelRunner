const { normalizeAppId, escapeHtml } = require("../utils");
const { APP_EVENTS, emitAppEvent } = require("../events");
const { runPsEnvironmentDoctor, DIAGNOSTIC_STORAGE_KEY } = require("../diagnostics/ps-env-doctor");
const { byId, findClosestByClass, encodeDataId, decodeDataId, rebindEvent } = require("../shared/dom-utils");
const textInputPolicy = require("../domain/policies/text-input-policy");
const { normalizeUploadMaxEdge } = require("../domain/policies/run-settings-policy");
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

function log(msg) {
  console.log(`[Settings] ${msg}`);
}

const state = {
  parsedAppData: null,
  currentEditingAppId: null
};

async function runEnvironmentDoctorManual() {
  if (!dom.btnRunEnvDoctor) return;
  dom.btnRunEnvDoctor.disabled = true;
  dom.btnRunEnvDoctor.textContent = "检测中...";
  setEnvDoctorOutput(dom.envDoctorOutput, "正在执行环境检测，请稍候...");

  try {
    const report = await runPsEnvironmentDoctor({ stage: "manual-settings" });
    setEnvDoctorOutput(dom.envDoctorOutput, summarizeDiagnosticReport(report));
  } catch (error) {
    const message = error && error.message ? error.message : String(error || "未知错误");
    setEnvDoctorOutput(dom.envDoctorOutput, `环境检测失败: ${message}`);
  } finally {
    dom.btnRunEnvDoctor.disabled = false;
    dom.btnRunEnvDoctor.textContent = "运行环境检测";
  }
}

function loadLatestDiagnosticReport() {
  const report = loadStoredJsonReport(settingsGateway.getStorage(), DIAGNOSTIC_STORAGE_KEY);

  if (!report) {
    setEnvDoctorOutput(dom.envDoctorOutput, "未找到最近报告，请先点击“运行环境检测”。");
    return;
  }

  setEnvDoctorOutput(dom.envDoctorOutput, summarizeDiagnosticReport(report));
}

function loadParseDebugReport() {
  const report = loadStoredJsonReport(settingsGateway.getStorage(), PARSE_DEBUG_STORAGE_KEY);

  if (!report) {
    setEnvDoctorOutput(dom.envDoctorOutput, "No parse debug found. Parse and save an app first, then click this button again.");
    return;
  }

  setEnvDoctorOutput(dom.envDoctorOutput, summarizeParseDebugReport(report));
}

function enforceLongTextCapacity(inputEl) {
  textInputPolicy.enforceLongTextCapacity(inputEl, TEXT_INPUT_HARD_MAX_CHARS);
}

function insertTextAtCursor(inputEl, rawText) {
  textInputPolicy.insertTextAtCursor(inputEl, rawText);
}

function updateTemplateLengthHint() {
  if (!dom.templateLengthHint) return;
  const viewModel = buildTemplateLengthHintViewModel({
    title: dom.templateTitleInput && dom.templateTitleInput.value,
    content: dom.templateContentInput && dom.templateContentInput.value,
    warningChars: LARGE_PROMPT_WARNING_CHARS,
    getTextLength: textInputPolicy.getTextLength,
    getTailPreview: textInputPolicy.getTailPreview
  });
  renderTemplateLengthHint(dom.templateLengthHint, viewModel);
}

function onTemplateContentPaste(event) {
  const clipboardText = getClipboardPlainText(event);
  if (!clipboardText || !dom.templateContentInput) return;
  event.preventDefault();
  insertTextAtCursor(dom.templateContentInput, clipboardText);
  updateTemplateLengthHint();
}

function saveApiKeyAndSettings() {
  const apiKey = String(dom.apiKeyInput.value || "").trim();
  const pollInterval = Number(dom.pollIntervalInput.value) || 2;
  const timeout = Number(dom.timeoutInput.value) || 180;
  const currentSettings = loadSettingsSnapshotUsecase({ store: settingsGateway });
  const uploadMaxEdge = normalizeUploadMaxEdge(
    dom.uploadMaxEdgeSettingSelect ? dom.uploadMaxEdgeSettingSelect.value : currentSettings.uploadMaxEdge
  );

  const payload = saveSettingsUsecase({
    store: settingsGateway,
    apiKey,
    pollInterval,
    timeout,
    uploadMaxEdge,
    pasteStrategy: currentSettings.pasteStrategy
  });
  emitAppEvent(APP_EVENTS.SETTINGS_CHANGED, payload);
  alert("设置已保存");
}

async function testApiKey() {
  const apiKey = String(dom.apiKeyInput.value || "").trim();
  if (!apiKey) {
    alert("请输入 API Key");
    return;
  }
  dom.btnTestApiKey.textContent = "测试中...";
  try {
    const result = await testApiKeyUsecase({
      runninghub: settingsGateway,
      apiKey
    });
    alert(result.message);
  } catch (error) {
    alert(`测试出错: ${error.message}`);
  } finally {
    dom.btnTestApiKey.textContent = "测试连接";
  }
}

async function parseApp() {
  const apiKey = getSavedApiKeyUsecase({ store: settingsGateway });
  const appId = normalizeAppId(dom.appIdInput.value);

  if (!appId) {
    alert("请输入有效的应用 ID 或 URL");
    return;
  }
  if (!apiKey) {
    alert("请先保存 API Key");
    return;
  }
  dom.btnParseApp.disabled = true;
  dom.btnParseApp.textContent = "解析中...";

  try {
    dom.appIdInput.value = appId;
    state.parsedAppData = await parseRunninghubAppUsecase({
      runninghub: settingsGateway,
      appId,
      apiKey,
      preferredName: dom.appNameInput.value.trim(),
      log
    });
    renderParseResult(state.parsedAppData);
  } catch (error) {
    console.error(error);
    showParseFailure(error);
    const diagnosticLines = buildParseFailureDiagnostics(error);
    diagnosticLines.forEach((line) => appendEnvDoctorOutput(dom.envDoctorOutput, line));
  } finally {
    dom.btnParseApp.disabled = false;
    dom.btnParseApp.textContent = "解析";
  }
}

function renderParseResult(data) {
  const viewModel = buildParseSuccessViewModel(data);
  dom.parseResultContainer.innerHTML = renderParseSuccessHtml(viewModel, {
    escapeHtml
  });

  const saveBtn = byId("btnSaveParsedApp");
  if (saveBtn) saveBtn.addEventListener("click", saveParsedApp);
}

function saveParsedApp() {
  if (!state.parsedAppData) return;
  const payload = saveParsedAppUsecase({
    store: settingsGateway,
    parsedAppData: state.parsedAppData
  });
  emitAppEvent(APP_EVENTS.APPS_CHANGED, payload);
  alert("应用已保存");

  clearAppEditorUI();
  renderSavedAppsList();
}

function showParseFailure(errorOrMessage) {
  const viewModel = buildParseFailureViewModel(errorOrMessage);
  dom.parseResultContainer.innerHTML = renderParseFailureHtml(viewModel, {
    escapeHtml
  });
}

function renderSavedAppsList() {
  const viewModel = buildSavedAppsListViewModel(
    listSavedAppsUsecase({
      store: settingsGateway
    })
  );
  dom.savedAppsList.innerHTML = renderSavedAppsListHtml(viewModel, {
    escapeHtml,
    encodeDataId
  });
}

function saveTemplate() {
  try {
    const result = saveTemplateUsecase({
      store: settingsGateway,
      title: String(dom.templateTitleInput.value || ""),
      content: String(dom.templateContentInput.value || "")
    });
    emitAppEvent(APP_EVENTS.TEMPLATES_CHANGED, { reason: result.reason });
    dom.templateTitleInput.value = "";
    dom.templateContentInput.value = "";
    updateTemplateLengthHint();
    renderSavedTemplates();
  } catch (error) {
    alert(error && error.message ? error.message : String(error || "unknown"));
  }
}

async function exportTemplatesJson() {
  try {
    const exportResult = await exportTemplatesJsonUsecase({
      localFileSystem,
      store: settingsGateway,
      filenamePrefix: TEMPLATE_EXPORT_FILENAME_PREFIX
    });
    if (exportResult.outcome === "unsupported") {
      alert("Current environment does not support file export");
      return;
    }
    if (exportResult.outcome === "cancelled") return;

    appendEnvDoctorOutput(dom.envDoctorOutput, `Template export success: ${exportResult.savedPath}`);
    alert(`Template export completed: ${exportResult.total} template(s)`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error || "unknown");
    appendEnvDoctorOutput(dom.envDoctorOutput, `Template export failed: ${message}`);
    alert(`Template export failed: ${message}`);
  }
}

async function importTemplatesJson() {
  try {
    const importResult = await importTemplatesJsonUsecase({
      localFileSystem,
      store: settingsGateway,
      importTemplates: importTemplatesUsecase
    });
    if (importResult.outcome === "unsupported") {
      alert("Current environment does not support file import");
      return;
    }
    if (importResult.outcome === "cancelled") return;

    emitAppEvent(APP_EVENTS.TEMPLATES_CHANGED, {
      reason: importResult.reason,
      added: importResult.added,
      replaced: importResult.replaced,
      total: importResult.total
    });
    renderSavedTemplates();
    appendEnvDoctorOutput(
      dom.envDoctorOutput,
      `Template import success: total=${importResult.total}, added=${importResult.added}, replaced=${importResult.replaced}`
    );
    alert(
      `Template import completed: added ${importResult.added}, replaced ${importResult.replaced}, total ${importResult.total}`
    );
  } catch (error) {
    const message = error && error.message ? error.message : String(error || "unknown");
    appendEnvDoctorOutput(dom.envDoctorOutput, `Template import failed: ${message}`);
    alert(`Template import failed: ${message}`);
  }
}

function renderSavedTemplates() {
  const viewModel = buildSavedTemplatesListViewModel(
    listSavedTemplatesUsecase({
      store: settingsGateway
    })
  );
  dom.savedTemplatesList.innerHTML = renderSavedTemplatesListHtml(viewModel, {
    escapeHtml,
    encodeDataId
  });
}

function onSavedAppsListClick(event) {
  const action = resolveSavedAppsListAction(event, {
    container: dom.savedAppsList,
    findClosestByClass,
    decodeDataId
  });
  if (action.kind === "none") return;

  if (action.kind === "edit-app") {
    const id = action.id;
    const app = findSavedAppByIdUsecase({
      store: settingsGateway,
      id
    });
    const editable = loadEditableAppUsecase({ app });
    if (!editable.found) {
      alert("未找到应用记录");
      return;
    }
    dom.appIdInput.value = editable.appId;
    dom.appNameInput.value = editable.appName;
    state.currentEditingAppId = editable.currentEditingAppId;
    state.parsedAppData = editable.parsedAppData;
    dom.parseResultContainer.innerHTML = `<div style="color:#aaa; font-size:11px; margin:6px 0;">已载入应用，点击“解析”重新拉取参数后保存。</div>`;
    return;
  }

  const id = action.id;
  if (!id) {
    appendEnvDoctorOutput(dom.envDoctorOutput, "Delete app failed: missing app id in clicked row.");
    alert("删除失败：未找到应用 ID");
    return;
  }

  if (!safeConfirm("删除此应用？", { log })) return;

  const result = deleteAppUsecase({
    store: settingsGateway,
    id
  });
  if (!result.deleted) {
    appendEnvDoctorOutput(dom.envDoctorOutput, `Delete app not found: id=${id}`);
    alert("应用不存在或已被删除");
  } else {
    appendEnvDoctorOutput(dom.envDoctorOutput, `Delete app success: id=${id}`);
    emitAppEvent(APP_EVENTS.APPS_CHANGED, { reason: "deleted", id });
  }

  renderSavedAppsList();
}

function onSavedTemplatesListClick(event) {
  const action = resolveSavedTemplatesListAction(event, {
    container: dom.savedTemplatesList,
    decodeDataId
  });
  if (action.kind === "none") return;

  if (action.kind === "edit-template") {
    const id = action.id;
    const template = findSavedTemplateByIdUsecase({
      store: settingsGateway,
      id
    });
    const editable = loadEditableTemplateUsecase({ template });
    if (!editable.found) {
      alert("未找到模板记录");
      return;
    }
    dom.templateTitleInput.value = editable.title;
    dom.templateContentInput.value = editable.content;
    updateTemplateLengthHint();
    return;
  }

  const id = action.id;
  if (!id) {
    appendEnvDoctorOutput(dom.envDoctorOutput, "Delete template failed: missing template id.");
    return;
  }

  if (!safeConfirm("删除此模板？", { log })) return;

  const result = deleteTemplateUsecase({
    store: settingsGateway,
    id
  });
  if (!result.deleted) {
    appendEnvDoctorOutput(dom.envDoctorOutput, `Delete template not found: id=${id}`);
    alert("模板不存在或已被删除");
  } else {
    appendEnvDoctorOutput(dom.envDoctorOutput, `Delete template success: id=${id}`);
    emitAppEvent(APP_EVENTS.TEMPLATES_CHANGED, { reason: "deleted", id });
  }

  renderSavedTemplates();
}

function clearAppEditorUI() {
  dom.appIdInput.value = "";
  dom.appNameInput.value = "";
  dom.parseResultContainer.innerHTML = "";

  state.parsedAppData = null;
  state.currentEditingAppId = null;
}

function syncSettingsLists() {
  renderSavedAppsList();
  renderSavedTemplates();
}

function onAppsChanged() {
  renderSavedAppsList();
}

function onTemplatesChanged() {
  renderSavedTemplates();
}

function onToggleApiKey() {
  if (!dom.apiKeyInput) return;
  dom.apiKeyInput.type = dom.apiKeyInput.type === "password" ? "text" : "password";
}

function onAdvancedSettingsToggleClick() {
  toggleSectionCollapse(dom.advancedSettingsSection, dom.advancedSettingsToggle, {
    collapsedClass: "is-collapsed",
    expandText: "展开",
    collapseText: "收起"
  });
}

function onEnvDiagnosticsToggleClick() {
  toggleSectionCollapse(dom.envDiagnosticsSection, dom.envDiagnosticsToggle, {
    collapsedClass: "is-collapsed",
    expandText: "展开",
    collapseText: "收起"
  });
}

function resolveSettingsGateway(options = {}) {
  if (options && options.gateway && typeof options.gateway === "object") {
    return options.gateway;
  }
  return createSettingsGateway();
}

function initSettingsController(options = {}) {
  settingsGateway = resolveSettingsGateway(options);

  const ids = [
    "apiKeyInput",
    "pollIntervalInput",
    "timeoutInput",
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
    "btnRunEnvDoctor",
    "btnLoadLatestDiag",
    "btnLoadParseDebug",
    "envDoctorOutput",
    "advancedSettingsHeader",
    "advancedSettingsToggle",
    "advancedSettingsSection",
    "envDiagnosticsHeader",
    "envDiagnosticsToggle",
    "envDiagnosticsSection"
  ];

  ids.forEach((id) => {
    dom[id] = byId(id);
  });

  if (dom.advancedSettingsSection) {
    dom.advancedSettingsSection.classList.add("is-collapsed");
  }
  if (dom.advancedSettingsToggle) {
    dom.advancedSettingsToggle.textContent = "展开";
  }
  if (dom.envDiagnosticsSection) {
    dom.envDiagnosticsSection.classList.add("is-collapsed");
  }
  if (dom.envDiagnosticsToggle) {
    dom.envDiagnosticsToggle.textContent = "展开";
  }

  const settingsSnapshot = loadSettingsSnapshotUsecase({ store: settingsGateway });
  dom.apiKeyInput.value = settingsSnapshot.apiKey;
  dom.pollIntervalInput.value = settingsSnapshot.pollInterval;
  dom.timeoutInput.value = settingsSnapshot.timeout;
  if (dom.uploadMaxEdgeSettingSelect) {
    dom.uploadMaxEdgeSettingSelect.value = String(normalizeUploadMaxEdge(settingsSnapshot.uploadMaxEdge));
  }
  enforceLongTextCapacity(dom.templateContentInput);

  rebindEvent(dom.btnSaveApiKey, "click", saveApiKeyAndSettings);
  rebindEvent(dom.btnTestApiKey, "click", testApiKey);
  rebindEvent(dom.btnParseApp, "click", parseApp);
  rebindEvent(dom.toggleApiKey, "click", onToggleApiKey);
  rebindEvent(dom.btnSaveTemplate, "click", saveTemplate);
  rebindEvent(dom.btnExportTemplatesJson, "click", exportTemplatesJson);
  rebindEvent(dom.btnImportTemplatesJson, "click", importTemplatesJson);
  rebindEvent(dom.btnRunEnvDoctor, "click", runEnvironmentDoctorManual);
  rebindEvent(dom.btnLoadLatestDiag, "click", loadLatestDiagnosticReport);
  rebindEvent(dom.btnLoadParseDebug, "click", loadParseDebugReport);
  rebindEvent(dom.templateTitleInput, "input", updateTemplateLengthHint);
  rebindEvent(dom.templateContentInput, "input", updateTemplateLengthHint);
  rebindEvent(dom.templateContentInput, "paste", onTemplateContentPaste);
  rebindEvent(dom.savedAppsList, "click", onSavedAppsListClick);
  rebindEvent(dom.envDiagnosticsHeader, "click", onEnvDiagnosticsToggleClick);
  rebindEvent(dom.savedTemplatesList, "click", onSavedTemplatesListClick);
  rebindEvent(document, APP_EVENTS.APPS_CHANGED, onAppsChanged);
  rebindEvent(document, APP_EVENTS.TEMPLATES_CHANGED, onTemplatesChanged);

  const tabSettings = byId("tabSettings");
  rebindEvent(tabSettings, "click", syncSettingsLists);
  rebindEvent(dom.advancedSettingsHeader, "click", onAdvancedSettingsToggleClick);

  syncSettingsLists();
  updateTemplateLengthHint();
  loadLatestDiagnosticReport();

  return settingsGateway;
}

module.exports = { initSettingsController };
