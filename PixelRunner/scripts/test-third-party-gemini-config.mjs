import assert from "node:assert/strict";

import {
  GEMINI_MODEL_CATALOG_VERSION,
  GEMINI_CHANNEL_PRESETS,
  buildGeminiGenerateRequest,
  buildGeminiModelsRequest,
  buildNewApiChatRequest,
  buildNewApiModelsRequest,
  buildNewApiPricingRequest,
  classifyNewApiModels,
  getGeminiChannelModelDefaults,
  getGeminiChannelPreset,
  isLikelyGeminiImageModel,
  isLikelyTextGenerationModel,
  normalizeGeminiFailure,
  normalizeGeminiSettings,
  parseGeminiImageResponse,
  parseGeminiModelsResponse,
  parseGeminiTextResponse,
  parseNewApiChatResponse,
  parseNewApiModelsResponse,
  parseNewApiPricingResponse,
  MOMO_SERVICE_ENDPOINTS,
  MOMO_DEFAULT_API_URL,
  normalizeMomoEndpoint
} from "../src/shared/gemini-config.js";
import {
  cancelThirdPartyGeminiTask,
  checkThirdPartyGeminiEndpoint,
  fetchThirdPartyGeminiAccountStatus,
  fetchThirdPartyGeminiTaskCharge,
  listThirdPartyGeminiModels,
  pollThirdPartyGeminiTask,
  runThirdPartyGeminiPromptOptimize,
  submitThirdPartyGeminiTask
} from "../src/host/third-party-gemini.js";

assert.equal(getGeminiChannelPreset("aji").apiUrl, "https://ai.ajiai.top");
assert.equal(getGeminiChannelPreset("momo").apiUrl, "https://api.momoapi.icu");
assert.equal(getGeminiChannelPreset("unknown").id, "aji");
assert.deepEqual(Object.keys(GEMINI_CHANNEL_PRESETS), ["aji", "momo"]);
assert.ok(getGeminiChannelModelDefaults("aji").imageModels.includes("nano-banana-2-4k"));
assert.ok(getGeminiChannelModelDefaults("aji").imageModels.includes("WJbanana2-1K"));
assert.ok(getGeminiChannelModelDefaults("aji").imageModels.includes("WJbanana2-1k"));
assert.ok(getGeminiChannelModelDefaults("aji").chatModels.includes("gpt-5.6-sol"));
assert.ok(getGeminiChannelModelDefaults("momo").imageModels.includes("[yu]gemini-3.1-flash-lite-image"));
assert.ok(getGeminiChannelModelDefaults("momo").chatModels.includes("[文本]gemini-3.5-flash"));
assert.ok(getGeminiChannelModelDefaults("momo").chatModels.includes("[YZ-k]claude-opus-4-8"));
assert.ok(getGeminiChannelModelDefaults("momo").chatModels.includes("tsc1-gpt-5.6-terra"));
assert.equal(getGeminiChannelModelDefaults("aji").imageModels.length, 40);
assert.equal(getGeminiChannelModelDefaults("aji").chatModels.length, 5);
assert.equal(getGeminiChannelModelDefaults("momo").imageModels.length, 6);
assert.equal(getGeminiChannelModelDefaults("momo").chatModels.length, 19);

const migrated = normalizeGeminiSettings({
  channelId: "momo",
  apiUrl: "https://wrong.example/v1beta",
  apiKey: " momo-key ",
  imageModels: ["models/custom-image"],
  selectedModel: "models/custom-image",
  aspectRatio: "16:9",
  resolution: "2k",
  channels: { aji: { apiKey: "aji-key", selectedModel: "aji-image" } }
});
assert.equal(migrated.channelId, "momo");
assert.equal(migrated.apiUrl, "https://api.momoapi.icu");
assert.equal(migrated.apiKey, "momo-key");
assert.equal(migrated.selectedModel, "custom-image");
assert.equal(migrated.resolution, "2K");
assert.equal(migrated.channels.aji.apiKey, "aji-key");
assert.equal(migrated.channels.aji.selectedModel, "aji-image");
assert.equal(migrated.channels.aji.modelCatalogVersion, GEMINI_MODEL_CATALOG_VERSION);
assert.ok(migrated.channels.aji.imageModels.includes("AJbanana3-4k"));
assert.ok(migrated.channels.momo.chatModels.includes("[文本]gemini-3-flash"));

