import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FILM_DEFAULTS, getFilmPresets, normalizeFilmParams, renderFilmImageData } from "../src/webview/post-fx/renderer.js";

const webglSource = await readFile(new URL("../src/webview/post-fx/webgl-renderer.js", import.meta.url), "utf8");
assert.match(webglSource, /getContext\("webgl2"/, "post FX exposes a WebGL2 renderer");
assert.match(webglSource, /returnDataUrl === false/, "preview rendering can avoid PNG encode/readback");

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

console.log("Post FX renderer tests passed.");
