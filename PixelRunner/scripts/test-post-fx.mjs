import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FILM_DEFAULTS, getFilmPresets, normalizeFilmParams, renderFilmImageData } from "../src/webview/post-fx/renderer.js";

const webglSource = await readFile(new URL("../src/webview/post-fx/webgl-renderer.js", import.meta.url), "utf8");
const rendererSource = await readFile(new URL("../src/webview/post-fx/renderer.js", import.meta.url), "utf8");
const webviewSource = await readFile(new URL("../src/webview/post-fx.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../app.html", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../app.css", import.meta.url), "utf8");
assert.match(webglSource, /getContext\("webgl2"/, "post FX exposes a WebGL2 renderer");
assert.match(webglSource, /returnDataUrl === false/, "preview rendering can avoid PNG encode/readback");
assert.match(webglSource, /grainNoise/, "WebGL grain uses mixed pixel noise");
assert.match(webglSource, /uvec2/, "WebGL grain uses an integer hash");
assert.doesNotMatch(webglSource, /fract\(sin\(dot/, "WebGL grain does not use directionally correlated sine hashing");
assert.doesNotMatch(rendererSource, /Math\.(?:sin|cos)/, "CPU grain does not use directional trigonometric warping");
assert.match(webviewSource, /PREVIEW_CAPTURE_MAX_DIMENSION = 4000/, "preview capture is capped at 4000px");
assert.match(webviewSource, /PREVIEW_MAX_SCALE = 24/, "preview zoom supports up to 24x");
assert.match(webviewSource, /data-post-fx-zoom/, "preview navigation binds zoom controls");
assert.doesNotMatch(webviewSource, /postFxExposureInput|postFxContrastInput|postFxSaturationInput|postFxWarmthInput|postFxShadowLiftInput|postFxHighlightRollOffInput/, "duplicate Photoshop tone controls are not bound");
assert.doesNotMatch(appSource, /postFxExposureInput|postFxContrastInput|postFxSaturationInput|postFxWarmthInput|postFxShadowLiftInput|postFxHighlightRollOffInput/, "duplicate Photoshop tone controls are not rendered");
assert.match(appSource, /id="postFxPresetDescription"/, "preset descriptions are visible in the panel");
assert.match(appSource, /id="postFxDispersionHighlightsInput" type="checkbox"\s*\/>/, "highlight-only dispersion defaults off");
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

console.log("Post FX renderer tests passed.");
