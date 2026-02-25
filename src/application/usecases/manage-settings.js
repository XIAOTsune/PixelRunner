const {
  normalizeCloudConcurrentJobs,
  normalizeUploadRetryCount
} = require("../../domain/policies/run-settings-policy");

function requireMethod(target, methodName, ownerName) {
  if (!target || typeof target !== "object" || typeof target[methodName] !== "function") {
    throw new Error(`${ownerName} requires ${ownerName === "store" ? "store" : ownerName}.${methodName}`);
  }
}

function loadSettingsSnapshotUsecase(options = {}) {
  const store = options.store;
  requireMethod(store, "getApiKey", "store");
  requireMethod(store, "getSettings", "store");

  const settings = store.getSettings();
  return {
    apiKey: String(store.getApiKey() || ""),
    pollInterval: Number(settings && settings.pollInterval) || 2,
    timeout: Number(settings && settings.timeout) || 180,
    uploadMaxEdge: Number(settings && settings.uploadMaxEdge) || 0,
    uploadRetryCount: normalizeUploadRetryCount(settings && settings.uploadRetryCount, 2),
    pasteStrategy: String((settings && settings.pasteStrategy) || ""),
    cloudConcurrentJobs: normalizeCloudConcurrentJobs(
      settings && settings.cloudConcurrentJobs,
      2
    )
  };
}

function getSavedApiKeyUsecase(options = {}) {
  const store = options.store;
  requireMethod(store, "getApiKey", "store");
  return String(store.getApiKey() || "").trim();
}

async function testApiKeyUsecase(options = {}) {
  const runninghub = options.runninghub;
  const apiKey = String(options.apiKey || "").trim();
  requireMethod(runninghub, "testApiKey", "runninghub");
  if (!apiKey) throw new Error("Please enter API Key");
  return runninghub.testApiKey(apiKey);
}

function saveSettingsUsecase(options = {}) {
  const store = options.store;
  requireMethod(store, "getSettings", "store");
  requireMethod(store, "saveApiKey", "store");
  requireMethod(store, "saveSettings", "store");

  const apiKey = String(options.apiKey || "").trim();
  const pollInterval = Number(options.pollInterval) || 2;
  const timeout = Number(options.timeout) || 180;
  const uploadMaxEdge = Number.isFinite(Number(options.uploadMaxEdge)) ? Number(options.uploadMaxEdge) : 0;
  const uploadRetryCount = normalizeUploadRetryCount(options.uploadRetryCount, 2);
  const pasteStrategy = String(options.pasteStrategy || "").trim();
  const cloudConcurrentJobs = normalizeCloudConcurrentJobs(options.cloudConcurrentJobs, 2);

  store.saveApiKey(apiKey);
  store.saveSettings({
    pollInterval,
    timeout,
    uploadMaxEdge,
    uploadRetryCount,
    pasteStrategy,
    cloudConcurrentJobs
  });

  return {
    apiKeyChanged: true,
    settingsChanged: true
  };
}

module.exports = {
  loadSettingsSnapshotUsecase,
  getSavedApiKeyUsecase,
  testApiKeyUsecase,
  saveSettingsUsecase
};
