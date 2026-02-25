const test = require("node:test");
const assert = require("node:assert/strict");
const {
  setEnvDoctorOutput,
  appendEnvDoctorOutput
} = require("../../../src/controllers/settings/env-doctor-view");

test("setEnvDoctorOutput writes text and resets scrollTop", () => {
  const outputEl = { value: "old", scrollTop: 88 };
  setEnvDoctorOutput(outputEl, "new");
  assert.equal(outputEl.value, "new");
  assert.equal(outputEl.scrollTop, 0);
});

test("appendEnvDoctorOutput appends line with timestamp and scrolls to bottom", () => {
  const now = new Date("2026-02-24T10:10:10Z");
  const ts = now.toLocaleTimeString();
  const outputEl = { value: "line1", scrollTop: 0, scrollHeight: 321 };
  appendEnvDoctorOutput(outputEl, "line2", { now });
  assert.equal(outputEl.value, `line1\n[${ts}] line2`);
  assert.equal(outputEl.scrollTop, 321);
});

test("appendEnvDoctorOutput writes first line without leading newline", () => {
  const outputEl = { value: "", scrollTop: 0, scrollHeight: 20 };
  appendEnvDoctorOutput(outputEl, "line1", { now: new Date("2026-02-24T00:00:00Z") });
  assert.match(outputEl.value, /^\[[^\]]+\] line1$/);
});
