import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { encodeLocalImageAsJpeg } from "../src/webview/local-image.js";
import { formatImageAssetMeta } from "../src/webview/image-asset-meta.js";

const calls = [];
const canvas = {
  getContext(type, options) {
    calls.push(["getContext", type, options]);
    return {
      fillStyle: "",
      fillRect(...args) { calls.push(["fillRect", ...args]); },
      drawImage(...args) { calls.push(["drawImage", ...args]); }
    };
  },
  toDataURL(type, quality) {
    calls.push(["toDataURL", type, quality]);
    return "data:image/jpeg;base64,QUJDRA==";
  }
};

const image = { naturalWidth: 4000, naturalHeight: 2000 };
const encoded = encodeLocalImageAsJpeg(image, { maxDimension: 1600, quality: 82 }, () => canvas);
assert.deepEqual([encoded.width, encoded.height], [4000, 2000], "upload keeps original dimensions when it fits");
assert.deepEqual([encoded.originalWidth, encoded.originalHeight], [4000, 2000]);
assert.equal(encoded.quality, 100, "preview quality must not lower upload quality");
assert.equal(encoded.qualityMax, 100);
assert.equal(encoded.targetBytes, 9_000_000);
assert.equal(encoded.hardLimitBytes, 10_000_000);
assert.equal(encoded.dataUrl, "data:image/jpeg;base64,QUJDRA==");
assert.equal(encoded.base64, "QUJDRA==");
assert.equal(encoded.bytes, 4);
assert.ok(calls.some(([name, type, options]) => name === "getContext" && type === "2d" && options?.colorSpace === "srgb"));
assert.ok(calls.some(([name, ...args]) => name === "fillRect" && args[0] === 0 && args[1] === 0 && args[2] === 4000 && args[3] === 2000), "transparent PNG pixels are composited onto white");
assert.ok(calls.some(([name, ...args]) => name === "drawImage" && args[0] === image));
assert.ok(calls.some(([name, type, quality]) => name === "toDataURL" && type === "image/jpeg" && quality === 1));
assert.equal(encoded.attempts.length, 1);
assert.equal(canvas.width, 0, "release full-resolution canvas after encoding");

const workspace = await readFile(new URL("../src/webview/workspace.js", import.meta.url), "utf8");
assert.match(workspace, /accept="image\/\*"/);
assert.match(workspace, /uploadMimeType: mimeType/);
const hostMain = await readFile(new URL("../src/host/main.js", import.meta.url), "utf8");
const hostService = await readFile(new URL("../src/host/photoshop/service.js", import.meta.url), "utf8");
assert.match(hostMain, /useImagingUpload: false/, "normal Photoshop capture restores the quality-controlled JPEG upload path");
assert.match(hostService, /options\.useImagingUpload === true\s*\? await buildImagingUploadAsset[\s\S]*: await buildCompressedUploadAsset/, "Photoshop uploads use the full-resolution compression fallback");
assert.match(hostService, /qualityMax: 12/, "Photoshop JPEG quality is identified on its actual 1-12 scale");

const fallbackCalls = [];
const fallbackCanvas = {
  getContext(_type, options) {
    fallbackCalls.push(options);
    if (options) throw new Error("colorSpace option unsupported");
    return { fillRect() {}, drawImage() {} };
  },
  toDataURL() { return "data:image/jpeg;base64,QQ=="; }
};
assert.doesNotThrow(() => encodeLocalImageAsJpeg({ width: 1, height: 1 }, { maxDimension: 1, quality: 80 }, () => fallbackCanvas));
assert.equal(fallbackCalls.length, 2, "older UXP canvas implementations fall back to the default sRGB context");

function sizeControlledCanvas(byteCount) {
  return {
    getContext() { return { fillRect() {}, drawImage() {} }; },
    toDataURL(type, quality) {
      assert.equal(type, "image/jpeg");
      return `data:image/jpeg;base64,${Buffer.alloc(byteCount(this.width, quality)).toString("base64")}`;
    }
  };
}
const limits = { maxDimension: 1600, targetBytes: 9, hardLimitBytes: 10 };
const reducedQuality = encodeLocalImageAsJpeg(image, limits, () => sizeControlledCanvas((_width, quality) => quality > 0.9 ? 12 : 8));
assert.deepEqual(reducedQuality.attempts.map(({ quality }) => quality), [100, 95, 90]);
assert.equal(reducedQuality.width, 4000, "lower quality at original dimensions before resizing");
const hardLimit = encodeLocalImageAsJpeg(image, limits, () => sizeControlledCanvas((_width, quality) => quality > 0.1 ? 12 : 10));
assert.equal(hardLimit.width, 4000, "accept original dimensions under hard limit");
assert.deepEqual(hardLimit.attempts.map(({ quality }) => quality), [100, 95, 90, 85, 80, 70, 60, 50, 40, 30, 20, 10]);
const resized = encodeLocalImageAsJpeg(image, limits, () => sizeControlledCanvas((width) => width > 1600 ? 12 : 8));
assert.deepEqual([resized.width, resized.height, resized.quality], [1600, 800, 100]);
assert.equal(resized.attempts.length, 13, "retry highest quality after size fallback");
assert.throws(() => encodeLocalImageAsJpeg(image, limits, () => sizeControlledCanvas(() => 12)), /超过上传限制/);
assert.throws(() => encodeLocalImageAsJpeg({ width: 0, height: 0 }), /尺寸无效/);
assert.throws(() => encodeLocalImageAsJpeg(image, limits, () => ({ getContext() { return null; } })), /无法创建/);
assert.throws(() => encodeLocalImageAsJpeg(image, limits, () => ({ getContext() { return { fillRect() {}, drawImage() {} }; }, toDataURL() { return "data:,"; } })), /JPEG 编码失败/);
const small = encodeLocalImageAsJpeg({ width: 100, height: 50 }, limits, () => sizeControlledCanvas(() => 8));
assert.deepEqual([small.width, small.height], [100, 50], "never upscale small local images");

assert.equal(formatImageAssetMeta({ originalWidth: 5147, originalHeight: 7715, uploadWidth: 5147, uploadHeight: 7715, uploadBytes: 1048576, uploadQuality: 12, uploadQualityMax: 12 }), "5147x7715 · 1.00MB · Q12/12");
assert.equal(formatImageAssetMeta({ originalWidth: 4000, originalHeight: 2000, uploadWidth: 1600, uploadHeight: 800, uploadBytes: 1048576, uploadQuality: 95, uploadQualityMax: 100 }), "原图 4000x2000 → 上传 1600x800 · 1.00MB · Q95/100");
assert.equal(formatImageAssetMeta({ width: 100, height: 50, uploadQuality: null }), "100x50");

console.log("Local image PNG-to-JPEG compatibility checks passed.");
