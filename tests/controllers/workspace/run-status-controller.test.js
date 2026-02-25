const test = require("node:test");
const assert = require("node:assert/strict");
const { createRunStatusController } = require("../../../src/controllers/workspace/run-status-controller");

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

function createState(overrides = {}) {
  return {
    jobs: [],
    taskSummaryTimerId: null,
    taskSummaryHintText: "",
    taskSummaryHintType: "info",
    taskSummaryHintUntil: 0,
    taskSummaryHintTimerId: null,
    ...overrides
  };
}

test("run status controller renders summary and controls ticker for live jobs", () => {
  const state = createState({
    jobs: [{ jobId: "J-1", status: JOB_STATUS.QUEUED, createdAt: 1 }]
  });
  const summaryEl = {};
  const calls = {
    render: 0,
    setInterval: 0,
    clearInterval: 0
  };

  const timerToken = { id: "ticker-1" };
  let tickerFn = null;

  const controller = createRunStatusController({
    state,
    dom: { taskStatusSummary: summaryEl },
    jobStatus: JOB_STATUS,
    hasLiveJobs: (jobs, statusMap) =>
      jobs.some((job) => job && ![statusMap.DONE, statusMap.FAILED].includes(job.status)),
    buildTaskSummaryViewModel: (options) => ({
      text: options.resolveJobStatusLabel(options.jobs[0].status),
      title: "",
      tone: "default"
    }),
    renderTaskSummary: (el, viewModel) => {
      calls.render += 1;
      el.viewModel = viewModel;
    },
    setIntervalFn: (fn, intervalMs) => {
      calls.setInterval += 1;
      tickerFn = fn;
      assert.equal(intervalMs, 100);
      return timerToken;
    },
    clearIntervalFn: (timerId) => {
      calls.clearInterval += 1;
      assert.equal(timerId, timerToken);
    }
  });

  controller.updateTaskStatusSummary();
  assert.equal(summaryEl.viewModel.text, "排队");
  assert.equal(calls.render, 1);
  assert.equal(calls.setInterval, 1);
  assert.equal(state.taskSummaryTimerId, timerToken);

  controller.updateTaskStatusSummary();
  assert.equal(calls.setInterval, 1);

  state.jobs = [{ jobId: "J-1", status: JOB_STATUS.DONE, createdAt: 1 }];
  assert.equal(typeof tickerFn, "function");
  tickerFn();

  assert.equal(calls.clearInterval, 1);
  assert.equal(state.taskSummaryTimerId, null);
});

test("run status controller manages hint lifecycle and auto-clears on timeout", () => {
  const state = createState();
  const summaryEl = {};
  const calls = {
    render: 0
  };

  let now = 1000;
  let timeoutFn = null;
  let scheduledDelay = 0;
  let clearedTimeoutId = null;

  const controller = createRunStatusController({
    state,
    dom: { taskStatusSummary: summaryEl },
    jobStatus: JOB_STATUS,
    hasLiveJobs: () => false,
    buildTaskSummaryViewModel: (options) => ({
      text: options.hint ? options.hint.text : "",
      title: "",
      tone: options.hint ? options.hint.type : "default"
    }),
    renderTaskSummary: (el, viewModel) => {
      calls.render += 1;
      el.viewModel = viewModel;
    },
    now: () => now,
    setTimeoutFn: (fn, delay) => {
      timeoutFn = fn;
      scheduledDelay = delay;
      return "hint-timeout-id";
    },
    clearTimeoutFn: (timerId) => {
      clearedTimeoutId = timerId;
    }
  });

  controller.setTaskSummaryHint("最近操作：提交成功", "warn", 900);

  assert.equal(state.taskSummaryHintText, "最近操作：提交成功");
  assert.equal(state.taskSummaryHintType, "warn");
  assert.equal(state.taskSummaryHintUntil, 1900);
  assert.equal(state.taskSummaryHintTimerId, "hint-timeout-id");
  assert.equal(scheduledDelay, 920);
  assert.equal(calls.render, 1);
  assert.equal(summaryEl.viewModel.text, "最近操作：提交成功");

  now = 2000;
  assert.equal(typeof timeoutFn, "function");
  timeoutFn();

  assert.equal(state.taskSummaryHintText, "");
  assert.equal(state.taskSummaryHintType, "info");
  assert.equal(state.taskSummaryHintUntil, 0);
  assert.equal(state.taskSummaryHintTimerId, null);
  assert.equal(clearedTimeoutId, "hint-timeout-id");
  assert.equal(calls.render, 2);
  assert.equal(summaryEl.viewModel.text, "");
});

test("run status controller updates job status and prunes history with active priority", () => {
  const state = createState({
    jobs: [
      { jobId: "A", status: JOB_STATUS.REMOTE_RUNNING, createdAt: 30 },
      { jobId: "B", status: JOB_STATUS.DONE, createdAt: 29 },
      { jobId: "C", status: JOB_STATUS.FAILED, createdAt: 28 },
      { jobId: "D", status: JOB_STATUS.QUEUED, createdAt: 27 },
      { jobId: "E", status: JOB_STATUS.DONE, createdAt: 26 }
    ]
  });
  const summaryEl = {};
  let now = 7777;
  let renderCount = 0;

  const controller = createRunStatusController({
    state,
    dom: { taskStatusSummary: summaryEl },
    jobStatus: JOB_STATUS,
    hasLiveJobs: () => false,
    buildTaskSummaryViewModel: () => ({ text: "", title: "", tone: "default" }),
    renderTaskSummary: () => {
      renderCount += 1;
    },
    now: () => now,
    maxHistory: 3
  });

  controller.setJobStatus(state.jobs[0], JOB_STATUS.TIMEOUT_TRACKING, "network timeout");

  assert.equal(state.jobs[0].status, JOB_STATUS.TIMEOUT_TRACKING);
  assert.equal(state.jobs[0].statusReason, "network timeout");
  assert.equal(state.jobs[0].updatedAt, 7777);
  assert.equal(renderCount, 1);

  now = 9999;
  controller.pruneJobHistory();

  assert.deepEqual(
    state.jobs.map((job) => job.jobId),
    ["A", "B", "D"]
  );
  assert.equal(state.jobs.length, 3);
});

test("run status controller dispose clears timer resources and hint state", () => {
  const state = createState({
    taskSummaryTimerId: "summary-timer-id",
    taskSummaryHintText: "hint",
    taskSummaryHintType: "warn",
    taskSummaryHintUntil: 1234,
    taskSummaryHintTimerId: "hint-timer-id"
  });
  const cleared = {
    intervals: [],
    timeouts: []
  };

  const controller = createRunStatusController({
    state,
    dom: {},
    jobStatus: JOB_STATUS,
    clearIntervalFn: (timerId) => {
      cleared.intervals.push(timerId);
    },
    clearTimeoutFn: (timerId) => {
      cleared.timeouts.push(timerId);
    }
  });

  controller.dispose();

  assert.deepEqual(cleared.intervals, ["summary-timer-id"]);
  assert.deepEqual(cleared.timeouts, ["hint-timer-id"]);
  assert.equal(state.taskSummaryTimerId, null);
  assert.equal(state.taskSummaryHintText, "");
  assert.equal(state.taskSummaryHintType, "info");
  assert.equal(state.taskSummaryHintUntil, 0);
  assert.equal(state.taskSummaryHintTimerId, null);
});
