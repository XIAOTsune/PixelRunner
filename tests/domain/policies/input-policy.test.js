const test = require("node:test");
const assert = require("node:assert/strict");
const { createInputPolicy } = require("../../../src/domain/policies/input-policy");

test("input policy resolves type/options/entries via inputSchema helpers", () => {
  const inputPolicy = createInputPolicy({
    inputSchema: {
      resolveInputType: (input) => (input && input.kind) || "text",
      getInputOptions: () => ["a", "b"],
      getInputOptionEntries: () => [{ value: "x", label: "X" }]
    }
  });

  assert.equal(inputPolicy.resolveUiInputType({ kind: "image" }), "image");
  assert.deepEqual(inputPolicy.getInputOptions({}), ["a", "b"]);
  assert.deepEqual(inputPolicy.getInputOptionEntries({}), [{ value: "x", label: "X" }]);
});

test("input policy can infer prompt-like fields", () => {
  const inputPolicy = createInputPolicy({
    inputSchema: {
      resolveInputType: () => "text",
      getInputOptions: () => []
    },
    isPromptLikeInput: () => false
  });

  assert.equal(inputPolicy.isPromptLikeField({ key: "prompt_text", type: "string" }), true);
  assert.equal(inputPolicy.isPromptLikeField({ label: "提示词", type: "text" }), true);
  assert.equal(inputPolicy.isPromptLikeField({ key: "seed", type: "number" }), false);
});

test("input policy detects long text and splits image/other inputs", () => {
  const inputPolicy = createInputPolicy({
    inputSchema: {
      resolveInputType: (input) => input.type,
      getInputOptions: (input) => (Array.isArray(input.options) ? input.options : [])
    }
  });

  assert.equal(inputPolicy.isLongTextInput({ type: "text", options: [] }), true);
  assert.equal(inputPolicy.isLongTextInput({ type: "text", options: ["a"] }), false);

  const split = inputPolicy.splitImageAndOtherInputs([
    { id: 1, type: "image" },
    { id: 2, type: "text" },
    { id: 3, type: "number" },
    { id: 4, type: "image" }
  ]);

  assert.deepEqual(
    split.imageInputs.map((item) => item.id),
    [1, 4]
  );
  assert.deepEqual(
    split.otherInputs.map((item) => item.id),
    [2, 3]
  );
});
