const { createWorkspaceGateway } = require("../infrastructure/gateways/workspace-gateway");
const { escapeHtml, isPromptLikeInput, isEmptyValue } = require("../utils");
const { APP_EVENTS } = require("../events");
const { byId, encodeDataId, decodeDataId, getRenderedElementCount, rebindEvent } = require("../shared/dom-utils");
const inputSchema = require("../shared/input-schema");
const { createWorkspaceInputs } = require("./workspace/workspace-inputs");
const { renderAppPickerListHtml } = require("./workspace/app-picker-view");
const { renderTemplatePickerListHtml } = require("./workspace/template-picker-view");
const { renderTaskSummary } = require("./workspace/task-summary-view");
const { createAppPickerController } = require("./workspace/app-picker-controller");
const { createTemplatePickerController } = require("./workspace/template-picker-controller");
const { createRunStatusController } = require("./workspace/run-status-controller");
const { createRunWorkflowController } = require("./workspace/run-workflow-controller");
const {
  buildLogLine,
  renderLogLine,
  clearLogView
} = require("./workspace/log-view");
const { createRunGuard } = require("../application/services/run-guard");
const { createJobScheduler, createJobExecutor } = require("../application/services/job-scheduler");
const { buildAppPickerViewModel } = require("../application/services/app-picker");
const { buildPromptLengthLogSummary } = require("../application/services/prompt-log");
const {
  buildRunButtonViewModel,
  createRunButtonPhaseController
} = require("../application/services/run-button");
const { submitWorkspaceJobUsecase } = require("../application/usecases/submit-workspace-job");
const {
  hasLiveJobs,
  buildTaskSummaryViewModel
} = require("../application/services/task-summary");
const { normalizeUploadMaxEdge, normalizePasteStrategy } = require("../domain/policies/run-settings-policy");
const {
  cloneArrayBuffer,
  cloneBounds
} = require("../application/services/workspace-run-snapshot");
const {
  normalizeTemplatePickerConfig,
  sanitizeTemplateSelectionIds,
  toggleTemplateSelection: toggleTemplateSelectionState,
  buildSingleTemplateSelectionPayload,
  buildMultipleTemplateSelectionPayload,
  buildTemplatePickerUiState,
  buildTemplatePickerListViewModel
} = require("../application/services/template-picker");

let workspaceGateway = createWorkspaceGateway();
let store = workspaceGateway.store;
let runninghub = workspaceGateway.runninghub;
let ps = workspaceGateway.photoshop;

const dom = {};
const state = {
  currentApp: null,
  inputValues: {},
  imageBounds: {},
  jobs: [],
  nextJobSeq: 1,
  taskSummaryTimerId: null,
  appPickerKeyword: "",
  templateSelectCallback: null,
  templatePickerMode: "single",
  templatePickerMaxSelection: 1,
  templatePickerSelectedIds: [],
  runButtonPhase: "IDLE",
  runButtonTimerId: null,
  taskSummaryHintText: "",
  taskSummaryHintType: "info",
  taskSummaryHintUntil: 0,
  taskSummaryHintTimerId: null
};
const PASTE_STRATEGY_LABELS = {
  normal: "普通（居中铺满）",
  smart: "智能（主体对齐）",
  smartEnhanced: "智能增强（全局+局部补偿）"
};
const MAX_TEMPLATE_COMBINE_COUNT = 5;
const RH_PROMPT_MAX_CHARS = 4000;
const JOB_STATUS = {
  QUEUED: "QUEUED",
  SUBMITTING: "SUBMITTING",
  REMOTE_RUNNING: "REMOTE_RUNNING",
  DOWNLOADING: "DOWNLOADING",
  APPLYING: "APPLYING",
  TIMEOUT_TRACKING: "TIMEOUT_TRACKING",
  DONE: "DONE",
  FAILED: "FAILED"
};
const LOCAL_MAX_CONCURRENT_JOBS = 2;
const JOB_TIMEOUT_RETRY_DELAY_MS = 15000;
const JOB_MAX_TIMEOUT_RECOVERIES = 40;
const JOB_MAX_HISTORY = 120;
const RUN_BUTTON_PHASE = {
  IDLE: "IDLE",
  SUBMITTING_GUARD: "SUBMITTING_GUARD",
  SUBMITTED_ACK: "SUBMITTED_ACK"
};
const RUN_DOUBLE_CLICK_GUARD_MS = 450;
const RUN_SUBMITTING_MIN_MS = 1000;
const RUN_SUBMITTED_ACK_MS = 1000;
const RUN_DEDUP_WINDOW_MS = 800;
const RUN_DEDUP_CACHE_LIMIT = 80;
const RUN_SUMMARY_HINT_MS = 1800;

