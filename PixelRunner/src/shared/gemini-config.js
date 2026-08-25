const DEFAULT_CHANNEL_ID = "aji";
export const GEMINI_MODEL_CATALOG_VERSION = 4;

export const MOMO_MIDJOURNEY_MODEL_ID = "mj_imagine";

const LEGACY_IMAGE_MODEL_IDS = Object.freeze([
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gemini-3-pro-image-preview-1k",
  "gemini-3-pro-image-preview-2k",
  "gemini-3-pro-image-preview-4k"
]);

const LEGACY_CHAT_MODEL_IDS = Object.freeze([
  "gemini-2.5-flash",
  "gemini-3-pro-preview",
  "gemini-3-pro-preview-thinking"
]);

const AJI_IMAGE_MODEL_IDS = Object.freeze([
  "AJbanana2",
  "AJbanana2-1k",
  "AJbanana2-2k",
  "AJbanana2-4k",
  "AJbanana3",
  "AJbanana3-1k",
  "AJbanana3-2k",
  "AJbanana3-4k",
  "banana-pro",
  "banana-pro-1k",
  "banana-pro-2k",
  "banana-pro-4k",
  "Banana-pro-A-1k",
  "Banana-pro-A-2k",
  "Banana-pro-A-4k",
  "Banana-pro-D",
  "Banana-pro-D-1k",
  "Banana-pro-D-2k",
  "Banana-pro-D-4k",
  "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview",
  "gemini-3-pro-image-preview-1k",
  "gemini-3-pro-image-preview-2k",
  "gemini-3-pro-image-preview-4k",
  "gemini-3.1-flash-image-preview",
  "gemini-3.1-flash-image-preview-1k",
  "gemini-3.1-flash-image-preview-2k",
  "gemini-3.1-flash-image-preview-4k",
  "gemini-3.1-flash-lite-image",
  "nano-banana-2",
  "nano-banana-2-1k",
  "nano-banana-2-2k",
  "nano-banana-2-4k",
  "WJbanana2",
  "WJbanana2-1K",
  "WJbanana2-1k",
  "WJbanana2-2K",
  "WJbanana2-2k",
  "WJbanana2-4K",
  "WJbanana2-4k"
]);

const AJI_CHAT_MODEL_IDS = Object.freeze([
  "gpt-5.5",
  "gpt-5.5-plus",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra"
]);

const MOMO_IMAGE_MODEL_IDS = Object.freeze([
  "[c]gemini-3-pro-image-preview",
  "[c]gemini-3.1-flash-image-preview",
  "[m]gemini-3.1-flash-image-preview",
  "[yu]gemini-3-pro-image-preview",
  "[yu]gemini-3.1-flash-image-preview",
  "[yu]gemini-3.1-flash-lite-image"
]);

const MOMO_CHAT_MODEL_IDS = Object.freeze([
  "[文本]gemini-3-flash",
  "[文本]gemini-3.1-pro-preview",
  "[文本]gemini-3.5-flash",
  "[Yz-k]claude-opus-4-6",
  "[Yz-k]claude-opus-4-7",
  "[YZ-k]claude-opus-4-8",
  "[Yz]claude-opus-4-6",
  "[Yz]claude-opus-4-7",
  "[Yz]claude-opus-4-8",
  "tsc-gpt-5.4",
  "tsc-gpt-5.5",
  "tsc-gpt-5.6-luna",
  "tsc-gpt-5.6-sol",
  "tsc-gpt-5.6-terra",
  "tsc1-gpt-5.4",
  "tsc1-gpt-5.5",
  "tsc1-gpt-5.6-luna",
  "tsc1-gpt-5.6-sol",
  "tsc1-gpt-5.6-terra"
]);

export const GEMINI_CHANNEL_MODEL_DEFAULTS = Object.freeze({
  aji: Object.freeze({ imageModels: AJI_IMAGE_MODEL_IDS, chatModels: AJI_CHAT_MODEL_IDS }),
  momo: Object.freeze({ imageModels: MOMO_IMAGE_MODEL_IDS, chatModels: MOMO_CHAT_MODEL_IDS })
});

