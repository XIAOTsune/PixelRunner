// 引入三个独立的控制器
const { initWorkspaceController } = require("./src/controllers/workspace-controller");
const { initSettingsController } = require("./src/controllers/settings-controller");
const { initToolsController } = require("./src/controllers/tools-controller");

document.addEventListener("DOMContentLoaded", () => {
  console.log("Plugin Loaded. Initializing Controllers...");

  try {
      // 1. 初始化工作台 (AI 运行)
      initWorkspaceController();
      
      // 2. 初始化设置页 (API Key, Parsing)
      initSettingsController();
      
      // 3. 初始化工具箱 (中性灰, 盖印)
      initToolsController();
      
      // 4. 设置 Tab 切换逻辑
      setupTabs();
      
  } catch (e) {
      console.error("Initialization Failed:", e);
  }
});

function setupTabs() {
  const tabs = {
    tabWorkspace: "viewWorkspace",
    tabTools: "viewTools",
    tabSettings: "viewSettings"
  };

  Object.keys(tabs).forEach(tabId => {
    const btn = document.getElementById(tabId);
    if (!btn) return;

    btn.addEventListener("click", () => {
      // 移除所有激活状态
      document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));

      // 激活当前
      btn.classList.add("active");
      const viewId = tabs[tabId];
      const view = document.getElementById(viewId);
      if (view) view.classList.add("active");
    });
  });
}