const { RUNNINGHUB_ERROR_CODES } = require("../runninghub-error-codes");

function hasAiPayload(nodeInfoList) {
  return Array.isArray(nodeInfoList) && nodeInfoList.length > 0;
}

function hasLegacyPayload(nodeParams) {
  return Boolean(nodeParams && typeof nodeParams === "object" && Object.keys(nodeParams).length > 0);
}

async function submitTaskWithAiFallback(params = {}) {
  const {
    nodeInfoList,
    nodeParams,
    appId,
    apiKey,
    attemptOptions = {},
    helpers = {},
    log = () => {},
    createAiAppTask,
    createLegacyTask
  } = params;
  const safeThrowIfCancelled = typeof helpers.throwIfCancelled === "function" ? helpers.throwIfCancelled : () => {};
  const safeCreateAiAppTask = typeof createAiAppTask === "function" ? createAiAppTask : null;
  const safeCreateLegacyTask = typeof createLegacyTask === "function" ? createLegacyTask : null;
  const hasAi = hasAiPayload(nodeInfoList);
  const hasLegacy = hasLegacyPayload(nodeParams);
  let lastErr = null;

  if (hasAi && safeCreateAiAppTask) {
    try {
      safeThrowIfCancelled(attemptOptions);
      log(`Submitting task: AI app API (${nodeInfoList.length} params)`, "info");
      return await safeCreateAiAppTask(apiKey, appId, nodeInfoList, attemptOptions, helpers);
    } catch (error) {
      if (error && error.code === RUNNINGHUB_ERROR_CODES.RUN_CANCELLED) throw error;
      if (error && error.code === RUNNINGHUB_ERROR_CODES.AI_APP_REJECTED) throw error;
      lastErr = error;
      const message = error && error.message ? error.message : String(error || "unknown error");
      log(`AI app API failed, fallback to legacy API: ${message}`, "warn");
    }
  }

  if (hasLegacy && safeCreateLegacyTask) {
    safeThrowIfCancelled(attemptOptions);
    log("Submitting task: legacy workflow API", "info");
    return safeCreateLegacyTask(apiKey, appId, nodeParams, attemptOptions, helpers);
  }

  if (lastErr) throw lastErr;
  return "";
}

module.exports = {
  hasAiPayload,
  hasLegacyPayload,
  submitTaskWithAiFallback
};