export const MOMO_SERVICE_ENDPOINTS = Object.freeze([
  Object.freeze({ url: "https://api.momoapi.icu", label: "国内优化（默认）", description: "默认地址，推荐使用" }),
  Object.freeze({ url: "https://api1.momoapi.icu", label: "国内优化（备用）", description: "备用地址" }),
  Object.freeze({ url: "https://api2.momoapi.icu", label: "无国内优化", description: "有代理时优先使用" })
]);

export const MOMO_DEFAULT_API_URL = "https://api.momoapi.icu";

export function normalizeMomoEndpoint(value) {
  const input = String(value || "").trim().replace(/\/+$/, "");
  const match = MOMO_SERVICE_ENDPOINTS.find((ep) => ep.url === input);
  return match ? match.url : MOMO_DEFAULT_API_URL;
}

export const GEMINI_CHANNEL_PRESETS = Object.freeze({
  aji: Object.freeze({
    id: "aji",
    label: "阿吉 Aji",
    apiUrl: "https://ai.ajiai.top",
    keyUrl: "https://ai.ajiai.top"
  }),
  momo: Object.freeze({
    id: "momo",
    label: "墨墨 Momo",
    apiUrl: MOMO_DEFAULT_API_URL,
    keyUrl: MOMO_DEFAULT_API_URL
  })
});

export const GEMINI_IMAGE_MODEL_IDS = Object.freeze([...new Set([...AJI_IMAGE_MODEL_IDS, ...MOMO_IMAGE_MODEL_IDS])]
  .filter((model) => !isMomoMidjourneyModel(model)));

export const GEMINI_CHAT_MODEL_IDS = Object.freeze([...new Set([...AJI_CHAT_MODEL_IDS, ...MOMO_CHAT_MODEL_IDS])]);

export const GEMINI_ASPECT_RATIOS = Object.freeze([
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "21:9"
]);

export const GEMINI_RESOLUTIONS = Object.freeze(["1K", "2K", "4K"]);

export function normalizeGeminiChannelId(value) {
  const id = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(GEMINI_CHANNEL_PRESETS, id) ? id : DEFAULT_CHANNEL_ID;
}

export function getGeminiChannelPreset(value) {
  return GEMINI_CHANNEL_PRESETS[normalizeGeminiChannelId(value)];
}

export function getGeminiChannelModelDefaults(value) {
  return GEMINI_CHANNEL_MODEL_DEFAULTS[normalizeGeminiChannelId(value)];
}

export function normalizeGeminiBaseUrl(value, channelId = DEFAULT_CHANNEL_ID) {
  const preset = getGeminiChannelPreset(channelId);
  try {
    const url = new URL(String(value || "").trim() || preset.apiUrl);
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return preset.apiUrl;
  }
}

export function normalizeGeminiModelId(value) {
  return String(value || "").trim().replace(/^models\//i, "");
}

export function isMomoMidjourneyModel(value) {
  return normalizeGeminiModelId(value).toLowerCase() === MOMO_MIDJOURNEY_MODEL_ID;
}

function normalizeStringList(value, fallback = []) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();
  const output = [];
  source.forEach((item) => {
    const model = normalizeGeminiModelId(item);
    if (!model || seen.has(model)) return;
    seen.add(model);
    output.push(model);
  });
  return output.length ? output : [...fallback];
}

function createDefaultChannelSettings(channelId) {
  const preset = getGeminiChannelPreset(channelId);
  const modelDefaults = getGeminiChannelModelDefaults(channelId);
  return {
    apiUrl: preset.apiUrl,
    apiKey: "",
    modelCatalogVersion: GEMINI_MODEL_CATALOG_VERSION,
    imageModels: [...modelDefaults.imageModels],
    chatModels: [...modelDefaults.chatModels],
    chatModel: modelDefaults.chatModels[0],
    selectedModel: channelId === "momo" ? MOMO_IMAGE_MODEL_IDS[0] : "gemini-3-pro-image-preview",
    aspectRatio: "auto",
    resolution: "1K"
  };
}

export const DEFAULT_GEMINI_SETTINGS = Object.freeze({
  channelId: DEFAULT_CHANNEL_ID,
  ...createDefaultChannelSettings(DEFAULT_CHANNEL_ID),
  channels: Object.freeze({
    aji: Object.freeze(createDefaultChannelSettings("aji")),
    momo: Object.freeze(createDefaultChannelSettings("momo"))
  })
});

