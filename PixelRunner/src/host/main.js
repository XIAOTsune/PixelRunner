import { createBridgeResponse, getById, registerListener, setHostStatus } from "./bridge.js";
import {
  cancelRunningHubTask,
  fetchRunningHubTaskStatus,
  fetchRunningHubAccountStatus,
  pollRunningHubTask,
  runAiOptimizeTask,
  submitRunningHubTask
} from "./runninghub.js";
import {
  cancelThirdPartyGrsTask,
  fetchThirdPartyGrsTaskStatus,
  listThirdPartyGrsModels,
  pollThirdPartyGrsTask,
  runThirdPartyGrsPromptOptimize,
  submitThirdPartyGrsTask
} from "./third-party-grs.js";
import { fetchRunningHubAppPreview, parseRunningHubApp } from "./runninghub-parser.js";
import { openTextFile, saveTextFile } from "./files.js";
import { openExternalUrl, openLocalPath, resolveTutorialPath } from "./shell.js";
import {
  capturePhotoshopDocumentPreview,
  deletePhotoshopSelectionSnapshot,
  getPhotoshopDocumentInfo,
  placeResultAndBlendIntoPhotoshop,
  placeResultIntoPhotoshop,
  runPhotoshopToolAction
} from "./photoshop-bridge.js";

let photoshopBridgeTail = Promise.resolve();
let photoshopBridgeQueueDepth = 0;
let photoshopBridgeSequence = 0;

function getPhotoshopBridgeLabel(message) {
  const method = String(message && message.method || "photoshop.unknown");
  const payload = message && message.args && message.args[0] && typeof message.args[0] === "object"
    ? message.args[0]
    : {};
  if (method === "photoshop.runToolAction") {
    const action = String(payload.action || "unknown").trim();
    return `${method}:${action}`;
  }
  if (method === "photoshop.placeResultWithBlendMatch") {
    return `${method}:placeResult+blendMatch`;
  }
  return method;
}

function enqueuePhotoshopBridgeOperation(message, operation) {
  const queuedAt = Date.now();
  const sequence = ++photoshopBridgeSequence;
  const requestId = String(message && message.id || "");
  const label = getPhotoshopBridgeLabel(message);
  photoshopBridgeQueueDepth += 1;
  const run = photoshopBridgeTail
    .catch(() => undefined)
    .then(async () => {
      const waitedMs = Date.now() - queuedAt;
      const startedAt = Date.now();
      console.log(
        `[PixelRunner/Host] Photoshop bridge start #${sequence} ${label} id=${requestId} waitedMs=${waitedMs} queueDepth=${photoshopBridgeQueueDepth}`
      );
      try {
        const result = await operation();
        console.log(
          `[PixelRunner/Host] Photoshop bridge success #${sequence} ${label} id=${requestId} waitedMs=${waitedMs} durationMs=${Date.now() - startedAt}`
        );
        return result;
      } catch (error) {
        console.error(
          `[PixelRunner/Host] Photoshop bridge failure #${sequence} ${label} id=${requestId} waitedMs=${waitedMs} durationMs=${Date.now() - startedAt} error=${String(error && error.message ? error.message : error || "Unknown error")}`
        );
        throw error;
      } finally {
        photoshopBridgeQueueDepth = Math.max(0, photoshopBridgeQueueDepth - 1);
      }
    });

  photoshopBridgeTail = run.then(() => undefined, () => undefined);
  return run;
}