let workspaceInputs = null;
let appPickerController = null;
let templatePickerController = null;
const runGuard = createRunGuard({
  dedupWindowMs: RUN_DEDUP_WINDOW_MS,
  dedupCacheLimit: RUN_DEDUP_CACHE_LIMIT
});
let runButtonPhaseController = null;
let runStatusController = null;
let runWorkflowController = null;

function syncPasteStrategySelect() {
  const select = dom.pasteStrategySelect || byId("pasteStrategySelect");
  if (!select) return;
  const settings = store.getSettings();
  const pasteStrategy = normalizePasteStrategy(settings.pasteStrategy);
  const nextValue = String(pasteStrategy);
  if (select.value !== nextValue) select.value = nextValue;
}

function getWorkspaceInputs() {
  if (!workspaceInputs) {
    workspaceInputs = createWorkspaceInputs({
      state,
      dom,
      byId,
      ps,
      log,
      inputSchema,
      escapeHtml,
      isPromptLikeInput,
      isEmptyValue,
      getRenderedElementCount,
      updateCurrentAppMeta,
      updateRunButtonUI,
      openTemplatePicker
    });
  }
  return workspaceInputs;
}

function getTemplatePickerController() {
  if (!templatePickerController) {
    templatePickerController = createTemplatePickerController({
      state,
      dom,
      store,
      byId,
      decodeDataId,
      escapeHtml,
      encodeDataId,
      renderTemplatePickerListHtml,
      normalizeTemplatePickerConfig,
      toggleTemplateSelectionState,
      sanitizeTemplateSelectionIds,
      buildSingleTemplateSelectionPayload,
      buildMultipleTemplateSelectionPayload,
      buildTemplatePickerUiState,
      buildTemplatePickerListViewModel,
      maxTemplateCombineCount: MAX_TEMPLATE_COMBINE_COUNT,
      promptMaxChars: RH_PROMPT_MAX_CHARS,
      refreshModalOpenState,
      alert: typeof alert === "function" ? alert : () => {}
    });
  }
  return templatePickerController;
}

function log(msg, type = "info") {
  console.log(`[Workspace][${type}] ${msg}`);
  const logDiv = dom.logWindow || byId("logWindow");
  if (!logDiv) return;
  if (msg === "CLEAR") {
    clearLogView(logDiv);
    return;
  }
  const line = buildLogLine({ message: msg, type, now: new Date() });
  renderLogLine(logDiv, line);
}

function onClearLogClick() {
  log("CLEAR");
}

function getRunButtonPhaseController() {
  if (!runButtonPhaseController) {
    runButtonPhaseController = createRunButtonPhaseController({
      runGuard,
      runButtonPhaseEnum: RUN_BUTTON_PHASE,
      getPhase: () => state.runButtonPhase,
      setPhase: (nextPhase) => {
        state.runButtonPhase = nextPhase;
      },
      getTimerId: () => state.runButtonTimerId,
      setTimerId: (nextTimerId) => {
        state.runButtonTimerId = nextTimerId;
      },
      onPhaseUpdated: updateRunButtonUI,
      doubleClickGuardMs: RUN_DOUBLE_CLICK_GUARD_MS,
      submittingMinMs: RUN_SUBMITTING_MIN_MS,
      submittedAckMs: RUN_SUBMITTED_ACK_MS
    });
  }
  return runButtonPhaseController;
}

