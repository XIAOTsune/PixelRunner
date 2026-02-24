const { API } = require("../config");
const { isEmptyValue } = require("../utils");
const {
  normalizeUploadMaxEdge,
  getUploadMaxEdgeLabel,
  buildUploadMaxEdgeCandidates,
  shouldRetryWithNextUploadEdge
} = require("./runninghub-runner/upload-edge-strategy");
const { fetchWithTimeout } = require("./runninghub-runner/request-strategy");
const { uploadImage } = require("./runninghub-runner/upload-strategy");
const {
  isAiInput,
  buildNodeInfoPayload,
  resolveRuntimeInputType,
  resolveInputValue,
  parseBooleanValue,
  coerceSelectValue,
  getTextLength,
  getTailPreview
} = require("./runninghub-runner/payload-strategy");
const {
  buildAiAppRunBodyCandidates,
  buildLegacyCreateTaskBody,
  getTaskCreationOutcome
} = require("./runninghub-runner/task-request-strategy");
const {
  fallbackToMessage,
  createAiAppRejectedError,
  normalizeAiAppFailure,
  buildAiAppExceptionReason
} = require("./runninghub-runner/task-error-strategy");
const {
  createLocalValidationError,
  collectMissingRequiredImageInputs,
  coerceNonImageInputValue
} = require("./runninghub-runner/input-validation-strategy");
const {
  buildTextPayloadDebugEntry,
  emitTextPayloadDebugLog
} = require("./runninghub-runner/text-payload-log-strategy");
const { createBlankImageTokenProvider } = require("./runninghub-runner/blank-image-strategy");

const BLANK_IMAGE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2fJ0QAAAAASUVORK5CYII=";

async function createAiAppTask(apiKey, appId, nodeInfoList, options = {}, helpers = {}) {
  const {
    fetchImpl,
    parseJsonResponse,
    toMessage,
    throwIfCancelled
  } = helpers;
  const safeFetch = typeof fetchImpl === "function" ? fetchImpl : fetch;
  const safeParseJsonResponse =
    typeof parseJsonResponse === "function"
      ? parseJsonResponse
      : async (response) => response.json().catch(() => null);
  const safeToMessage = typeof toMessage === "function" ? toMessage : fallbackToMessage;
  const safeThrowIfCancelled = typeof throwIfCancelled === "function" ? throwIfCancelled : () => {};

  const log = options.log || (() => {});
  const candidates = buildAiAppRunBodyCandidates(apiKey, appId, nodeInfoList);
  const reasons = [];

  for (const body of candidates) {
    safeThrowIfCancelled(options);
    try {
      const response = await fetchWithTimeout(safeFetch, `${API.BASE_URL}${API.ENDPOINTS.AI_APP_RUN}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal
      }, {
        timeoutMs: options.requestTimeoutMs
      });
      safeThrowIfCancelled(options);
      const result = await safeParseJsonResponse(response);
      safeThrowIfCancelled(options);
      const outcome = getTaskCreationOutcome(response, result);
      if (outcome.success) return outcome.taskId;

      const failure = normalizeAiAppFailure({
        body,
        result,
        responseStatus: response.status,
        toMessage: safeToMessage
      });
      if (failure.terminal) {
        throw createAiAppRejectedError(failure.message, result);
      }
      reasons.push(failure.reason);
    } catch (error) {
      if (error && error.code === "RUN_CANCELLED") throw error;
      if (error && error.code === "AI_APP_REJECTED") throw error;
      reasons.push(buildAiAppExceptionReason(error));
    }
  }

  log(reasons.join(" | "), "warn");
  throw new Error("AI app task creation failed");
}

async function createLegacyTask(apiKey, appId, nodeParams, options = {}, helpers = {}) {
  const {
    fetchImpl,
    parseJsonResponse,
    toMessage,
    throwIfCancelled
  } = helpers;
  const safeFetch = typeof fetchImpl === "function" ? fetchImpl : fetch;
  const safeParseJsonResponse =
    typeof parseJsonResponse === "function"
      ? parseJsonResponse
      : async (response) => response.json().catch(() => null);
  const safeToMessage = typeof toMessage === "function" ? toMessage : fallbackToMessage;
  const safeThrowIfCancelled = typeof throwIfCancelled === "function" ? throwIfCancelled : () => {};

  safeThrowIfCancelled(options);
  const response = await fetchWithTimeout(safeFetch, `${API.BASE_URL}${API.ENDPOINTS.LEGACY_CREATE_TASK}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildLegacyCreateTaskBody(apiKey, appId, nodeParams)),
    signal: options.signal
  }, {
    timeoutMs: options.requestTimeoutMs
  });
  safeThrowIfCancelled(options);
  const result = await safeParseJsonResponse(response);
  safeThrowIfCancelled(options);
  const outcome = getTaskCreationOutcome(response, result);
  if (!outcome.success) throw new Error(safeToMessage(result, `Create task failed (HTTP ${response.status})`));
  return outcome.taskId;
}