function getPhotoshopVersionInfo() {
  try {
    if (typeof require !== "function") return null;
    const photoshop = require("photoshop");
    const version = String(photoshop && photoshop.app && photoshop.app.version ? photoshop.app.version : "");
    const match = version.match(/(\d+)(?:\.(\d+))?/);
    if (!match) return { raw: version, major: 0, minor: 0 };
    return {
      raw: version,
      major: Number(match[1]) || 0,
      minor: Number(match[2]) || 0
    };
  } catch (_) {
    return null;
  }
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

function postBridgeResponse(target, response) {
  if (!target) return;
  if (target === window) {
    window.dispatchEvent(new MessageEvent("message", { data: response }));
    return;
  }
  if (typeof target.postMessage === "function") {
    target.postMessage(response);
  }
}

async function handleBridgeRequest(message, responseTarget) {
  if (!message || typeof message !== "object" || !message.method) return;
  if (!responseTarget) return;

  const requestStartedAt = Date.now();
  try {
    console.log("[PixelRunner/Host] bridge request", message.method, message.id || "");
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
      case "file.saveText":
        result = await saveTextFile(message.args);
        break;
      case "file.openText":
        result = await openTextFile(message.args);
        break;
      case "runninghub.submitTask":
        result = await submitRunningHubTask(message.args);
        break;
      case "runninghub.pollTask":
        result = await pollRunningHubTask(message.args);
        break;
      case "runninghub.fetchTaskStatus":
        result = await fetchRunningHubTaskStatus(message.args);
        break;
      case "runninghub.cancelTask":
        result = await cancelRunningHubTask(message.args);
        break;
      case "runninghub.fetchAccountStatus":
        result = await fetchRunningHubAccountStatus(message.args);
        break;
      case "runninghub.runAiOptimize":
        result = await runAiOptimizeTask(message.args);
        break;
      case "runninghub.parseApp":
        result = await parseRunningHubApp(message.args);
        break;
      case "runninghub.fetchAppPreview":
        result = await fetchRunningHubAppPreview(message.args);
        break;
      case "thirdParty.grs.submitTask":
        result = await submitThirdPartyGrsTask(message.args);
        break;
      case "thirdParty.grs.pollTask":
        result = await pollThirdPartyGrsTask(message.args);
        break;
      case "thirdParty.grs.fetchTaskStatus":
        result = await fetchThirdPartyGrsTaskStatus(message.args);
        break;
      case "thirdParty.grs.cancelTask":
        result = await cancelThirdPartyGrsTask(message.args);
        break;
      case "thirdParty.grs.listModels":
        result = await listThirdPartyGrsModels(message.args);
        break;
      case "thirdParty.grs.optimizePrompt":
        result = await runThirdPartyGrsPromptOptimize(message.args);
        break;
      case "photoshop.getActiveDocumentInfo":
        result = await enqueuePhotoshopBridgeOperation(message, () => getPhotoshopDocumentInfo());
        break;
      case "photoshop.captureDocumentPreview":
        result = await enqueuePhotoshopBridgeOperation(message, () => capturePhotoshopDocumentPreview(message.args));
        break;
      case "photoshop.deleteSelectionSnapshot":
        result = await enqueuePhotoshopBridgeOperation(message, () => deletePhotoshopSelectionSnapshot(message.args));
        break;
      case "photoshop.runToolAction":
        result = await enqueuePhotoshopBridgeOperation(message, () => runPhotoshopToolAction(message.args));
        break;
      case "photoshop.placeResultFromUrl":
        result = await enqueuePhotoshopBridgeOperation(message, () => placeResultIntoPhotoshop(message.args));
        break;
      case "photoshop.placeResultWithBlendMatch":
        result = await enqueuePhotoshopBridgeOperation(message, () => placeResultAndBlendIntoPhotoshop(message.args));
        break;
      case "shell.openExternal":
        result = await openExternalUrl(message.args);
        break;
      case "shell.openPath":
        result = await openLocalPath(message.args);
        break;
      case "shell.resolveTutorialPath":
        result = await resolveTutorialPath();
        break;
      default:
        throw new Error(`Unknown bridge method: ${message.method}`);
    }

    console.log(
      `[PixelRunner/Host] bridge success ${message.method} ${message.id || ""} durationMs=${Date.now() - requestStartedAt} hasResult=${result !== null && result !== undefined}`
    );
    postBridgeResponse(responseTarget, createBridgeResponse(message, result, null));
  } catch (error) {
    console.error(
      `[PixelRunner/Host] bridge error ${message.method} ${message.id || ""} durationMs=${Date.now() - requestStartedAt}`,
      error
    );
    postBridgeResponse(responseTarget, createBridgeResponse(message, null, error));
  }
}

function mountWebView() {
  const photoshopVersion = getPhotoshopVersionInfo();
  console.log("[PixelRunner/Host] Photoshop version", photoshopVersion ? photoshopVersion.raw : "unknown");

  const nextWebview = getById("pixelrunnerWebview");
  if (!nextWebview) {
    setHostStatus("WebView element not found in host shell.", "warning");
    return;
  }

  let webviewReady = false;

  const onMessage = (event) => {
    const payload = event && event.data;
    if (!payload || typeof payload !== "object") return;

    if (payload.type === "pixelrunner.webview.ready") {
      webviewReady = true;
      setHostStatus("像素起子（小T修图助手）WebView 已就绪", "success");
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

  setHostStatus("像素起子（小T修图助手）WebView 已挂载，等待就绪信号...", "info");
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

  setHostStatus("正在挂载像素起子（小T修图助手）WebView...", "info");
  mountWebView();
});
