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

test("workspace settings controller syncs paste strategy select from settings", () => {
  const select = { value: "normal" };
  const controller = createWorkspaceSettingsController({
    dom: {
      pasteStrategySelect: select
    },
    store: {
      getSettings: () => ({ pasteStrategy: "smartEnhanced" })
    },
    normalizePasteStrategy: (value) => (value ? String(value) : "normal")
  });

  controller.syncPasteStrategySelect();

  assert.equal(select.value, "smartEnhanced");
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

test("workspace settings controller persists paste strategy changes and logs marker", () => {
  const saved = [];
  const logs = [];
  const controller = createWorkspaceSettingsController({
    store: {
      getSettings: () => ({
        pollInterval: 2,
        timeout: 180,
        uploadMaxEdge: "1024",
        pasteStrategy: "normal"
      }),
      saveSettings: (payload) => {
        saved.push(payload);
      }
    },
    normalizePasteStrategy: (value) => (value === "smart" ? "smart" : "normal"),
    normalizeUploadMaxEdge: (value) => Number(value) || 0,
    pasteStrategyLabels: {
      smart: "智能（主体对齐）"
    },
    log: (message, type) => {
      logs.push({ message, type });
    }
  });

  controller.onPasteStrategyChange({
    target: { value: "smart" }
  });

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], {
    pollInterval: 2,
    timeout: 180,
    uploadMaxEdge: 1024,
    pasteStrategy: "smart"
  });
  assert.deepEqual(logs, [{ message: "回贴策略已切换: 智能（主体对齐）", type: "info" }]);
});

test("workspace settings controller refresh and settings change keep list and account in sync", async () => {
  const calls = {
    syncWorkspaceApps: [],
    logs: [],
    fetchAccountStatus: 0
  };
  const summary = { classList: createClassList(["is-empty"]) };
  const balance = { textContent: "" };
  const coins = { textContent: "" };
  const select = { value: "normal" };
  const controller = createWorkspaceSettingsController({
    dom: {
      accountSummary: summary,
      accountBalanceValue: balance,
      accountCoinsValue: coins,
      pasteStrategySelect: select
    },
    store: {
      getApiKey: () => "api-key",
      getSettings: () => ({ pasteStrategy: "smart" })
    },
    runninghub: {
      fetchAccountStatus: async () => {
        calls.fetchAccountStatus += 1;
        return { remainMoney: "8.8", remainCoins: "21" };
      }
    },
    normalizePasteStrategy: (value) => String(value || "normal"),
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
  assert.equal(calls.fetchAccountStatus, 2);
  assert.equal(select.value, "smart");
  assert.equal(balance.textContent, "8.8");
  assert.equal(coins.textContent, "21");
  assert.equal(summary.classList.contains("is-empty"), false);
});
