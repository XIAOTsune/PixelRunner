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
import { openExternalUrl, openLocalPath, resolveTutorialPath } from "./shell.js";
import {
  capturePhotoshopDocumentPreview,
  getPhotoshopDocumentInfo,
  placeResultIntoPhotoshop,
  runPhotoshopToolAction
} from "./photoshop-bridge.js";

const WEBVIEW_READY_TIMEOUT_MS = 3500;

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

    console.log("[PixelRunner/Host] bridge success", message.method, {
      id: message.id || "",
      hasResult: result !== null && result !== undefined
    });
    postBridgeResponse(responseTarget, createBridgeResponse(message, result, null));
  } catch (error) {
    console.error("[PixelRunner/Host] bridge error", message.method, error);
    postBridgeResponse(responseTarget, createBridgeResponse(message, null, error));
  }
}

function parseAttributeMap(attributeText) {
  const attributes = {};
  String(attributeText || "").replace(/([^\s=]+)\s*=\s*"([^"]*)"/g, (_, name, value) => {
    attributes[name] = value;
    return "";
  });
  return attributes;
}

function createElementFromTag(tagText, fallbackTagName) {
  const tagNameMatch = String(tagText || "").match(/^<\s*([a-zA-Z0-9-]+)/);
  const element = document.createElement(tagNameMatch ? tagNameMatch[1] : fallbackTagName);
  const attributes = parseAttributeMap(tagText);
  Object.entries(attributes).forEach(([name, value]) => {
    if (name.toLowerCase() !== "href" && name.toLowerCase() !== "src") {
      element.setAttribute(name, value);
    }
  });
  return element;
}

async function readPluginText(relativePath) {
  if (typeof fetch === "function") {
    const response = await fetch(`plugin:/${relativePath}`);
    if (response && response.ok && typeof response.text === "function") {
      return response.text();
    }
  }

  if (typeof require === "function") {
    const { storage } = require("uxp");
    const pluginFolder = await storage.localFileSystem.getPluginFolder();
    const entry = await pluginFolder.getEntry(relativePath);
    return entry.read();
  }

  throw new Error(`Cannot read plugin file: ${relativePath}`);
}

async function loadScriptSequentially(src) {
  const script = document.createElement("script");
  script.src = src;
  document.body.appendChild(script);
  await new Promise((resolve, reject) => {
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
  });
}

async function mountInlineAppFallback() {
  if (document.body.classList.contains("inline-app-mounted")) return;

  setHostStatus("WebView 未返回 ready，正在启用兼容模式...", "warning");
  const appHtml = await readPluginText("app.html");
  const headMatch = appHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = appHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) throw new Error("Cannot find app.html body");

  const styleTags = [...String(headMatch ? headMatch[1] : "").matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/gi)];
  styleTags.forEach((match) => {
    const link = createElementFromTag(match[0], "link");
    const hrefMatch = match[0].match(/\bhref="([^"]+)"/i);
    if (!hrefMatch) return;
    link.href = hrefMatch[1].startsWith("plugin:/") ? hrefMatch[1] : `plugin:/${hrefMatch[1]}`;
    document.head.appendChild(link);
  });

  const bodyHtml = bodyMatch[1];
  const scriptSources = [...bodyHtml.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>\s*<\/script>/gi)].map((match) => match[1]);
  const inlineBodyHtml = bodyHtml.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  document.body.innerHTML = inlineBodyHtml;
  document.body.classList.add("inline-app-mounted");

  window.uxpHost = window.uxpHost || {};
  window.uxpHost.postMessage = (message) => {
    if (message && message.type === "pixelrunner.webview.ready") {
      setHostStatus("PixelRunner（小T修图助手） inline app ready", "success");
      document.body.classList.add("webview-ready");
      return;
    }

    if (message && message.type === "pixelrunner.webview.log") {
      if (message.level === "error") {
        console.error("[PixelRunner/Inline]", message.message || message);
      } else {
        console.log("[PixelRunner/Inline]", message.message || message);
      }
      return;
    }

    if (message && typeof message.method === "string" && "id" in message) {
      handleBridgeRequest(message, window);
    }
  };

  for (const src of scriptSources) {
    await loadScriptSequentially(src.startsWith("plugin:/") ? src : `plugin:/${src}`);
  }
}

function mountWebView() {
  const nextWebview = getById("pixelrunnerWebview");
  if (!nextWebview) {
    setHostStatus("WebView element not found in host shell.", "warning");
    return;
  }

  let webviewReady = false;
  let fallbackStarted = false;

  const onMessage = (event) => {
    const payload = event && event.data;
    if (!payload || typeof payload !== "object") return;

    if (payload.type === "pixelrunner.webview.ready") {
      webviewReady = true;
      setHostStatus("PixelRunner（小T修图助手） WebView ready", "success");
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

  setHostStatus("PixelRunner（小T修图助手） WebView mounted, waiting for ready signal...", "info");
  window.setTimeout(() => {
    if (webviewReady || fallbackStarted) return;
    fallbackStarted = true;
    mountInlineAppFallback().catch((error) => {
      console.error("[PixelRunner/Host] inline fallback failed", error);
      setHostStatus(`WebView 加载失败，兼容模式也未能启动：${error.message}`, "warning");
    });
  }, WEBVIEW_READY_TIMEOUT_MS);
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

  setHostStatus("Mounting PixelRunner（小T修图助手） WebView...", "info");
  mountWebView();
});