const upgradedLegacyDefaults = normalizeGeminiSettings({
  channelId: "momo",
  selectedModel: "gemini-3-pro-image-preview",
  chatModel: "gemini-2.5-flash"
});
assert.equal(upgradedLegacyDefaults.selectedModel, "[c]gemini-3-pro-image-preview");
assert.equal(upgradedLegacyDefaults.chatModel, "[文本]gemini-3-flash");

const modelsRequest = buildGeminiModelsRequest({ apiUrl: "https://ai.ajiai.top/", apiKey: "secret" });
assert.equal(modelsRequest.url, "https://ai.ajiai.top/v1beta/models");
assert.equal(modelsRequest.options.headers.Authorization, "Bearer secret");

const openAiModelsRequest = buildNewApiModelsRequest({ apiUrl: "https://ai.ajiai.top/", apiKey: "secret" });
assert.equal(openAiModelsRequest.url, "https://ai.ajiai.top/v1/models");
assert.equal(openAiModelsRequest.options.headers.Authorization, "Bearer secret");
assert.equal(buildNewApiPricingRequest({ apiUrl: "https://api.momoapi.icu" }).url, "https://api.momoapi.icu/api/pricing");

const generateRequest = buildGeminiGenerateRequest({
  apiUrl: "https://api.momoapi.icu",
  apiKey: "secret",
  model: "models/gemini-image",
  prompt: "test prompt",
  images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
  aspectRatio: "1:1",
  resolution: "2K"
});
assert.equal(generateRequest.url, "https://api.momoapi.icu/v1beta/models/gemini-image:generateContent");
assert.equal(generateRequest.body.contents[0].parts[0].text, "test prompt");
assert.equal(generateRequest.body.contents[0].parts[1].inlineData.data, "aGVsbG8=");
assert.deepEqual(generateRequest.body.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
assert.deepEqual(generateRequest.body.generationConfig.imageConfig, { aspectRatio: "1:1", imageSize: "2K" });

const textRequest = buildGeminiGenerateRequest({ model: "gemini-text", prompt: "test", responseModalities: ["TEXT"] });
assert.equal(textRequest.body.generationConfig.imageConfig, undefined);

const chatRequest = buildNewApiChatRequest({
  apiUrl: "https://ai.ajiai.top",
  apiKey: "secret",
  model: "gpt-5.6-sol",
  prompt: "test",
  systemInstruction: "optimize"
});
assert.equal(chatRequest.url, "https://ai.ajiai.top/v1/chat/completions");
assert.equal(chatRequest.body.model, "gpt-5.6-sol");
assert.deepEqual(chatRequest.body.messages, [
  { role: "system", content: "optimize" },
  { role: "user", content: "test" }
]);

assert.deepEqual(
  parseGeminiModelsResponse({ models: [{ name: "models/a", displayName: "A" }, { name: "a" }, { id: "b" }] }).map((item) => item.id),
  ["a", "b"]
);
assert.equal(parseGeminiTextResponse({ candidates: [{ content: { parts: [{ text: "hello " }, { text: "world" }] } }] }), "hello world");
assert.deepEqual(parseNewApiModelsResponse({ data: [{ id: "image-model" }, { id: "image-model" }, { id: "chat-model" }] }).map((item) => item.id), ["image-model", "chat-model"]);
assert.deepEqual(parseNewApiPricingResponse({ data: [{ model_name: "image-model", supported_endpoint_types: ["gemini", "openai"] }] })[0].supportedEndpointTypes, ["gemini", "openai"]);
assert.equal(parseNewApiChatResponse({ choices: [{ message: { content: "optimized" } }] }), "optimized");
assert.equal(isLikelyGeminiImageModel("AJbanana2-4k"), true);
assert.equal(isLikelyTextGenerationModel("[文本]gemini-3.5-flash"), true);
assert.equal(isLikelyTextGenerationModel("gemini-3.1-flash-image-preview"), false);

const classifiedModels = classifyNewApiModels({
  openAiModels: [{ id: "AJbanana2-4k" }, { id: "gpt-5.6-sol" }, { id: "veo-3.1" }],
  geminiModels: [{ id: "AJbanana2-4k", supportedGenerationMethods: ["generateContent"] }],
  pricingModels: [
    { id: "AJbanana2-4k", supportedEndpointTypes: ["gemini", "openai"] },
    { id: "gpt-5.6-sol", supportedEndpointTypes: ["openai"] }
  ]
});
assert.deepEqual(classifiedModels.imageModels, ["AJbanana2-4k"]);
assert.deepEqual(classifiedModels.chatModels, ["gpt-5.6-sol"]);

const parsedImages = parseGeminiImageResponse({
  candidates: [
    { content: { parts: [{ inlineData: { mimeType: "image/png", data: "aaa" } }] } },
    { content: { parts: [{ inline_data: { mime_type: "image/jpeg", data: "bbb" } }] } }
  ]
});
assert.equal(parsedImages.images.length, 2);
assert.equal(parsedImages.image.dataUrl, "data:image/png;base64,aaa");
assert.equal(parsedImages.images[1].mimeType, "image/jpeg");

assert.equal(normalizeGeminiFailure({ status: 401 }).code, "auth");
assert.equal(normalizeGeminiFailure({ status: 429 }).code, "rate-limit");
assert.equal(normalizeGeminiFailure({ status: 503, rawText: "upstream failed" }).code, "service");
assert.equal(normalizeGeminiFailure({ timedOut: true }).code, "timeout");
assert.equal(normalizeGeminiFailure({ json: { promptFeedback: { blockReason: "SAFETY" } } }).code, "safety");
assert.ok(!normalizeGeminiFailure({ status: 500, rawText: "Bearer super-secret" }).message.includes("super-secret"));
assert.ok(!normalizeGeminiFailure({ status: 500, rawText: "upstream echoed abc-123", apiKey: "abc-123" }).message.includes("abc-123"));

// Momo endpoint whitelist
assert.equal(MOMO_SERVICE_ENDPOINTS.length, 3);
assert.equal(MOMO_SERVICE_ENDPOINTS[0].url, "https://api.momoapi.icu");
assert.equal(MOMO_SERVICE_ENDPOINTS[1].url, "https://api1.momoapi.icu");
assert.equal(MOMO_SERVICE_ENDPOINTS[2].url, "https://api2.momoapi.icu");
assert.equal(MOMO_DEFAULT_API_URL, "https://api.momoapi.icu");

assert.equal(normalizeMomoEndpoint("https://api.momoapi.icu"), "https://api.momoapi.icu");
assert.equal(normalizeMomoEndpoint("https://api1.momoapi.icu"), "https://api1.momoapi.icu");
assert.equal(normalizeMomoEndpoint("https://api2.momoapi.icu"), "https://api2.momoapi.icu");
assert.equal(normalizeMomoEndpoint("https://api.momoapi.icu/"), "https://api.momoapi.icu");
assert.equal(normalizeMomoEndpoint("https://api1.momoapi.icu/"), "https://api1.momoapi.icu");
assert.equal(normalizeMomoEndpoint("https://api2.momoapi.icu/"), "https://api2.momoapi.icu");
assert.equal(normalizeMomoEndpoint("https://evil.example.com"), MOMO_DEFAULT_API_URL);
assert.equal(normalizeMomoEndpoint(""), MOMO_DEFAULT_API_URL);
assert.equal(normalizeMomoEndpoint("  "), MOMO_DEFAULT_API_URL);

// normalizeGeminiSettings preserves Momo user-chosen apiUrl
const momoCustomSettings = normalizeGeminiSettings({
  channelId: "momo",
  channels: {
    momo: { apiUrl: "https://api2.momoapi.icu", apiKey: "momo-key", selectedModel: "model-a" }
  }
});
assert.equal(momoCustomSettings.channelId, "momo");
assert.equal(momoCustomSettings.apiUrl, "https://api2.momoapi.icu");
assert.equal(momoCustomSettings.channels.momo.apiUrl, "https://api2.momoapi.icu");

// Old momo config without apiUrl defaults to default
const oldMomoSettings = normalizeGeminiSettings({
  channelId: "momo",
  channels: { momo: { apiKey: "old-key" } }
});
assert.equal(oldMomoSettings.channels.momo.apiUrl, MOMO_DEFAULT_API_URL);
assert.equal(oldMomoSettings.apiUrl, MOMO_DEFAULT_API_URL);

// Aji channel ignores custom apiUrl
const ajiCustomSettings = normalizeGeminiSettings({
  channelId: "aji",
  channels: { aji: { apiUrl: "https://custom.example.com", apiKey: "aji-key", selectedModel: "model-b" } }
});
assert.equal(ajiCustomSettings.channelId, "aji");
assert.equal(ajiCustomSettings.apiUrl, "https://ai.ajiai.top");
assert.equal(ajiCustomSettings.channels.aji.apiUrl, "https://ai.ajiai.top");

// Build requests use Momo current apiUrl
const momoGenReq = buildGeminiGenerateRequest({
  apiUrl: "https://api2.momoapi.icu", apiKey: "secret", model: "gemini-image", prompt: "hello"
});
assert.equal(momoGenReq.url, "https://api2.momoapi.icu/v1beta/models/gemini-image:generateContent");

const momoNewApiReq = buildNewApiModelsRequest({ apiUrl: "https://api1.momoapi.icu", apiKey: "key" });
assert.equal(momoNewApiReq.url, "https://api1.momoapi.icu/v1/models");

const momoPricingReq = buildNewApiPricingRequest({ apiUrl: "https://api2.momoapi.icu" });
assert.equal(momoPricingReq.url, "https://api2.momoapi.icu/api/pricing");

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    if (requestUrl.endsWith("/api/pricing")) {
      assert.equal(options.headers.Authorization, undefined);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [
          { model_name: "AJbanana2-4k", supported_endpoint_types: ["gemini", "openai"] },
          { model_name: "gpt-5.6-sol", supported_endpoint_types: ["openai"] }
        ] })
      };
    }
    assert.equal(options.headers.Authorization, "Bearer model-key");
    if (requestUrl.endsWith("/v1/models")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [
          { id: "AJbanana2-4k" },
          { id: "gpt-5.6-sol" },
          { id: "veo-3.1" }
        ] })
      };
    }
    assert.equal(requestUrl, "https://ai.ajiai.top/v1beta/models");
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ models: [
        { name: "models/AJbanana2-4k", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding", supportedGenerationMethods: ["embedContent"] }
      ] })
    };
  };
  const listed = await listThirdPartyGeminiModels([{ config: { apiUrl: "https://ai.ajiai.top", apiKey: "model-key" } }]);
  assert.deepEqual(listed.models, ["AJbanana2-4k", "gpt-5.6-sol", "veo-3.1"]);
  assert.deepEqual(listed.imageModels, ["AJbanana2-4k"]);
  assert.deepEqual(listed.chatModels, ["gpt-5.6-sol"]);
  assert.deepEqual(listed.endpoints, { openai: true, gemini: true, pricing: true });

  globalThis.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body);
    assert.equal(String(url), "https://api.momoapi.icu/v1/chat/completions");
    assert.equal(body.model, "[文本]gemini-3-flash");
    assert.equal(body.messages[1].content, "original prompt");
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "optimized prompt" } }] })
    };
  };
  const optimized = await runThirdPartyGeminiPromptOptimize([{
    config: { apiUrl: "https://api.momoapi.icu", apiKey: "text-key", chatModel: "[文本]gemini-3-flash" },
    prompt: "original prompt",
    timeoutMs: 1000
  }]);
  assert.equal(optimized.text, "optimized prompt");

  globalThis.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body);
    assert.equal(body.contents[0].parts[0].text, "draw this");
    assert.equal(body.contents[0].parts[1].inlineData.data, "aW5wdXQ=");
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/png", data: "b3V0cHV0" } }] } }] })
    };
  };
  const submitted = await submitThirdPartyGeminiTask([{
    config: { apiUrl: "https://api.momoapi.icu", apiKey: "image-key", selectedModel: "gemini-image" },
    inputs: {
      model: "gemini-image",
      prompt: "draw this",
      mainImage: { mimeType: "image/png", base64: "aW5wdXQ=" },
      aspectRatio: "1:1",
      resolution: "1K"
    },
    timeoutMs: 1000
  }]);
  assert.match(submitted.taskId, /^gemini-job-/);
  assert.equal(submitted.status, "RUNNING");
  assert.equal(submitted.dataUrl, undefined);
  const polled = await pollThirdPartyGeminiTask([{ taskId: submitted.taskId, timeoutMs: 2000, settings: { pollInterval: 0.01 } }]);
  assert.equal(polled.status, "SUCCEEDED");
  assert.equal(polled.dataUrl, "data:image/png;base64,b3V0cHV0");

  globalThis.fetch = async (url, options = {}) => {
    assert.equal(options.headers.Authorization === "Bearer account-key" || options.headers.Authorization === undefined, true);
    if (String(url).endsWith("/api/status")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "" },
        text: async () => JSON.stringify({ data: { quota_display_type: "USD", quota_per_unit: 500000, usd_exchange_rate: 7.3 } })
      };
    }
    if (String(url).endsWith("/api/usage/token/")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "" },
        text: async () => JSON.stringify({ code: true, data: { total_available: 5000000, total_used: 500000, total_granted: 5500000, unlimited_quota: false } })
      };
    }
    assert.equal(String(url).endsWith("/api/log/token"), true);
    return {
      ok: true,
      status: 200,
      headers: { get: () => "" },
      text: async () => JSON.stringify({ success: true, data: [{ request_id: "provider-request-1", quota: 12500 }] })
    };
  };
  const account = await fetchThirdPartyGeminiAccountStatus([{
    channelId: "momo",
    config: { apiUrl: "https://api.momoapi.icu", apiKey: "account-key", channelId: "momo" },
    timeoutMs: 1000
  }]);
  assert.equal(account.balance, 10);
  assert.equal(account.balanceDisplay, "$10");
  assert.equal(account.usedDisplay, "$1");
  const charge = await fetchThirdPartyGeminiTaskCharge([{
    providerRequestId: "provider-request-1",
    config: { apiUrl: "https://api.momoapi.icu", apiKey: "account-key" },
    timeoutMs: 1000
  }]);
  assert.equal(charge.balanceCharge, 0.025);
  assert.equal(charge.chargeDisplay, "-$0.025");

  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: { message: "invalid key" } })
  });
  await assert.rejects(
    () => listThirdPartyGeminiModels([{ config: { apiUrl: "https://ai.ajiai.top", apiKey: "bad-key" } }]),
    /API Key 无效/
  );

  let markFetchStarted;
  const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
  globalThis.fetch = async (url, options = {}) => new Promise((resolve, reject) => {
    markFetchStarted();
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  const pendingTask = await submitThirdPartyGeminiTask([{
    requestId: "cancel-request",
    config: { apiUrl: "https://ai.ajiai.top", apiKey: "key", selectedModel: "gemini-image" },
    inputs: { model: "gemini-image", prompt: "cancel me" },
    timeoutMs: 1000
  }]);
  await fetchStarted;
  const cancelled = await cancelThirdPartyGeminiTask([{ taskId: pendingTask.taskId }]);
  assert.equal(cancelled.localRequestCancelled, true);
  assert.equal(cancelled.remoteCancelled, false);
  const cancelledResult = await pollThirdPartyGeminiTask([{ taskId: pendingTask.taskId, timeoutMs: 1000 }]);
  assert.equal(cancelledResult.status, "CANCELLED");
  assert.equal(cancelledResult.failed, true);

  globalThis.fetch = async (url, options = {}) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  await assert.rejects(
    () => listThirdPartyGeminiModels([{ config: { apiUrl: "https://ai.ajiai.top", apiKey: "key" }, timeoutMs: 100 }]),
    /请求超时/
  );
} finally {
  globalThis.fetch = originalFetch;
}

// checkThirdPartyGeminiEndpoint
{
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://api1.momoapi.icu/api/status");
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: {} })
    };
  };
  const checkOk = await checkThirdPartyGeminiEndpoint([{ apiUrl: "https://api1.momoapi.icu" }]);
  assert.equal(checkOk.ok, true);
  assert.equal(checkOk.apiUrl, "https://api1.momoapi.icu");

  globalThis.fetch = async () => {
    const error = new Error("network error");
    throw error;
  };
  const checkFail = await checkThirdPartyGeminiEndpoint([{ apiUrl: "https://api2.momoapi.icu", timeoutMs: 5000 }]);
  assert.equal(checkFail.ok, false);
  assert.ok(checkFail.message.includes("network error") || checkFail.message.includes("不可达"));
}

