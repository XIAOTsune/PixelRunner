(function initUiModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  function logToWorkspace(message, type = "info") {
    const runtime = modules.runtime;
    const logWindow = runtime.getById("logWindow");
    if (!logWindow) return;

    const normalizedType = String(type || "info").toUpperCase();
    const text = `[${normalizedType}] ${String(message || "")}`;
    logWindow.value = logWindow.value ? `${logWindow.value}\n${text}` : text;
    logWindow.scrollTop = logWindow.scrollHeight;

    runtime.postHostMessage({
      type: "pixelrunner.webview.log",
      level: String(type || "info"),
      message: String(message || "")
    });
  }

  function setActiveView(activeTabId) {
    Object.entries(modules.main.VIEW_MAP).forEach(([tabId, viewId]) => {
      const tab = modules.runtime.getById(tabId);
      const view = modules.runtime.getById(viewId);
      const isActive = tabId === activeTabId;

      if (tab) tab.classList.toggle("active", isActive);
      if (view) {
        view.classList.toggle("active", isActive);
        view.classList.toggle("is-hidden", !isActive);
      }
    });
  }

  function bindTabs() {
    Object.keys(modules.main.VIEW_MAP).forEach((tabId) => {
      const tab = modules.runtime.getById(tabId);
      if (!tab) return;
      tab.addEventListener("click", () => setActiveView(tabId));
    });
  }

  function bindTactileFeedback() {
    const tactileTargets = document.querySelectorAll(".ghost-btn, .mini-btn, .secondary-btn, .primary-btn, .nav-tab");

    tactileTargets.forEach((element) => {
      let releaseTimer = null;

      const clearPressed = () => {
        if (releaseTimer) {
          clearTimeout(releaseTimer);
          releaseTimer = null;
        }
        element.classList.remove("is-pressed");
      };

      const setPressed = () => {
        if (releaseTimer) {
          clearTimeout(releaseTimer);
          releaseTimer = null;
        }
        element.classList.add("is-pressed");
      };

      const releasePressed = () => {
        if (releaseTimer) clearTimeout(releaseTimer);
        releaseTimer = setTimeout(() => {
          element.classList.remove("is-pressed");
          releaseTimer = null;
        }, 120);
      };

      element.addEventListener("pointerdown", setPressed);
      element.addEventListener("pointerup", releasePressed);
      element.addEventListener("pointercancel", clearPressed);
      element.addEventListener("pointerleave", clearPressed);
      element.addEventListener("mouseleave", clearPressed);
      element.addEventListener("blur", clearPressed);
    });
  }

  function bindPlaceholderActions() {
    const runtime = modules.runtime;
    const logWindow = runtime.getById("logWindow");
    const donateButtons = ["btnDonate", "btnDonateTools", "btnDonateSettings"]
      .map((id) => runtime.getById(id))
      .filter(Boolean);
    const clearButton = runtime.getById("btnClearLog");

    donateButtons.forEach((donateButton) => {
      if (!logWindow) return;
      donateButton.addEventListener("click", () => {
        logWindow.value += "\n[提示] 支持项目入口已预留，后续会接入正式弹窗和外链。";
        logWindow.scrollTop = logWindow.scrollHeight;
      });
    });

    if (clearButton && logWindow) {
      clearButton.addEventListener("click", () => {
        logWindow.value = "[系统] 日志已清空，等待新的模块接入。";
      });
    }
  }

  function bindToolActions() {
    const toolConfigs = [
      {
        id: "btnObserver",
        payload: { action: "observerLayer", layerName: "黑白观察层" },
        pending: "正在创建黑白观察层...",
        success: (result) => result && result.message ? result.message : "已创建黑白观察层"
      },
      {
        id: "btnNeutralGray",
        payload: { action: "neutralGrayLayer" },
        pending: "正在创建中性灰图层...",
        success: (result) => result && result.message ? result.message : "已创建中性灰图层"
      },
      {
        id: "btnGaussianBlur",
        payload: { action: "gaussianBlur", radius: 4 },
        pending: "正在执行高斯模糊...",
        success: (result) => result && result.message ? result.message : "已执行高斯模糊"
      },
      {
        id: "btnSharpen",
        payload: { action: "sharpen" },
        pending: "正在执行锐化...",
        success: (result) => result && result.message ? result.message : "已执行锐化"
      },
      {
        id: "btnHighPass",
        payload: { action: "highPass", radius: 2 },
        pending: "正在执行高反差保留...",
        success: (result) => result && result.message ? result.message : "已执行高反差保留"
      },
      {
        id: "btnStamp",
        payload: { action: "stampVisible", layerName: "盖印图层" },
        pending: "正在生成盖印图层...",
        success: (result) => result && result.message ? result.message : "已生成盖印图层"
      },
      {
        id: "btnContentAwareFill",
        payload: { action: "contentAwareFill" },
        pending: "正在触发内容识别填充...",
        success: (result) => result && result.message ? result.message : "已触发内容识别填充"
      },
      {
        id: "btnSelectAndMask",
        payload: { action: "selectAndMask" },
        pending: "正在触发选择并遮住...",
        success: (result) => result && result.message ? result.message : "已触发选择并遮住"
      }
    ];

    toolConfigs.forEach((config) => {
      const button = modules.runtime.getById(config.id);
      if (!button) return;

      button.addEventListener("click", async () => {
        if (!modules.runtime.isPluginRuntime()) {
          logToWorkspace(`浏览器预览模式下不会执行工具动作：${config.id}`, "info");
          return;
        }

        button.disabled = true;
        logToWorkspace(config.pending, "info");

        try {
          const result = await modules.runtime.callHost("photoshop.runToolAction", [config.payload], {
            timeoutMs: 45000
          });
          logToWorkspace(config.success(result), "success");
        } catch (error) {
          logToWorkspace(`工具执行失败：${error.message}`, "error");
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  modules.ui = {
    logToWorkspace,
    setActiveView,
    bindTabs,
    bindTactileFeedback,
    bindPlaceholderActions,
    bindToolActions
  };
})(window);
