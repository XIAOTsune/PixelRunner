import {
  buildGeminiGenerateRequest,
  buildGeminiModelsRequest,
  buildMomoMidjourneyImageRequest,
  buildMomoMidjourneyImagineRequest,
  buildMomoMidjourneyTaskRequest,
  buildNewApiChatRequest,
  buildNewApiModelsRequest,
  buildNewApiPricingRequest,
  classifyNewApiModels,
  normalizeGeminiFailure,
  normalizeGeminiModelId,
  isMomoMidjourneyModel,
  MOMO_MIDJOURNEY_MODEL_ID,
  parseGeminiImageResponse,
  parseGeminiModelsResponse,
  parseGeminiTextResponse,
  parseNewApiChatResponse,
  parseNewApiModelsResponse,
  parseNewApiPricingResponse
} from "../shared/gemini-config.js";
import { ensureDeps } from "./photoshop/deps.js";

const geminiTaskControllers = new Map();
const geminiTaskResults = new Map();
const GEMINI_RESULT_TTL_MS = 30 * 60 * 1000;
const MAX_DATA_URL_FALLBACK_LENGTH = 8 * 1024 * 1024;

function parseJsonSafe(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (_) {
    return null;
  }
}

function parseDataUrl(value) {
  const match = String(value || "").trim().match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: String(match[1] || "image/png").trim() || "image/png",
    data: String(match[2] || "").trim()
  };
}

function normalizeBase64Text(base64) {
  const text = String(base64 || "").trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = text.length % 4;
  if (!text || padding === 1) return "";
  return padding > 1 ? `${text}${"=".repeat(4 - padding)}` : text;
}

function base64ToArrayBuffer(base64) {
  const normalized = normalizeBase64Text(base64);
  if (!normalized) throw new Error("Gemini 图片 Base64 数据无效");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return btoa(binary);
}

async function imageValueToInlineData(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const dataUrl = parseDataUrl(value);
    if (dataUrl) return dataUrl;
    if (/^https?:\/\//i.test(value.trim())) return fetchImageAsInlineData(value.trim());
    return null;
  }
  if (typeof value !== "object") return null;
  const dataUrl = parseDataUrl(value.dataUrl || value.uploadDataUrl);
  if (dataUrl) return dataUrl;
  const data = normalizeBase64Text(value.base64 || value.uploadBase64);
  if (data) return { mimeType: String(value.mimeType || value.uploadMimeType || "image/png"), data };
  const url = String(value.url || "").trim();
  return /^https?:\/\//i.test(url) ? fetchImageAsInlineData(url) : null;
}