function normalizeChannelApiUrl(sourceApiUrl, channelId) {
  if (channelId === "momo") {
    const stored = String(sourceApiUrl || "").trim().replace(/\/+$/, "");
    if (stored) return normalizeMomoEndpoint(stored);
    return MOMO_DEFAULT_API_URL;
  }
  return getGeminiChannelPreset(channelId).apiUrl;
}

function normalizeChannelSettings(value, channelId) {
  const source = value && typeof value === "object" ? value : {};
  const fallback = createDefaultChannelSettings(channelId);
  const shouldUpgradeCatalog = Number(source.modelCatalogVersion || 0) < GEMINI_MODEL_CATALOG_VERSION;
  const storedModel = normalizeGeminiModelId(source.selectedModel);
  const hiddenModel = isMomoMidjourneyModel(storedModel);
  const requestedModel = hiddenModel || shouldUpgradeCatalog && LEGACY_IMAGE_MODEL_IDS.includes(storedModel) && !fallback.imageModels.includes(storedModel)
    ? fallback.selectedModel
    : (storedModel || fallback.selectedModel);
  const rawImageModels = Array.isArray(source.imageModels || source.models)
    ? (source.imageModels || source.models)
    : String(source.imageModels || source.models || "").split(",");
  const imageModels = normalizeStringList(
    [
      ...(shouldUpgradeCatalog ? fallback.imageModels : []),
      ...(rawImageModels.some((item) => String(item || "").trim()) ? rawImageModels : fallback.imageModels)
        .filter((item) => !isMomoMidjourneyModel(item)),
      requestedModel
    ],
    fallback.imageModels
  );
  const storedChatModel = normalizeGeminiModelId(source.chatModel);
  const requestedChatModel = shouldUpgradeCatalog && LEGACY_CHAT_MODEL_IDS.includes(storedChatModel) && !fallback.chatModels.includes(storedChatModel)
    ? fallback.chatModel
    : (storedChatModel || fallback.chatModel);
  const rawChatModels = Array.isArray(source.chatModels) ? source.chatModels : String(source.chatModels || "").split(",");
  const chatModels = normalizeStringList(
    [
      ...(shouldUpgradeCatalog ? fallback.chatModels : []),
      ...(rawChatModels.some((item) => String(item || "").trim()) ? rawChatModels : fallback.chatModels),
      requestedChatModel
    ],
    fallback.chatModels
  );
  const requestedRatio = String(source.aspectRatio || fallback.aspectRatio).trim();
  const requestedResolution = String(source.resolution || fallback.resolution).trim().toUpperCase();
  return {
    apiUrl: normalizeChannelApiUrl(source.apiUrl, channelId),
    apiKey: String(source.apiKey || "").trim(),
    modelCatalogVersion: GEMINI_MODEL_CATALOG_VERSION,
    imageModels,
    chatModels,
    chatModel: requestedChatModel || chatModels[0] || fallback.chatModel,
    selectedModel: requestedModel || imageModels[0] || fallback.selectedModel,
    aspectRatio: GEMINI_ASPECT_RATIOS.includes(requestedRatio) ? requestedRatio : fallback.aspectRatio,
    resolution: GEMINI_RESOLUTIONS.includes(requestedResolution) ? requestedResolution : fallback.resolution
  };
}

export function normalizeGeminiSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const channelId = normalizeGeminiChannelId(source.channelId);
  const storedChannels = source.channels && typeof source.channels === "object" ? source.channels : {};
  const channels = {};
  for (const id of Object.keys(GEMINI_CHANNEL_PRESETS)) {
    const stored = storedChannels[id] && typeof storedChannels[id] === "object" ? storedChannels[id] : {};
    const activeLegacy = id === channelId ? source : {};
    channels[id] = normalizeChannelSettings({ ...activeLegacy, ...stored }, id);
  }
  const active = channels[channelId];
  return {
    channelId,
    ...active,
    channels
  };
}

