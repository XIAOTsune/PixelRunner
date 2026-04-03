function buildRunButtonViewModel({ currentApp, runButtonPhase, runButtonPhaseEnum }) {
  const phaseEnum = runButtonPhaseEnum || {};

  if (!currentApp) {
    return {
      busy: false,
      disabled: true,
      text: "开始运行"
    };
  }

  if (runButtonPhase === phaseEnum.SUBMITTING_GUARD) {
    return {
      busy: true,
      disabled: true,
      text: "提交中..."
    };
  }

  if (runButtonPhase === phaseEnum.SUBMITTED_ACK) {
    return {
      busy: true,
      disabled: true,
      text: "已加入队列"
    };
  }

  return {
    busy: false,
    disabled: false,
    text: `运行新任务: ${currentApp.name || "未命名应用"}`
  };
}

function resolveTerminalJobStatuses(jobStatus = {}) {
  return new Set([
    jobStatus.DONE || "DONE",
    jobStatus.FAILED || "FAILED",
    jobStatus.CANCELLED || "CANCELLED"
  ]);
}

function findLatestCancelableJob(jobs, jobStatus = {}) {
  const list = Array.isArray(jobs) ? jobs : [];
  const terminalStatuses = resolveTerminalJobStatuses(jobStatus);
  for (let i = 0; i < list.length; i += 1) {
    const job = list[i];
    if (!job || terminalStatuses.has(job.status) || job.cancelPending) continue;
    return job;
  }
  return null;
}

function buildCancelButtonViewModel({ jobs, jobStatus }) {
  const job = findLatestCancelableJob(jobs, jobStatus);
  if (!job) {
    return {
      disabled: true,
      text: "取消任务",
      title: "当前没有可取消的任务"
    };
  }

  const jobId = String(job.jobId || "").trim();
  const statusText = String(job.status || "").trim();
  const parts = [];
  if (jobId) parts.push(jobId);
  if (statusText) parts.push(statusText);

  return {
    disabled: false,
    text: "取消最新任务",
    title: parts.length > 0 ? `取消 ${parts.join(" / ")}` : "取消最新任务"
  };
}

function createRunButtonPhaseController(options = {}) {
  const phaseEnum = options.runButtonPhaseEnum || {};
  const phaseIdle = phaseEnum.IDLE || "IDLE";
  const phaseSubmitting = phaseEnum.SUBMITTING_GUARD || "SUBMITTING_GUARD";
  const phaseSubmittedAck = phaseEnum.SUBMITTED_ACK || "SUBMITTED_ACK";
  const doubleClickGuardMs = Math.max(0, Number(options.doubleClickGuardMs) || 0);
  const submittingMinMs = Math.max(0, Number(options.submittingMinMs) || 0);
  const submittedAckMs = Math.max(0, Number(options.submittedAckMs) || 0);
  const runGuard = options.runGuard || null;
  const getPhase = typeof options.getPhase === "function" ? options.getPhase : () => phaseIdle;
  const setPhase = typeof options.setPhase === "function" ? options.setPhase : () => {};
  const getTimerId = typeof options.getTimerId === "function" ? options.getTimerId : () => null;
  const setTimerId = typeof options.setTimerId === "function" ? options.setTimerId : () => {};
  const onPhaseUpdated = typeof options.onPhaseUpdated === "function" ? options.onPhaseUpdated : () => {};
  const setTimeoutFn = typeof options.setTimeoutFn === "function" ? options.setTimeoutFn : setTimeout;
  const clearTimeoutFn = typeof options.clearTimeoutFn === "function" ? options.clearTimeoutFn : clearTimeout;
  const nowFn = typeof options.nowFn === "function" ? options.nowFn : Date.now;
  const waitMs = typeof options.waitMs === "function"
    ? options.waitMs
    : (ms) => new Promise((resolve) => setTimeoutFn(resolve, ms));

  function clearTimer() {
    const timerId = getTimerId();
    if (!timerId) return;
    clearTimeoutFn(timerId);
    setTimerId(null);
  }

  function scheduleRecover(delayMs = submittedAckMs) {
    clearTimer();
    const delay = Math.max(0, Number(delayMs) || 0);
    const timerId = setTimeoutFn(() => {
      setTimerId(null);
      setPhase(phaseIdle);
      if (runGuard && typeof runGuard.clearClickBlock === "function") {
        runGuard.clearClickBlock();
      }
      onPhaseUpdated();
    }, delay);
    setTimerId(timerId);
  }

  function enterSubmittingGuard() {
    clearTimer();
    setPhase(phaseSubmitting);
    if (runGuard && typeof runGuard.blockClickFor === "function") {
      runGuard.blockClickFor(Math.max(doubleClickGuardMs, submittingMinMs));
    }
    onPhaseUpdated();
  }

  function enterSubmittedAck() {
    clearTimer();
    setPhase(phaseSubmittedAck);
    if (runGuard && typeof runGuard.blockClickFor === "function") {
      runGuard.blockClickFor(submittedAckMs);
    }
    onPhaseUpdated();
    scheduleRecover(submittedAckMs);
  }

  function recoverNow() {
    clearTimer();
    setPhase(phaseIdle);
    if (runGuard && typeof runGuard.clearClickBlock === "function") {
      runGuard.clearClickBlock();
    }
    onPhaseUpdated();
  }

  function isClickGuardActive(now = nowFn()) {
    if (!runGuard || typeof runGuard.isClickGuardActive !== "function") return false;
    return !!runGuard.isClickGuardActive(now);
  }

  async function waitSubmittingMinDuration(startedAt) {
    const start = Number(startedAt || 0);
    const elapsed = start > 0 ? Math.max(0, nowFn() - start) : submittingMinMs;
    const remain = submittingMinMs - elapsed;
    if (remain <= 0) return 0;
    await waitMs(remain);
    return remain;
  }

  function dispose() {
    clearTimer();
  }

  return {
    getPhase,
    clearTimer,
    scheduleRecover,
    enterSubmittingGuard,
    enterSubmittedAck,
    recoverNow,
    isClickGuardActive,
    waitSubmittingMinDuration,
    dispose
  };
}

module.exports = {
  buildRunButtonViewModel,
  buildCancelButtonViewModel,
  findLatestCancelableJob,
  createRunButtonPhaseController
};
