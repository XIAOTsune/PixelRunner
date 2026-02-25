const { createWorkspaceGateway } = require("../infrastructure/gateways/workspace-gateway");
const { escapeHtml, isPromptLikeInput, isEmptyValue } = require("../utils");
const { APP_EVENTS } = require("../events");
const { byId, encodeDataId, decodeDataId, getRenderedElementCount, rebindEvent } = require("../shared/dom-utils");
const inputSchema = require("../shared/input-schema");
const { createWorkspaceInputs } = require("./workspace/workspace-inputs");
const { renderAppPickerListHtml } = require("./workspace/app-picker-view");
const { renderTemplatePickerListHtml } = require("./workspace/template-picker-view");
const { renderTaskSummary } = require("./workspace/task-summary-view");
const { createTemplatePickerController } = require("./workspace/template-picker-controller");
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

const REQUEST_TIMEOUT_ERROR_CODE = "REQUEST_TIMEOUT";

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
let templatePickerController = null;
const runGuard = createRunGuard({
  dedupWindowMs: RUN_DEDUP_WINDOW_MS,
  dedupCacheLimit: RUN_DEDUP_CACHE_LIMIT
});
let jobExecutor = null;
let jobScheduler = null;
let runButtonPhaseController = null;

function getJobTag(job) {
  if (!job) return "Job:-";
  return `Job:${job.jobId}`;
}

function isJobTimeoutLikeError(error) {
  if (error && error.code === REQUEST_TIMEOUT_ERROR_CODE) return true;
  const message = String((error && error.message) || error || "").toLowerCase();
  return /timeout|超时/.test(message);
}

function createJobScopedLogger(job) {
  return (msg, type = "info") => {
    log(`[${getJobTag(job)}] ${String(msg || "")}`, type);
  };
}

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

