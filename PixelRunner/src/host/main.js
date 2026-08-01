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
import {
  openExternalUrl,
  openLocalPath,
  resolveTutorialPath,
  startLocalUpscaleEngine
} from "./shell.js";
import {
  cancelLocalUpscaleJob,
  getLocalUpscaleHealth,
  getLocalUpscaleJob,
  recordLocalUpscalePlacement,
  stopLocalUpscaleEngine,
  submitLocalUpscaleJob
} from "./local-upscale.js";
import {
  capturePhotoshopDocumentPreview,
  capturePhotoshopDocumentForLocalUpscale,
  deletePhotoshopSelectionSnapshot,
  getPhotoshopDocumentInfo,
  openLocalUpscaleResultInPhotoshop,
  placeLocalUpscaleResultIntoPhotoshop,
  placeResultAndBlendIntoPhotoshop,
  placeResultIntoPhotoshop,
  runPhotoshopToolAction
} from "./photoshop-bridge.js";
import { createHostLicenseEnforcer } from "./license-enforcement.js";
import { createHostLicenseStorage } from "./license-storage.js";

// Result downloads run outside this queue; only Photoshop-critical stages are serialized here.
const PHOTOSHOP_BRIDGE_PRIORITY = Object.freeze({
  CAPTURE: 100,
  DOCUMENT_INFO: 80,
  STANDARD: 60,
  PLACEMENT: 30,
  BLEND_MATCH: 20
});
const PLACEMENT_JOB_CACHE_MS = 5 * 60 * 1000;
const photoshopBridgeQueue = [];
const photoshopPlacementJobs = new Map();
let photoshopBridgeActive = false;
let photoshopBridgeDrainScheduled = false;
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

function schedulePhotoshopBridgeDrain() {
  if (photoshopBridgeActive || photoshopBridgeDrainScheduled || photoshopBridgeQueue.length === 0) return;
  photoshopBridgeDrainScheduled = true;
  setTimeout(() => {
    photoshopBridgeDrainScheduled = false;
    void drainPhotoshopBridgeQueue();
  }, 0);
}

async function drainPhotoshopBridgeQueue() {
  if (photoshopBridgeActive || photoshopBridgeQueue.length === 0) return;
  photoshopBridgeQueue.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
  const entry = photoshopBridgeQueue.shift();
  photoshopBridgeActive = true;
  const waitedMs = Date.now() - entry.queuedAt;
  const startedAt = Date.now();
  console.log(
    `[PixelRunner/Host] Photoshop bridge start #${entry.sequence} ${entry.label} id=${entry.requestId} waitedMs=${waitedMs} queueDepth=${photoshopBridgeQueueDepth} priority=${entry.priority}`
  );
  try {
    const result = await entry.operation();
    console.log(
      `[PixelRunner/Host] Photoshop bridge success #${entry.sequence} ${entry.label} id=${entry.requestId} waitedMs=${waitedMs} durationMs=${Date.now() - startedAt}`
    );
    entry.resolve(result);
  } catch (error) {
    console.error(
      `[PixelRunner/Host] Photoshop bridge failure #${entry.sequence} ${entry.label} id=${entry.requestId} waitedMs=${waitedMs} durationMs=${Date.now() - startedAt} error=${String(error && error.message ? error.message : error || "Unknown error")}`
    );
    entry.reject(error);
  } finally {
    photoshopBridgeQueueDepth = Math.max(0, photoshopBridgeQueueDepth - 1);
    photoshopBridgeActive = false;
    schedulePhotoshopBridgeDrain();
  }
}

