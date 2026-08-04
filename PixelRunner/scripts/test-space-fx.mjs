import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class TestImageData {
  constructor(width, height) {
    this.width = Math.max(1, Math.floor(Number(width) || 1));
    this.height = Math.max(1, Math.floor(Number(height) || 1));
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
  }
}

globalThis.ImageData = TestImageData;
globalThis.window = { PixelRunnerModules: {} };
await import(new URL(`../src/webview/space-fx.js?test=${Date.now()}`, import.meta.url));

const { renderSpaceFxImageData, prepareSpaceFxRenderContext } = window.PixelRunnerModules.spaceFx;
assert.equal(typeof renderSpaceFxImageData, "function");
assert.equal(typeof prepareSpaceFxRenderContext, "function");

function createSynthetic(width, height) {
  const imageData = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const checker = ((x >> 2) + (y >> 2)) % 2;
      imageData.data[index] = checker ? 236 : 18;
      imageData.data[index + 1] = (x * 17 + y * 3) & 255;
      imageData.data[index + 2] = checker ? 44 : 212;
      imageData.data[index + 3] = 255;
    }
  }
  return imageData;
}

function maxAlpha(imageData) {
  let max = 0;
  for (let index = 3; index < imageData.data.length; index += 4) max = Math.max(max, imageData.data[index]);
  return max;
}

const heatParams = {
  effect: "heat",
  intensity: 52,
  range: 62,
  feather: 54,
  angle: 90,
  detail: 64,
  glow: 38,
  glowColor: 55,
  glowColorEnabled: true,
  glowColorHex: "#ffd27a",
  brush: 42
};
const source = createSynthetic(96, 64);
const heatContext = prepareSpaceFxRenderContext(source.width, source.height, heatParams);
assert.ok(Math.max(heatContext.field.width, heatContext.field.height) <= 420, "small fixtures stay within the low-resolution field cap");

const largeContext = prepareSpaceFxRenderContext(1920, 1080, heatParams);
assert.ok(Math.max(largeContext.field.width, largeContext.field.height) <= 420, "large output keeps a low-resolution displacement field");
assert.equal(largeContext.width, 1920, "render context preserves the requested full output width");
assert.equal(largeContext.height, 1080, "render context preserves the requested full output height");

const warp = renderSpaceFxImageData(source, source.width, source.height, heatParams, null, {
  outputMode: "warp",
  includeMap: false,
  renderContext: heatContext
});
const glow = renderSpaceFxImageData(source, source.width, source.height, heatParams, null, {
  outputMode: "glow",
  includeMap: false,
  renderContext: heatContext
});
const smoke = renderSpaceFxImageData(source, source.width, source.height, heatParams, null, {
  outputMode: "smoke",
  includeMap: false,
  renderContext: heatContext
});
assert.equal(warp.imageData.width, source.width);
assert.equal(warp.imageData.height, source.height);
assert.equal(maxAlpha(warp.imageData), 255, "warp output remains an opaque document layer");
assert.ok(maxAlpha(glow.imageData) > 0, "glow output contains an independently controllable transparent effect");
assert.equal(maxAlpha(smoke.imageData), 0, "non-airflow effects do not synthesize a smoke layer");
assert.equal(warp.mapImageData, null, "final layer rendering skips the displacement-map allocation");

const zeroGlowParams = { ...heatParams, glow: 0 };
const zeroGlowContext = prepareSpaceFxRenderContext(source.width, source.height, zeroGlowParams);
const zeroGlow = renderSpaceFxImageData(source, source.width, source.height, zeroGlowParams, null, {
  outputMode: "glow",
  includeMap: false,
  renderContext: zeroGlowContext
});
assert.equal(maxAlpha(zeroGlow.imageData), 0, "zero glow produces a strictly transparent glow output");

const airflowParams = {
  ...heatParams,
  effect: "airflow",
  angle: 0,
  intensity: 45,
  glow: 42
};
const airflowWidth = source.width;
const airflowHeight = source.height;
const airflowField = new Float32Array(airflowWidth * airflowHeight * 4);
const smokeTexture = new Float32Array(airflowField.length);
for (let index = 0; index < airflowField.length; index += 4) {
  airflowField[index] = 0.65;
  airflowField[index + 1] = -0.3;
  airflowField[index + 2] = 0.28;
  airflowField[index + 3] = 0.72;
  smokeTexture[index] = 0.68;
  smokeTexture[index + 3] = 0.24;
}
const airflowContext = {
  effect: "airflow",
  width: airflowWidth,
  height: airflowHeight,
  field: {
    data: airflowField,
    width: airflowWidth,
    height: airflowHeight,
    smokeTexture: { data: smokeTexture, width: airflowWidth, height: airflowHeight }
  }
};
const airflowWarp = renderSpaceFxImageData(source, airflowWidth, airflowHeight, airflowParams, null, {
  outputMode: "warp",
  includeMap: false,
  renderContext: airflowContext
});
const airflowSmoke = renderSpaceFxImageData(source, airflowWidth, airflowHeight, airflowParams, null, {
  outputMode: "smoke",
  includeMap: false,
  renderContext: airflowContext
});
const airflowGlow = renderSpaceFxImageData(source, airflowWidth, airflowHeight, airflowParams, null, {
  outputMode: "glow",
  includeMap: false,
  renderContext: airflowContext
});
assert.equal(maxAlpha(airflowWarp.imageData), 255, "airflow warp remains independently opaque");
assert.ok(maxAlpha(airflowSmoke.imageData) > 0, "airflow smoke is emitted as a separate transparent layer");
assert.ok(maxAlpha(airflowGlow.imageData) > 0, "airflow glow is emitted as a separate transparent layer");
const zeroSmoke = renderSpaceFxImageData(source, airflowWidth, airflowHeight, { ...airflowParams, intensity: 0 }, null, {
  outputMode: "smoke",
  includeMap: false,
  renderContext: airflowContext
});
assert.equal(maxAlpha(zeroSmoke.imageData), 0, "zero airflow intensity produces a strictly transparent smoke output");

const sourceText = await readFile(new URL("../src/webview/space-fx.js", import.meta.url), "utf8");
const hostText = await readFile(new URL("../src/host/main.js", import.meta.url), "utf8");
const serviceText = await readFile(new URL("../src/host/photoshop/service.js", import.meta.url), "utf8");
assert.match(sourceText, /PREVIEW_CAPTURE_MAX_DIMENSION = 2200/);
assert.ok(sourceText.includes("drawImageToImageData(fullImage, 0)"), "final warp reads the full captured dimensions");
assert.match(sourceText, /outputMode: "warp"/);
assert.ok(sourceText.includes('renderFieldLayerToCanvas(renderContext, outputCanvas, state.params, "glow")'));
assert.ok(sourceText.includes('renderFieldLayerToCanvas(renderContext, outputCanvas, state.params, "smoke")'));
assert.doesNotMatch(sourceText, /softenAirflowResult/, "the old second softening pass stays removed");
assert.match(hostText, /photoshop.captureLicensedSpaceFxSource/);
assert.match(hostText, /fullResolution: true/);
assert.match(hostText, /skipUploadAsset: true/);
assert.match(serviceText, /options.fullResolution === true/);

console.log("Space FX full-resolution and layered-output tests passed.");
