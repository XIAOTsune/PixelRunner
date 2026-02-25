const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isAiInput,
  buildNodeInfoPayload,
  resolveRuntimeInputType,
  resolveInputValue,
  parseBooleanValue,
  coerceSelectValue,
  getTextLength,
  getTailPreview
} = require("../../../src/services/runninghub-runner/payload-strategy");

test("resolveInputValue supports alias fallback when key contains node prefix", () => {
  const input = { key: "12:prompt" };
  const inputValues = { prompt: "hello world" };

  const withAlias = resolveInputValue(input, inputValues);
  assert.equal(withAlias.key, "12:prompt");
  assert.equal(withAlias.aliasKey, "prompt");
  assert.equal(withAlias.value, "hello world");

  const noAlias = resolveInputValue(input, inputValues, { allowAlias: false });
  assert.equal(noAlias.value, undefined);
});

test("parseBooleanValue accepts common english and chinese markers", () => {
  assert.equal(parseBooleanValue("yes"), true);
  assert.equal(parseBooleanValue("\u662f"), true);
  assert.equal(parseBooleanValue("no"), false);
  assert.equal(parseBooleanValue("\u5426"), false);
  assert.equal(parseBooleanValue("unknown"), null);
});

test("coerceSelectValue maps labels and coerces boolean/numeric select values", () => {
  const boolInput = {
    options: [
      { value: "true", label: "Enable" },
      { value: "false", label: "Disable" }
    ]
  };
  assert.equal(coerceSelectValue(boolInput, "Disable"), false);

  const numericInput = {
    fieldType: "int",
    options: [
      { value: "1", label: "Low" },
      { value: "2", label: "High" }
    ]
  };
  assert.equal(coerceSelectValue(numericInput, "High"), 2);
});

test("buildNodeInfoPayload only keeps fieldData for safe runtime types", () => {
  const selectPayload = buildNodeInfoPayload(
    {
      nodeId: "n1",
      fieldName: "sampler",
      fieldType: "select",
      fieldData: { options: ["a", "b"] }
    },
    "a",
    "select"
  );
  assert.deepEqual(selectPayload, {
    nodeId: "n1",
    fieldName: "sampler",
    fieldValue: "a",
    fieldType: "select",
    fieldData: { options: ["a", "b"] }
  });

  const promptPayload = buildNodeInfoPayload(
    {
      nodeId: "n2",
      fieldName: "prompt",
      fieldType: "text",
      key: "prompt",
      fieldData: { hidden: true }
    },
    "a cat",
    "text"
  );
  assert.equal("fieldData" in promptPayload, false);
});

test("runtime type and debug helpers keep unicode-safe behavior", () => {
  assert.equal(resolveRuntimeInputType({ type: "text", options: ["A", "B"] }), "select");
  assert.equal(isAiInput({ nodeId: "7", fieldName: "prompt" }), true);
  assert.equal(isAiInput({ nodeId: "7" }), false);
  assert.equal(getTextLength("ab\u{1F600}"), 3);
  assert.equal(getTailPreview("a\nb", 20), "a\\nb");
  assert.equal(getTailPreview("", 20), "(empty)");
});