async function submitTaskAttempt(params = {}) {
  const {
    apiKey,
    appItem,
    inputValues,
    uploadMaxEdge = 0,
    options = {},
    helpers = {}
  } = params;
  const {
    fetchImpl,
    parseJsonResponse,
    toMessage,
    throwIfCancelled
  } = helpers;
  const safeThrowIfCancelled = typeof throwIfCancelled === "function" ? throwIfCancelled : () => {};
  const normalizedUploadMaxEdge = normalizeUploadMaxEdge(uploadMaxEdge);
  const attemptOptions = {
    ...(options && typeof options === "object" ? options : {}),
    uploadMaxEdge: normalizedUploadMaxEdge
  };
  const log = attemptOptions.log || (() => {});

  if (normalizedUploadMaxEdge > 0) {
    log(`Upload max edge active: ${getUploadMaxEdgeLabel(normalizedUploadMaxEdge)}`, "info");
  }

  const nodeInfoList = [];
  const nodeParams = {};
  const textPayloadDebug = [];
  const getBlankImageToken = createBlankImageTokenProvider({
    apiKey,
    blankImageValue: BLANK_IMAGE_PNG_BASE64,
    options: attemptOptions,
    helpers: {
      fetchImpl,
      parseJsonResponse,
      toMessage,
      throwIfCancelled: safeThrowIfCancelled
    },
    uploadImageImpl: uploadImage
  });
  const missingRequiredImages = collectMissingRequiredImageInputs(appItem.inputs, inputValues || {}, {
    resolveRuntimeInputType,
    resolveInputValue
  });

  if (missingRequiredImages.length > 0) {
    throw createLocalValidationError(
      `Missing required image parameters: ${missingRequiredImages.join(", ")}. Please capture or provide images before running.`,
      "MISSING_REQUIRED_IMAGE"
    );
  }

  for (const input of appItem.inputs || []) {
    safeThrowIfCancelled(attemptOptions);
    const type = resolveRuntimeInputType(input);
    const resolved = resolveInputValue(input, inputValues || {}, { allowAlias: type !== "image" });
    const key = resolved.key;
    if (!key) continue;
    let value = resolved.value;

    if (type === "image") {
      if (isEmptyValue(value)) {
        try {
          value = await getBlankImageToken();
          log(`Image parameter is empty, using uploaded blank placeholder: ${input.label || input.name || key}`, "warn");
        } catch (error) {
          throw createLocalValidationError(
            `Failed to upload blank placeholder for ${input.label || input.name || key}: ${error.message}`,
            "BLANK_IMAGE_UPLOAD_FAILED"
          );
        }
      } else {
        const uploaded = await uploadImage(apiKey, value, attemptOptions, {
          fetchImpl,
          parseJsonResponse,
          toMessage,
          throwIfCancelled: safeThrowIfCancelled
        });
        value = uploaded.value;
        safeThrowIfCancelled(attemptOptions);
      }
    } else {
      value = coerceNonImageInputValue({
        input,
        type,
        value,
        key,
        coerceSelectValue,
        parseBooleanValue
      });
    }

    nodeParams[key] = value;
    if (input.fieldName && !(input.fieldName in nodeParams)) nodeParams[input.fieldName] = value;
    if (type !== "image") {
      textPayloadDebug.push(buildTextPayloadDebugEntry({
        key,
        label: String(input.label || input.name || key),
        type,
        value,
        getTextLength,
        getTailPreview,
        tailMaxChars: 20
      }));
    }
    if (isAiInput(input)) nodeInfoList.push(buildNodeInfoPayload(input, value, type));
  }

  emitTextPayloadDebugLog(log, textPayloadDebug, { previewLimit: 12 });

  let lastErr = null;
  if (nodeInfoList.length > 0) {
    try {
      safeThrowIfCancelled(attemptOptions);
      log(`Submitting task: AI app API (${nodeInfoList.length} params)`, "info");
      return await createAiAppTask(apiKey, appItem.appId, nodeInfoList, attemptOptions, {
        fetchImpl,
        parseJsonResponse,
        toMessage,
        throwIfCancelled: safeThrowIfCancelled
      });
    } catch (error) {
      if (error && error.code === "RUN_CANCELLED") throw error;
      if (error && error.code === "AI_APP_REJECTED") throw error;
      lastErr = error;
      log(`AI app API failed, fallback to legacy API: ${error.message}`, "warn");
    }
  }

  if (Object.keys(nodeParams).length > 0) {
    safeThrowIfCancelled(attemptOptions);
    log("Submitting task: legacy workflow API", "info");
    return createLegacyTask(apiKey, appItem.appId, nodeParams, attemptOptions, {
      fetchImpl,
      parseJsonResponse,
      toMessage,
      throwIfCancelled: safeThrowIfCancelled
    });
  }

  if (lastErr) throw lastErr;
  throw createLocalValidationError("No parameters to submit", "NO_PARAMETERS_TO_SUBMIT");
}

