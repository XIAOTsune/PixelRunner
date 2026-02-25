const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeUploadMaxEdge,
  getUploadMaxEdgeLabel,
  buildUploadMaxEdgeCandidates,
  shouldRetryWithNextUploadEdge
} = require("../../../src/services/runninghub-runner/upload-edge-strategy");

test("normalizeUploadMaxEdge only keeps supported values", () => {
  assert.equal(normalizeUploadMaxEdge(1024), 1024);
  assert.equal(normalizeUploadMaxEdge("2048"), 2048);
  assert.equal(normalizeUploadMaxEdge(123), 0);
  assert.equal(normalizeUploadMaxEdge("bad"), 0);
});

test("getUploadMaxEdgeLabel maps zero to unlimited and others to px", () => {
  assert.equal(getUploadMaxEdgeLabel(0), "unlimited");
  assert.equal(getUploadMaxEdgeLabel("4096"), "4096px");
});

test("buildUploadMaxEdgeCandidates builds retry chain from current cap", () => {
  assert.deepEqual(buildUploadMaxEdgeCandidates(1024), [1024, 2048, 4096, 0]);
  assert.deepEqual(buildUploadMaxEdgeCandidates(4096), [4096, 0]);
  assert.deepEqual(buildUploadMaxEdgeCandidates(0), [0]);
  assert.deepEqual(buildUploadMaxEdgeCandidates(9999), [0]);
});

test("shouldRetryWithNextUploadEdge skips retries for local validation errors", () => {
  assert.equal(shouldRetryWithNextUploadEdge({ code: "RUN_CANCELLED" }), false);
  assert.equal(shouldRetryWithNextUploadEdge({ localValidation: true }), false);
  assert.equal(shouldRetryWithNextUploadEdge(new Error("Missing required parameter: prompt")), false);
  assert.equal(shouldRetryWithNextUploadEdge(new Error("network timeout")), true);
});
