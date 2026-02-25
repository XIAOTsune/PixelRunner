const test = require("node:test");
const assert = require("node:assert/strict");
const { createRunWorkflowController } = require("../../../src/controllers/workspace/run-workflow-controller");

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

function createFixture(options = {}) {
  const state = {
    currentApp:
      options.currentApp === undefined
        ? { id: "app-1", name: "Portrait" }
        : options.currentApp,
    inputValues: options.inputValues || { prompt: "hello" },
    jobs: Array.isArray(options.jobs) ? options.jobs.slice() : [],
    nextJobSeq: Number(options.nextJobSeq) || 1,
    runButtonPhase: options.runButtonPhase || "IDLE"
  };

  const calls = {
    alerts: [],
    feedback: [],
    logs: [],
    promptLogs: [],
    setJobStatus: [],
    prune: 0,
    summary: 0,
    updateAccountStatus: 0,
    beginSubmit: 0,
    finishSubmit: 0,
    submitArgs: null,
    createExecutor: 0,
    createScheduler: 0,
    schedulerPump: 0,
    schedulerDispose: 0,
    executorReset: 0,
    runButton: {
      enterSubmittingGuard: 0,
      waitSubmittingMinDuration: 0,
      enterSubmittedAck: 0,
      recoverNow: 0
    }
  };
  const captured = {
    schedulerOptions: null,
    executorOptions: null
  };

  const runButtonCtrl = {
    isClickGuardActive: () => !!options.clickGuardActive,
    enterSubmittingGuard: () => {
      calls.runButton.enterSubmittingGuard += 1;
      state.runButtonPhase = "SUBMITTING_GUARD";
    },
    waitSubmittingMinDuration: async () => {
      calls.runButton.waitSubmittingMinDuration += 1;
    },
    enterSubmittedAck: () => {
      calls.runButton.enterSubmittedAck += 1;
      state.runButtonPhase = "SUBMITTED_ACK";
    },
    recoverNow: () => {
      calls.runButton.recoverNow += 1;
      state.runButtonPhase = "IDLE";
    }
  };

  const runGuard = {
    isSubmitInFlight: () => !!options.submitInFlight,
    beginSubmit: () => {
      calls.beginSubmit += 1;
      return options.beginSubmitResult !== false;
    },
    finishSubmit: () => {
      calls.finishSubmit += 1;
    }
  };

  const scheduler = {
    pump: () => {
      calls.schedulerPump += 1;
    },
    dispose: () => {
      calls.schedulerDispose += 1;
    }
  };
  const executor = {
    execute: async () => {},
    reset: () => {
      calls.executorReset += 1;
    }
  };

  const controller = createRunWorkflowController({
    state,
    store: {
      getApiKey: () => (options.apiKey === undefined ? "key-1" : options.apiKey),
      getSettings: () =>
        options.settings || {
          pollInterval: 2,
          timeout: 180,
          uploadMaxEdge: 0,
          pasteStrategy: "normal"
        }
    },
    runGuard,
    getRunButtonPhaseController: () => runButtonCtrl,
    runButtonPhaseEnum: {
      IDLE: "IDLE",
      SUBMITTING_GUARD: "SUBMITTING_GUARD",
      SUBMITTED_ACK: "SUBMITTED_ACK"
    },
    submitWorkspaceJobUsecase: (args) => {
      calls.submitArgs = args;
      if (typeof options.submitWorkspaceJobUsecase === "function") {
        return options.submitWorkspaceJobUsecase(args, state, calls);
      }
      return {
        job: {
          jobId: "J-1",
          appName: "Portrait",
          appItem: state.currentApp,
          inputValues: state.inputValues,
          status: JOB_STATUS.QUEUED
        },
        nextJobSeq: state.nextJobSeq + 1,
        duplicateHint: options.duplicateHint ? { type: "recent-fingerprint" } : null
      };
    },
    resolveTargetBounds: () => ({ left: 1, top: 2, width: 3, height: 4 }),
    resolveSourceImageBuffer: () => new Uint8Array([1, 2, 3]).buffer,
    runninghub: {},
    ps: {},
    setJobStatus: (job, status, reason = "") => {
      calls.setJobStatus.push({ job, status, reason });
      job.status = status;
      job.statusReason = reason;
    },
    cloneBounds: (value) => value,
    cloneArrayBuffer: (value) => value,
    createJobExecutor: (executorOptions) => {
      calls.createExecutor += 1;
      captured.executorOptions = executorOptions;
      return executor;
    },
    createJobScheduler: (schedulerOptions) => {
      calls.createScheduler += 1;
      captured.schedulerOptions = schedulerOptions;
      return scheduler;
    },
    updateTaskStatusSummary: () => {
      calls.summary += 1;
    },
    pruneJobHistory: () => {
      calls.prune += 1;
    },
    emitRunGuardFeedback: (message, level, ttlMs) => {
      calls.feedback.push({ message, level, ttlMs });
    },
    log: (message, level) => {
      calls.logs.push({ message, level });
    },
    logPromptLengthsBeforeRun: (appItem, inputValues, prefix) => {
      calls.promptLogs.push({ appItem, inputValues, prefix });
    },
    onJobCompleted: () => {
      calls.updateAccountStatus += 1;
    },
    jobStatus: JOB_STATUS,
    alert: (message) => {
      calls.alerts.push(String(message || ""));
    }
  });

  return {
    controller,
    state,
    calls,
    captured
  };
}

