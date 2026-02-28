const DEFAULT_RUNNABLE_STATUSES = ["QUEUED", "TIMEOUT_TRACKING"];

function toPositiveInteger(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function ensureFunction(value, name) {
  if (typeof value !== "function") {
    throw new Error(`createJobScheduler: ${name} must be a function`);
  }
  return value;
}

function defaultToMessage(error) {
  return error && error.message ? error.message : String(error || "unknown error");
}

function createJobExecutor(options = {}) {
  const runninghub = options.runninghub;
  const ps = options.ps;
  const setJobStatus = ensureFunction(options.setJobStatus, "setJobStatus");
  const createJobLogger = ensureFunction(options.createJobLogger, "createJobLogger");
  const cloneBounds = ensureFunction(options.cloneBounds, "cloneBounds");
  const cloneArrayBuffer = ensureFunction(options.cloneArrayBuffer, "cloneArrayBuffer");
  const isJobTimeoutLikeError = ensureFunction(options.isJobTimeoutLikeError, "isJobTimeoutLikeError");
  const onJobCompleted = typeof options.onJobCompleted === "function" ? options.onJobCompleted : null;
  const jobStatus = options.jobStatus && typeof options.jobStatus === "object" ? options.jobStatus : {};
  const timeoutRetryDelayMs = Math.max(0, Number(options.timeoutRetryDelayMs) || 0);
  const maxTimeoutRecoveries = Math.max(0, Number(options.maxTimeoutRecoveries) || 0);

  if (!runninghub || typeof runninghub !== "object") {
    throw new Error("createJobExecutor: runninghub is required");
  }
  if (!ps || typeof ps !== "object") {
    throw new Error("createJobExecutor: ps is required");
  }
  if (typeof runninghub.runAppTask !== "function") {
    throw new Error("createJobExecutor: runninghub.runAppTask is required");
  }
  if (typeof runninghub.pollTaskOutput !== "function") {
    throw new Error("createJobExecutor: runninghub.pollTaskOutput is required");
  }
  if (typeof runninghub.downloadResultBinary !== "function") {
    throw new Error("createJobExecutor: runninghub.downloadResultBinary is required");
  }
  if (typeof ps.placeImage !== "function") {
    throw new Error("createJobExecutor: ps.placeImage is required");
  }

  let applyQueue = Promise.resolve();

  async function enqueueApplyWork(job, buffer) {
    const task = async () => {
      await ps.placeImage(buffer, {
        log: createJobLogger(job),
        targetBounds: cloneBounds(job.targetBounds),
        pasteStrategy: job.pasteStrategy,
        sourceBuffer: cloneArrayBuffer(job.sourceBuffer),
        placementTarget: job.placementTarget || null
      });
    };
    const queuedTask = applyQueue.then(task, task);
    applyQueue = queuedTask.catch(() => {});
    return queuedTask;
  }

  async function execute(job) {
    const jobLog = createJobLogger(job);
    const signalController = new AbortController();
    const signal = signalController.signal;
    const runOptions = {
      log: jobLog,
      signal,
      uploadMaxEdge: job.uploadMaxEdge,
      uploadRetryCount: job.uploadRetryCount
    };

    try {
      if (!job.remoteTaskId) {
        setJobStatus(job, jobStatus.SUBMITTING);
        const taskId = await runninghub.runAppTask(job.apiKey, job.appItem, job.inputValues, runOptions);
        job.remoteTaskId = String(taskId || "");
        jobLog(`任务已提交: ${job.remoteTaskId}`, "success");
      }

      setJobStatus(job, jobStatus.REMOTE_RUNNING);
      const resultUrl = await runninghub.pollTaskOutput(job.apiKey, job.remoteTaskId, job.pollSettings, runOptions);
      job.resultUrl = String(resultUrl || "");

      setJobStatus(job, jobStatus.DOWNLOADING);
      const buffer = await runninghub.downloadResultBinary(job.resultUrl, runOptions);

      setJobStatus(job, jobStatus.APPLYING);
      await enqueueApplyWork(job, buffer);

      setJobStatus(job, jobStatus.DONE);
      job.finishedAt = Date.now();
      jobLog("处理完成，结果已回贴", "success");
      if (onJobCompleted) onJobCompleted(job);
    } catch (error) {
      const message = defaultToMessage(error);
      if (
        isJobTimeoutLikeError(error) &&
        job.remoteTaskId &&
        Number(job.timeoutRecoveries || 0) < maxTimeoutRecoveries
      ) {
        job.timeoutRecoveries = Number(job.timeoutRecoveries || 0) + 1;
        job.nextRunAt = Date.now() + timeoutRetryDelayMs;
        setJobStatus(job, jobStatus.TIMEOUT_TRACKING, message);
        jobLog(
          `本地跟踪超时，${Math.round(timeoutRetryDelayMs / 1000)}s 后继续后台跟踪（第 ${job.timeoutRecoveries} 次）`,
          "warn"
        );
        return;
      }
      setJobStatus(job, jobStatus.FAILED, message);
      job.finishedAt = Date.now();
      jobLog(`任务失败: ${message}`, "error");
    }
  }

  function reset() {
    applyQueue = Promise.resolve();
  }

  return {
    execute,
    reset
  };
}

function createJobScheduler(options = {}) {
  const getJobs = ensureFunction(options.getJobs, "getJobs");
  const executeJob = ensureFunction(options.executeJob, "executeJob");
  const onJobExecutionError = typeof options.onJobExecutionError === "function" ? options.onJobExecutionError : null;
  const onJobSettled = typeof options.onJobSettled === "function" ? options.onJobSettled : null;
  const onRunningCountChange = typeof options.onRunningCountChange === "function" ? options.onRunningCountChange : null;
  const nowProvider = typeof options.now === "function" ? options.now : Date.now;
  const maxConcurrentFallback = toPositiveInteger(options.maxConcurrent, 1);
  const getMaxConcurrent = typeof options.getMaxConcurrent === "function" ? options.getMaxConcurrent : null;
  const runnableStatuses = new Set(
    Array.isArray(options.runnableStatuses) && options.runnableStatuses.length > 0
      ? options.runnableStatuses
      : DEFAULT_RUNNABLE_STATUSES
  );

  let timerId = null;
  let runningCount = 0;

  function resolveMaxConcurrent() {
    if (!getMaxConcurrent) return maxConcurrentFallback;
    try {
      return toPositiveInteger(getMaxConcurrent(), maxConcurrentFallback);
    } catch (_) {
      return maxConcurrentFallback;
    }
  }

  function schedule(delayMs = 0) {
    const delay = Math.max(0, Number(delayMs) || 0);
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    timerId = setTimeout(() => {
      timerId = null;
      pump();
    }, delay);
  }

  function pickRunnableJob(now = nowProvider()) {
    const jobs = getJobs();
    if (!Array.isArray(jobs) || jobs.length === 0) return null;
    for (let i = 0; i < jobs.length; i += 1) {
      const job = jobs[i];
      if (!job || !runnableStatuses.has(job.status)) continue;
      const nextRunAt = Number(job.nextRunAt || 0);
      if (nextRunAt <= now) return job;
    }
    return null;
  }

  function findNextWakeDelay(now = nowProvider()) {
    const jobs = getJobs();
    if (!Array.isArray(jobs) || jobs.length === 0) return null;
    let nextAt = null;
    jobs.forEach((job) => {
      if (!job || !runnableStatuses.has(job.status)) return;
      const ts = Number(job.nextRunAt || 0);
      if (!Number.isFinite(ts) || ts <= now) return;
      if (nextAt === null || ts < nextAt) nextAt = ts;
    });
    return nextAt === null ? null : Math.max(0, nextAt - now);
  }

  function emitRunningCountChange() {
    if (onRunningCountChange) onRunningCountChange(runningCount);
  }

  function runJobInBackground(job) {
    runningCount += 1;
    emitRunningCountChange();

    let execution;
    try {
      execution = executeJob(job);
    } catch (error) {
      execution = Promise.reject(error);
    }

    Promise.resolve(execution)
      .catch((error) => {
        if (onJobExecutionError) onJobExecutionError(job, error);
      })
      .finally(() => {
        runningCount = Math.max(0, runningCount - 1);
        emitRunningCountChange();
        if (onJobSettled) onJobSettled(job);
        pump();
      });
  }

  function pump() {
    const now = nowProvider();
    while (runningCount < resolveMaxConcurrent()) {
      const nextJob = pickRunnableJob(now);
      if (!nextJob) break;
      runJobInBackground(nextJob);
    }

    const nextDelay = findNextWakeDelay(now);
    if (nextDelay !== null) {
      schedule(nextDelay);
    }
  }

  function dispose() {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function getRunningCount() {
    return runningCount;
  }

  return {
    pump,
    schedule,
    dispose,
    getRunningCount,
    resolveMaxConcurrent,
    pickRunnableJob,
    findNextWakeDelay
  };
}

module.exports = {
  createJobScheduler,
  createJobExecutor
};
