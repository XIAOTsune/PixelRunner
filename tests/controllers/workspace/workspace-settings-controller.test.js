const test = require("node:test");
const assert = require("node:assert/strict");
const { createWorkspaceSettingsController } = require("../../../src/controllers/workspace/workspace-settings-controller");

function createClassList(initialValues = []) {
  const values = new Set(initialValues);
  return {
    add: (value) => {
      values.add(String(value));
    },
    remove: (value) => {
      values.delete(String(value));
    },
    contains: (value) => values.has(String(value))
  };
}

test("workspace settings controller forces paste strategy to normal", () => {
  const saved = [];
  const logs = [];
  const controller = createWorkspaceSettingsController({
    store: {
      getSettings: () => ({
        pollInterval: 2,
        timeout: 180,
        uploadMaxEdge: "1024",
        uploadRetryCount: "2",
        cloudConcurrentJobs: "7",
        pasteStrategy: "smartEnhanced"
      }),
      saveSettings: (payload) => {
        saved.push(payload);
      }
    },
    normalizeUploadMaxEdge: (value) => Number(value) || 0,
    normalizeUploadRetryCount: (value) => Number(value) || 2,
    normalizeCloudConcurrentJobs: (value) => Number(value) || 2,
    log: (message, type) => {
      logs.push({ message, type });
    }
  });

  controller.syncPasteStrategySelect();

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], {
    pollInterval: 2,
    timeout: 180,
    uploadMaxEdge: 1024,
    uploadRetryCount: 2,
    cloudConcurrentJobs: 7,
    pasteStrategy: "normal"
  });
  assert.deepEqual(logs, [{ message: "回贴策略已固定为: 普通（居中铺满）", type: "info" }]);
});

test("workspace settings controller keeps settings unchanged when paste strategy already normal", () => {
  const saved = [];
  const controller = createWorkspaceSettingsController({
    store: {
      getSettings: () => ({ pasteStrategy: "normal" }),
      saveSettings: (payload) => {
        saved.push(payload);
      }
    }
  });

  controller.syncPasteStrategySelect();

  assert.deepEqual(saved, []);
});

test("workspace settings controller updates account view when api key is missing", async () => {
  const summary = { classList: createClassList() };
  const balance = { textContent: "" };
  const coins = { textContent: "" };
  const controller = createWorkspaceSettingsController({
    dom: {
      accountSummary: summary,
      accountBalanceValue: balance,
      accountCoinsValue: coins
    },
    store: {
      getApiKey: () => ""
    }
  });

  await controller.updateAccountStatus();

  assert.equal(summary.classList.contains("is-empty"), true);
  assert.equal(balance.textContent, "--");
  assert.equal(coins.textContent, "--");
});

test("workspace settings controller fetches account status when api key exists", async () => {
  const summary = { classList: createClassList(["is-empty"]) };
  const balance = { textContent: "" };
  const coins = { textContent: "" };
  const calls = [];
  const controller = createWorkspaceSettingsController({
    dom: {
      accountSummary: summary,
      accountBalanceValue: balance,
      accountCoinsValue: coins
    },
    store: {
      getApiKey: () => "api-key"
    },
    runninghub: {
      fetchAccountStatus: async (apiKey) => {
        calls.push(apiKey);
        return {
          remainMoney: "12.5",
          remainCoins: "34"
        };
      }
    }
  });

  await controller.updateAccountStatus();

  assert.deepEqual(calls, ["api-key"]);
  assert.equal(summary.classList.contains("is-empty"), false);
  assert.equal(balance.textContent, "12.5");
  assert.equal(coins.textContent, "34");
});

test("workspace settings controller refresh and settings change keep list/account in sync", async () => {
  const calls = {
    syncWorkspaceApps: [],
    logs: [],
    fetchAccountStatus: 0,
    saveSettings: 0
  };
  const summary = { classList: createClassList(["is-empty"]) };
  const balance = { textContent: "" };
  const coins = { textContent: "" };
  const controller = createWorkspaceSettingsController({
    dom: {
      accountSummary: summary,
      accountBalanceValue: balance,
      accountCoinsValue: coins
    },
    store: {
      getApiKey: () => "api-key",
      getSettings: () => ({
        pollInterval: 2,
        timeout: 180,
        uploadMaxEdge: 0,
        uploadRetryCount: 2,
        cloudConcurrentJobs: 2,
        pasteStrategy: "smart"
      }),
      saveSettings: () => {
        calls.saveSettings += 1;
      }
    },
    runninghub: {
      fetchAccountStatus: async () => {
        calls.fetchAccountStatus += 1;
        return { remainMoney: "8.8", remainCoins: "21" };
      }
    },
    syncWorkspaceApps: (options) => {
      calls.syncWorkspaceApps.push(options);
    },
    log: (message, type) => {
      calls.logs.push({ message, type });
    }
  });

  controller.onRefreshWorkspaceClick();
  controller.onSettingsChanged();

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls.syncWorkspaceApps, [{ forceRerender: false }]);
  assert.equal(calls.logs.some((item) => item.message === "应用列表已刷新" && item.type === "info"), true);
  assert.equal(calls.logs.some((item) => item.message.includes("回贴策略已固定为")), true);
  assert.equal(calls.fetchAccountStatus, 2);
  assert.equal(calls.saveSettings, 1);
  assert.equal(balance.textContent, "8.8");
  assert.equal(coins.textContent, "21");
  assert.equal(summary.classList.contains("is-empty"), false);
});