globalThis.window = {};
await import("../src/webview/state.js");
const stateModule = globalThis.window.PixelRunnerModules.state;
const thirdParty = stateModule.normalizeThirdPartySettings({
  enabled: true,
  provider: "gemini",
  gemini: {
    channelId: "momo",
    channels: {
      aji: { apiKey: "aji-key", selectedModel: "aji-image" },
      momo: { apiKey: "momo-key", selectedModel: "momo-image", aspectRatio: "16:9", resolution: "2K" }
    }
  }
});
assert.equal(thirdParty.provider, "gemini");
assert.equal(thirdParty.grs.apiUrl, "https://grsai.dakka.com.cn");
assert.equal(thirdParty.gemini.apiKey, "momo-key");
assert.equal(thirdParty.gemini.channels.aji.apiKey, "aji-key");
assert.equal(stateModule.getThirdPartyProviderDescriptor(thirdParty).label, "墨墨 Momo");

// Momo with custom apiUrl in descriptor
const momoCustomState = stateModule.normalizeThirdPartySettings({
  enabled: true,
  provider: "gemini",
  gemini: {
    channelId: "momo",
    channels: { momo: { apiUrl: "https://api2.momoapi.icu", apiKey: "momo-key", selectedModel: "img" } }
  }
});
assert.equal(stateModule.getThirdPartyProviderDescriptor(momoCustomState).apiUrl, "https://api2.momoapi.icu");

// Old momo without apiUrl defaults in descriptor
const momoOldState = stateModule.normalizeThirdPartySettings({
  enabled: true,
  provider: "gemini",
  gemini: {
    channelId: "momo",
    channels: { momo: { apiKey: "old-momo" } }
  }
});
assert.equal(stateModule.getThirdPartyProviderDescriptor(momoOldState).apiUrl, MOMO_DEFAULT_API_URL);

const legacyThirdParty = stateModule.normalizeThirdPartySettings({ enabled: true, grs: { apiKey: "legacy-grs-key" } });
assert.equal(legacyThirdParty.provider, "grs");
assert.equal(legacyThirdParty.grs.apiKey, "legacy-grs-key");

assert.equal(stateModule.MOMO_DEFAULT_API_URL, MOMO_DEFAULT_API_URL);
assert.equal(stateModule.MOMO_SERVICE_ENDPOINTS.length, 3);
assert.equal(stateModule.normalizeMomoEndpoint("https://api1.momoapi.icu"), "https://api1.momoapi.icu");
assert.equal(stateModule.normalizeMomoEndpoint("bad-url"), MOMO_DEFAULT_API_URL);

console.log("Gemini channel, migration, request, response, failure contract, and Momo endpoint checks passed.");
