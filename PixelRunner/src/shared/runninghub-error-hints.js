const RUNNINGHUB_ERROR_HINTS = Object.freeze({
  "301": "请求参数缺失或格式不正确，请检查必填项和参数格式。",
  PARAMS_INVALID: "请求参数缺失或格式不正确，请检查必填项和参数格式。",
  "380": "工作流或 AI 应用不存在，请检查应用 ID 或重新解析应用。",
  "901": "工作流或 AI 应用不存在，请检查应用 ID 或重新解析应用。",
  WORKFLOW_NOT_EXISTS: "工作流或 AI 应用不存在，请检查应用 ID 或重新解析应用。",
  WEBAPP_NOT_EXISTS: "工作流或 AI 应用不存在，请检查应用 ID 或重新解析应用。",
  "415": "云端资源或并发队列已满，请等待后再运行；不要连续重复提交。",
  "421": "云端资源或并发队列已满，请等待后再运行；不要连续重复提交。",
  TASK_INSTANCE_MAXED: "云端资源或并发队列已满，请等待后再运行；不要连续重复提交。",
  TASK_QUEUE_MAXED: "云端资源或并发队列已满，请等待后再运行；不要连续重复提交。",
  "416": "RunningHub 账户可用余额或积分不足，请到对应区域控制台核对。",
  TASK_CREATE_FAILED_BY_NOT_ENOUGH_WALLET: "RunningHub 账户可用余额或积分不足，请到对应区域控制台核对。",
  "433": "工作流输入或节点参数不匹配，请重新解析应用，并检查节点 ID 和输入字段。",
  "803": "工作流输入或节点参数不匹配，请重新解析应用，并检查节点 ID 和输入字段。",
  VALIDATE_PROMPT_FAILED: "工作流输入或节点参数不匹配，请重新解析应用，并检查节点 ID 和输入字段。",
  APIKEY_INVALID_NODE_INFO: "工作流输入或节点参数不匹配，请重新解析应用，并检查节点 ID 和输入字段。",
  "435": "当前账号没有所选 Plus/Ultra 实例权限，请改用默认模式或检查权益。",
  TASK_USER_EXCLAPI_INSTANCE_NOT_FOUND: "当前账号没有所选 Plus/Ultra 实例权限，请改用默认模式或检查权益。",
  "436": "专属资源会员或服务可能已过期，请检查 RunningHub 权益。",
  TASK_USER_EXCLAPI_REQUIRED: "专属资源会员或服务可能已过期，请检查 RunningHub 权益。",
  "801": "当前账号或 API Key 类型不支持 API 调用，请核对账号等级和 Key 类型。",
  APIKEY_UNSUPPORTED_FREE_USER: "当前账号或 API Key 类型不支持 API 调用，请核对账号等级和 Key 类型。",
  "802": "API Key 无效或权限不匹配，请检查区域和 Key 类型。",
  "811": "API Key 无效或权限不匹配，请检查区域和 Key 类型。",
  "806": "RunningHub API Key 对应的账号不存在，请检查 Key 和服务区域。",
  APIKEY_USER_NOT_FOUND: "RunningHub API Key 对应的账号不存在，请检查 Key 和服务区域。",
  APIKEY_UNAUTHORIZED: "API Key 无效或权限不匹配，请检查区域和 Key 类型。",
  CORPAPIKEY_INVALID: "API Key 无效或权限不匹配，请检查区域和 Key 类型。",
  "804": "任务仍在运行，请继续跟踪现有任务，不要重新提交。",
  APIKEY_TASK_IS_RUNNING: "任务仍在运行，请继续跟踪现有任务，不要重新提交。",
  "813": "任务仍在排队，请继续跟踪现有任务，不要重新提交。",
  APIKEY_TASK_IS_QUEUED: "任务仍在排队，请继续跟踪现有任务，不要重新提交。",
  "805": "RunningHub 未能确认任务的最终状态。请保留任务 ID，在平台任务详情中检查失败节点、内容审核提示或渠道状态。",
  "807": "云端任务记录不存在，请保留任务 ID 并查看平台原始详情。",
  APIKEY_TASK_STATUS_ERROR: "RunningHub 未能确认任务的最终状态。请保留任务 ID，在平台任务详情中检查失败节点、内容审核提示或渠道状态。",
  APIKEY_TASK_NOT_FOUND: "RunningHub 未找到该任务记录，请保留任务 ID 并确认登录区域和任务所属账号。",
  "808": "图片上传失败，请检查网络后重试。",
  "809": "图片文件超过平台限制，请压缩图片后重试。",
  APIKEY_UPLOAD_FAILED: "图片上传失败，请检查网络后重试。",
  APIKEY_FILE_SIZE_EXCEEDED: "图片文件超过平台限制，请压缩图片后重试。",
  "810": "请先在 RunningHub 保存应用或工作流，并按平台要求手动运行一次。",
  WORKFLOW_NOT_SAVED_OR_NOT_RUNNING: "请先在 RunningHub 保存应用或工作流，并按平台要求手动运行一次。",
  "812": "企业账户余额不足，请联系团队管理员充值或分配额度。",
  CORPAPIKEY_INSUFFICIENT_FUNDS: "企业账户余额不足，请联系团队管理员充值或分配额度。"
});

