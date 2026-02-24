const store = require("../services/store");
const runninghub = require("../services/runninghub");
const ps = require("../services/ps");
const { escapeHtml, isPromptLikeInput, isEmptyValue } = require("../utils");
const { APP_EVENTS } = require("../events");
const { byId, encodeDataId, decodeDataId, getRenderedElementCount, rebindEvent } = require("../shared/dom-utils");
const inputSchema = require("../shared/input-schema");
const { createWorkspaceInputs } = require("./workspace/workspace-inputs");
const { renderAppPickerListHtml } = require("./workspace/app-picker-view");
const { renderTemplatePickerListHtml } = require("./workspace/template-picker-view");
const { createRunGuard } = require("../application/services/run-guard");
const { createJobScheduler, createJobExecutor } = require("../application/services/job-scheduler");
const { buildAppPickerViewModel } = require("../application/services/app-picker");
const { buildPromptLengthLogSummary } = require("../application/services/prompt-log");
const {
  normalizeTemplatePickerConfig,
  sanitizeTemplateSelectionIds,
  toggleTemplateSelection: toggleTemplateSelectionState,
  buildSingleTemplateSelectionPayload,
  buildMultipleTemplateSelectionPayload,
  buildTemplatePickerUiState,
  buildTemplatePickerListViewModel
} = require("../application/services/template-picker");

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
const UPLOAD_MAX_EDGE_CHOICES = [0, 4096, 2048, 1024];
const PASTE_STRATEGY_CHOICES = ["normal", "smart", "smartEnhanced"];
const PASTE_STRATEGY_LABELS = {
  normal: "普通（居中铺满）",
  smart: "智能（主体对齐）",
  smartEnhanced: "智能增强（全局+局部补偿）"
};
const LEGACY_PASTE_STRATEGY_MAP = {
  stretch: "normal",
  contain: "normal",
  cover: "normal",
  alphaTrim: "smart",
  edgeAuto: "smart"
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
const RUN_DEDUP_WINDOW_MS = 4000;
const RUN_DEDUP_CACHE_LIMIT = 80;
const RUN_SUMMARY_HINT_MS = 1800;

let workspaceInputs = null;
const runGuard = createRunGuard({
  dedupWindowMs: RUN_DEDUP_WINDOW_MS,
  dedupCacheLimit: RUN_DEDUP_CACHE_LIMIT
});
let jobExecutor = null;
let jobScheduler = null;

function normalizeUploadMaxEdge(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return UPLOAD_MAX_EDGE_CHOICES.includes(num) ? num : 0;
}

function normalizePasteStrategy(value) {
  const marker = String(value || "").trim();
  if (!marker) return "normal";
  const legacy = LEGACY_PASTE_STRATEGY_MAP[marker];
  const normalized = legacy || marker;
  return PASTE_STRATEGY_CHOICES.includes(normalized) ? normalized : "normal";
}

function cloneArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return null;
}

function cloneDeepValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value !== "object") return value;

  const binary = cloneArrayBuffer(value);
  if (binary) return binary;
  if (depth >= 8) return value;
  if (Array.isArray(value)) return value.map((item) => cloneDeepValue(item, depth + 1));

  const out = {};
  Object.keys(value).forEach((key) => {
    out[key] = cloneDeepValue(value[key], depth + 1);
  });
  return out;
}

function cloneInputValues(values) {
  const source = values && typeof values === "object" ? values : {};
  const out = {};
  Object.keys(source).forEach((key) => {
    out[key] = cloneDeepValue(source[key]);
  });
  return out;
}

function cloneBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return null;
  return {
    left: Number(bounds.left),
    top: Number(bounds.top),
    right: Number(bounds.right),
    bottom: Number(bounds.bottom)
  };
}

function getJobTag(job) {
  if (!job) return "Job:-";
  return `Job:${job.jobId}`;
}

