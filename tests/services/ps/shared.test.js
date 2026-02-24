const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createAbortError,
  isAbortError,
  isTimeoutError,
  withTimeout,
  toPixelNumber,
  getDocSizePx,
  normalizePasteStrategy,
  clampNumber,
  lerpNumber,
  wrapAngleDegrees
} = require("../../../src/services/ps/shared");

test("createAbortError creates AbortError with default message", () => {
  const error = createAbortError();
  assert.equal(error.name, "AbortError");
  assert.equal(error.message, "User aborted");
});

test("isAbortError matches AbortError, RUN_CANCELLED and abort-like messages", () => {
  assert.equal(isAbortError(createAbortError("stop")), true);
  assert.equal(isAbortError({ code: "RUN_CANCELLED" }), true);
  assert.equal(isAbortError(new Error("request cancelled by user")), true);
  assert.equal(isAbortError(new Error("operation aborted")), true);
  assert.equal(isAbortError(new Error("中止执行")), true);
  assert.equal(isAbortError(new Error("network timeout")), false);
  assert.equal(isAbortError(null), false);
});

test("isTimeoutError only matches TimeoutError", () => {
  const timeoutErr = new Error("late");
  timeoutErr.name = "TimeoutError";
  assert.equal(isTimeoutError(timeoutErr), true);
  assert.equal(isTimeoutError(new Error("late")), false);
});

test("withTimeout resolves value before timeout", async () => {
  const result = await withTimeout(Promise.resolve("ok"), 20, "demo");
  assert.equal(result, "ok");
});

test("withTimeout rejects on timeout", async () => {
  await assert.rejects(
    () => withTimeout(new Promise((resolve) => setTimeout(() => resolve("late"), 30)), 5, "demo"),
    (error) => {
      assert.equal(error.name, "TimeoutError");
      assert.match(String(error.message || ""), /demo timeout/);
      return true;
    }
  );
});

test("toPixelNumber parses number, string and value wrappers", () => {
  assert.equal(toPixelNumber(10), 10);
  assert.equal(toPixelNumber("12.5"), 12.5);
  assert.equal(toPixelNumber({ _value: 8 }), 8);
  assert.equal(toPixelNumber({ value: 6 }), 6);
  assert.equal(toPixelNumber("bad", 3), 3);
  assert.equal(toPixelNumber(undefined, 7), 7);
});

test("getDocSizePx rounds and clamps minimum size to 1", () => {
  assert.deepEqual(getDocSizePx({ width: 100.4, height: 80.6 }), { width: 100, height: 81 });
  assert.deepEqual(getDocSizePx({ width: 0, height: -4 }), { width: 1, height: 1 });
});

test("normalizePasteStrategy maps legacy markers and keeps supported values", () => {
  assert.equal(normalizePasteStrategy(""), "normal");
  assert.equal(normalizePasteStrategy("stretch"), "normal");
  assert.equal(normalizePasteStrategy("edgeAuto"), "smart");
  assert.equal(normalizePasteStrategy("smartEnhanced"), "smartEnhanced");
  assert.equal(normalizePasteStrategy("unknown"), "normal");
});

test("clampNumber, lerpNumber and wrapAngleDegrees keep numeric bounds", () => {
  assert.equal(clampNumber(3, 1, 2), 2);
  assert.equal(clampNumber(-1, 0, 10), 0);
  assert.equal(clampNumber(Number.NaN, 5, 10), 5);

  assert.equal(lerpNumber(0, 10, 0.5), 5);
  assert.equal(lerpNumber(0, 10, 3), 10);
  assert.equal(lerpNumber(0, 10, -1), 0);

  assert.equal(wrapAngleDegrees(190), -170);
  assert.equal(wrapAngleDegrees(-181), 179);
  assert.equal(wrapAngleDegrees(360), 0);
  assert.equal(wrapAngleDegrees(Number.NaN), 0);
});
