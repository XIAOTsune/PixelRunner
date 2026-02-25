const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeUploadMaxEdge,
  normalizePasteStrategy
} = require("../../../src/domain/policies/run-settings-policy");

test("normalizeUploadMaxEdge keeps supported values and falls back for invalid values", () => {
  assert.equal(normalizeUploadMaxEdge(4096), 4096);
  assert.equal(normalizeUploadMaxEdge("2048"), 2048);
  assert.equal(normalizeUploadMaxEdge(123), 0);
  assert.equal(normalizeUploadMaxEdge(undefined), 0);
});

test("normalizePasteStrategy maps legacy markers and falls back for invalid markers", () => {
  assert.equal(normalizePasteStrategy("smart"), "smart");
  assert.equal(normalizePasteStrategy("smartEnhanced"), "smartEnhanced");
  assert.equal(normalizePasteStrategy("edgeAuto"), "smart");
  assert.equal(normalizePasteStrategy("stretch"), "normal");
  assert.equal(normalizePasteStrategy(""), "normal");
  assert.equal(normalizePasteStrategy("unknown"), "normal");
});
