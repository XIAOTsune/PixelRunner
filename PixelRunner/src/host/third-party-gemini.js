import {
  buildGeminiGenerateRequest,
  buildGeminiModelsRequest,
  buildNewApiChatRequest,
  buildNewApiModelsRequest,
  buildNewApiPricingRequest,
  classifyNewApiModels,
  normalizeGeminiFailure,
  normalizeGeminiModelId,
  parseGeminiImageResponse,
  parseGeminiModelsResponse,
  parseGeminiTextResponse,
  parseNewApiChatResponse,
  parseNewApiModelsResponse,
  parseNewApiPricingResponse
} from "../shared/gemini-config.js";
import { ensureDeps } from "./photoshop/deps.js";

const geminiTaskControllers = new Map();
const geminiImmediateResults = new Map();
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
    return { json, rawText };
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
  for (const [taskId, result] of geminiImmediateResults.entries()) {
    if (now - Number(result.createdAt || 0) > GEMINI_RESULT_TTL_MS) geminiImmediateResults.delete(taskId);
  }
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

  const images = [];
  for (const value of [inputs.mainImage, inputs.referenceImage]) {
    const image = await imageValueToInlineData(value);
    if (image) images.push(image);
  }

  const requestId = String(payload.requestId || `gemini-request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  if (controller) geminiTaskControllers.set(requestId, controller);
  try {
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
    const { json } = await fetchGeminiJson(request, { controller, timeoutMs: getTimeoutMs(payload) });
    const parsed = parseGeminiImageResponse(json);
    if (!parsed.image) {
      const failure = normalizeGeminiFailure({ json });
      if (failure.code === "safety") throw new Error(failure.message);
      const returnedText = parseGeminiTextResponse(json);
      throw new Error(`Gemini 未返回图片${returnedText ? `：${returnedText.slice(0, 240)}` : ""}`);
    }
    const taskId = `gemini-immediate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const delivery = await createGeminiDelivery(parsed.image, taskId);
    const result = {
      ok: true,
      taskId,
      status: "SUCCEEDED",
      outputUrl: "",
      dataUrl: delivery.dataUrl,
      filePath: delivery.filePath,
      mimeType: delivery.mimeType,
      byteLength: delivery.byteLength,
      delivery: delivery.delivery,
      createdAt: Date.now()
    };
    geminiImmediateResults.set(taskId, result);
    return { ...result, immediate: true };
  } finally {
    geminiTaskControllers.delete(requestId);
  }
}

function getImmediateResult(taskId) {
  cleanupExpiredResults();
  const result = geminiImmediateResults.get(taskId);
  if (!result) return null;
  return { ...result, ok: true, status: "SUCCEEDED" };
}

export async function pollThirdPartyGeminiTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const taskId = String(payload.taskId || "").trim();
  if (!taskId) throw new Error("Gemini taskId is missing");
  const result = getImmediateResult(taskId);
  if (result) return result;
  return { ok: false, taskId, status: "NOT_FOUND", failed: true, stillRunning: false, message: "Gemini 本地结果已过期或不存在" };
}

export async function fetchThirdPartyGeminiTaskStatus(args = []) {
  return pollThirdPartyGeminiTask(args);
}

export async function cancelThirdPartyGeminiTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const taskId = String(payload.taskId || payload.requestId || "").trim();
  if (!taskId) throw new Error("Gemini taskId is missing");
  const controller = geminiTaskControllers.get(taskId);
  if (controller) {
    try {
      controller.abort();
    } catch (_) {}
    geminiTaskControllers.delete(taskId);
  }
  const removedImmediateResult = geminiImmediateResults.delete(taskId);
  return { ok: true, taskId, localRequestCancelled: Boolean(controller), removedImmediateResult, remoteCancelled: false };
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
