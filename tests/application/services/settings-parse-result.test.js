const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeParseResultInputs,
  normalizeParseFailure,
  buildParseSuccessViewModel,
  buildParseFailureViewModel,
  buildParseFailureDiagnostics
} = require("../../../src/application/services/settings-parse-result");

test("normalizeParseResultInputs maps labels and keys with defaults", () => {
  const result = normalizeParseResultInputs([
    { label: "Prompt", key: "prompt" },
    { name: "Image", key: "" },
    {}
  ]);
  assert.deepEqual(result, [
    { label: "Prompt", key: "prompt" },
    { label: "Image", key: "-" },
    { label: "未命名参数", key: "-" }
  ]);
});

test("buildParseSuccessViewModel builds title and action label", () => {
  const vm = buildParseSuccessViewModel({
    name: "My App",
    inputs: [{ label: "P", key: "prompt" }]
  });
  assert.equal(vm.title, "解析成功: My App");
  assert.equal(vm.actionLabel, "保存到工作台");
  assert.deepEqual(vm.items, [{ label: "P", key: "prompt" }]);
});

test("buildParseFailureViewModel includes fallback message", () => {
  const vm1 = buildParseFailureViewModel("network error");
  assert.match(vm1.message, /network error/);
  assert.equal(vm1.code, "");
  assert.equal(vm1.retryable, null);
  assert.deepEqual(vm1.reasons, []);

  const vm2 = buildParseFailureViewModel("");
  assert.match(vm2.message, /unknown error/);
});

test("normalizeParseFailure extracts structured parse error fields", () => {
  const parsed = normalizeParseFailure({
    message: "parse failed",
    code: "PARSE_APP_FAILED",
    appId: "app-1",
    endpoint: "apiCallDemo",
    retryable: true,
    reasons: ["r1", "r2"]
  });

  assert.deepEqual(parsed, {
    message: "parse failed",
    code: "PARSE_APP_FAILED",
    appId: "app-1",
    endpoint: "apiCallDemo",
    retryable: true,
    reasons: ["r1", "r2"]
  });
});

test("buildParseFailureDiagnostics keeps structured fields for diagnostics", () => {
  const lines = buildParseFailureDiagnostics({
    message: "parse failed",
    code: "PARSE_APP_FAILED",
    appId: "app-err",
    endpoint: "/api/v2",
    retryable: false,
    reasons: ["HTTP 500", "schema mismatch"]
  });

  assert.deepEqual(lines, [
    "Parse failed: parse failed",
    "code=PARSE_APP_FAILED",
    "appId=app-err",
    "endpoint=/api/v2",
    "retryable=false",
    "reason[1]=HTTP 500",
    "reason[2]=schema mismatch"
  ]);
});