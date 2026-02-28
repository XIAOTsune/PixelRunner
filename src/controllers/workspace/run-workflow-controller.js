const REQUEST_TIMEOUT_ERROR_CODE = "REQUEST_TIMEOUT";

function createRunWorkflowController(options = {}) {
  const state = options.state || {};
  const store = options.store || null;
  const runGuard = options.runGuard || null;
  const getRunButtonPhaseController =
    typeof options.getRunButtonPhaseController === "function" ? options.getRunButtonPhaseController : () => null;
  const runButtonPhaseEnum =
    options.runButtonPhaseEnum && typeof options.runButtonPhaseEnum === "object"
      ? options.runButtonPhaseEnum
      : {};
  const submitWorkspaceJobUsecase =
    typeof options.submitWorkspaceJobUsecase === "function" ? options.submitWorkspaceJobUsecase : () => null;
  const resolveTargetBounds =
    typeof options.resolveTargetBounds === "function" ? options.resolveTargetBounds : () => ({});
  const resolveSourceImageBuffer =
    typeof options.resolveSourceImageBuffer === "function" ? options.resolveSourceImageBuffer : () => null;
  const resolvePlacementTarget =
    typeof options.resolvePlacementTarget === "function" ? options.resolvePlacementTarget : () => null;
  const runninghub = options.runninghub || null;
  const ps = options.ps || null;
  const setJobStatus = typeof options.setJobStatus === "function" ? options.setJobStatus : () => {};
  const cloneBounds = typeof options.cloneBounds === "function" ? options.cloneBounds : (value) => value;
  const cloneArrayBuffer =
    typeof options.cloneArrayBuffer === "function" ? options.cloneArrayBuffer : (value) => value;
  const createJobExecutor =
    typeof options.createJobExecutor === "function" ? options.createJobExecutor : () => ({ execute: async () => {}, reset: () => {} });
  const createJobScheduler =
    typeof options.createJobScheduler === "function" ? options.createJobScheduler : () => ({ pump: () => {}, dispose: () => {} });
  const updateTaskStatusSummary =
    typeof options.updateTaskStatusSummary === "function" ? options.updateTaskStatusSummary : () => {};
  const pruneJobHistory = typeof options.pruneJobHistory === "function" ? options.pruneJobHistory : () => {};
  const emitRunGuardFeedback =
    typeof options.emitRunGuardFeedback === "function" ? options.emitRunGuardFeedback : () => {};
  const log = typeof options.log === "function" ? options.log : () => {};
  const logPromptLengthsBeforeRun =
    typeof options.logPromptLengthsBeforeRun === "function" ? options.logPromptLengthsBeforeRun : () => {};
  const onJobCompleted = typeof options.onJobCompleted === "function" ? options.onJobCompleted : () => {};
  const jobStatus = options.jobStatus && typeof options.jobStatus === "object" ? options.jobStatus : {};
  const localMaxConcurrentJobs = Math.max(1, Number(options.localMaxConcurrentJobs) || 2);
  const getLocalMaxConcurrentJobs =
    typeof options.getLocalMaxConcurrentJobs === "function"
      ? options.getLocalMaxConcurrentJobs
      : () => localMaxConcurrentJobs;
  const timeoutRetryDelayMs = Math.max(0, Number(options.timeoutRetryDelayMs) || 15000);
  const maxTimeoutRecoveries = Math.max(0, Number(options.maxTimeoutRecoveries) || 40);
  const requestTimeoutErrorCode = String(options.requestTimeoutErrorCode || REQUEST_TIMEOUT_ERROR_CODE);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const alertFn =
    typeof options.alert === "function"
      ? options.alert
      : typeof alert === "function"
      ? alert
      : () => {};

  let jobExecutor = null;
  let jobScheduler = null;

  function getJobTag(job) {
    if (!job) return "Job:-";
    return `Job:${job.jobId}`;
  }

  function createJobScopedLogger(job) {
    return (message, type = "info") => {
      log(`[${getJobTag(job)}] ${String(message || "")}`, type);
    };
  }

  function isJobTimeoutLikeError(error) {
    if (error && error.code === requestTimeoutErrorCode) return true;
    const message = String((error && error.message) || error || "").toLowerCase();
    return /timeout|超时/.test(message);
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
        onJobCompleted,
        jobStatus,
        timeoutRetryDelayMs,
        maxTimeoutRecoveries
      });
    }

    if (!jobScheduler) {
      jobScheduler = createJobScheduler({
        getJobs: () => state.jobs,
        maxConcurrent: localMaxConcurrentJobs,
        getMaxConcurrent: getLocalMaxConcurrentJobs,
        executeJob: (job) => jobExecutor.execute(job),
        runnableStatuses: [jobStatus.QUEUED, jobStatus.TIMEOUT_TRACKING],
        onRunningCountChange: () => {
          updateTaskStatusSummary();
        },
        onJobExecutionError: (job, error) => {
          const message = error && error.message ? error.message : String(error || "unknown error");
          setJobStatus(job, jobStatus.FAILED, message);
          createJobScopedLogger(job)(`任务失败: ${message}`, "error");
        },
        onJobSettled: () => {
          pruneJobHistory();
          updateTaskStatusSummary();
        }
      });
    }
  }

  function pumpJobScheduler() {
    ensureJobServices();
    jobScheduler.pump();
  }

  async function handleRun() {
    const apiKey = store && typeof store.getApiKey === "function" ? store.getApiKey() : "";
    if (!apiKey) {
      alertFn("请先在设置页配置 API Key");
      return;
    }
    if (!state.currentApp) {
      alertFn("请先选择一个应用");
      return;
    }

    const runButtonCtrl = getRunButtonPhaseController();
    if (!runButtonCtrl || typeof runButtonCtrl.enterSubmittingGuard !== "function") return;
    const ts = now();
    if (
      (runGuard && typeof runGuard.isSubmitInFlight === "function" && runGuard.isSubmitInFlight()) ||
      (typeof runButtonCtrl.isClickGuardActive === "function" && runButtonCtrl.isClickGuardActive(ts))
    ) {
      emitRunGuardFeedback("任务已提交，请稍候...", "info", 1200);
      return;
    }

    if (runGuard && typeof runGuard.beginSubmit === "function" && !runGuard.beginSubmit(ts)) {
      emitRunGuardFeedback("任务已提交，请稍候...", "info", 1200);
      return;
    }
    runButtonCtrl.enterSubmittingGuard();
    const runSubmittingStartedAt = now();

    try {
      const targetBounds = resolveTargetBounds();
      const sourceBuffer = resolveSourceImageBuffer();
      const placementTarget = resolvePlacementTarget();
      if (sourceBuffer && !placementTarget) {
        log("[RunGuard] placement target unresolved, fallback to current active document", "warn");
      }
      const submitResult = submitWorkspaceJobUsecase({
        runGuard,
        now: ts,
        createdAt: now(),
        nextJobSeq: state.nextJobSeq,
        apiKey,
        currentApp: state.currentApp,
        inputValues: state.inputValues,
        targetBounds,
        sourceBuffer,
        placementTarget,
        settings: store && typeof store.getSettings === "function" ? store.getSettings() : {},
        queuedStatus: jobStatus.QUEUED
      });
      const job = submitResult && submitResult.job;
      if (!job) {
        throw new Error("submit result missing job");
      }
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
      if (typeof runButtonCtrl.waitSubmittingMinDuration === "function") {
        await runButtonCtrl.waitSubmittingMinDuration(runSubmittingStartedAt);
      }
      if (typeof runButtonCtrl.enterSubmittedAck === "function") {
        runButtonCtrl.enterSubmittedAck();
      }
      pumpJobScheduler();
    } catch (error) {
      const message = error && error.message ? error.message : String(error || "unknown error");
      emitRunGuardFeedback(`任务提交失败：${message}`, "warn", 2200);
      log(`[RunGuard] 任务提交异常: ${message}`, "error");
      if (typeof runButtonCtrl.recoverNow === "function") {
        runButtonCtrl.recoverNow();
      }
    } finally {
      if (runGuard && typeof runGuard.finishSubmit === "function") {
        runGuard.finishSubmit();
      }
      if (state.runButtonPhase === runButtonPhaseEnum.SUBMITTING_GUARD) {
        if (typeof runButtonCtrl.recoverNow === "function") {
          runButtonCtrl.recoverNow();
        }
      }
    }
  }

  function dispose() {
    if (jobScheduler) {
      jobScheduler.dispose();
      jobScheduler = null;
    }
    if (jobExecutor) {
      jobExecutor.reset();
      jobExecutor = null;
    }
  }

  return {
    handleRun,
    pumpJobScheduler,
    dispose
  };
}

module.exports = {
  createRunWorkflowController
};
