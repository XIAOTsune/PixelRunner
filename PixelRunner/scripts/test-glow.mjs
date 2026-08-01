import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class TestImageData {
  constructor(dataOrWidth, widthOrHeight, height) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
      return;
    }
    this.data = dataOrWidth;
    this.width = widthOrHeight;
    this.height = height;
  }
}

const sandbox = {
  console,
  performance,
  ImageData: TestImageData,
  Uint8Array,
  Uint8ClampedArray,
  Float32Array,
  Map,
  Math,
  Number,
  String,
  Array,
  Object,
  Promise,
  setTimeout,
  clearTimeout
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);

function loadModule(relativePath) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

[
  "src/webview/glow/presets.js",
  "src/webview/glow/source-mask.js",
  "src/webview/glow/pyramid-blur.js",
  "src/webview/glow/compositor.js",
  "src/webview/glow/preview-engine.js"
].forEach(loadModule);

const modules = sandbox.PixelRunnerModules;
const presets = modules.glowPresets;
const compositor = modules.glowCompositor;

function createSyntheticGlowImage(width = 120, height = 80) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      let r = 7;
      let g = 8;
      let b = 11;

      // Point light.
      const pointDx = x - 12;
      const pointDy = y - 12;
      const pointDistance = Math.sqrt(pointDx * pointDx + pointDy * pointDy);
      if (pointDistance < 8) {
        const energy = 1 - pointDistance / 8;
        r = 255;
        g = Math.round(170 + energy * 85);
        b = Math.round(72 + energy * 183);
      // White flat product/cloth-like surface.
      } else if (x >= 26 && x < 50 && y >= 4 && y < 34) {
        r = 238;
        g = 238;
        b = 238;
      // Skin-like area.
      } else if (x >= 54 && x < 80 && y >= 4 && y < 38) {
        r = 210;
        g = 139;
        b = 112;
      // Deep shadow area.
      } else if (x >= 84 && y < 42) {
        r = 5;
        g = 7;
        b = 12;
      // Colored neon strips.
      } else if (y >= 48) {
        r = 8;
        g = 7;
        b = 14;
        if (y >= 54 && y < 58) {
          r = 255;
          g = 26;
          b = 218;
        } else if (y >= 66 && y < 70) {
          r = 22;
          g = 225;
          b = 255;
        }
      }

      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 255;
    }
  }
  return new TestImageData(data, width, height);
}

function createFlatMasks(width, height) {
  const total = width * height;
  return {
    luma: new Float32Array(total),
    protectMask: new Float32Array(total),
    sourceMask: new Float32Array(total),
    haloMask: new Float32Array(total)
  };
}

function meanMask(mask, width, left, top, right, bottom) {
  let sum = 0;
  let count = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      sum += mask[y * width + x];
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

function sumRgb(imageData) {
  let total = 0;
  for (let index = 0; index < imageData.data.length; index += 4) {
    total += imageData.data[index] + imageData.data[index + 1] + imageData.data[index + 2];
  }
  return total;
}

function screenPreview(base, glow) {
  const out = new TestImageData(base.width, base.height);
  for (let index = 0; index < out.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const baseValue = base.data[index + channel] / 255;
      const glowValue = glow.data[index + channel] / 255;
      out.data[index + channel] = Math.round((1 - (1 - baseValue) * (1 - glowValue)) * 255);
    }
    out.data[index + 3] = base.data[index + 3];
  }
  return out;
}

function assertImageEqual(actual, expected, message) {
  assert.equal(actual.width, expected.width, `${message}: width`);
  assert.equal(actual.height, expected.height, `${message}: height`);
  assert.deepEqual(actual.data, expected.data, message);
}

