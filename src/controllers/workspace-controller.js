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
const { createWorkspaceSettingsController } = require("./workspace/workspace-settings-controller");
const { createWorkspaceInitController } = require("./workspace/workspace-init-controller");
const { createWorkspaceLogController } = require("./workspace/workspace-log-controller");
const {
  createWorkspaceResetController,
  createWorkspaceResetBeforeInitParams
} = require("./workspace/workspace-reset-controller");
const {
  createWorkspaceStartupController,
  createWorkspaceStartupControllerOptions
} = require("./workspace/workspace-startup-controller");
const { createRunGuard } = require("../application/services/run-guard");
const { createJobScheduler, createJobExecutor } = require("../application/services/job-scheduler");
const { buildAppPickerViewModel } = require("../application/services/app-picker");
const {
  buildRunButtonViewModel,
  createRunButtonPhaseController
} = require("../application/services/run-button");
const { submitWorkspaceJobUsecase } = require("../application/usecases/submit-workspace-job");
const {
  hasLiveJobs,
  buildTaskSummaryViewModel
} = require("../application/services/task-summary");
const {
  normalizeUploadMaxEdge,
  normalizePasteStrategy,
  normalizeCloudConcurrentJobs,
  normalizeUploadRetryCount
} = require("../domain/policies/run-settings-policy");
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
let workspaceSettingsController = null;
let workspaceInitController = null;
let workspaceLogController = null;
const runGuard = createRunGuard({
  dedupWindowMs: RUN_DEDUP_WINDOW_MS,
  dedupCacheLimit: RUN_DEDUP_CACHE_LIMIT
});
const workspaceResetController = createWorkspaceResetController({
  clearInterval
});
let runButtonPhaseController = null;
let runStatusController = null;
let runWorkflowController = null;

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

function getWorkspaceSettingsController() {
  if (!workspaceSettingsController) {
    workspaceSettingsController = createWorkspaceSettingsController({
      dom,
      byId,
      store,
      runninghub,
      normalizePasteStrategy,
      normalizeUploadMaxEdge,
      normalizeCloudConcurrentJobs,
      normalizeUploadRetryCount,
      pasteStrategyLabels: PASTE_STRATEGY_LABELS,
      syncWorkspaceApps,
      log
    });
  }
  return workspaceSettingsController;
}

function getWorkspaceInitController() {
  if (!workspaceInitController) {
    workspaceInitController = createWorkspaceInitController({
      dom,
      byId,
      rebindEvent,
      appEvents: APP_EVENTS
    });
  }
  return workspaceInitController;
}

function getWorkspaceLogController() {
  if (!workspaceLogController) {
    workspaceLogController = createWorkspaceLogController({
      dom,
      byId,
      inputSchema,
      isPromptLikeInput,
      isEmptyValue
    });
  }
  return workspaceLogController;
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
  getWorkspaceLogController().log(msg, type);
}

function onClearLogClick() {
  getWorkspaceLogController().onClearLogClick();
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
      getLocalMaxConcurrentJobs: resolveLocalMaxConcurrentJobs,
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

function updateAccountStatus() {
  return getWorkspaceSettingsController().updateAccountStatus();
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

function resolveLocalMaxConcurrentJobs() {
  const settings = store && typeof store.getSettings === "function" ? store.getSettings() : {};
  return normalizeCloudConcurrentJobs(settings && settings.cloudConcurrentJobs, LOCAL_MAX_CONCURRENT_JOBS);
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
  getWorkspaceLogController().logPromptLengthsBeforeRun(appItem, inputValues, prefix);
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
  getWorkspaceSettingsController().onRefreshWorkspaceClick();
}

function onPasteStrategyChange(event) {
  getWorkspaceSettingsController().onPasteStrategyChange(event);
}

function onAppsChanged() {
  syncWorkspaceApps({ forceRerender: false });
}

function onTemplatesChanged() {
  getTemplatePickerController().onTemplatesChanged();
}

function onSettingsChanged() {
  getWorkspaceSettingsController().onSettingsChanged();
}

function createWorkspaceInitEventDelegates() {
  return {
    handleRun,
    openAppPickerModal,
    closeAppPickerModal,
    onAppPickerModalClick,
    handleAppPickerListClick,
    onAppPickerSearchInput,
    onRefreshWorkspaceClick,
    onPasteStrategyChange,
    closeTemplatePicker,
    onTemplateModalClick,
    handleTemplateListClick,
    onApplyTemplateSelectionClick,
    onClearLogClick,
    onAppsChanged,
    onTemplatesChanged,
    onSettingsChanged
  };
}

function resetWorkspaceInputsForInit() {
  workspaceInputs = null;
  getWorkspaceInputs();
}

function collectWorkspaceControllerRefs() {
  return {
    runButtonPhaseController,
    runStatusController,
    runWorkflowController,
    appPickerController,
    templatePickerController,
    workspaceSettingsController,
    workspaceInitController,
    workspaceLogController
  };
}

function resetWorkspaceControllersBeforeInit() {
  const resetParams = createWorkspaceResetBeforeInitParams({
    state,
    runGuard,
    runButtonPhaseEnum: RUN_BUTTON_PHASE,
    controllers: collectWorkspaceControllerRefs()
  });
  ({
    runButtonPhaseController,
    runStatusController,
    runWorkflowController,
    appPickerController,
    templatePickerController,
    workspaceSettingsController,
    workspaceInitController,
    workspaceLogController
  } = workspaceResetController.resetBeforeInit(resetParams));
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

  resetWorkspaceControllersBeforeInit();

  const startupControllerOptions = createWorkspaceStartupControllerOptions({
    getWorkspaceInitController,
    ensureRunButtonPhaseController: getRunButtonPhaseController,
    getTemplatePickerController,
    getWorkspaceSettingsController,
    resetWorkspaceInputs: resetWorkspaceInputsForInit,
    getWorkspaceEventDelegates: createWorkspaceInitEventDelegates,
    updateAccountStatus,
    syncWorkspaceApps,
    updateRunButtonUI,
    updateTaskStatusSummary
  });

  createWorkspaceStartupController(startupControllerOptions).runInitSequence();
  return workspaceGateway;
}

module.exports = { initWorkspaceController };
