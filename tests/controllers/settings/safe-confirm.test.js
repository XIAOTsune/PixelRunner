const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_UNSUPPORTED_CONFIRM_MESSAGE,
  safeConfirm
} = require("../../../src/controllers/settings/safe-confirm");

test("safeConfirm returns confirm result when confirm is available", () => {
  const alerts = [];
  const logs = [];
  const result = safeConfirm("Delete?", {
    confirmImpl: () => true,
    alertImpl: (message) => alerts.push(message),
    log: (line) => logs.push(line)
  });
  assert.equal(result, true);
  assert.deepEqual(alerts, []);
  assert.deepEqual(logs, []);
});

test("safeConfirm blocks and alerts when confirm is unavailable", () => {
  const alerts = [];
  const logs = [];
  const result = safeConfirm("Delete?", {
    confirmImpl: null,
    alertImpl: (message) => alerts.push(message),
    log: (line) => logs.push(line)
  });
  assert.equal(result, false);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0], DEFAULT_UNSUPPORTED_CONFIRM_MESSAGE);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /confirm not available/);
});

test("safeConfirm blocks and alerts when confirm throws", () => {
  const alerts = [];
  const logs = [];
  const result = safeConfirm("Delete?", {
    confirmImpl: () => {
      throw new Error("confirm unavailable");
    },
    alertImpl: (message) => alerts.push(message),
    unsupportedMessage: "confirm not supported",
    log: (line) => logs.push(line)
  });
  assert.equal(result, false);
  assert.deepEqual(alerts, ["confirm not supported"]);
  assert.equal(logs.length > 0, true);
  assert.match(logs[0], /confirm not available/);
});
