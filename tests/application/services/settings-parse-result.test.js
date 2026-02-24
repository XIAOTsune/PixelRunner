const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeParseResultInputs,
  buildParseSuccessViewModel,
  buildParseFailureViewModel
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
  assert.deepEqual(buildParseFailureViewModel("网络错误"), {
    message: "解析失败: 网络错误"
  });
  assert.deepEqual(buildParseFailureViewModel(""), {
    message: "解析失败: 未知错误"
  });
});
