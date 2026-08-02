import assert from "node:assert/strict";

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
