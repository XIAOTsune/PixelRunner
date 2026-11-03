import assert from "node:assert/strict";
import { normalizeDocumentMode } from "../src/host/photoshop/document.js";
import {
  buildPixelCaptureOptions,
  prepareTemporaryRgb8Document,
  getSrgb8Pixels,
  normalizeFloatComponentToByte,
  selectConsistentPngColorChunks
} from "../src/host/photoshop/pixel-capture.js";
import { buildPlaceSessionDescriptor } from "../src/host/photoshop/service.js";

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

const workingSrgbAlias = { colorSpace: "RGB", colorProfile: "Working RGB - sRGB IEC61966-2.1", componentSize: 8 };
let aliasPixelRequests = 0;
let aliasFallbackCalls = 0;
const aliasPixelResult = await getSrgb8Pixels({
  async getPixels() {
    aliasPixelRequests += 1;
    return { imageData: workingSrgbAlias };
  }
}, { documentID: 13 }, async () => {
  aliasFallbackCalls += 1;
  throw new Error("same-profile alias should not invoke the conversion fallback");
});
assert.equal(aliasPixelResult.imageData, workingSrgbAlias);
assert.equal(aliasPixelRequests, 1, "an sRGB working-space alias should be accepted on the first request");
assert.equal(aliasFallbackCalls, 0, "an sRGB working-space alias should not create a temporary conversion document");

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
await prepareTemporaryRgb8Document({ id: 25, mode: "CMYKColor", bitsPerChannel: 16 }, {
  async batchPlay(descriptors) { conversionActions.push(descriptors[0]); return []; }
});
assert.deepEqual(conversionActions.map((action) => action._obj), ["convertMode", "convertMode"]);
assert.deepEqual(conversionActions[0]._to, { _class: "RGBColor" });
assert.equal(conversionActions[1].depth, 8);
assert.ok(conversionActions.every((action) => action._options && action._options.dialogOptions === "dontDisplay"));

const alreadyStandardActions = [];
await prepareTemporaryRgb8Document({
  id: 26,
  mode: "RGBColor",
  bitsPerChannel: 8,
  colorProfileName: "sRGB IEC61966-2.1"
}, {
  async batchPlay(descriptors) { alreadyStandardActions.push(descriptors[0]); return []; }
});
assert.deepEqual(alreadyStandardActions, [], "standard RGB/sRGB/8-bit copies should not run conversion actions");

const workingSrgbAliasActions = [];
await prepareTemporaryRgb8Document({
  id: 29,
  mode: "RGBColor",
  bitsPerChannel: 8,
  colorProfileName: "Working RGB - sRGB IEC61966-2.1"
}, {
  async batchPlay(descriptors) { workingSrgbAliasActions.push(descriptors[0]); return []; }
});
assert.deepEqual(workingSrgbAliasActions, [], "the working RGB label for sRGB should not run a profile conversion");

const nonStandardProfileActions = [];
await prepareTemporaryRgb8Document({
  id: 27,
  mode: "RGBColor",
  bitsPerChannel: 8,
  colorProfileName: "Display P3"
}, {
  async batchPlay(descriptors) { nonStandardProfileActions.push(descriptors[0]); return []; }
});
assert.deepEqual(nonStandardProfileActions, [], "a non-sRGB profile should be left intact for getPixels to convert without a profile dialog");

const highBitActions = [];
await prepareTemporaryRgb8Document({
  id: 28,
  mode: "RGBColor",
  bitsPerChannel: 16,
  colorProfileName: "sRGB IEC61966-2.1"
}, {
  async batchPlay(descriptors) { highBitActions.push(descriptors[0]); return []; }
});
assert.deepEqual(highBitActions.map((action) => action._obj), ["convertMode"]);
assert.equal(highBitActions[0].depth, 8);

const placeDescriptor = buildPlaceSessionDescriptor("token-123");
assert.equal(placeDescriptor._obj, "placeEvent");
assert.deepEqual(placeDescriptor.null, { _path: "token-123", _kind: "local" });
assert.equal(placeDescriptor._options.dialogOptions, "dontDisplay");

console.log("Pixel capture color conversion tests passed.");
