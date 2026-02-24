function toMessage(error) {
  return error && error.message ? error.message : String(error || "unknown error");
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
    throw new Error(toMessage(error));
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
