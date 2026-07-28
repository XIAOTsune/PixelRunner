import assert from "node:assert/strict";
import { computeSharedContentReference, estimateTranslationReference } from "../src/shared/blend-match-reference.js";
import { buildTrustedGpuBlendMatchPlanFromSamples } from "../src/host/photoshop/blend-match.js";

function makeSample(width, height, color = [92, 118, 144, 255]) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const texture = ((x * 13 + y * 7) % 17) - 8;
      data[index] = Math.max(0, Math.min(255, color[0] + texture));
      data[index + 1] = Math.max(0, Math.min(255, color[1] + texture));
      data[index + 2] = Math.max(0, Math.min(255, color[2] + texture));
      data[index + 3] = color[3] ?? 255;
    }
  }
  return { width, height, data };
}

function paintRect(sample, left, top, right, bottom, color) {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * sample.width + x) * 4;
      sample.data.set(color, index);
    }
  }
}

function shiftSample(sample, dx, dy) {
  const output = makeSample(sample.width, sample.height, [0, 0, 0, 0]);
  for (let y = 0; y < sample.height; y += 1) {
    for (let x = 0; x < sample.width; x += 1) {
      const sourceX = x - dx;
      const sourceY = y - dy;
      if (sourceX < 0 || sourceY < 0 || sourceX >= sample.width || sourceY >= sample.height) continue;
      const from = (sourceY * sample.width + sourceX) * 4;
      output.data.set(sample.data.subarray(from, from + 4), (y * sample.width + x) * 4);
    }
  }
  return output;
}

const globalSource = makeSample(48, 40, [80, 105, 130, 255]);
const globalReference = makeSample(48, 40, [104, 129, 154, 255]);
const globalMask = computeSharedContentReference(globalSource, globalReference);
assert.ok(globalMask.sharedRatio > 0.88, `global color cast should remain shared, got ${globalMask.sharedRatio}`);

const addedSource = makeSample(48, 40);
const addedReference = makeSample(48, 40);
paintRect(addedReference, 17, 12, 28, 25, [250, 30, 18, 255]);
const addedMask = computeSharedContentReference(addedSource, addedReference);
assert.ok(addedMask.sharedRatio > 0.55, "a small added object must not exclude the full image");
assert.ok(addedMask.mask[18 * 48 + 22] < 0.3, "high-saturation added content must be excluded from color inference");

const deletedSource = makeSample(48, 40);
paintRect(deletedSource, 17, 12, 28, 25, [250, 30, 18, 255]);
const deletedReference = makeSample(48, 40);
const deletedMask = computeSharedContentReference(deletedSource, deletedReference);
assert.ok(deletedMask.mask[18 * 48 + 22] < 0.3, "deleted content must be excluded from color inference");

const replacementSource = makeSample(48, 40);
const replacementReference = makeSample(48, 40);
paintRect(replacementReference, 3, 3, 45, 37, [230, 20, 20, 255]);
const replacementMask = computeSharedContentReference(replacementSource, replacementReference);
assert.ok(replacementMask.sharedRatio < 0.45, "large replacement must trigger conservative shared-area rejection");

const alphaSource = makeSample(48, 40);
const alphaReference = makeSample(48, 40);
paintRect(alphaReference, 0, 0, 5, 40, [92, 118, 144, 0]);
const alphaMask = computeSharedContentReference(alphaSource, alphaReference);
assert.ok(alphaMask.mask[20 * 48 + 1] < 0.2, "transparent edge must not become color evidence");
assert.ok(alphaMask.mask[20 * 48 + 20] > 0.7, "opaque interior should remain shared");

const translatedReference = makeSample(48, 40);
paintRect(translatedReference, 9, 7, 13, 34, [255, 255, 255, 255]);
paintRect(translatedReference, 18, 15, 37, 19, [15, 15, 15, 255]);
const translatedSource = shiftSample(translatedReference, 3, -2);
const referenceTransform = estimateTranslationReference(translatedSource, translatedReference, 5);
assert.ok(Math.abs(referenceTransform.dx - 3) <= 1 && Math.abs(referenceTransform.dy + 2) <= 1, JSON.stringify(referenceTransform));
assert.ok(referenceTransform.confidence > 0.05, "textured translation should be measurable");