function enqueuePhotoshopBridgeOperation(message, operation, options = {}) {
  const queuedAt = Date.now();
  const sequence = ++photoshopBridgeSequence;
  const requestId = String(message && message.id || "");
  const label = String(options.label || getPhotoshopBridgeLabel(message));
  const priority = Number.isFinite(Number(options.priority))
    ? Number(options.priority)
    : PHOTOSHOP_BRIDGE_PRIORITY.STANDARD;
  photoshopBridgeQueueDepth += 1;
  return new Promise((resolve, reject) => {
    photoshopBridgeQueue.push({
      queuedAt,
      sequence,
      requestId,
      label,
      priority,
      operation,
      resolve,
      reject
    });
    schedulePhotoshopBridgeDrain();
  });
}

function getPhotoshopPlacementJobKey(message) {
  const payload = message && message.args && message.args[0] && typeof message.args[0] === "object"
    ? message.args[0]
    : {};
  const taskId = String(payload.taskId || "").trim();
  return taskId ? `task:${taskId}` : "";
}

function cleanupPhotoshopPlacementJobs() {
  const expiredBefore = Date.now() - PLACEMENT_JOB_CACHE_MS;
  for (const [key, job] of photoshopPlacementJobs.entries()) {
    if (job.completedAt > 0 && job.completedAt < expiredBefore) photoshopPlacementJobs.delete(key);
  }
}

function runDeduplicatedPhotoshopPlacement(message, operation) {
  // A WebView timeout does not cancel host work, so retries must reuse the same placement job.
  cleanupPhotoshopPlacementJobs();
  const key = getPhotoshopPlacementJobKey(message);
  if (!key) return operation();
  const existing = photoshopPlacementJobs.get(key);
  if (existing) {
    console.log(`[PixelRunner/Host] reuse Photoshop placement job ${key} completed=${existing.completedAt > 0}`);
    return existing.promise;
  }

  const job = { promise: null, completedAt: 0 };
  job.promise = Promise.resolve()
    .then(operation)
    .then(
      (result) => {
        job.completedAt = Date.now();
        return result;
      },
      (error) => {
        if (photoshopPlacementJobs.get(key) === job) photoshopPlacementJobs.delete(key);
        throw error;
      }
    );
  photoshopPlacementJobs.set(key, job);
  return job.promise;
}

