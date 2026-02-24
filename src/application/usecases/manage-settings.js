function saveSettingsUsecase(options = {}) {
  const store = options.store;
  if (!store || typeof store !== "object") {
    throw new Error("saveSettingsUsecase requires store");
  }
  if (typeof store.getSettings !== "function" || typeof store.saveApiKey !== "function" || typeof store.saveSettings !== "function") {
    throw new Error("saveSettingsUsecase requires store.getSettings/saveApiKey/saveSettings");
  }

  const apiKey = String(options.apiKey || "").trim();
  const pollInterval = Number(options.pollInterval) || 2;
  const timeout = Number(options.timeout) || 180;
  const uploadMaxEdge = Number.isFinite(Number(options.uploadMaxEdge)) ? Number(options.uploadMaxEdge) : 0;
  const pasteStrategy = String(options.pasteStrategy || "").trim();

  store.saveApiKey(apiKey);
  store.saveSettings({
    pollInterval,
    timeout,
    uploadMaxEdge,
    pasteStrategy
  });

  return {
    apiKeyChanged: true,
    settingsChanged: true
  };
}

module.exports = {
  saveSettingsUsecase
};