const lowTexture = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 4).fill(128) };
for (let index = 3; index < lowTexture.data.length; index += 4) lowTexture.data[index] = 255;
const lowTextureTransform = estimateTranslationReference(lowTexture, lowTexture, 4);
assert.equal(lowTextureTransform.sampleCount, 0, "low texture should not fabricate alignment samples");
assert.equal(lowTextureTransform.confidence, 0, "low texture must stay low confidence");

const gpuFixture = { dx: referenceTransform.dx + 0.2, dy: referenceTransform.dy - 0.15, confidence: referenceTransform.confidence + 0.01 };
assert.ok(Math.abs(gpuFixture.dx - referenceTransform.dx) <= 0.5);
assert.ok(Math.abs(gpuFixture.dy - referenceTransform.dy) <= 0.5);
assert.ok(Math.abs(gpuFixture.confidence - referenceTransform.confidence) <= 0.05);

const planMaskBytes = new Uint8Array(globalSource.width * globalSource.height).fill(255);
const trustedGpuPlan = buildTrustedGpuBlendMatchPlanFromSamples({
  documentId: 7,
  layerId: 42,
  layerName: "AI result",
  bounds: { left: 0, top: 0, right: globalSource.width, bottom: globalSource.height },
  previewCacheKey: "fixture-cache",
  config: {
    mode: "balanced", totalStrength: 78, luminanceStrength: 82, colorStrength: 76,
    saturationStrength: 62, contrastStrength: 58, featherRadius: 16,
    alignmentEnabled: true, alignmentMaxOffset: 12, alignmentMaxScale: 2.5,
    alignmentMaxRotation: 1.75, alignmentMaxStretch: 2.5, localAlignmentEnabled: true,
    localMeshStrength: 0.58, localMeshMaxOffset: 6, previewMaxEdge: 512
  },
  sourceSample: { ...globalSource, scaleX: 1, scaleY: 1, stats: { count: globalSource.width * globalSource.height, weightedMeanLuma: 105, weightedMeanSat: 0.2, detailEnergy: 3 } },
  referenceSample: { ...globalReference, scaleX: 1, scaleY: 1, stats: { count: globalReference.width * globalReference.height, weightedMeanLuma: 129, weightedMeanSat: 0.2, detailEnergy: 3 } },
  gpuPlan: {
    alignment: {
      backend: "webgl2", applied: false, dx: 0, dy: 0, sampleDx: 0, sampleDy: 0,
      sampleScale: 1, sampleScaleX: 1, sampleScaleY: 1, sampleRotation: 0,
      confidence: 0.82, score: 0.74, secondScore: 0.63, scoreGap: 0.11, sampleCount: 1100,
      local: { enabled: false, applied: false, validTiles: 0, totalTiles: 0, tiles: [] }
    },
    sharedMask: {
      width: globalSource.width, height: globalSource.height,
      base64: Buffer.from(planMaskBytes).toString("base64"),
      sharedRatio: 1, excludedRatio: 0, effectiveWeight: planMaskBytes.length
    },
    metadata: { backend: "webgl2", timings: { total: 4.2 } }
  }
});
assert.ok(trustedGpuPlan.plan, `qualified GPU plan should not run CPU alignment fallback: ${trustedGpuPlan.reason}`);
assert.equal(trustedGpuPlan.plan.alignment.backend, "webgl2");
assert.equal(trustedGpuPlan.plan.alignment.trusted, true);

let webglSkipReason = "WebGL2 integration unavailable in Node";
if (typeof OffscreenCanvas === "function") {
  const canvas = new OffscreenCanvas(4, 4);
  webglSkipReason = canvas.getContext("webgl2") ? "WebGL2 integration harness not installed" : "OffscreenCanvas has no WebGL2 context";
}
console.log(`Blend-match reference tests passed. Optional WebGL2 integration skipped: ${webglSkipReason}.`);
