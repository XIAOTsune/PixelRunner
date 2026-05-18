const grsTaskControllers = new Map();
const grsImmediateResults = new Map();

const DEFAULT_GRS_HOST = "https://grsaiapi.com";
const DEFAULT_GRS_IMAGE_MODELS = [
  "gpt-image-2",
  "gpt-image-2-vip",
  "nano-banana-pro",
  "nano-banana",
  "nano-banana-fast",
  "nano-banana-2",
  "nano-banana-2-cl",
  "nano-banana-pro-cl",
  "nano-banana-2-4k-cl",
  "nano-banana-pro-vip",
  "nano-banana-pro-4k-vip",
  "nano-banana-pro-vt"
];
const DEFAULT_GRS_CHAT_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5",
  "gpt-5-mini",
  "gemini-3.1-pro",
  "gemini-3.1-flash-lite",
  "gemini-3-flash",
  "gemini-3-pro",
  "gemini-2.5-flash",
  "gemini-2.5-pro"
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function parseJsonSafe(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (_) {
    return null;
  }
}

function normalizeModelId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.replace(/^models\//i, "").replace(/^model\//i, "");
}

function modelCompareKey(value) {
  const stripped = normalizeModelId(value);
  const lower = stripped.toLowerCase();
  const compact = lower.replace(/[\s_-]/g, "");
  const aliasMap = {
    gptimage2: "gpt-image-2",
    gptimage2vip: "gpt-image-2-vip",
    nanobanana: "nano-banana",
    nanobananopro: "nano-banana-pro",
    nanobananofast: "nano-banana-fast",
    nanobanana2: "nano-banana-2",
    nanobanana2cl: "nano-banana-2-cl",
    nanobananaprocl: "nano-banana-pro-cl",
    nanobanana24kcl: "nano-banana-2-4k-cl",
    nanobananaprovip: "nano-banana-pro-vip",
    nanobananapro4kvip: "nano-banana-pro-4k-vip",
    nanobananaprovt: "nano-banana-pro-vt"
  };
  return aliasMap[compact] || lower;
}

function normalizeGrsOutboundModel(value) {
  return modelCompareKey(value);
}

function isGrsGptImageModel(value) {
  return /^gpt-image-2(?:-vip)?$/i.test(normalizeGrsOutboundModel(value));
}

function isGrsNanoBananaModel(value) {
  return /^nano-banana(?:$|-)/i.test(normalizeGrsOutboundModel(value));
}

function isGrsImageModel(value) {
  return isGrsGptImageModel(value) || isGrsNanoBananaModel(value);
}

function isGrsChatModel(value) {
  const model = normalizeGrsOutboundModel(value);
  return /^(gpt-5(?:\.[0-9]+)?(?:-mini)?|gpt-4\.1(?:-mini)?|gpt-4o(?:-mini)?|gemini-(?:3(?:\.1)?|2\.5)(?:-[a-z0-9.-]+)?|deepseek-chat|qwen(?:[-+].*)?|claude-3-5-sonnet)$/i.test(model);
}

function uniqueModels(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const text = normalizeModelId(value);
    const key = modelCompareKey(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

function getGrsHost(apiUrl) {
  try {
    const url = new URL(String(apiUrl || "").trim() || DEFAULT_GRS_HOST);
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return DEFAULT_GRS_HOST;
  }
}

function getEndpoint(apiUrl, path) {
  const raw = String(apiUrl || "").trim();
  if (path === "/v1/api/generate" && /\/v1\/api\/generate\/?$/i.test(raw)) return raw;
  if (path === "/v1/images/generations" && /\/v1\/images\/generations\/?$/i.test(raw)) return raw;
  if (path === "/v1/chat/completions" && /\/v1\/chat\/completions\/?$/i.test(raw)) return raw;
  return `${getGrsHost(raw)}${path}`;
}

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function parseDataUrl(value) {
  const match = String(value || "").trim().match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: String(match[1] || "application/octet-stream").trim() || "application/octet-stream",
    base64: String(match[2] || "").trim()
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
  if (!normalized) throw new Error("图片 base64 数据无效");
  const binaryString = atob(normalized);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes.buffer;
}

function imageValueToBlob(imageValue) {
  if (!imageValue || typeof imageValue !== "object") throw new Error("图片输入为空");
  const dataUrl = String(imageValue.dataUrl || "").trim();
  const base64 = String(imageValue.base64 || "").trim();
  const mimeType = String(imageValue.mimeType || "image/png").trim() || "image/png";
  if (dataUrl) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) throw new Error("图片 data URL 无效");
    return new Blob([base64ToArrayBuffer(parsed.base64)], { type: parsed.mimeType || mimeType });
  }
  if (base64) {
    return new Blob([base64ToArrayBuffer(base64)], { type: mimeType });
  }
  throw new Error("图片输入缺少可上传的数据");
}