function getAppPickerController() {
  if (!appPickerController) {
    appPickerController = createAppPickerController({
      state,
      dom,
      store,
      byId,
      decodeDataId,
      escapeHtml,
      encodeDataId,
      renderAppPickerListHtml,
      buildAppPickerViewModel,
      renderDynamicInputs,
      updateCurrentAppMeta,
      updateRunButtonUI,
      refreshModalOpenState,
      alert: typeof alert === "function" ? alert : () => {}
    });
  }
  return appPickerController;
}

function getRunStatusController() {
  if (!runStatusController) {
    runStatusController = createRunStatusController({
      state,
      dom,
      byId,
      hasLiveJobs,
      buildTaskSummaryViewModel,
      renderTaskSummary,
      jobStatus: JOB_STATUS,
      runSummaryHintMs: RUN_SUMMARY_HINT_MS,
      maxHistory: JOB_MAX_HISTORY
    });
  }
  return runStatusController;
}

function getRunWorkflowController() {
  if (!runWorkflowController) {
    runWorkflowController = createRunWorkflowController({
      state,
      store,
      runGuard,
      getRunButtonPhaseController,
      runButtonPhaseEnum: RUN_BUTTON_PHASE,
      submitWorkspaceJobUsecase,
      resolveTargetBounds,
      resolveSourceImageBuffer,
      runninghub,
      ps,
      setJobStatus,
      cloneBounds,
      cloneArrayBuffer,
      createJobExecutor,
      createJobScheduler,
      updateTaskStatusSummary,
      pruneJobHistory,
      emitRunGuardFeedback,
      log,
      logPromptLengthsBeforeRun,
      onJobCompleted: () => {
        updateAccountStatus();
      },
      jobStatus: JOB_STATUS,
      localMaxConcurrentJobs: LOCAL_MAX_CONCURRENT_JOBS,
      timeoutRetryDelayMs: JOB_TIMEOUT_RETRY_DELAY_MS,
      maxTimeoutRecoveries: JOB_MAX_TIMEOUT_RECOVERIES,
      alert: typeof alert === "function" ? alert : () => {}
    });
  }
  return runWorkflowController;
}

function clearTaskSummaryHint() {
  getRunStatusController().clearTaskSummaryHint();
}

function setTaskSummaryHint(text, type = "info", ttlMs = RUN_SUMMARY_HINT_MS) {
  getRunStatusController().setTaskSummaryHint(text, type, ttlMs);
}

function updateTaskStatusSummary() {
  getRunStatusController().updateTaskStatusSummary();
}

function setJobStatus(job, status, reason = "") {
  getRunStatusController().setJobStatus(job, status, reason);
}

function pruneJobHistory() {
  getRunStatusController().pruneJobHistory();
}

function emitRunGuardFeedback(message, level = "info", ttlMs = RUN_SUMMARY_HINT_MS) {
  const text = String(message || "").trim();
  if (!text) return;
  const type = level === "warn" ? "warn" : "info";
  log(`[RunGuard] ${text}`, type);
  setTaskSummaryHint(`最近操作：${text}`, type, ttlMs);
}

function updateRunButtonUI() {
  const btn = dom.btnRun || byId("btnRun");
  if (!btn) return;

  const viewModel = buildRunButtonViewModel({
    currentApp: state.currentApp,
    runButtonPhase: state.runButtonPhase,
    runButtonPhaseEnum: RUN_BUTTON_PHASE
  });

  btn.classList.toggle("is-busy", !!viewModel.busy);
  btn.disabled = !!viewModel.disabled;
  btn.textContent = viewModel.text;
}

function updateCurrentAppMeta() {
  const metaEl = dom.appPickerMeta || byId("appPickerMeta");
  if (!metaEl) return;

  if (!state.currentApp) {
    metaEl.innerHTML = `<span class="placeholder-text">请选择应用</span>`;
    metaEl.title = "";
    return;
  }

  metaEl.innerHTML = escapeHtml(state.currentApp.name || "未命名应用");
  metaEl.title = String(state.currentApp.name || "");
}