async function fetchImageAsInlineData(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取 Gemini 参考图失败（HTTP ${response.status}）`);
  const buffer = await response.arrayBuffer();
  const mimeType = String(response.headers && response.headers.get("content-type") || "image/png").split(";")[0].trim() || "image/png";
  return { mimeType, data: arrayBufferToBase64(buffer) };
}

function getTimeoutMs(payload, fallbackMs = 180000) {
  const explicit = Number(payload && payload.timeoutMs);
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(100, explicit);
  const seconds = Number(payload && payload.settings && payload.settings.timeout || payload && payload.timeout);
  return Math.max(10000, (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallbackMs));
}

async function fetchGeminiJson(request, options = {}) {
  const controller = options.controller || (typeof AbortController !== "undefined" ? new AbortController() : null);
  let timedOut = false;
  const timer = controller
    ? setTimeout(() => {
        timedOut = true;
        try {
          controller.abort();
        } catch (_) {}
      }, Math.max(100, Number(options.timeoutMs) || 180000))
    : null;
  try {
    const response = await fetch(request.url, {
      ...request.options,
      signal: controller ? controller.signal : undefined
    });
    const rawText = await response.text().catch(() => "");
    const json = parseJsonSafe(rawText);
    if (!response.ok) {
      const apiKey = String(request.options && request.options.headers && request.options.headers.Authorization || "").replace(/^Bearer\s+/i, "");
      const failure = normalizeGeminiFailure({ status: response.status, json, rawText, apiKey });
      const error = new Error(failure.message);
      error.code = failure.code;
      error.status = failure.status;
      throw error;
    }
    if (!json || typeof json !== "object") throw new Error("Gemini 返回了无法解析的 JSON 数据");
    if (json.error) {
      const failure = normalizeGeminiFailure({ status: Number(json.error.code) || 0, json, rawText });
      const error = new Error(failure.message);
      error.code = failure.code;
      throw error;
    }
    return {
      json,
      rawText,
      requestId: String(response.headers && response.headers.get("x-oneapi-request-id") || "").trim()
    };
  } catch (error) {
    if (error && error.code) throw error;
    const cancelled = Boolean(controller && controller.signal.aborted && !timedOut);
    const failure = normalizeGeminiFailure({ error, timedOut, cancelled });
    const normalized = new Error(failure.message);
    normalized.code = failure.code;
    throw normalized;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function cleanupExpiredResults() {
  const now = Date.now();
  for (const [taskId, result] of geminiTaskResults.entries()) {
    if (now - Number(result.createdAt || 0) > GEMINI_RESULT_TTL_MS) geminiTaskResults.delete(taskId);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function getImageFileExtension(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  return "png";
}

async function writeGeminiImageToTemporaryFile(image, taskId) {
  const { storage } = await ensureDeps();
  if (!storage || !storage.localFileSystem) throw new Error("UXP 临时文件系统不可用");
  const tempFolder = await storage.localFileSystem.getTemporaryFolder();
  const extension = getImageFileExtension(image.mimeType);
  const safeTaskId = String(taskId || Date.now()).replace(/[^a-z0-9_-]+/gi, "-").slice(-64);
  const file = await tempFolder.createFile(`pixelrunner-gemini-${safeTaskId}.${extension}`, { overwrite: true });
  await file.write(base64ToArrayBuffer(image.data), { format: storage.formats.binary });
  return { filePath: String(file.nativePath || ""), mimeType: image.mimeType, byteLength: Math.floor(image.data.length * 0.75) };
}

async function createGeminiDelivery(image, taskId) {
  try {
    const stored = await writeGeminiImageToTemporaryFile(image, taskId);
    if (stored.filePath) return { ...stored, dataUrl: "", delivery: "temp-file" };
  } catch (_) {}
  if (image.dataUrl.length > MAX_DATA_URL_FALLBACK_LENGTH) {
    throw new Error("Gemini 已返回大图，但宿主临时文件写入失败；为避免消息通道超限，已停止传递结果");
  }
  return { filePath: "", dataUrl: image.dataUrl, mimeType: image.mimeType, byteLength: Math.floor(image.data.length * 0.75), delivery: "data-url" };
}

function getConfig(payload) {
  return payload && payload.config && typeof payload.config === "object" ? payload.config : {};
}

async function fetchGeminiBinary(request, options = {}) {
  const controller = options.controller || (typeof AbortController !== "undefined" ? new AbortController() : null);
  let timedOut = false;
  const timer = controller
    ? setTimeout(() => {
        timedOut = true;
        try {
          controller.abort();
        } catch (_) {}
      }, Math.max(100, Number(options.timeoutMs) || 180000))
    : null;
  try {
    const response = await fetch(request.url, {
      ...request.options,
      signal: controller ? controller.signal : undefined
    });
    if (!response.ok) {
      const rawText = await response.text().catch(() => "");
      const json = parseJsonSafe(rawText);
      const apiKey = String(request.options && request.options.headers && request.options.headers.Authorization || "").replace(/^Bearer\s+/i, "");
      const failure = normalizeGeminiFailure({ status: response.status, json, rawText, apiKey });
      const error = new Error(failure.message);
      error.code = failure.code;
      error.status = failure.status;
      throw error;
    }
    const buffer = await response.arrayBuffer();
    const mimeType = String(response.headers && response.headers.get("content-type") || "image/png")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!mimeType.startsWith("image/")) throw new Error("Midjourney 图片接口未返回图片数据");
    return { buffer, mimeType };
  } catch (error) {
    if (error && error.code) throw error;
    const cancelled = Boolean(controller && controller.signal.aborted && !timedOut);
    const failure = normalizeGeminiFailure({ error, timedOut, cancelled });
    const normalized = new Error(failure.message);
    normalized.code = failure.code;
    throw normalized;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getMidjourneyModel(payload) {
  const inputs = payload && payload.inputs && typeof payload.inputs === "object" ? payload.inputs : {};
  const config = getConfig(payload);
  const channelId = String(config.channelId || payload && payload.channelId || "").trim().toLowerCase();
  const apiUrl = String(config.apiUrl || payload && payload.apiUrl || "").trim();
  const isMomoEndpoint = /(^|\.)momoapi\.icu(?::\d+)?(?:\/|$)/i.test(apiUrl.replace(/^https?:\/\//i, ""));
  const model = inputs.model || config.selectedModel;
  return (channelId === "momo" || isMomoEndpoint) && isMomoMidjourneyModel(model) ? MOMO_MIDJOURNEY_MODEL_ID : "";
}

function getMidjourneyTaskId(value) {
  if (!value || typeof value !== "object") return "";
  const data = value.data && typeof value.data === "object" ? value.data : {};
  return String(value.result || value.taskId || value.task_id || value.id || data.result || data.taskId || data.task_id || data.id || "").trim();
}

function getMidjourneyImageUrl(value) {
  if (!value || typeof value !== "object") return "";
  const data = value.data && typeof value.data === "object" ? value.data : {};
  const properties = value.properties && typeof value.properties === "object" ? value.properties : {};
  const propertyImages = Array.isArray(properties.images) ? properties.images : [];
  const dataProperties = data.properties && typeof data.properties === "object" ? data.properties : {};
  const dataImages = Array.isArray(dataProperties.images) ? dataProperties.images : [];
  const candidates = [
    ...propertyImages,
    ...dataImages,
    value.imageUrl,
    value.image_url,
    value.url,
    value.outputUrl,
    value.output_url,
    data.imageUrl,
    data.image_url,
    data.url,
    data.outputUrl,
    data.output_url,
    data.image,
    data.image_url_proxy,
    dataProperties.imageUrl,
    dataProperties.image_url
  ];
  return candidates
    .map((item) => {
      if (!item || typeof item !== "object") return String(item || "").trim();
      return String(item.url || item.imageUrl || item.image_url || item.outputUrl || item.output_url || "").trim();
    })
    .find((item) => /^https?:\/\//i.test(item)) || "";
}

function normalizeMidjourneyStatus(value, taskId) {
  const data = value && value.data && typeof value.data === "object" ? value.data : {};
  const status = String(value && (value.status || value.state || value.data && (value.data.status || value.data.state)) || "").trim().toUpperCase();
  const outputUrl = getMidjourneyImageUrl(value);
  const completed = value && (value.isCompleted === true || value.completed === true || data.isCompleted === true || data.completed === true) || Boolean(outputUrl) || ["SUCCESS", "SUCCEEDED", "COMPLETED", "COMPLETE", "DONE", "FINISHED"].includes(status);
  const failed = ["FAILURE", "FAILED", "ERROR", "CANCELLED", "CANCELED", "REJECTED", "TIMEOUT", "TIMED_OUT"].includes(status);
  const stillRunning = !completed && !failed;
  const message = String(value && (value.failReason || value.error || value.message || value.description || value.data && (value.data.failReason || value.data.message)) || "").trim();
  return {
    ok: Boolean(outputUrl && !failed),
    taskId,
    status: status || (completed ? "SUCCESS" : failed ? "FAILED" : "IN_PROGRESS"),
    outputUrl,
    failed: failed || (completed && !outputUrl),
    stillRunning,
    message: message || (completed && !outputUrl ? "Midjourney 任务已完成，但未返回图片地址" : ""),
    raw: value || null
  };
}

function isMidjourneyTaskPayload(payload) {
  return Boolean(getMidjourneyModel(payload));
}

async function submitMomoMidjourneyTask(payload, config, inputs, apiKey) {
  const request = buildMomoMidjourneyImagineRequest({
    apiUrl: config.apiUrl,
    apiKey,
    prompt: inputs.prompt,
    mode: inputs.mode,
    state: inputs.state || payload.requestId
  });
  const { json } = await fetchGeminiJson(request, { timeoutMs: getTimeoutMs(payload) });
  const taskId = getMidjourneyTaskId(json);
  if (!taskId) throw new Error("Midjourney 未返回可识别的任务 ID");
  return { ok: true, taskId, status: "RUNNING", stillRunning: true, immediate: false, model: MOMO_MIDJOURNEY_MODEL_ID };
}

async function fetchMomoMidjourneyImage(payload, taskId) {
  const config = getConfig(payload);
  const apiKey = String(config.apiKey || payload.apiKey || "").trim();
  const request = buildMomoMidjourneyImageRequest({ apiUrl: getApiBaseUrl(payload), apiKey, taskId });
  const { buffer, mimeType } = await fetchGeminiBinary(request, { timeoutMs: getTimeoutMs(payload, 30000) });
  const data = arrayBufferToBase64(buffer);
  const image = { mimeType, data, dataUrl: `data:${mimeType};base64,${data}` };
  const delivery = await createGeminiDelivery(image, `momo-mj-${taskId}`);
  return {
    outputUrl: "",
    dataUrl: delivery.dataUrl,
    filePath: delivery.filePath,
    mimeType: delivery.mimeType,
    byteLength: delivery.byteLength,
    delivery: delivery.delivery
  };
}

async function fetchMomoMidjourneyTaskStatus(payload, taskId) {
  const config = getConfig(payload);
  const apiKey = String(config.apiKey || payload.apiKey || "").trim();
  if (!apiKey) throw new Error("请先配置当前第三方渠道的 API Key");
  const request = buildMomoMidjourneyTaskRequest({ apiUrl: getApiBaseUrl(payload), apiKey, taskId });
  const { json } = await fetchGeminiJson(request, { timeoutMs: getTimeoutMs(payload, 30000) });
  const result = normalizeMidjourneyStatus(json, taskId);
  const explicitFailure = ["FAILURE", "FAILED", "ERROR", "CANCELLED", "CANCELED", "REJECTED", "TIMEOUT", "TIMED_OUT"].includes(result.status);
  // The task response often exposes a direct cdn.midjourney.com URL. Photoshop's
  // UXP network policy may reject that host, and the URL may also require no
  // authentication context. Always download through Momo's authenticated proxy
  // before handing the result to the placement pipeline.
  if (result.stillRunning || explicitFailure) return result;
  try {
    return {
      ...result,
      ok: true,
      failed: false,
      stillRunning: false,
      ...(await fetchMomoMidjourneyImage(payload, taskId)),
      outputUrl: result.outputUrl
    };
  } catch (error) {
    return {
      ...result,
      ok: false,
      failed: true,
      stillRunning: false,
      message: `Midjourney 已完成，但获取图片失败：${String(error && error.message || error || "未知错误")}`
    };
  }
}

async function pollMomoMidjourneyTask(payload) {
  const taskId = String(payload.taskId || "").trim();
  const timeoutMs = getTimeoutMs(payload);
  const pollIntervalMs = Math.max(250, Number(payload.settings && payload.settings.pollInterval || 3) * 1000);
  const startedAt = Date.now();
  let lastResult = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastResult = await fetchMomoMidjourneyTaskStatus(payload, taskId);
    if (!lastResult.stillRunning) return lastResult;
    await sleep(pollIntervalMs);
  }
  return {
    ok: false,
    taskId,
    status: lastResult && lastResult.status || "IN_PROGRESS",
    timedOut: true,
    stillRunning: true,
    failed: false,
    outputUrl: "",
    message: "Midjourney 任务仍在运行"
  };
}

function getApiBaseUrl(payload) {
  const config = getConfig(payload);
  return String(config.apiUrl || payload && payload.apiUrl || "").trim().replace(/\/+$/, "");
}

function normalizeNewApiCurrencyConfig(value) {
  const data = value && value.data && typeof value.data === "object" ? value.data : value && typeof value === "object" ? value : {};
  const type = ["USD", "CNY", "TOKENS", "CUSTOM"].includes(String(data.quota_display_type || "").toUpperCase())
    ? String(data.quota_display_type).toUpperCase()
    : "USD";
  return {
    type,
    quotaPerUnit: Math.max(1, Number(data.quota_per_unit) || 500000),
    usdExchangeRate: Math.max(0.000001, Number(data.usd_exchange_rate) || 1),
    customExchangeRate: Math.max(0.000001, Number(data.custom_currency_exchange_rate) || 1),
    customSymbol: String(data.custom_currency_symbol || "¤").trim() || "¤"
  };
}

function convertNewApiQuota(rawQuota, currencyConfig) {
  const raw = Number(rawQuota);
  if (!Number.isFinite(raw)) return null;
  if (currencyConfig.type === "TOKENS") return raw;
  const usd = raw / currencyConfig.quotaPerUnit;
  if (currencyConfig.type === "CNY") return usd * currencyConfig.usdExchangeRate;
  if (currencyConfig.type === "CUSTOM") return usd * currencyConfig.customExchangeRate;
  return usd;
}

function getNewApiCurrencyMeta(currencyConfig) {
  if (currencyConfig.type === "CNY") return { currency: "CNY", symbol: "¥", unit: "CNY" };
  if (currencyConfig.type === "TOKENS") return { currency: "TOKENS", symbol: "", unit: "Tokens" };
  if (currencyConfig.type === "CUSTOM") return { currency: "CUSTOM", symbol: currencyConfig.customSymbol, unit: currencyConfig.customSymbol };
  return { currency: "USD", symbol: "$", unit: "USD" };
}

function formatNewApiAmount(value, currencyConfig, options = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "--";
  const meta = getNewApiCurrencyMeta(currencyConfig);
  if (currencyConfig.type === "TOKENS") return `${Math.round(amount).toLocaleString("en-US")} ${meta.unit}`;
  const digits = Math.abs(amount) >= 1 ? 2 : 4;
  const normalized = amount.toFixed(digits).replace(/\.?0+$/, "");
  const prefix = options.negative && amount > 0 ? "-" : "";
  return currencyConfig.type === "CUSTOM" ? `${prefix}${meta.symbol} ${normalized}` : `${prefix}${meta.symbol}${normalized}`;
}

async function fetchNewApiJson(apiUrl, path, apiKey = "", timeoutMs = 15000) {
  const headers = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const { json } = await fetchGeminiJson({
    url: `${String(apiUrl || "").replace(/\/+$/, "")}${path}`,
    options: { method: "GET", headers }
  }, { timeoutMs });
  return json;
}

async function getNewApiCurrencyConfig(apiUrl, timeoutMs = 15000) {
  const status = await fetchNewApiJson(apiUrl, "/api/status", "", timeoutMs);
  return normalizeNewApiCurrencyConfig(status);
}

export async function fetchThirdPartyGeminiAccountStatus(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const config = getConfig(payload);
  const apiUrl = getApiBaseUrl(payload);
  const apiKey = String(config.apiKey || payload.apiKey || "").trim();
  if (!apiUrl) throw new Error("当前第三方渠道缺少 API 地址");
  if (!apiKey) throw new Error("请先配置当前第三方渠道的 API Key");

  const timeoutMs = getTimeoutMs(payload, 15000);
  const [currencyConfig, usage] = await Promise.all([
    getNewApiCurrencyConfig(apiUrl, timeoutMs),
    fetchNewApiJson(apiUrl, "/api/usage/token/", apiKey, timeoutMs)
  ]);
  const usageData = usage && usage.data && typeof usage.data === "object" ? usage.data : null;
  if (!usageData || usage.code === false || usage.success === false) {
    throw new Error(String(usage && usage.message || "渠道未返回可用的额度信息"));
  }

  const unlimited = usageData.unlimited_quota === true;
  const balance = convertNewApiQuota(usageData.total_available, currencyConfig);
  const used = convertNewApiQuota(usageData.total_used, currencyConfig);
  const total = convertNewApiQuota(usageData.total_granted, currencyConfig);
  const currencyMeta = getNewApiCurrencyMeta(currencyConfig);
  return {
    ok: true,
    provider: "gemini",
    channelId: String(config.channelId || payload.channelId || "").trim(),
    apiUrl,
    balance: unlimited ? null : balance,
    used,
    total,
    unlimited,
    currency: currencyMeta.currency,
    unit: currencyMeta.unit,
    balanceDisplay: unlimited ? "不限" : formatNewApiAmount(balance, currencyConfig),
    usedDisplay: formatNewApiAmount(used, currencyConfig),
    totalDisplay: unlimited ? "不限" : formatNewApiAmount(total, currencyConfig),
    updatedAt: Date.now(),
    source: "newapi-token-usage"
  };
}

function getLogQuota(log) {
  if (!log || typeof log !== "object") return null;
  let other = log.other;
  if (typeof other === "string") other = parseJsonSafe(other);
  const value = other && other.fee_quota != null ? other.fee_quota : log.quota;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function fetchThirdPartyGeminiTaskCharge(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const config = getConfig(payload);
  const apiUrl = getApiBaseUrl(payload);
  const apiKey = String(config.apiKey || payload.apiKey || "").trim();
  const requestId = String(payload.providerRequestId || payload.requestId || "").trim();
  if (!apiUrl || !apiKey || !requestId) return { ok: false, chargePending: true };

  const timeoutMs = getTimeoutMs(payload, 15000);
  const [currencyConfig, response] = await Promise.all([
    getNewApiCurrencyConfig(apiUrl, timeoutMs),
    fetchNewApiJson(apiUrl, "/api/log/token", apiKey, timeoutMs)
  ]);
  const logs = Array.isArray(response && response.data) ? response.data : [];
  const matched = logs.find((item) => String(item && item.request_id || "").trim() === requestId);
  const rawCharge = getLogQuota(matched);
  if (rawCharge === null) return { ok: false, chargePending: true, providerRequestId: requestId };
  const charge = convertNewApiQuota(rawCharge, currencyConfig);
  return {
    ok: true,
    charge,
    balanceCharge: charge,
    coinsCharge: null,
    chargeDisplay: formatNewApiAmount(charge, currencyConfig, { negative: true }),
    providerRequestId: requestId,
    source: "newapi-consumption-log"
  };
}

async function decorateGeminiResultWithCharge(result, payload) {
  if (!result || result.chargeDisplay || !result.providerRequestId) return result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const charge = await fetchThirdPartyGeminiTaskCharge([{ ...payload, providerRequestId: result.providerRequestId }]);
      if (charge && charge.ok) return { ...result, ...charge };
    } catch (_) {}
    if (attempt < 2) await sleep(350 * (attempt + 1));
  }
  return result;
}

export async function submitThirdPartyGeminiTask(args = []) {
  cleanupExpiredResults();
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const config = getConfig(payload);
  const inputs = payload.inputs && typeof payload.inputs === "object" ? payload.inputs : {};
  const apiKey = String(config.apiKey || payload.apiKey || "").trim();
  const model = normalizeGeminiModelId(inputs.model || config.selectedModel);
  const prompt = String(inputs.prompt || "").trim();
  if (!apiKey) throw new Error("请先在第三方支持中配置当前 Gemini 渠道的 API Key");
  if (!model) throw new Error("请先选择 Gemini 生图模型");
  if (!prompt) throw new Error("请先填写提示词");

  if (isMidjourneyTaskPayload(payload)) {
    return submitMomoMidjourneyTask(payload, config, inputs, apiKey);
  }

  const taskId = `gemini-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const createdAt = Date.now();
  if (controller) geminiTaskControllers.set(taskId, controller);
  geminiTaskResults.set(taskId, { ok: true, taskId, status: "RUNNING", stillRunning: true, model, createdAt });

  void (async () => {
    try {
      const images = [];
      for (const value of [inputs.mainImage, inputs.referenceImage]) {
        const image = await imageValueToInlineData(value);
        if (image) images.push(image);
      }
      const request = buildGeminiGenerateRequest({
        apiUrl: config.apiUrl,
        apiKey,
        model,
        prompt,
        images,
        aspectRatio: inputs.aspectRatio,
        resolution: inputs.resolution,
        responseModalities: ["TEXT", "IMAGE"]
      });
      const { json, requestId } = await fetchGeminiJson(request, { controller, timeoutMs: getTimeoutMs(payload) });
      const parsed = parseGeminiImageResponse(json);
      if (!parsed.image) {
        const failure = normalizeGeminiFailure({ json });
        if (failure.code === "safety") throw new Error(failure.message);
        const returnedText = parseGeminiTextResponse(json);
        throw new Error(`Gemini 未返回图片${returnedText ? `：${returnedText.slice(0, 240)}` : ""}`);
      }
      const delivery = await createGeminiDelivery(parsed.image, taskId);
      geminiTaskResults.set(taskId, {
        ok: true,
        taskId,
        status: "SUCCEEDED",
        stillRunning: false,
        outputUrl: "",
        dataUrl: delivery.dataUrl,
        filePath: delivery.filePath,
        mimeType: delivery.mimeType,
        byteLength: delivery.byteLength,
        delivery: delivery.delivery,
        providerRequestId: requestId,
        model,
        createdAt,
        finishedAt: Date.now()
      });
    } catch (error) {
      const cancelled = Boolean(controller && controller.signal.aborted) || String(error && error.code || "") === "cancelled";
      geminiTaskResults.set(taskId, {
        ok: false,
        taskId,
        status: cancelled ? "CANCELLED" : "FAILED",
        failed: true,
        stillRunning: false,
        message: cancelled ? "Gemini 任务已取消" : String(error && error.message || error || "Gemini 任务执行失败"),
        model,
        createdAt,
        finishedAt: Date.now()
      });
    } finally {
      geminiTaskControllers.delete(taskId);
    }
  })();

  return { ok: true, taskId, status: "RUNNING", stillRunning: true, immediate: false };
}

