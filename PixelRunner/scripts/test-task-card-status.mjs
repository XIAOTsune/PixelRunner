import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mergeCachedPngInfo } from "../src/host/photoshop/service.js";

globalThis.window = {
  PixelRunnerModules: {
    state: {
      RUNNINGHUB_REGIONS: { GLOBAL: "global", CN: "cn" },
      normalizeRunningHubRegion: (value) => String(value || "cn")
    }
  }
};
await import("../src/webview/workspace.js");

const workspace = globalThis.window.PixelRunnerModules.workspace;
const workspaceSource = await readFile(new URL("../src/webview/workspace.js", import.meta.url), "utf8");
const photoshopServiceSource = await readFile(new URL("../src/host/photoshop/service.js", import.meta.url), "utf8");
const hostMainSource = await readFile(new URL("../src/host/main.js", import.meta.url), "utf8");
const toolActionsSource = await readFile(new URL("../src/host/photoshop/tool-actions.js", import.meta.url), "utf8");
assert.match(toolActionsSource, /case "saturationObserverLayer"/);
assert.match(toolActionsSource, /type: \{ _obj: "selectiveColor" \}/);
assert.match(toolActionsSource, /_value: "absolute"/);
assert.match(toolActionsSource, /_obj: "colorCorrection"/);
assert.match(toolActionsSource, /method: \{ _enum: "correctionMethod", _value: "absolute" \}/);
assert.match(toolActionsSource, /_id: selectiveLayerId/);
assert.match(toolActionsSource, /_property: "adjustment"/);
assert.match(toolActionsSource, /_ref: "layer", _id: selectiveLayerId/);
assert.match(toolActionsSource, /saturation observer selective-color descriptor/);
assert.match(toolActionsSource, /type: \{ _obj: "curves" \}/);
assert.match(toolActionsSource, /createLayerGroupFromLayerIds/);
assert.match(workspaceSource, /const RUN_BUTTON_COOLDOWN_MS = 600;/);
assert.match(workspaceSource, /runButton\.disabled = .*captureInProgress/);
assert.match(workspaceSource, /runPlusButton\.disabled = .*captureInProgress/);
assert.match(workspaceSource, /if \(captureInProgress\) throw new Error\("正在捕获图像/);
assert.equal(workspace.getTaskDurationLabel({ status: "submitting" }), "提交耗时");
assert.equal(workspace.getTaskDurationLabel({ status: "queued", queueMode: "local" }), "排队等待");
assert.equal(workspace.getTaskDurationLabel({ status: "running" }), "已运行");
assert.equal(workspace.getTaskDurationLabel({ status: "tracking" }), "后台追踪");
assert.equal(workspace.getTaskDurationLabel({ status: "succeeded" }), "耗时");

assert.equal(workspace.getTaskCostLabel({ provider: "grs", status: "running" }), "费用 待结算");
assert.equal(workspace.getTaskCostLabel({ provider: "grs", status: "succeeded" }), "扣费 待确认");
assert.equal(
  workspace.getTaskCostLabel({ provider: "grs", status: "succeeded", chargeDisplay: "-$0.20" }),
  "扣费 -$0.20"
);
assert.equal(
  workspace.getTaskCostLabel({ provider: "runninghub", status: "succeeded", balanceCharge: 0.2 }),
  "-0.200R"
);

assert.equal(workspace.isAutoPlacementBlockedError(new Error("host is in a modal state")), true);
assert.equal(workspace.isAutoPlacementBlockedError(new Error("Photoshop is busy")), true);
assert.equal(workspace.isAutoPlacementBlockedError(new Error("command is currently unavailable")), false);
assert.equal(workspace.isAutoPlacementBlockedError(new Error("对象当前无法执行此命令")), false);
assert.equal(workspace.isAutoPlacementBlockedError(new Error("liquify result image could not be opened")), false);
assert.equal(workspace.isAutoPlacementRetryableError(new Error("command is currently unavailable")), false);
assert.deepEqual(
  [0, 1, 2, 3, 4, 20].map((attempt) => workspace.getAutoPlacementRetryDelayMs(attempt)),
  [2000, 4000, 7000, 10000, 10000, 10000]
);
assert.match(workspaceSource, /AUTO_PLACEMENT_BLOCKED_MAX_WAIT_MS = 120000/);
assert.equal(workspace.shouldStopAutoPlacementBlockedRetry(7, 0, 0), false);
assert.equal(workspace.shouldStopAutoPlacementBlockedRetry(8, 0, 0), true);
assert.equal(workspace.shouldStopAutoPlacementBlockedRetry(1, 1000, 121000), true);
assert.match(workspaceSource, /shouldStopAutoPlacementBlockedRetry\(blockedAttempts, blockedSince\)/);
assert.equal(workspace.isTaskRemoteCompleteStatus("placing"), true);
assert.equal(workspace.isTaskRemoteCompleteStatus("downloading"), true);
assert.equal(workspace.isTaskRemoteCompleteStatus("running"), false);
assert.match(workspaceSource, /!isTaskRemoteCompleteStatus\(task\.status\)/);

assert.equal(workspace.isAutoPlacementTargetDocumentError(new Error("Target document is unavailable: #1006")), true);
assert.equal(workspace.getAutoPlacementErrorType(new Error("Target document is unavailable: #1006")), "target-document");
assert.equal(workspace.getAutoPlacementErrorType(new Error("Photoshop is busy")), "photoshop-busy");
assert.equal(workspace.getAutoPlacementErrorType(new Error("Failed to download result (HTTP 503)")), "result-download");
assert.equal(workspace.isResultDownloadInvalidError(new Error("Failed to download result (HTTP 404)")), true);
assert.equal(workspace.isResultDownloadRetryableError(new Error("Failed to download result (HTTP 404)")), false);
assert.equal(workspace.isResultDownloadRetryableError(new Error("Failed to download result (HTTP 503)")), true);
assert.deepEqual(
  [0, 1, 2, 3, 4, 20].map((attempt) => workspace.getResultDownloadRetryDelayMs(attempt)),
  [5000, 5000, 15000, 30000, 30000, 30000]
);
assert.match(workspaceSource, /photoshop\.cacheResultFromUrl/);
assert.match(workspaceSource, /refreshAutoPlacementResultReference\(queued\)/);
assert.match(workspaceSource, /!statusResult\.failed && hasResultReference\(statusResult\)/);
assert.match(workspaceSource, /selectedModel: sourceConfig\.selectedModel \|\| taskModel/);
assert.match(workspaceSource, /model: payload && payload\.inputs && payload\.inputs\.model/);
assert.match(workspaceSource, /data-action="place-in-current-document"/);
assert.match(workspaceSource, /errorType: "target-document"/);
assert.ok(
  photoshopServiceSource.indexOf("Target document is unavailable") < photoshopServiceSource.indexOf("const downloaded = await fetchBinaryWithMetadata(url"),
  "target document availability must be checked before result download"
);
assert.match(photoshopServiceSource, /options\.cacheOnly === true/);
assert.match(photoshopServiceSource, /localSourceFile\.read\(\{ format: storage\.formats\.binary \}\)/);
assert.match(photoshopServiceSource, /resultImage: sanitizePngInfo\(pngInfo\)/);
assert.match(photoshopServiceSource, /!localSourceFile \|\| placementCompleted/);
assert.match(hostMainSource, /case "photoshop\.cacheResultFromUrl"/);
assert.match(workspaceSource, /const resultImage = response\.resultImage/);
assert.match(workspaceSource, /resultImage: result && result\.resultImage/);
assert.match(photoshopServiceSource, /placementBuffer && placementBuffer !== buffer/);

const parsedAnchoredPng = {
  width: 512,
  height: 512,
  hasTransparency: true,
  alphaBounds: { left: 0, top: 0, right: 512, bottom: 512, width: 512, height: 512 },
  boundsAnchored: false,
  _meta: { retained: true }
};
const restoredPng = mergeCachedPngInfo(parsedAnchoredPng, {
  width: 512,
  height: 512,
  hasTransparency: true,
  alphaBounds: { left: 96, top: 64, right: 420, bottom: 470, width: 324, height: 406 },
  boundsAnchored: true
});
assert.deepEqual(restoredPng.alphaBounds, {
  left: 96,
  top: 64,
  right: 420,
  bottom: 470,
  width: 324,
  height: 406
});
assert.equal(restoredPng.boundsAnchored, true);
assert.deepEqual(restoredPng._meta, { retained: true });
assert.equal(
  mergeCachedPngInfo(parsedAnchoredPng, {
    width: 1024,
    height: 1024,
    alphaBounds: { left: 1, top: 1, right: 10, bottom: 10 }
  }).alphaBounds.width,
  512,
  "metadata from a different cached image must not affect placement"
);

console.log("task card status and cost tests passed");
