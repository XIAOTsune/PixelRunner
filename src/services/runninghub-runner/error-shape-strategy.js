const { RUNNINGHUB_ERROR_CODES } = require("../runninghub-error-codes");

function attachErrorMeta(error, meta = {}) {
  if (!error || typeof error !== "object") return error;
  if (!meta || typeof meta !== "object") return error;
  Object.keys(meta).forEach((key) => {
    if (meta[key] === undefined) return;
    error[key] = meta[key];
  });
  return error;
}

function createRunnerError(message, meta = {}) {
  const error = new Error(String(message || "Task execution failed"));
  return attachErrorMeta(error, meta);
}

function createAiAppTaskCreationError(reasons = []) {
  const reasonList = Array.isArray(reasons) ? reasons.filter(Boolean).map((item) => String(item)) : [];
  return createRunnerError("AI app task creation failed", {
    code: RUNNINGHUB_ERROR_CODES.AI_APP_TASK_CREATE_FAILED,
    channel: "ai_app",
    reasons: reasonList,
    retryable: true
  });
}

function createLegacyTaskCreationError(message, options = {}) {
  const {
    responseStatus,
    apiResult
  } = options && typeof options === "object" ? options : {};
  return createRunnerError(message || "Create task failed", {
    code: RUNNINGHUB_ERROR_CODES.LEGACY_TASK_CREATE_FAILED,
    channel: "legacy",
    responseStatus: Number.isFinite(Number(responseStatus)) ? Number(responseStatus) : undefined,
    apiResult,
    retryable: true
  });
}

function createTaskSubmissionFailedError(message = "Task submission failed", options = {}) {
  const {
    cause
  } = options && typeof options === "object" ? options : {};
  const error = createRunnerError(message, {
    code: RUNNINGHUB_ERROR_CODES.TASK_SUBMISSION_FAILED,
    cause
  });
  return error;
}

module.exports = {
  attachErrorMeta,
  createRunnerError,
  createAiAppTaskCreationError,
  createLegacyTaskCreationError,
  createTaskSubmissionFailedError
};
