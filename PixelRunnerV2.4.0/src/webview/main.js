window.PixelRunnerModules = window.PixelRunnerModules || {};

window.PixelRunnerModules.main = {
  VIEW_MAP: {
    tabWorkspace: "viewWorkspace",
    tabTools: "viewTools",
    tabSettings: "viewSettings"
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const modules = window.PixelRunnerModules;
  document.body.classList.toggle("is-browser-preview", !modules.runtime.isPluginRuntime());

  modules.ui.bindTabs();
  modules.ui.bindTactileFeedback();
  modules.ui.bindToolActions();
  modules.apps.bindAppPicker();
  modules.workspace.bindWorkspaceActions();
  modules.aiOptimize.bindModalEvents();
  modules.ui.bindPlaceholderActions();
  modules.templates.bindTemplateActions();
  modules.settings.bindSettingsActions();
  modules.sound.initialize();

  Promise.all([
    modules.apps.refreshWorkspaceApps({ quiet: true }),
    modules.quickEntries.initializeQuickEntries(),
    modules.templates.refreshTemplates({ quiet: true }),
    modules.settings.initializeSettings()
  ])
    .then(() => {
      modules.apps.renderSavedAppsList();
      modules.templates.renderSavedTemplatesList();
      modules.workspace.renderWorkspace();
      modules.ui.setActiveView("tabWorkspace");
      if (modules.runtime.isPluginRuntime()) {
        modules.workspace.refreshPhotoshopDocumentStatus({ quiet: true });
      }

      modules.runtime.postHostMessage({
        type: "pixelrunner.webview.ready",
        version: "2.4.3"
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
});
