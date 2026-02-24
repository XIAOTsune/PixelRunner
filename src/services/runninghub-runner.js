const { API } = require("../config");
const { normalizeAppId, isEmptyValue } = require("../utils");
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

const BLANK_IMAGE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2fJ0QAAAAASUVORK5CYII=";

function fallbackToMessage(result, fallback = "Request failed") {
  if (!result || typeof result !== "object") return fallback;
  return String(result.msg || result.message || fallback);
}

function extractNodeValidationSummary(result) {
  if (!result || typeof result !== "object") return "";
  const raw = result.node_errors || result.nodeErrors || (result.data && (result.data.node_errors || result.data.nodeErrors));
  if (!raw || typeof raw !== "object") return "";

  const lines = [];
  Object.values(raw)
    .slice(0, 4)
    .forEach((node) => {
      if (!node || typeof node !== "object") return;
      const nodeName = String(node.node_name || node.nodeName || node.class_type || "node").trim();
      const errs = Array.isArray(node.errors) ? node.errors : [];
      errs.slice(0, 2).forEach((err) => {
        if (!err || typeof err !== "object") return;
        const msg = String(err.message || err.type || "validation error").trim();
        const details = String(err.details || "").trim();
        lines.push(details ? `${nodeName}: ${msg} (${details})` : `${nodeName}: ${msg}`);
      });
    });

  return lines.join("; ");
}

function toAiAppErrorMessage(result, fallback = "AI app request failed") {
  if (!result || typeof result !== "object") return fallback;
  if (result.msg) return String(result.msg);
  if (result.message) return String(result.message);
  if (result.error && typeof result.error === "object" && (result.error.message || result.error.type)) {
    const errMsg = String(result.error.message || result.error.type || "").trim();
    if (errMsg) return errMsg;
  }
  const summary = extractNodeValidationSummary(result);
  if (summary) return summary;
  return fallback;
}

function isParameterShapeError(message) {
  const marker = String(message || "").toLowerCase();
  if (!marker) return false;
  return (
    marker.includes("webappid cannot be null") ||
    marker.includes("param apikey is required") ||
    marker.includes("param api key is required")
  );
}

function parseTaskId(result) {
  if (!result || typeof result !== "object") return "";
  return (
    (result.data && (result.data.taskId || result.data.id)) ||
    result.taskId ||
    result.id ||
    ""
  );
}

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
  const normalizedId = normalizeAppId(appId);
  const candidates = [
    { apiKey, webappId: normalizedId, nodeInfoList },
    { apiKey, webAppId: normalizedId, nodeInfoList },
    { apiKey, appId: normalizedId, nodeInfoList }
  ];
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
      const taskId = parseTaskId(result);
      const success = response.ok && result && (result.code === 0 || result.success === true) && taskId;
      if (success) return taskId;

      const marker = Object.keys(body).join(",");
      const message = toAiAppErrorMessage(result, safeToMessage(result, `HTTP ${response.status}`));
      const primaryVariant = body.apiKey && body.webappId;
      if (primaryVariant && !isParameterShapeError(message)) {
        const terminalError = new Error(message || "AI app request rejected");
        terminalError.code = "AI_APP_REJECTED";
        terminalError.apiResult = result;
        throw terminalError;
      }
      reasons.push(`ai-app/run(${marker}): ${message}`);
    } catch (error) {
      if (error && error.code === "RUN_CANCELLED") throw error;
      if (error && error.code === "AI_APP_REJECTED") throw error;
      reasons.push(`ai-app/run: ${error.message}`);
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
    body: JSON.stringify({ apiKey, workflowId: normalizeAppId(appId), nodeParams }),
    signal: options.signal
  }, {
    timeoutMs: options.requestTimeoutMs
  });
  safeThrowIfCancelled(options);
  const result = await safeParseJsonResponse(response);
  safeThrowIfCancelled(options);
  const taskId = parseTaskId(result);
  const success = response.ok && result && (result.code === 0 || result.success === true) && taskId;
  if (!success) throw new Error(safeToMessage(result, `Create task failed (HTTP ${response.status})`));
  return taskId;
}

function createLocalValidationError(message, code = "LOCAL_VALIDATION") {
  const error = new Error(String(message || "Validation failed"));
  error.code = code;
  error.localValidation = true;
  return error;
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
  const missingRequiredImages = [];
  let blankImageToken = "";
  let blankImageTokenPromise = null;

  const getBlankImageToken = async () => {
    if (blankImageToken) return blankImageToken;
    if (!blankImageTokenPromise) {
      blankImageTokenPromise = uploadImage(apiKey, BLANK_IMAGE_PNG_BASE64, attemptOptions, {
        fetchImpl,
        parseJsonResponse,
        toMessage,
        throwIfCancelled: safeThrowIfCancelled
      }).then((uploaded) => {
        const nextToken = uploaded && uploaded.value ? String(uploaded.value) : "";
        if (!nextToken) throw new Error("blank image upload returned empty token");
        blankImageToken = nextToken;
        return nextToken;
      });
    }
    return blankImageTokenPromise;
  };

  for (const input of appItem.inputs || []) {
    safeThrowIfCancelled(attemptOptions);
    const type = resolveRuntimeInputType(input);
    const strictRequired = Boolean(input && input.required && input.requiredExplicit === true);
    if (type !== "image" || !strictRequired) continue;
    const resolved = resolveInputValue(input, inputValues || {}, { allowAlias: false });
    if (isEmptyValue(resolved.value)) {
      missingRequiredImages.push(String(input.label || input.name || resolved.key || "unnamed image parameter"));
    }
  }

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
    if (type !== "image" && input.required && isEmptyValue(value)) {
      throw createLocalValidationError(
        `Missing required parameter: ${input.label || input.name || key}`,
        "MISSING_REQUIRED_PARAMETER"
      );
    }

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
    } else if (type === "select" && !isEmptyValue(value)) {
      value = coerceSelectValue(input, value);
    } else if (type === "number" && !isEmptyValue(value)) {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw createLocalValidationError(`Invalid number parameter: ${input.label || key}`, "INVALID_NUMBER_PARAMETER");
      }
      value = n;
    } else if (type === "boolean") {
      const boolValue = parseBooleanValue(value);
      if (boolValue === null) {
        throw createLocalValidationError(`Invalid boolean parameter: ${input.label || key}`, "INVALID_BOOLEAN_PARAMETER");
      }
      value = boolValue;
    }

    nodeParams[key] = value;
    if (input.fieldName && !(input.fieldName in nodeParams)) nodeParams[input.fieldName] = value;
    if (type !== "image") {
      const textValue = String(value == null ? "" : value);
      textPayloadDebug.push({
        key,
        label: String(input.label || input.name || key),
        type,
        length: getTextLength(textValue),
        tail: getTailPreview(textValue, 20)
      });
    }
    if (isAiInput(input)) nodeInfoList.push(buildNodeInfoPayload(input, value, type));
  }

  if (textPayloadDebug.length > 0) {
    log(`Pre-submit text parameter check: ${textPayloadDebug.length} item(s)`, "info");
    textPayloadDebug.slice(0, 12).forEach((item) => {
      log(`Parameter ${item.label} (${item.key}, ${item.type}): length ${item.length}, tail ${item.tail}`, "info");
    });
    if (textPayloadDebug.length > 12) {
      log(`Other ${textPayloadDebug.length - 12} text parameter(s) not shown`, "info");
    }
  }

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


