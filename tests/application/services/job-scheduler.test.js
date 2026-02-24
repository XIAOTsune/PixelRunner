const test = require("node:test");
const assert = require("node:assert/strict");
const { createJobScheduler, createJobExecutor } = require("../../../src/application/services/job-scheduler");

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("job scheduler respects max concurrency and continues pumping", async () => {
  const jobs = [
    { id: "j1", status: "QUEUED", nextRunAt: 0 },
    { id: "j2", status: "QUEUED", nextRunAt: 0 },
    { id: "j3", status: "QUEUED", nextRunAt: 0 }
  ];
  const started = [];
  const resolvers = {};

  const scheduler = createJobScheduler({
    getJobs: () => jobs,
    maxConcurrent: 2,
    executeJob: (job) => {
      started.push(job.id);
      job.status = "RUNNING";
      return new Promise((resolve) => {
        resolvers[job.id] = resolve;
      });
    }
  });

  scheduler.pump();
  assert.deepEqual(started, ["j1", "j2"]);

  resolvers.j1();
  await flushAsync();
  assert.deepEqual(started, ["j1", "j2", "j3"]);

  resolvers.j2();
  resolvers.j3();
  await flushAsync();
  assert.equal(scheduler.getRunningCount(), 0);

  scheduler.dispose();
});

test("job scheduler wakes delayed runnable jobs", async () => {
  const jobs = [
    {
      id: "j-delay",
      status: "QUEUED",
      nextRunAt: Date.now() + 30
    }
  ];
  let executeCount = 0;

  const scheduler = createJobScheduler({
    getJobs: () => jobs,
    maxConcurrent: 1,
    executeJob: async (job) => {
      executeCount += 1;
      job.status = "DONE";
    }
  });

  scheduler.pump();
  assert.equal(executeCount, 0);

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(executeCount, 1);

  scheduler.dispose();
});

test("job executor converts timeout-like errors into tracking retries", async () => {
  const statusHistory = [];
  const job = {
    remoteTaskId: "remote-1",
    timeoutRecoveries: 0,
    nextRunAt: 0,
    pollSettings: { pollInterval: 2, timeout: 180 },
    uploadMaxEdge: 0,
    sourceBuffer: null,
    targetBounds: null,
    pasteStrategy: "normal",
    appItem: { id: "app-1" },
    inputValues: {},
    apiKey: "k"
  };

  const executor = createJobExecutor({
    runninghub: {
      runAppTask: async () => "unused",
      pollTaskOutput: async () => {
        throw new Error("request timeout");
      },
      downloadResultBinary: async () => new ArrayBuffer(8)
    },
    ps: {
      placeImage: async () => {}
    },
    setJobStatus: (targetJob, status, reason = "") => {
      targetJob.status = status;
      targetJob.statusReason = reason;
      statusHistory.push(status);
    },
    createJobLogger: () => () => {},
    cloneBounds: (bounds) => bounds,
    cloneArrayBuffer: (buffer) => buffer,
    isJobTimeoutLikeError: () => true,
    jobStatus: {
      SUBMITTING: "SUBMITTING",
      REMOTE_RUNNING: "REMOTE_RUNNING",
      DOWNLOADING: "DOWNLOADING",
      APPLYING: "APPLYING",
      DONE: "DONE",
      FAILED: "FAILED",
      TIMEOUT_TRACKING: "TIMEOUT_TRACKING"
    },
    timeoutRetryDelayMs: 15000,
    maxTimeoutRecoveries: 2
  });

  const before = Date.now();
  await executor.execute(job);

  assert.deepEqual(statusHistory, ["REMOTE_RUNNING", "TIMEOUT_TRACKING"]);
  assert.equal(job.timeoutRecoveries, 1);
  assert.equal(job.status, "TIMEOUT_TRACKING");
  assert.ok(job.nextRunAt >= before + 14000);
});
