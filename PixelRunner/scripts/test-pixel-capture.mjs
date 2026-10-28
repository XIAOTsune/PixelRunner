import assert from "node:assert/strict";
import { normalizeDocumentMode } from "../src/host/photoshop/document.js";
import {
  buildPixelCaptureOptions,
  convertTemporaryDocumentToSrgb8,
  getSrgb8Pixels,
  normalizeFloatComponentToByte,
  selectConsistentPngColorChunks
} from "../src/host/photoshop/pixel-capture.js";

assert.deepEqual(buildPixelCaptureOptions({ documentID: 12, componentSize: 16 }), {
  documentID: 12,
  colorSpace: "RGB",
  colorProfile: "sRGB IEC61966-2.1",
  componentSize: 8
});

const attempts = [];
const returnedImageData = { colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1", componentSize: 8 };
const result = await getSrgb8Pixels({
  async getPixels(options) {
    attempts.push(options);
    if (attempts.length === 1) throw new Error("unsupported componentSize");
    return { imageData: returnedImageData };
  }
}, { documentID: 12 });
assert.equal(result.imageData, returnedImageData);
assert.equal(attempts.length, 2);
assert.equal(attempts[0].componentSize, 8);
assert.equal("componentSize" in attempts[1], false);
assert.equal(attempts[1].colorSpace, "RGB");
assert.equal(attempts[1].colorProfile, "sRGB IEC61966-2.1", "fallback must not discard color conversion requirements");

let compatibilityCalls = 0;
const compatibleResult = await getSrgb8Pixels({
  async getPixels() { throw new Error("mode conversion unsupported by this Photoshop version"); }
}, { documentID: 7 }, async (requestedOptions) => {
  compatibilityCalls += 1;
  assert.equal(requestedOptions.colorSpace, "RGB");
  assert.equal(requestedOptions.colorProfile, "sRGB IEC61966-2.1");
  return { imageData: { colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1", componentSize: 8 } };
});
assert.equal(compatibilityCalls, 1);
assert.equal(compatibleResult.imageData.componentSize, 8);

await assert.rejects(() => getSrgb8Pixels({
  async getPixels(options) {
    assert.equal(options.colorProfile, "sRGB IEC61966-2.1");
    return { imageData: { colorSpace: "CMYK", colorProfile: "U.S. Web Coated" } };
  }
}, { documentID: 1 }), /无法将当前文档转换为 RGB\/sRGB\/8 位像素/);

assert.equal(normalizeFloatComponentToByte(0.5), 128);
assert.throws(() => normalizeFloatComponentToByte(2), /HDR 浮点像素/);
assert.throws(() => normalizeFloatComponentToByte(-0.1), /HDR 浮点像素/);

const chunks = ["gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "cICP"].map((type) => ({ type, data: new Uint8Array([1]) }));
assert.deepEqual(selectConsistentPngColorChunks(chunks).map((chunk) => chunk.type), ["iCCP", "sBIT"]);
assert.deepEqual(selectConsistentPngColorChunks(chunks.filter(({ type }) => type !== "iCCP" && type !== "cICP")).map((chunk) => chunk.type), ["sRGB", "sBIT"]);
assert.deepEqual(selectConsistentPngColorChunks(chunks.filter(({ type }) => !["iCCP", "sRGB", "cICP"].includes(type))).map((chunk) => chunk.type), ["cHRM", "gAMA", "sBIT"]);

assert.equal(normalizeDocumentMode("RGBColor"), "RGB");
assert.equal(normalizeDocumentMode("grayscale"), "GRAYSCALE");
assert.equal(normalizeDocumentMode("CMYKColor"), "CMYK");
assert.equal(normalizeDocumentMode("LabColor"), "LAB");
assert.equal(normalizeDocumentMode("Bitmap"), "BITMAP");
assert.equal(normalizeDocumentMode("Indexed Color"), "INDEXEDCOLOR");
assert.equal(normalizeDocumentMode("Duotone"), "DUOTONE");
assert.equal(normalizeDocumentMode("Multichannel"), "MULTICHANNEL");

const conversionActions = [];
await convertTemporaryDocumentToSrgb8({ id: 25, mode: "CMYKColor", bitsPerChannel: 16 }, {
  async batchPlay(descriptors) { conversionActions.push(descriptors[0]); return []; }
});
assert.deepEqual(conversionActions.map((action) => action._obj), ["convertMode", "convertMode", "convertToProfile"]);
assert.deepEqual(conversionActions[0]._to, { _class: "RGBColor" });
assert.equal(conversionActions[1].depth, 8);
assert.equal(conversionActions[2].profile, "sRGB IEC61966-2.1");
assert.equal(conversionActions[2].intent._value, "relativeColorimetric");

console.log("Pixel capture color conversion tests passed.");
