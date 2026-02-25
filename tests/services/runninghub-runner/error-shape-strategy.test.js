const test = require("node:test");
const assert = require("node:assert/strict");
const {
  attachErrorMeta,
  createRunnerError,
  createAiAppTaskCreationError,
  createLegacyTaskCreationError,
  createTaskSubmissionFailedError
} = require("../../../src/services/runninghub-runner/error-shape-strategy");

test("attachErrorMeta mutates error with defined fields only", () => {
  const err = new Error("x");
  const result = attachErrorMeta(err, { code: "E1", a: 1, b: undefined });
  assert.equal(result, err);
  assert.equal(err.code, "E1");
  assert.equal(err.a, 1);
  assert.equal("b" in err, false);
});

test("createRunnerError creates error with metadata", () => {
  const err = createRunnerError("failed", { code: "RUNNER_FAILED", retryable: false });
  assert.equal(err.message, "failed");
  assert.equal(err.code, "RUNNER_FAILED");
  assert.equal(err.retryable, false);
});

test("createAiAppTaskCreationError keeps reason list", () => {
  const err = createAiAppTaskCreationError(["A", "", "B"]);
  assert.equal(err.message, "AI app task creation failed");
  assert.equal(err.code, "AI_APP_TASK_CREATE_FAILED");
  assert.equal(err.channel, "ai_app");
  assert.equal(err.retryable, true);
  assert.deepEqual(err.reasons, ["A", "B"]);
});

test("createLegacyTaskCreationError keeps status and api result", () => {
  const payload = { message: "bad" };
  const err = createLegacyTaskCreationError("legacy failed", {
    responseStatus: 502,
    apiResult: payload
  });
  assert.equal(err.message, "legacy failed");
  assert.equal(err.code, "LEGACY_TASK_CREATE_FAILED");
  assert.equal(err.channel, "legacy");
  assert.equal(err.responseStatus, 502);
  assert.equal(err.apiResult, payload);
});

test("createTaskSubmissionFailedError includes cause", () => {
  const cause = new Error("network");
  const err = createTaskSubmissionFailedError("submit failed", { cause });
  assert.equal(err.message, "submit failed");
  assert.equal(err.code, "TASK_SUBMISSION_FAILED");
  assert.equal(err.cause, cause);
});
