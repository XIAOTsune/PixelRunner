import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  cancelLocalUpscaleJob,
  getLocalUpscaleHealth,
  getLocalUpscaleJob,
  LOCAL_UPSCALE_BUILD_ID,
  LOCAL_UPSCALE_PROTOCOL_VERSION,
  normalizeLocalUpscaleBaseUrl,
  normalizeLocalUpscaleJob,
  recordLocalUpscalePlacement,
  stopLocalUpscaleEngine,
  submitLocalUpscaleJob
} from "../src/host/local-upscale.js";
import { resolveLocalUpscaleCapturePlan } from "../src/host/photoshop/service.js";
import { buildLocalUpscalePlacementPayload } from "../src/host/photoshop-bridge.js";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const hiddenLauncher = await readFile(new URL("../local-ai/start-local-ai.vbs", import.meta.url), "utf8");
const localService = await readFile(new URL("../local-ai/server.py", import.meta.url), "utf8");
const localUpscaleWebview = await readFile(new URL("../src/webview/local-upscale.js", import.meta.url), "utf8");
const localUpscaleShell = await readFile(new URL("../src/host/shell.js", import.meta.url), "utf8");
const photoshopBridge = await readFile(new URL("../src/host/photoshop-bridge.js", import.meta.url), "utf8");
const photoshopService = await readFile(new URL("../src/host/photoshop/service.js", import.meta.url), "utf8");
assert.equal(manifest.requiredPermissions.network.domains, "all");
assert.ok(manifest.requiredPermissions.launchProcess.extensions.includes(".vbs"));
assert.ok(manifest.requiredPermissions.launchProcess.extensions.includes(".app"));
assert.match(hiddenLauncher, /IsServiceCompatible/);
assert.match(hiddenLauncher, /pyw -3/);
assert.match(localService, /NATIVE_MODEL_SCALE = 4/);
assert.match(localService, /"-s", str\(NATIVE_MODEL_SCALE\)/);
assert.match(localService, /"-t", str\(job\.tile\)/);
assert.match(localService, /ENGINE_SCALE_POLICY = "native-cli-tile-x4-only"/);
assert.match(localService, /png_contains_visible_pixels/);
assert.match(localService, /VULKAN_FAILURE_PATTERN/);
assert.match(localService, /build_native_tile_coordinates/);
assert.match(localService, /engine-output\.png/);
assert.match(localService, /metadata\.json/);
assert.match(localService, /protocolVersion/);
assert.match(localService, /\/v1\/shutdown/);
assert.match(localUpscaleWebview, /localUpscale\.stopEngine/);
assert.match(localUpscaleWebview, /pagehide/);
assert.match(localUpscaleWebview, /if \(!isCurrentEngineSession\(sessionId\)\) return;/);
assert.match(localUpscaleShell, /PixelRunner Local AI\.app/);
assert.match(hiddenLauncher, /IsServiceCompatible/);
assert.match(hiddenLauncher, /PixelRunnerV2\.7\.3-local-ai-native-cli/);
assert.match(localUpscaleWebview, /photoshop\.placeLocalUpscaleResult/);
assert.match(localUpscaleWebview, /scale: 1/);
assert.match(photoshopBridge, /placeLocalUpscaleResultIntoPhotoshop/);
assert.match(photoshopBridge, /cleanupLocalSource: true/);
assert.match(photoshopBridge, /超分 x4（选区）/);
assert.match(photoshopService, /selectionMaskFeather/);
assert.match(photoshopService, /Reload the original channel/);
assert.match(photoshopService, /`PR-S-\$\{fileKey\}`/);
assert.match(photoshopService, /`PR-U-\$\{fileKey\}\.png`/);
assert.doesNotMatch(photoshopService, /pixelrunner-local-upscale-result-/);
assert.doesNotMatch(localService, /SUPPORTED_SCALES = \{2, 4\}/);
assert.doesNotMatch(localUpscaleWebview, /data-local-upscale-scale/);
const runJobSource = localService.slice(localService.indexOf("    def _run_job"), localService.indexOf("\ndef read_png_dimensions"));
assert.doesNotMatch(runJobSource, /_prepare_external_tiles|_stitch_external_tile_outputs/);

const fullCanvasPlan = resolveLocalUpscaleCapturePlan({
  mode: "auto",
  document: { width: 6000, height: 4000, selectionBounds: null }
});
assert.deepEqual(fullCanvasPlan.captureBounds, { left: 0, top: 0, right: 6000, bottom: 4000 });
assert.equal(fullCanvasPlan.captureMode, "full");

