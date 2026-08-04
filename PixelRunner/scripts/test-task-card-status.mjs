import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

console.log("task card status and cost tests passed");
