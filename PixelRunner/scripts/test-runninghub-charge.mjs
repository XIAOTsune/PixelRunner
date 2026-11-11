import assert from "node:assert/strict";
import {
  extractTaskBalanceCharge,
  extractTaskCoinsCharge,
  extractTaskPointsCharge,
  extractOutputUrl,
  extractReadyOutputUrl,
  fetchRunningHubTaskStatus,
  formatTaskChargeDisplay,
  pollRunningHubTask,
  submitRunningHubTask
} from "../src/host/runninghub.js";

function assertCharge(payload, expectedBalance, expectedCoins) {
  assert.equal(extractTaskBalanceCharge(payload), expectedBalance);
  assert.equal(extractTaskCoinsCharge(payload), expectedCoins);
}

assert.equal(extractTaskPointsCharge({
  usage: { settleMode: "POINT", chargedPoint: "1.28" },
  taskUsageList: [{ taskId: "subtask-a", usage: { settleMode: "POINT", chargedPoint: "0.50" } }],
  results: [{ usage: { settleMode: "POINT", chargedPoint: "1.28" } }]
}), 1.28, "the aggregate V2 settlement takes precedence over nested usage values");
assert.equal(formatTaskChargeDisplay(null, null, "cn", 1.28), "-1.28 积分");
assert.equal(extractTaskPointsCharge({
  results: [
    { taskUsageList: [{ taskId: "subtask-a", usage: { settleMode: "POINT", chargedPoint: "0.50" } }] },
    { taskUsageList: [{ taskId: "subtask-a", usage: { settleMode: "POINT", chargedPoint: "0.50" } }] }
  ]
}), 0.5, "repeated result arrays do not duplicate taskUsageList charges");
assert.equal(extractTaskPointsCharge({ usage: { settleMode: "COIN", chargedPoint: "8" } }), null);
assert.equal(extractTaskPointsCharge({ data: [
  { fileUrl: "https://example.com/a.png", settleMode: "POINT", chargedPoint: "1.28" },
  { fileUrl: "https://example.com/b.png", settleMode: "POINT", chargedPoint: "1.28" }
]}), 1.28, "V1 output rows expose the task settlement directly and may repeat it");
assert.equal(extractTaskPointsCharge({ data: [{ settleMode: "COIN", chargedPoint: "8" }] }), null);

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
let legacyTaskSnapshot = null;
let submitErrorResponse = null;
let accountSnapshot = { data: { accountStatus: { remainMoney: 2, remainCoins: 99, remainPoint: 17.5, currency: "USD" } } };
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
  if (String(url).endsWith("/task/openapi/outputs")) {
    return {
      ok: true,
      status: 200,
      async text() { return JSON.stringify(legacyTaskSnapshot); }
    };
  }
  if (String(url).endsWith("/uc/openapi/accountStatus")) {
    return {
      ok: true,
      status: 200,
      async text() { return JSON.stringify(accountSnapshot); }
    };
  }
  if (String(url).endsWith("/task/openapi/ai-app/run") && submitErrorResponse) {
    return {
      ok: true,
      status: 200,
      async text() { return JSON.stringify(submitErrorResponse); }
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

  submitErrorResponse = { code: 416, errorCode: 416, message: "TASK_CREATE_FAILED_BY_NOT_ENOUGH_WALLET" };
  await assert.rejects(
    () => submitRunningHubTask([basePayload]),
    (error) => error.errorCode === 416 && error.errorMessage === "TASK_CREATE_FAILED_BY_NOT_ENOUGH_WALLET" && error.raw.code === 416
  );
  submitErrorResponse = null;

  const account = await (await import("../src/host/runninghub.js")).fetchRunningHubAccountStatus([{
    apiKey: "global-test-key",
    region: "global"
  }]);
  assert.equal(account.points, 17.5);
  assert.equal(Object.hasOwn(account, "coins"), false);
  accountSnapshot = { data: { accountStatus: { remainMoney: 2, remainCoins: 99, currency: "USD" } } };
  const accountWithoutPoints = await (await import("../src/host/runninghub.js")).fetchRunningHubAccountStatus([{
    apiKey: "global-test-key",
    region: "global"
  }]);
  assert.equal(accountWithoutPoints.points, null, "remainCoins is never exposed as account points");

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

  globalTaskSnapshot = {
    data: {
      taskId: "point-task",
      status: "SUCCESS",
      usage: { settleMode: "POINT", chargedPoint: "1.28" },
      taskUsageList: [{ taskId: "subtask-a", usage: { settleMode: "POINT", chargedPoint: "0.50" } }],
      results: [{ url: "https://example.com/point.png", outputType: "png", consumeCoins: "9", consumeMoney: "0.8" }]
    }
  };
  const pointStatus = await fetchRunningHubTaskStatus([{ apiKey: "global-test-key", region: "global", taskId: "point-task" }]);
  assert.equal(pointStatus.pointsCharge, 1.28);
  assert.equal(pointStatus.chargeDisplay, "-1.28 积分");
  assert.equal(pointStatus.coinsCharge, null, "point settlement does not mix in legacy coin charges");
  assert.equal(pointStatus.balanceCharge, null, "point settlement does not mix in legacy money charges");

  globalTaskSnapshot = { taskId: "v1-point-task", status: "SUCCESS", results: null };
  legacyTaskSnapshot = {
    code: 0,
    msg: "success",
    data: [
      { fileUrl: "https://example.com/v1-a.png", fileType: "png", taskCostTime: "83", nodeId: "12", settleMode: "POINT", chargedPoint: "1.28" },
      { fileUrl: "https://example.com/v1-b.png", fileType: "png", taskCostTime: "83", nodeId: "13", settleMode: "POINT", chargedPoint: "1.28" }
    ]
  };
  const v1FallbackStatus = await fetchRunningHubTaskStatus([{ apiKey: "global-test-key", region: "global", taskId: "v1-point-task" }]);
  assert.equal(v1FallbackStatus.pointsCharge, 1.28);
  assert.equal(v1FallbackStatus.chargeDisplay, "-1.28 积分");
  const v1FallbackPoll = await pollRunningHubTask([{
    apiKey: "global-test-key",
    region: "global",
    taskId: "v1-point-task",
    settings: { timeout: 10, pollInterval: 1 }
  }]);
  assert.equal(v1FallbackPoll.pointsCharge, 1.28);
  assert.equal(v1FallbackPoll.chargeDisplay, "-1.28 积分");

  globalTaskSnapshot = { data: { taskId: "queued-task", status: "RUNNING", errorCode: 813, message: "APIKEY_TASK_IS_QUEUED" } };
  const queuedStatus = await fetchRunningHubTaskStatus([{ apiKey: "global-test-key", region: "global", taskId: "queued-task" }]);
  assert.equal(queuedStatus.failed, false);
  assert.equal(queuedStatus.stillRunning, true);
  assert.equal(queuedStatus.status, "QUEUED");
  assert.match(queuedStatus.message, /仍在排队/);
  assert.equal(queuedStatus.errorCode, 813);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("RunningHub charge tests passed.");
