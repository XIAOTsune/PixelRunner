import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FILM_DEFAULTS, POST_FX_DEFAULTS, getFilmPresets, getPostFxEffects, normalizeFilmParams, normalizePostFxParams, renderFilmImageData, renderPostFxImageData } from "../src/webview/post-fx/renderer.js";

const webglSource = await readFile(new URL("../src/webview/post-fx/webgl-renderer.js", import.meta.url), "utf8");
const rendererSource = await readFile(new URL("../src/webview/post-fx/renderer.js", import.meta.url), "utf8");
const webviewSource = await readFile(new URL("../src/webview/post-fx.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../app.html", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../app.css", import.meta.url), "utf8");
assert.match(webglSource, /getContext\("webgl2"/, "post FX exposes a WebGL2 renderer");
assert.match(webglSource, /returnDataUrl === false/, "preview rendering can avoid PNG encode/readback");
assert.match(webglSource, /grainNoise/, "WebGL grain uses mixed pixel noise");
assert.match(webglSource, /valueNoise/, "WebGL directional effects use continuous value noise");
assert.match(webglSource, /nearestDistance/, "WebGL shatter uses irregular nearest-site fragments");
assert.match(rendererSource, /function shatterSite/, "CPU shatter precomputes deterministic fragment sites");
assert.match(webglSource, /uvec2/, "WebGL grain uses an integer hash");
assert.doesNotMatch(webglSource, /fract\(sin\(dot/, "WebGL grain does not use directionally correlated sine hashing");
assert.doesNotMatch(rendererSource, /Math\.(?:sin|cos)/, "CPU grain does not use directional trigonometric warping");
assert.match(webviewSource, /PREVIEW_CAPTURE_MAX_DIMENSION = 4000/, "preview capture is capped at 4000px");
assert.match(webviewSource, /PREVIEW_MAX_SCALE = 24/, "preview zoom supports up to 24x");
assert.match(webviewSource, /fitMode: "original"/, "full-resolution post FX placement uses native pixel alignment");
assert.match(webviewSource, /后期结果尺寸不一致/, "post FX application rejects mismatched output dimensions");
assert.match(webviewSource, /data-post-fx-zoom/, "preview navigation binds zoom controls");
assert.doesNotMatch(webviewSource, /postFxExposureInput|postFxContrastInput|postFxSaturationInput|postFxWarmthInput|postFxShadowLiftInput|postFxHighlightRollOffInput/, "duplicate Photoshop tone controls are not bound");
assert.doesNotMatch(appSource, /postFxExposureInput|postFxContrastInput|postFxSaturationInput|postFxWarmthInput|postFxShadowLiftInput|postFxHighlightRollOffInput/, "duplicate Photoshop tone controls are not rendered");
assert.match(appSource, /id="postFxPresetDescription"/, "preset descriptions are visible in the panel");
assert.match(appSource, /id="postFxDispersionHighlightsInput" type="checkbox"\s*\/>/, "highlight-only dispersion defaults off");
assert.match(appSource, /id="postFxCrtConvergenceInput"/, "CRT convergence has a dedicated control");
assert.match(webviewSource, /crtConvergence: value\("postFxCrtConvergenceInput"/, "UI reads CRT convergence changes");
assert.match(webviewSource, /shatterCracks: value\("postFxShatterCracksInput"/, "UI reads shatter crack changes");
assert.match(appSource, /最长边 4000px/, "the panel explains the 4000px preview");
assert.match(styleSource, /\.tool-post-fx-card[\s\S]*?background: var\(--workspace-card-background\)/, "post FX entry uses the shared surface color configuration");

const source = {
  width: 9,
  height: 7,
  data: new Uint8ClampedArray(9 * 7 * 4)
};
for (let y = 0; y < source.height; y += 1) {
  for (let x = 0; x < source.width; x += 1) {
    const index = (y * source.width + x) * 4;
    source.data[index] = Math.round(30 + x / (source.width - 1) * 220);
    source.data[index + 1] = Math.round(20 + y / (source.height - 1) * 210);
    source.data[index + 2] = 96;
    source.data[index + 3] = (x === 0 && y === 0) ? 64 : 255;
  }
}

const normalized = normalizeFilmParams({ amount: 999, exposure: -999, grainSize: 99, preset: "missing" });
assert.equal(normalized.amount, 100, "film amount clamps to the supported range");
assert.equal(normalized.exposure, -100, "exposure clamps to the supported range");
assert.equal(normalized.grainSize, 8, "grain size clamps to the supported range");
assert.equal(normalized.preset, "natural", "unknown presets fall back to natural film");
assert.equal(getFilmPresets().length, 3, "the first release exposes three restrained film presets");
assert.equal(normalizeFilmParams({}).dispersionHighlightsOnly, false, "highlight-only dispersion defaults off");
assert.ok(getFilmPresets().every((preset) => preset.description), "every preset explains its intended look");
assert.deepEqual(getPostFxEffects().map((effect) => effect.id), ["film", "crt", "pixelate", "wind", "shatter"], "effect catalog exposes the four image-wide effects and film");
const effectNormalized = normalizePostFxParams({ effectType: "missing", effectAmount: 999, pixelBlockSize: 999, pixelLevels: 0, windDirection: -999, shatterFragmentSize: 1 });
assert.equal(effectNormalized.effectType, "film", "unknown effect types fall back to film");
assert.equal(effectNormalized.effectAmount, 100, "effect amount clamps to the supported range");
assert.equal(effectNormalized.pixelBlockSize, 64, "pixel block size clamps to the supported range");
assert.equal(effectNormalized.pixelLevels, 2, "pixel levels clamps to the supported range");
assert.equal(effectNormalized.windDirection, -180, "wind direction clamps to the supported range");
assert.equal(effectNormalized.shatterFragmentSize, 8, "shatter fragment size clamps to the supported range");

const disabled = renderFilmImageData(source, { ...FILM_DEFAULTS, amount: 0, grain: 0, halation: 0, vignette: 0, dispersion: 0 });
assert.deepEqual(Array.from(disabled.data), Array.from(source.data), "zero-strength processing preserves the source pixels");

const params = { ...FILM_DEFAULTS, seed: 77, grain: 34, halation: 42, dispersion: 28, dispersionHighlightsOnly: false };
const first = renderFilmImageData(source, params);
const second = renderFilmImageData(source, params);
assert.deepEqual(Array.from(first.data), Array.from(second.data), "the same seed produces deterministic film grain");
assert.equal(first.data[3], source.data[3], "source alpha is preserved");
assert.notDeepEqual(Array.from(first.data), Array.from(source.data), "a non-zero film stack changes image pixels");

const otherSeed = renderFilmImageData(source, { ...params, seed: 78 });
assert.notDeepEqual(Array.from(otherSeed.data), Array.from(first.data), "changing the seed changes the grain pattern");

const disabledStack = renderPostFxImageData(source, { ...POST_FX_DEFAULTS, effectType: "crt", effectEnabled: false, filmFinish: false });
assert.deepEqual(Array.from(disabledStack.data), Array.from(source.data), "disabled image-wide effect preserves the source pixels");
for (const effectType of ["crt", "pixelate", "wind", "shatter"]) {
  const effectParams = { ...POST_FX_DEFAULTS, effectType, effectAmount: 100, filmFinish: false, seed: 9 };
  const effectFirst = renderPostFxImageData(source, effectParams);
  const effectSecond = renderPostFxImageData(source, effectParams);
  assert.deepEqual(Array.from(effectFirst.data), Array.from(effectSecond.data), `${effectType} rendering is deterministic`);
  assert.notDeepEqual(Array.from(effectFirst.data), Array.from(source.data), `${effectType} changes image pixels`);
}
const windHorizontal = renderPostFxImageData(source, { ...POST_FX_DEFAULTS, effectType: "wind", filmFinish: false, windDirection: 0, windLength: 90 });
const windVertical = renderPostFxImageData(source, { ...POST_FX_DEFAULTS, effectType: "wind", filmFinish: false, windDirection: 90, windLength: 90 });
assert.notDeepEqual(Array.from(windHorizontal.data), Array.from(windVertical.data), "wind direction changes the drag field");
const crtFlat = renderPostFxImageData(source, { ...POST_FX_DEFAULTS, effectType: "crt", filmFinish: false, crtCurvature: 0, crtConvergence: 0 });
const crtCurved = renderPostFxImageData(source, { ...POST_FX_DEFAULTS, effectType: "crt", filmFinish: false, crtCurvature: 100, crtConvergence: 100 });
assert.notDeepEqual(Array.from(crtFlat.data), Array.from(crtCurved.data), "CRT curvature and convergence affect the image");
const pixelNoDither = renderPostFxImageData(source, { ...POST_FX_DEFAULTS, effectType: "pixelate", filmFinish: false, pixelBlockSize: 4, pixelLevels: 4, pixelDither: 0 });
const pixelDithered = renderPostFxImageData(source, { ...POST_FX_DEFAULTS, effectType: "pixelate", filmFinish: false, pixelBlockSize: 4, pixelLevels: 4, pixelDither: 100 });
assert.notDeepEqual(Array.from(pixelNoDither.data), Array.from(pixelDithered.data), "pixel dithering changes quantization thresholds");
const windSmooth = renderPostFxImageData(source, { ...POST_FX_DEFAULTS, effectType: "wind", filmFinish: false, windLength: 90, windBreakup: 0 });
const windBroken = renderPostFxImageData(source, { ...POST_FX_DEFAULTS, effectType: "wind", filmFinish: false, windLength: 90, windBreakup: 100 });
assert.notDeepEqual(Array.from(windSmooth.data), Array.from(windBroken.data), "wind breakup changes the directional drag weighting");
const shatterSoft = renderPostFxImageData(source, { ...POST_FX_DEFAULTS, effectType: "shatter", filmFinish: false, shatterCracks: 0, seed: 9 });
const shatterCracked = renderPostFxImageData(source, { ...POST_FX_DEFAULTS, effectType: "shatter", filmFinish: false, shatterCracks: 100, seed: 9 });
assert.notDeepEqual(Array.from(shatterSoft.data), Array.from(shatterCracked.data), "shatter crack strength changes fragment boundaries");
const pixelGrid = renderPostFxImageData(source, { ...POST_FX_DEFAULTS, effectType: "pixelate", filmFinish: false, pixelBlockSize: 4, pixelDither: 0, pixelEdgePreserve: 0, pixelLevels: 2 });
assert.equal(pixelGrid.data[0], pixelGrid.data[4], "pixelation keeps adjacent pixels in a stable block grid");

const flatSize = 192;
const flatSource = {
  width: flatSize,
  height: flatSize,
  data: new Uint8ClampedArray(flatSize * flatSize * 4)
};
for (let index = 0; index < flatSource.data.length; index += 4) {
  flatSource.data[index] = 112;
  flatSource.data[index + 1] = 112;
  flatSource.data[index + 2] = 112;
  flatSource.data[index + 3] = 255;
}
const flatGrain = renderFilmImageData(flatSource, {
  ...FILM_DEFAULTS,
  amount: 100,
  exposure: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  shadowLift: 0,
  highlightRollOff: 0,
  halation: 0,
  grain: 100,
  grainSize: 3,
  grainColor: 0,
  vignette: 0,
  dispersion: 0,
  seed: 4817
});
const samples = new Float64Array(flatSize * flatSize);
let sampleMean = 0;
for (let index = 0; index < samples.length; index += 1) {
  samples[index] = flatGrain.data[index * 4];
  sampleMean += samples[index];
}
sampleMean /= samples.length;
let sampleVariance = 0;
for (const sample of samples) sampleVariance += (sample - sampleMean) ** 2;
sampleVariance /= samples.length;
function directionalCorrelation(dx, dy) {
  let product = 0;
  let count = 0;
  const startX = Math.max(0, -dx);
  const endX = Math.min(flatSize, flatSize - dx);
  const startY = Math.max(0, -dy);
  const endY = Math.min(flatSize, flatSize - dy);
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      product += (samples[y * flatSize + x] - sampleMean) * (samples[(y + dy) * flatSize + x + dx] - sampleMean);
      count += 1;
    }
  }
  return product / Math.max(1, count) / Math.max(0.0001, sampleVariance);
}
const directionalCorrelations = [
  [1, 0], [0, 1], [1, 1], [1, -1], [3, 0], [0, 3], [3, 3], [3, -3], [5, 2], [2, -5]
].map(([dx, dy]) => directionalCorrelation(dx, dy));
assert.ok(
  Math.max(...directionalCorrelations.map(Math.abs)) < 0.08,
  `film grain must not contain directional bands: ${directionalCorrelations.map((value) => value.toFixed(3)).join(", ")}`
);

function grainStatistics(level, grainColor = 100) {
  const image = {
    width: flatSize,
    height: flatSize,
    data: new Uint8ClampedArray(flatSize * flatSize * 4)
  };
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = level;
    image.data[index + 1] = level;
    image.data[index + 2] = level;
    image.data[index + 3] = 255;
  }
  const result = renderFilmImageData(image, {
    ...FILM_DEFAULTS,
    amount: 100,
    exposure: 0,
    contrast: 0,
    saturation: 0,
    warmth: 0,
    shadowLift: 0,
    highlightRollOff: 0,
    halation: 0,
    grain: 100,
    grainSize: 3,
    grainColor,
    vignette: 0,
    dispersion: 0,
    seed: 4817
  });
  let lumaSum = 0;
  let lumaSquaredSum = 0;
  let colorDifference = 0;
  const pixelCount = result.width * result.height;
  for (let index = 0; index < result.data.length; index += 4) {
    const r = result.data[index];
    const g = result.data[index + 1];
    const b = result.data[index + 2];
    const luma = (r + g + b) / 3;
    lumaSum += luma;
    lumaSquaredSum += luma * luma;
    colorDifference += Math.abs(r - g) + Math.abs(g - b);
  }
  const mean = lumaSum / pixelCount;
  return {
    deviation: Math.sqrt(lumaSquaredSum / pixelCount - mean * mean),
    colorDifference: colorDifference / pixelCount
  };
}
const darkGrain = grainStatistics(32);
const midGrain = grainStatistics(112);
const highlightGrain = grainStatistics(224);
assert.ok(darkGrain.deviation > midGrain.deviation, "shadows carry more grain than midtones");
assert.ok(midGrain.deviation > highlightGrain.deviation * 1.5, "highlights remain visibly cleaner than midtones");
assert.ok(midGrain.colorDifference < 1, "film grain remains predominantly neutral even at maximum color-grain setting");

console.log("Post FX renderer tests passed.");