function getGeminiEndpoint(apiUrl, model = "") {
  const host = normalizeGeminiBaseUrl(apiUrl);
  if (!model) return `${host}/v1beta/models`;
  return `${host}/v1beta/models/${encodeURIComponent(normalizeGeminiModelId(model))}:generateContent`;
}

function getNewApiEndpoint(apiUrl, path) {
  return `${normalizeGeminiBaseUrl(apiUrl)}${path}`;
}

function buildGeminiHeaders(apiKey) {
  return {
    Authorization: `Bearer ${String(apiKey || "").trim()}`,
    "Content-Type": "application/json"
  };
}

export function buildGeminiModelsRequest(config = {}) {
  return {
    url: getGeminiEndpoint(config.apiUrl),
    options: {
      method: "GET",
      headers: buildGeminiHeaders(config.apiKey)
    }
  };
}

export function buildNewApiModelsRequest(config = {}) {
  return {
    url: getNewApiEndpoint(config.apiUrl, "/v1/models"),
    options: {
      method: "GET",
      headers: buildGeminiHeaders(config.apiKey)
    }
  };
}

export function buildNewApiPricingRequest(config = {}) {
  return {
    url: getNewApiEndpoint(config.apiUrl, "/api/pricing"),
    options: {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    }
  };
}

export function buildNewApiChatRequest(config = {}) {
  const body = {
    model: normalizeGeminiModelId(config.model),
    messages: [],
    stream: false
  };
  const systemInstruction = String(config.systemInstruction || "").trim();
  if (systemInstruction) body.messages.push({ role: "system", content: systemInstruction });
  body.messages.push({ role: "user", content: String(config.prompt || "").trim() });
  return {
    url: getNewApiEndpoint(config.apiUrl, "/v1/chat/completions"),
    options: {
      method: "POST",
      headers: buildGeminiHeaders(config.apiKey),
      body: JSON.stringify(body)
    },
    body
  };
}

export function buildGeminiGenerateRequest(config = {}) {
  const model = normalizeGeminiModelId(config.model);
  const prompt = String(config.prompt || "").trim();
  const images = Array.isArray(config.images) ? config.images : [];
  const parts = [];
  if (prompt) parts.push({ text: prompt });
  images.forEach((image) => {
    const data = String(image && (image.data || image.base64) || "").trim();
    if (!data) return;
    parts.push({
      inlineData: {
        mimeType: String(image.mimeType || "image/png").trim() || "image/png",
        data
      }
    });
  });

  const responseModalities = Array.isArray(config.responseModalities) && config.responseModalities.length
    ? config.responseModalities.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)
    : ["TEXT", "IMAGE"];
  const generationConfig = { responseModalities };
  const aspectRatio = String(config.aspectRatio || "").trim();
  const imageSize = String(config.imageSize || config.resolution || "").trim().toUpperCase();
  if (responseModalities.includes("IMAGE") && ((aspectRatio && aspectRatio !== "auto") || imageSize)) {
    generationConfig.imageConfig = {};
    if (aspectRatio && aspectRatio !== "auto") generationConfig.imageConfig.aspectRatio = aspectRatio;
    if (GEMINI_RESOLUTIONS.includes(imageSize)) generationConfig.imageConfig.imageSize = imageSize;
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig
  };
  const systemInstruction = String(config.systemInstruction || "").trim();
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };

  return {
    url: getGeminiEndpoint(config.apiUrl, model),
    options: {
      method: "POST",
      headers: buildGeminiHeaders(config.apiKey),
      body: JSON.stringify(body)
    },
    body
  };
}

