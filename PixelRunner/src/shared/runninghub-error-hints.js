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
  "433": "应用输入或节点参数不匹配，请重新解析应用并检查字段。",
  "803": "应用输入或节点参数不匹配，请重新解析应用并检查字段。",
  VALIDATE_PROMPT_FAILED: "应用输入或节点参数不匹配，请重新解析应用并检查字段。",
  APIKEY_INVALID_NODE_INFO: "应用输入或节点参数不匹配，请重新解析应用并检查字段。",
  "435": "当前账号没有所选 Plus/Ultra 实例权限，请改用默认模式或检查权益。",
  TASK_USER_EXCLAPI_INSTANCE_NOT_FOUND: "当前账号没有所选 Plus/Ultra 实例权限，请改用默认模式或检查权益。",
  "436": "专属资源会员或服务可能已过期，请检查 RunningHub 权益。",
  TASK_USER_EXCLAPI_REQUIRED: "专属资源会员或服务可能已过期，请检查 RunningHub 权益。",
  "801": "当前账号或 API Key 类型不支持 API 调用，请核对账号等级和 Key 类型。",
  APIKEY_UNSUPPORTED_FREE_USER: "当前账号或 API Key 类型不支持 API 调用，请核对账号等级和 Key 类型。",
  "802": "API Key 无效或权限不匹配，请检查区域和 Key 类型。",
  "811": "API Key 无效或权限不匹配，请检查区域和 Key 类型。",
  APIKEY_UNAUTHORIZED: "API Key 无效或权限不匹配，请检查区域和 Key 类型。",
  CORPAPIKEY_INVALID: "API Key 无效或权限不匹配，请检查区域和 Key 类型。",
  "804": "任务仍在运行，请继续跟踪现有任务，不要重新提交。",
  APIKEY_TASK_IS_RUNNING: "任务仍在运行，请继续跟踪现有任务，不要重新提交。",
  "813": "任务仍在排队，请继续跟踪现有任务，不要重新提交。",
  APIKEY_TASK_IS_QUEUED: "任务仍在排队，请继续跟踪现有任务，不要重新提交。",
  "805": "云端任务状态异常，请保留任务 ID 并查看平台原始详情。",
  "807": "云端任务记录不存在，请保留任务 ID 并查看平台原始详情。",
  APIKEY_TASK_STATUS_ERROR: "云端任务状态异常，请保留任务 ID 并查看平台原始详情。",
  APIKEY_TASK_NOT_FOUND: "云端任务记录不存在，请保留任务 ID 并查看平台原始详情。",
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
  return RUNNINGHUB_ERROR_HINTS[code] || "";
}

export function isRunningHubPendingErrorCode(errorCode) {
  return ["804", "813", "APIKEY_TASK_IS_RUNNING", "APIKEY_TASK_IS_QUEUED"].includes(
    String(errorCode == null ? "" : errorCode).trim().toUpperCase()
  );
}
