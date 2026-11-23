import assert from "node:assert/strict";
import {
  extractTaskBalanceCharge,
  extractTaskCoinsCharge,
  extractTaskPointsCharge,
  extractOutputUrl,
  extractReadyOutputUrl,
  fetchRunningHubAccountStatus,
  fetchRunningHubTaskCharge,
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
assert.equal(formatTaskChargeDisplay(0.2, 9, "global", 1.28), "-1.28 积分", "point settlement replaces legacy money and RH coin output");
assert.equal(extractTaskPointsCharge({
  results: [
    { taskUsageList: [{ taskId: "subtask-a", usage: { settleMode: "POINT", chargedPoint: "0.50" } }] },
    { taskUsageList: [{ taskId: "subtask-a", usage: { settleMode: "POINT", chargedPoint: "0.50" } }] }
  ]
}), 0.5, "repeated result arrays do not duplicate taskUsageList charges");
assert.equal(extractTaskPointsCharge({
  taskUsageList: [
    { taskId: "subtask-a", usage: { chargedPoint: "0.50" } },
    { taskId: "subtask-a", usage: { chargedPoint: "0.60" } }
  ]
}), null, "conflicting charges for the same subtask cannot be added together");
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
assert.equal(formatTaskChargeDisplay(0.125, 8, "global"), "-$0.125 · -8RH", "legacy money and RH charges remain visible");

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
const taskSnapshots = new Map();
const legacyTaskRequests = [];
let globalTaskSnapshot = null;
let legacyTaskSnapshot = null;
let submitErrorResponse = null;
let accountSnapshot = { data: { accountStatus: { remainMoney: 2, remainCoins: 99, remainPoint: 17.5, currency: "USD" } } };
let accountTransientFailures = 0;
let accountNetworkFailures = 0;
let accountMalformedFailures = 0;
let legacyTransientFailures = 0;
let accountReads = 0;
const accountSnapshotsByRegion = new Map();
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
    const { taskId } = JSON.parse(options.body);
    const snapshot = taskSnapshots.get(taskId) ?? globalTaskSnapshot;
    return {
      ok: true,
      status: 200,
      async text() {
        return typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot);
      }
    };
  }
  if (String(url).endsWith("/task/openapi/outputs")) {
    legacyTaskRequests.push({ url, taskId: JSON.parse(options.body).taskId });
    if (legacyTransientFailures > 0) {
      legacyTransientFailures -= 1;
      return { ok: false, status: 503, async text() { return JSON.stringify({ msg: "temporarily unavailable" }); } };
    }
    return {
      ok: true,
      status: 200,
      async text() { return JSON.stringify(legacyTaskSnapshot); }
    };
  }
  if (String(url).endsWith("/uc/openapi/accountStatus")) {
    accountReads += 1;
    if (accountMalformedFailures > 0) {
      accountMalformedFailures -= 1;
      return { ok: true, status: 200, async text() { return "{ truncated"; } };
    }
    if (accountNetworkFailures > 0) {
      accountNetworkFailures -= 1;
      throw new Error("fetch failed");
    }
    if (accountTransientFailures > 0) {
      accountTransientFailures -= 1;
      return { ok: false, status: 503, async text() { return JSON.stringify({ msg: "temporarily unavailable" }); } };
    }
    return {
      ok: true,
      status: 200,
      async text() { return JSON.stringify(accountSnapshotsByRegion.get(new URL(url).hostname) ?? accountSnapshot); }
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
  const taskId = `task-${submittedRequests.length}`;
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ code: 0, data: { taskId } });
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
    (error) => error.errorCode === 416 && /余额或积分不足/.test(error.errorMessage) && error.raw === undefined
  );
  submitErrorResponse = null;

  const account = await fetchRunningHubAccountStatus([{
    apiKey: "global-test-key",
    region: "global"
  }]);
  assert.equal(account.points, 17.5);
  assert.equal(Object.hasOwn(account, "coins"), false);

  accountTransientFailures = 2;
  const recoveredAccount = await fetchRunningHubAccountStatus([{
    apiKey: "global-test-key",
    region: "global"
  }]);
  assert.equal(recoveredAccount.points, 17.5, "account query retries transient network failures");

  accountNetworkFailures = 1;
  const recoveredNetworkAccount = await fetchRunningHubAccountStatus([{
    apiKey: "global-test-key",
    region: "global"
  }]);
  assert.equal(recoveredNetworkAccount.points, 17.5, "account query retries fetch failures");

  accountMalformedFailures = 1;
  const recoveredMalformedAccount = await fetchRunningHubAccountStatus([{
    apiKey: "global-test-key",
    region: "global"
  }]);
  assert.equal(recoveredMalformedAccount.points, 17.5, "account query retries malformed transient responses");

  accountSnapshot = { code: 806, msg: "APIKEY_USER_NOT_FOUND", data: null };
  await assert.rejects(
    () => fetchRunningHubAccountStatus([{ apiKey: "global-test-key", region: "global" }]),
    (error) => error.errorCode === 806 && /账号不存在/.test(error.errorMessage)
  );
  accountSnapshot = { code: "APIKEY_USER_NOT_FOUND", msg: "APIKEY_USER_NOT_FOUND", data: null };
  await assert.rejects(
    () => fetchRunningHubAccountStatus([{ apiKey: "global-test-key", region: "global" }]),
    (error) => error.errorCode === "APIKEY_USER_NOT_FOUND"
  );

  accountSnapshot = { data: { accountStatus: { remainMoney: 2, remainCoins: 99, currency: "USD" } } };
  const accountWithoutPoints = await fetchRunningHubAccountStatus([{
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

  globalTaskSnapshot = {
    data: {
      taskId: "legacy-charge-task",
      status: "SUCCESS",
      usage: { taskCostTime: "12", consumeMoney: "0.125", consumeCoins: "8" },
      results: [{ url: "https://example.com/legacy.png", outputType: "png" }]
    }
  };
  const legacyChargeStatus = await fetchRunningHubTaskStatus([{ apiKey: "global-test-key", region: "global", taskId: "legacy-charge-task" }]);
  assert.equal(legacyChargeStatus.balanceCharge, 0.125);
  assert.equal(legacyChargeStatus.coinsCharge, 8);
  assert.equal(legacyChargeStatus.chargeDisplay, "-$0.125 · -8RH");

  globalTaskSnapshot = { data: { taskId: "missing-v2-settlement", status: "SUCCESS", results: [{ url: "https://example.com/result.png", outputType: "png" }] } };
  legacyTaskSnapshot = { code: 0, msg: "success", data: [{ fileUrl: "https://example.com/result.png", fileType: "png", settleMode: "POINT", chargedPoint: "2.5" }] };
  const v2SettlementFallback = await fetchRunningHubTaskStatus([{ apiKey: "global-test-key", region: "global", taskId: "missing-v2-settlement" }]);
  assert.equal(v2SettlementFallback.status, "SUCCESS");
  assert.equal(v2SettlementFallback.pointsCharge, 2.5, "V1 output supplies settlement missing from an otherwise successful V2 response");
  assert.equal(v2SettlementFallback.chargeDisplay, "-2.5 积分");

  taskSnapshots.set("concurrent-a", `{
    "taskId": "concurrent-a",
    "status": "SUCCESS",
    "results": [{ "url": "https://example.com/a.png" }],
    "taskUsageList": [
      { "taskId": 2077336528350871553, "usage": { "chargedPoint": "0.5" } },
      { "taskId": 2077336528350871554, "usage": { "chargedPoint": "0.5" } },
      { "taskId": 2077336528350871553, "usage": { "chargedPoint": "0.5" } }
    ]
  }`);
  taskSnapshots.set("concurrent-b", {
    taskId: "concurrent-b", status: "SUCCESS", results: [{ url: "https://example.com/b.png" }]
  });
  const priorLegacyRequests = legacyTaskRequests.length;
  const [concurrentA, concurrentB] = await Promise.all([
    pollRunningHubTask([{ apiKey: "global-test-key", region: "global", taskId: "concurrent-a" }]),
    fetchRunningHubTaskStatus([{ apiKey: "global-test-key", region: "global", taskId: "concurrent-b" }])
  ]);
  assert.equal(concurrentA.pointsCharge, 1, "distinct long subtask IDs keep their full precision");
  assert.equal(concurrentB.pointsCharge, 2.5, "the concurrent V1 fallback uses the other task's own ID");
  assert.deepEqual(legacyTaskRequests.slice(priorLegacyRequests), [
    { url: "https://www.runninghub.ai/task/openapi/outputs", taskId: "concurrent-b" }
  ]);

  legacyTaskSnapshot = { code: 805, msg: "APIKEY_TASK_STATUS_ERROR", data: null };
  const v2WithoutSettlement = await fetchRunningHubTaskStatus([{ apiKey: "global-test-key", region: "global", taskId: "missing-v2-settlement" }]);
  assert.equal(v2WithoutSettlement.status, "SUCCESS", "a compatibility billing failure never overrides a successful V2 task");
  assert.equal(v2WithoutSettlement.outputUrl, "https://example.com/result.png");
  assert.equal(v2WithoutSettlement.failed, false);
  assert.equal(v2WithoutSettlement.pointsCharge, null);

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

  globalTaskSnapshot = { data: { taskId: "retry-billing-task", status: "SUCCESS", results: [{ url: "https://example.com/retry.png" }] } };
  legacyTaskSnapshot = { code: 0, data: [{ fileUrl: "https://example.com/retry.png", settleMode: "POINT", chargedPoint: "2.75" }] };
  legacyTransientFailures = 2;
  const retriedBillingStatus = await fetchRunningHubTaskStatus([{ apiKey: "global-test-key", region: "global", taskId: "retry-billing-task" }]);
  assert.equal(retriedBillingStatus.pointsCharge, 2.75, "billing fallback retries transient failures");

  globalTaskSnapshot = { data: { taskId: "pending-billing-task", status: "SUCCESS", results: [{ url: "https://example.com/pending.png" }] } };
  legacyTaskSnapshot = null;
  legacyTransientFailures = 3;
  const pendingBillingStatus = await fetchRunningHubTaskStatus([{ apiKey: "global-test-key", region: "global", taskId: "pending-billing-task" }]);
  assert.equal(pendingBillingStatus.pointsCharge, null);
  assert.equal(pendingBillingStatus.chargePending, true, "missing settlement remains explicitly pending");

  globalTaskSnapshot = { data: { taskId: "queued-task", status: "RUNNING", errorCode: 813, message: "APIKEY_TASK_IS_QUEUED" } };
  const queuedStatus = await fetchRunningHubTaskStatus([{ apiKey: "global-test-key", region: "global", taskId: "queued-task" }]);
  assert.equal(queuedStatus.failed, false);
  assert.equal(queuedStatus.stillRunning, true);
  assert.equal(queuedStatus.status, "QUEUED");
  assert.match(queuedStatus.message, /仍在排队/);
  assert.equal(queuedStatus.errorCode, 813);

  legacyTaskSnapshot = { code: 0, data: [{ taskCostTime: "101", consumeMoney: null, consumeCoins: null }] };
  const useTask = (taskId) => [{ apiKey: basePayload.apiKey, region: basePayload.region, taskId }];
  const missingCharge = (taskId) => ({ taskId, status: "SUCCESS", results: [{ url: "https://example.com/result.png" }], usage: { taskCostTime: "101", consumeMoney: null, consumeCoins: null } });
  for (const mode of ["single", "concurrent-known", "concurrent-late", "concurrent-unknown"]) {
    accountSnapshot = { data: { remainMoney: "5", remainPoint: "20", currency: "USD", currentTaskCounts: "0" } };
    const beforeReads = accountReads;
    const [first, second] = await Promise.all(Array.from({ length: mode === "single" ? 1 : 2 }, () => submitRunningHubTask([basePayload])));
    assert.equal(accountReads - beforeReads, 1, `${mode}: concurrent submissions share one starting balance`);
    taskSnapshots.set(first.taskId, missingCharge(first.taskId));
    if (second) {
      const secondSnapshot = missingCharge(second.taskId);
      if (mode === "concurrent-known") secondSnapshot.usage.consumeMoney = "0.15";
      taskSnapshots.set(second.taskId, secondSnapshot);
    }
    accountSnapshot.data.remainMoney = mode === "single" ? "4.9" : "4.75";
    await pollRunningHubTask(useTask(first.taskId));
    if (second) {
      assert.equal((await fetchRunningHubTaskCharge(useTask(first.taskId))).chargeState, "waiting");
      await pollRunningHubTask(useTask(second.taskId));
    }
    await new Promise((resolve) => setImmediate(resolve));
    if (mode === "concurrent-late") {
      assert.equal((await fetchRunningHubTaskCharge(useTask(first.taskId))).chargeState, "unreported");
      taskSnapshots.get(second.taskId).usage.consumeMoney = "0.15";
      assert.equal((await fetchRunningHubTaskCharge(useTask(second.taskId))).chargeState, "confirmed");
    }
    const result = await fetchRunningHubTaskCharge(useTask(first.taskId));
    if (mode === "concurrent-unknown") {
      assert.equal(result.chargeState, "unreported");
      assert.equal((await fetchRunningHubTaskCharge(useTask(second.taskId))).chargeState, "unreported");
    } else {
      assert.equal(result.chargeState, "estimated");
      assert.equal(result.balanceCharge, 0.1);
      assert.equal(result.chargeDisplay, "-$0.100");
    }
  }

  const cnAccount = { data: { remainMoney: "5", remainPoint: "20", currency: "CNY", currentTaskCounts: "0" } };
  const globalAccount = { data: { remainMoney: "10", remainPoint: "50", currency: "USD", currentTaskCounts: "0" } };
  accountSnapshotsByRegion.set("www.runninghub.cn", cnAccount);
  accountSnapshotsByRegion.set("www.runninghub.ai", globalAccount);
  const cnPayload = { ...basePayload, apiKey: "cn-test-key", region: "cn" };
  const [cnTask, globalTask] = await Promise.all([
    submitRunningHubTask([cnPayload]), submitRunningHubTask([basePayload])
  ]);
  const cnQuery = [{ apiKey: cnPayload.apiKey, region: cnPayload.region, taskId: cnTask.taskId }];
  taskSnapshots.set(cnTask.taskId, missingCharge(cnTask.taskId));
  taskSnapshots.set(globalTask.taskId, missingCharge(globalTask.taskId));
  cnAccount.data.remainPoint = "18.75";
  globalAccount.data.remainMoney = "9.6";
  await Promise.all([pollRunningHubTask(cnQuery), pollRunningHubTask(useTask(globalTask.taskId))]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await fetchRunningHubTaskCharge(cnQuery)).chargeDisplay, "-1.25 积分");
  assert.equal((await fetchRunningHubTaskCharge(useTask(globalTask.taskId))).chargeDisplay, "-$0.400");
  const wrongAccount = [{ ...cnQuery[0], apiKey: "another-account" }];
  assert.equal((await fetchRunningHubTaskCharge(wrongAccount)).chargeState, "unreported");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("RunningHub charge tests passed.");