async function runAppTaskCore(params = {}) {
  const {
    apiKey,
    appItem,
    inputValues,
    options = {},
    helpers = {}
  } = params;
  const log = options.log || (() => {});
  const hasImageInput = Array.isArray(appItem && appItem.inputs)
    ? appItem.inputs.some((input) => resolveRuntimeInputType(input) === "image")
    : false;
  const uploadMaxEdgeCandidates = hasImageInput ? buildUploadMaxEdgeCandidates(options.uploadMaxEdge) : [0];
  let lastErr = null;

  for (let index = 0; index < uploadMaxEdgeCandidates.length; index += 1) {
    const currentUploadMaxEdge = uploadMaxEdgeCandidates[index];
    if (index > 0) {
      const previousLabel = getUploadMaxEdgeLabel(uploadMaxEdgeCandidates[index - 1]);
      const nextLabel = getUploadMaxEdgeLabel(currentUploadMaxEdge);
      log(`Retrying task submission with relaxed upload limit: ${previousLabel} -> ${nextLabel}`, "warn");
    }

    try {
      return await submitTaskAttempt({
        apiKey,
        appItem,
        inputValues,
        uploadMaxEdge: currentUploadMaxEdge,
        options,
        helpers
      });
    } catch (error) {
      if (error && error.code === "RUN_CANCELLED") throw error;
      lastErr = error;
      const hasNextCandidate = index < uploadMaxEdgeCandidates.length - 1;
      if (!hasNextCandidate || !shouldRetryWithNextUploadEdge(error)) {
        throw error;
      }
      const currentLabel = getUploadMaxEdgeLabel(currentUploadMaxEdge);
      const message = error && error.message ? error.message : String(error || "unknown error");
      log(`Task submission failed under upload limit ${currentLabel}: ${message}`, "warn");
    }
  }

  if (lastErr) throw lastErr;
  throw new Error("Task submission failed");
}

module.exports = { runAppTaskCore };


