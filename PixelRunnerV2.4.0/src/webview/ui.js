(function initUiModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const DONATION_LINKS = {
    wx: "wxp://f2f0xp-V9KpvqacwxxGZ3zXDCGI_z11NO-xT2ukCb4JHZyI",
    zfb: "https://qr.alipay.com/fkx12142r0sdwj4kizujk2f",
    runninghub: "https://www.runninghub.cn",
    tutorial: "./pages/runninghub-guide.html"
  };

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
    document.querySelectorAll(".ghost-btn, .mini-btn, .secondary-btn, .primary-btn, .nav-tab, .donation-card").forEach((element) => {
      let releaseTimer = null;
      const clearPressed = () => {
        if (releaseTimer) clearTimeout(releaseTimer);
        releaseTimer = null;
        element.classList.remove("is-pressed");
      };
      const setPressed = () => {
        if (releaseTimer) clearTimeout(releaseTimer);
        releaseTimer = null;
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
    const clearButton = runtime.getById("btnClearLog");
    const donateButtons = ["btnDonate", "btnDonateTools", "btnDonateSettings"]
      .map((id) => runtime.getById(id))
      .filter(Boolean);
    const donationModalClose = runtime.getById("donationModalClose");
    const donationStatusHint = runtime.getById("donationStatusHint");
    const donationCards = ["donationWxCard", "donationZfbCard"]
      .map((id) => runtime.getById(id))
      .filter(Boolean);
    const btnOpenRunningHubSite = runtime.getById("btnOpenRunningHubSite");
    const btnOpenTutorialSite = runtime.getById("btnOpenTutorialSite");

    const setDonationStatus = (message, type = "info") => {
      runtime.setSummaryStatus(donationStatusHint, message, type);
    };

    const openDonationModal = () => {
      modules.workspace.setModalOpen("donationModal", true);
      setDonationStatus("二维码已就绪，可点击二维码尝试打开链接。", "info");
    };

    const closeDonationModal = () => {
      modules.workspace.setModalOpen("donationModal", false);
    };

    const openLinkInPreview = (url, label) => {
      try {
        global.open(String(url || "").trim(), "_blank", "noopener");
        setDonationStatus(`已尝试打开${label}，如果没有唤起请直接扫码。`, "success");
      } catch (_) {
        setDonationStatus(`打开${label}失败，请直接扫码使用。`, "error");
      }
    };

    const openExternalLink = async (url, label, developerText) => {
      const target = String(url || "").trim();
      if (!target) return;

      if (!runtime.isPluginRuntime()) {
        openLinkInPreview(target, label);
        return;
      }

      try {
        const result = await runtime.callHost("shell.openExternal", [target, developerText], { timeoutMs: 15000 });
        if (result && result.ok) {
          setDonationStatus(`已打开${label}。`, "success");
          return;
        }
        setDonationStatus(`打开${label}失败，请直接扫码使用。`, "error");
      } catch (error) {
        setDonationStatus(`打开${label}失败：${error.message}`, "error");
      }
    };

    const openTutorialPage = async () => {
      if (!runtime.isPluginRuntime()) {
        openLinkInPreview(DONATION_LINKS.tutorial, "教程页面");
        return;
      }

      try {
        const resolved = await runtime.callHost("shell.resolveTutorialPath", [], { timeoutMs: 15000 });
        const tutorialPath = String((resolved && resolved.path) || "").trim();
        if (!tutorialPath) {
          setDonationStatus("本地教程文件定位失败，请检查 pages/runninghub-guide.html。", "error");
          return;
        }

        const opened = await runtime.callHost(
          "shell.openPath",
          [tutorialPath, "将使用系统默认浏览器打开本地教程页面。"],
          { timeoutMs: 15000 }
        );
        if (opened && opened.ok) {
          setDonationStatus("已打开教程页面。", "success");
          return;
        }
        setDonationStatus("打开教程失败，请检查系统默认浏览器设置。", "error");
      } catch (error) {
        setDonationStatus(`打开教程失败：${error.message}`, "error");
      }
    };

    donateButtons.forEach((button) => {
      button.addEventListener("click", openDonationModal);
    });

    if (donationModalClose) donationModalClose.addEventListener("click", closeDonationModal);

    document.addEventListener("click", (event) => {
      if (event.target && event.target.closest("#donationBackdrop")) closeDonationModal();
    });

    donationCards.forEach((card) => {
      card.addEventListener("click", () => {
        const label = card.id === "donationWxCard" ? "微信赞助链接" : "支付宝赞助链接";
        void openExternalLink(card.getAttribute("data-donation-url"), label, `将尝试打开${label}。`);
      });
    });

    if (btnOpenRunningHubSite) {
      btnOpenRunningHubSite.addEventListener("click", () => {
        void openExternalLink(DONATION_LINKS.runninghub, "RunningHub", "将使用系统默认浏览器打开 RunningHub 官网。");
      });
    }

    if (btnOpenTutorialSite) {
      btnOpenTutorialSite.addEventListener("click", () => {
        void openTutorialPage();
      });
    }

    if (clearButton && logWindow) {
      clearButton.addEventListener("click", () => {
        logWindow.value = "[系统] 日志已清空，等待新的操作记录。";
      });
    }
  }

  function bindToolActions() {
    const glowStrengthInput = modules.runtime.getById("glowStrengthInput");
    const glowRadiusInput = modules.runtime.getById("glowRadiusInput");
    const glowThresholdInput = modules.runtime.getById("glowThresholdInput");
    const glowFadeInput = modules.runtime.getById("glowFadeInput");
    const glowSaturationInput = modules.runtime.getById("glowSaturationInput");
    const glowStrengthValue = modules.runtime.getById("glowStrengthValue");
    const glowHint = modules.runtime.getById("glowHint");
    const glowButton = modules.runtime.getById("btnGlow");

    const readGlowSlider = (input, fallback, min, max) => {
      if (!input) return fallback;
      const parsed = Number(input.value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(min, Math.min(max, Math.round(parsed)));
    };

    const readGlowState = () => ({
      strength: readGlowSlider(glowStrengthInput, 35, 0, 100),
      radius: readGlowSlider(glowRadiusInput, 18, 1, 120),
      threshold: readGlowSlider(glowThresholdInput, 58, 0, 100),
      fade: readGlowSlider(glowFadeInput, 28, 0, 100),
      saturation: readGlowSlider(glowSaturationInput, 0, -100, 100)
    });

    const updateGlowStrengthLabel = () => {
      if (!glowStrengthValue) return;
      const state = readGlowState();
      glowStrengthValue.textContent = `强度 ${state.strength}%`;
    };

    updateGlowStrengthLabel();
    [glowStrengthInput, glowRadiusInput, glowThresholdInput, glowFadeInput, glowSaturationInput]
      .filter(Boolean)
      .forEach((input) => {
        input.addEventListener("input", updateGlowStrengthLabel);
        input.addEventListener("change", updateGlowStrengthLabel);
      });

    if (glowButton) {
      glowButton.addEventListener("click", async () => {
        const state = readGlowState();
        if (!modules.runtime.isPluginRuntime()) {
          logToWorkspace(`浏览器预览模式下不会执行辉光动作：强度 ${state.strength}%`, "info");
          if (glowHint) modules.runtime.setSummaryStatus(glowHint, "浏览器预览模式下不能直接执行 Photoshop 辉光。", "warn");
          return;
        }

        glowButton.disabled = true;
        if (glowHint) {
          modules.runtime.setSummaryStatus(
            glowHint,
            `正在生成高光辉光：强度 ${state.strength}% / 半径 ${state.radius} / 阈值 ${state.threshold}%`,
            "pending"
          );
        }
        logToWorkspace(`正在执行辉光动作：强度 ${state.strength}% ，半径 ${state.radius} ，阈值 ${state.threshold}%...`, "info");
        try {
          const result = await modules.runtime.callHost("photoshop.runToolAction", [{
            action: "glow",
            strength: state.strength,
            radius: state.radius,
            threshold: state.threshold,
            fade: state.fade,
            saturation: state.saturation
          }], { timeoutMs: 45000 });
          const successMessage = result && result.message ? result.message : "已生成辉光层";
          logToWorkspace(successMessage, "success");
          if (glowHint) modules.runtime.setSummaryStatus(glowHint, successMessage, "success");
        } catch (error) {
          const message = `辉光执行失败：${error.message}`;
          logToWorkspace(message, "error");
          if (glowHint) modules.runtime.setSummaryStatus(glowHint, message, "error");
        } finally {
          glowButton.disabled = false;
        }
      });
    }

    const toolConfigs = [
      { id: "btnObserver", payload: { action: "observerLayer", layerName: "黑白观察层" }, pending: "正在创建黑白观察层...", success: (result) => (result && result.message ? result.message : "已创建黑白观察层") },
      { id: "btnNeutralGray", payload: { action: "neutralGrayLayer" }, pending: "正在创建中性灰图层...", success: (result) => (result && result.message ? result.message : "已创建中性灰图层") },
      { id: "btnGaussianBlur", payload: { action: "gaussianBlur", radius: 4 }, pending: "正在执行高斯模糊...", success: (result) => (result && result.message ? result.message : "已执行高斯模糊") },
      { id: "btnSharpen", payload: { action: "sharpen" }, pending: "正在执行锐化...", success: (result) => (result && result.message ? result.message : "已执行锐化") },
      { id: "btnHighPass", payload: { action: "highPass", radius: 2 }, pending: "正在执行高反差保留...", success: (result) => (result && result.message ? result.message : "已执行高反差保留") },
      { id: "btnStamp", payload: { action: "stampVisible", layerName: "盖印图层" }, pending: "正在生成盖印图层...", success: (result) => (result && result.message ? result.message : "已生成盖印图层") },
      { id: "btnContentAwareFill", payload: { action: "contentAwareFill" }, pending: "正在触发内容识别填充...", success: (result) => (result && result.message ? result.message : "已触发内容识别填充") },
      { id: "btnSelectAndMask", payload: { action: "selectAndMask" }, pending: "正在触发选择并遮住...", success: (result) => (result && result.message ? result.message : "已触发选择并遮住") }
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
          const result = await modules.runtime.callHost("photoshop.runToolAction", [config.payload], { timeoutMs: 45000 });
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
