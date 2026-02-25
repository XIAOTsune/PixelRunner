const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildTextPayloadDebugEntry,
  emitTextPayloadDebugLog
} = require("../../../src/services/runninghub-runner/text-payload-log-strategy");

test("buildTextPayloadDebugEntry generates length and tail from helpers", () => {
  const entry = buildTextPayloadDebugEntry({
    key: "prompt",
    label: "Prompt",
    type: "text",
    value: "abc",
    getTextLength: (text) => text.length + 1,
    getTailPreview: (text, max) => `${text}:${max}`
  });

  assert.deepEqual(entry, {
    key: "prompt",
    label: "Prompt",
    type: "text",
    length: 4,
    tail: "abc:20"
  });
});

test("emitTextPayloadDebugLog logs header, preview lines and hidden count", () => {
  const lines = [];
  const entries = [
    { key: "a", label: "A", type: "text", length: 1, tail: "x" },
    { key: "b", label: "B", type: "text", length: 2, tail: "y" },
    { key: "c", label: "C", type: "number", length: 3, tail: "z" }
  ];

  emitTextPayloadDebugLog((line, level) => lines.push({ line, level }), entries, { previewLimit: 2 });

  assert.equal(lines.length, 4);
  assert.match(lines[0].line, /Pre-submit text parameter check: 3 item\(s\)/);
  assert.match(lines[1].line, /Parameter A \(a, text\): length 1, tail x/);
  assert.match(lines[2].line, /Parameter B \(b, text\): length 2, tail y/);
  assert.match(lines[3].line, /Other 1 text parameter\(s\) not shown/);
});

test("emitTextPayloadDebugLog is no-op for empty entries", () => {
  const lines = [];
  emitTextPayloadDebugLog((line) => lines.push(line), []);
  assert.equal(lines.length, 0);
});
