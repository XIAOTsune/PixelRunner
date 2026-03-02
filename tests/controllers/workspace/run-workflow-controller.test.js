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
          uploadTargetBytes: 9_000_000,
          uploadHardLimitBytes: 10_000_000,
          uploadAutoCompressEnabled: true,
          uploadCompressFormat: "jpeg",
          pasteStrategy: "normal",
          cloudConcurrentJobs: 2
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
    resolvePlacementTarget:
      typeof options.resolvePlacementTarget === "function"
        ? options.resolvePlacementTarget
        : () => ({
            documentId: 9,
            sourceInputKey: "image:main",
            capturedAt: 1700000000000
          }),
    runninghub: {},
    ps: options.ps || {},
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
    getLocalMaxConcurrentJobs: options.getLocalMaxConcurrentJobs,
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

function createImageValue(bytes, options = {}) {
  const safeBytes = Math.max(1, Number(bytes) || 1);
  const bitDepth = Number.isFinite(Number(options.bitDepth)) ? Number(options.bitDepth) : 8;
  return {
    arrayBuffer: new Uint8Array(safeBytes).buffer,
    captureContext: options.captureContext || {
      documentId: 11,
      documentTitle: "Doc-A",
      capturedAt: 1700000000000
    },
    sourceMeta: {
      mime: "image/png",
      bytes: safeBytes,
      width: 100,
      height: 100,
      bitDepth
    },
    uploadMeta: {
      mime: "image/png",
      bytes: safeBytes,
      width: 100,
      height: 100,
      bitDepth,
      risk: "unknown"
    },
    compressionTrace: {
      applied: false,
      format: "jpeg",
      quality: null,
      maxEdge: null,
      attempts: 0,
      durationMs: 0,
      beforeBytes: safeBytes,
      afterBytes: safeBytes,
      outcome: "not-applied"
    }
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
  assert.deepEqual(calls.submitArgs.placementTarget, {
    documentId: 9,
    sourceInputKey: "image:main",
    capturedAt: 1700000000000
  });
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
  assert.equal(typeof captured.schedulerOptions.getMaxConcurrent, "function");
  assert.equal(captured.schedulerOptions.getMaxConcurrent(), 2);

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

test("run workflow controller forwards dynamic local concurrency getter to scheduler", () => {
  let currentLimit = 6;
  const fixture = createFixture({
    getLocalMaxConcurrentJobs: () => currentLimit
  });
  const { controller, captured } = fixture;

  controller.pumpJobScheduler();

  assert.equal(typeof captured.schedulerOptions.getMaxConcurrent, "function");
  assert.equal(captured.schedulerOptions.getMaxConcurrent(), 6);
  currentLimit = 9;
  assert.equal(captured.schedulerOptions.getMaxConcurrent(), 9);
});

test("run workflow controller logs warning when placement target is missing", async () => {
  const fixture = createFixture({
    resolvePlacementTarget: () => null
  });
  const { controller, calls } = fixture;

  await controller.handleRun();

  assert.equal(
    calls.logs.some(
      (item) =>
        item.level === "warn" &&
        /placement target unresolved, fallback to current active document/.test(item.message)
    ),
    true
  );
});

test("run workflow controller preflight forces auto compress even when setting is disabled", async () => {
  const compressCalls = [];
  const fixture = createFixture({
    currentApp: {
      id: "app-1",
      name: "Portrait",
      inputs: [{ key: "image:main", label: "main", type: "image", required: true }]
    },
    inputValues: {
      "image:main": createImageValue(1_500_000)
    },
    settings: {
      pollInterval: 2,
      timeout: 180,
      uploadTargetBytes: 1_200_000,
      uploadHardLimitBytes: 2_000_000,
      uploadAutoCompressEnabled: false,
      uploadCompressFormat: "jpeg",
      pasteStrategy: "normal",
      cloudConcurrentJobs: 2
    },
    ps: {
      compressCapturedSelection: async (args) => {
        compressCalls.push(args);
        return {
          applied: true,
          arrayBuffer: new Uint8Array([1, 2, 3, 4, 5]).buffer,
          uploadMeta: {
            mime: "image/jpeg",
            bytes: 5,
            width: 100,
            height: 100,
            bitDepth: 8
          },
          compressionTrace: {
            applied: true,
            format: "jpeg",
            quality: 8,
            maxEdge: 4096,
            attempts: 2,
            durationMs: 30,
            beforeBytes: 1_500_000,
            afterBytes: 5,
            outcome: "satisfied"
          }
        };
      }
    }
  });
  const { controller, calls, state } = fixture;

  await controller.handleRun();

  assert.equal(compressCalls.length, 1);
  assert.ok(calls.submitArgs);
  assert.equal(state.jobs.length, 1);
  assert.equal(calls.logs.some((item) => /uploadAutoCompressEnabled=false ignored/.test(item.message)), true);
});

test("run workflow controller preflight auto compresses risky image and then submits", async () => {
  const compressCalls = [];
  const fixture = createFixture({
    currentApp: {
      id: "app-1",
      name: "Portrait",
      inputs: [{ key: "image:main", label: "主图", type: "image", required: true }]
    },
    inputValues: {
      "image:main": createImageValue(1_500_000)
    },
    settings: {
      pollInterval: 2,
      timeout: 180,
      uploadTargetBytes: 1_200_000,
      uploadHardLimitBytes: 2_000_000,
      uploadAutoCompressEnabled: true,
      uploadCompressFormat: "jpeg",
      pasteStrategy: "normal",
      cloudConcurrentJobs: 2
    },
    ps: {
      compressCapturedSelection: async (args) => {
        compressCalls.push(args);
        return {
          applied: true,
          arrayBuffer: new Uint8Array([1, 2, 3, 4, 5]).buffer,
          uploadMeta: {
            mime: "image/jpeg",
            bytes: 5,
            width: 100,
            height: 100,
            bitDepth: 8
          },
          compressionTrace: {
            applied: true,
            format: "jpeg",
            quality: 8,
            maxEdge: 4096,
            attempts: 2,
            durationMs: 30,
            beforeBytes: 1_500_000,
            afterBytes: 5,
            outcome: "satisfied"
          }
        };
      }
    }
  });
  const { controller, calls, state } = fixture;

  await controller.handleRun();

  assert.equal(compressCalls.length, 1);
  assert.ok(calls.submitArgs);
  assert.equal(state.jobs.length, 1);
  assert.equal(state.inputValues["image:main"].arrayBuffer.byteLength, 5);
  assert.equal(state.inputValues["image:main"].sourceMeta.mime, "image/png");
  assert.equal(state.inputValues["image:main"].sourceMeta.bytes, 1_500_000);
  assert.equal(state.inputValues["image:main"].uploadMeta.mime, "image/jpeg");
  assert.equal(state.inputValues["image:main"].uploadMeta.bytes, 5);
  assert.equal(state.inputValues["image:main"].uploadMeta.risk, "safe");
  assert.equal(calls.logs.some((item) => /\[Preflight\].*compressed to/.test(item.message)), true);
});

test("run workflow controller preflight blocks when compression result is still blocked", async () => {
  const fixture = createFixture({
    currentApp: {
      id: "app-1",
      name: "Portrait",
      inputs: [{ key: "image:main", label: "主图", type: "image", required: true }]
    },
    inputValues: {
      "image:main": createImageValue(2_500_000)
    },
    settings: {
      pollInterval: 2,
      timeout: 180,
      uploadTargetBytes: 1_200_000,
      uploadHardLimitBytes: 2_000_000,
      uploadAutoCompressEnabled: true,
      uploadCompressFormat: "jpeg",
      pasteStrategy: "normal",
      cloudConcurrentJobs: 2
    },
    ps: {
      compressCapturedSelection: async () => ({
        applied: true,
        arrayBuffer: new Uint8Array(2_100_000).buffer,
        uploadMeta: {
          mime: "image/jpeg",
          bytes: 2_100_000,
          width: 100,
          height: 100,
          bitDepth: 8
        },
        compressionTrace: {
          applied: true,
          format: "jpeg",
          quality: 4,
          maxEdge: 2048,
          attempts: 8,
          durationMs: 200,
          beforeBytes: 2_500_000,
          afterBytes: 2_100_000,
          outcome: "satisfied"
        }
      })
    }
  });
  const { controller, calls, state } = fixture;

  await controller.handleRun();

  assert.equal(state.jobs.length, 0);
  assert.equal(calls.submitArgs, null);
  assert.equal(calls.feedback.some((item) => /硬上限|超过/.test(item.message)), true);
});

test("run workflow controller preflight keeps bit-depth as warning only", async () => {
  const fixture = createFixture({
    currentApp: {
      id: "app-1",
      name: "Portrait",
      inputs: [{ key: "image:main", label: "主图", type: "image", required: true }]
    },
    inputValues: {
      "image:main": createImageValue(1_100_000, { bitDepth: 16 })
    },
    settings: {
      pollInterval: 2,
      timeout: 180,
      uploadTargetBytes: 1_200_000,
      uploadHardLimitBytes: 2_000_000,
      uploadAutoCompressEnabled: false,
      uploadCompressFormat: "jpeg",
      pasteStrategy: "normal",
      cloudConcurrentJobs: 2
    }
  });
  const { controller, calls, state } = fixture;

  await controller.handleRun();

  assert.ok(calls.submitArgs);
  assert.equal(state.jobs.length, 1);
  assert.equal(
    calls.logs.some((item) => item.level === "warn" && /bit depth 16-bit \(提示，不阻断\)/.test(item.message)),
    true
  );
});

