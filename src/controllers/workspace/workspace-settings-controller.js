function createWorkspaceSettingsController(options = {}) {
  const dom = options.dom || {};
  const byId = typeof options.byId === "function" ? options.byId : () => null;
  const store = options.store || {};
  const runninghub = options.runninghub || {};
  const normalizePasteStrategy =
    typeof options.normalizePasteStrategy === "function" ? options.normalizePasteStrategy : (value) => value;
  const normalizeUploadMaxEdge =
    typeof options.normalizeUploadMaxEdge === "function" ? options.normalizeUploadMaxEdge : (value) => value;
  const normalizeCloudConcurrentJobs =
    typeof options.normalizeCloudConcurrentJobs === "function"
      ? options.normalizeCloudConcurrentJobs
      : (value) => {
          const num = Number(value);
          if (!Number.isFinite(num)) return 2;
          return Math.max(1, Math.min(100, Math.floor(num)));
        };
  const normalizeUploadRetryCount =
    typeof options.normalizeUploadRetryCount === "function"
      ? options.normalizeUploadRetryCount
      : (value) => {
          const num = Number(value);
          if (!Number.isFinite(num)) return 2;
          return Math.max(0, Math.min(5, Math.floor(num)));
        };
  const pasteStrategyLabels =
    options.pasteStrategyLabels && typeof options.pasteStrategyLabels === "object" ? options.pasteStrategyLabels : {};
  const syncWorkspaceApps =
    typeof options.syncWorkspaceApps === "function" ? options.syncWorkspaceApps : () => {};
  const log = typeof options.log === "function" ? options.log : () => {};
  const consoleError = typeof options.consoleError === "function" ? options.consoleError : console.error;

  function getSettingsSnapshot() {
    if (store && typeof store.getSettings === "function") {
      return store.getSettings() || {};
    }
    return {};
  }

  function getApiKey() {
    if (store && typeof store.getApiKey === "function") {
      return store.getApiKey();
    }
    return "";
  }

  function syncPasteStrategySelect() {
    const select = dom.pasteStrategySelect || byId("pasteStrategySelect");
    if (!select) return;
    const settings = getSettingsSnapshot();
    const pasteStrategy = normalizePasteStrategy(settings.pasteStrategy);
    const nextValue = String(pasteStrategy);
    if (select.value !== nextValue) {
      select.value = nextValue;
    }
  }

  async function updateAccountStatus() {
    const apiKey = getApiKey();
    const balanceEl = dom.accountBalanceValue || byId("accountBalanceValue");
    const coinsEl = dom.accountCoinsValue || byId("accountCoinsValue");
    const summaryEl = dom.accountSummary || byId("accountSummary");
    if (!balanceEl || !coinsEl) return;

    if (!apiKey) {
      if (summaryEl && summaryEl.classList && typeof summaryEl.classList.add === "function") {
        summaryEl.classList.add("is-empty");
      }
      balanceEl.textContent = "--";
      coinsEl.textContent = "--";
      return;
    }

    const fetchAccountStatus =
      runninghub && typeof runninghub.fetchAccountStatus === "function"
        ? runninghub.fetchAccountStatus.bind(runninghub)
        : async () => ({});

    try {
      if (summaryEl && summaryEl.classList && typeof summaryEl.classList.remove === "function") {
        summaryEl.classList.remove("is-empty");
      }
      balanceEl.textContent = "...";
      const status = await fetchAccountStatus(apiKey);
      balanceEl.textContent = status.remainMoney || "0";
      coinsEl.textContent = status.remainCoins || "0";
    } catch (error) {
      consoleError("获取账户信息失败", error);
    }
  }

  function onRefreshWorkspaceClick() {
    syncWorkspaceApps({ forceRerender: false });
    updateAccountStatus();
    log("应用列表已刷新", "info");
  }

  function onPasteStrategyChange(event) {
    const nextPasteStrategy = normalizePasteStrategy(event && event.target ? event.target.value : "");
    const settings = getSettingsSnapshot();
    const uploadMaxEdge = normalizeUploadMaxEdge(settings.uploadMaxEdge);
    const cloudConcurrentJobs = normalizeCloudConcurrentJobs(settings.cloudConcurrentJobs);
    const uploadRetryCount = normalizeUploadRetryCount(settings.uploadRetryCount);
    if (store && typeof store.saveSettings === "function") {
      store.saveSettings({
        pollInterval: settings.pollInterval,
        timeout: settings.timeout,
        uploadMaxEdge,
        uploadRetryCount,
        pasteStrategy: nextPasteStrategy,
        cloudConcurrentJobs
      });
    }
    const marker = pasteStrategyLabels[nextPasteStrategy] || nextPasteStrategy;
    log(`回贴策略已切换: ${marker}`, "info");
  }

  function onSettingsChanged() {
    updateAccountStatus();
    syncPasteStrategySelect();
  }

  return {
    syncPasteStrategySelect,
    updateAccountStatus,
    onRefreshWorkspaceClick,
    onPasteStrategyChange,
    onSettingsChanged
  };
}

module.exports = {
  createWorkspaceSettingsController
};
