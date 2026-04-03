function getById(id) {
  return document.getElementById(id);
}

function registerListener(target, type, listener) {
  if (!target || typeof target.addEventListener !== "function") {
    return () => {};
  }

  target.addEventListener(type, listener);
  return () => {
    try {
      target.removeEventListener(type, listener);
    } catch (_) {
      // Ignore listener cleanup failures in the thin host shell.
    }
  };
}

function setHostStatus(message, level = "info") {
  const statusEl = getById("hostStatus");
  if (!statusEl) return;

  statusEl.textContent = String(message || "");
  statusEl.classList.remove("is-info", "is-success", "is-warning");
  statusEl.classList.add(`is-${level}`);
}

function createBridgeResponse(message, result, error) {
  return {
    id: message && message.id,
    result: error ? null : result,
    error: error
      ? {
          message: String(error && error.message ? error.message : error || "Unknown bridge error")
        }
      : null
  };
}

function readHostStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function writeHostStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (_) {
    return false;
  }
}

const runninghubTaskControllers = new Map();

function normalizeAppId(value) {
  return String(value == null ? "" : value).trim();
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

function normalizeInputValue(input, value) {
  const typeMarker = String((input && input.type) || "").trim().toLowerCase();
  if (typeMarker === "image" || typeMarker === "file") {
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

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch (_) {
          // Ignore abort cleanup failures.
        }
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

async function submitRunningHubTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const app = payload.app && typeof payload.app === "object" ? payload.app : {};
  const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
  const apiKey = String(payload.apiKey || "").trim();
  const appId = normalizeAppId(app.appId || payload.appId);

  if (!apiKey) {
    throw new Error("RunningHub API Key is missing");
  }

  if (!appId) {
    throw new Error("RunningHub App ID is missing");
  }

  const nodeInfoList = buildNodeInfoList(app, payload.inputs);
  const bodyCandidates = [
    { apiKey, webappId: appId, nodeInfoList },
    { apiKey, webAppId: appId, nodeInfoList },
    { apiKey, appId, nodeInfoList }
  ];

  let lastError = null;
  for (const body of bodyCandidates) {
    try {
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

      const taskId =
        (result && result.data && (result.data.taskId || result.data.id)) ||
        (result && (result.taskId || result.id)) ||
        "";

      if (!taskId) {
        throw new Error((result && (result.message || result.msg)) || "Task created but taskId missing");
      }

      return {
        ok: true,
        taskId: String(taskId),
        result
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("RunningHub task submission failed");
}

async function fetchRunningHubAccountStatus(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      balance: null,
      coins: null
    };
  }

  const result = await fetchJsonWithTimeout("https://www.runninghub.cn/uc/openapi/accountStatus", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  const data = (result && (result.data || result.result)) || {};
  return {
    ok: true,
    balance: data.balance ?? data.amount ?? data.walletBalance ?? null,
    coins: data.coins ?? data.rhCoins ?? data.integral ?? null,
    result
  };
}

async function pollRunningHubTask(args = []) {
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
        throw new Error("任务轮询已取消");
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
          return {
            ok: true,
            taskId,
            status: "SUCCEEDED",
            outputUrl,
            result
          };
        }

        const status = extractTaskStatus(payloadData);
        if (isFailedStatus(status)) {
          throw new Error((result && (result.message || result.msg)) || `任务失败 (${status})`);
        }

        if (!isPendingStatus(status) && !isPendingMessage(result && (result.message || result.msg))) {
          throw new Error((result && (result.message || result.msg)) || "任务状态未知");
        }
      } catch (error) {
        if (localController && localController.signal.aborted) {
          throw new Error("任务轮询已取消");
        }
        if (!isPendingMessage(error && error.message)) {
          throw error;
        }
      }

      await sleep(pollIntervalMs);
    }

    throw new Error("任务轮询超时，请稍后去 RunningHub 任务列表查看");
  } finally {
    runninghubTaskControllers.delete(taskId);
  }
}

async function cancelRunningHubTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || "").trim();
  const taskId = String(payload.taskId || "").trim();

  if (!apiKey) throw new Error("RunningHub API Key is missing");
  if (!taskId) throw new Error("RunningHub taskId is missing");

  const controller = runninghubTaskControllers.get(taskId);
  if (controller && typeof controller.abort === "function") {
    try {
      controller.abort();
    } catch (_) {
      // Ignore local abort cleanup failures.
    }
  }

  const result = await fetchJsonWithTimeout("https://www.runninghub.cn/task/openapi/cancel", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ apiKey, taskId })
  });

  return {
    ok: true,
    taskId,
    result
  };
}