const rectangularSelectionPlan = resolveLocalUpscaleCapturePlan({
  mode: "auto",
  document: { width: 6000, height: 4000, selectionBounds: { left: 1100, top: 900, right: 1700, bottom: 1400 } }
});
assert.equal(rectangularSelectionPlan.captureMode, "selection");
assert.deepEqual(rectangularSelectionPlan.selectionBounds, { left: 1100, top: 900, right: 1700, bottom: 1400 });
assert.ok(rectangularSelectionPlan.padding >= 64);
assert.ok(rectangularSelectionPlan.captureBounds.left < rectangularSelectionPlan.selectionBounds.left);
assert.ok(rectangularSelectionPlan.captureBounds.right > rectangularSelectionPlan.selectionBounds.right);

const edgeSelectionPlan = resolveLocalUpscaleCapturePlan({
  mode: "selection",
  document: { width: 1000, height: 800, selectionBounds: { left: 0, top: 4, right: 90, bottom: 120 } }
});
assert.equal(edgeSelectionPlan.captureBounds.left, 0);
assert.equal(edgeSelectionPlan.captureBounds.top, 0);
assert.ok(edgeSelectionPlan.captureBounds.right <= 1000);
assert.ok(edgeSelectionPlan.captureBounds.bottom <= 800);
assert.throws(
  () => resolveLocalUpscaleCapturePlan({ mode: "selection", document: { width: 1000, height: 800, selectionBounds: null } }),
  /有效.*选区/
);
assert.equal(resolveLocalUpscaleCapturePlan({
  mode: "auto",
  document: { width: 1000, height: 800, selectionBounds: { left: 0, top: 0, right: 1000, bottom: 800 } }
}).captureMode, "full");

const maskedPlacement = buildLocalUpscalePlacementPayload({
  filePath: "C:\\temp\\output.png",
  taskId: "local-upscale-test",
  targetDocumentId: 7,
  targetWidth: 6000,
  targetHeight: 4000,
  targetBounds: rectangularSelectionPlan.captureBounds,
  captureMode: "selection",
  selectionSnapshotChannelName: "PixelRunner selection snapshot",
  restoreActiveLayerId: 42
});
assert.deepEqual(maskedPlacement.targetBounds, rectangularSelectionPlan.captureBounds);
assert.equal(maskedPlacement.applyMask, true);
assert.equal(maskedPlacement.requirePlacementMask, true);
assert.equal(maskedPlacement.selectionMaskFeather, 24);
assert.equal(maskedPlacement.restoreActiveLayerId, 42);
assert.equal(maskedPlacement.layerName, "超分 x4（选区）");

assert.equal(normalizeLocalUpscaleBaseUrl(), "http://127.0.0.1:17836");
assert.equal(normalizeLocalUpscaleBaseUrl("http://localhost:19001/"), "http://localhost:19001");
assert.throws(() => normalizeLocalUpscaleBaseUrl("https://example.com"), /仅允许/);
assert.throws(() => normalizeLocalUpscaleBaseUrl("http://192.168.1.2:17836"), /仅允许/);

assert.deepEqual(
  normalizeLocalUpscaleJob({
    jobId: "local-upscale-test",
    inputPath: "C:\\temp\\input.png",
    outputPath: "C:\\temp\\output.png",
    scale: 1,
    tile: 256,
    tta: true,
    debug: false,
    targetWidth: 0,
    targetHeight: 0,
    protocolVersion: LOCAL_UPSCALE_PROTOCOL_VERSION,
    buildId: LOCAL_UPSCALE_BUILD_ID
  }),
  {
    jobId: "local-upscale-test",
    inputPath: "C:\\temp\\input.png",
    outputPath: "C:\\temp\\output.png",
    scale: 1,
    tile: 256,
    tta: true,
    debug: false,
    targetWidth: 0,
    targetHeight: 0,
    protocolVersion: LOCAL_UPSCALE_PROTOCOL_VERSION,
    buildId: LOCAL_UPSCALE_BUILD_ID
  }
);
assert.throws(
  () => normalizeLocalUpscaleJob({ jobId: "bad", inputPath: "a", outputPath: "b", scale: 4 }),
  /任务编号/
);
assert.equal(
  normalizeLocalUpscaleJob({
    jobId: "local-upscale-test",
    inputPath: "C:\\temp\\input.png",
    outputPath: "C:\\temp\\output.png",
    scale: 1,
    tile: 0
  }).tile,
  128
);
assert.throws(
  () => normalizeLocalUpscaleJob({ jobId: "local-upscale-test", inputPath: "a", outputPath: "b", scale: 2 }),
  /完整画布/
);

