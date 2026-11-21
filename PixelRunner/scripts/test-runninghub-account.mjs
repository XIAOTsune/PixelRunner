import assert from "node:assert/strict";

const classNames = new Set();
const summaryElement = {
  title: "",
  classList: {
    toggle(name, enabled) {
      if (enabled) classNames.add(name);
      else classNames.delete(name);
    }
  }
};
const elements = {
  accountSummary: summaryElement,
  accountBalanceValue: { textContent: "" },
  accountPointsValue: { textContent: "" }
};
const state = {
  settings: { apiKey: "initial-key", runningHubRegion: "global" },
  accountSummary: { balance: null, points: null, region: "global", currency: "USD", updatedAt: 0 }
};
const modules = {
  runtime: {
    isPluginRuntime: () => true,
    getById: (id) => elements[id] || null,
    callHost: async () => ({ ok: true, region: "global", balance: 5, points: 12.5, currency: "USD" })
  },
  state: {
    state,
    RUNNINGHUB_REGIONS: { GLOBAL: "global" },
    normalizeRunningHubRegion: (region) => region === "global" ? "global" : "cn"
  },
  workspace: { renderWorkspaceAccountSummary() {} },
  ui: { logToWorkspace() {} }
};

globalThis.window = { PixelRunnerModules: modules };
await import("../src/webview/settings.js");

const settings = modules.settings;
await settings.refreshAccountSummary({ apiKey: "stable-key", region: "global", force: true });
assert.equal(state.accountSummary.balance, 5);
assert.equal(state.accountSummary.points, 12.5);

modules.runtime.callHost = async () => { throw new Error("宿主通信超时：runninghub.fetchAccountStatus"); };
const staleAccount = await settings.refreshAccountSummary({ apiKey: "stable-key", region: "global", force: true, quiet: true });
assert.equal(staleAccount.stale, true);
assert.equal(state.accountSummary.balance, 5, "a refresh failure preserves the last successful balance");
assert.equal(state.accountSummary.points, 12.5, "a refresh failure preserves the last successful points");
assert.equal(state.accountSummary.stale, true);

const deferred = new Map();
modules.runtime.callHost = (_method, [payload], options) => {
  assert.equal(options.timeoutMs, 40000);
  return new Promise((resolve) => deferred.set(payload.apiKey, resolve));
};
const oldRequest = settings.refreshAccountSummary({ apiKey: "old-key", region: "cn", force: true, quiet: true });
const newRequest = settings.refreshAccountSummary({ apiKey: "new-key", region: "cn", force: true, quiet: true });
deferred.get("new-key")({ ok: true, region: "cn", balance: 30, points: 40, currency: "R" });
await newRequest;
deferred.get("old-key")({ ok: true, region: "cn", balance: 10, points: 20, currency: "R" });
await oldRequest;
assert.equal(state.accountSummary.balance, 30, "a late response from the previous API profile cannot overwrite the current account");
assert.equal(state.accountSummary.points, 40);
assert.equal(state.accountSummary.stale, false);

console.log("RunningHub account refresh tests passed.");
