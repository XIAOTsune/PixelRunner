export const GRS_REGIONS = Object.freeze({
  CN: "cn",
  GLOBAL: "global"
});

export const GRS_REGION_CONFIG = Object.freeze({
  [GRS_REGIONS.CN]: Object.freeze({
    region: GRS_REGIONS.CN,
    label: "国内节点",
    apiUrl: "https://grsai.dakka.com.cn"
  }),
  [GRS_REGIONS.GLOBAL]: Object.freeze({
    region: GRS_REGIONS.GLOBAL,
    label: "国际节点",
    apiUrl: "https://grsaiapi.com"
  })
});

export const GRS_IMAGE_MODEL_CATALOG = Object.freeze([
  Object.freeze({ id: "gpt-image-2", label: "gpt-image-2" }),
  Object.freeze({ id: "gpt-image-2-vip", label: "gpt-image-2-vip" }),
  Object.freeze({ id: "nano-banana-2-lite", label: "nano-banana-2-lite（实验）", experimental: true }),
  Object.freeze({ id: "nano-banana-2", label: "nano-banana-2" }),
  Object.freeze({ id: "nano-banana-2-cl", label: "nano-banana-2-cl" }),
  Object.freeze({ id: "nano-banana-2-2k-cl", label: "nano-banana-2-2k-cl" }),
  Object.freeze({ id: "nano-banana-2-4k-cl", label: "nano-banana-2-4k-cl" }),
  Object.freeze({ id: "nano-banana-pro", label: "nano-banana-pro" }),
  Object.freeze({ id: "nano-banana-pro-vt", label: "nano-banana-pro-vt" }),
  Object.freeze({ id: "nano-banana-pro-cl", label: "nano-banana-pro-cl" }),
  Object.freeze({ id: "nano-banana-pro-vip", label: "nano-banana-pro-vip" }),
  Object.freeze({ id: "nano-banana-pro-4k-vip", label: "nano-banana-pro-4k-vip" }),
  Object.freeze({ id: "nano-banana-fast", label: "nano-banana-fast" }),
  Object.freeze({ id: "nano-banana", label: "nano-banana" })
]);

export const GRS_IMAGE_MODEL_IDS = Object.freeze(GRS_IMAGE_MODEL_CATALOG.map((item) => item.id));

export const GRS_CHAT_MODEL_IDS = Object.freeze([
  "gpt-5.5",
  "gpt-5.4",
  "gemini-3.5-flash",
  "gemini-3.1-pro",
  "gemini-3.1-flash-lite",
  "gemini-3-pro",
  "gemini-3-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash"
]);

