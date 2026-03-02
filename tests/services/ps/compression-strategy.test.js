const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeQualitySteps,
  buildCompressionEdgeSteps,
  runCompressionAttempts
} = require("../../../src/services/ps/compression-strategy");

test("normalizeQualitySteps keeps unique 1-12 values and fallback defaults", () => {
  assert.deepEqual(normalizeQualitySteps([10, 10, 8, 0, 20, "6"]), [10, 8, 6]);
  assert.deepEqual(normalizeQualitySteps([]), [10, 8, 7, 6, 5, 4]);
});

test("buildCompressionEdgeSteps prepends original edge and filters invalid entries", () => {
  assert.deepEqual(buildCompressionEdgeSteps(5000, [6144, 5000, 4096, 4096, 2048, -1]), [5000, 4096, 2048]);
  assert.deepEqual(buildCompressionEdgeSteps(0, [2048]), []);
});

test("runCompressionAttempts returns satisfied result once bytes reach target", async () => {
  const calls = [];
  const summary = await runCompressionAttempts({
    initialBytes: 12_000_000,
    targetBytes: 9_000_000,
    qualitySteps: [10, 8, 6],
    edgeSteps: [4096],
    maxAttempts: 10,
    maxDurationMs: 5_000,
    attemptExport: async ({ quality, maxEdge, attempt }) => {
      calls.push({ quality, maxEdge, attempt });
      return {
        bytes: quality === 8 ? 8_500_000 : 11_000_000,
        arrayBuffer: new Uint8Array([1, 2, 3]).buffer
      };
    }
  });

  assert.equal(summary.outcome, "satisfied");
  assert.equal(summary.attempts, 2);
  assert.equal(summary.result.quality, 8);
  assert.equal(summary.result.maxEdge, 4096);
  assert.equal(summary.result.bytes, 8_500_000);
  assert.equal(calls.length, 2);
});

test("runCompressionAttempts stops when max attempts is reached", async () => {
  const summary = await runCompressionAttempts({
    initialBytes: 12_000_000,
    targetBytes: 9_000_000,
    qualitySteps: [10, 9, 8],
    edgeSteps: [4096, 3072],
    maxAttempts: 2,
    maxDurationMs: 5_000,
    attemptExport: async () => ({
      bytes: 11_000_000,
      arrayBuffer: new Uint8Array([1]).buffer
    })
  });

  assert.equal(summary.outcome, "max-attempts");
  assert.equal(summary.attempts, 2);
  assert.equal(summary.trace.length, 2);
});

test("runCompressionAttempts stops when total duration exceeds maxDurationMs", async () => {
  let fakeNow = 0;
  const summary = await runCompressionAttempts({
    initialBytes: 12_000_000,
    targetBytes: 9_000_000,
    qualitySteps: [10, 8],
    edgeSteps: [4096],
    maxAttempts: 10,
    maxDurationMs: 100,
    now: () => fakeNow,
    attemptExport: async () => {
      fakeNow += 120;
      return {
        bytes: 11_500_000,
        arrayBuffer: new Uint8Array([1]).buffer
      };
    }
  });

  assert.equal(summary.outcome, "timeout");
  assert.equal(summary.attempts, 1);
  assert.equal(summary.trace.length, 1);
});
