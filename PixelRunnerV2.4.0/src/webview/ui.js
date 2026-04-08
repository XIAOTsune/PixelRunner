(function initUiModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const DONATION_LINKS = {
    wx: "wxp://f2f0xp-V9KpvqacwxxGZ3zXDCGI_z11NO-xT2ukCb4JHZyI",
    zfb: "https://qr.alipay.com/fkx12142r0sdwj4kizujk2f",
    runninghub: "https://www.runninghub.cn",
    tutorial: "./pages/runninghub-guide.html"
  };
  const GLOW_DEFAULTS = {
    style: "natural",
    strength: 47,
    radius: 81,
    threshold: 81,
    saturation: 81
  };
  const GLOW_STYLE_LABELS = {
    natural: "自然",
    soft: "柔和",
    dreamy: "梦幻"
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
        setDonationStatus(`已尝试打开 ${label}。`, "success");
      } catch (_) {
        setDonationStatus(`打开 ${label} 失败，请直接扫码或手动访问。`, "error");
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
          setDonationStatus(`已打开 ${label}。`, "success");
          return;
        }
        setDonationStatus(`打开 ${label} 失败，请直接扫码或手动访问。`, "error");
      } catch (error) {
        setDonationStatus(`打开 ${label} 失败：${error.message}`, "error");
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
        const tutorialUrl = String((resolved && resolved.url) || "").trim();
        if (!tutorialPath && !tutorialUrl) {
          setDonationStatus("无法定位本地教程文件，请检查 pages/runninghub-guide.html。", "error");
          return;
        }

        const opened = tutorialUrl
          ? await runtime.callHost(
              "shell.openExternal",
              [tutorialUrl, "将使用系统默认浏览器打开本地教程页面。"],
              { timeoutMs: 15000 }
            )
          : await runtime.callHost(
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
        void openExternalLink(card.getAttribute("data-donation-url"), label, `将尝试打开 ${label}。`);
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
    const runtime = modules.runtime;
    const glowStyleInput = runtime.getById("glowStyleInput");
    const glowStrengthInput = runtime.getById("glowStrengthInput");
    const glowRadiusInput = runtime.getById("glowRadiusInput");
    const glowThresholdInput = runtime.getById("glowThresholdInput");
    const glowSaturationInput = runtime.getById("glowSaturationInput");
    const glowStrengthValue = runtime.getById("glowStrengthValue");
    const glowStyleBadge = runtime.getById("glowStyleBadge");
    const glowRadiusValue = runtime.getById("glowRadiusValue");
    const glowThresholdValue = runtime.getById("glowThresholdValue");
    const glowPreviewState = runtime.getById("glowPreviewState");
    const glowHint = runtime.getById("glowHint");
    const glowQuickHint = runtime.getById("glowQuickHint");
    const glowOpenButton = runtime.getById("btnOpenGlowPanel");
    const glowApplyButton = runtime.getById("btnGlowPreviewApply");
    const glowCancelButton = runtime.getById("btnGlowPreviewCancel");
    const glowModalClose = runtime.getById("glowModalClose");

    let glowPreviewTimer = 0;
    let glowPreviewInFlight = false;
    let glowPreviewNeedsReplay = false;
    let glowPreviewOpen = false;
    let glowLastPreviewSignature = "";

    const readGlowSlider = (input, fallback, min, max) => {
      if (!input) return fallback;
      const parsed = Number(input.value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(min, Math.min(max, Math.round(parsed)));
    };

    const readGlowStyle = () => {
      const nextStyle = String((glowStyleInput && glowStyleInput.value) || GLOW_DEFAULTS.style).trim().toLowerCase();
      return GLOW_STYLE_LABELS[nextStyle] ? nextStyle : GLOW_DEFAULTS.style;
    };

    const getGlowStyleLabel = (style) => GLOW_STYLE_LABELS[String(style || "").trim().toLowerCase()] || GLOW_STYLE_LABELS[GLOW_DEFAULTS.style];

    const readGlowState = () => ({
      style: readGlowStyle(),
      strength: readGlowSlider(glowStrengthInput, GLOW_DEFAULTS.strength, 0, 100),
      radius: readGlowSlider(glowRadiusInput, GLOW_DEFAULTS.radius, 1, 120),
      threshold: readGlowSlider(glowThresholdInput, GLOW_DEFAULTS.threshold, 0, 100),
      saturation: readGlowSlider(glowSaturationInput, GLOW_DEFAULTS.saturation, -100, 100)
    });

    const setGlowButtonsDisabled = (disabled) => {
      [glowOpenButton, glowApplyButton, glowCancelButton, glowModalClose].filter(Boolean).forEach((button) => {
        button.disabled = disabled;
      });
    };

    const setGlowStatus = (message, type = "info") => {
      if (glowHint) runtime.setSummaryStatus(glowHint, message, type);
    };

    const setQuickGlowStatus = (message, type = "info") => {
      if (glowQuickHint) runtime.setSummaryStatus(glowQuickHint, message, type);
    };

    const setGlowPreviewBadge = (message, type = "info") => {
      if (!glowPreviewState) return;
      glowPreviewState.textContent = message;
      glowPreviewState.dataset.status = type;
    };

    const updateGlowLabels = () => {
      const state = readGlowState();
      if (glowStrengthValue) glowStrengthValue.textContent = `${getGlowStyleLabel(state.style)} ${state.strength}%`;
      if (glowStyleBadge) glowStyleBadge.textContent = `风格 ${getGlowStyleLabel(state.style)}`;
      if (glowRadiusValue) glowRadiusValue.textContent = `半径 ${state.radius}`;
      if (glowThresholdValue) glowThresholdValue.textContent = `阈值 ${state.threshold}%`;
    };

    const callGlowHostAction = async (action) => {
      const state = readGlowState();
      return runtime.callHost("photoshop.runToolAction", [{
        action,
        style: state.style,
        strength: state.strength,
        radius: state.radius,
        threshold: state.threshold,
        saturation: state.saturation
      }], { timeoutMs: 60000 });
    };

    const getGlowStateSignature = () => {
      const state = readGlowState();
      return [state.style, state.strength, state.radius, state.threshold, state.saturation].join("|");
    };

    const runGlowPreviewUpdate = async (action = "glowPreviewUpdate") => {
      if (!glowPreviewOpen || !runtime.isPluginRuntime()) return;
      const nextSignature = getGlowStateSignature();
      if (action === "glowPreviewUpdate" && nextSignature === glowLastPreviewSignature && !glowPreviewNeedsReplay) {
        return;
      }
      if (glowPreviewInFlight) {
        glowPreviewNeedsReplay = true;
        return;
      }

      glowPreviewInFlight = true;
      glowPreviewNeedsReplay = false;
      const state = readGlowState();
      setGlowPreviewBadge("正在预览", "pending");
      setGlowStatus(`正在更新辉光预览：${getGlowStyleLabel(state.style)} / 强度 ${state.strength}% / 半径 ${state.radius} / 阈值 ${state.threshold}%`, "pending");

      try {
        const result = await callGlowHostAction(action);
        const message = result && result.message ? result.message : "辉光预览已更新。";
        glowLastPreviewSignature = nextSignature;
        setGlowPreviewBadge("预览中", "success");
        setGlowStatus(message, "success");
      } catch (error) {
        const message = `辉光预览失败：${error.message}`;
        setGlowPreviewBadge("预览失败", "error");
        setGlowStatus(message, "error");
        logToWorkspace(message, "error");
      } finally {
        glowPreviewInFlight = false;
      }

      if (glowPreviewNeedsReplay && glowPreviewOpen) {
        glowPreviewNeedsReplay = false;
        void runGlowPreviewUpdate("glowPreviewUpdate");
      }
    };

    const scheduleGlowPreviewUpdate = () => {
      if (!glowPreviewOpen || !runtime.isPluginRuntime()) return;
      if (glowPreviewTimer) clearTimeout(glowPreviewTimer);
      glowPreviewTimer = window.setTimeout(() => {
        glowPreviewTimer = 0;
        void runGlowPreviewUpdate("glowPreviewUpdate");
      }, 220);
    };

    const flushGlowPreviewUpdate = async () => {
      if (!glowPreviewOpen || !runtime.isPluginRuntime()) return;
      if (glowPreviewTimer) {
        clearTimeout(glowPreviewTimer);
        glowPreviewTimer = 0;
      }
      if (glowPreviewInFlight) {
        glowPreviewNeedsReplay = true;
      }
      while (glowPreviewInFlight || glowPreviewNeedsReplay) {
        if (!glowPreviewInFlight && glowPreviewNeedsReplay) {
          glowPreviewNeedsReplay = false;
          await runGlowPreviewUpdate("glowPreviewUpdate");
        } else {
          await new Promise((resolve) => window.setTimeout(resolve, 80));
        }
      }
      await runGlowPreviewUpdate("glowPreviewUpdate");
    };

    const openGlowModal = async () => {
      glowPreviewOpen = true;
      glowLastPreviewSignature = "";
      modules.workspace.setModalOpen("glowModal", true);
      updateGlowLabels();

      if (!runtime.isPluginRuntime()) {
        setGlowPreviewBadge("浏览器预览", "warn");
        setGlowStatus("浏览器预览模式下不会真正生成 Photoshop 预览层。", "warn");
        setQuickGlowStatus("浏览器预览模式下可查看 UI，但不会执行实际辉光。", "warn");
        return;
      }

      setGlowButtonsDisabled(true);
      try {
        await runGlowPreviewUpdate("glowPreviewStart");
        setQuickGlowStatus(`辉光面板已打开，当前风格为 ${getGlowStyleLabel(readGlowState().style)}。`, "success");
      } finally {
        setGlowButtonsDisabled(false);
      }
    };

    const closeGlowModal = async (discardPreview = true) => {
      glowPreviewOpen = false;
      glowLastPreviewSignature = "";
      if (glowPreviewTimer) {
        clearTimeout(glowPreviewTimer);
        glowPreviewTimer = 0;
      }

      if (discardPreview && runtime.isPluginRuntime()) {
        setGlowButtonsDisabled(true);
        try {
          await runtime.callHost("photoshop.runToolAction", [{ action: "glowPreviewCancel" }], { timeoutMs: 30000 });
          setQuickGlowStatus("已取消辉光预览并清理临时预览层。", "info");
        } catch (error) {
          const message = `取消辉光预览失败：${error.message}`;
          setQuickGlowStatus(message, "error");
          logToWorkspace(message, "error");
        } finally {
          setGlowButtonsDisabled(false);
        }
      }

      modules.workspace.setModalOpen("glowModal", false);
    };

    updateGlowLabels();
    [glowStyleInput, glowStrengthInput, glowRadiusInput, glowThresholdInput, glowSaturationInput]
      .filter(Boolean)
      .forEach((input) => {
        input.addEventListener("input", () => {
          updateGlowLabels();
          scheduleGlowPreviewUpdate();
        });
        input.addEventListener("change", () => {
          updateGlowLabels();
          scheduleGlowPreviewUpdate();
        });
      });

    if (glowOpenButton) {
      glowOpenButton.addEventListener("click", () => {
        void openGlowModal();
      });
    }

    if (glowApplyButton) {
      glowApplyButton.addEventListener("click", async () => {
        const state = readGlowState();
        if (!runtime.isPluginRuntime()) {
          setGlowStatus("浏览器预览模式下不会把辉光应用到 Photoshop。", "warn");
          await closeGlowModal(false);
          return;
        }

        setGlowButtonsDisabled(true);
        try {
          await flushGlowPreviewUpdate();
          const result = await callGlowHostAction("glowPreviewCommit");
          const successMessage = result && result.message ? result.message : `已生成 Glow ${state.strength}%`;
          logToWorkspace(successMessage, "success");
          setGlowStatus(successMessage, "success");
          setQuickGlowStatus(`${getGlowStyleLabel(state.style)} / 强度 ${state.strength}% / 半径 ${state.radius} / 阈值 ${state.threshold}%`, "success");
          glowPreviewOpen = false;
          modules.workspace.setModalOpen("glowModal", false);
        } catch (error) {
          const message = `应用辉光失败：${error.message}`;
          logToWorkspace(message, "error");
          setGlowStatus(message, "error");
        } finally {
          setGlowButtonsDisabled(false);
        }
      });
    }

    if (glowCancelButton) {
      glowCancelButton.addEventListener("click", () => {
        void closeGlowModal(true);
      });
    }

    if (glowModalClose) {
      glowModalClose.addEventListener("click", () => {
        void closeGlowModal(true);
      });
    }

    document.addEventListener("click", (event) => {
      if (event.target && event.target.closest("#glowBackdrop")) {
        void closeGlowModal(true);
      }
    });

    const toolConfigs = [
      { id: "btnObserver", payload: { action: "observerLayer", layerName: "黑白观察层" }, pending: "正在创建黑白观察层...", success: (result) => (result && result.message ? result.message : "已创建黑白观察层") },
      { id: "btnNeutralGray", payload: { action: "neutralGrayLayer" }, pending: "正在创建中性灰图层...", success: (result) => (result && result.message ? result.message : "已创建中性灰图层") },
      { id: "btnGaussianBlur", payload: { action: "gaussianBlur", radius: 4 }, pending: "正在打开高斯模糊...", success: (result) => (result && result.message ? result.message : "已打开高斯模糊") },
      { id: "btnSharpen", payload: { action: "sharpen" }, pending: "正在打开锐化...", success: (result) => (result && result.message ? result.message : "已打开锐化") },
      { id: "btnHighPass", payload: { action: "highPass", radius: 2 }, pending: "正在打开高反差保留...", success: (result) => (result && result.message ? result.message : "已打开高反差保留") },
      { id: "btnStamp", payload: { action: "stampVisible", layerName: "盖印图层" }, pending: "正在生成盖印图层...", success: (result) => (result && result.message ? result.message : "已生成盖印图层") },
      { id: "btnContentAwareFill", payload: { action: "contentAwareFill" }, pending: "正在触发内容识别填充...", success: (result) => (result && result.message ? result.message : "已触发内容识别填充") },
      { id: "btnSelectAndMask", payload: { action: "selectAndMask" }, pending: "正在触发选择并遮住...", success: (result) => (result && result.message ? result.message : "已触发选择并遮住") }
    ];

    toolConfigs.forEach((config) => {
      const button = runtime.getById(config.id);
      if (!button) return;
      button.addEventListener("click", async () => {
        if (!runtime.isPluginRuntime()) {
          logToWorkspace(`浏览器预览模式下不会执行工具动作：${config.id}`, "info");
          return;
        }
        button.disabled = true;
        logToWorkspace(config.pending, "info");
        try {
          const result = await runtime.callHost("photoshop.runToolAction", [config.payload], { timeoutMs: 45000 });
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
