const test = require("node:test");
const assert = require("node:assert/strict");
const policy = require("../../../src/domain/policies/text-input-policy");

test("getTextLength counts unicode code points", () => {
  assert.equal(policy.getTextLength("abc"), 3);
  assert.equal(policy.getTextLength("🙂a"), 2);
});

test("getTailPreview formats tail and flattens newlines", () => {
  assert.equal(policy.getTailPreview("", 10), "(空)");
  assert.equal(policy.getTailPreview("line1\nline2", 5), "...line2");
});

test("enforceLongTextCapacity sets maxLength and maxlength attribute", () => {
  const attrs = {};
  const input = {
    maxLength: 0,
    setAttribute: (key, value) => {
      attrs[key] = value;
    }
  };

  policy.enforceLongTextCapacity(input, 1234);
  assert.equal(input.maxLength, 1234);
  assert.equal(attrs.maxlength, "1234");
});

test("insertTextAtCursor inserts text and moves cursor", () => {
  const input = {
    value: "hello world",
    selectionStart: 6,
    selectionEnd: 11,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }
  };

  policy.insertTextAtCursor(input, "PixelRunner");
  assert.equal(input.value, "hello PixelRunner");
  assert.equal(input.selectionStart, "hello ".length + "PixelRunner".length);
  assert.equal(input.selectionEnd, "hello ".length + "PixelRunner".length);
});