const isolatedA = normalizeLocalUpscaleJob({
  jobId: "local-upscale-isolated-a",
  inputPath: "C:\\temp\\input-a.png",
  outputPath: "C:\\temp\\output-a.png",
  scale: 1,
  tile: 128
});
const isolatedB = normalizeLocalUpscaleJob({
  jobId: "local-upscale-isolated-b",
  inputPath: "C:\\temp\\input-b.png",
  outputPath: "C:\\temp\\output-b.png",
  scale: 1,
  tile: 128
});
assert.notEqual(isolatedA.outputPath, isolatedB.outputPath);

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  const path = new URL(String(url)).pathname;
  const responseByPath = {
    "/v1/health": { ok: true, ready: true, model: "realesrgan-x4plus", gpuName: "Test GPU", protocolVersion: LOCAL_UPSCALE_PROTOCOL_VERSION, buildId: LOCAL_UPSCALE_BUILD_ID },
    "/v1/shutdown": { ok: true, shuttingDown: true, protocolVersion: LOCAL_UPSCALE_PROTOCOL_VERSION, buildId: LOCAL_UPSCALE_BUILD_ID },
    "/v1/jobs": { ok: true, jobId: "local-upscale-test", status: "queued", protocolVersion: LOCAL_UPSCALE_PROTOCOL_VERSION, buildId: LOCAL_UPSCALE_BUILD_ID },
    "/v1/jobs/local-upscale-test": { ok: true, jobId: "local-upscale-test", status: "succeeded", resultPath: "C:\\temp\\output.png", protocolVersion: LOCAL_UPSCALE_PROTOCOL_VERSION, buildId: LOCAL_UPSCALE_BUILD_ID },
    "/v1/jobs/local-upscale-test/cancel": { ok: true, jobId: "local-upscale-test", status: "cancelled", protocolVersion: LOCAL_UPSCALE_PROTOCOL_VERSION, buildId: LOCAL_UPSCALE_BUILD_ID },
    "/v1/jobs/local-upscale-test/placement": { ok: true, jobId: "local-upscale-test", status: "succeeded", protocolVersion: LOCAL_UPSCALE_PROTOCOL_VERSION, buildId: LOCAL_UPSCALE_BUILD_ID }
  };
  return {
    ok: true,
    status: 200,
    async json() {
      return responseByPath[path] || {};
    }
  };
};

try {
  const health = await getLocalUpscaleHealth();
  assert.equal(health.ready, true);
  assert.equal(health.baseUrl, "http://127.0.0.1:17836");

  const stopped = await stopLocalUpscaleEngine();
  assert.equal(stopped.shuttingDown, true);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(JSON.parse(calls[1].options.body).protocolVersion, LOCAL_UPSCALE_PROTOCOL_VERSION);

  const submitted = await submitLocalUpscaleJob([{
    jobId: "local-upscale-test",
    inputPath: "C:\\temp\\input.png",
    outputPath: "C:\\temp\\output.png",
    scale: 1,
    tile: 128
  }]);
  assert.equal(submitted.status, "queued");
  assert.equal(calls[2].options.method, "POST");
  assert.equal(JSON.parse(calls[2].options.body).scale, 1);
  assert.equal(JSON.parse(calls[2].options.body).tile, 128);
  assert.equal(JSON.parse(calls[2].options.body).protocolVersion, LOCAL_UPSCALE_PROTOCOL_VERSION);
  assert.equal(JSON.parse(calls[2].options.body).buildId, LOCAL_UPSCALE_BUILD_ID);

  const job = await getLocalUpscaleJob([{ jobId: "local-upscale-test" }]);
  assert.equal(job.status, "succeeded");
  assert.equal(job.resultUrl, "http://127.0.0.1:17836/v1/jobs/local-upscale-test/result");

  const cancelled = await cancelLocalUpscaleJob([{ jobId: "local-upscale-test" }]);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(calls[4].options.method, "POST");

  const placement = await recordLocalUpscalePlacement([{
    jobId: "local-upscale-test",
    width: 6000,
    height: 4000,
    layerId: 42,
    documentId: 7
  }]);
  assert.equal(placement.status, "succeeded");
  assert.equal(calls[5].options.method, "POST");
  assert.equal(JSON.parse(calls[5].options.body).width, 6000);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Local upscale bridge tests passed.");
