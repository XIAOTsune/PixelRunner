const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getLogText,
  setLogText,
  isNearLogBottom,
  buildLogLine,
  renderLogLine,
  clearLogView
} = require("../../../src/controllers/workspace/log-view");

function createLogEl({ text = "", scrollHeight = 0, clientHeight = 0, scrollTop = 0, isTextarea = false } = {}) {
  const el = {
    scrollHeight,
    clientHeight,
    scrollTop,
    textContent: text
  };
  if (isTextarea) {
    delete el.textContent;
    el.value = text;
  }
  return el;
}

test("get/set/clear log text works for div and textarea", () => {
  const div = createLogEl({ text: "a" });
  const ta = createLogEl({ text: "b", isTextarea: true });

  assert.equal(getLogText(div), "a");
  assert.equal(getLogText(ta), "b");

  setLogText(div, "x");
  setLogText(ta, "y");
  assert.equal(getLogText(div), "x");
  assert.equal(getLogText(ta), "y");

  clearLogView(div);
  clearLogView(ta);
  assert.equal(getLogText(div), "");
  assert.equal(getLogText(ta), "");
});

test("isNearLogBottom checks threshold", () => {
  const el = createLogEl({ scrollHeight: 120, clientHeight: 100, scrollTop: 0 });
  // distance = 20
  assert.equal(isNearLogBottom(el, 10), false);
  assert.equal(isNearLogBottom(el, 20), true);
});

test("buildLogLine formats message with time and level", () => {
  const fixed = new Date("2024-01-01T00:00:00Z");
  const line = buildLogLine({ message: "hi", type: "warn", now: fixed });
  assert.match(line, /\[WARN\]/);
  assert.match(line, /hi/);
});

test("renderLogLine appends and keeps stick-to-bottom", () => {
  const el = createLogEl({ text: "line1", scrollHeight: 100, clientHeight: 80, scrollTop: 30 });
  renderLogLine(el, "line2");
  assert.equal(getLogText(el), "line1\nline2");
  assert.equal(el.scrollTop, el.scrollHeight);
});

test("renderLogLine respects not sticking when far from bottom", () => {
  const el = createLogEl({ text: "line1", scrollHeight: 200, clientHeight: 80, scrollTop: 0 });
  renderLogLine(el, "line2");
  assert.equal(getLogText(el), "line1\nline2");
  assert.equal(el.scrollTop, 0);
});