function createPhotoshopPlacementRuntime(message) {
  const baseLabel = getPhotoshopBridgeLabel(message);
  return {
    enqueuePhotoshopOperation(operation, context = {}) {
      const stage = String(context.stage || "placing");
      const isBlendMatch = stage === "blendMatch";
      return enqueuePhotoshopBridgeOperation(message, operation, {
        label: `${baseLabel}:${stage}`,
        priority: isBlendMatch ? PHOTOSHOP_BRIDGE_PRIORITY.BLEND_MATCH : PHOTOSHOP_BRIDGE_PRIORITY.PLACEMENT
      });
    }
  };
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

const hostLicenseStorage = createHostLicenseStorage(() => {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
});

function readHostStorage(key) {
  return hostLicenseStorage.getItem(key);
}

function writeHostStorage(key, value) {
  return hostLicenseStorage.setItem(key, value);
}

const hostLicenseEnforcer = createHostLicenseEnforcer({
  storage: {
    getItem: readHostStorage,
    setItem: writeHostStorage
  }
});

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
    // Check again in the Host before any protected capture, analysis, export,
    // model startup, or Photoshop write. WebView button state is not trusted.
    hostLicenseEnforcer.assertBridgeRequest(message);
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
      case "localUpscale.getHealth":
        result = await getLocalUpscaleHealth(message.args);
        break;
      case "localUpscale.startEngine":
        result = await startLocalUpscaleEngine(message.args);
        break;
      case "localUpscale.stopEngine":
        result = await stopLocalUpscaleEngine(message.args);
        break;
      case "localUpscale.submitJob":
        result = await submitLocalUpscaleJob(message.args);
        break;
      case "localUpscale.getJob":
        result = await getLocalUpscaleJob(message.args);
        break;
      case "localUpscale.cancelJob":
        result = await cancelLocalUpscaleJob(message.args);
        break;
      case "localUpscale.recordPlacement":
        result = await recordLocalUpscalePlacement(message.args);
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
        result = await enqueuePhotoshopBridgeOperation(message, () => getPhotoshopDocumentInfo(), {
          priority: PHOTOSHOP_BRIDGE_PRIORITY.DOCUMENT_INFO
        });
        break;
      case "photoshop.captureDocumentPreview":
        result = await enqueuePhotoshopBridgeOperation(message, () => capturePhotoshopDocumentPreview([{
          ...(message.args && message.args[0] && typeof message.args[0] === "object" ? message.args[0] : {}),
          fullResolution: false,
          skipUploadAsset: false
        }]), {
          priority: PHOTOSHOP_BRIDGE_PRIORITY.CAPTURE
        });
        break;
      case "photoshop.captureLicensedGlowPreview":
      case "photoshop.captureLicensedSpaceFxPreview":
        result = await enqueuePhotoshopBridgeOperation(message, () => capturePhotoshopDocumentPreview([{
          ...(message.args && message.args[0] && typeof message.args[0] === "object" ? message.args[0] : {}),
          fullResolution: false,
          skipUploadAsset: false
        }]), {
          priority: PHOTOSHOP_BRIDGE_PRIORITY.CAPTURE
        });
        break;
      case "photoshop.captureLicensedSpaceFxSource":
        result = await enqueuePhotoshopBridgeOperation(message, () => capturePhotoshopDocumentPreview([{
          expectedDocumentId: Number(message.args && message.args[0] && message.args[0].expectedDocumentId) || 0,
          fullResolution: true,
          skipUploadAsset: true,
          captureFormat: "png",
          ignoreSelection: true
        }]), {
          priority: PHOTOSHOP_BRIDGE_PRIORITY.CAPTURE
        });
        break;
      case "photoshop.captureLocalUpscaleSource":
        result = await enqueuePhotoshopBridgeOperation(message, () => capturePhotoshopDocumentForLocalUpscale(message.args), {
          priority: PHOTOSHOP_BRIDGE_PRIORITY.CAPTURE
        });
        break;
      case "photoshop.deleteSelectionSnapshot":
        result = await enqueuePhotoshopBridgeOperation(message, () => deletePhotoshopSelectionSnapshot(message.args), {
          priority: PHOTOSHOP_BRIDGE_PRIORITY.STANDARD
        });
        break;
      case "photoshop.runToolAction":
        result = await enqueuePhotoshopBridgeOperation(message, () => runPhotoshopToolAction(message.args), {
          priority: PHOTOSHOP_BRIDGE_PRIORITY.STANDARD
        });
        break;
      case "photoshop.placeResultFromUrl":
        result = await runDeduplicatedPhotoshopPlacement(
          message,
          () => placeResultIntoPhotoshop(message.args, createPhotoshopPlacementRuntime(message))
        );
        break;
      case "photoshop.placeLicensedGlowResult":
      case "photoshop.placeLicensedSpaceFxResult":
        result = await runDeduplicatedPhotoshopPlacement(
          message,
          () => placeResultIntoPhotoshop(message.args, createPhotoshopPlacementRuntime(message))
        );
        break;
      case "photoshop.placeResultWithBlendMatch":
        result = await runDeduplicatedPhotoshopPlacement(
          message,
          () => placeResultAndBlendIntoPhotoshop(message.args, createPhotoshopPlacementRuntime(message))
        );
        break;
      case "photoshop.openLocalUpscaleResult":
        result = await enqueuePhotoshopBridgeOperation(message, () => openLocalUpscaleResultInPhotoshop(message.args), {
          priority: PHOTOSHOP_BRIDGE_PRIORITY.PLACEMENT
        });
        break;
      case "photoshop.placeLocalUpscaleResult":
        result = await runDeduplicatedPhotoshopPlacement(
          message,
          () => placeLocalUpscaleResultIntoPhotoshop(message.args, createPhotoshopPlacementRuntime(message))
        );
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
