function getJobElapsedSeconds(job, now = Date.now()) {
  const start = Number((job && (job.startedAt || job.createdAt)) || 0);
  if (!Number.isFinite(start) || start <= 0) return "0.00";
  const elapsed = Math.max(0, (now - start) / 1000);
  return elapsed.toFixed(2);
}

function resolveStatusMap(jobStatus = {}) {
  const source = jobStatus && typeof jobStatus === "object" ? jobStatus : {};
  return {
    QUEUED: source.QUEUED || "QUEUED",
    SUBMITTING: source.SUBMITTING || "SUBMITTING",
    REMOTE_RUNNING: source.REMOTE_RUNNING || "REMOTE_RUNNING",
    DOWNLOADING: source.DOWNLOADING || "DOWNLOADING",
    APPLYING: source.APPLYING || "APPLYING",
    TIMEOUT_TRACKING: source.TIMEOUT_TRACKING || "TIMEOUT_TRACKING",
    DONE: source.DONE || "DONE",
    FAILED: source.FAILED || "FAILED"
  };
}

function hasLiveJobs(jobs, jobStatus = {}) {
  const status = resolveStatusMap(jobStatus);
  const list = Array.isArray(jobs) ? jobs : [];
  return list.some((job) => ![status.DONE, status.FAILED].includes(job && job.status));
}

function countJobsByStatus(jobs, targetStatus) {
  if (!Array.isArray(jobs) || !targetStatus) return 0;
  return jobs.filter((job) => job && job.status === targetStatus).length;
}

function collectTaskSummaryStats(options = {}) {
  const status = resolveStatusMap(options.jobStatus);
  const jobs = Array.isArray(options.jobs) ? options.jobs : [];
  const hint = options.hint && typeof options.hint === "object" ? options.hint : null;
  const previewLimit = Math.max(1, Number(options.previewLimit) || 8);
  const activeLimit = Math.max(1, Number(options.activeLimit) || 6);
  const runningStatuses = [status.SUBMITTING, status.REMOTE_RUNNING, status.DOWNLOADING, status.APPLYING];

  const running = jobs.filter((job) => runningStatuses.includes(job && job.status)).length;
  const queued = countJobsByStatus(jobs, status.QUEUED);
  const timeout = countJobsByStatus(jobs, status.TIMEOUT_TRACKING);
  const done = countJobsByStatus(jobs, status.DONE);
  const failed = countJobsByStatus(jobs, status.FAILED);
  const activeJobs = jobs.filter((job) => ![status.DONE, status.FAILED].includes(job && job.status));
  const hasWarning = failed > 0 || timeout > 0 || (hint && hint.type === "warn");
  const hasSuccess = !hasWarning && failed === 0 && timeout === 0 && running === 0 && queued === 0 && done > 0;

  return {
    isEmpty: jobs.length === 0,
    running,
    queued,
    timeout,
    done,
    failed,
    activeJobs,
    activePreviewJobs: activeJobs.slice(0, activeLimit),
    previewJobs: jobs.slice(0, previewLimit),
    hasWarning,
    hasSuccess
  };
}

function buildTaskSummaryViewModel(options = {}) {
  const now = Number(options.now) || Date.now();
  const hint = options.hint && typeof options.hint === "object" ? options.hint : null;
  const stats =
    options.stats && typeof options.stats === "object"
      ? options.stats
      : collectTaskSummaryStats({
          jobs: options.jobs,
          hint,
          jobStatus: options.jobStatus,
          activeLimit: options.activeLimit,
          previewLimit: options.previewLimit
        });
  const resolveJobStatusLabel =
    typeof options.resolveJobStatusLabel === "function"
      ? options.resolveJobStatusLabel
      : (status) => String(status || "-");

  if (stats.isEmpty) {
    const lines = ["后台任务：无"];
    if (hint) lines.push(String(hint.text || ""));
    let tone = "default";
    if (hint && hint.type === "warn") {
      tone = "warning";
    } else if (hint && hint.type === "info") {
      tone = "info";
    }
    return {
      text: lines.join("\n"),
      title: "",
      tone
    };
  }

  const line1 =
    `后台任务：运行 ${stats.running}｜排队 ${stats.queued}｜完成 ${stats.done}｜失败 ${stats.failed}` +
    (stats.timeout > 0 ? `｜超时跟踪 ${stats.timeout}` : "");
  const line2 =
    stats.activePreviewJobs.length > 0
      ? stats.activePreviewJobs
          .map((job) => `${job.jobId} ${resolveJobStatusLabel(job.status)} ${getJobElapsedSeconds(job, now)}s`)
          .join("｜")
      : "";
  const lines = [line1];
  if (line2) lines.push(line2);
  if (hint) lines.push(String(hint.text || ""));

  const preview = stats.previewJobs.map(
    (job) =>
      `${job.jobId} | ${job.appName || "-"} | ${resolveJobStatusLabel(job.status)} | ${getJobElapsedSeconds(job, now)}s${
        job.remoteTaskId ? ` | ${job.remoteTaskId}` : ""
      }`
  );
  if (hint) preview.unshift(`Hint | ${hint.text}`);

  let tone = "default";
  if (stats.hasWarning) {
    tone = "warning";
  } else if (stats.hasSuccess) {
    tone = "success";
  } else if (hint && hint.type === "info") {
    tone = "info";
  }

  return {
    text: lines.join("\n"),
    title: preview.join("\n"),
    tone
  };
}

module.exports = {
  getJobElapsedSeconds,
  hasLiveJobs,
  collectTaskSummaryStats,
  buildTaskSummaryViewModel
};
