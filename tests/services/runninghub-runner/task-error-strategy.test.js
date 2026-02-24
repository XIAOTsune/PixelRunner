const test = require("node:test");
const assert = require("node:assert/strict");
const {
  fallbackToMessage,
  extractNodeValidationSummary,
  toAiAppErrorMessage,
  isParameterShapeError,
  createAiAppRejectedError,
  normalizeAiAppFailure,
  buildAiAppExceptionReason
} = require("../../../src/services/runninghub-runner/task-error-strategy");

test("fallbackToMessage prefers msg then message then fallback", () => {
  assert.equal(fallbackToMessage({ msg: "from-msg" }, "fallback"), "from-msg");
  assert.equal(fallbackToMessage({ message: "from-message" }, "fallback"), "from-message");
  assert.equal(fallbackToMessage({}, "fallback"), "fallback");
  assert.equal(fallbackToMessage(null, "fallback"), "fallback");
});

test("extractNodeValidationSummary returns compact summary lines", () => {
  const summary = extractNodeValidationSummary({
    node_errors: {
      a: {
        node_name: "PromptNode",
        errors: [{ message: "invalid prompt", details: "too short" }]
      },
      b: {
        nodeName: "SeedNode",
        errors: [{ type: "validation", details: "must be number" }]
      }
    }
  });

  assert.match(summary, /PromptNode: invalid prompt \(too short\)/);
  assert.match(summary, /SeedNode: validation \(must be number\)/);
});

test("toAiAppErrorMessage falls back to validation summary", () => {
  const message = toAiAppErrorMessage({
    data: {
      node_errors: {
        p: {
          node_name: "Prompt",
          errors: [{ message: "required" }]
        }
      }
    }
  }, "fallback");

  assert.equal(message, "Prompt: required");
});

test("isParameterShapeError matches known backend compatibility errors", () => {
  assert.equal(isParameterShapeError("webappId cannot be null"), true);
  assert.equal(isParameterShapeError("param api key is required"), true);
  assert.equal(isParameterShapeError("random server error"), false);
});

test("normalizeAiAppFailure marks primary variant as terminal unless shape error", () => {
  const terminal = normalizeAiAppFailure({
    body: { apiKey: "k", webappId: "1", nodeInfoList: [] },
    result: { message: "workflow disabled" },
    responseStatus: 400,
    toMessage: fallbackToMessage
  });
  assert.equal(terminal.terminal, true);
  assert.match(terminal.reason, /workflow disabled/);

  const retryable = normalizeAiAppFailure({
    body: { apiKey: "k", webappId: "1", nodeInfoList: [] },
    result: { message: "webappId cannot be null" },
    responseStatus: 400,
    toMessage: fallbackToMessage
  });
  assert.equal(retryable.terminal, false);
});

test("createAiAppRejectedError keeps code and apiResult for upper layer handling", () => {
  const apiResult = { message: "rejected" };
  const error = createAiAppRejectedError("rejected", apiResult);
  assert.equal(error.message, "rejected");
  assert.equal(error.code, "AI_APP_REJECTED");
  assert.equal(error.apiResult, apiResult);
});

test("buildAiAppExceptionReason formats unknown errors safely", () => {
  assert.equal(buildAiAppExceptionReason(new Error("timeout")), "ai-app/run: timeout");
  assert.equal(buildAiAppExceptionReason("broken"), "ai-app/run: broken");
});
