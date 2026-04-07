const runninghubTaskControllers = new Map();

function normalizeAppId(value) {
  const normalized = String(value == null ? "" : value).trim();
  if (!normalized) return "";
  if (["null", "undefined"].includes(normalized.toLowerCase())) return "";
  return normalized;
}

function parseBooleanValue(value) {
  if (value === true || value === false) return value;
  const marker = String(value == null ? "" : value).trim().toLowerCase();
  if (!marker) return null;
  if (["true", "1", "yes", "y", "on", "shi", "是"].includes(marker)) return true;
  if (["false", "0", "no", "n", "off", "fou", "否"].includes(marker)) return false;
  return null;
}

function isFilledInputValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return true;

  if (typeof value === "object") {
    return Boolean(
      (typeof value.dataUrl === "string" && value.dataUrl.trim()) ||
      (typeof value.base64 === "string" && value.base64.trim()) ||
      (typeof value.url === "string" && value.url.trim())
    );
  }

  return String(value).trim() !== "";
}

function normalizeImageInputValue(input, value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (input && input.passObject === true) {
    return value;
  }

  const mode = String(
    (input && (input.imageValueMode || input.valueMode || input.transferMode || input.transport)) || ""
  ).trim().toLowerCase();

  if (mode === "base64") {
    return String(value.base64 || "");
  }

  if (mode === "url") {
    return String(value.url || "");
  }

  if (mode === "object" || mode === "json") {
    return value;
  }

  return String(value.dataUrl || value.base64 || value.url || "");
}

function isImageLikeInput(input) {
  if (!input || typeof input !== "object") return false;
  const typeMarker = String(input.type || input.fieldType || "").trim().toLowerCase();
  const fieldMarker = String(input.fieldName || "").trim().toLowerCase();
  return typeMarker.includes("image") || typeMarker.includes("img") || typeMarker.includes("file") || fieldMarker === "image";
}

function parseDataUrl(value) {
  const text = String(value || "").trim();
  const match = text.match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: String(match[1] || "application/octet-stream").trim() || "application/octet-stream",
    base64: String(match[2] || "").trim()
  };
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(String(base64 || "").trim());
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes.buffer;
}

function normalizeUploadBuffer(imageValue) {
  if (imageValue instanceof ArrayBuffer) return imageValue;
  if (ArrayBuffer.isView(imageValue)) {
    return imageValue.buffer.slice(imageValue.byteOffset, imageValue.byteOffset + imageValue.byteLength);
  }

  if (imageValue && typeof imageValue === "object") {
    if (typeof imageValue.dataUrl === "string" && imageValue.dataUrl.trim()) {
      const parsed = parseDataUrl(imageValue.dataUrl);
      if (parsed && parsed.base64) return base64ToArrayBuffer(parsed.base64);
    }
    if (typeof imageValue.base64 === "string" && imageValue.base64.trim()) {
      return base64ToArrayBuffer(imageValue.base64);
    }
  }

  if (typeof imageValue === "string" && imageValue.trim()) {
    const parsed = parseDataUrl(imageValue);
    if (parsed && parsed.base64) return base64ToArrayBuffer(parsed.base64);
    return base64ToArrayBuffer(imageValue);
  }

  throw new Error("Image input is invalid");
}

function detectImageMime(arrayBuffer, fallback = "image/jpeg") {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 12) return fallback;
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return fallback;
}

function pickUploadedValue(data) {
  const source = data && typeof data === "object" ? data : {};
  const token = String(source.fileName || source.filename || source.fileKey || source.key || "").trim();
  const url = String(source.url || source.fileUrl || source.download_url || source.downloadUrl || "").trim();
  return { value: token || url, token, url };
}