function getGeminiTaskResult(taskId) {
  cleanupExpiredResults();
  const result = geminiTaskResults.get(taskId);
  return result ? { ...result } : null;
}

export async function pollThirdPartyGeminiTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const taskId = String(payload.taskId || "").trim();
  if (!taskId) throw new Error("Gemini taskId is missing");
  if (isMidjourneyTaskPayload(payload)) return pollMomoMidjourneyTask(payload);
  const timeoutMs = getTimeoutMs(payload);
  const pollIntervalMs = Math.max(250, Number(payload.settings && payload.settings.pollInterval || 2) * 1000);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = getGeminiTaskResult(taskId);
    if (!result) return { ok: false, taskId, status: "NOT_FOUND", failed: true, stillRunning: false, message: "Gemini 本地任务已过期或不存在" };
    if (!result.stillRunning && String(result.status || "").toUpperCase() !== "RUNNING") {
      return decorateGeminiResultWithCharge(result, payload);
    }
    await sleep(pollIntervalMs);
  }
  return { ok: false, taskId, status: "RUNNING", timedOut: true, stillRunning: true, message: "Gemini 任务仍在运行" };
}

export async function fetchThirdPartyGeminiTaskStatus(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const taskId = String(payload.taskId || "").trim();
  if (!taskId) throw new Error("Gemini taskId is missing");
  if (isMidjourneyTaskPayload(payload)) return fetchMomoMidjourneyTaskStatus(payload, taskId);
  const result = getGeminiTaskResult(taskId);
  if (!result) return { ok: false, taskId, status: "NOT_FOUND", failed: true, stillRunning: false, message: "Gemini 本地任务已过期或不存在" };
  return result.stillRunning ? result : decorateGeminiResultWithCharge(result, payload);
}

export async function cancelThirdPartyGeminiTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const taskId = String(payload.taskId || payload.requestId || "").trim();
  if (!taskId) throw new Error("Gemini taskId is missing");
  if (isMidjourneyTaskPayload(payload)) {
    return { ok: true, taskId, localRequestCancelled: false, removedImmediateResult: false, remoteCancelled: false };
  }
  const controller = geminiTaskControllers.get(taskId);
  if (controller) {
    try {
      controller.abort();
    } catch (_) {}
    geminiTaskControllers.delete(taskId);
  }
  const current = getGeminiTaskResult(taskId);
  geminiTaskResults.set(taskId, {
    ...(current || {}),
    ok: false,
    taskId,
    status: "CANCELLED",
    failed: true,
    stillRunning: false,
    message: "Gemini 任务已取消",
    createdAt: Number(current && current.createdAt) || Date.now(),
    finishedAt: Date.now()
  });
  return { ok: true, taskId, localRequestCancelled: Boolean(controller), removedImmediateResult: false, remoteCancelled: false };
}

export async function checkThirdPartyGeminiEndpoint(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiUrl = String(payload.apiUrl || "").trim().replace(/\/+$/, "");
  if (!apiUrl) throw new Error("缺少要检测的 API 地址");
  const timeoutMs = Math.max(5000, Number(payload.timeoutMs) || 15000);
  try {
    await fetchNewApiJson(apiUrl, "/api/status", "", timeoutMs);
    return { ok: true, apiUrl, message: "服务地址可访问" };
  } catch (error) {
    return { ok: false, apiUrl, message: String(error.message || "服务地址不可达") };
  }
}

