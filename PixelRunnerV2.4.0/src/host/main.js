import { createBridgeResponse, getById, registerListener, setHostStatus } from "./bridge.js";
import {
  cancelRunningHubTask,
  fetchRunningHubAccountStatus,
  pollRunningHubTask,
  submitRunningHubTask
} from "./runninghub.js";
import {
  capturePhotoshopDocumentPreview,
  getPhotoshopDocumentInfo,
  placeResultIntoPhotoshop,
  runPhotoshopToolAction
} from "./photoshop-bridge.js";

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
