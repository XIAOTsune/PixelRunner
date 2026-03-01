const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePasteStrategy,
  normalizeCloudConcurrentJobs
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