async function updateAccountStatus() {
  const apiKey = store.getApiKey();
  const balanceEl = dom.accountBalanceValue || byId("accountBalanceValue");
  const coinsEl = dom.accountCoinsValue || byId("accountCoinsValue");
  const summaryEl = dom.accountSummary || byId("accountSummary");
  if (!balanceEl || !coinsEl) return;

  if (!apiKey) {
    if (summaryEl) summaryEl.classList.add("is-empty");
    balanceEl.textContent = "--";
    coinsEl.textContent = "--";
    return;
  }

  try {
    if (summaryEl) summaryEl.classList.remove("is-empty");
    balanceEl.textContent = "...";
    const status = await runninghub.fetchAccountStatus(apiKey);
    balanceEl.textContent = status.remainMoney || "0";
    coinsEl.textContent = status.remainCoins || "0";
  } catch (error) {
    console.error("获取账户信息失败", error);
  }
}

function renderDynamicInputs(appItem) {
  return getWorkspaceInputs().renderDynamicInputs(appItem);
}

function resolveTargetBounds() {
  return getWorkspaceInputs().resolveTargetBounds();
}

function resolveSourceImageBuffer() {
  return getWorkspaceInputs().resolveSourceImageBuffer();
}

function handleRun() {
  getRunWorkflowController().handleRun();
}

function closeAppPickerModal() {
  getAppPickerController().close();
}

function openAppPickerModal() {
  getAppPickerController().open();
}

function syncWorkspaceApps(options = {}) {
  getAppPickerController().sync(options);
}

function handleAppPickerListClick(event) {
  getAppPickerController().handleListClick(event);
}

function logPromptLengthsBeforeRun(appItem = state.currentApp, inputValues = state.inputValues, prefix = "") {
  const summary = buildPromptLengthLogSummary({
    appItem,
    inputValues,
    inputSchema,
    isPromptLikeInput,
    isEmptyValue,
    maxItems: 12
  });
  if (!summary) return;

  const head = prefix ? `${prefix} ` : "";
  log(`${head}Prompt length check before run: ${summary.totalPromptInputs} prompt input(s)`, "info");
  summary.entries.forEach((item) => {
    log(`${head}Input ${item.label} (${item.key}): length ${item.length}, tail ${item.tail}`, "info");
  });
  if (summary.hiddenCount > 0) {
    log(`${head}${summary.hiddenCount} additional prompt input(s) not expanded`, "info");
  }
}

function closeTemplatePicker() {
  getTemplatePickerController().close();
}

function openTemplatePicker(config = {}) {
  getTemplatePickerController().open(config);
}

function refreshModalOpenState() {
  const isOpen = Boolean(document.querySelector(".modal-overlay.active"));
  document.body.classList.toggle("modal-open", isOpen);
}

function handleTemplateListClick(event) {
  getTemplatePickerController().handleListClick(event);
}

function onAppPickerSearchInput() {
  getAppPickerController().onSearchInput();
}

function onAppPickerModalClick(event) {
  getAppPickerController().onModalClick(event);
}

function onTemplateModalClick(event) {
  getTemplatePickerController().onModalClick(event);
}

function onApplyTemplateSelectionClick() {
  getTemplatePickerController().onApplyButtonClick();
}

function onRefreshWorkspaceClick() {
  syncWorkspaceApps({ forceRerender: false });
  updateAccountStatus();
  log("应用列表已刷新", "info");
}

function onPasteStrategyChange(event) {
  const nextPasteStrategy = normalizePasteStrategy(event && event.target ? event.target.value : "");
  const settings = store.getSettings();
  const uploadMaxEdge = normalizeUploadMaxEdge(settings.uploadMaxEdge);
  store.saveSettings({
    pollInterval: settings.pollInterval,
    timeout: settings.timeout,
    uploadMaxEdge,
    pasteStrategy: nextPasteStrategy
  });
  const marker = PASTE_STRATEGY_LABELS[nextPasteStrategy] || nextPasteStrategy;
  log(`回贴策略已切换: ${marker}`, "info");
}

