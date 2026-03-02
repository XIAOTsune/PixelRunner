const REQUEST_TIMEOUT_ERROR_CODE = "REQUEST_TIMEOUT";
const {
  normalizeUploadTargetBytes,
  normalizeUploadHardLimitBytes,
  normalizeUploadAutoCompressEnabled,
  normalizeUploadCompressFormat,
  classifyUploadRiskByBytes,
  formatBytesAsMbText
} = require("../../domain/policies/run-settings-policy");

const DEFAULT_COMPRESSION_QUALITY_STEPS = [10, 8, 7, 6, 5, 4];
const DEFAULT_COMPRESSION_EDGE_STEPS = [6144, 5120, 4096, 3072, 2560, 2048];
const DEFAULT_COMPRESSION_MAX_ATTEMPTS = 18;
const DEFAULT_COMPRESSION_DURATION_MS = 12_000;

function isImageInputDefinition(input) {
  const typeMarker = String((input && (input.type || input.fieldType)) || "").toLowerCase();
  const fieldMarker = String((input && input.fieldName) || "").toLowerCase();
  return typeMarker.includes("image") || typeMarker.includes("img") || fieldMarker === "image";
}

function resolveAliasKey(key) {
  const marker = String(key || "").trim();
  if (!marker) return "";
  return marker.includes(":") ? marker.split(":").pop() : "";
}

function resolveInputValueByKey(map, key) {
  const marker = String(key || "").trim();
  if (!marker || !map || typeof map !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(map, marker)) return map[marker];
  const alias = resolveAliasKey(marker);
  if (alias && Object.prototype.hasOwnProperty.call(map, alias)) return map[alias];
  return undefined;
}

function setInputValueByKeyAndAlias(map, key, value) {
  const marker = String(key || "").trim();
  if (!marker || !map || typeof map !== "object") return;
  map[marker] = value;
  const alias = resolveAliasKey(marker);
  if (alias) map[alias] = value;
}

function resolveArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (value && typeof value === "object") {
    const buffer = value.arrayBuffer;
    if (buffer instanceof ArrayBuffer) return buffer;
    if (ArrayBuffer.isView(buffer)) {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  }
  return null;
}

function normalizeImageValueForPreflight(imageValue, limits = {}) {
  if (!imageValue || typeof imageValue !== "object") return null;
  const arrayBuffer = resolveArrayBuffer(imageValue);
  if (!arrayBuffer) return null;

  const targetBytes = normalizeUploadTargetBytes(limits.targetBytes, 9_000_000);
  const hardLimitBytes = normalizeUploadHardLimitBytes(limits.hardLimitBytes, 10_000_000, targetBytes);

  const existingSourceMeta = imageValue.sourceMeta && typeof imageValue.sourceMeta === "object" ? imageValue.sourceMeta : {};
  const existingUploadMeta = imageValue.uploadMeta && typeof imageValue.uploadMeta === "object" ? imageValue.uploadMeta : {};
  const sourceWidth = Number(existingSourceMeta.width);
  const sourceHeight = Number(existingSourceMeta.height);
  const uploadWidth = Number(existingUploadMeta.width);
  const uploadHeight = Number(existingUploadMeta.height);
  const sourceBitDepth = Number(existingSourceMeta.bitDepth);
  const uploadBitDepth = Number(existingUploadMeta.bitDepth);
  const normalizedDocBitDepth =
    Number.isFinite(sourceBitDepth) && sourceBitDepth > 0
      ? Math.floor(sourceBitDepth)
      : Number.isFinite(uploadBitDepth) && uploadBitDepth > 0
      ? Math.floor(uploadBitDepth)
      : null;

  const sourceMeta = {
    mime: String(existingSourceMeta.mime || existingUploadMeta.mime || "image/png"),
    bytes: Math.max(
      0,
      Number.isFinite(Number(existingSourceMeta.bytes)) ? Number(existingSourceMeta.bytes) : arrayBuffer.byteLength
    ),
    width: Math.max(
      1,
      Number.isFinite(sourceWidth) ? sourceWidth : Number.isFinite(uploadWidth) ? uploadWidth : 1
    ),
    height: Math.max(
      1,
      Number.isFinite(sourceHeight) ? sourceHeight : Number.isFinite(uploadHeight) ? uploadHeight : 1
    ),
    bitDepth: normalizedDocBitDepth
  };
  const uploadBytes = arrayBuffer.byteLength;
  const uploadMeta = {
    mime: String(existingUploadMeta.mime || sourceMeta.mime || "image/png"),
    bytes: uploadBytes,
    width: Math.max(
      1,
      Number.isFinite(uploadWidth) ? uploadWidth : Number.isFinite(sourceWidth) ? sourceWidth : 1
    ),
    height: Math.max(
      1,
      Number.isFinite(uploadHeight) ? uploadHeight : Number.isFinite(sourceHeight) ? sourceHeight : 1
    ),
    bitDepth: normalizedDocBitDepth,
    risk: classifyUploadRiskByBytes(uploadBytes, targetBytes, hardLimitBytes)
  };

  return {
    ...imageValue,
    arrayBuffer,
    sourceMeta,
    uploadMeta
  };
}