const GRS_COMMON_BANANA_RATIOS = Object.freeze([
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

const GRS_BANANA_2_EXTRA_RATIOS = Object.freeze(["1:4", "4:1", "1:8", "8:1"]);

const GPT_IMAGE_2_SIZES = Object.freeze([
  "auto",
  "1024x1024",
  "1672x941",
  "941x1672",
  "1443x1090",
  "1090x1443",
  "1536x1024",
  "1024x1536",
  "1408x1120",
  "1120x1408",
  "1920x832",
  "832x1920",
  "1792x896",
  "896x1792"
]);

const GPT_IMAGE_2_VIP_SIZES = Object.freeze([
  "auto",
  "1024x1024",
  "1280x720",
  "720x1280",
  "1152x864",
  "864x1152",
  "1536x1024",
  "1024x1536",
  "1120x896",
  "896x1120",
  "1456x624",
  "624x1456",
  "1536x768",
  "768x1536"
]);

const GRS_MODEL_ALIASES = Object.freeze({
  gptimage2: "gpt-image-2",
  gptimage2vip: "gpt-image-2-vip",
  nanobanana: "nano-banana",
  nanobananapro: "nano-banana-pro",
  nanobananafast: "nano-banana-fast",
  nanobanana2lite: "nano-banana-2-lite",
  nanobanana2: "nano-banana-2",
  nanobanana2cl: "nano-banana-2-cl",
  nanobanana22kcl: "nano-banana-2-2k-cl",
  nanobanana24kcl: "nano-banana-2-4k-cl",
  nanobananaprocl: "nano-banana-pro-cl",
  nanobananaprovip: "nano-banana-pro-vip",
  nanobananapro4kvip: "nano-banana-pro-4k-vip",
  nanobananaprovt: "nano-banana-pro-vt"
});

const BANANA_RESOLUTIONS = Object.freeze({
  "nano-banana-2": Object.freeze(["1K", "2K", "4K"]),
  "nano-banana-2-cl": Object.freeze(["1K"]),
  "nano-banana-2-2k-cl": Object.freeze(["2K"]),
  "nano-banana-2-4k-cl": Object.freeze(["4K"]),
  "nano-banana-pro": Object.freeze(["1K", "2K", "4K"]),
  "nano-banana-pro-vt": Object.freeze(["1K", "2K", "4K"]),
  "nano-banana-pro-cl": Object.freeze(["1K"]),
  "nano-banana-pro-vip": Object.freeze(["1K", "2K"]),
  "nano-banana-pro-4k-vip": Object.freeze(["4K"])
});

const BANANA_2_MODELS = new Set([
  "nano-banana-2",
  "nano-banana-2-cl",
  "nano-banana-2-2k-cl",
  "nano-banana-2-4k-cl"
]);

export function normalizeGrsRegion(value, legacyApiUrl = "") {
  const marker = String(value || "").trim().toLowerCase();
  if (["global", "international", "intl", "overseas"].includes(marker)) return GRS_REGIONS.GLOBAL;
  if (["cn", "china", "domestic", "zh"].includes(marker)) return GRS_REGIONS.CN;

  try {
    const host = new URL(String(legacyApiUrl || "").trim()).host.toLowerCase();
    if (host === "grsaiapi.com" || host.endsWith(".grsaiapi.com")) return GRS_REGIONS.GLOBAL;
    if (host === "grsai.dakka.com.cn") return GRS_REGIONS.CN;
  } catch (_) {}

  return GRS_REGIONS.CN;
}

export function getGrsRegionConfig(value, legacyApiUrl = "") {
  return GRS_REGION_CONFIG[normalizeGrsRegion(value, legacyApiUrl)];
}

export function getGrsApiUrl(value, legacyApiUrl = "") {
  return getGrsRegionConfig(value, legacyApiUrl).apiUrl;
}

export function normalizeGrsModelId(value) {
  const text = String(value || "").trim().replace(/^models?\//i, "").toLowerCase();
  const compact = text.replace(/[\s_-]/g, "");
  return GRS_MODEL_ALIASES[compact] || text;
}

export function getGrsImageModelDefinition(value) {
  const id = normalizeGrsModelId(value);
  return GRS_IMAGE_MODEL_CATALOG.find((item) => item.id === id) || null;
}

export function getGrsImageModelLabel(value) {
  const id = normalizeGrsModelId(value);
  const definition = getGrsImageModelDefinition(id);
  return definition ? definition.label : id;
}

export function isGrsNanoBananaModel(value) {
  return /^nano-banana(?:$|-)/i.test(normalizeGrsModelId(value));
}

export function isGrsGptImageModel(value) {
  return /^gpt-image-2(?:-vip)?$/i.test(normalizeGrsModelId(value));
}

export function getGrsImageModelCapabilities(value) {
  const model = normalizeGrsModelId(value);
  if (model === "gpt-image-2" || model === "gpt-image-2-vip") {
    return {
      model,
      family: "gpt-image",
      aspectRatios: [...(model === "gpt-image-2" ? GPT_IMAGE_2_SIZES : GPT_IMAGE_2_VIP_SIZES)],
      resolutions: ["1K"],
      allowCustomAspectRatio: false,
      defaultAspectRatio: "auto",
      defaultResolution: "1K",
      supportsImageSize: false,
      experimental: false
    };
  }

  if (isGrsNanoBananaModel(model)) {
    const resolutions = BANANA_RESOLUTIONS[model] || ["1K"];
    const aspectRatios = BANANA_2_MODELS.has(model)
      ? [...GRS_COMMON_BANANA_RATIOS, ...GRS_BANANA_2_EXTRA_RATIOS]
      : [...GRS_COMMON_BANANA_RATIOS];
    return {
      model,
      family: "nano-banana",
      aspectRatios,
      resolutions: [...resolutions],
      allowCustomAspectRatio: false,
      defaultAspectRatio: "auto",
      defaultResolution: resolutions[0] || "1K",
      supportsImageSize: Object.prototype.hasOwnProperty.call(BANANA_RESOLUTIONS, model),
      experimental: Boolean(getGrsImageModelDefinition(model)?.experimental)
    };
  }

  return {
    model,
    family: "custom",
    aspectRatios: ["auto", "1:1"],
    resolutions: ["1K"],
    allowCustomAspectRatio: true,
    defaultAspectRatio: "auto",
    defaultResolution: "1K",
    supportsImageSize: false,
    experimental: false
  };
}
