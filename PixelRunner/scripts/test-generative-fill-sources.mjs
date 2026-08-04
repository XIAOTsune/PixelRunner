import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const elements = new Map();
const appPickerList = { dataset: {}, innerHTML: "" };
const appPickerStats = { textContent: "" };
const generativeFillSurface = { hidden: false, innerHTML: "" };
elements.set("appPickerList", appPickerList);
elements.set("appPickerStats", appPickerStats);
elements.set("generativeFillSurface", generativeFillSurface);

const workspaceLogs = [];
const storageWrites = [];
globalThis.window = {
  PixelRunnerModules: {
    runtime: {
      createId: (prefix = "id") => `${prefix}-test`,
      escapeHtml: (value) => String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;"),
      getById: (id) => elements.get(id) || null,
      isPluginRuntime: () => false,
      readJsonText: (value, fallback) => {
        try {
          return value ? JSON.parse(value) : fallback;
        } catch (_) {
          return fallback;
        }
      },
      storageGetItem: async () => null,
      storageSetItem: async (key, value) => storageWrites.push([key, value])
    },
    ui: {
      logToWorkspace: (message, status = "info") => workspaceLogs.push({ message, status })
    },
    quickEntries: {
      setWorkspaceMode: async (mode) => {
        globalThis.window.PixelRunnerModules.state.state.workspaceMode = mode;
      }
    }
  },
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout
};

await import("../src/webview/state.js");
const modules = globalThis.window.PixelRunnerModules;
const stateModule = modules.state;

const legacySettings = stateModule.normalizeSettings({
  generativeFillAppId: "legacy-runninghub-app"
});
assert.equal(legacySettings.generativeFillSource, stateModule.GENERATIVE_FILL_SOURCES.RUNNINGHUB);
assert.equal(legacySettings.generativeFillAppId, "legacy-runninghub-app");
assert.equal(stateModule.normalizeSettings({ generativeFillSource: "unknown" }).generativeFillSource, "runninghub");
assert.equal(stateModule.normalizeSettings({ generativeFillSource: "third-party" }).generativeFillSource, "third-party");

const legacyThirdParty = stateModule.normalizeThirdPartySettings({
  enabled: false,
  provider: "grs",
  grs: { apiKey: "legacy-key" }
});
assert.equal(legacyThirdParty.grs.apiKey, "legacy-key");
assert.equal(Object.hasOwn(legacyThirdParty, "enabled"), false);

modules.workspace = {
  updateThirdPartyDynamicOptions() {},
  renderWorkspace() {},
  refreshPhotoshopDocumentStatus: async () => ({ hasActiveDocument: false })
};
await import("../src/webview/workspace.js");
await import("../src/webview/generative-fill.js");
await import("../src/webview/apps.js");
await import("../src/webview/settings.js");
modules.workspace.updateThirdPartyDynamicOptions = () => {};
modules.workspace.updateRunButtonState = () => {};
modules.workspace.renderWorkspace = () => {};

stateModule.state.settings = stateModule.normalizeSettings({});
stateModule.state.thirdPartySettings = stateModule.normalizeThirdPartySettings({ enabled: false });
stateModule.state.apps = [];
stateModule.state.quickEntries = [];
stateModule.state.workspaceMode = "app";
modules.apps.renderAppPickerList();
assert.match(appPickerList.innerHTML, /data-action="select-third-party-app"/);
assert.match(appPickerList.innerHTML, /待配置 API Key/);
assert.equal(appPickerStats.textContent, "1 / 1");

const selectedWithoutKey = await modules.apps.setCurrentThirdPartyApp();
assert.equal(selectedWithoutKey, true);
assert.equal(stateModule.isThirdPartyApp(stateModule.state.currentApp), true);
assert.match(workspaceLogs.at(-1).message, /尚未配置 API Key.*设置页的第三方支持/);
assert.equal(workspaceLogs.at(-1).status, "warn");

const savedSource = await modules.settings.saveGenerativeFillSource("third-party");
assert.equal(savedSource, "third-party");
const sourceStorageWrite = storageWrites.findLast(([key]) => key === stateModule.STORAGE_KEYS.SETTINGS);
assert.ok(sourceStorageWrite);
assert.equal(JSON.parse(sourceStorageWrite[1]).generativeFillSource, "third-party");
stateModule.state.workspaceMode = "generative-fill";
const missingConfig = modules.generativeFill.getThirdPartyAvailability();
assert.equal(missingConfig.available, false);
assert.match(missingConfig.message, /设置页.*第三方支持.*GRS API Key/);
modules.generativeFill.render();
assert.match(generativeFillSurface.innerHTML, /data-generative-fill-source="third-party"/);
assert.match(generativeFillSurface.innerHTML, /请先到设置页的“第三方支持”中配置 GRS API Key/);
assert.match(generativeFillSurface.innerHTML, /data-action="submit-generative-fill" disabled/);

stateModule.state.thirdPartySettings = stateModule.normalizeThirdPartySettings({
  enabled: false,
  provider: "grs",
  grs: {
    apiKey: "configured-key",
    selectedModel: "nano-banana-2",
    resolution: "2K"
  }
});
const configured = modules.generativeFill.getThirdPartyAvailability();
assert.equal(configured.available, true);
assert.equal(configured.descriptor.config.apiKey, "configured-key");

const prompt = modules.generativeFill.buildThirdPartyGenerativeFillPrompt("add a window");
assert.match(prompt, /first image/);
assert.match(prompt, /second image as a grayscale mask/);
assert.match(prompt, /preserve every pixel outside the mask/);
assert.match(prompt, /Requested edit: add a window/);

const thirdPartyApp = stateModule.getThirdPartyApp();
const thirdPartyPayload = modules.workspace.buildThirdPartyRunPayload({
  kind: "generative-fill",
  appName: "创成式填充 · 第三方 API",
  app: thirdPartyApp,
  inputs: {
    mainImage: { dataUrl: "data:image/png;base64,bWFpbg==", mimeType: "image/png" },
    referenceImage: { dataUrl: "data:image/png;base64,bWFzaw==", mimeType: "image/png" },
    prompt,
    model: "nano-banana-2",
    aspectRatio: "auto",
    resolution: "2K"
  },
  generativeFill: { compatibilityMode: true, placementMaskDataUrl: "data:image/png;base64,bWFzaw==" }
});
assert.equal(thirdPartyPayload.provider, "grs");
assert.equal(thirdPartyPayload.kind, "generative-fill");
assert.equal(thirdPartyPayload.config.apiKey, "configured-key");
assert.equal(thirdPartyPayload.inputs.model, "nano-banana-2");
assert.equal(thirdPartyPayload.inputs.mainImage.mimeType, "image/png");
assert.equal(thirdPartyPayload.inputs.referenceImage.mimeType, "image/png");
assert.equal(thirdPartyPayload.generativeFill.compatibilityMode, true);

const settingsSource = await readFile(new URL("../src/webview/settings.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../app.html", import.meta.url), "utf8");
assert.match(settingsSource, /generativeFillSource: nextSettings\.generativeFillSource/);
assert.doesNotMatch(settingsSource, /thirdPartyEnabledInput|thirdPartySettings\.enabled/);
assert.doesNotMatch(htmlSource, /id="thirdPartyEnabledInput"/);
assert.match(htmlSource, /第三方 API 卡片始终显示在工作台应用切换中/);

console.log("Generative fill source compatibility and always-visible third-party card checks passed.");