test("run workflow controller blocks run when api key is missing", async () => {
  const fixture = createFixture({
    apiKey: ""
  });
  const { controller, state, calls } = fixture;

  await controller.handleRun();

  assert.equal(calls.alerts.length, 1);
  assert.match(calls.alerts[0], /API Key/);
  assert.equal(calls.beginSubmit, 0);
  assert.equal(state.jobs.length, 0);
  assert.equal(calls.schedulerPump, 0);
});

test("run workflow controller short-circuits duplicate click guard feedback", async () => {
  const fixture = createFixture({
    submitInFlight: true
  });
  const { controller, calls, state } = fixture;

  await controller.handleRun();

  assert.equal(calls.feedback.length, 1);
  assert.match(calls.feedback[0].message, /任务已提交/);
  assert.equal(calls.beginSubmit, 0);
  assert.equal(calls.finishSubmit, 0);
  assert.equal(state.jobs.length, 0);
  assert.equal(calls.runButton.enterSubmittingGuard, 0);
});

test("run workflow controller submits job, emits duplicate hint and pumps scheduler", async () => {
  const fixture = createFixture({
    duplicateHint: true
  });
  const { controller, state, calls } = fixture;

  await controller.handleRun();

  assert.equal(state.jobs.length, 1);
  assert.equal(state.jobs[0].jobId, "J-1");
  assert.equal(state.nextJobSeq, 2);
  assert.equal(calls.beginSubmit, 1);
  assert.equal(calls.finishSubmit, 1);
  assert.equal(calls.runButton.enterSubmittingGuard, 1);
  assert.equal(calls.runButton.waitSubmittingMinDuration, 1);
  assert.equal(calls.runButton.enterSubmittedAck, 1);
  assert.equal(calls.createExecutor, 1);
  assert.equal(calls.createScheduler, 1);
  assert.equal(calls.schedulerPump, 1);
  assert.equal(calls.prune >= 1, true);
  assert.equal(calls.summary >= 1, true);
  assert.equal(calls.feedback.length, 2);
  assert.match(calls.feedback[0].message, /任务已提交到队列/);
  assert.match(calls.feedback[1].message, /短时间重复提交/);
  assert.equal(calls.logs.some((item) => /已加入后台队列/.test(item.message)), true);
  assert.equal(calls.promptLogs.length, 1);
  assert.equal(calls.promptLogs[0].prefix, "[Job:J-1]");
});

test("run workflow controller wires scheduler callbacks and disposes job services", () => {
  const fixture = createFixture();
  const { controller, calls, captured } = fixture;

  controller.pumpJobScheduler();
  assert.equal(calls.createExecutor, 1);
  assert.equal(calls.createScheduler, 1);
  assert.equal(calls.schedulerPump, 1);
  assert.equal(typeof captured.schedulerOptions.onRunningCountChange, "function");
  assert.equal(typeof captured.schedulerOptions.onJobExecutionError, "function");
  assert.equal(typeof captured.schedulerOptions.onJobSettled, "function");
  assert.equal(captured.schedulerOptions.maxConcurrent, 2);

  captured.schedulerOptions.onRunningCountChange();
  assert.equal(calls.summary, 1);

  const job = { jobId: "J-err" };
  captured.schedulerOptions.onJobExecutionError(job, new Error("boom"));
  assert.equal(calls.setJobStatus.length, 1);
  assert.equal(calls.setJobStatus[0].status, JOB_STATUS.FAILED);
  assert.equal(calls.setJobStatus[0].reason, "boom");
  assert.equal(calls.logs.some((item) => /任务失败: boom/.test(item.message)), true);

  captured.schedulerOptions.onJobSettled(job);
  assert.equal(calls.prune, 1);
  assert.equal(calls.summary, 2);

  assert.equal(typeof captured.executorOptions.onJobCompleted, "function");
  captured.executorOptions.onJobCompleted(job);
  assert.equal(calls.updateAccountStatus, 1);

  controller.dispose();
  assert.equal(calls.schedulerDispose, 1);
  assert.equal(calls.executorReset, 1);
});
