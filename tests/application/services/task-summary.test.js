const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getJobElapsedSeconds,
  hasLiveJobs,
  collectTaskSummaryStats,
  buildTaskSummaryViewModel
} = require("../../../src/application/services/task-summary");

test("getJobElapsedSeconds returns fixed seconds and handles invalid start", () => {
  assert.equal(getJobElapsedSeconds({}, 1000), "0.00");
  assert.equal(
    getJobElapsedSeconds(
      {
        startedAt: 500
      },
      3000
    ),
    "2.50"
  );
});

test("hasLiveJobs ignores done/failed and detects active jobs", () => {
  const status = { DONE: "DONE", FAILED: "FAILED" };
  assert.equal(
    hasLiveJobs(
      [
        { status: "DONE" },
        { status: "FAILED" }
      ],
      status
    ),
    false
  );
  assert.equal(
    hasLiveJobs(
      [
        { status: "DONE" },
        { status: "QUEUED" }
      ],
      status
    ),
    true
  );
});

test("collectTaskSummaryStats aggregates counts, previews and warning state", () => {
  const jobStatus = {
    QUEUED: "QUEUED",
    SUBMITTING: "SUBMITTING",
    REMOTE_RUNNING: "REMOTE_RUNNING",
    DOWNLOADING: "DOWNLOADING",
    APPLYING: "APPLYING",
    TIMEOUT_TRACKING: "TIMEOUT_TRACKING",
    DONE: "DONE",
    FAILED: "FAILED"
  };
  const jobs = [
    { status: "SUBMITTING", jobId: "j1" },
    { status: "QUEUED", jobId: "j2" },
    { status: "TIMEOUT_TRACKING", jobId: "j3" },
    { status: "DONE", jobId: "j4" },
    { status: "FAILED", jobId: "j5" }
  ];

  const stats = collectTaskSummaryStats({
    jobs,
    jobStatus,
    hint: { type: "info", text: "ok" },
    activeLimit: 2,
    previewLimit: 3
  });

  assert.equal(stats.isEmpty, false);
  assert.equal(stats.running, 1);
  assert.equal(stats.queued, 1);
  assert.equal(stats.timeout, 1);
  assert.equal(stats.done, 1);
  assert.equal(stats.failed, 1);
  assert.equal(stats.activeJobs.length, 3);
  assert.equal(stats.activePreviewJobs.length, 2);
  assert.equal(stats.previewJobs.length, 3);
  assert.equal(stats.hasWarning, true);
  assert.equal(stats.hasSuccess, false);
});

test("collectTaskSummaryStats marks success only for fully settled success jobs", () => {
  const stats = collectTaskSummaryStats({
    jobs: [
      { status: "DONE", jobId: "j1" },
      { status: "DONE", jobId: "j2" }
    ],
    hint: { type: "info", text: "done" }
  });

  assert.equal(stats.isEmpty, false);
  assert.equal(stats.running, 0);
  assert.equal(stats.queued, 0);
  assert.equal(stats.timeout, 0);
  assert.equal(stats.failed, 0);
  assert.equal(stats.hasWarning, false);
  assert.equal(stats.hasSuccess, true);
});

test("buildTaskSummaryViewModel builds empty-state text and info tone", () => {
  const vm = buildTaskSummaryViewModel({
    jobs: [],
    hint: { type: "info", text: "最近操作：任务已提交" }
  });

  assert.equal(vm.tone, "info");
  assert.equal(vm.title, "");
  assert.match(vm.text, /后台任务：无/);
  assert.match(vm.text, /最近操作：任务已提交/);
});

test("buildTaskSummaryViewModel builds summary lines and preview title", () => {
  const now = 5000;
  const vm = buildTaskSummaryViewModel({
    now,
    hint: { type: "warn", text: "任务超时" },
    jobs: [
      {
        jobId: "J1",
        appName: "App1",
        status: "QUEUED",
        startedAt: 3000
      },
      {
        jobId: "J2",
        appName: "App2",
        status: "DONE",
        startedAt: 0,
        remoteTaskId: "remote-2"
      }
    ],
    resolveJobStatusLabel: (status) => {
      if (status === "QUEUED") return "排队";
      if (status === "DONE") return "完成";
      return status || "-";
    }
  });

  assert.equal(vm.tone, "warning");
  assert.match(vm.text, /后台任务：运行 0｜排队 1｜完成 1｜失败 0/);
  assert.match(vm.text, /J1 排队 2.00s/);
  assert.match(vm.title, /Hint \| 任务超时/);
  assert.match(vm.title, /J2 \| App2 \| 完成 \| 0.00s \| remote-2/);
});
