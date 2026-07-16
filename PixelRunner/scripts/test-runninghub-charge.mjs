import assert from "node:assert/strict";
import {
  extractTaskBalanceCharge,
  extractTaskCoinsCharge,
  formatTaskChargeDisplay,
  submitRunningHubTask
} from "../src/host/runninghub.js";

function assertCharge(payload, expectedBalance, expectedCoins) {
  assert.equal(extractTaskBalanceCharge(payload), expectedBalance);
  assert.equal(extractTaskCoinsCharge(payload), expectedCoins);
}

const duplicatedNestedOutputs = {
  taskId: "global-normal-task",
  status: "SUCCESS",
  results: [
    { url: "https://example.com/a.png", consumeMoney: "0.125", consumeCoins: "8" },
    { url: "https://example.com/b.png", consumeMoney: "0.125", consumeCoins: "8" }
  ]
};

assertCharge(duplicatedNestedOutputs, 0.125, 8);
assert.equal(formatTaskChargeDisplay(0.125, 8, "global"), "-$0.125 · -8RH");

assertCharge({
  billing: {
    consumeMoney: "0.125",
    charge: "0.125",
    consumeCoins: "8",
    coinCharge: "8"
  }
}, 0.125, 8);

assertCharge({
  results: [
    {
      consumeMoney: "0.125",
      thirdPartyConsumeMoney: "0.375",
      consumeCoins: "8",
      thirdPartyConsumeCoins: "3"
    },
    {
      consumeMoney: "0.125",
      thirdPartyConsumeMoney: "0.375",
      consumeCoins: "8",
      thirdPartyConsumeCoins: "3"
    }
  ]
}, 0.5, 11);

const duplicatedPlusOutputs = {
  instanceType: "plus",
  results: [
    { consumeMoney: "0.250", consumeCoins: "16" },
    { consumeMoney: "0.250", consumeCoins: "16" }
  ]
};
assertCharge(duplicatedPlusOutputs, 0.25, 16);

const originalFetch = globalThis.fetch;
const submittedRequests = [];
globalThis.fetch = async (url, options = {}) => {
  submittedRequests.push({ url: String(url), body: JSON.parse(String(options.body || "{}")) });
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ code: 0, data: { taskId: `task-${submittedRequests.length}` } });
    }
  };
};

try {
  const basePayload = {
    apiKey: "global-test-key",
    region: "global",
    appId: "global-test-app",
    app: { appId: "global-test-app", inputs: [] },
    inputs: {},
    settings: { plusModeEnabled: true, timeout: 5 }
  };

  await submitRunningHubTask([basePayload]);
  await submitRunningHubTask([{ ...basePayload, instanceType: "plus" }]);

  assert.equal(submittedRequests.length, 2);
  assert.equal(submittedRequests[0].url, "https://www.runninghub.ai/task/openapi/ai-app/run");
  assert.equal(Object.hasOwn(submittedRequests[0].body, "instanceType"), false);
  assert.equal(submittedRequests[1].body.instanceType, "plus");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("RunningHub charge tests passed.");
