const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createLocalValidationError,
  collectMissingRequiredImageInputs,
  coerceNonImageInputValue
} = require("../../../src/services/runninghub-runner/input-validation-strategy");
const {
  resolveRuntimeInputType,
  resolveInputValue,
  parseBooleanValue
} = require("../../../src/services/runninghub-runner/payload-strategy");

test("createLocalValidationError marks error as local validation", () => {
  const error = createLocalValidationError("bad input", "BAD_INPUT");
  assert.equal(error.message, "bad input");
  assert.equal(error.code, "BAD_INPUT");
  assert.equal(error.localValidation, true);
});

test("collectMissingRequiredImageInputs only checks strict required image inputs", () => {
  const inputs = [
    { key: "1:image", type: "image", required: true, requiredExplicit: true, label: "Main Image" },
    { key: "2:image", type: "image", required: true, requiredExplicit: false, label: "Relaxed Image" },
    { key: "prompt", type: "text", required: true, requiredExplicit: true, label: "Prompt" }
  ];
  const inputValues = {
    image: "alias-only-value"
  };

  const missing = collectMissingRequiredImageInputs(inputs, inputValues, {
    resolveRuntimeInputType,
    resolveInputValue
  });
  assert.deepEqual(missing, ["Main Image"]);
});

test("coerceNonImageInputValue validates required/number/boolean and converts values", () => {
  assert.throws(
    () =>
      coerceNonImageInputValue({
        input: { label: "Prompt", required: true },
        type: "text",
        value: "",
        key: "prompt"
      }),
    (error) => error && error.code === "MISSING_REQUIRED_PARAMETER"
  );

  assert.throws(
    () =>
      coerceNonImageInputValue({
        input: { label: "Steps" },
        type: "number",
        value: "abc",
        key: "steps"
      }),
    (error) => error && error.code === "INVALID_NUMBER_PARAMETER"
  );

  assert.throws(
    () =>
      coerceNonImageInputValue({
        input: { label: "Switch" },
        type: "boolean",
        value: "maybe",
        key: "switch",
        parseBooleanValue
      }),
    (error) => error && error.code === "INVALID_BOOLEAN_PARAMETER"
  );

  const selectValue = coerceNonImageInputValue({
    input: { label: "Mode" },
    type: "select",
    value: "High",
    key: "mode",
    coerceSelectValue: (_input, raw) => raw.toLowerCase()
  });
  assert.equal(selectValue, "high");

  const numberValue = coerceNonImageInputValue({
    input: { label: "Scale" },
    type: "number",
    value: "12",
    key: "scale"
  });
  assert.equal(numberValue, 12);

  const boolValue = coerceNonImageInputValue({
    input: { label: "Enabled" },
    type: "boolean",
    value: "yes",
    key: "enabled",
    parseBooleanValue
  });
  assert.equal(boolValue, true);

  const optionalBoolEmpty = coerceNonImageInputValue({
    input: { label: "Optional Enabled", required: false },
    type: "boolean",
    value: undefined,
    key: "optionalEnabled",
    parseBooleanValue
  });
  assert.equal(optionalBoolEmpty, undefined);
});