const normalized = presets.normalizeGlowParams({
  style: "shine",
  strength: 400,
  radius: -20,
  threshold: Number.NaN,
  colorEnabled: false,
  colorAmount: 100
});
assert.equal(normalized.strength, 100, "strength must be clamped");
assert.equal(normalized.radius, 1, "radius must be clamped");
assert.equal(normalized.threshold, 81, "invalid threshold must use its fallback");
assert.equal(normalized.composite.colorAmount, 0, "disabled tint must have no output amount");
assert.equal("softAddMix" in normalized.composite, false, "final-only parameters must not expose softAddMix");
assert.equal("colorProtect" in normalized.composite, false, "final-only parameters must not expose colorProtect");
for (const style of ["none", "darkSoft", "whiteSoft", "shine", "starburst", "anamorphic"]) {
  const styleParams = presets.normalizeGlowParams({ style });
  assert.equal(styleParams.source.skinProtect, 0, `${style} must keep glow skin-tone protection disabled`);
}

const disabled = presets.normalizeGlowParams({ style: "none", strength: 100 });
assert.equal(disabled.strength, 0, "none style must normalize to zero strength");
assert.equal(disabled.composite.intensity, 0, "none style must emit zero energy");

let previousIntensity = -1;
let previousHaloBoost = -1;
for (let strength = 0; strength <= 100; strength += 1) {
  const params = presets.normalizeGlowParams({ style: "shine", strength, radius: 160, threshold: 20 });
  assert.ok(params.composite.intensity >= previousIntensity, "strength intensity must be monotonic");
  assert.ok(params.composite.haloBoost >= previousHaloBoost, "strength halo energy must be monotonic");
  previousIntensity = params.composite.intensity;
  previousHaloBoost = params.composite.haloBoost;
}

let previousRadiusHalo = -1;
for (let radius = 1; radius <= 500; radius += 1) {
  const params = presets.normalizeGlowParams({ style: "shine", strength: 70, radius, threshold: 20 });
  assert.ok(params.composite.haloMix + 1e-12 >= previousRadiusHalo, "diffusion halo mix must be monotonic");
  previousRadiusHalo = params.composite.haloMix;
}

const splitParams = presets.normalizeGlowParams({ style: "shine", strength: 85, radius: 220, threshold: 20 });
const coreWeight = compositor.getCoreWeight(1);
const coreHaloWeight = compositor.getHaloWeight(1, 1, coreWeight);
const coreGain = compositor.getReceiverGain(0.9, 1, coreWeight, splitParams);
const coreValue = compositor.splitCoreAndHaloValue(0.9, coreWeight, coreHaloWeight, coreGain, splitParams);
const haloCoreWeight = compositor.getCoreWeight(0);
const haloWeight = compositor.getHaloWeight(0, 0.35, haloCoreWeight);
const haloGain = compositor.getReceiverGain(0.35, 0, haloCoreWeight, splitParams);
const haloValue = compositor.splitCoreAndHaloValue(0.45, haloCoreWeight, haloWeight, haloGain, splitParams);
assert.ok(coreWeight > 0.99, "sourceMask must identify the emitting core");
assert.ok(coreHaloWeight < 0.01, "core pixels must not be mislabeled as halo-only pixels");
assert.ok(haloWeight > 0.95, "haloMask - sourceMask must identify the diffusion band");
assert.ok(coreValue <= splitParams.composite.coreCeiling + 1e-6, "coreCeiling must cap core energy");
assert.ok(haloValue > 0.45, "haloBoost and haloMix must add energy outside the core");

const unprotectedReceiver = compositor.getReceiverGain(0.72, 0, 0, splitParams);
const protectedReceiver = compositor.getReceiverGain(0.72, 1, 0, splitParams);
const protectedCoreReceiver = compositor.getReceiverGain(0.72, 1, 1, splitParams);
const darkReceiver = compositor.getReceiverGain(0.02, 0, 0, splitParams);
assert.ok(protectedReceiver < unprotectedReceiver, "protected surfaces must reject external glow");
assert.equal(protectedCoreReceiver, 1, "receiver protection must not suppress the emitting core");
assert.ok(darkReceiver < unprotectedReceiver, "deep shadows must reject external gray haze");