async function uploadImageToGrs(apiUrl, apiKey, imageValue) {
  if (imageValue && typeof imageValue === "object" && String(imageValue.url || "").trim()) {
    return String(imageValue.url || "").trim();
  }

  const host = getGrsHost(apiUrl);
  const tokenResponse = await fetch(`${host}/client/resource/newUploadTokenZH`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ sux: "png" })
  });
  const tokenText = await tokenResponse.text().catch(() => "");
  const tokenJson = parseJsonSafe(tokenText);
  if (!tokenResponse.ok) {
    throw new Error(`获取 GRS 上传 Token 失败：HTTP ${tokenResponse.status} ${extractApiError(tokenJson, tokenText)}`);
  }

  const data = tokenJson && tokenJson.data ? tokenJson.data : {};
  const token = data.token;
  const key = data.key;
  const uploadUrl = data.url;
  const domain = data.domain;
  if (!token || !key || !uploadUrl || !domain) throw new Error("GRS 上传 Token 数据不完整");

  const formData = new FormData();
  formData.append("token", token);
  formData.append("key", key);
  formData.append("file", imageValueToBlob(imageValue), "pixelrunner.png");

  const uploadResponse = await fetch(uploadUrl, { method: "POST", body: formData });
  if (!uploadResponse.ok) {
    const text = await uploadResponse.text().catch(() => "");
    throw new Error(`上传图片到 GRS 失败：HTTP ${uploadResponse.status} ${text.slice(0, 200)}`);
  }
  return `${domain}/${key}`;
}

function extractApiError(json, rawText) {
  const obj = json && typeof json === "object" ? json : {};
  const err = obj.error || obj.errors || obj.message || obj.msg || obj.detail;
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err && typeof err === "object") return String(err.message || err.msg || JSON.stringify(err)).slice(0, 500);
  return String(rawText || "").slice(0, 500);
}

function getFailureMessage(value, rawText = "") {
  const obj = value && typeof value === "object" ? value : {};
  const status = String(obj.status || obj.state || (obj.data && obj.data.status) || "").toLowerCase();
  const error = obj.error || obj.errors || obj.failure_reason || obj.message || obj.msg || (obj.data && (obj.data.error || obj.data.message));
  if (status && /failed|error|cancelled|canceled/.test(status)) {
    return typeof error === "string" && error.trim() ? error.trim() : `GRS 任务失败：${status}`;
  }
  if (error && typeof error === "object") return String(error.message || error.msg || JSON.stringify(error)).slice(0, 500);
  if (typeof error === "string" && /failed|error|失败|错误/.test(error)) return error.trim();
  const text = String(rawText || "");
  if (/insufficient|forbidden|unauthorized|余额不足|欠费/i.test(text)) return text.slice(0, 500);
  return "";
}

