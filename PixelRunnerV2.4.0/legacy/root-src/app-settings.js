(function initSettingsModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  function renderSettingsStatus(message, type = "info") {
    modules.runtime.setSummaryStatus(modules.runtime.getById("settingsStatusSummary"), message, type);
  }

  function renderSettingsDiagnostics(message, options = {}) {
    const box = modules.runtime.getById("settingsDiagnosticBox");
    if (!box) return;

    const runtimeText = options.runtime ? `<p>宿主环境：${modules.runtime.escapeHtml(options.runtime)}</p>` : "";
    const apiKeyText = options.hasApiKey
      ? "<p>API Key：已配置，本次保存将写入 host storage。</p>"
      : "<p>API Key：尚未配置。</p>";
    const appText = `<p>已保存应用：${modules.runtime.escapeHtml(String(modules.state.state.apps.length))} 个。</p>`;

    box.innerHTML = `
      <p>${modules.runtime.escapeHtml(String(message || ""))}</p>
      ${runtimeText}
      ${apiKeyText}
      ${appText}
    `;
  }

  function updateAccountSummary(account) {
    const balanceEl = modules.runtime.getById("accountBalanceValue");
    const coinsEl = modules.runtime.getById("accountCoinsValue");
    const summaryEl = modules.runtime.getById("accountSummary");
    if (!balanceEl || !coinsEl || !summaryEl) return;

    const hasAccount = account && account.ok;
    balanceEl.textContent = hasAccount && account.balance != null ? String(account.balance) : "--";
    coinsEl.textContent = hasAccount && account.coins != null ? String(account.coins) : "--";
    summaryEl.classList.toggle("is-empty", !hasAccount);
  }

  function fillSettingsForm(settings) {
    const runtime = modules.runtime;
    const apiKeyInput = runtime.getById("settingsApiKeyInput");
    const pollIntervalInput = runtime.getById("settingsPollIntervalInput");
    const timeoutInput = runtime.getById("settingsTimeoutInput");

    if (apiKeyInput) apiKeyInput.value = settings.apiKey || "";
    if (pollIntervalInput) pollIntervalInput.value = String(settings.pollInterval ?? modules.state.DEFAULT_SETTINGS.pollInterval);
    if (timeoutInput) timeoutInput.value = String(settings.timeout ?? modules.state.DEFAULT_SETTINGS.timeout);
  }

  function readSettingsForm() {
    return modules.state.normalizeSettings({
      apiKey: modules.runtime.getById("settingsApiKeyInput")?.value || "",
      pollInterval: modules.runtime.getById("settingsPollIntervalInput")?.value,
      timeout: modules.runtime.getById("settingsTimeoutInput")?.value
    });
  }

  async function loadSettingsSnapshot() {
    const apiKey = String((await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.API_KEY)) || "").trim();
    const rawSettings = modules.runtime.readJsonText(await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.SETTINGS), {});
    return modules.state.normalizeSettings({
      apiKey,
      pollInterval: rawSettings && rawSettings.pollInterval,
      timeout: rawSettings && rawSettings.timeout
    });
  }

  async function saveSettingsSnapshot(settings) {
    const normalized = modules.state.normalizeSettings(settings);

    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.API_KEY, normalized.apiKey);
    await modules.runtime.storageSetItem(
      modules.state.STORAGE_KEYS.SETTINGS,
      JSON.stringify({ pollInterval: normalized.pollInterval, timeout: normalized.timeout })
    );

    modules.state.state.settings = normalized;
    modules.state.state.settingsLoaded = true;
    fillSettingsForm(normalized);
    renderSettingsStatus("设置已保存到本地宿主存储。", "success");
    renderSettingsDiagnostics("运行参数已同步，可继续迁移应用列表和任务流程。", {
      runtime: modules.state.state.hostRuntime,
      hasApiKey: Boolean(normalized.apiKey)
    });

    modules.ui.logToWorkspace(
      `设置已保存：轮询 ${normalized.pollInterval}s，超时 ${normalized.timeout}s，API Key ${normalized.apiKey ? "已配置" : "未配置"}`,
      "success"
    );
  }

  async function initializeSettings() {
    renderSettingsStatus("正在读取本地设置...", "info");

    try {
      if (modules.runtime.isPluginRuntime()) {
        const hostInfo = await modules.runtime.callHost("host.ping");
        modules.state.state.hostRuntime = hostInfo && hostInfo.runtime ? String(hostInfo.runtime) : "uxp-host";
      } else {
        modules.state.state.hostRuntime = "browser-preview";
      }
    } catch (_) {
      modules.state.state.hostRuntime = modules.runtime.isPluginRuntime() ? "uxp-host" : "browser-preview";
    }

    const snapshot = await loadSettingsSnapshot();
    modules.state.state.settings = snapshot;
    modules.state.state.settingsLoaded = true;
    fillSettingsForm(snapshot);

    renderSettingsStatus("设置已加载，可直接修改并保存。", "success");
    renderSettingsDiagnostics("当前设置快照已从 bridge/local fallback 读取完成。", {
      runtime: modules.state.state.hostRuntime,
      hasApiKey: Boolean(snapshot.apiKey)
    });

    if (snapshot.apiKey && modules.runtime.isPluginRuntime()) {
      try {
        const account = await modules.runtime.callHost("runninghub.fetchAccountStatus", [{ apiKey: snapshot.apiKey }]);
        updateAccountSummary(account);
      } catch (_) {
        updateAccountSummary(null);
      }
    } else {
      updateAccountSummary(null);
    }
  }

  function bindSettingsActions() {
    const runtime = modules.runtime;
    const saveButton = runtime.getById("btnSaveSettings");
    const resetButton = runtime.getById("btnResetSettings");
    const createAppButton = runtime.getById("btnCreateApp");
    const importAppsButton = runtime.getById("btnImportApps");
    const exportAppsButton = runtime.getById("btnExportApps");
    const saveEditingAppButton = runtime.getById("btnSaveEditingApp");
    const deleteEditingAppButton = runtime.getById("btnDeleteEditingApp");
    const closeEditorButton = runtime.getById("appEditorClose");
    const transferInput = runtime.getById("appTransferInput");
    const fieldIds = ["settingsApiKeyInput", "settingsPollIntervalInput", "settingsTimeoutInput"];

    fieldIds.forEach((id) => {
      const element = runtime.getById(id);
      if (!element) return;
      element.addEventListener("input", () => renderSettingsStatus("检测到未保存修改。", "pending"));
    });

    if (saveButton) {
      saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;
        renderSettingsStatus("正在保存设置...", "info");

        try {
          await saveSettingsSnapshot(readSettingsForm());
          if (modules.state.state.settings.apiKey && modules.runtime.isPluginRuntime()) {
            const account = await modules.runtime.callHost("runninghub.fetchAccountStatus", [{ apiKey: modules.state.state.settings.apiKey }]);
            updateAccountSummary(account);
          } else {
            updateAccountSummary(null);
          }
        } catch (error) {
          renderSettingsStatus(`设置保存失败：${error.message}`, "error");
          renderSettingsDiagnostics("保存设置时发生错误，请检查 bridge 与宿主壳。", {
            runtime: modules.state.state.hostRuntime,
            hasApiKey: Boolean(runtime.getById("settingsApiKeyInput")?.value)
          });
          modules.ui.logToWorkspace(`设置保存失败：${error.message}`, "error");
        } finally {
          saveButton.disabled = false;
        }
      });
    }

    if (resetButton) {
      resetButton.addEventListener("click", () => {
        fillSettingsForm(modules.state.state.settingsLoaded ? modules.state.state.settings : modules.state.DEFAULT_SETTINGS);
        renderSettingsStatus("表单已恢复为当前已加载设置。", "info");
      });
    }

    if (createAppButton) createAppButton.addEventListener("click", () => modules.apps.openAppEditor());
    if (importAppsButton) {
      importAppsButton.addEventListener("click", async () => {
        try {
          await modules.apps.importAppsFromTextarea();
          renderSettingsDiagnostics("应用列表导入完成，workspace 也已同步刷新。", {
            runtime: modules.state.state.hostRuntime,
            hasApiKey: Boolean(modules.state.state.settings.apiKey)
          });
        } catch (error) {
          runtime.setSummaryStatus(runtime.getById("savedAppsSummary"), `导入失败：${error.message}`, "error");
          modules.ui.logToWorkspace(`导入应用失败：${error.message}`, "error");
        }
      });
    }
    if (exportAppsButton) {
      exportAppsButton.addEventListener("click", () => {
        modules.apps.exportAppsToTextarea();
        runtime.setSummaryStatus(runtime.getById("savedAppsSummary"), "应用列表已导出到下方文本框。", "success");
      });
    }
    if (transferInput) {
      transferInput.addEventListener("input", () => {
        transferInput.dataset.userEdited = "true";
      });
    }
    if (saveEditingAppButton) {
      saveEditingAppButton.addEventListener("click", async () => {
        try {
          await modules.apps.saveEditedApp();
          runtime.setSummaryStatus(runtime.getById("savedAppsSummary"), "应用已保存，并已同步到 workspace。", "success");
        } catch (error) {
          runtime.setSummaryStatus(runtime.getById("appEditorStatus"), `保存失败：${error.message}`, "error");
        }
      });
    }
    if (deleteEditingAppButton) {
      deleteEditingAppButton.addEventListener("click", async () => {
        if (!modules.state.state.editingAppId) return;
        await modules.apps.deleteAppById(modules.state.state.editingAppId);
        modules.apps.closeAppEditor();
        runtime.setSummaryStatus(runtime.getById("savedAppsSummary"), "应用已删除。", "warn");
      });
    }
    if (closeEditorButton) closeEditorButton.addEventListener("click", modules.apps.closeAppEditor);

    document.addEventListener("click", async (event) => {
      if (event.target && event.target.closest("#appEditorBackdrop")) {
        modules.apps.closeAppEditor();
        return;
      }

      const actionTarget = event.target && event.target.closest("[data-action]");
      if (!actionTarget) return;

      const action = actionTarget.getAttribute("data-action");
      const appId = actionTarget.getAttribute("data-app-id");
      if (!action || !appId) return;

      if (action === "select-app") {
        await modules.apps.setCurrentAppById(appId);
        runtime.setSummaryStatus(runtime.getById("savedAppsSummary"), "当前应用已切换。", "success");
        return;
      }
      if (action === "edit-app") {
        modules.apps.openAppEditor(appId);
        return;
      }
      if (action === "delete-app") {
        await modules.apps.deleteAppById(appId);
        runtime.setSummaryStatus(runtime.getById("savedAppsSummary"), "应用已删除。", "warn");
      }
    });
  }

  modules.settings = {
    renderSettingsStatus,
    renderSettingsDiagnostics,
    initializeSettings,
    bindSettingsActions
  };
})(window);
