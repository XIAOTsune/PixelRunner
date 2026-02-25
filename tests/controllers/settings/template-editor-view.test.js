const test = require("node:test");
const assert = require("node:assert/strict");
const { renderTemplateLengthHint } = require("../../../src/controllers/settings/template-editor-view");

test("renderTemplateLengthHint writes text and color", () => {
  const hintEl = {
    textContent: "",
    style: { color: "" }
  };
  renderTemplateLengthHint(hintEl, {
    text: "hint-text",
    color: "#ffb74d"
  });
  assert.equal(hintEl.textContent, "hint-text");
  assert.equal(hintEl.style.color, "#ffb74d");
});

test("renderTemplateLengthHint keeps noop for missing args", () => {
  assert.doesNotThrow(() => renderTemplateLengthHint(null, { text: "x", color: "" }));
  assert.doesNotThrow(() => renderTemplateLengthHint({ style: {} }, null));
});
