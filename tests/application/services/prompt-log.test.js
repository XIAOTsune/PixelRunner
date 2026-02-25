const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolvePromptLogValue,
  isPromptLikeForLog,
  buildPromptLengthLogSummary
} = require("../../../src/application/services/prompt-log");

test("resolvePromptLogValue prefers key and falls back to alias when key is empty-like", () => {
  const input = { key: "node:prompt" };
  const values = {
    "node:prompt": "",
    prompt: "hello alias"
  };

  const result = resolvePromptLogValue(input, values, (value) => String(value || "").trim() === "");
  assert.deepEqual(result, {
    key: "node:prompt",
    value: "hello alias"
  });
});

test("isPromptLikeForLog ignores image and detects prompt hints", () => {
  const deps = {
    inputSchema: {
      resolveInputType: (input) => String((input && input.type) || "text")
    },
    isPromptLikeInput: () => false
  };

  assert.equal(isPromptLikeForLog({ key: "image", type: "image" }, deps), false);
  assert.equal(isPromptLikeForLog({ key: "main_prompt", type: "text" }, deps), true);
  assert.equal(isPromptLikeForLog({ label: "提示词", type: "text" }, deps), true);
});

test("buildPromptLengthLogSummary returns capped prompt entries and hidden count", () => {
  const appItem = {
    inputs: [
      { key: "promptA", type: "text", label: "Prompt A" },
      { key: "promptB", type: "text", label: "Prompt B" },
      { key: "seed", type: "number", label: "Seed" }
    ]
  };
  const inputValues = {
    promptA: "first line",
    promptB: "second line"
  };

  const summary = buildPromptLengthLogSummary({
    appItem,
    inputValues,
    maxItems: 1,
    inputSchema: {
      resolveInputType: (input) => String((input && input.type) || "text")
    },
    isPromptLikeInput: () => false,
    isEmptyValue: (value) => String(value || "").trim() === ""
  });

  assert.equal(summary.totalPromptInputs, 2);
  assert.equal(summary.hiddenCount, 1);
  assert.equal(summary.entries.length, 1);
  assert.equal(summary.entries[0].label, "Prompt A");
  assert.equal(summary.entries[0].key, "promptA");
});

test("buildPromptLengthLogSummary returns null when no prompt-like inputs", () => {
  const summary = buildPromptLengthLogSummary({
    appItem: {
      inputs: [{ key: "image", type: "image" }]
    },
    inputSchema: {
      resolveInputType: () => "image"
    },
    isPromptLikeInput: () => false
  });

  assert.equal(summary, null);
});
