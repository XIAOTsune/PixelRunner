const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildTemplateLengthHintViewModel,
  getClipboardPlainText
} = require("../../../src/application/services/settings-template-editor");

test("buildTemplateLengthHintViewModel builds normal hint", () => {
  const vm = buildTemplateLengthHintViewModel({
    title: "A",
    content: "hello",
    warningChars: 10,
    getTextLength: (v) => String(v || "").length,
    getTailPreview: (v) => `tail:${String(v || "").slice(-2)}`
  });

  assert.equal(vm.isLarge, false);
  assert.equal(vm.color, "");
  assert.match(vm.text, /标题 1 \/ 内容 5 字符/);
  assert.match(vm.text, /tail:lo/);
  assert.match(vm.text, /建议单条提示词控制在 4000 字符内。/);
});

test("buildTemplateLengthHintViewModel builds large hint", () => {
  const vm = buildTemplateLengthHintViewModel({
    title: "12345678901",
    content: "x",
    warningChars: 10,
    getTextLength: (v) => String(v || "").length,
    getTailPreview: () => "tail:x"
  });

  assert.equal(vm.isLarge, true);
  assert.equal(vm.color, "#ffb74d");
  assert.match(vm.text, /建议控制在 4000 字符内，避免 RunningHub 侧拒绝。/);
});

test("getClipboardPlainText reads text/plain from event clipboard", () => {
  const text = getClipboardPlainText({
    clipboardData: {
      getData(type) {
        return type === "text/plain" ? "hello" : "";
      }
    }
  });
  assert.equal(text, "hello");
});

test("getClipboardPlainText returns empty for invalid event", () => {
  assert.equal(getClipboardPlainText(null), "");
  assert.equal(getClipboardPlainText({}), "");
});