function bindWorkspaceEvents() {
  rebindEvent(dom.btnRun, "click", handleRun);
  rebindEvent(dom.btnOpenAppPicker, "click", openAppPickerModal);
  rebindEvent(dom.appPickerModalClose, "click", closeAppPickerModal);
  rebindEvent(dom.appPickerModal, "click", onAppPickerModalClick);
  rebindEvent(dom.appPickerList, "click", handleAppPickerListClick);
  rebindEvent(dom.appPickerSearchInput, "input", onAppPickerSearchInput);
  rebindEvent(dom.btnRefreshWorkspaceApps, "click", onRefreshWorkspaceClick);
  rebindEvent(dom.pasteStrategySelect, "change", onPasteStrategyChange);
  rebindEvent(dom.templateModalClose, "click", closeTemplatePicker);
  rebindEvent(dom.templateModal, "click", onTemplateModalClick);
  rebindEvent(dom.templateList, "click", handleTemplateListClick);
  rebindEvent(dom.btnApplyTemplateSelection, "click", onApplyTemplateSelectionClick);
  rebindEvent(dom.btnClearLog, "click", onClearLogClick);

  rebindEvent(document, APP_EVENTS.APPS_CHANGED, onAppsChanged);
  rebindEvent(document, APP_EVENTS.TEMPLATES_CHANGED, onTemplatesChanged);
  rebindEvent(document, APP_EVENTS.SETTINGS_CHANGED, onSettingsChanged);
}

function onAppsChanged() {
  syncWorkspaceApps({ forceRerender: false });
}

function onTemplatesChanged() {
  getTemplatePickerController().onTemplatesChanged();
}

function onSettingsChanged() {
  updateAccountStatus();
  syncPasteStrategySelect();
}

function cacheDomRefs() {
  const ids = [
    "btnRun",
    "btnOpenAppPicker",
    "btnRefreshWorkspaceApps",
    "pasteStrategySelect",
    "btnClearLog",
    "taskStatusSummary",
    "appPickerMeta",
    "dynamicInputContainer",
    "imageInputContainer",
    "logWindow",
    "appPickerModal",
    "appPickerModalClose",
    "appPickerSearchInput",
    "appPickerStats",
    "appPickerList",
    "templateModal",
    "templateModalTitle",
    "templateList",
    "templateModalActions",
    "templateModalSelectionInfo",
    "btnApplyTemplateSelection",
    "templateModalClose",
    "accountSummary",
    "accountBalanceValue",
    "accountCoinsValue"
  ];
  ids.forEach((id) => {
    dom[id] = byId(id);
  });
}

function resolveWorkspaceGateway(options = {}) {
  if (options && options.gateway && typeof options.gateway === "object") {
    return options.gateway;
  }
  return createWorkspaceGateway();
}

function initWorkspaceController(options = {}) {
  workspaceGateway = resolveWorkspaceGateway(options);
  store = workspaceGateway.store;
  runninghub = workspaceGateway.runninghub;
  ps = workspaceGateway.photoshop;

  if (runButtonPhaseController) {
    runButtonPhaseController.dispose();
    runButtonPhaseController = null;
  }
  state.runButtonTimerId = null;
  if (runStatusController) {
    runStatusController.dispose();
    runStatusController = null;
  }
  if (runWorkflowController) {
    runWorkflowController.dispose();
    runWorkflowController = null;
  }
  state.taskSummaryHintText = "";
  state.taskSummaryHintType = "info";
  state.taskSummaryHintUntil = 0;
  state.taskSummaryHintTimerId = null;
  if (state.taskSummaryTimerId) {
    clearInterval(state.taskSummaryTimerId);
    state.taskSummaryTimerId = null;
  }
  runGuard.reset();
  state.runButtonPhase = RUN_BUTTON_PHASE.IDLE;
  appPickerController = null;
  templatePickerController = null;

  cacheDomRefs();
  getRunButtonPhaseController();
  getTemplatePickerController().reset();
  syncPasteStrategySelect();
  workspaceInputs = null;
  getWorkspaceInputs();
  bindWorkspaceEvents();
  updateAccountStatus();
  syncWorkspaceApps({ forceRerender: true });
  updateRunButtonUI();
  updateTaskStatusSummary();

  return workspaceGateway;
}

module.exports = { initWorkspaceController };
