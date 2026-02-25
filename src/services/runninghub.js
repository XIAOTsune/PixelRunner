const { API } = require("../config");
const { sleep } = require("../utils");
const taskStatus = require("./runninghub-task-status");
const { pollTaskOutputCore } = require("./runninghub-polling");
const { runAppTaskCore } = require("./runninghub-runner");
const { fetchWithTimeout } = require("./runninghub-runner/request-strategy");
const { testApiKeyCore, fetchAccountStatusCore } = require("./runninghub-account");
const { toMessage, parseJsonResponse, throwIfCancelled } = require("./runninghub-common");
const { fetchAppInfoCore } = require("./runninghub-parser");

async function fetchAppInfo(appId, apiKey, options = {}) {
  return fetchAppInfoCore({
    appId,
    apiKey,
    options,
    helpers: {
      fetchImpl: fetch,
      parseJsonResponse,
      toMessage
    }
  });
}

async function pollTaskOutput(apiKey, taskId, settings, options = {}) {
  return pollTaskOutputCore({
    apiKey,
    taskId,
    settings,
    options,
    helpers: {
      fetchImpl: fetch,
      api: API,
      sleep,
      throwIfCancelled,
      fetchWithTimeout,
      parseJsonResponse,
      toMessage,
      extractOutputUrl: taskStatus.extractOutputUrl,
      extractTaskStatus: taskStatus.extractTaskStatus,
      isFailedStatus: taskStatus.isFailedStatus,
      isPendingStatus: taskStatus.isPendingStatus,
      isPendingMessage: taskStatus.isPendingMessage
    }
  });
}

async function runAppTask(apiKey, appItem, inputValues, options = {}) {
  return runAppTaskCore({
    apiKey,
    appItem,
    inputValues,
    options,
    helpers: {
      fetchImpl: fetch,
      parseJsonResponse,
      toMessage,
      throwIfCancelled
    }
  });
}

async function downloadResultBinary(url, options = {}) {
  throwIfCancelled(options);
  const response = await fetchWithTimeout(
    fetch,
    url,
    { signal: options.signal },
    { timeoutMs: options.requestTimeoutMs }
  );
  throwIfCancelled(options);
  if (!response.ok) throw new Error(`下载结果失败 (HTTP ${response.status})`);
  return response.arrayBuffer();
}

async function testApiKey(apiKey) {
  return testApiKeyCore({
    apiKey,
    helpers: {
      fetchImpl: fetch,
      api: API,
      parseJsonResponse,
      toMessage
    }
  });
}

async function fetchAccountStatus(apiKey) {
  return fetchAccountStatusCore({
    apiKey,
    helpers: {
      fetchImpl: fetch,
      api: API,
      parseJsonResponse,
      toMessage
    }
  });
}

module.exports = {
  fetchAppInfo,
  runAppTask,
  pollTaskOutput,
  downloadResultBinary,
  testApiKey,
  fetchAccountStatus
};
