function toMessage(error) {
  return error && error.message ? error.message : String(error || "unknown error");
}

function cloneParseErrorMeta(source, target) {
  if (!source || typeof source !== "object" || !target || typeof target !== "object") return target;
  if (source.code) target.code = String(source.code);
  if (typeof source.retryable === "boolean") target.retryable = source.retryable;
  if (source.appId) target.appId = String(source.appId);
  if (source.endpoint) target.endpoint = String(source.endpoint);
  if (Array.isArray(source.reasons)) {
    target.reasons = source.reasons
      .filter((item) => item !== undefined && item !== null && item !== "")
      .map((item) => String(item));
  }
  return target;
}

function toStructuredError(error) {
  if (error instanceof Error) {
    return cloneParseErrorMeta(error, error);
  }
  const wrapped = new Error(toMessage(error));
  return cloneParseErrorMeta(error, wrapped);
}

async function parseRunninghubAppUsecase(options = {}) {
  const runninghub = options.runninghub;
  const appId = String(options.appId || "").trim();
  const apiKey = String(options.apiKey || "").trim();
  const preferredName = String(options.preferredName || "").trim();
  const log = options.log;

  if (!runninghub || typeof runninghub.fetchAppInfo !== "function") {
    throw new Error("parseRunninghubAppUsecase requires runninghub.fetchAppInfo");
  }
  if (!appId) throw new Error("请先输入有效的应用 ID 或 URL");
  if (!apiKey) throw new Error("请先保存 API Key");

  let data;
  try {
    data = await runninghub.fetchAppInfo(appId, apiKey, { log });
  } catch (error) {
    throw toStructuredError(error);
  }

  if (!data || !Array.isArray(data.inputs) || data.inputs.length === 0) {
    throw new Error("未识别到可用输入参数，请先点击“Load Parse Debug”检查解析详情。");
  }

  return {
    appId,
    name: preferredName || String(data.name || "未命名应用"),
    description: String(data.description || ""),
    inputs: Array.isArray(data.inputs) ? data.inputs : []
  };
}

module.exports = {
  parseRunninghubAppUsecase
};
