const test = require("node:test");
const assert = require("node:assert/strict");
const { parseJsonFromEscapedText } = require("../../../src/services/runninghub-parser/json-utils");
const {
  isWeakLabel,
  resolveDisplayLabel,
  resolveFieldDataLabel
} = require("../../../src/services/runninghub-parser/label-strategy");

test("isWeakLabel identifies weak generic labels", () => {
  assert.equal(isWeakLabel("value"), true);
  assert.equal(isWeakLabel("Number"), true);
  assert.equal(isWeakLabel("Prompt"), false);
});

test("resolveDisplayLabel prefers non-weak raw label", () => {
  const result = resolveDisplayLabel({
    key: "node1:prompt",
    fieldName: "prompt",
    rawLabel: "Prompt Text",
    rawName: "Prompt",
    labelMap: { prompt: "提示词" }
  });
  assert.deepEqual(result, { label: "Prompt Text", source: "raw", confidence: 1 });
});

test("resolveDisplayLabel falls back to mapped label for weak labels", () => {
  const result = resolveDisplayLabel({
    key: "node1:prompt",
    fieldName: "prompt",
    rawLabel: "text",
    rawName: "value",
    labelMap: { prompt: "提示词" }
  });
  assert.deepEqual(result, { label: "提示词", source: "map", confidence: 0.6 });
});

test("resolveFieldDataLabel parses escaped json and ignores option container payload", () => {
  const parsedLabel = resolveFieldDataLabel("{\\\"label\\\":\\\"My Label\\\"}", parseJsonFromEscapedText);
  assert.equal(parsedLabel, "My Label");

  const optionLike = resolveFieldDataLabel(
    { options: ["a", "b"], label: "Should not use this label" },
    parseJsonFromEscapedText
  );
  assert.equal(optionLike, "");
});