async function uploadImageValue(apiKey, imageValue, settings = {}) {
  const buffer = normalizeUploadBuffer(imageValue);
  const fallbackMime =
    (imageValue && typeof imageValue === "object" && String(imageValue.mimeType || "").trim()) || "image/jpeg";
  const mimeType = detectImageMime(buffer, fallbackMime);
  const fileName = mimeType === "image/png" ? "image.png" : mimeType === "image/webp" ? "image.webp" : "image.jpg";
  const blob = new Blob([buffer], { type: mimeType });
  const timeoutMs = Math.max(5000, Number(settings.timeout || 180) * 1000);
  const endpoints = [
    "https://www.runninghub.cn/openapi/v2/media/upload/binary",
    "https://www.runninghub.cn/uc/openapi/upload"
  ];

  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const formData = new FormData();
      formData.append("file", blob, fileName);
      const result = await fetchJsonWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`
          },
          body: formData
        },
        timeoutMs
      );
      const picked = pickUploadedValue((result && (result.data || result.result)) || result);
      if (picked.value) {
        return picked.value;
      }
      throw new Error((result && (result.message || result.msg)) || "Upload succeeded but no usable file token/url");
    } catch (error) {
      console.warn("[PixelRunner/RunningHub] image upload failed", {
        endpoint,
        message: error && error.message ? error.message : String(error || "")
      });
      lastError = error;
    }
  }

  throw lastError || new Error("Image upload failed");
}

function normalizeInputValue(input, value) {
  const typeMarker = String((input && (input.type || input.fieldType)) || "").trim().toLowerCase();
  if (isImageLikeInput(input) || typeMarker === "image" || typeMarker === "file") {
    return normalizeImageInputValue(input, value);
  }

  if (typeMarker === "number" || typeMarker === "int" || typeMarker === "float") {
    const num = Number(value);
    return Number.isFinite(num) ? num : value;
  }

  if (typeMarker === "boolean" || typeMarker === "switch" || typeMarker === "checkbox") {
    const boolValue = parseBooleanValue(value);
    return boolValue === null ? Boolean(value) : boolValue;
  }

  return value;
}

function buildNodeInfoList(app, inputValues) {
  const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
  const values = inputValues && typeof inputValues === "object" ? inputValues : {};

  return inputs
    .map((input, index) => {
      const key = String((input && input.key) || "").trim() || `param_${index + 1}`;
      const rawValue = values[key];
      if (!isFilledInputValue(rawValue)) {
        if (input && input.required && typeof rawValue !== "boolean") {
          throw new Error(`Missing required input: ${input.label || input.name || key}`);
        }
        return null;
      }

      const fieldName = String((input && (input.fieldName || input.key || input.name)) || key).trim();
      const payload = {
        nodeId: input && input.nodeId ? input.nodeId : key,
        fieldName,
        fieldValue: normalizeInputValue(input, rawValue)
      };

      if (input && input.fieldType) payload.fieldType = input.fieldType;
      if (input && input.fieldData !== undefined) payload.fieldData = input.fieldData;
      return payload;
    })
    .filter(Boolean);
}

function buildNodeParams(app, inputValues) {
  const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
  const values = inputValues && typeof inputValues === "object" ? inputValues : {};
  const nodeParams = {};

  inputs.forEach((input, index) => {
    const key = String((input && input.key) || "").trim() || `param_${index + 1}`;
    const rawValue = values[key];
    if (!isFilledInputValue(rawValue)) {
      if (input && input.required && typeof rawValue !== "boolean") {
        throw new Error(`Missing required input: ${input.label || input.name || key}`);
      }
      return;
    }

    const normalizedValue = normalizeInputValue(input, rawValue);
    nodeParams[key] = normalizedValue;

    const fieldName = String((input && (input.fieldName || input.name)) || "").trim();
    if (fieldName && !(fieldName in nodeParams)) nodeParams[fieldName] = normalizedValue;
  });

  return nodeParams;
}

async function buildSubmissionInputs(app, inputValues, apiKey, settings = {}) {
  const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
  const values = inputValues && typeof inputValues === "object" ? inputValues : {};
  const normalizedValues = {};
  const nodeInfoList = [];
  const nodeParams = {};

  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const key = String((input && input.key) || "").trim() || `param_${index + 1}`;
    const rawValue = values[key];
    if (!isFilledInputValue(rawValue)) {
      if (input && input.required && typeof rawValue !== "boolean") {
        throw new Error(`Missing required input: ${input.label || input.name || key}`);
      }
      continue;
    }

    let normalizedValue = normalizeInputValue(input, rawValue);
    const typeMarker = String((input && (input.type || input.fieldType)) || "").trim().toLowerCase();
    if (isImageLikeInput(input) && normalizedValue && typeof normalizedValue === "object") {
      normalizedValue = await uploadImageValue(apiKey, normalizedValue, settings);
      console.log("[PixelRunner/RunningHub] image uploaded", {
        key,
        fieldName: String((input && (input.fieldName || input.name || key)) || key),
        valueType: /^https?:\/\//i.test(String(normalizedValue || "")) ? "url" : "token"
      });
    }

    normalizedValues[key] = normalizedValue;
    nodeParams[key] = normalizedValue;
    const fieldName = String((input && (input.fieldName || input.name)) || "").trim();
    if (fieldName && !(fieldName in nodeParams)) nodeParams[fieldName] = normalizedValue;

    const nodeFieldName = String((input && (input.fieldName || input.key || input.name)) || key).trim();
    const payload = {
      nodeId: input && input.nodeId ? input.nodeId : key,
      fieldName: nodeFieldName,
      fieldValue: normalizedValue
    };
    if (input && input.fieldType) payload.fieldType = input.fieldType;
    if (input && input.fieldData !== undefined && !isImageLikeInput(input)) {
      payload.fieldData = input.fieldData;
    }
    nodeInfoList.push(payload);
  }

  return { normalizedValues, nodeInfoList, nodeParams };
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch (_) {}
      }, timeoutMs)
    : null;

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller ? controller.signal : options.signal
    });
    const text = await response.text();
    let result = null;
    try {
      result = text ? JSON.parse(text) : null;
    } catch (_) {
      result = { rawText: text };
    }

    if (!response.ok) {
      const message =
        (result && (result.message || result.msg || result.error)) ||
        `Request failed (HTTP ${response.status})`;
      throw new Error(String(message));
    }

    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function extractOutputUrl(payload) {
  if (!payload) return "";
  if (typeof payload === "string") {
    return /^https?:\/\//i.test(payload) ? payload : "";
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const url = extractOutputUrl(item);
      if (url) return url;
    }
    return "";
  }

  if (typeof payload === "object") {
    const directKeys = ["fileUrl", "url", "downloadUrl", "download_url", "imageUrl", "resultUrl"];
    for (const key of directKeys) {
      const value = payload[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    }

    const nestedKeys = ["outputs", "data", "result", "list", "items", "nodeOutputs"];
    for (const key of nestedKeys) {
      const url = extractOutputUrl(payload[key]);
      if (url) return url;
    }
  }

  return "";
}

function extractTaskStatus(payload) {
  if (!payload || typeof payload !== "object") return "";
  return String(payload.status || payload.state || payload.taskStatus || "").toUpperCase();
}

function parseTaskId(result) {
  if (!result || typeof result !== "object") return "";
  return (result.data && (result.data.taskId || result.data.id)) || result.taskId || result.id || "";
}

function isParameterShapeError(message) {
  const marker = String(message || "").toLowerCase();
  return (
    marker.includes("webappid cannot be null") ||
    marker.includes("param apikey is required") ||
    marker.includes("param api key is required")
  );
}

function isPendingStatus(status) {
  return ["PENDING", "RUNNING", "PROCESSING", "QUEUED", "QUEUE", "WAITING", "IN_PROGRESS"].includes(status);
}

function isFailedStatus(status) {
  return ["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(status);
}

function isPendingMessage(message) {
  const text = String(message || "").toLowerCase();
  return /(processing|pending|running|queue|wait|运行中|排队|处理中)/i.test(text);
}

export async function submitRunningHubTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const app = payload.app && typeof payload.app === "object" ? payload.app : {};
  const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
  const apiKey = String(payload.apiKey || "").trim();
  const appId = normalizeAppId(app.appId || payload.appId);

  if (!apiKey) throw new Error("RunningHub API Key is missing");
  if (!appId) throw new Error("RunningHub App ID is missing");

  const { nodeInfoList, nodeParams } = await buildSubmissionInputs(app, payload.inputs, apiKey, settings);
  const bodyCandidates = [
    { apiKey, webappId: appId, nodeInfoList },
    { apiKey, webAppId: appId, nodeInfoList },
    { apiKey, appId, nodeInfoList }
  ];

  console.log("[PixelRunner/RunningHub] submit task", {
    appId,
    appName: String(payload.appName || app.name || "").trim(),
    inputCount: Array.isArray(nodeInfoList) ? nodeInfoList.length : 0,
    legacyParamCount: Object.keys(nodeParams).length
  });

  let lastError = null;
  for (const body of bodyCandidates) {
    try {
      console.log("[PixelRunner/RunningHub] submit body variant", Object.keys(body));
      const result = await fetchJsonWithTimeout(
        "https://www.runninghub.cn/task/openapi/ai-app/run",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        },
        Math.max(5000, Number(settings.timeout || 180) * 1000)
      );

      const taskId = parseTaskId(result);

      if (!taskId) {
        throw new Error((result && (result.message || result.msg)) || "Task created but taskId missing");
      }

      return { ok: true, taskId: String(taskId), result };
    } catch (error) {
      console.warn("[PixelRunner/RunningHub] ai-app/run failed", {
        variant: Object.keys(body).join(","),
        message: error && error.message ? error.message : String(error || "")
      });
      lastError = error;
      if (body.webappId && error && error.message && !isParameterShapeError(error.message)) {
        throw error;
      }
    }
  }

  if (Object.keys(nodeParams).length > 0) {
    const legacyBody = { apiKey, workflowId: appId, nodeParams };
    try {
      console.log("[PixelRunner/RunningHub] fallback legacy submit", {
        workflowId: appId,
        paramCount: Object.keys(nodeParams).length
      });
      const result = await fetchJsonWithTimeout(
        "https://www.runninghub.cn/task/openapi/create",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(legacyBody)
        },
        Math.max(5000, Number(settings.timeout || 180) * 1000)
      );

      const taskId = parseTaskId(result);
      if (!taskId) {
        throw new Error((result && (result.message || result.msg)) || "Legacy task created but taskId missing");
      }

      return { ok: true, taskId: String(taskId), result, mode: "legacy" };
    } catch (error) {
      console.warn("[PixelRunner/RunningHub] legacy submit failed", {
        message: error && error.message ? error.message : String(error || "")
      });
      lastError = error;
    }
  }

  throw lastError || new Error("RunningHub task submission failed");
}

export async function fetchRunningHubAccountStatus(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || "").trim();
  if (!apiKey) {
    return { ok: false, balance: null, coins: null };
  }

  const result = await fetchJsonWithTimeout("https://www.runninghub.cn/uc/openapi/accountStatus", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ apikey: apiKey })
  });

  const data = (result && (result.data || result.result)) || {};
  const account = data && data.accountStatus && typeof data.accountStatus === "object" ? data.accountStatus : data;
  return {
    ok: true,
    balance: account.remainMoney ?? account.balance ?? account.amount ?? account.walletBalance ?? account.money ?? null,
    coins: account.remainCoins ?? account.coins ?? account.rhCoins ?? account.integral ?? null,
    result
  };
}

export async function pollRunningHubTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || "").trim();
  const taskId = String(payload.taskId || "").trim();
  const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};

  if (!apiKey) throw new Error("RunningHub API Key is missing");
  if (!taskId) throw new Error("RunningHub taskId is missing");

  const pollIntervalMs = Math.max(1, Number(settings.pollInterval) || 2) * 1000;
  const timeoutMs = Math.max(10, Number(settings.timeout) || 180) * 1000;
  const startedAt = Date.now();
  const localController = typeof AbortController !== "undefined" ? new AbortController() : null;
  runninghubTaskControllers.set(taskId, localController);

  try {
    while (Date.now() - startedAt < timeoutMs) {
      if (localController && localController.signal.aborted) {
        throw new Error("Task polling cancelled");
      }

      try {
        const result = await fetchJsonWithTimeout(
          "https://www.runninghub.cn/task/openapi/outputs",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ apiKey, taskId }),
            signal: localController ? localController.signal : undefined
          },
          30000
        );

        const payloadData = (result && (result.data || result.result)) || result;
        const outputUrl = extractOutputUrl(payloadData);
        if (outputUrl) {
          return { ok: true, taskId, status: "SUCCEEDED", outputUrl, result };
        }

        const status = extractTaskStatus(payloadData);
        if (isFailedStatus(status)) {
          throw new Error((result && (result.message || result.msg)) || `Task failed (${status})`);
        }

        if (!isPendingStatus(status) && !isPendingMessage(result && (result.message || result.msg))) {
          throw new Error((result && (result.message || result.msg)) || "Unknown task status");
        }
      } catch (error) {
        if (localController && localController.signal.aborted) {
          throw new Error("Task polling cancelled");
        }
        if (!isPendingMessage(error && error.message)) {
          throw error;
        }
      }

      await sleep(pollIntervalMs);
    }

    throw new Error("Task polling timed out. Please check the RunningHub task list later.");
  } finally {
    runninghubTaskControllers.delete(taskId);
  }
}

export async function cancelRunningHubTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || "").trim();
  const taskId = String(payload.taskId || "").trim();

  if (!apiKey) throw new Error("RunningHub API Key is missing");
  if (!taskId) throw new Error("RunningHub taskId is missing");

  const controller = runninghubTaskControllers.get(taskId);
  if (controller && typeof controller.abort === "function") {
    try {
      controller.abort();
    } catch (_) {}
  }

  const result = await fetchJsonWithTimeout("https://www.runninghub.cn/task/openapi/cancel", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ apiKey, taskId })
  });

  return { ok: true, taskId, result };
}