export async function listThirdPartyGeminiModels(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const config = getConfig(payload);
  const apiKey = String(config.apiKey || payload.apiKey || "").trim();
  if (!apiKey) throw new Error("请先在第三方支持中配置当前 Gemini 渠道的 API Key");
  const timeoutMs = getTimeoutMs(payload, 30000);
  const requests = [
    { id: "openai", request: buildNewApiModelsRequest({ apiUrl: config.apiUrl, apiKey }) },
    { id: "gemini", request: buildGeminiModelsRequest({ apiUrl: config.apiUrl, apiKey }) },
    { id: "pricing", request: buildNewApiPricingRequest({ apiUrl: config.apiUrl }) }
  ];
  const responses = await Promise.all(requests.map(async ({ id, request }) => {
    try {
      const response = await fetchGeminiJson(request, { timeoutMs });
      return { id, ok: true, json: response.json };
    } catch (error) {
      return { id, ok: false, error };
    }
  }));
  const byId = Object.fromEntries(responses.map((response) => [response.id, response]));
  if (!byId.openai.ok && !byId.gemini.ok) throw (byId.openai.error || byId.gemini.error);

  const openAiModels = byId.openai.ok ? parseNewApiModelsResponse(byId.openai.json) : [];
  const geminiModels = (byId.gemini.ok ? parseGeminiModelsResponse(byId.gemini.json) : []).filter((item) => {
    const methods = item.supportedGenerationMethods;
    return !methods.length || methods.some((method) => String(method).toLowerCase() === "generatecontent");
  });
  const pricingModels = byId.pricing.ok ? parseNewApiPricingResponse(byId.pricing.json) : [];
  const classified = classifyNewApiModels({ openAiModels, geminiModels, pricingModels });
  const channelId = String(config.channelId || payload.channelId || "").trim().toLowerCase();
  if (channelId === "momo") {
    classified.models = classified.models.filter((model) => !isMomoMidjourneyModel(model));
    classified.imageModels = classified.imageModels.filter((model) => !isMomoMidjourneyModel(model));
    classified.details = classified.details.filter((item) => !isMomoMidjourneyModel(item && item.id));
  }
  if (!classified.models.length) throw new Error("当前 NewAPI 渠道未返回可用模型");
  return {
    ok: true,
    ...classified,
    source: "newapi",
    endpoints: {
      openai: Boolean(byId.openai.ok),
      gemini: Boolean(byId.gemini.ok),
      pricing: Boolean(byId.pricing.ok)
    }
  };
}

export async function runThirdPartyGeminiPromptOptimize(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const config = getConfig(payload);
  const apiKey = String(config.apiKey || payload.apiKey || "").trim();
  const model = normalizeGeminiModelId(config.chatModel || config.selectedModel);
  const prompt = String(payload.prompt || "").trim();
  if (!apiKey) throw new Error("请先在第三方支持中配置当前 Gemini 渠道的 API Key");
  if (!model) throw new Error("请先选择 Gemini AI 优化文本模型");
  if (!prompt) throw new Error("请先填写要优化的提示词");
  const request = buildNewApiChatRequest({
    apiUrl: config.apiUrl,
    apiKey,
    model,
    prompt,
    systemInstruction: "你是专业图像生成提示词优化助手。请保留用户意图，补充画面主体、构图、质感、光影、镜头与风格细节。只输出优化后的提示词，不解释。"
  });
  const { json } = await fetchGeminiJson(request, { timeoutMs: getTimeoutMs(payload) });
  const text = parseNewApiChatResponse(json);
  if (!text) {
    throw new Error("当前渠道的 NewAPI 文字模型未返回可用提示词");
  }
  return { ok: true, text, model };
}