function getApps() {
  return store.getAiApps().filter((app) => app && typeof app === "object");
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

function clearTaskSummaryHint() {
  if (state.taskSummaryHintTimerId) {
    clearTimeout(state.taskSummaryHintTimerId);
    state.taskSummaryHintTimerId = null;
  }
  state.taskSummaryHintText = "";
  state.taskSummaryHintType = "info";
  state.taskSummaryHintUntil = 0;
}

function setTaskSummaryHint(text, type = "info", ttlMs = RUN_SUMMARY_HINT_MS) {
  const hintText = String(text || "").trim();
  if (!hintText) {
    clearTaskSummaryHint();
    updateTaskStatusSummary();
    return;
  }

  const safeTtl = Math.max(300, Number(ttlMs) || RUN_SUMMARY_HINT_MS);
  state.taskSummaryHintText = hintText;
  state.taskSummaryHintType = type === "warn" ? "warn" : "info";
  state.taskSummaryHintUntil = Date.now() + safeTtl;
  if (state.taskSummaryHintTimerId) clearTimeout(state.taskSummaryHintTimerId);
  state.taskSummaryHintTimerId = setTimeout(() => {
    clearTaskSummaryHint();
    updateTaskStatusSummary();
  }, safeTtl + 20);
  updateTaskStatusSummary();
}

function getActiveTaskSummaryHint(now = Date.now()) {
  const hintText = String(state.taskSummaryHintText || "").trim();
  if (!hintText) return null;
  const expiresAt = Number(state.taskSummaryHintUntil || 0);
  if (expiresAt > 0 && expiresAt <= now) {
    clearTaskSummaryHint();
    return null;
  }
  return {
    text: hintText,
    type: state.taskSummaryHintType === "warn" ? "warn" : "info"
  };
}

function emitRunGuardFeedback(message, level = "info", ttlMs = RUN_SUMMARY_HINT_MS) {
  const text = String(message || "").trim();
  if (!text) return;
  const type = level === "warn" ? "warn" : "info";
  log(`[RunGuard] ${text}`, type);
  setTaskSummaryHint(`最近操作：${text}`, type, ttlMs);
}

function ensureJobServices() {
  if (!jobExecutor) {
    jobExecutor = createJobExecutor({
      runninghub,
      ps,
      setJobStatus,
      createJobLogger: createJobScopedLogger,
      cloneBounds,
      cloneArrayBuffer,
      isJobTimeoutLikeError,
      onJobCompleted: () => {
        updateAccountStatus();
      },
      jobStatus: JOB_STATUS,
      timeoutRetryDelayMs: JOB_TIMEOUT_RETRY_DELAY_MS,
      maxTimeoutRecoveries: JOB_MAX_TIMEOUT_RECOVERIES
    });
  }

  if (!jobScheduler) {
    jobScheduler = createJobScheduler({
      getJobs: () => state.jobs,
      maxConcurrent: LOCAL_MAX_CONCURRENT_JOBS,
      executeJob: (job) => jobExecutor.execute(job),
      runnableStatuses: [JOB_STATUS.QUEUED, JOB_STATUS.TIMEOUT_TRACKING],
      onRunningCountChange: () => {
        updateTaskStatusSummary();
      },
      onJobExecutionError: (job, error) => {
        const message = error && error.message ? error.message : String(error || "unknown error");
        setJobStatus(job, JOB_STATUS.FAILED, message);
        createJobScopedLogger(job)(`任务失败: ${message}`, "error");
      },
      onJobSettled: () => {
        pruneJobHistory();
        updateTaskStatusSummary();
      }
    });
  }
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

function getJobStatusLabel(status) {
  if (status === JOB_STATUS.QUEUED) return "排队";
  if (status === JOB_STATUS.SUBMITTING) return "提交";
  if (status === JOB_STATUS.REMOTE_RUNNING) return "运行";
  if (status === JOB_STATUS.DOWNLOADING) return "下载";
  if (status === JOB_STATUS.APPLYING) return "回贴";
  if (status === JOB_STATUS.TIMEOUT_TRACKING) return "超时跟踪";
  if (status === JOB_STATUS.DONE) return "完成";
  if (status === JOB_STATUS.FAILED) return "失败";
  return status || "-";
}

function syncTaskSummaryTicker() {
  if (hasLiveJobs(state.jobs, JOB_STATUS)) {
    if (state.taskSummaryTimerId) return;
    state.taskSummaryTimerId = setInterval(() => {
      updateTaskStatusSummary();
    }, 100);
    return;
  }
  if (state.taskSummaryTimerId) {
    clearInterval(state.taskSummaryTimerId);
    state.taskSummaryTimerId = null;
  }
}

function updateTaskStatusSummary() {
  const summaryEl = dom.taskStatusSummary || byId("taskStatusSummary");
  if (!summaryEl) return;
  const now = Date.now();
  const hint = getActiveTaskSummaryHint(now);
  const viewModel = buildTaskSummaryViewModel({
    jobs: state.jobs,
    hint,
    now,
    jobStatus: JOB_STATUS,
    activeLimit: 6,
    previewLimit: 8,
    resolveJobStatusLabel: getJobStatusLabel
  });
  renderTaskSummary(summaryEl, viewModel);
  syncTaskSummaryTicker();
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

function setJobStatus(job, status, reason = "") {
  if (!job) return;
  job.status = status;
  job.statusReason = String(reason || "");
  job.updatedAt = Date.now();
  updateTaskStatusSummary();
}

function pruneJobHistory() {
  if (!Array.isArray(state.jobs) || state.jobs.length <= JOB_MAX_HISTORY) return;
  const active = state.jobs.filter((job) =>
    [JOB_STATUS.QUEUED, JOB_STATUS.SUBMITTING, JOB_STATUS.REMOTE_RUNNING, JOB_STATUS.DOWNLOADING, JOB_STATUS.APPLYING, JOB_STATUS.TIMEOUT_TRACKING].includes(job.status)
  );
  const finished = state.jobs
    .filter((job) => !active.includes(job))
    .slice(0, Math.max(0, JOB_MAX_HISTORY - active.length));
  state.jobs = [...active, ...finished].sort((a, b) => b.createdAt - a.createdAt);
}

function pumpJobScheduler() {
  ensureJobServices();
  jobScheduler.pump();
}

async function handleRun() {
  const apiKey = store.getApiKey();
  if (!apiKey) {
    alert("请先在设置页配置 API Key");
    return;
  }
  if (!state.currentApp) {
    alert("请先选择一个应用");
    return;
  }

  const runButtonCtrl = getRunButtonPhaseController();
  const now = Date.now();
  if (runGuard.isSubmitInFlight() || runButtonCtrl.isClickGuardActive(now)) {
    emitRunGuardFeedback("任务已提交，请稍候...", "info", 1200);
    return;
  }

  if (!runGuard.beginSubmit(now)) {
    emitRunGuardFeedback("任务已提交，请稍候...", "info", 1200);
    return;
  }
  runButtonCtrl.enterSubmittingGuard();
  const runSubmittingStartedAt = Date.now();

  try {
    const submitResult = submitWorkspaceJobUsecase({
      runGuard,
      now,
      createdAt: Date.now(),
      nextJobSeq: state.nextJobSeq,
      apiKey,
      currentApp: state.currentApp,
      inputValues: state.inputValues,
      targetBounds: resolveTargetBounds(),
      sourceBuffer: resolveSourceImageBuffer(),
      settings: store.getSettings(),
      queuedStatus: JOB_STATUS.QUEUED
    });

    const job = submitResult.job;
    state.nextJobSeq = submitResult.nextJobSeq;
    state.jobs.unshift(job);
    pruneJobHistory();
    updateTaskStatusSummary();
    emitRunGuardFeedback(`任务已提交到队列（${job.jobId}）`, "info", 1400);
    if (submitResult.duplicateHint) {
      emitRunGuardFeedback("检测到短时间重复提交，已继续入队。", "warn", 1800);
    }
    log(`[${getJobTag(job)}] 已加入后台队列: ${job.appName}`, "info");
    logPromptLengthsBeforeRun(job.appItem, job.inputValues, `[${getJobTag(job)}]`);
    await runButtonCtrl.waitSubmittingMinDuration(runSubmittingStartedAt);
    runButtonCtrl.enterSubmittedAck();
    pumpJobScheduler();
  } catch (error) {
    const message = error && error.message ? error.message : String(error || "unknown error");
    emitRunGuardFeedback(`任务提交失败：${message}`, "warn", 2200);
    log(`[RunGuard] 任务提交异常: ${message}`, "error");
    runButtonCtrl.recoverNow();
  } finally {
    runGuard.finishSubmit();
    if (state.runButtonPhase === RUN_BUTTON_PHASE.SUBMITTING_GUARD) {
      runButtonCtrl.recoverNow();
    }
  }
}
function renderAppPickerList() {
  if (!dom.appPickerList) return;

  const viewModel = buildAppPickerViewModel({
    apps: getApps(),
    keyword: state.appPickerKeyword,
    currentAppId: state.currentApp && state.currentApp.id
  });

  if (dom.appPickerStats) {
    dom.appPickerStats.textContent = `${viewModel.visibleCount} / ${viewModel.totalCount}`;
  }

  dom.appPickerList.innerHTML = renderAppPickerListHtml(viewModel, {
    escapeHtml,
    encodeDataId
  });
}

function closeAppPickerModal() {
  if (dom.appPickerModal) dom.appPickerModal.classList.remove("active");
  refreshModalOpenState();
}

function openAppPickerModal() {
  state.appPickerKeyword = "";
  if (dom.appPickerSearchInput) dom.appPickerSearchInput.value = "";
  renderAppPickerList();
  if (dom.appPickerModal) dom.appPickerModal.classList.add("active");
  refreshModalOpenState();
}

function selectAppInternal(id, options = {}) {
  const quiet = !!options.quiet;
  const closeModal = options.closeModal !== false;
  try {
    const app = getApps().find((item) => String(item.id) === String(id));
    if (!app) {
      if (!quiet) alert("应用不存在，请刷新后重试");
      return false;
    }
    renderDynamicInputs(app);
    if (closeModal) closeAppPickerModal();
    return true;
  } catch (error) {
    console.error(error);
    if (!quiet) alert(`加载应用失败: ${error.message}`);
    return false;
  }
}

function syncWorkspaceApps(options = {}) {
  const forceRerender = !!options.forceRerender;
  const apps = getApps();

  if (apps.length === 0) {
    if (state.currentApp || forceRerender) {
      renderDynamicInputs(null);
    } else {
      updateCurrentAppMeta();
      updateRunButtonUI();
    }
    renderAppPickerList();
    return;
  }

  const currentId = state.currentApp && state.currentApp.id;
  if (!currentId) {
    selectAppInternal(apps[0].id, { quiet: true, closeModal: false });
    renderAppPickerList();
    return;
  }

  const matched = apps.find((item) => item.id === currentId);
  if (!matched) {
    selectAppInternal(apps[0].id, { quiet: true, closeModal: false });
    renderAppPickerList();
    return;
  }

  state.currentApp = matched;
  if (forceRerender) {
    renderDynamicInputs(matched);
  } else {
    updateCurrentAppMeta();
    updateRunButtonUI();
  }
  renderAppPickerList();
}

function handleAppPickerListClick(event) {
  const gotoSettingsBtn = event.target.closest("button[data-action='goto-settings']");
  if (gotoSettingsBtn) {
    closeAppPickerModal();
    const tabSettings = byId("tabSettings");
    if (tabSettings) tabSettings.click();
    return;
  }

  const item = event.target.closest(".app-picker-item[data-id]");
  if (!item || !dom.appPickerList.contains(item)) return;

  const id = decodeDataId(item.dataset.id || "");
  if (!id) return;
  selectAppInternal(id);
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
  state.appPickerKeyword = String(dom.appPickerSearchInput.value || "");
  renderAppPickerList();
}

function onAppPickerModalClick(event) {
  if (event.target === dom.appPickerModal) closeAppPickerModal();
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
  clearTaskSummaryHint();
  if (state.taskSummaryTimerId) {
    clearInterval(state.taskSummaryTimerId);
    state.taskSummaryTimerId = null;
  }
  if (jobScheduler) {
    jobScheduler.dispose();
    jobScheduler = null;
  }
  if (jobExecutor) {
    jobExecutor.reset();
    jobExecutor = null;
  }
  runGuard.reset();
  state.runButtonPhase = RUN_BUTTON_PHASE.IDLE;
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