export function parseGeminiModelsResponse(value) {
  const models = value && Array.isArray(value.models) ? value.models : [];
  const seen = new Set();
  return models
    .map((item) => ({
      id: normalizeGeminiModelId(item && (item.name || item.id)),
      displayName: String(item && item.displayName || "").trim(),
      description: String(item && item.description || "").trim(),
      supportedGenerationMethods: Array.isArray(item && item.supportedGenerationMethods) ? [...item.supportedGenerationMethods] : []
    }))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

export function parseNewApiModelsResponse(value) {
  const models = value && Array.isArray(value.data) ? value.data : [];
  const seen = new Set();
  return models
    .map((item) => ({
      id: normalizeGeminiModelId(item && (item.id || item.name)),
      ownedBy: String(item && (item.owned_by || item.ownedBy) || "").trim()
    }))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

export function parseNewApiPricingResponse(value) {
  const models = value && Array.isArray(value.data) ? value.data : [];
  const seen = new Set();
  return models
    .map((item) => ({
      id: normalizeGeminiModelId(item && (item.model_name || item.modelName || item.id)),
      supportedEndpointTypes: Array.isArray(item && item.supported_endpoint_types)
        ? item.supported_endpoint_types.map((type) => String(type || "").trim().toLowerCase()).filter(Boolean)
        : [],
      enabledGroups: Array.isArray(item && item.enable_groups) ? [...item.enable_groups] : []
    }))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

export function isLikelyGeminiImageModel(value) {
  const model = normalizeGeminiModelId(value);
  return model.toLowerCase() === MOMO_MIDJOURNEY_MODEL_ID || /(?:image|banana)/i.test(model);
}

export function buildMomoMidjourneyImagineRequest(config = {}) {
  const body = { prompt: String(config.prompt || "").trim() };
  const mode = String(config.mode || "").trim().toLowerCase();
  if (mode === "fast" || mode === "relax") body.mode = mode;
  const state = String(config.state || "").trim();
  if (state) body.state = state;
  return {
    url: `${normalizeGeminiBaseUrl(config.apiUrl, "momo")}/mj/submit/imagine`,
    options: {
      method: "POST",
      headers: buildGeminiHeaders(config.apiKey),
      body: JSON.stringify(body)
    },
    body
  };
}

export function buildMomoMidjourneyTaskRequest(config = {}) {
  const taskId = encodeURIComponent(String(config.taskId || "").trim());
  return {
    url: `${normalizeGeminiBaseUrl(config.apiUrl, "momo")}/mj/task/${taskId}/fetch`,
    options: {
      method: "GET",
      headers: buildGeminiHeaders(config.apiKey)
    }
  };
}

export function buildMomoMidjourneyImageRequest(config = {}) {
  const taskId = encodeURIComponent(String(config.taskId || "").trim());
  return {
    url: `${normalizeGeminiBaseUrl(config.apiUrl, "momo")}/mj/image/${taskId}`,
    options: {
      method: "GET",
      headers: buildGeminiHeaders(config.apiKey)
    }
  };
}

export function isLikelyTextGenerationModel(value) {
  const model = normalizeGeminiModelId(value);
  if (!model || isLikelyGeminiImageModel(model)) return false;
  return !/(?:video|veo|sora|seedance|kling|hailuo|whisper|audio|speech|tts|embedding|embed|rerank|moderation)/i.test(model);
}

export function classifyNewApiModels({ openAiModels = [], geminiModels = [], pricingModels = [] } = {}) {
  const records = new Map();
  const ensureRecord = (id) => {
    const normalizedId = normalizeGeminiModelId(id);
    if (!normalizedId) return null;
    if (!records.has(normalizedId)) {
      records.set(normalizedId, {
        id: normalizedId,
        displayName: "",
        supportedGenerationMethods: [],
        supportedEndpointTypes: [],
        sources: []
      });
    }
    return records.get(normalizedId);
  };

  openAiModels.forEach((item) => {
    const record = ensureRecord(item && (item.id || item.name) || item);
    if (record && !record.sources.includes("openai")) record.sources.push("openai");
  });
  geminiModels.forEach((item) => {
    const record = ensureRecord(item && (item.id || item.name) || item);
    if (!record) return;
    if (!record.sources.includes("gemini")) record.sources.push("gemini");
    record.displayName = String(item && item.displayName || record.displayName).trim();
    record.supportedGenerationMethods = Array.isArray(item && item.supportedGenerationMethods)
      ? [...item.supportedGenerationMethods]
      : record.supportedGenerationMethods;
  });

  const pricingById = new Map(pricingModels.map((item) => [normalizeGeminiModelId(item && item.id), item]));
  records.forEach((record, id) => {
    const pricing = pricingById.get(id);
    record.supportedEndpointTypes = Array.isArray(pricing && pricing.supportedEndpointTypes)
      ? [...pricing.supportedEndpointTypes]
      : [];
  });

  const details = [...records.values()];
  const imageModels = details
    .filter((item) => {
      const supportsGemini = item.sources.includes("gemini") || item.supportedEndpointTypes.includes("gemini");
      return supportsGemini && isLikelyGeminiImageModel(item.id);
    })
    .map((item) => item.id);
  const chatModels = details
    .filter((item) => {
      const supportsOpenAi = item.sources.includes("openai") && (
        !item.supportedEndpointTypes.length || item.supportedEndpointTypes.includes("openai")
      );
      return supportsOpenAi && isLikelyTextGenerationModel(item.id);
    })
    .map((item) => item.id);
  return { models: details.map((item) => item.id), imageModels, chatModels, details };
}

export function parseGeminiTextResponse(value) {
  const candidates = value && Array.isArray(value.candidates) ? value.candidates : [];
  return candidates
    .flatMap((candidate) => candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [])
    .map((part) => String(part && part.text || ""))
    .filter(Boolean)
    .join("")
    .trim();
}

export function parseNewApiChatResponse(value) {
  const choices = value && Array.isArray(value.choices) ? value.choices : [];
  const content = choices[0] && choices[0].message && choices[0].message.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => String(item && (item.text || item.content) || ""))
    .filter(Boolean)
    .join("")
    .trim();
}

export function parseGeminiImageResponse(value) {
  const candidates = value && Array.isArray(value.candidates) ? value.candidates : [];
  const images = [];
  candidates.forEach((candidate) => {
    const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
    parts.forEach((part) => {
      const inline = part && (part.inlineData || part.inline_data);
      const data = String(inline && inline.data || "").trim();
      if (!data) return;
      const mimeType = String(inline.mimeType || inline.mime_type || "image/png").trim() || "image/png";
      images.push({ mimeType, data, dataUrl: `data:${mimeType};base64,${data}` });
    });
  });
  return { image: images[0] || null, images };
}

function extractGeminiSafetyReason(value) {
  const promptReason = String(value && value.promptFeedback && value.promptFeedback.blockReason || "").trim();
  if (promptReason) return promptReason;
  const candidates = value && Array.isArray(value.candidates) ? value.candidates : [];
  const blocked = candidates.find((candidate) => /SAFETY|BLOCK|PROHIBITED/i.test(String(candidate && candidate.finishReason || "")));
  return String(blocked && blocked.finishReason || "").trim();
}

function extractGeminiErrorText(value, rawText = "", apiKey = "") {
  const detail = value && value.error && (value.error.message || value.error.status || value.error.code);
  const secret = String(apiKey || "").trim();
  let text = String(detail || rawText || "").replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]").trim();
  if (secret) text = text.split(secret).join("[REDACTED]");
  return text.replace(/\s+/g, " ").slice(0, 300);
}

export function normalizeGeminiFailure(input = {}) {
  const status = Number(input.status) || 0;
  const safetyReason = extractGeminiSafetyReason(input.json);
  const detail = extractGeminiErrorText(input.json, input.rawText || (input.error && input.error.message), input.apiKey);
  if (input.cancelled) return { code: "cancelled", status, message: "Gemini 请求已取消" };
  if (input.timedOut || /abort|timeout|timed out/i.test(detail)) return { code: "timeout", status, message: "Gemini 请求超时，请稍后重试" };
  if (safetyReason) return { code: "safety", status, message: `内容被 Gemini 安全策略拦截（${safetyReason}）` };
  if (status === 401 || status === 403) return { code: "auth", status, message: "Gemini API Key 无效、已过期或无权访问当前模型" };
  if (status === 429) return { code: "rate-limit", status, message: "Gemini 请求过于频繁或额度不足，请稍后重试" };
  if (status >= 500) return { code: "service", status, message: `Gemini 渠道服务异常（HTTP ${status}）${detail ? `：${detail}` : ""}` };
  if (status >= 400) return { code: "request", status, message: `Gemini 请求失败（HTTP ${status}）${detail ? `：${detail}` : ""}` };
  return { code: "network", status, message: detail ? `Gemini 请求失败：${detail}` : "Gemini 网络请求失败" };
}
