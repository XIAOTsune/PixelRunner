import assert from "node:assert/strict";
import {
  extractTaskBalanceCharge,
  extractTaskCoinsCharge,
  extractOutputUrl,
  extractReadyOutputUrl,
  fetchRunningHubTaskStatus,
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

const globalRunningPreview = {
  taskId: "global-preview-task",
  status: "RUNNING",
  results: [
    { url: "https://preview.example.com/intermediate.jpg", outputType: "jpg" }
  ]
};
assert.equal(extractOutputUrl(globalRunningPreview), "https://preview.example.com/intermediate.jpg");
assert.equal(extractReadyOutputUrl(globalRunningPreview), "");

const globalFinishedOutputs = {
  taskId: "global-finished-task",
  status: "SUCCESS",
  results: [
    { url: "https://example.com/result.txt", outputType: "txt" },
    { url: "https://rh-hk-images.example.com/final?id=1", outputType: "webp" }
  ]
};
assert.equal(extractReadyOutputUrl(globalFinishedOutputs), "https://rh-hk-images.example.com/final?id=1");

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
let globalTaskSnapshot = null;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes("/media/upload/binary") || String(url).includes("/uc/openapi/upload")) {
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ data: { fileName: "neutral-gray-image-token" } });
      }
    };
  }
  if (String(url).endsWith("/openapi/v2/query")) {
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(globalTaskSnapshot);
      }
    };
  }
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

  await submitRunningHubTask([{
    ...basePayload,
    app: {
      appId: "global-test-app",
      inputs: [
        { key: "mainImage", type: "image" },
        { key: "controlImage", type: "image" },
        { key: "referenceImage", type: "image" },
        { key: "skippedImage", type: "image", emptyBehavior: "skip" }
      ]
    },
    inputs: {}
  }]);
  const optionalImageFields = submittedRequests[2].body.nodeInfoList;
  assert.deepEqual(optionalImageFields, [
    { nodeId: "mainImage", fieldName: "mainImage", fieldValue: "neutral-gray-image-token" },
    { nodeId: "controlImage", fieldName: "controlImage", fieldValue: "neutral-gray-image-token" },
    { nodeId: "referenceImage", fieldName: "referenceImage", fieldValue: "neutral-gray-image-token" }
  ]);
  await assert.rejects(
    () => submitRunningHubTask([{
      ...basePayload,
      app: { appId: "global-test-app", inputs: [{ key: "requiredImage", type: "image", required: true }] },
      inputs: {}
    }]),
    /Missing required input: requiredImage/
  );

  globalTaskSnapshot = globalRunningPreview;
  const runningStatus = await fetchRunningHubTaskStatus([{
    apiKey: "global-test-key",
    region: "global",
    taskId: globalRunningPreview.taskId
  }]);
  assert.equal(runningStatus.status, "RUNNING");
  assert.equal(runningStatus.outputUrl, "");
  assert.equal(runningStatus.stillRunning, true);

  globalTaskSnapshot = globalFinishedOutputs;
  const finishedStatus = await fetchRunningHubTaskStatus([{
    apiKey: "global-test-key",
    region: "global",
    taskId: globalFinishedOutputs.taskId
  }]);
  assert.equal(finishedStatus.status, "SUCCESS");
  assert.equal(finishedStatus.outputUrl, "https://rh-hk-images.example.com/final?id=1");
  assert.equal(finishedStatus.stillRunning, false);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("RunningHub charge tests passed.");
