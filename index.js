const { initWorkspaceController } = require("./src/controllers/workspace-controller");
const { initSettingsController } = require("./src/controllers/settings-controller");
const { initToolsController } = require("./src/controllers/tools-controller");
const { runPsEnvironmentDoctor } = require("./src/diagnostics/ps-env-doctor");

document.addEventListener("DOMContentLoaded", () => {
  console.log("Plugin Loaded. Initializing Controllers...");

  let initError = null;
  try {
    initWorkspaceController();
    initSettingsController();
    initToolsController();
    setupTabs();
  } catch (error) {
    initError = error;
    console.error("Initialization Failed:", error);
  }

  runPsEnvironmentDoctor({ stage: "startup", initError })
    .then((report) => {
      console.log(`[Diag] Startup report generated: ${report.runId}`);
      if (report && report.persisted) {
        const { jsonPath, textPath } = report.persisted;
        if (jsonPath || textPath) {
          console.log(`[Diag] Report paths => json: ${jsonPath || "n/a"}, txt: ${textPath || "n/a"}`);
        }
      }
    })
    .catch((error) => {
      console.error("[Diag] Failed to run startup diagnostics:", error);
    });
});

function setupTabs() {
  const tabs = {
    tabWorkspace: "viewWorkspace",
    tabTools: "viewTools",
    tabSettings: "viewSettings"
  };

  Object.keys(tabs).forEach((tabId) => {
    const btn = document.getElementById(tabId);
    if (!btn) return;

    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((el) => el.classList.remove("active"));

      btn.classList.add("active");
      const viewId = tabs[tabId];
      const view = document.getElementById(viewId);
      if (view) view.classList.add("active");
    });
  });
}
