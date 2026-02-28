const { buildWorkspaceRunSnapshot } = require("../services/workspace-run-snapshot");

function ensureRunGuard(runGuard) {
  if (!runGuard || typeof runGuard !== "object") {
    throw new Error("submitWorkspaceJobUsecase requires runGuard");
  }
  if (typeof runGuard.buildRunFingerprint !== "function") {
    throw new Error("submitWorkspaceJobUsecase requires runGuard.buildRunFingerprint");
  }
  if (typeof runGuard.isRecentDuplicateFingerprint !== "function") {
    throw new Error("submitWorkspaceJobUsecase requires runGuard.isRecentDuplicateFingerprint");
  }
  if (typeof runGuard.rememberFingerprint !== "function") {
    throw new Error("submitWorkspaceJobUsecase requires runGuard.rememberFingerprint");
  }
}

function normalizeNextJobSeq(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 1;
  return Math.floor(num);
}

function submitWorkspaceJobUsecase(options = {}) {
  ensureRunGuard(options.runGuard);
  const runGuard = options.runGuard;
  const currentApp = options.currentApp;
  const apiKey = String(options.apiKey || "");
  const queuedStatus = String(options.queuedStatus || "QUEUED");
  const now = Number(options.now) || Date.now();
  const createdAt = Number(options.createdAt) || Date.now();
  const nextJobSeq = normalizeNextJobSeq(options.nextJobSeq);
  const runSnapshotBuilder =
    typeof options.buildWorkspaceRunSnapshot === "function"
      ? options.buildWorkspaceRunSnapshot
      : buildWorkspaceRunSnapshot;

  const runSnapshot = runSnapshotBuilder({
    appItem: currentApp,
    inputValues: options.inputValues,
    targetBounds: options.targetBounds,
    sourceBuffer: options.sourceBuffer,
    placementTarget: options.placementTarget,
    settings: options.settings
  });
  const {
    appItem,
    inputValues,
    targetBounds,
    sourceBuffer,
    placementTarget = null,
    pasteStrategy,
    uploadMaxEdge,
    uploadRetryCount,
    pollSettings
  } = runSnapshot;

  const runFingerprint = runGuard.buildRunFingerprint({
    appItem,
    inputValues,
    targetBounds,
    sourceBuffer,
    placementTarget,
    pasteStrategy,
    uploadMaxEdge,
    uploadRetryCount,
    pollSettings
  });
  const isRecentDuplicateFingerprint = runGuard.isRecentDuplicateFingerprint(runFingerprint, now);

  const job = {
    jobId: `J${createdAt}-${nextJobSeq}`,
    appName: String((currentApp && currentApp.name) || "未命名应用"),
    apiKey,
    appItem,
    inputValues,
    targetBounds,
    sourceBuffer,
    placementTarget,
    pasteStrategy,
    uploadMaxEdge,
    uploadRetryCount,
    pollSettings,
    runFingerprint,
    status: queuedStatus,
    statusReason: "",
    remoteTaskId: "",
    resultUrl: "",
    timeoutRecoveries: 0,
    nextRunAt: createdAt,
    startedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    finishedAt: 0
  };

  runGuard.rememberFingerprint(runFingerprint, createdAt);
  return {
    outcome: "queued",
    job,
    nextJobSeq: nextJobSeq + 1,
    duplicateHint: isRecentDuplicateFingerprint
      ? {
          type: "recent-fingerprint",
          runFingerprint
        }
      : null
  };
}

module.exports = {
  submitWorkspaceJobUsecase
};
