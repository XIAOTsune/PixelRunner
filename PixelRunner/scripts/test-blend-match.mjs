import assert from "node:assert/strict";
import { computeSharedContentReference, estimateTranslationReference } from "../src/shared/blend-match-reference.js";
import { buildConservativeCpuFallbackAlignment, buildCpuBlendMatchPlanFromSamples, buildTrustedGpuBlendMatchPlanFromSamples, getBlendMatchConfig } from "../src/host/photoshop/blend-match.js";

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

function buildStats(sample) {
  let r = 0;
  let g = 0;
  let b = 0;
  let luma = 0;
  const count = sample.width * sample.height;
  for (let index = 0; index < sample.data.length; index += 4) {
    r += sample.data[index];
    g += sample.data[index + 1];
    b += sample.data[index + 2];
    luma += sample.data[index] * 0.2126 + sample.data[index + 1] * 0.7152 + sample.data[index + 2] * 0.0722;
  }
  return {
    count,
    meanR: r / count,
    meanG: g / count,
    meanB: b / count,
    meanLuma: luma / count,
    weightedMeanR: r / count,
    weightedMeanG: g / count,
    weightedMeanB: b / count,
    weightedMeanLuma: luma / count,
    weightedMeanSat: 0.2,
    detailEnergy: 3
  };
}

const defaultBlendMatchConfig = getBlendMatchConfig();
assert.equal(defaultBlendMatchConfig.mode, "balanced");
assert.equal(defaultBlendMatchConfig.totalStrength, 100);
assert.equal(defaultBlendMatchConfig.featherRadius, 72);
assert.equal(getBlendMatchConfig({ featherRadius: 999 }).featherRadius, 128);
assert.equal(
  getBlendMatchConfig({ mode: "balanced", alignmentMaxOffset: 96 }).alignmentMaxOffset,
  120,
  "balanced must retain the baseline structural-search range when older settings are restored"
);

const colorConsistencyConfig = {
  mode: "balanced", totalStrength: 78, luminanceStrength: 82, colorStrength: 76,
  saturationStrength: 62, contrastStrength: 58, featherRadius: 16,
  alignmentEnabled: true, alignmentMaxOffset: 12, alignmentMaxScale: 2.5,
  alignmentMaxRotation: 1.75, alignmentMaxStretch: 2.5, localAlignmentEnabled: true,
  localMeshStrength: 0.58, localMeshMaxOffset: 6, previewMaxEdge: 512
};