function findImageUrl(value, depth = 0) {
  if (value == null || depth > 7) return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (/^https?:\/\/.+\.(png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(text)) return text;
    if (/^https?:\/\/.+\/file\//i.test(text)) return text;
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageUrl(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";

  for (const key of ["url", "image", "imageUrl", "image_url", "output", "fileUrl", "downloadUrl"]) {
    const found = findImageUrl(value[key], depth + 1);
    if (found) return found;
  }
  for (const key of ["results", "data", "result", "outputs", "images", "files", "items"]) {
    const found = findImageUrl(value[key], depth + 1);
    if (found) return found;
  }
  for (const key of Object.keys(value)) {
    const found = findImageUrl(value[key], depth + 1);
    if (found) return found;
  }
  return "";
}

function extractGrsTaskId(value) {
  if (!value || typeof value !== "object") return "";
  const data = value.data && typeof value.data === "object" ? value.data : null;
  const id = value.id || value.taskId || value.task_id || value.jobId || value.job_id ||
    (data && (data.id || data.taskId || data.task_id || data.jobId || data.job_id));
  return String(id || "").trim();
}

function extractTaskStatus(value) {
  if (!value || typeof value !== "object") return "";
  const data = value.data && typeof value.data === "object" ? value.data : null;
  return String(value.status || value.state || value.taskStatus || (data && (data.status || data.state)) || "").toUpperCase();
}

function isPendingStatus(status) {
  return ["PENDING", "RUNNING", "PROCESSING", "QUEUED", "QUEUE", "WAITING", "IN_PROGRESS", "CREATED", "SUBMITTED"].includes(String(status || "").toUpperCase());
}

function isFailedStatus(status) {
  return ["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(String(status || "").toUpperCase());
}

async function fetchJson(url, options = {}, timeoutMs = 30000, controller = null) {
  const localController = controller || (typeof AbortController !== "undefined" ? new AbortController() : null);
  const timer = localController
    ? setTimeout(() => {
        try {
          localController.abort();
        } catch (_) {}
      }, Math.max(5000, Number(timeoutMs) || 30000))
    : null;
  try {
    const response = await fetch(url, {
      ...options,
      signal: localController ? localController.signal : options.signal
    });
    const rawText = await response.text().catch(() => "");
    const json = parseJsonSafe(rawText);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${extractApiError(json, rawText)}`.trim());
    return { json, rawText };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolveAspectRatio(model, value) {
  const text = String(value || "").trim();
  if (text && text !== "auto") return text;
  return isGrsGptImageModel(model) ? "1024x1024" : "1:1";
}

function resolveResolution(model, value) {
  const text = String(value || "").trim();
  if (text && text !== "auto") return text;
  return isGrsNanoBananaModel(model) ? "1K" : "1024x1024";
}

function buildImageRequestBody(payload, imageUrls) {
  const inputs = payload.inputs && typeof payload.inputs === "object" ? payload.inputs : {};
  const model = normalizeGrsOutboundModel(inputs.model || "gpt-image-2");
  const prompt = String(inputs.prompt || "").trim();
  const aspectRatio = resolveAspectRatio(model, inputs.aspectRatio);
  const resolution = resolveResolution(model, inputs.resolution);
  const adapter = String(payload.adapter || inputs.adapter || "grs-image-generate").trim();

  if (adapter === "grs-image-openai") {
    return {
      endpointPath: "/v1/images/generations",
      body: {
        model,
        prompt,
        image: imageUrls,
        size: resolution || "1024x1024",
        response_format: "url"
      }
    };
  }

  const body = {
    model,
    prompt,
    images: imageUrls,
    aspectRatio,
    replyType: "json"
  };
  if (isGrsNanoBananaModel(model)) body.imageSize = /^(\d+k)$/i.test(resolution) ? resolution.toUpperCase() : "1K";
  return { endpointPath: "/v1/api/generate", body };
}

function normalizeSubmitResult(json, rawText, apiUrl) {
  const failureMessage = getFailureMessage(json, rawText);
  if (failureMessage) throw new Error(failureMessage);

  const outputUrl = findImageUrl(json || rawText);
  const taskId = extractGrsTaskId(json);
  const status = extractTaskStatus(json);
  if (outputUrl) {
    const localTaskId = taskId || `grs-immediate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    grsImmediateResults.set(localTaskId, {
      taskId: localTaskId,
      status: "SUCCEEDED",
      outputUrl,
      raw: json || rawText,
      apiUrl
    });
    return { ok: true, taskId: localTaskId, outputUrl, immediate: true, result: json };
  }
  if (taskId) return { ok: true, taskId, status: status || "RUNNING", result: json };
  throw new Error("GRS 未返回可识别的任务 ID 或图片地址");
}

export async function submitThirdPartyGrsTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const config = payload.config && typeof payload.config === "object" ? payload.config : {};
  const inputs = payload.inputs && typeof payload.inputs === "object" ? payload.inputs : {};
  const apiUrl = String(config.apiUrl || DEFAULT_GRS_HOST).trim() || DEFAULT_GRS_HOST;
  const apiKey = String(config.apiKey || "").trim();
  const timeoutMs = Math.max(10000, Number(payload.settings && payload.settings.timeout || 180) * 1000);

  if (!apiKey) throw new Error("请先在第三方支持中配置 GRS API Key");
  if (!String(inputs.prompt || "").trim()) throw new Error("请先填写提示词");
  if (!String(inputs.model || "").trim()) throw new Error("请先选择 GRS 生图模型");

  const imageValues = [inputs.mainImage, inputs.referenceImage].filter((item) => {
    if (!item || typeof item !== "object") return false;
    return Boolean(String(item.url || item.dataUrl || item.base64 || "").trim());
  });
  const imageUrls = [];
  for (const imageValue of imageValues) {
    imageUrls.push(await uploadImageToGrs(apiUrl, apiKey, imageValue));
  }

  const request = buildImageRequestBody(payload, imageUrls);
  const endpoint = getEndpoint(apiUrl, request.endpointPath);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const { json, rawText } = await fetchJson(
    endpoint,
    {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify(request.body)
    },
    timeoutMs,
    controller
  );
  const result = normalizeSubmitResult(json, rawText, apiUrl);
  if (controller && result.taskId && !result.immediate) grsTaskControllers.set(result.taskId, controller);
  return result;
}

function buildPollResponse(taskId, json, rawText = "") {
  const failureMessage = getFailureMessage(json, rawText);
  const outputUrl = findImageUrl(json || rawText);
  const status = extractTaskStatus(json);
  return {
    ok: Boolean(outputUrl && !failureMessage),
    taskId,
    status,
    outputUrl,
    failed: Boolean(failureMessage || isFailedStatus(status)),
    stillRunning: isPendingStatus(status) || (!outputUrl && !failureMessage),
    message: failureMessage,
    raw: json || null
  };
}

export async function pollThirdPartyGrsTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || (payload.config && payload.config.apiKey) || "").trim();
  const apiUrl = String(payload.apiUrl || (payload.config && payload.config.apiUrl) || DEFAULT_GRS_HOST).trim() || DEFAULT_GRS_HOST;
  const taskId = String(payload.taskId || "").trim();
  const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
  if (!apiKey) throw new Error("请先在第三方支持中配置 GRS API Key");
  if (!taskId) throw new Error("GRS taskId is missing");

  const immediate = grsImmediateResults.get(taskId);
  if (immediate) return { ok: true, taskId, status: "SUCCEEDED", outputUrl: immediate.outputUrl, result: immediate.raw };

  const pollIntervalMs = Math.max(1, Number(settings.pollInterval) || 2) * 1000;
  const timeoutMs = Math.max(10, Number(settings.timeout) || 180) * 1000;
  const startedAt = Date.now();
  const controller = grsTaskControllers.get(taskId) || (typeof AbortController !== "undefined" ? new AbortController() : null);
  if (controller) grsTaskControllers.set(taskId, controller);
  const resultUrl = `${getGrsHost(apiUrl)}/v1/api/result?id=${encodeURIComponent(taskId)}`;
  let lastResult = null;

  try {
    while (Date.now() - startedAt < timeoutMs) {
      if (controller && controller.signal.aborted) throw new Error("GRS task polling cancelled");
      const { json, rawText } = await fetchJson(resultUrl, { method: "GET", headers: authHeaders(apiKey) }, 30000, controller);
      lastResult = buildPollResponse(taskId, json, rawText);
      if (lastResult.outputUrl) return { ...lastResult, ok: true, result: json };
      if (lastResult.failed) return { ...lastResult, ok: false, result: json };
      await sleep(pollIntervalMs);
    }
    return {
      ok: false,
      taskId,
      timedOut: true,
      status: lastResult && lastResult.status ? lastResult.status : "TIMEOUT",
      stillRunning: !lastResult || lastResult.stillRunning,
      failed: Boolean(lastResult && lastResult.failed),
      outputUrl: "",
      message: lastResult && lastResult.message ? lastResult.message : "GRS 任务等待超时",
      result: lastResult && lastResult.raw ? lastResult.raw : null
    };
  } finally {
    grsTaskControllers.delete(taskId);
  }
}

export async function fetchThirdPartyGrsTaskStatus(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiKey = String(payload.apiKey || (payload.config && payload.config.apiKey) || "").trim();
  const apiUrl = String(payload.apiUrl || (payload.config && payload.config.apiUrl) || DEFAULT_GRS_HOST).trim() || DEFAULT_GRS_HOST;
  const taskId = String(payload.taskId || "").trim();
  if (!apiKey) throw new Error("请先在第三方支持中配置 GRS API Key");
  if (!taskId) throw new Error("GRS taskId is missing");

  const immediate = grsImmediateResults.get(taskId);
  if (immediate) return { ok: true, taskId, status: "SUCCEEDED", outputUrl: immediate.outputUrl, raw: immediate.raw };

  const resultUrl = `${getGrsHost(apiUrl)}/v1/api/result?id=${encodeURIComponent(taskId)}`;
  const { json, rawText } = await fetchJson(resultUrl, { method: "GET", headers: authHeaders(apiKey) }, Math.max(5000, Number(payload.timeoutMs) || 30000));
  return buildPollResponse(taskId, json, rawText);
}

export async function cancelThirdPartyGrsTask(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const taskId = String(payload.taskId || "").trim();
  if (!taskId) throw new Error("GRS taskId is missing");
  const controller = grsTaskControllers.get(taskId);
  if (controller && typeof controller.abort === "function") {
    try {
      controller.abort();
    } catch (_) {}
  }
  grsTaskControllers.delete(taskId);
  return { ok: true, taskId };
}

function collectModelIds(value, output, depth = 0) {
  if (depth > 5 || value == null) return;
  if (typeof value === "string") {
    const model = normalizeModelId(value);
    if (model) output.push(model);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectModelIds(item, output, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  const raw = value.id || value.name || value.model;
  if (raw) output.push(normalizeModelId(raw));
  ["data", "models", "items", "result", "results", "list"].forEach((key) => collectModelIds(value[key], output, depth + 1));
}

export async function listThirdPartyGrsModels(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const apiUrl = String(payload.apiUrl || DEFAULT_GRS_HOST).trim() || DEFAULT_GRS_HOST;
  const apiKey = String(payload.apiKey || "").trim();
  const kind = String(payload.kind || "image").trim();
  if (!apiKey) throw new Error("请先填写 GRS API Key");

  const fallback = kind === "chat" ? DEFAULT_GRS_CHAT_MODELS : DEFAULT_GRS_IMAGE_MODELS;
  const url = `${getGrsHost(apiUrl)}/v1/models`;
  try {
    const { json } = await fetchJson(url, { method: "GET", headers: authHeaders(apiKey) }, 30000);
    const models = [];
    collectModelIds(json, models);
    const filtered = uniqueModels(models).filter(kind === "chat" ? isGrsChatModel : isGrsImageModel);
    return { models: filtered.length ? filtered : fallback };
  } catch (error) {
    return { models: fallback, warning: error && error.message ? error.message : String(error || "") };
  }
}

function extractChatText(json, rawText = "") {
  if (!json || typeof json !== "object") return String(rawText || "").trim();
  const choices = Array.isArray(json.choices) ? json.choices : [];
  for (const choice of choices) {
    const message = choice && choice.message;
    const content = message && message.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const text = content.map((item) => item && (item.text || item.content || item.value)).filter(Boolean).join("\n").trim();
      if (text) return text;
    }
  }
  return String(json.text || json.output_text || (json.data && json.data.text) || "").trim();
}

export async function runThirdPartyGrsPromptOptimize(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const config = payload.config && typeof payload.config === "object" ? payload.config : {};
  const apiUrl = String(config.apiUrl || DEFAULT_GRS_HOST).trim() || DEFAULT_GRS_HOST;
  const apiKey = String(config.apiKey || "").trim();
  const model = normalizeGrsOutboundModel(config.chatModel || DEFAULT_GRS_CHAT_MODELS[0]);
  const prompt = String(payload.prompt || "").trim();
  if (!apiKey) throw new Error("请先在第三方支持中配置 GRS API Key");
  if (!prompt) throw new Error("请先填写要优化的提示词");

  const systemPrompt = "你是专业图像生成提示词优化助手。请保留用户意图，补充画面主体、构图、质感、光影、镜头与风格细节。只输出优化后的提示词，不解释。";
  const { json, rawText } = await fetchJson(
    getEndpoint(apiUrl, "/v1/chat/completions"),
    {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ]
      })
    },
    Math.max(30000, Number(payload.timeout || 180) * 1000)
  );
  const text = extractChatText(json, rawText);
  if (!text) throw new Error("GRS 文本模型未返回可用提示词");
  return { ok: true, text, model, raw: json };
}
