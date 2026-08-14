import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.window = {
  PixelRunnerModules: {
    runtime: {
      createId: (prefix = "id") => `${prefix}-test`
    }
  }
};

await import("../src/webview/state.js");
await import("../src/webview/ratio-offset-correction.js");

const modules = globalThis.window.PixelRunnerModules;
const correction = modules.ratioOffsetCorrection;

const canvasCalls = [];
globalThis.Image = class FakeImage {
  constructor() {
    this.naturalWidth = 1600;
    this.naturalHeight = 900;
    this.width = 1600;
    this.height = 900;
  }

  set src(value) {
    this.srcValue = value;
    queueMicrotask(() => this.onload && this.onload());
  }
};
globalThis.document = {
  createElement: (tagName) => {
    assert.equal(tagName, "canvas");
    const context = {
      drawImage: (...args) => canvasCalls.push(["drawImage", args]),
      fillRect: (...args) => canvasCalls.push(["fillRect", args]),
      fillStyle: "",
      imageSmoothingEnabled: false,
      imageSmoothingQuality: ""
    };
    return {
      width: 0,
      height: 0,
      getContext: () => context,
      toDataURL: (mimeType) => `data:${mimeType};base64,cGFkZGVk`
    };
  }
};

assert.equal(modules.state.normalizeSettings({}).ratioOffsetCorrectionEnabled, false);
assert.equal(modules.state.normalizeSettings({ ratioOffsetCorrectionEnabled: true }).ratioOffsetCorrectionEnabled, true);
assert.equal(modules.state.normalizeSettings({ ratioOffsetCorrectionEnabled: "true" }).ratioOffsetCorrectionEnabled, false);

assert.deepEqual(correction.computeSquareTransform(1600, 900), {
  originalWidth: 1600,
  originalHeight: 900,
  squareSize: 1600,
  offsetX: 0,
  offsetY: 350,
  retainedAreaRatio: 0.5625
});
assert.equal(correction.isSquareMarker("1:1"), true);
assert.equal(correction.isSquareMarker("1024x1024"), true);
assert.equal(correction.isSquareMarker("16:9"), false);

const paddedMain = await correction.padImageToSquare({
  dataUrl: "data:image/jpeg;base64,main",
  mimeType: "image/jpeg",
  width: 1600,
  height: 900
}, { mode: "edge" });
assert.equal(paddedMain.transform.squareSize, 1600);
assert.equal(paddedMain.transform.offsetY, 350);
assert.equal(paddedMain.value.width, 1600);
assert.equal(paddedMain.value.height, 1600);
assert.equal(paddedMain.value.mimeType, "image/jpeg");
assert.ok(canvasCalls.filter(([name]) => name === "drawImage").length >= 3, "edge extension should draw padding and the source image");

const paddedMask = await correction.padImageToSquare({
  dataUrl: "data:image/png;base64,mask",
  mimeType: "image/png",
  width: 1600,
  height: 900
}, { mode: "mask", plan: paddedMain.transform });
assert.equal(paddedMask.value.mimeType, "image/png");
assert.ok(canvasCalls.some(([name]) => name === "fillRect"), "mask padding should initialize the outside area as black");

const transformCalls = [];
async function fakeTransform(value, options = {}) {
  const plan = options.plan || correction.computeSquareTransform(value.width, value.height);
  transformCalls.push({ id: value.id, mode: options.mode, plan });
  return {
    value: {
      ...value,
      dataUrl: `data:image/png;base64,${value.id}-square`,
      base64: `${value.id}-square`,
      mimeType: "image/png",
      width: plan.squareSize,
      height: plan.squareSize,
      url: ""
    },
    transform: plan
  };
}

