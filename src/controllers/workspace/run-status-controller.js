const TASK_SUMMARY_TICK_MS = 100;

function createRunStatusController(options = {}) {
  const state = options.state || {};
  const dom = options.dom || {};
  const byId = typeof options.byId === "function" ? options.byId : () => null;
  const hasLiveJobs = typeof options.hasLiveJobs === "function" ? options.hasLiveJobs : () => false;
  const buildTaskSummaryViewModel =
    typeof options.buildTaskSummaryViewModel === "function"
      ? options.buildTaskSummaryViewModel
      : () => ({ text: "", title: "", tone: "default" });
  const renderTaskSummary = typeof options.renderTaskSummary === "function" ? options.renderTaskSummary : () => {};
  const jobStatus = options.jobStatus && typeof options.jobStatus === "object" ? options.jobStatus : {};
  const runSummaryHintMs = Math.max(300, Number(options.runSummaryHintMs) || 1800);
  const maxHistory = Math.max(1, Number(options.maxHistory) || 120);
  const nowFn = typeof options.now === "function" ? options.now : () => Date.now();
  const setIntervalFn = typeof options.setIntervalFn === "function" ? options.setIntervalFn : setInterval;
  const clearIntervalFn = typeof options.clearIntervalFn === "function" ? options.clearIntervalFn : clearInterval;
  const setTimeoutFn = typeof options.setTimeoutFn === "function" ? options.setTimeoutFn : setTimeout;
  const clearTimeoutFn = typeof options.clearTimeoutFn === "function" ? options.clearTimeoutFn : clearTimeout;
  const resolveJobStatusLabel =
    typeof options.resolveJobStatusLabel === "function"
      ? options.resolveJobStatusLabel
      : createDefaultStatusLabelResolver(jobStatus);
  const activeJobStatuses = resolveActiveJobStatuses(jobStatus);

  function clearTaskSummaryHint() {
    if (state.taskSummaryHintTimerId) {
      clearTimeoutFn(state.taskSummaryHintTimerId);
      state.taskSummaryHintTimerId = null;
    }
    state.taskSummaryHintText = "";
    state.taskSummaryHintType = "info";
    state.taskSummaryHintUntil = 0;
  }

  function setTaskSummaryHint(text, type = "info", ttlMs = runSummaryHintMs) {
    const hintText = String(text || "").trim();
    if (!hintText) {
      clearTaskSummaryHint();
      updateTaskStatusSummary();
      return;
    }

    const safeTtl = Math.max(300, Number(ttlMs) || runSummaryHintMs);
    state.taskSummaryHintText = hintText;
    state.taskSummaryHintType = type === "warn" ? "warn" : "info";
    state.taskSummaryHintUntil = nowFn() + safeTtl;
    if (state.taskSummaryHintTimerId) clearTimeoutFn(state.taskSummaryHintTimerId);
    state.taskSummaryHintTimerId = setTimeoutFn(() => {
      clearTaskSummaryHint();
      updateTaskStatusSummary();
    }, safeTtl + 20);
    updateTaskStatusSummary();
  }

  function getActiveTaskSummaryHint(now = nowFn()) {
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

  function syncTaskSummaryTicker() {
    if (hasLiveJobs(state.jobs, jobStatus)) {
      if (state.taskSummaryTimerId) return;
      state.taskSummaryTimerId = setIntervalFn(() => {
        updateTaskStatusSummary();
      }, TASK_SUMMARY_TICK_MS);
      return;
    }
    if (state.taskSummaryTimerId) {
      clearIntervalFn(state.taskSummaryTimerId);
      state.taskSummaryTimerId = null;
    }
  }

  function updateTaskStatusSummary() {
    const summaryEl = dom.taskStatusSummary || byId("taskStatusSummary");
    if (!summaryEl) return;
    const now = nowFn();
    const hint = getActiveTaskSummaryHint(now);
    const viewModel = buildTaskSummaryViewModel({
      jobs: state.jobs,
      hint,
      now,
      jobStatus,
      activeLimit: 6,
      previewLimit: 8,
      resolveJobStatusLabel
    });
    renderTaskSummary(summaryEl, viewModel);
    syncTaskSummaryTicker();
  }

  function setJobStatus(job, status, reason = "") {
    if (!job) return;
    job.status = status;
    job.statusReason = String(reason || "");
    job.updatedAt = nowFn();
    updateTaskStatusSummary();
  }

  function pruneJobHistory() {
    if (!Array.isArray(state.jobs) || state.jobs.length <= maxHistory) return;
    const active = state.jobs.filter((job) => activeJobStatuses.includes(job && job.status));
    const finished = state.jobs
      .filter((job) => !active.includes(job))
      .slice(0, Math.max(0, maxHistory - active.length));
    state.jobs = [...active, ...finished].sort((a, b) => {
      const aCreatedAt = Number((a && a.createdAt) || 0);
      const bCreatedAt = Number((b && b.createdAt) || 0);
      return bCreatedAt - aCreatedAt;
    });
  }

  function dispose() {
    clearTaskSummaryHint();
    if (state.taskSummaryTimerId) {
      clearIntervalFn(state.taskSummaryTimerId);
      state.taskSummaryTimerId = null;
    }
  }

  return {
    clearTaskSummaryHint,
    setTaskSummaryHint,
    getActiveTaskSummaryHint,
    updateTaskStatusSummary,
    setJobStatus,
    pruneJobHistory,
    dispose
  };
}

function resolveActiveJobStatuses(jobStatus = {}) {
  const statuses = [
    jobStatus.QUEUED || "QUEUED",
    jobStatus.SUBMITTING || "SUBMITTING",
    jobStatus.REMOTE_RUNNING || "REMOTE_RUNNING",
    jobStatus.DOWNLOADING || "DOWNLOADING",
    jobStatus.APPLYING || "APPLYING",
    jobStatus.TIMEOUT_TRACKING || "TIMEOUT_TRACKING"
  ];
  return statuses.filter(Boolean);
}

function createDefaultStatusLabelResolver(jobStatus = {}) {
  const labels = new Map([
    [jobStatus.QUEUED || "QUEUED", "排队"],
    [jobStatus.SUBMITTING || "SUBMITTING", "提交"],
    [jobStatus.REMOTE_RUNNING || "REMOTE_RUNNING", "运行"],
    [jobStatus.DOWNLOADING || "DOWNLOADING", "下载"],
    [jobStatus.APPLYING || "APPLYING", "回贴"],
    [jobStatus.TIMEOUT_TRACKING || "TIMEOUT_TRACKING", "超时跟踪"],
    [jobStatus.DONE || "DONE", "完成"],
    [jobStatus.FAILED || "FAILED", "失败"]
  ]);
  return (status) => labels.get(status) || status || "-";
}

module.exports = {
  createRunStatusController
};
