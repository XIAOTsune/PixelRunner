const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseTaskId,
  buildAiAppRunBodyCandidates,
  buildLegacyCreateTaskBody,
  getTaskCreationOutcome,
  getBodyVariantMarker
} = require("../../../src/services/runninghub-runner/task-request-strategy");

test("parseTaskId supports nested and legacy result shapes", () => {
  assert.equal(parseTaskId({ data: { taskId: "task-a" } }), "task-a");
  assert.equal(parseTaskId({ taskId: "task-b" }), "task-b");
  assert.equal(parseTaskId({ id: "task-c" }), "task-c");
  assert.equal(parseTaskId(null), "");
});

test("buildAiAppRunBodyCandidates normalizes appId and includes compatibility variants", () => {
  const candidates = buildAiAppRunBodyCandidates(
    "api-key",
    "https://www.runninghub.cn/workflow/123456?foo=1",
    [{ nodeId: "1", fieldName: "prompt", fieldValue: "cat" }]
  );

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].webappId, "123456");
  assert.equal(candidates[1].webAppId, "123456");
  assert.equal(candidates[2].appId, "123456");
});

test("buildLegacyCreateTaskBody uses normalized workflowId", () => {
  const body = buildLegacyCreateTaskBody(
    "api-key",
    "https://www.runninghub.cn/workflow/999999",
    { prompt: "hello" }
  );

  assert.deepEqual(body, {
    apiKey: "api-key",
    workflowId: "999999",
    nodeParams: { prompt: "hello" }
  });
});

test("getTaskCreationOutcome returns success and taskId only when response and payload are valid", () => {
  const success = getTaskCreationOutcome(
    { ok: true },
    { code: 0, data: { taskId: "task-ok" } }
  );
  assert.deepEqual(success, { success: true, taskId: "task-ok" });

  const missingTaskId = getTaskCreationOutcome(
    { ok: true },
    { code: 0, data: {} }
  );
  assert.deepEqual(missingTaskId, { success: false, taskId: "" });

  const nonOkResponse = getTaskCreationOutcome(
    { ok: false },
    { code: 0, data: { taskId: "task-fail" } }
  );
  assert.deepEqual(nonOkResponse, { success: false, taskId: "task-fail" });
});

test("getBodyVariantMarker joins top-level keys for diagnostics", () => {
  assert.equal(
    getBodyVariantMarker({ apiKey: "x", webappId: "1", nodeInfoList: [] }),
    "apiKey,webappId,nodeInfoList"
  );
  assert.equal(getBodyVariantMarker(null), "");
});