const runningHubPayload = {
  appId: "runninghub-banana-app",
  appName: "RunningHub Banana",
  app: {
    inputs: [
      { key: "sourceImage", label: "主图", type: "image", required: true },
      { key: "maskImage", label: "蒙版", type: "image" },
      {
        key: "aspectRatio",
        label: "生成比例",
        type: "select",
        options: [
          { value: "auto", label: "Auto" },
          { value: "1:1", label: "1:1" },
          { value: "16:9", label: "16:9" }
        ]
      }
    ]
  },
  inputs: {
    sourceImage: { id: "main", dataUrl: "data:image/png;base64,main", width: 1600, height: 900 },
    maskImage: { id: "mask", dataUrl: "data:image/png;base64,mask", width: 1600, height: 900 },
    aspectRatio: "16:9"
  },
  settings: { ratioOffsetCorrectionEnabled: true }
};
const sourceDocument = { hasActiveDocument: true, documentId: 7, width: 1600, height: 900 };
const preparedRunningHub = await correction.prepareRunPayload(runningHubPayload, sourceDocument, { transformImage: fakeTransform });
assert.equal(preparedRunningHub.applied, true);
assert.equal(preparedRunningHub.payload.inputs.aspectRatio, "1:1", "forced mode must not depend on the current value being Auto");
assert.equal(preparedRunningHub.payload.inputs.sourceImage.width, 1600);
assert.equal(preparedRunningHub.payload.inputs.sourceImage.height, 1600);
assert.equal(preparedRunningHub.payload.inputs.maskImage.height, 1600);
assert.equal(preparedRunningHub.metadata.forcedAspectRatioValue, "1:1");
assert.deepEqual(preparedRunningHub.metadata.transformedInputKeys, ["sourceImage", "maskImage"]);
assert.equal(preparedRunningHub.sourceDocument.ratioOffsetCorrection.enabled, true);
assert.equal(preparedRunningHub.sourceDocument.ratioOffsetCorrection.originalWidth, 1600);
assert.deepEqual(transformCalls.map(({ id, mode }) => ({ id, mode })), [
  { id: "main", mode: "edge" },
  { id: "mask", mode: "mask" }
]);

const thirdPartyPayload = {
  provider: "grs",
  appId: modules.state.THIRD_PARTY_APP_ID,
  app: modules.state.getThirdPartyApp(),
  config: { selectedModel: "gpt-image-2" },
  inputs: {
    mainImage: { id: "portrait", dataUrl: "data:image/png;base64,portrait", width: 941, height: 1672 },
    prompt: "test",
    model: "gpt-image-2",
    aspectRatio: "941x1672",
    resolution: "1K"
  },
  settings: { ratioOffsetCorrectionEnabled: true }
};
const preparedThirdParty = await correction.prepareRunPayload(thirdPartyPayload, sourceDocument, { transformImage: fakeTransform });
assert.equal(preparedThirdParty.payload.inputs.aspectRatio, "1024x1024");
assert.equal(preparedThirdParty.metadata.offsetX, 365);
assert.equal(preparedThirdParty.metadata.offsetY, 0);

const runningHubWithoutRatioField = {
  ...runningHubPayload,
  app: { inputs: [{ key: "image", label: "图像", type: "image", required: true }] },
  inputs: { image: { id: "no-ratio", dataUrl: "data:image/png;base64,image", width: 1200, height: 800 } }
};
const preparedWithoutRatio = await correction.prepareRunPayload(runningHubWithoutRatioField, sourceDocument, { transformImage: fakeTransform });
assert.equal(preparedWithoutRatio.applied, true);
assert.equal(preparedWithoutRatio.metadata.forcedAspectRatioValue, "");
assert.equal(preparedWithoutRatio.metadata.ratioFieldDetected, false);

const disabled = await correction.prepareRunPayload({ ...runningHubPayload, settings: {} }, sourceDocument, { transformImage: fakeTransform });
assert.equal(disabled.applied, false);
assert.equal(disabled.reason, "disabled");

const workspaceSource = await readFile(new URL("../src/webview/workspace.js", import.meta.url), "utf8");
const settingsSource = await readFile(new URL("../src/webview/settings.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../app.html", import.meta.url), "utf8");
assert.match(workspaceSource, /fitMode: ratioOffsetCorrection \? "cover"/);
assert.match(workspaceSource, /prepareRunPayload\(payload, sourceDocument\)/);
assert.match(settingsSource, /ratioOffsetCorrectionEnabled: nextSettings\.ratioOffsetCorrectionEnabled/);
assert.match(htmlSource, /id="settingsRatioOffsetCorrectionInput"/);
assert.match(htmlSource, /强制以 1:1 运行并裁回原比例/);

console.log("Forced square ratio offset correction checks passed.");
