const test = require("node:test");
const assert = require("node:assert/strict");
const { createParseAppFailedError } = require("../../../src/services/runninghub-parser/parse-error-strategy");

test("createParseAppFailedError creates structured parse error", () => {
  const err = createParseAppFailedError("parse failed", {
    appId: "123",
    endpoint: "/api/parse",
    reasons: ["A", "", "B"]
  });

  assert.equal(err.message, "parse failed");
  assert.equal(err.code, "PARSE_APP_FAILED");
  assert.equal(err.appId, "123");
  assert.equal(err.endpoint, "/api/parse");
  assert.equal(err.retryable, true);
  assert.deepEqual(err.reasons, ["A", "B"]);
});