function isJobTimeoutLikeError(error) {
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

function getLogText(logDiv) {
  if (!logDiv) return "";
  if (typeof logDiv.value === "string") return String(logDiv.value || "");
  return String(logDiv.textContent || "");
}

function setLogText(logDiv, text) {
  if (!logDiv) return;
  const nextText = String(text || "");
  if (typeof logDiv.value === "string") {
    logDiv.value = nextText;
    return;
  }
  logDiv.textContent = nextText;
}

function isNearLogBottom(logDiv, threshold = 12) {
  if (!logDiv) return true;
  const maxScrollTop = Math.max(0, logDiv.scrollHeight - logDiv.clientHeight);
  return maxScrollTop - logDiv.scrollTop <= threshold;
}

function log(msg, type = "info") {
  console.log(`[Workspace][${type}] ${msg}`);
  const logDiv = dom.logWindow || byId("logWindow");
  if (!logDiv) return;
  if (msg === "CLEAR") {
    setLogText(logDiv, "");
    return;
  }
  const time = new Date().toLocaleTimeString();
  const level = String(type || "info").toUpperCase();
  const line = `[${time}] [${level}] ${String(msg || "")}`;
  const stickToBottom = isNearLogBottom(logDiv);
  const current = getLogText(logDiv);
  setLogText(logDiv, current ? `${current}\n${line}` : line);
  if (stickToBottom) {
    logDiv.scrollTop = logDiv.scrollHeight;
  }
}

function onClearLogClick() {
  log("CLEAR");
}

function getApps() {
  return store.getAiApps().filter((app) => app && typeof app === "object");
}

function clearRunButtonTimer() {
  if (!state.runButtonTimerId) return;
  clearTimeout(state.runButtonTimerId);
  state.runButtonTimerId = null;
}

function scheduleRunButtonRecover(delayMs = RUN_SUBMITTED_ACK_MS) {
  clearRunButtonTimer();
  const delay = Math.max(0, Number(delayMs) || 0);
  state.runButtonTimerId = setTimeout(() => {
    state.runButtonTimerId = null;
    state.runButtonPhase = RUN_BUTTON_PHASE.IDLE;
    runGuard.clearClickBlock();
    updateRunButtonUI();
  }, delay);
}

function enterRunSubmittingGuard() {
  clearRunButtonTimer();
  state.runButtonPhase = RUN_BUTTON_PHASE.SUBMITTING_GUARD;
  runGuard.blockClickFor(Math.max(RUN_DOUBLE_CLICK_GUARD_MS, RUN_SUBMITTING_MIN_MS));
  updateRunButtonUI();
}

function enterRunSubmittedAck() {
  clearRunButtonTimer();
  state.runButtonPhase = RUN_BUTTON_PHASE.SUBMITTED_ACK;
  runGuard.blockClickFor(RUN_SUBMITTED_ACK_MS);
  updateRunButtonUI();
  scheduleRunButtonRecover(RUN_SUBMITTED_ACK_MS);
}

function recoverRunButtonNow() {
  clearRunButtonTimer();
  state.runButtonPhase = RUN_BUTTON_PHASE.IDLE;
  runGuard.clearClickBlock();
  updateRunButtonUI();
}

function isRunClickGuardActive(now = Date.now()) {
  return runGuard.isClickGuardActive(now);
}

function sleepMs(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

async function waitRunSubmittingMinDuration(startedAt) {
  const start = Number(startedAt || 0);
  const elapsed = start > 0 ? Math.max(0, Date.now() - start) : RUN_SUBMITTING_MIN_MS;
  const remain = RUN_SUBMITTING_MIN_MS - elapsed;
  if (remain > 0) {
    await sleepMs(remain);
  }
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
  if (!state.currentApp) {
    btn.classList.remove("is-busy");
    btn.disabled = true;
    btn.textContent = "开始运行";
    return;
  }

  if (state.runButtonPhase === RUN_BUTTON_PHASE.SUBMITTING_GUARD) {
    btn.classList.add("is-busy");
    btn.disabled = true;
    btn.textContent = "提交中...";
    return;
  }
  if (state.runButtonPhase === RUN_BUTTON_PHASE.SUBMITTED_ACK) {
    btn.classList.add("is-busy");
    btn.disabled = true;
    btn.textContent = "已加入队列";
    return;
  }

  btn.classList.remove("is-busy");
  btn.disabled = false;
  btn.textContent = `运行新任务: ${state.currentApp.name}`;
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

function getJobElapsedSeconds(job, now = Date.now()) {
  const start = Number(job && (job.startedAt || job.createdAt) || 0);
  if (!Number.isFinite(start) || start <= 0) return "0.00";
  const elapsed = Math.max(0, (now - start) / 1000);
  return elapsed.toFixed(2);
}

function hasLiveJobs() {
  return Array.isArray(state.jobs) && state.jobs.some((job) =>
    ![JOB_STATUS.DONE, JOB_STATUS.FAILED].includes(job.status)
  );
}

function syncTaskSummaryTicker() {
  if (hasLiveJobs()) {
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
  summaryEl.classList.remove("is-warning", "is-success", "is-info");

  if (!Array.isArray(state.jobs) || state.jobs.length === 0) {
    const lines = ["后台任务：无"];
    if (hint) lines.push(hint.text);
    summaryEl.textContent = lines.join("\n");
    if (hint && hint.type === "warn") {
      summaryEl.classList.add("is-warning");
    } else if (hint && hint.type === "info") {
      summaryEl.classList.add("is-info");
    }
    summaryEl.title = "";
    syncTaskSummaryTicker();
    return;
  }

  const running = state.jobs.filter((job) =>
    [JOB_STATUS.SUBMITTING, JOB_STATUS.REMOTE_RUNNING, JOB_STATUS.DOWNLOADING, JOB_STATUS.APPLYING].includes(job.status)
  ).length;
  const queued = state.jobs.filter((job) => job.status === JOB_STATUS.QUEUED).length;
  const timeout = state.jobs.filter((job) => job.status === JOB_STATUS.TIMEOUT_TRACKING).length;
  const done = state.jobs.filter((job) => job.status === JOB_STATUS.DONE).length;
  const failed = state.jobs.filter((job) => job.status === JOB_STATUS.FAILED).length;

  const line1 =
    `后台任务：运行 ${running}｜排队 ${queued}｜完成 ${done}｜失败 ${failed}` +
    (timeout > 0 ? `｜超时跟踪 ${timeout}` : "");
  const activeJobs = state.jobs.filter((job) =>
    ![JOB_STATUS.DONE, JOB_STATUS.FAILED].includes(job.status)
  );
  const line2 = activeJobs.length > 0
    ? activeJobs
      .slice(0, 6)
      .map((job) => `${job.jobId} ${getJobStatusLabel(job.status)} ${getJobElapsedSeconds(job, now)}s`)
      .join("｜")
    : "";
  const lines = [line1];
  if (line2) lines.push(line2);
  if (hint) lines.push(hint.text);
  summaryEl.textContent = lines.join("\n");

  const hasWarning = failed > 0 || timeout > 0 || (hint && hint.type === "warn");
  const hasSuccess = !hasWarning && failed === 0 && timeout === 0 && running === 0 && queued === 0 && done > 0;
  if (hasWarning) summaryEl.classList.add("is-warning");
  if (hasSuccess) summaryEl.classList.add("is-success");
  if (!hasWarning && !hasSuccess && hint && hint.type === "info") summaryEl.classList.add("is-info");

  const preview = state.jobs.slice(0, 8).map((job) =>
    `${job.jobId} | ${job.appName || "-"} | ${getJobStatusLabel(job.status)} | ${getJobElapsedSeconds(job, now)}s${job.remoteTaskId ? ` | ${job.remoteTaskId}` : ""}`
  );
  if (hint) preview.unshift(`Hint | ${hint.text}`);
  summaryEl.title = preview.join("\n");
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

  const now = Date.now();
  if (runGuard.isSubmitInFlight() || isRunClickGuardActive(now)) {
    emitRunGuardFeedback("任务已提交，请稍候...", "info", 1200);
    return;
  }

  if (!runGuard.beginSubmit(now)) {
    emitRunGuardFeedback("任务已提交，请稍候...", "info", 1200);
    return;
  }
  enterRunSubmittingGuard();
  const runSubmittingStartedAt = Date.now();

  try {
    const settings = store.getSettings();
    const pasteStrategy = normalizePasteStrategy(settings.pasteStrategy);
    const uploadMaxEdge = normalizeUploadMaxEdge(settings.uploadMaxEdge);
    const pollSettings = {
      pollInterval: Number(settings.pollInterval) || 2,
      timeout: Number(settings.timeout) || 180
    };
    const appItem = cloneDeepValue(state.currentApp);
    const inputValues = cloneInputValues(state.inputValues);
    const targetBounds = cloneBounds(resolveTargetBounds());
    const sourceBuffer = cloneArrayBuffer(resolveSourceImageBuffer());
    const runFingerprint = runGuard.buildRunFingerprint({
      appItem,
      inputValues,
      targetBounds,
      sourceBuffer,
      pasteStrategy,
      uploadMaxEdge,
      pollSettings
    });

    if (runGuard.isRecentDuplicateFingerprint(runFingerprint, now)) {
      emitRunGuardFeedback("检测到短时间重复提交，已自动拦截。", "warn", 1800);
      await waitRunSubmittingMinDuration(runSubmittingStartedAt);
      enterRunSubmittedAck();
      return;
    }

    const createdAt = Date.now();
    const job = {
      jobId: `J${createdAt}-${state.nextJobSeq++}`,
      appName: String(state.currentApp.name || "未命名应用"),
      apiKey,
      appItem,
      inputValues,
      targetBounds,
      sourceBuffer,
      pasteStrategy,
      uploadMaxEdge,
      pollSettings,
      runFingerprint,
      status: JOB_STATUS.QUEUED,
      statusReason: "",
      remoteTaskId: "",
      resultUrl: "",
      timeoutRecoveries: 0,
      nextRunAt: createdAt,
      startedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      finishedAt: 0
    };

    runGuard.rememberFingerprint(runFingerprint, createdAt);
    state.jobs.unshift(job);
    pruneJobHistory();
    updateTaskStatusSummary();
    emitRunGuardFeedback(`任务已提交到队列（${job.jobId}）`, "info", 1400);
    log(`[${getJobTag(job)}] 已加入后台队列: ${job.appName}`, "info");
    logPromptLengthsBeforeRun(job.appItem, job.inputValues, `[${getJobTag(job)}]`);
    await waitRunSubmittingMinDuration(runSubmittingStartedAt);
    enterRunSubmittedAck();
    pumpJobScheduler();
  } catch (error) {
    const message = error && error.message ? error.message : String(error || "unknown error");
    emitRunGuardFeedback(`任务提交失败：${message}`, "warn", 2200);
    log(`[RunGuard] 任务提交异常: ${message}`, "error");
    recoverRunButtonNow();
  } finally {
    runGuard.finishSubmit();
    if (state.runButtonPhase === RUN_BUTTON_PHASE.SUBMITTING_GUARD) {
      recoverRunButtonNow();
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

function isTemplatePickerMultipleMode() {
  return state.templatePickerMode === "multiple";
}

function updateTemplateSelectionInfo() {
  if (!dom.templateModalSelectionInfo) return;
  const uiState = buildTemplatePickerUiState({
    mode: state.templatePickerMode,
    selectedCount: state.templatePickerSelectedIds.length,
    maxSelection: state.templatePickerMaxSelection
  });
  dom.templateModalSelectionInfo.textContent = uiState.selectionInfoText;
  if (dom.btnApplyTemplateSelection) dom.btnApplyTemplateSelection.disabled = uiState.applyDisabled;
}

function syncTemplatePickerUiState() {
  const uiState = buildTemplatePickerUiState({
    mode: state.templatePickerMode,
    selectedCount: state.templatePickerSelectedIds.length,
    maxSelection: state.templatePickerMaxSelection
  });
  if (dom.templateModalTitle) {
    dom.templateModalTitle.textContent = uiState.title;
  }
  if (dom.templateModalActions) {
    dom.templateModalActions.style.display = uiState.actionsDisplay;
  }
  if (dom.templateModalSelectionInfo) {
    dom.templateModalSelectionInfo.textContent = uiState.selectionInfoText;
  }
  if (dom.btnApplyTemplateSelection) dom.btnApplyTemplateSelection.disabled = uiState.applyDisabled;
}

function renderTemplatePickerList() {
  if (!dom.templateList) return;
  const viewModel = buildTemplatePickerListViewModel({
    templates: store.getPromptTemplates(),
    selectedIds: state.templatePickerSelectedIds,
    multipleMode: isTemplatePickerMultipleMode()
  });
  dom.templateList.innerHTML = renderTemplatePickerListHtml(viewModel, {
    escapeHtml,
    encodeDataId
  });
  updateTemplateSelectionInfo();
}

function closeTemplatePicker() {
  if (dom.templateModal) dom.templateModal.classList.remove("active");
  state.templateSelectCallback = null;
  state.templatePickerMode = "single";
  state.templatePickerMaxSelection = 1;
  state.templatePickerSelectedIds = [];
  syncTemplatePickerUiState();
  refreshModalOpenState();
}

function openTemplatePicker(config = {}) {
  const next = normalizeTemplatePickerConfig(config, {
    maxCombineCount: MAX_TEMPLATE_COMBINE_COUNT
  });

  state.templateSelectCallback = next.onApply;
  state.templatePickerMode = next.mode;
  state.templatePickerMaxSelection = next.maxSelection;
  state.templatePickerSelectedIds = [];
  syncTemplatePickerUiState();
  renderTemplatePickerList();
  if (dom.templateModal) dom.templateModal.classList.add("active");
  refreshModalOpenState();
}

function refreshModalOpenState() {
  const isOpen = Boolean(document.querySelector(".modal-overlay.active"));
  document.body.classList.toggle("modal-open", isOpen);
}

function toggleTemplateSelection(id) {
  const next = toggleTemplateSelectionState({
    selectedIds: state.templatePickerSelectedIds,
    id,
    maxSelection: state.templatePickerMaxSelection
  });

  if (next.limitReached) {
    alert(`You can select up to ${state.templatePickerMaxSelection} template(s).`);
    return;
  }
  if (!next.changed) return;

  state.templatePickerSelectedIds = next.selectedIds;
  renderTemplatePickerList();
}

function applyTemplateSelection() {
  if (!isTemplatePickerMultipleMode()) return;

  const result = buildMultipleTemplateSelectionPayload({
    templates: store.getPromptTemplates(),
    selectedIds: state.templatePickerSelectedIds,
    maxChars: RH_PROMPT_MAX_CHARS
  });

  if (!result.ok) {
    if (result.reason === "empty_selection") {
      alert("Please select at least one template.");
      return;
    }
    if (result.reason === "templates_not_found") {
      alert("Selected templates were not found. Please refresh and retry.");
      return;
    }
    if (result.reason === "too_long") {
      alert(`Combined prompt length ${result.length} exceeds limit ${result.limit}.`);
      return;
    }
    alert("Failed to apply template selection.");
    return;
  }

  if (state.templateSelectCallback) {
    state.templateSelectCallback(result.payload);
  }
  closeTemplatePicker();
}

function handleTemplateListClick(event) {
  const gotoSettingsBtn = event.target.closest("button[data-action='goto-settings']");
  if (gotoSettingsBtn) {
    closeTemplatePicker();
    const tabSettings = byId("tabSettings");
    if (tabSettings) tabSettings.click();
    return;
  }

  const item = event.target.closest(".app-picker-item[data-template-id]");
  if (!item || !dom.templateList.contains(item)) return;

  const id = decodeDataId(item.dataset.templateId || "");
  if (!id) return;
  const template = store.getPromptTemplates().find((tpl) => String(tpl.id) === String(id));
  if (!template) return;

  if (isTemplatePickerMultipleMode()) {
    toggleTemplateSelection(id);
    return;
  }

  const payload = buildSingleTemplateSelectionPayload({
    template,
    maxChars: RH_PROMPT_MAX_CHARS
  });
  if (state.templateSelectCallback) {
    state.templateSelectCallback(payload);
  }
  closeTemplatePicker();
}

function onAppPickerSearchInput() {
  state.appPickerKeyword = String(dom.appPickerSearchInput.value || "");
  renderAppPickerList();
}

function onAppPickerModalClick(event) {
  if (event.target === dom.appPickerModal) closeAppPickerModal();
}

function onTemplateModalClick(event) {
  if (event.target === dom.templateModal) closeTemplatePicker();
}

function onApplyTemplateSelectionClick() {
  applyTemplateSelection();
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
  if (dom.templateModal && dom.templateModal.classList.contains("active")) {
    state.templatePickerSelectedIds = sanitizeTemplateSelectionIds(
      state.templatePickerSelectedIds,
      store.getPromptTemplates()
    );
    renderTemplatePickerList();
  }
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

function initWorkspaceController() {
  clearRunButtonTimer();
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

  cacheDomRefs();
  state.templatePickerMode = "single";
  state.templatePickerMaxSelection = 1;
  state.templatePickerSelectedIds = [];
  syncTemplatePickerUiState();
  syncPasteStrategySelect();
  workspaceInputs = null;
  getWorkspaceInputs();
  bindWorkspaceEvents();
  updateAccountStatus();
  syncWorkspaceApps({ forceRerender: true });
  updateRunButtonUI();
  updateTaskStatusSummary();
}

module.exports = { initWorkspaceController };