const zeroBase = createSyntheticGlowImage(16, 10);
const zeroGlow = modules.glowPyramidBlur.createLayer(16, 10);
zeroGlow.r.fill(0.8);
zeroGlow.g.fill(0.7);
zeroGlow.b.fill(0.6);
const zeroMasks = createFlatMasks(16, 10);
const zeroParams = presets.normalizeGlowParams({ style: "shine", strength: 0, radius: 80, threshold: 20 });
const zeroComposed = compositor.composeProtected(zeroBase, zeroGlow, zeroMasks, zeroParams);
const zeroLayer = compositor.renderGlowLayer(zeroGlow, zeroMasks, zeroParams);
assertImageEqual(zeroComposed, zeroBase, "zero strength must preserve every base pixel");
for (let index = 0; index < zeroLayer.data.length; index += 4) {
  assert.equal(zeroLayer.data[index], 0, "zero strength glow red must be zero");
  assert.equal(zeroLayer.data[index + 1], 0, "zero strength glow green must be zero");
  assert.equal(zeroLayer.data[index + 2], 0, "zero strength glow blue must be zero");
  assert.equal(zeroLayer.data[index + 3], 255, "final glow layer must stay opaque");
}

const cacheParams = presets.normalizeGlowParams({ style: "shine", strength: 40, radius: 90, threshold: 20 });
const sourceKey = modules.glowPreviewEngine.getSourceCacheKey(cacheParams, 1000, 667);
const featherParams = structuredClone(cacheParams);
featherParams.source.sourceFeatherRadius += 1;
const haloRadiusParams = structuredClone(cacheParams);
haloRadiusParams.source.haloMaskRadius += 1;
const tintOnlyParams = presets.normalizeGlowParams({
  style: "shine",
  strength: 40,
  radius: 90,
  threshold: 20,
  colorEnabled: true,
  colorAmount: 75,
  colorHex: "#40a0ff"
});
assert.notEqual(
  modules.glowPreviewEngine.getSourceCacheKey(featherParams, 1000, 667),
  sourceKey,
  "sourceFeatherRadius must invalidate the source cache"
);
assert.notEqual(
  modules.glowPreviewEngine.getSourceCacheKey(haloRadiusParams, 1000, 667),
  sourceKey,
  "haloMaskRadius must invalidate the source cache"
);
assert.equal(
  modules.glowPreviewEngine.getSourceCacheKey(tintOnlyParams, 1000, 667),
  sourceKey,
  "composite-only tint changes must keep the source cache hot"
);
assert.equal(
  modules.glowPreviewEngine.getBlurCacheKey(tintOnlyParams, sourceKey),
  modules.glowPreviewEngine.getBlurCacheKey(cacheParams, sourceKey),
  "composite-only tint changes must keep the blur cache hot"
);
assert.equal(modules.glowPreviewEngine.getCacheInfo().hasSourceImage, false, "empty source cache must report accurately");

const synthetic = createSyntheticGlowImage();
const params = presets.normalizeGlowParams({ style: "shine", strength: 55, radius: 100, threshold: 20 });
const sourceStartedAt = performance.now();
const sourceResult = modules.glowSourceMask.buildSourceMask(synthetic, params, { includeDebug: false });
const sourceMs = performance.now() - sourceStartedAt;
const blurStartedAt = performance.now();
const blurResult = modules.glowPyramidBlur.buildMultiScaleGlow(sourceResult.sourceLayer, params);
const blurMs = performance.now() - blurStartedAt;
const compositeStartedAt = performance.now();
const glowLayer = compositor.renderGlowLayer(blurResult.glowLayer, sourceResult.masks, params);
const composed = compositor.composeProtected(synthetic, blurResult.glowLayer, sourceResult.masks, params);
const compositeMs = performance.now() - compositeStartedAt;

const pointActivity = meanMask(sourceResult.masks.sourceMask, synthetic.width, 6, 6, 19, 19);
const whiteActivity = meanMask(sourceResult.masks.sourceMask, synthetic.width, 29, 8, 47, 31);
const skinActivity = meanMask(sourceResult.masks.sourceMask, synthetic.width, 57, 8, 77, 34);
const darkActivity = meanMask(sourceResult.masks.sourceMask, synthetic.width, 88, 5, 116, 37);
const neonActivity = meanMask(sourceResult.masks.sourceMask, synthetic.width, 4, 52, 116, 76);
assert.ok(pointActivity > whiteActivity, "point lights must be selected more strongly than white planes");
assert.ok(pointActivity > skinActivity, "point lights must be selected more strongly than skin");
assert.ok(darkActivity < 0.001, "deep shadows must not become glow sources");
assert.ok(neonActivity > darkActivity, "colored neon must remain a valid glow source");
assert.ok(sumRgb(glowLayer) > 0, "synthetic image must produce visible glow energy");