async function getPhotoshopDocumentInfo() {
  const photoshopService =
    typeof window !== "undefined" &&
    window.PixelRunnerHost &&
    window.PixelRunnerHost.photoshop;

  if (!photoshopService || typeof photoshopService.getActiveDocumentInfo !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }

  return photoshopService.getActiveDocumentInfo();
}

async function capturePhotoshopDocumentPreview(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const photoshopService =
    typeof window !== "undefined" &&
    window.PixelRunnerHost &&
    window.PixelRunnerHost.photoshop;

  if (!photoshopService || typeof photoshopService.captureDocumentPreview !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }

  return photoshopService.captureDocumentPreview(payload);
}

async function runPhotoshopToolAction(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const photoshopService =
    typeof window !== "undefined" &&
    window.PixelRunnerHost &&
    window.PixelRunnerHost.photoshop;

  if (!photoshopService || typeof photoshopService.runToolAction !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }

  return photoshopService.runToolAction(payload);
}

async function placeResultIntoPhotoshop(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const url = String(payload.url || "").trim();
  if (!url) {
    throw new Error("Result URL is missing");
  }

  const photoshopService =
    typeof window !== "undefined" &&
    window.PixelRunnerHost &&
    window.PixelRunnerHost.photoshop;

  if (!photoshopService || typeof photoshopService.placeImageFromUrl !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }

  return photoshopService.placeImageFromUrl(payload);
}

async function handleBridgeRequest(message, webviewEl) {
  if (!message || typeof message !== "object" || !message.method) return;
  if (!webviewEl || typeof webviewEl.postMessage !== "function") return;

  try {
    let result = null;

    switch (message.method) {
      case "host.ping":
        result = {
          runtime: "uxp-host",
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : ""
        };
        break;
      case "storage.getItem":
        result = readHostStorage(message.args && message.args[0]);
        break;
      case "storage.setItem":
        result = writeHostStorage(message.args && message.args[0], message.args && message.args[1]);
        break;
      case "runninghub.submitTask":
        result = await submitRunningHubTask(message.args);
        break;
      case "runninghub.pollTask":
        result = await pollRunningHubTask(message.args);
        break;
      case "runninghub.cancelTask":
        result = await cancelRunningHubTask(message.args);
        break;
      case "runninghub.fetchAccountStatus":
        result = await fetchRunningHubAccountStatus(message.args);
        break;
      case "photoshop.getActiveDocumentInfo":
        result = await getPhotoshopDocumentInfo();
        break;
      case "photoshop.captureDocumentPreview":
        result = await capturePhotoshopDocumentPreview(message.args);
        break;
      case "photoshop.runToolAction":
        result = await runPhotoshopToolAction(message.args);
        break;
      case "photoshop.placeResultFromUrl":
        result = await placeResultIntoPhotoshop(message.args);
        break;
      default:
        throw new Error(`Unknown bridge method: ${message.method}`);
    }

    webviewEl.postMessage(createBridgeResponse(message, result, null));
  } catch (error) {
    webviewEl.postMessage(createBridgeResponse(message, null, error));
  }
}

function mountWebView() {
  const nextWebview = getById("pixelrunnerWebview");
  if (!nextWebview) {
    setHostStatus("WebView element not found in host shell.", "warning");
    return;
  }

  const onMessage = (event) => {
    const payload = event && event.data;
    if (!payload || typeof payload !== "object") return;

    if (payload.type === "pixelrunner.webview.ready") {
      setHostStatus("PixelRunner WebView ready", "success");
      document.body.classList.add("webview-ready");
      return;
    }

    if (payload.type === "pixelrunner.webview.log") {
      if (payload.level === "error") {
        console.error("[PixelRunner/WebView]", payload.message || payload);
      } else {
        console.log("[PixelRunner/WebView]", payload.message || payload);
      }
      return;
    }

    if (typeof payload.method === "string" && "id" in payload) {
      handleBridgeRequest(payload, nextWebview);
    }
  };

  registerListener(window, "message", onMessage);
  registerListener(nextWebview, "message", onMessage);

  setHostStatus("PixelRunner WebView mounted, waiting for ready signal...", "info");
}

document.addEventListener("DOMContentLoaded", () => {
  const looksLikeBrowserPreview =
    typeof window !== "undefined" &&
    typeof location !== "undefined" &&
    String(location.protocol || "").toLowerCase() === "file:";

  if (looksLikeBrowserPreview) {
    setHostStatus("This is the UXP host shell. Open app.html in a browser for UI preview.", "warning");
    return;
  }

  setHostStatus("Mounting PixelRunner WebView...", "info");
  mountWebView();
});
