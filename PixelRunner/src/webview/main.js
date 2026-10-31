window.PixelRunnerModules = window.PixelRunnerModules || {};

window.PixelRunnerModules.main = {
  VIEW_MAP: {
    tabWorkspace: "viewWorkspace",
    tabTools: "viewTools",
    tabSettings: "viewSettings"
  }
};

function initializePixelRunnerApp() {
  const modules = window.PixelRunnerModules;
  document.body.classList.toggle("is-browser-preview", !modules.runtime.isPluginRuntime());

  modules.ui.bindTabs();
  modules.ui.bindTactileFeedback();
  modules.ui.bindToolActions();
  modules.blendMatch.bindBlendMatchActions();
  modules.spaceFx.bindSpaceFxActions();
  modules.postFx.bindActions();
  modules.apps.bindAppPicker();
  modules.workspace.bindWorkspaceActions();
  modules.generativeFill.bindActions();
  modules.aiOptimize.bindModalEvents();
  modules.ui.bindPlaceholderActions();
  modules.templates.bindTemplateActions();
  modules.promptHistory.bindActions();
  modules.settings.bindSettingsActions();
  modules.license.bindActions();
  modules.sound.initialize();

  modules.settings.initializeSettings()
    .then(() => modules.promptHistory.initialize())
    .then(() => modules.license.initialize())
    .then(async () => {
      await modules.apps.refreshWorkspaceApps({ quiet: true });
      await modules.quickEntries.initializeQuickEntries();
      await modules.templates.refreshTemplates({ quiet: true });
      const keys = modules.state.STORAGE_KEYS;
      const activeId = await modules.runtime.storageGetItem(keys.ACTIVE_PROMPT_BUNDLE);
      if (activeId) modules.state.state.activePromptBundleId = String(activeId);
      const hasData = modules.state.state.apps.length > 0 || modules.state.state.templates.length > 0 || modules.state.state.templateCategories.length > 0 || modules.state.state.quickEntries.length > 0;
      const marker = await modules.runtime.storageGetItem(keys.WORKSPACE_INIT);
      const backup = modules.runtime.loadWorkspaceBackup ? await modules.runtime.loadWorkspaceBackup() : null;
      if (!hasData && backup) {
        await modules.runtime.storageSetItem(keys.APPS, JSON.stringify({ version: 3, appsByRegion: {
          cn: backup.apps.filter((item) => String(item.region || "cn") === "cn"),
          global: backup.apps.filter((item) => String(item.region || "cn") !== "cn")
        }}));
        await modules.runtime.storageSetItem(keys.PROMPT_TEMPLATES, JSON.stringify(backup.templates));
        await modules.runtime.storageSetItem(keys.PROMPT_TEMPLATE_CATEGORIES, JSON.stringify(backup.templateCategories));
        await modules.runtime.storageSetItem(keys.QUICK_ENTRIES, JSON.stringify({ version: 1, entries: backup.quickEntries }));
        if (backup.activePromptBundleId) await modules.runtime.storageSetItem(keys.ACTIVE_PROMPT_BUNDLE, backup.activePromptBundleId);
        await modules.runtime.storageSetItem(keys.WORKSPACE_INIT, "true");
      } else if (!hasData && !marker) await modules.templates.initializeBuiltinBundle();
      else if (!marker) await modules.runtime.storageSetItem(keys.WORKSPACE_INIT, "true");
      await modules.apps.refreshWorkspaceApps({ quiet: true });
      await modules.quickEntries.initializeQuickEntries();
      await modules.templates.refreshTemplates({ quiet: true });
    })
    .then(() => {
      modules.apps.renderSavedAppsList();
      modules.templates.renderSavedTemplatesList();
      modules.templates.renderPromptBundleManager();
      modules.promptHistory.renderSettingsSummary();
      modules.workspace.renderWorkspace();
      modules.ui.setActiveView("tabWorkspace");
      if (modules.runtime.isPluginRuntime()) {
        modules.workspace.refreshPhotoshopDocumentStatus({ quiet: true });
      }

      modules.runtime.postHostMessage({
        type: "pixelrunner.webview.ready",
        version: "2.9.2"
      });
    })
    .catch((error) => {
      modules.settings.renderSettingsStatus(`初始化失败：${error.message}`, "error");
      modules.settings.renderSettingsDiagnostics("应用初始化未完成，请先检查 src/webview-entry.js 与宿主桥接。", {
        runtime: modules.state.state.hostRuntime,
        hasApiKey: false
      });
      modules.ui.logToWorkspace(`初始化失败：${error.message}`, "error");
    });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializePixelRunnerApp, { once: true });
} else {
  initializePixelRunnerApp();
}
