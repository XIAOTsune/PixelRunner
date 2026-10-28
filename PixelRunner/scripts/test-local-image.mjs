import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { encodeLocalImageAsJpeg } from "../src/webview/local-image.js";

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
assert.deepEqual([encoded.width, encoded.height], [1600, 800]);
assert.deepEqual([encoded.originalWidth, encoded.originalHeight], [4000, 2000]);
assert.equal(encoded.quality, 82);
assert.equal(encoded.dataUrl, "data:image/jpeg;base64,QUJDRA==");
assert.equal(encoded.base64, "QUJDRA==");
assert.equal(encoded.bytes, 4);
assert.ok(calls.some(([name, type, options]) => name === "getContext" && type === "2d" && options?.colorSpace === "srgb"));
assert.ok(calls.some(([name, ...args]) => name === "fillRect" && args[0] === 0 && args[1] === 0 && args[2] === 1600 && args[3] === 800), "transparent PNG pixels are composited onto white");
assert.ok(calls.some(([name, ...args]) => name === "drawImage" && args[0] === image));
assert.ok(calls.some(([name, type, quality]) => name === "toDataURL" && type === "image/jpeg" && quality === 0.82));

const workspace = await readFile(new URL("../src/webview/workspace.js", import.meta.url), "utf8");
assert.match(workspace, /accept="image\/jpeg,image\/png,\.jpg,\.jpeg,\.png"/);
assert.match(workspace, /uploadMimeType: mimeType/);

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

console.log("Local image PNG-to-JPEG compatibility checks passed.");
