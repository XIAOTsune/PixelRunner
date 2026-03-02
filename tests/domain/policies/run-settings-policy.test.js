const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePasteStrategy,
  normalizeCloudConcurrentJobs,
  normalizeUploadTargetBytes,
  normalizeUploadHardLimitBytes,
  normalizeUploadAutoCompressEnabled,
  normalizeUploadCompressFormat,
  classifyUploadRiskByBytes
} = require("../../../src/domain/policies/run-settings-policy");

test("normalizePasteStrategy maps legacy markers and falls back for invalid markers", () => {
  assert.equal(normalizePasteStrategy("smart"), "smart");
  assert.equal(normalizePasteStrategy("smartEnhanced"), "smartEnhanced");
  assert.equal(normalizePasteStrategy("edgeAuto"), "smart");
  assert.equal(normalizePasteStrategy("stretch"), "normal");
  assert.equal(normalizePasteStrategy(""), "normal");
  assert.equal(normalizePasteStrategy("unknown"), "normal");
});

test("normalizeCloudConcurrentJobs clamps value to supported 1-100 range", () => {
  assert.equal(normalizeCloudConcurrentJobs("4"), 4);
  assert.equal(normalizeCloudConcurrentJobs(1), 1);
  assert.equal(normalizeCloudConcurrentJobs(100), 100);
  assert.equal(normalizeCloudConcurrentJobs(0), 1);
  assert.equal(normalizeCloudConcurrentJobs(999), 100);
  assert.equal(normalizeCloudConcurrentJobs(undefined), 2);
});

test("upload bytes policy normalizes target/hard limits and classifies risk boundaries", () => {
  const target = normalizeUploadTargetBytes("9000000");
  const hardLimit = normalizeUploadHardLimitBytes("10000000", 10000000, target);
  assert.equal(target, 9000000);
  assert.equal(hardLimit, 10000000);

  assert.equal(classifyUploadRiskByBytes(9000000, target, hardLimit), "safe");
  assert.equal(classifyUploadRiskByBytes(9000001, target, hardLimit), "risky");
  assert.equal(classifyUploadRiskByBytes(10000000, target, hardLimit), "risky");
  assert.equal(classifyUploadRiskByBytes(10000001, target, hardLimit), "blocked");
});

test("upload policy normalizes auto-compress toggle and compress format", () => {
  assert.equal(normalizeUploadAutoCompressEnabled(true), true);
  assert.equal(normalizeUploadAutoCompressEnabled("false"), false);
  assert.equal(normalizeUploadAutoCompressEnabled(undefined, false), false);

  assert.equal(normalizeUploadCompressFormat("jpeg"), "jpeg");
  assert.equal(normalizeUploadCompressFormat("png"), "jpeg");
});
