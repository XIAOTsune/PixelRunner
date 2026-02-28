const test = require("node:test");
const assert = require("node:assert/strict");
const { submitWorkspaceJobUsecase } = require("../../../src/application/usecases/submit-workspace-job");

test("submitWorkspaceJobUsecase keeps queueing job when fingerprint is recently submitted", () => {
  const calls = [];
  const runGuard = {
    buildRunFingerprint: () => "fp-1",
    isRecentDuplicateFingerprint: (fingerprint, now) => {
      calls.push(["isRecentDuplicateFingerprint", fingerprint, now]);
      return true;
    },
    rememberFingerprint: (fingerprint, now) => {
      calls.push(["rememberFingerprint", fingerprint, now]);
    }
  };

  const result = submitWorkspaceJobUsecase({
    runGuard,
    now: 123,
    createdAt: 456,
    nextJobSeq: 9,
    apiKey: "k",
    currentApp: { id: "app-1", name: "Demo App" },
    inputValues: { prompt: "hello" },
    targetBounds: null,
    sourceBuffer: null,
    placementTarget: {
      documentId: 12,
      sourceInputKey: "image:main",
      capturedAt: 1700000000000
    },
    settings: {},
    queuedStatus: "QUEUED",
    buildWorkspaceRunSnapshot: () => ({
      appItem: { id: "app-1", name: "Demo App" },
      inputValues: { prompt: "hello" },
      targetBounds: null,
      sourceBuffer: null,
      placementTarget: {
        documentId: 12,
        sourceInputKey: "image:main",
        capturedAt: 1700000000000
      },
      pasteStrategy: "normal",
      uploadMaxEdge: 0,
      pollSettings: { pollInterval: 2, timeout: 180 }
    })
  });

  assert.equal(result.outcome, "queued");
  assert.equal(result.nextJobSeq, 10);
  assert.equal(result.job.runFingerprint, "fp-1");
  assert.deepEqual(result.duplicateHint, {
    type: "recent-fingerprint",
    runFingerprint: "fp-1"
  });
  assert.deepEqual(result.job.placementTarget, {
    documentId: 12,
    sourceInputKey: "image:main",
    capturedAt: 1700000000000
  });
  assert.deepEqual(calls, [
    ["isRecentDuplicateFingerprint", "fp-1", 123],
    ["rememberFingerprint", "fp-1", 456]
  ]);
});

test("submitWorkspaceJobUsecase creates queued job and advances seq", () => {
  const calls = [];
  const runGuard = {
    buildRunFingerprint: () => "fp-2",
    isRecentDuplicateFingerprint: () => false,
    rememberFingerprint: (fingerprint, now) => {
      calls.push(["rememberFingerprint", fingerprint, now]);
    }
  };

  const snapshot = {
    appItem: { id: "app-1", name: "App A" },
    inputValues: { prompt: "run" },
    targetBounds: { left: 1, top: 2, right: 3, bottom: 4 },
    sourceBuffer: new Uint8Array([1, 2, 3]).buffer,
    placementTarget: {
      documentId: 66,
      sourceInputKey: "img",
      capturedAt: 1700000000999
    },
    pasteStrategy: "smart",
    uploadMaxEdge: 2048,
    pollSettings: { pollInterval: 5, timeout: 240 }
  };

  const result = submitWorkspaceJobUsecase({
    runGuard,
    now: 1000,
    createdAt: 1500,
    nextJobSeq: 3,
    apiKey: "api-key",
    currentApp: { id: "app-1", name: "App A" },
    inputValues: { prompt: "run" },
    targetBounds: { left: 1, top: 2, right: 3, bottom: 4 },
    sourceBuffer: snapshot.sourceBuffer,
    placementTarget: snapshot.placementTarget,
    settings: {},
    queuedStatus: "QUEUED",
    buildWorkspaceRunSnapshot: () => snapshot
  });

  assert.equal(result.outcome, "queued");
  assert.equal(result.nextJobSeq, 4);
  assert.equal(result.job.jobId, "J1500-3");
  assert.equal(result.job.status, "QUEUED");
  assert.equal(result.job.apiKey, "api-key");
  assert.equal(result.job.appName, "App A");
  assert.equal(result.job.runFingerprint, "fp-2");
  assert.equal(result.duplicateHint, null);
  assert.deepEqual(result.job.placementTarget, {
    documentId: 66,
    sourceInputKey: "img",
    capturedAt: 1700000000999
  });
  assert.deepEqual(result.job.pollSettings, { pollInterval: 5, timeout: 240 });
  assert.deepEqual(calls, [["rememberFingerprint", "fp-2", 1500]]);
});