export function getRunningHubErrorHint(errorCode) {
  const code = String(errorCode == null ? "" : errorCode).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(RUNNINGHUB_ERROR_HINTS, code) ? RUNNINGHUB_ERROR_HINTS[code] : "";
}

export function isRunningHubPendingErrorCode(errorCode) {
  return ["804", "813", "APIKEY_TASK_IS_RUNNING", "APIKEY_TASK_IS_QUEUED"].includes(
    String(errorCode == null ? "" : errorCode).trim().toUpperCase()
  );
}

export function normalizeRunningHubErrorCode(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (/^\d{1,6}$/.test(text)) return Number(text);
  return Object.prototype.hasOwnProperty.call(RUNNINGHUB_ERROR_HINTS, text) ? text : null;
}

// Diagnose raw messages in memory; never echo any part of platform text.
export function getRunningHubSafeError(message, errorCode = null, httpStatus = 0) {
  const code = normalizeRunningHubErrorCode(errorCode);
  const raw = typeof message === "string" ? message : "";
  let diagnostic = "";
  if (/content.?policy|safety|moderation|sensitive|nsfw|审核|内容安全|敏感|违规|不合规|违禁/i.test(raw)) {
    diagnostic = "任务未通过 RunningHub 内容审核或安全检测，请调整提示词或输入图片后重试。";
  } else if (/missing (?:required )?nodes?|(?:missing|required) node|node (?:not found|missing|invalid|error|failed|does not exist)|node_errors|节点.{0,10}(?:缺失|不存在|错误|异常|失败)|(?:缺失|找不到|不存在).{0,10}节点|节点报错|缺少节点/i.test(raw)) {
    diagnostic = "工作流包含缺失或异常节点，请在 RunningHub 打开工作流，修复报错节点后重新运行。";
  } else if (/channel.{0,16}(?:not found|missing|invalid|unavailable|disabled|error|failed|does not exist)|(?:not found|invalid|unavailable|disabled).{0,16}channel|渠道.{0,8}(?:错误|异常|不存在|不可用|未配置)|通道.{0,8}(?:错误|异常|不存在|不可用|未配置)|频道.{0,8}(?:错误|异常|不存在|不可用|未配置)/i.test(raw)) {
    diagnostic = "RunningHub 当前渠道或模型服务不可用或配置错误，请检查应用所用渠道后重试。";
  }
  if (!diagnostic) diagnostic = getRunningHubErrorHint(code);
  if (!diagnostic) {
    if (/insufficient|not enough|balance|quota|余额不足|欠费|额度不足/i.test(raw)) {
      diagnostic = "RunningHub 账户余额或额度不足，请充值或检查额度后重试。";
    } else if (httpStatus === 401 || /api.?key|unauthorized|forbidden|invalid token|鉴权|认证/i.test(raw)) {
      diagnostic = "RunningHub 鉴权失败，请检查 API Key、账号权限和区域设置。";
    } else if (httpStatus === 403) {
      diagnostic = "RunningHub 拒绝了本次请求，请检查账号或应用权限。";
    } else if (httpStatus === 429) {
      diagnostic = "RunningHub 请求过于频繁，请稍后再试。";
    } else if (httpStatus >= 500) {
      diagnostic = "RunningHub 云端服务暂时异常，请稍后重试。";
    } else if (/timeout|timed out|超时/i.test(raw)) {
      diagnostic = "RunningHub 任务等待超时，尚未确认最终结果，请继续追踪现有任务。";
    } else if (/^任务已取消[。.]?$|^Task polling cancelled$|^cancelled$|^canceled$/i.test(raw)) {
      diagnostic = "任务已取消。";
    } else {
      diagnostic = "RunningHub 任务执行失败，平台详情已隐藏以保护隐私。请保留任务 ID，到平台任务页面查看原因。";
    }
  }
  return { errorCode: code, message: `${diagnostic}${code == null ? "" : `（错误码 ${code}）`}` };
}
