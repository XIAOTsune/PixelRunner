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

test("job scheduler can resolve concurrency from dynamic getter", async () => {
  const jobs = [
    { id: "j1", status: "QUEUED", nextRunAt: 0 },
    { id: "j2", status: "QUEUED", nextRunAt: 0 }
  ];
  const started = [];
  const resolvers = {};
  let maxConcurrent = 1;

  const scheduler = createJobScheduler({
    getJobs: () => jobs,
    maxConcurrent: 2,
    getMaxConcurrent: () => maxConcurrent,
    executeJob: (job) => {
      started.push(job.id);
      job.status = "RUNNING";
      return new Promise((resolve) => {
        resolvers[job.id] = resolve;
      });
    }
  });

  scheduler.pump();
  assert.deepEqual(started, ["j1"]);
  assert.equal(scheduler.resolveMaxConcurrent(), 1);

  maxConcurrent = 2;
  scheduler.pump();
  assert.deepEqual(started, ["j1", "j2"]);
  assert.equal(scheduler.resolveMaxConcurrent(), 2);

  resolvers.j1();
  resolvers.j2();
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

test("job executor forwards placementTarget to ps.placeImage", async () => {
  const statusHistory = [];
  const downloadedBuffer = new Uint8Array([9, 8, 7]).buffer;
  const placeCalls = [];
  const job = {
    remoteTaskId: "",
    timeoutRecoveries: 0,
    nextRunAt: 0,
    pollSettings: { pollInterval: 2, timeout: 180 },
    uploadMaxEdge: 0,
    uploadRetryCount: 0,
    sourceBuffer: new Uint8Array([1, 2, 3]).buffer,
    targetBounds: { left: 1, top: 2, right: 11, bottom: 12 },
    placementTarget: {
      documentId: 321,
      sourceInputKey: "image:main",
      capturedAt: 1700000000000
    },
    pasteStrategy: "smart",
    appItem: { id: "app-1" },
    inputValues: { prompt: "hello" },
    apiKey: "k"
  };

  const executor = createJobExecutor({
    runninghub: {
      runAppTask: async () => "remote-2",
      pollTaskOutput: async () => "https://example.com/result.png",
      downloadResultBinary: async () => downloadedBuffer
    },
    ps: {
      placeImage: async (buffer, placeOptions) => {
        placeCalls.push({ buffer, placeOptions });
      }
    },
    setJobStatus: (targetJob, status) => {
      targetJob.status = status;
      statusHistory.push(status);
    },
    createJobLogger: () => () => {},
    cloneBounds: (bounds) => (bounds ? { ...bounds } : null),
    cloneArrayBuffer: (buffer) => (buffer instanceof ArrayBuffer ? buffer.slice(0) : null),
    isJobTimeoutLikeError: () => false,
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

  await executor.execute(job);

  assert.deepEqual(statusHistory, ["SUBMITTING", "REMOTE_RUNNING", "DOWNLOADING", "APPLYING", "DONE"]);
  assert.equal(job.remoteTaskId, "remote-2");
  assert.equal(job.status, "DONE");
  assert.equal(placeCalls.length, 1);
  assert.equal(placeCalls[0].buffer, downloadedBuffer);
  assert.deepEqual(placeCalls[0].placeOptions.placementTarget, {
    documentId: 321,
    sourceInputKey: "image:main",
    capturedAt: 1700000000000
  });
  assert.deepEqual(placeCalls[0].placeOptions.targetBounds, { left: 1, top: 2, right: 11, bottom: 12 });
  assert.notEqual(placeCalls[0].placeOptions.targetBounds, job.targetBounds);
});
