import assert from "node:assert/strict";

import {
  GRS_CHAT_MODEL_IDS,
  GRS_IMAGE_MODEL_IDS,
  getGrsApiUrl,
  getGrsImageModelCapabilities,
  normalizeGrsRegion
} from "../src/shared/grs-config.js";
import {
  buildThirdPartyGrsImageRequest,
  fetchThirdPartyGrsAccountStatus,
  listThirdPartyGrsModels
} from "../src/host/third-party-grs.js";

assert.equal(normalizeGrsRegion("cn"), "cn");
assert.equal(normalizeGrsRegion("global"), "global");
assert.equal(normalizeGrsRegion("", "https://grsai.dakka.com.cn/v1/draw/nano-banana"), "cn");
assert.equal(normalizeGrsRegion("", "https://grsaiapi.com/v1/draw/nano-banana"), "global");
assert.equal(getGrsApiUrl("cn"), "https://grsai.dakka.com.cn");
assert.equal(getGrsApiUrl("global"), "https://grsaiapi.com");

assert.ok(GRS_IMAGE_MODEL_IDS.includes("nano-banana-2-2k-cl"));
assert.ok(GRS_IMAGE_MODEL_IDS.includes("nano-banana-2-lite"));
assert.ok(GRS_CHAT_MODEL_IDS.includes("gemini-3.5-flash"));
assert.ok(!GRS_CHAT_MODEL_IDS.includes("gpt-5-mini"));

const modelCases = [
  ["nano-banana-2", ["1K", "2K", "4K"]],
  ["nano-banana-2-cl", ["1K"]],
  ["nano-banana-2-2k-cl", ["2K"]],
  ["nano-banana-2-4k-cl", ["4K"]],
  ["nano-banana-pro-cl", ["1K"]],
  ["nano-banana-pro-vip", ["1K", "2K"]],
  ["nano-banana-pro-4k-vip", ["4K"]]
];

for (const [model, resolutions] of modelCases) {
  assert.deepEqual(getGrsImageModelCapabilities(model).resolutions, resolutions, model);
}

const banana2Capabilities = getGrsImageModelCapabilities("nano-banana-2");
for (const ratio of ["5:4", "4:5", "1:4", "4:1", "1:8", "8:1"]) {
  assert.ok(banana2Capabilities.aspectRatios.includes(ratio), ratio);
}
assert.ok(!getGrsImageModelCapabilities("nano-banana-pro").aspectRatios.includes("1:8"));

const twoKRequest = buildThirdPartyGrsImageRequest({
  inputs: {
    model: "nano-banana-2-2k-cl",
    prompt: "test",
    aspectRatio: "1:8",
    resolution: "4K"
  }
});
assert.equal(twoKRequest.endpointPath, "/v1/draw/nano-banana");
assert.equal(twoKRequest.body.imageSize, "2K");
assert.equal(twoKRequest.body.aspectRatio, "1:8");
assert.equal(twoKRequest.body.webHook, "-1");
assert.equal(twoKRequest.body.cdn, undefined);

const liteRequest = buildThirdPartyGrsImageRequest({
  inputs: {
    model: "nano-banana-2-lite",
    prompt: "test",
    aspectRatio: "5:4",
    resolution: "4K"
  }
});
assert.equal(liteRequest.body.imageSize, undefined);
assert.equal(liteRequest.body.aspectRatio, "5:4");

const gptRequest = buildThirdPartyGrsImageRequest({
  inputs: {
    model: "gpt-image-2",
    prompt: "test",
    aspectRatio: "1774x887",
    resolution: "4K"
  }
});
assert.equal(gptRequest.endpointPath, "/v1/draw/completions");
assert.equal(gptRequest.body.aspectRatio, "auto");
assert.equal(gptRequest.body.imageSize, undefined);
assert.equal(gptRequest.body.cdn, undefined);

const builtinModels = await listThirdPartyGrsModels([{ kind: "image" }]);
assert.equal(builtinModels.source, "builtin");
assert.deepEqual(builtinModels.models, GRS_IMAGE_MODEL_IDS);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  assert.equal(String(url), "https://grsai.dakka.com.cn/client/common/getCredits?apikey=sk-test");
  assert.equal(options.method, "GET");
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: 0, data: { credits: 12345.5 }, msg: "success" })
  };
};
try {
  const account = await fetchThirdPartyGrsAccountStatus([{
    config: { apiKey: "sk-test", apiUrl: "https://grsai.dakka.com.cn" },
    region: "cn",
    timeoutMs: 1000
  }]);
  assert.equal(account.balance, 12345.5);
  assert.equal(account.balanceDisplay, "12,345.5");
  assert.equal(account.secondaryDisplay, "积分");
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.window = {};
await import("../src/webview/state.js");
const stateModule = globalThis.window.PixelRunnerModules.state;
assert.equal(stateModule.DEFAULT_THIRD_PARTY_SETTINGS.grs.region, "cn");
assert.equal(stateModule.DEFAULT_THIRD_PARTY_SETTINGS.grs.apiUrl, "https://grsai.dakka.com.cn");

const migratedGlobal = stateModule.normalizeThirdPartySettings({
  enabled: true,
  grs: {
    apiUrl: "https://grsaiapi.com",
    selectedModel: "nano-banana-2-2k-cl",
    resolution: "4K"
  }
});
assert.equal(migratedGlobal.grs.region, "global");
assert.equal(migratedGlobal.grs.apiUrl, "https://grsaiapi.com");
assert.equal(migratedGlobal.grs.resolution, "2K");
assert.ok(migratedGlobal.grs.imageModels.includes("nano-banana-2-lite"));

const migratedCn = stateModule.normalizeThirdPartySettings({
  grs: { apiUrl: "https://grsai.dakka.com.cn/v1/draw/nano-banana" }
});
assert.equal(migratedCn.grs.region, "cn");
assert.equal(migratedCn.grs.apiUrl, "https://grsai.dakka.com.cn");

console.log("GRS region, model catalog, capabilities, and request contract checks passed.");
