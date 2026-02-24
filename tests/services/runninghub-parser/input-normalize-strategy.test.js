const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeInput,
  isGhostSchemaInput,
  mergeInputsWithFallback
} = require("../../../src/services/runninghub-parser/input-normalize-strategy");

test("normalizeInput turns indexed switch data into structured select options", () => {
  const input = normalizeInput({
    nodeId: "12",
    fieldName: "sampler",
    type: "text",
    fieldData: [
      { index: 0, description: "Euler" },
      { index: 1, description: "DPM++ 2M" }
    ]
  });

  assert.equal(input.key, "12:sampler");
  assert.equal(input.required, true);
  assert.deepEqual(input.options, [
    { value: "0", label: "Euler" },
    { value: "1", label: "DPM++ 2M" }
  ]);
});

test("normalizeInput upgrades numeric text defaults to number fields", () => {
  const input = normalizeInput({
    key: "steps",
    type: "text",
    default: "30",
    label: "Steps"
  });

  assert.equal(input.type, "number");
  assert.equal(input.default, 30);
});

test("normalizeInput forces prompt-like fields to text and drops select options", () => {
  const input = normalizeInput({
    key: "prompt",
    type: "select",
    options: ["styleA", "styleB"],
    default: "styleA"
  });

  assert.equal(input.type, "text");
  assert.equal(input.options, undefined);
});

test("isGhostSchemaInput detects prompt schema descriptors without node binding", () => {
  const ghost = isGhostSchemaInput(
    { type: "schema" },
    { key: "prompt", label: "Prompt", default: "string", options: ["string"] }
  );
  assert.equal(ghost, true);

  const bound = isGhostSchemaInput(
    { type: "schema" },
    { key: "prompt", label: "Prompt", default: "string", options: ["string"], nodeId: "n1", fieldName: "prompt" }
  );
  assert.equal(bound, false);
});

test("mergeInputsWithFallback fills select options and upgrades weak labels", () => {
  const primaryInputs = [
    {
      key: "sampler",
      type: "select",
      options: ["true", "false"],
      label: "value",
      labelSource: "fallback",
      labelConfidence: 0.2
    },
    {
      key: "steps",
      type: "number",
      label: "Steps"
    }
  ];
  const fallbackInputs = [
    {
      key: "sampler",
      type: "select",
      options: ["Euler", "DPM++ 2M"],
      label: "Sampler",
      labelSource: "raw",
      labelConfidence: 1
    },
    {
      key: "cfg",
      type: "number",
      label: "CFG"
    }
  ];

  const merged = mergeInputsWithFallback(primaryInputs, fallbackInputs);
  const sampler = merged.find((item) => item.key === "sampler");
  const cfg = merged.find((item) => item.key === "cfg");

  assert.deepEqual(sampler.options, ["Euler", "DPM++ 2M"]);
  assert.equal(sampler.label, "Sampler");
  assert.equal(sampler.labelSource, "raw");
  assert.ok(cfg);
});
