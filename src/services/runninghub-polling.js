async function pollTaskOutputCore(params) {
  const {
    apiKey,
    taskId,
    settings,
    options = {},
    helpers
  } = params || {};

  const {
    fetchImpl,
    api,
    sleep,
    throwIfCancelled,
    parseJsonResponse,
    toMessage,
    extractOutputUrl,
    extractTaskStatus,
    isFailedStatus,
    isPendingStatus,
    isPendingMessage
  } = helpers || {};

  const log = options.log || (() => {});
  const pollIntervalMs = Math.max(1, Number(settings && settings.pollInterval) || 2) * 1000;
  const timeoutMs = Math.max(10, Number(settings && settings.timeout) || 90) * 1000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    throwIfCancelled(options);
    try {
      const response = await fetchImpl(`${api.BASE_URL}${api.ENDPOINTS.TASK_OUTPUTS}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, taskId }),
        signal: options.signal
      });
      throwIfCancelled(options);
      const result = await parseJsonResponse(response);
      throwIfCancelled(options);

      if (response.ok && result && (result.code === 0 || result.success === true)) {
        const payload = result.data || result.result || result;
        const outputUrl = extractOutputUrl(payload);
        if (outputUrl) return outputUrl;

        const status = extractTaskStatus(payload);
        if (isFailedStatus(status)) throw new Error(toMessage(result, `任务失败 (${status})`));
        log(`任务状态: ${status || "处理中"}`, "info");
        await sleep(pollIntervalMs);
        throwIfCancelled(options);
        continue;
      }

      const message = toMessage(result, `HTTP ${response.status}`);
      const status = extractTaskStatus(result && result.data ? result.data : result);
      if (isPendingStatus(status) || isPendingMessage(message)) {
        log(`任务状态: ${status || message}`, "info");
        await sleep(pollIntervalMs);
        throwIfCancelled(options);
        continue;
      }

      throw new Error(message);
    } catch (error) {
      if (error && error.code === "RUN_CANCELLED") throw error;
      if (isPendingMessage(error && error.message)) {
        await sleep(pollIntervalMs);
        throwIfCancelled(options);
        continue;
      }
      throw error;
    }
  }

  throw new Error("任务超时，请稍后查看 RunningHub 任务列表");
}

module.exports = { pollTaskOutputCore };