function buildAllSharedColorPlan(source, reference, cacheKey) {
  const mask = new Uint8Array(source.width * source.height).fill(255);
  return buildCpuBlendMatchPlanFromSamples({
    documentId: 11,
    layerId: 51,
    layerName: "color consistency fixture",
    bounds: { left: 0, top: 0, right: source.width, bottom: source.height },
    previewCacheKey: cacheKey,
    config: colorConsistencyConfig,
    sourceSample: { ...source, scaleX: 1, scaleY: 1, stats: buildStats(source) },
    referenceSample: { ...reference, scaleX: 1, scaleY: 1, stats: buildStats(reference) },
    existingAlignment: {
      backend: "cpu",
      trusted: true,
      applied: false,
      dx: 0,
      dy: 0,
      confidence: 1,
      reason: "deterministic-all-shared-fixture",
      sharedMask: {
        width: source.width,
        height: source.height,
        base64: Buffer.from(mask).toString("base64"),
        sharedRatio: 1,
        excludedRatio: 0,
        effectiveWeight: mask.length
      }
    }
  });
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

const garmentReference = makeSample(96, 112, [104, 112, 126, 255]);
const garmentSource = makeSample(96, 112, [124, 132, 146, 255]);
paintRect(garmentReference, 28, 18, 69, 88, [112, 20, 48, 255]);
paintRect(garmentSource, 28, 18, 69, 88, [224, 104, 132, 255]);
paintRect(garmentSource, 38, 28, 59, 79, [194, 132, 116, 255]);
const garmentMask = computeSharedContentReference(garmentSource, garmentReference);
assert.ok(garmentMask.mask[56 * 96 + 48] < 0.22, `smooth changed garment interior must be excluded, got ${garmentMask.mask[56 * 96 + 48]}`);
assert.ok(garmentMask.mask[100 * 96 + 10] > 0.72, "unchanged background with a global cast must remain color evidence");
let allRed = 0;
let sharedRed = 0;
let sharedWeight = 0;
for (let pixel = 0; pixel < garmentMask.mask.length; pixel += 1) {
  allRed += garmentSource.data[pixel * 4];
  sharedRed += garmentSource.data[pixel * 4] * garmentMask.mask[pixel];
  sharedWeight += garmentMask.mask[pixel];
}
allRed /= garmentMask.mask.length;
sharedRed /= sharedWeight;
assert.ok(Math.abs(sharedRed - 124) < Math.abs(allRed - 124) * 0.45, "replacement colors must not drag shared-region color statistics");

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

const fastCpuTransform = buildConservativeCpuFallbackAlignment(
  { ...translatedSource, scaleX: 1, scaleY: 1 },
  { ...translatedReference, scaleX: 1, scaleY: 1 },
  { alignmentMaxOffset: 16 }
);
assert.equal(fastCpuTransform.search.fullCpuSearch, false, "preview fallback must not run the full affine/grid CPU search");
assert.equal(fastCpuTransform.search.source, "cpu-translation-proxy");
assert.ok(Math.abs(fastCpuTransform.sampleDx - 3) <= 1 && Math.abs(fastCpuTransform.sampleDy + 2) <= 1, JSON.stringify(fastCpuTransform));

const largeShiftReference = makeSample(256, 224, [78, 105, 131, 255]);
paintRect(largeShiftReference, 14, 18, 42, 196, [238, 236, 226, 255]);
paintRect(largeShiftReference, 74, 38, 218, 59, [18, 30, 42, 255]);
paintRect(largeShiftReference, 132, 84, 178, 178, [206, 74, 38, 255]);
paintRect(largeShiftReference, 196, 136, 238, 210, [48, 184, 124, 255]);
const largeShiftSource = shiftSample(largeShiftReference, 52, -28);
const largeShiftPlan = buildCpuBlendMatchPlanFromSamples({
  documentId: 12,
  layerId: 52,
  layerName: "large translation fixture",
  bounds: { left: 0, top: 0, right: largeShiftReference.width, bottom: largeShiftReference.height },
  previewCacheKey: "large-translation-fallback",
  config: {
    ...getBlendMatchConfig({
      mode: "balanced",
      alignmentMaxOffset: 120,
      alignmentScaleEnabled: false,
      alignmentMaxScale: 0,
      alignmentMaxRotation: 0,
      alignmentMaxStretch: 0,
      localAlignmentEnabled: false
    }),
    alignmentScaleEnabled: false,
    alignmentMaxScale: 0,
    alignmentMaxRotation: 0,
    alignmentMaxStretch: 0,
    localAlignmentEnabled: false
  },
  sourceSample: { ...largeShiftSource, scaleX: 1, scaleY: 1, stats: buildStats(largeShiftSource) },
  referenceSample: { ...largeShiftReference, scaleX: 1, scaleY: 1, stats: buildStats(largeShiftReference) }
});
assert.equal(largeShiftPlan.alignment.search.fullCpuSearch, true, "GPU fallback must use the complete CPU search");
assert.equal(largeShiftPlan.alignment.search.cpuPyramid.used, true, "large preview fallback must use the CPU pyramid locator");
assert.equal(largeShiftPlan.alignment.search.cpuPyramid.accepted, true, JSON.stringify(largeShiftPlan.alignment.search.cpuPyramid));
assert.ok(Math.abs(largeShiftPlan.alignment.sampleDx - 52) <= 2, JSON.stringify(largeShiftPlan.alignment));
assert.ok(Math.abs(largeShiftPlan.alignment.sampleDy + 28) <= 2, JSON.stringify(largeShiftPlan.alignment));
console.log(
  `Blend-match CPU pyramid fixture: global=${largeShiftPlan.alignment.search.timings.globalSearchMs}ms, ` +
  `proxy=${largeShiftPlan.alignment.search.cpuPyramid.proxyMs}ms, ` +
  `refine=${largeShiftPlan.alignment.search.cpuPyramid.refineMs}ms.`
);

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

const cpuFallbackSource = { ...garmentSource, scaleX: 1, scaleY: 1, stats: buildStats(garmentSource) };
const cpuFallbackReference = { ...garmentReference, scaleX: 1, scaleY: 1, stats: buildStats(garmentReference) };
const cpuFallbackPlan = buildCpuBlendMatchPlanFromSamples({
  documentId: 9,
  layerId: 43,
  layerName: "changed garment",
  bounds: { left: 0, top: 0, right: garmentSource.width, bottom: garmentSource.height },
  previewCacheKey: "cpu-fallback-fixture",
  config: {
    mode: "balanced", totalStrength: 78, luminanceStrength: 82, colorStrength: 76,
    saturationStrength: 62, contrastStrength: 58, featherRadius: 16,
    alignmentEnabled: true, alignmentMaxOffset: 16, alignmentMaxScale: 2.5,
    alignmentMaxRotation: 1.75, alignmentMaxStretch: 2.5, localAlignmentEnabled: true,
    localMeshStrength: 0.58, localMeshMaxOffset: 6, previewMaxEdge: 512
  },
  sourceSample: cpuFallbackSource,
  referenceSample: cpuFallbackReference,
  fastFallback: true
});
assert.equal(cpuFallbackPlan.alignment.search.fullCpuSearch, false);
assert.ok(cpuFallbackPlan.sharedMask && cpuFallbackPlan.sharedMask.excludedRatio > 0.12, "CPU ColorPlan must carry a shared-content mask");
assert.ok(cpuFallbackPlan.color.profile && cpuFallbackPlan.color.profile.sharedMask, "CPU ColorPlan must report shared-mask statistics");

const hugeReplacementSource = makeSample(64, 64);
const hugeReplacementReference = makeSample(64, 64);
paintRect(hugeReplacementSource, 3, 3, 61, 61, [235, 40, 90, 255]);
const hugeReplacementPlan = buildCpuBlendMatchPlanFromSamples({
  documentId: 9,
  layerId: 44,
  layerName: "mostly replaced",
  bounds: { left: 0, top: 0, right: 64, bottom: 64 },
  previewCacheKey: "mostly-replaced-fixture",
  config: cpuFallbackPlan.config,
  sourceSample: { ...hugeReplacementSource, scaleX: 1, scaleY: 1, stats: buildStats(hugeReplacementSource) },
  referenceSample: { ...hugeReplacementReference, scaleX: 1, scaleY: 1, stats: buildStats(hugeReplacementReference) },
  fastFallback: true
});
assert.equal(hugeReplacementPlan.alignment.colorInferenceLimited, true, "very small shared area must stop color inference");
assert.equal(hugeReplacementPlan.color.profile, null);
assert.deepEqual(hugeReplacementPlan.color.corrections.colorBalance, { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 });

const stableColorSource = makeSample(96, 80, [82, 106, 132, 255]);
const stableColorReference = makeSample(96, 80, [105, 129, 155, 255]);
const stableColorPlan = buildAllSharedColorPlan(stableColorSource, stableColorReference, "stable-color-baseline");
const residualOutlierSource = makeSample(96, 80, [82, 106, 132, 255]);
paintRect(residualOutlierSource, 26, 17, 64, 54, [244, 58, 122, 255]);
const residualOutlierPlan = buildAllSharedColorPlan(residualOutlierSource, stableColorReference, "stable-color-residual-outlier");
const stableProfile = stableColorPlan.color.profile;
const residualProfile = residualOutlierPlan.color.profile;
assert.ok(stableProfile && residualProfile, "robust shared-region ColorPlans must be available");
assert.ok(Math.abs(residualProfile.midDelta - stableProfile.midDelta) < 1.5, "a minority changed region must not drag global luminance correction");
assert.ok(Math.abs(residualProfile.uDelta - stableProfile.uDelta) < 1.5, "a minority changed region must not drag blue/yellow correction");
assert.ok(Math.abs(residualProfile.vDelta - stableProfile.vDelta) < 1.5, "a minority changed region must not drag red/cyan correction");
assert.ok(Math.abs(residualProfile.saturationFactor - stableProfile.saturationFactor) < 0.025, "a high-saturation changed region must not drag saturation correction");

const thresholdSource = makeSample(72, 64, [92, 108, 124, 255]);
const thresholdReferenceLow = makeSample(72, 64, [109, 125, 141, 255]);
const thresholdReferenceHigh = makeSample(72, 64, [111, 127, 143, 255]);
const thresholdLowProfile = buildAllSharedColorPlan(thresholdSource, thresholdReferenceLow, "continuous-threshold-low").color.profile;
const thresholdHighProfile = buildAllSharedColorPlan(thresholdSource, thresholdReferenceHigh, "continuous-threshold-high").color.profile;
assert.ok(thresholdHighProfile.mismatchSeverity > thresholdLowProfile.mismatchSeverity, "mismatch response should increase continuously");
assert.ok(Math.abs(thresholdHighProfile.midDelta - thresholdLowProfile.midDelta) < 3, "nearby casts must not trigger a discontinuous strategy jump");
assert.ok(thresholdLowProfile.evidenceReliability > 0.98 && thresholdHighProfile.evidenceReliability > 0.98, "full shared evidence should retain correction strength");

let webglSkipReason = "WebGL2 integration unavailable in Node";
if (typeof OffscreenCanvas === "function") {
  const canvas = new OffscreenCanvas(4, 4);
  webglSkipReason = canvas.getContext("webgl2") ? "WebGL2 integration harness not installed" : "OffscreenCanvas has no WebGL2 context";
}
console.log(`Blend-match reference tests passed. Optional WebGL2 integration skipped: ${webglSkipReason}.`);
