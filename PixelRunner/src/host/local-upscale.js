const DEFAULT_LOCAL_UPSCALE_BASE_URL = "http://127.0.0.1:17836";
export const LOCAL_UPSCALE_PROTOCOL_VERSION = "2";
export const LOCAL_UPSCALE_BUILD_ID = "PixelRunnerV2.7.3-local-ai";

export function normalizeLocalUpscaleBaseUrl(value) {
  const raw = String(value || DEFAULT_LOCAL_UPSCALE_BASE_URL).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw new Error("本地超分服务地址无效");
  }
  const hostname = String(parsed.hostname || "").toLowerCase();
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(hostname)) {
    throw new Error("本地超分服务仅允许使用 http://127.0.0.1 或 http://localhost");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeLocalUpscaleJob(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const jobId = String(source.jobId || "").trim();
  const inputPath = String(source.inputPath || "").trim();
  const outputPath = String(source.outputPath || "").trim();
  const scale = Math.floor(Number(source.scale) || 0);
  const requestedTile = Math.floor(Number(source.tile) || 0);
  const targetWidth = Math.max(0, Math.floor(Number(source.targetWidth) || 0));
  const targetHeight = Math.max(0, Math.floor(Number(source.targetHeight) || 0));
  const tile = requestedTile === 0
    ? 128
    : Math.max(32, Math.min(1024, requestedTile));
  if (!jobId || !/^[a-z0-9_-]{6,128}$/i.test(jobId)) throw new Error("本地超分任务编号无效");
  if (!inputPath || !outputPath) throw new Error("本地超分缺少输入或输出文件路径");
  if (scale !== 1) throw new Error("本地超分必须使用完整画布输入");
  return {
    jobId,
    inputPath,
    outputPath,
    scale,
    tile,
    tta: Boolean(source.tta),
    debug: Boolean(source.debug),
    targetWidth,
    targetHeight,
    protocolVersion: LOCAL_UPSCALE_PROTOCOL_VERSION,
    buildId: LOCAL_UPSCALE_BUILD_ID
  };
}

function normalizeArgs(args = []) {
  const source = Array.isArray(args) ? args[0] : args;
  return source && typeof source === "object" ? source : {};
}

function getJobId(args = []) {
  const jobId = String(normalizeArgs(args).jobId || "").trim();
  if (!jobId || !/^[a-z0-9_-]{6,128}$/i.test(jobId)) throw new Error("本地超分任务编号无效");
  return jobId;
}

function assertCompatibleService(payload) {
  const protocolVersion = String(payload && payload.protocolVersion || "").trim();
  const buildId = String(payload && payload.buildId || "").trim();
  if (protocolVersion !== LOCAL_UPSCALE_PROTOCOL_VERSION || buildId !== LOCAL_UPSCALE_BUILD_ID) {
    throw new Error("本地超分服务版本不匹配，请重新启动 PixelRunner Local AI");
  }
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      }
    });
  } catch (error) {
    throw new Error(`无法连接 PixelRunner Local AI：${String(error && error.message ? error.message : error || "网络错误")}`);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(String(payload && (payload.error || payload.message) || `本地超分服务返回 HTTP ${response.status}`));
  }
  return payload && typeof payload === "object" ? payload : {};
}

function getBaseUrl(args = []) {
  return normalizeLocalUpscaleBaseUrl(normalizeArgs(args).baseUrl);
}

export async function getLocalUpscaleHealth(args = []) {
  const baseUrl = getBaseUrl(args);
  const payload = await requestJson(`${baseUrl}/v1/health`);
  assertCompatibleService(payload);
  return {
    ...payload,
    ok: payload.ok !== false,
    ready: payload.ready !== false,
    baseUrl
  };
}

export async function submitLocalUpscaleJob(args = []) {
  const request = normalizeLocalUpscaleJob(normalizeArgs(args));
  const baseUrl = getBaseUrl(args);
  const payload = await requestJson(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  assertCompatibleService(payload);
  const jobId = String(payload.jobId || request.jobId).trim();
  if (!jobId) throw new Error("本地超分服务未返回任务编号");
  return { ...payload, jobId, baseUrl };
}

export async function getLocalUpscaleJob(args = []) {
  const jobId = getJobId(args);
  const baseUrl = getBaseUrl(args);
  const payload = await requestJson(`${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}`);
  assertCompatibleService(payload);
  const resultPath = String(payload.resultPath || "").trim();
  const resultUrl = String(payload.resultUrl || "").trim() || (resultPath ? `${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/result` : "");
  return { ...payload, jobId, resultUrl, baseUrl };
}

export async function cancelLocalUpscaleJob(args = []) {
  const jobId = getJobId(args);
  const baseUrl = getBaseUrl(args);
  const payload = await requestJson(`${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST"
  });
  assertCompatibleService(payload);
  return { ...payload, jobId, baseUrl };
}

export async function recordLocalUpscalePlacement(args = []) {
  const payload = normalizeArgs(args);
  const jobId = getJobId([payload]);
  const baseUrl = getBaseUrl(args);
  const request = {
    protocolVersion: LOCAL_UPSCALE_PROTOCOL_VERSION,
    buildId: LOCAL_UPSCALE_BUILD_ID,
    width: Math.max(0, Math.floor(Number(payload.width) || 0)),
    height: Math.max(0, Math.floor(Number(payload.height) || 0)),
    layerId: Math.max(0, Math.floor(Number(payload.layerId) || 0)),
    documentId: Math.max(0, Math.floor(Number(payload.documentId) || 0))
  };
  const response = await requestJson(`${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/placement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  assertCompatibleService(response);
  return { ...response, jobId, baseUrl };
}