const finalSimulation = screenPreview(synthetic, glowLayer);
assertImageEqual(composed, finalSimulation, "CPU preview must match the final Photoshop Screen contract");

const strengthEnergies = [];
for (const strength of [0, 20, 40, 60, 80, 100]) {
  const strengthParams = presets.normalizeGlowParams({ style: "shine", strength, radius: 100, threshold: 20 });
  strengthEnergies.push(sumRgb(compositor.renderGlowLayer(blurResult.glowLayer, sourceResult.masks, strengthParams)));
}
for (let index = 1; index < strengthEnergies.length; index += 1) {
  assert.ok(strengthEnergies[index] >= strengthEnergies[index - 1], "rendered glow energy must be monotonic with strength");
}

for (const radii of [[63, 64, 65, 66], [144, 145, 146, 147]]) {
  let previousEnergy = 0;
  for (const radius of radii) {
    const radiusParams = presets.normalizeGlowParams({ style: "shine", strength: 55, radius, threshold: 20 });
    const radiusBlur = modules.glowPyramidBlur.buildMultiScaleGlow(sourceResult.sourceLayer, radiusParams);
    const radiusGlow = compositor.renderGlowLayer(radiusBlur.glowLayer, sourceResult.masks, radiusParams);
    const energy = sumRgb(radiusGlow);
    assert.ok(energy >= previousEnergy, "diffusion energy must be monotonic across mip transitions");
    if (previousEnergy > 0) {
      assert.ok(energy / previousEnergy < 1.035, "mip transitions must not cause a visible diffusion jump");
    }
    previousEnergy = energy;
  }
}

const shaderSource = fs.readFileSync(path.join(repoRoot, "src/webview/glow/gpu/webgl-compositor.js"), "utf8");
const gpuBlurSource = fs.readFileSync(path.join(repoRoot, "src/webview/glow/gpu/webgl-pyramid-blur.js"), "utf8");
for (const token of [
  "haloOnly = max(0.0, halo - clamp(source",
  "coreLimit = coreCeiling + (1.0 - coreWeight)",
  "shadowGuard = darkReceiver",
  "if (uIntensity <= 0.000001)",
  "floor(clamp(glow + previewDither"
]) {
  assert.ok(shaderSource.includes(token), `WebGL2 compositor must retain shared formula token: ${token}`);
}
for (const obsoleteToken of ["uSoftAddMix", "uColorProtect", "uSourceAnchorBase", "uSourceAnchorAmount"]) {
  assert.equal(shaderSource.includes(obsoleteToken), false, `obsolete GPU parameter must be removed: ${obsoleteToken}`);
}
assert.ok(gpuBlurSource.includes("count - 1 + finalMix"), "GPU mip normalization must retain continuous last-level mixing");

const totalMs = sourceMs + blurMs + compositeMs;
console.log(
  `[glow] synthetic 120x80: source ${sourceMs.toFixed(1)}ms / blur ${blurMs.toFixed(1)}ms / ` +
  `composite ${compositeMs.toFixed(1)}ms / total ${totalMs.toFixed(1)}ms / mips ${blurResult.levels.mips.length}`
);
console.log("[glow] cache-key coverage: sourceFeatherRadius and haloMaskRadius invalidate correctly");

if (typeof OffscreenCanvas !== "function") {
  console.log("[glow] SKIP CPU/GPU pixel parity: Node runtime does not provide a WebGL2 OffscreenCanvas");
} else {
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext("webgl2");
  if (!gl) {
    console.log("[glow] SKIP CPU/GPU pixel parity: Node runtime cannot create a WebGL2 context");
  } else {
    console.log("[glow] SKIP CPU/GPU pixel parity: browser-backed module loading is required for WebGL2 readback");
  }
}

console.log("Glow algorithm tests passed.");