function createRunWorkflowController(options = {}) {
  const state = options.state || {};
  const store = options.store || null;
  const runGuard = options.runGuard || null;
  const getRunButtonPhaseController =
    typeof options.getRunButtonPhaseController === "function" ? options.getRunButtonPhaseController : () => null;
  const runButtonPhaseEnum =
    options.runButtonPhaseEnum && typeof options.runButtonPhaseEnum === "object"
      ? options.runButtonPhaseEnum
      : {};
  const submitWorkspaceJobUsecase =
    typeof options.submitWorkspaceJobUsecase === "function" ? options.submitWorkspaceJobUsecase : () => null;
  const resolveTargetBounds =
    typeof options.resolveTargetBounds === "function" ? options.resolveTargetBounds : () => ({});
  const resolveSourceImageBuffer =
    typeof options.resolveSourceImageBuffer === "function" ? options.resolveSourceImageBuffer : () => null;
  const resolvePlacementTarget =
    typeof options.resolvePlacementTarget === "function" ? options.resolvePlacementTarget : () => null;
  const runninghub = options.runninghub || null;
  const ps = options.ps || null;
  const setJobStatus = typeof options.setJobStatus === "function" ? options.setJobStatus : () => {};
  const cloneBounds = typeof options.cloneBounds === "function" ? options.cloneBounds : (value) => value;
  const cloneArrayBuffer =
    typeof options.cloneArrayBuffer === "function" ? options.cloneArrayBuffer : (value) => value;
  const createJobExecutor =
    typeof options.createJobExecutor === "function" ? options.createJobExecutor : () => ({ execute: async () => {}, reset: () => {} });
  const createJobScheduler =
    typeof options.createJobScheduler === "function" ? options.createJobScheduler : () => ({ pump: () => {}, dispose: () => {} });
  const updateTaskStatusSummary =
    typeof options.updateTaskStatusSummary === "function" ? options.updateTaskStatusSummary : () => {};
  const pruneJobHistory = typeof options.pruneJobHistory === "function" ? options.pruneJobHistory : () => {};
  const emitRunGuardFeedback =
    typeof options.emitRunGuardFeedback === "function" ? options.emitRunGuardFeedback : () => {};
  const log = typeof options.log === "function" ? options.log : () => {};
  const logPromptLengthsBeforeRun =
    typeof options.logPromptLengthsBeforeRun === "function" ? options.logPromptLengthsBeforeRun : () => {};
  const onJobCompleted = typeof options.onJobCompleted === "function" ? options.onJobCompleted : () => {};
  const jobStatus = options.jobStatus && typeof options.jobStatus === "object" ? options.jobStatus : {};
  const localMaxConcurrentJobs = Math.max(1, Number(options.localMaxConcurrentJobs) || 2);
  const getLocalMaxConcurrentJobs =
    typeof options.getLocalMaxConcurrentJobs === "function"
      ? options.getLocalMaxConcurrentJobs
      : () => localMaxConcurrentJobs;
  const timeoutRetryDelayMs = Math.max(0, Number(options.timeoutRetryDelayMs) || 15000);
  const maxTimeoutRecoveries = Math.max(0, Number(options.maxTimeoutRecoveries) || 40);
  const requestTimeoutErrorCode = String(options.requestTimeoutErrorCode || REQUEST_TIMEOUT_ERROR_CODE);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const alertFn =
    typeof options.alert === "function"
      ? options.alert
      : typeof alert === "function"
      ? alert
      : () => {};

  let jobExecutor = null;
  let jobScheduler = null;

  function getJobTag(job) {
    if (!job) return "Job:-";
    return `Job:${job.jobId}`;
  }

  function createJobScopedLogger(job) {
    return (message, type = "info") => {
      log(`[${getJobTag(job)}] ${String(message || "")}`, type);
    };
  }

  function isJobTimeoutLikeError(error) {
    if (error && error.code === requestTimeoutErrorCode) return true;
    const message = String((error && error.message) || error || "").toLowerCase();
    return /timeout|超时/.test(message);
  }

  function ensureJobServices() {
    if (!jobExecutor) {
      jobExecutor = createJobExecutor({
        runninghub,
        ps,
        setJobStatus,
        createJobLogger: createJobScopedLogger,
        cloneBounds,
        cloneArrayBuffer,
        isJobTimeoutLikeError,
        onJobCompleted,
        jobStatus,
        timeoutRetryDelayMs,
        maxTimeoutRecoveries
      });
    }

    if (!jobScheduler) {
      jobScheduler = createJobScheduler({
        getJobs: () => state.jobs,
        maxConcurrent: localMaxConcurrentJobs,
        getMaxConcurrent: getLocalMaxConcurrentJobs,
        executeJob: (job) => jobExecutor.execute(job),
        runnableStatuses: [jobStatus.QUEUED, jobStatus.TIMEOUT_TRACKING],
        onRunningCountChange: () => {
          updateTaskStatusSummary();
        },
        onJobExecutionError: (job, error) => {
          const message = error && error.message ? error.message : String(error || "unknown error");
          setJobStatus(job, jobStatus.FAILED, message);
          createJobScopedLogger(job)(`任务失败: ${message}`, "error");
        },
        onJobSettled: () => {
          pruneJobHistory();
          updateTaskStatusSummary();
        }
      });
    }
  }

  function pumpJobScheduler() {
    ensureJobServices();
    jobScheduler.pump();
  }

  function resolveSelectionBoundsForInputKey(key) {
    const boundsMap = state && state.imageBounds && typeof state.imageBounds === "object" ? state.imageBounds : {};
    return resolveInputValueByKey(boundsMap, key) || null;
  }

  function buildPreflightBlockMessage(displayName, uploadMeta, targetBytes, hardLimitBytes) {
    const risk = String((uploadMeta && uploadMeta.risk) || "unknown");
    const bytesText = formatBytesAsMbText(uploadMeta && uploadMeta.bytes, 2);
    const targetText = formatBytesAsMbText(targetBytes, 2);
    const hardText = formatBytesAsMbText(hardLimitBytes, 2);
    if (risk === "blocked") {
      return `${displayName} 当前体积 ${bytesText}，自动压缩后仍超过硬上限 ${hardText}。`;
    }
    if (risk === "risky") {
      return `${displayName} 当前体积 ${bytesText}，自动压缩后仍高于目标阈值 ${targetText}。`;
    }
    return `${displayName} 预检未通过，体积 ${bytesText}，目标阈值 ${targetText}。`;
  }

  async function runImagePreflight(settings = {}) {
    const targetBytes = normalizeUploadTargetBytes(settings.uploadTargetBytes, 9_000_000);
    const hardLimitBytes = normalizeUploadHardLimitBytes(settings.uploadHardLimitBytes, 10_000_000, targetBytes);
    const autoCompressEnabled = normalizeUploadAutoCompressEnabled(settings.uploadAutoCompressEnabled, true);
    if (!autoCompressEnabled) {
      log("[Preflight] uploadAutoCompressEnabled=false ignored; runtime auto-compress is forced on.", "info");
    }
    const compressFormat = normalizeUploadCompressFormat(settings.uploadCompressFormat, "jpeg");

    const appInputs = Array.isArray(state.currentApp && state.currentApp.inputs) ? state.currentApp.inputs : [];
    const imageInputs = appInputs.filter((input) => isImageInputDefinition(input));
    if (imageInputs.length === 0) {
      return { ok: true };
    }

    for (const input of imageInputs) {
      const inputKey = String((input && input.key) || "").trim();
      if (!inputKey) continue;
      const displayName = String((input && (input.label || input.name || inputKey)) || inputKey);
      const rawValue = resolveInputValueByKey(state.inputValues, inputKey);
      if (!rawValue || typeof rawValue !== "object") continue;

      const normalizedValue = normalizeImageValueForPreflight(rawValue, {
        targetBytes,
        hardLimitBytes
      });
      if (!normalizedValue) continue;

      setInputValueByKeyAndAlias(state.inputValues, inputKey, normalizedValue);
      const uploadMeta = normalizedValue.uploadMeta || {};
      if (Number(uploadMeta.bitDepth) > 8) {
        log(`[Preflight] ${displayName}: bit depth ${uploadMeta.bitDepth}-bit (提示，不阻断)`, "warn");
      }

      if (uploadMeta.risk === "safe") continue;

      if (!ps || typeof ps.compressCapturedSelection !== "function") {
        return {
          ok: false,
          message: `${displayName} 需要自动压缩，但当前环境未提供 Photoshop 原生压缩能力。`
        };
      }
      if (!normalizedValue.captureContext || !normalizedValue.captureContext.documentId) {
        return {
          ok: false,
          message: `${displayName} 缺少捕获上下文，无法执行自动压缩。请重新捕获后重试。`
        };
      }

      try {
        const compressionResult = await ps.compressCapturedSelection({
          captureContext: normalizedValue.captureContext,
          selectionBounds: resolveSelectionBoundsForInputKey(inputKey),
          sourceMeta: normalizedValue.sourceMeta || normalizedValue.uploadMeta,
          targetBytes,
          format: compressFormat,
          qualitySteps: DEFAULT_COMPRESSION_QUALITY_STEPS,
          maxEdgeSteps: DEFAULT_COMPRESSION_EDGE_STEPS,
          maxAttempts: DEFAULT_COMPRESSION_MAX_ATTEMPTS,
          maxCompressionDurationMs: DEFAULT_COMPRESSION_DURATION_MS,
          log
        });

        if (!compressionResult || !compressionResult.applied || !compressionResult.arrayBuffer) {
          return {
            ok: false,
            message: `${displayName} 自动压缩未生成可用结果，请重新捕获后重试。`
          };
        }

        const compressedValue = normalizeImageValueForPreflight({
          ...normalizedValue,
          arrayBuffer: compressionResult.arrayBuffer,
          uploadMeta: compressionResult.uploadMeta || normalizedValue.uploadMeta,
          compressionTrace: compressionResult.compressionTrace || normalizedValue.compressionTrace
        }, {
          targetBytes,
          hardLimitBytes
        });

        if (!compressedValue) {
          return {
            ok: false,
            message: `${displayName} 自动压缩后结果无效，请重新捕获后重试。`
          };
        }

        if (compressedValue.uploadMeta && compressedValue.uploadMeta.risk === "blocked") {
          return {
            ok: false,
            message: buildPreflightBlockMessage(displayName, compressedValue.uploadMeta, targetBytes, hardLimitBytes)
          };
        }

        setInputValueByKeyAndAlias(state.inputValues, inputKey, compressedValue);
        const trace = compressedValue.compressionTrace || {};
        log(
          `[Preflight] ${displayName} compressed to ${formatBytesAsMbText(
            compressedValue.uploadMeta && compressedValue.uploadMeta.bytes,
            2
          )} (q=${trace.quality || "-"}, edge=${trace.maxEdge || "-"})`,
          "info"
        );
      } catch (error) {
        const message = error && error.message ? error.message : String(error || "compression failed");
        return {
          ok: false,
          message: `${displayName} 自动压缩失败: ${message}`
        };
      }
    }

    return { ok: true };
  }

  async function handleRun() {
    const apiKey = store && typeof store.getApiKey === "function" ? store.getApiKey() : "";
    if (!apiKey) {
      alertFn("请先在设置页配置 API Key");
      return;
    }
    if (!state.currentApp) {
      alertFn("请先选择一个应用");
      return;
    }

    const runButtonCtrl = getRunButtonPhaseController();
    if (!runButtonCtrl || typeof runButtonCtrl.enterSubmittingGuard !== "function") return;
    const ts = now();
    if (
      (runGuard && typeof runGuard.isSubmitInFlight === "function" && runGuard.isSubmitInFlight()) ||
      (typeof runButtonCtrl.isClickGuardActive === "function" && runButtonCtrl.isClickGuardActive(ts))
    ) {
      emitRunGuardFeedback("任务已提交，请稍候...", "info", 1200);
      return;
    }

    if (runGuard && typeof runGuard.beginSubmit === "function" && !runGuard.beginSubmit(ts)) {
      emitRunGuardFeedback("任务已提交，请稍候...", "info", 1200);
      return;
    }
    runButtonCtrl.enterSubmittingGuard();
    const runSubmittingStartedAt = now();

    try {
      const settings = store && typeof store.getSettings === "function" ? store.getSettings() : {};
      const preflightResult = await runImagePreflight(settings);
      if (!preflightResult || preflightResult.ok !== true) {
        const preflightMessage =
          (preflightResult && preflightResult.message) || "运行前检查未通过，请处理图片输入后重试。";
        emitRunGuardFeedback(preflightMessage, "warn", 2600);
        log(`[Preflight] ${preflightMessage}`, "warn");
        if (typeof runButtonCtrl.recoverNow === "function") {
          runButtonCtrl.recoverNow();
        }
        return;
      }

      const targetBounds = resolveTargetBounds();
      const sourceBuffer = resolveSourceImageBuffer();
      const placementTarget = resolvePlacementTarget();
      if (sourceBuffer && !placementTarget) {
        log("[RunGuard] placement target unresolved, fallback to current active document", "warn");
      }
      const submitResult = submitWorkspaceJobUsecase({
        runGuard,
        now: ts,
        createdAt: now(),
        nextJobSeq: state.nextJobSeq,
        apiKey,
        currentApp: state.currentApp,
        inputValues: state.inputValues,
        targetBounds,
        sourceBuffer,
        placementTarget,
        settings,
        queuedStatus: jobStatus.QUEUED
      });
      const job = submitResult && submitResult.job;
      if (!job) {
        throw new Error("submit result missing job");
      }
      state.nextJobSeq = submitResult.nextJobSeq;
      state.jobs.unshift(job);
      pruneJobHistory();
      updateTaskStatusSummary();
      emitRunGuardFeedback(`任务已提交到队列（${job.jobId}）`, "info", 1400);
      if (submitResult.duplicateHint) {
        emitRunGuardFeedback("检测到短时间重复提交，已继续入队。", "warn", 1800);
      }
      log(`[${getJobTag(job)}] 已加入后台队列: ${job.appName}`, "info");
      logPromptLengthsBeforeRun(job.appItem, job.inputValues, `[${getJobTag(job)}]`);
      if (typeof runButtonCtrl.waitSubmittingMinDuration === "function") {
        await runButtonCtrl.waitSubmittingMinDuration(runSubmittingStartedAt);
      }
      if (typeof runButtonCtrl.enterSubmittedAck === "function") {
        runButtonCtrl.enterSubmittedAck();
      }
      pumpJobScheduler();
    } catch (error) {
      const message = error && error.message ? error.message : String(error || "unknown error");
      emitRunGuardFeedback(`任务提交失败：${message}`, "warn", 2200);
      log(`[RunGuard] 任务提交异常: ${message}`, "error");
      if (typeof runButtonCtrl.recoverNow === "function") {
        runButtonCtrl.recoverNow();
      }
    } finally {
      if (runGuard && typeof runGuard.finishSubmit === "function") {
        runGuard.finishSubmit();
      }
      if (state.runButtonPhase === runButtonPhaseEnum.SUBMITTING_GUARD) {
        if (typeof runButtonCtrl.recoverNow === "function") {
          runButtonCtrl.recoverNow();
        }
      }
    }
  }

  function dispose() {
    if (jobScheduler) {
      jobScheduler.dispose();
      jobScheduler = null;
    }
    if (jobExecutor) {
      jobExecutor.reset();
      jobExecutor = null;
    }
  }

  return {
    handleRun,
    pumpJobScheduler,
    dispose
  };
}

module.exports = {
  createRunWorkflowController
};

