(function initUiModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const DONATION_LINKS = {
    wx: "wxp://f2f0xp-V9KpvqacwxxGZ3zXDCGI_z11NO-xT2ukCb4JHZyI",
    zfb: "https://qr.alipay.com/fkx12142r0sdwj4kizujk2f",
    runninghub: "https://www.runninghub.cn",
    tutorial: "./pages/runninghub-guide.html"
  };
  const GLOW_DEFAULTS = {
    style: "darkSoft",
    strength: 40,
    radius: 20,
    threshold: 20,
    saturation: 0,
    brightnessBias: 0
  };
  const GLOW_PREVIEW_LAYER_NAME = "PixelRunner Glow Preview";
  const GLOW_STYLE_LABELS = {
    none: "无",
    darksoft: "黑柔",
    darkSoft: "黑柔",
    whitesoft: "白柔",
    whiteSoft: "白柔",
    shine: "辉光",
    natural: "黑柔",
    soft: "白柔",
    dreamy: "辉光"
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
    const glowBrightnessBiasInput = runtime.getById("glowBrightnessBiasInput");
    const glowStrengthValue = runtime.getById("glowStrengthValue");
    const glowStrengthParamValue = runtime.getById("glowStrengthParamValue");
    const glowRadiusParamValue = runtime.getById("glowRadiusParamValue");
    const glowThresholdParamValue = runtime.getById("glowThresholdParamValue");
    const glowExposureParamValue = runtime.getById("glowExposureParamValue");
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
    const glowInlinePreview = runtime.getById("glowInlinePreview");
    const glowPreviewBaseImage = runtime.getById("glowPreviewBaseImage");
    const glowPreviewResultImage = runtime.getById("glowPreviewResultImage");
    const glowPreviewSourceMaskImage = runtime.getById("glowPreviewSourceMaskImage");
    const glowPreviewProtectMaskImage = runtime.getById("glowPreviewProtectMaskImage");
    const glowDebugPanel = document.querySelector(".glow-debug-panel");
    const glowPreviewLumaImage = runtime.getById("glowPreviewLumaImage");
    const glowPreviewContrastImage = runtime.getById("glowPreviewContrastImage");
    const glowPreviewWhiteFlatImage = runtime.getById("glowPreviewWhiteFlatImage");
    const glowPreviewSkinLikeImage = runtime.getById("glowPreviewSkinLikeImage");
    const glowPreviewDarkProtectImage = runtime.getById("glowPreviewDarkProtectImage");
    const glowPreviewMeta = runtime.getById("glowPreviewMeta");

    let glowPreviewTimer = 0;
    let glowPreviewInFlight = false;
    let glowPreviewNeedsReplay = false;
    let glowPreviewOpen = false;
    let glowLastPreviewSignature = "";
    let glowCpuSourceAsset = null;
    let glowPreviewJobId = 0;

    const readGlowSlider = (input, fallback, min, max) => {
      if (!input) return fallback;
      const parsed = Number(input.value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(min, Math.min(max, Math.round(parsed)));
    };

    const readGlowStyle = () => {
      const nextStyle = String((glowStyleInput && glowStyleInput.value) || GLOW_DEFAULTS.style).trim();
      return GLOW_STYLE_LABELS[nextStyle] ? nextStyle : GLOW_DEFAULTS.style;
    };

    const getGlowStyleLabel = (style) => GLOW_STYLE_LABELS[String(style || "").trim().toLowerCase()] || GLOW_STYLE_LABELS[GLOW_DEFAULTS.style];

    const readGlowState = () => ({
      style: readGlowStyle(),
      strength: readGlowSlider(glowStrengthInput, GLOW_DEFAULTS.strength, 0, 100),
      radius: readGlowSlider(glowRadiusInput, GLOW_DEFAULTS.radius, 1, 120),
      threshold: readGlowSlider(glowThresholdInput, GLOW_DEFAULTS.threshold, 0, 100),
      saturation: 0,
      brightnessBias: readGlowSlider(glowBrightnessBiasInput, GLOW_DEFAULTS.brightnessBias, -50, 50)
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
      if (glowThresholdValue) glowThresholdValue.textContent = `阈值 ${(state.threshold / 100).toFixed(2)}`;
      if (glowStrengthParamValue) glowStrengthParamValue.textContent = String(state.strength);
      if (glowRadiusParamValue) glowRadiusParamValue.textContent = String(state.radius);
      if (glowThresholdParamValue) glowThresholdParamValue.textContent = (state.threshold / 100).toFixed(2);
      if (glowExposureParamValue) glowExposureParamValue.textContent = String(state.brightnessBias);
    };

    const captureGlowCpuSource = async (maxDimension) => {
      const captured = await runtime.callHost("photoshop.captureDocumentPreview", [{
        maxDimension,
        quality: 92,
        uploadTargetBytes: 9_000_000,
        uploadHardLimitBytes: 10_000_000
      }], { timeoutMs: 45000 });
      if (!captured || !String(captured.dataUrl || "").trim()) {
        throw new Error("未能捕获当前 Photoshop 图像用于 CPU 辉光。");
      }
      return captured;
    };

    const clearGlowPreviewLayer = async () => {
      try {
        await runtime.callHost("photoshop.runToolAction", [{ action: "glowPreviewCancel" }], { timeoutMs: 30000 });
      } catch (_) {}
    };

    const clearInlineGlowPreview = () => {
      if (glowInlinePreview) glowInlinePreview.hidden = true;
      [
        glowPreviewBaseImage,
        glowPreviewResultImage,
        glowPreviewSourceMaskImage,
        glowPreviewProtectMaskImage,
        glowPreviewLumaImage,
        glowPreviewContrastImage,
        glowPreviewWhiteFlatImage,
        glowPreviewSkinLikeImage,
        glowPreviewDarkProtectImage
      ].filter(Boolean).forEach((image) => image.removeAttribute("src"));
      if (glowPreviewMeta) glowPreviewMeta.textContent = "Glow Lab 等待捕获图像";
    };

    const updateInlineGlowPreview = (asset, glowResult) => {
      if (!asset || !glowResult) return;
      const sourceDataUrl = String(asset.dataUrl || "").trim();
      if (glowPreviewBaseImage) glowPreviewBaseImage.src = String(glowResult.baseDataUrl || "").trim() || sourceDataUrl;
      if (glowPreviewResultImage) glowPreviewResultImage.src = String(glowResult.previewDataUrl || "").trim() || sourceDataUrl;
      if (glowPreviewSourceMaskImage) glowPreviewSourceMaskImage.src = String(glowResult.sourceMaskDataUrl || "").trim();
      if (glowPreviewProtectMaskImage) glowPreviewProtectMaskImage.src = String(glowResult.protectMaskDataUrl || "").trim();
      if (glowPreviewLumaImage) glowPreviewLumaImage.src = String(glowResult.debugDataUrls && glowResult.debugDataUrls.luma || "").trim();
      if (glowPreviewContrastImage) glowPreviewContrastImage.src = String(glowResult.debugDataUrls && glowResult.debugDataUrls.contrast || "").trim();
      if (glowPreviewWhiteFlatImage) glowPreviewWhiteFlatImage.src = String(glowResult.debugDataUrls && glowResult.debugDataUrls.whiteFlat || "").trim();
      if (glowPreviewSkinLikeImage) glowPreviewSkinLikeImage.src = String(glowResult.debugDataUrls && glowResult.debugDataUrls.skinLike || "").trim();
      if (glowPreviewDarkProtectImage) glowPreviewDarkProtectImage.src = String(glowResult.debugDataUrls && glowResult.debugDataUrls.darkProtect || "").trim();
      if (glowInlinePreview) glowInlinePreview.hidden = false;
      if (glowPreviewMeta) {
        const state = readGlowState();
        const timings = glowResult.timings || {};
        glowPreviewMeta.textContent = `预览 · ${glowResult.width}x${glowResult.height} · total ${timings.totalMs || glowResult.elapsedMs || 0}ms · source ${timings.sourceMs || 0}ms / blur ${timings.blurMs || 0}ms / composite ${timings.compositeMs || 0}ms · 强度 ${state.strength} / 半径 ${state.radius} / 阈值 ${(state.threshold / 100).toFixed(2)} / 曝光 ${state.brightnessBias}`;
      }
    };

    const callGlowCpuPreviewAction = async (action) => {
      const state = readGlowState();
      if (action === "glowPreviewStart" || !glowCpuSourceAsset) {
        glowCpuSourceAsset = await captureGlowCpuSource(320);
      }
      const sourceDataUrl = String(glowCpuSourceAsset.dataUrl || "").trim();
      const jobId = glowPreviewJobId + 1;
      glowPreviewJobId = jobId;
      const glowResult = await modules.glowPreviewEngine.createPreview(sourceDataUrl, state, {
        jobId,
        includeDebug: Boolean(glowDebugPanel && glowDebugPanel.open)
      });
      if (Number(glowResult.jobId) !== Number(glowPreviewJobId)) {
        return {
          ok: false,
          stale: true,
          message: "已丢弃过期辉光预览结果。"
        };
      }
      updateInlineGlowPreview(glowCpuSourceAsset, glowResult);
      const timings = glowResult.timings || {};
      return {
        ok: true,
        message: `Glow Lab 已更新：${glowResult.width}x${glowResult.height}，source ${timings.sourceMs || 0}ms / blur ${timings.blurMs || 0}ms / composite ${timings.compositeMs || 0}ms / total ${timings.totalMs || 0}ms。`,
        layerName: GLOW_PREVIEW_LAYER_NAME,
        elapsedMs: timings.totalMs || 0
      };
    };

    const commitGlowCpuResult = async () => {
      const state = readGlowState();
      await clearGlowPreviewLayer();
      const layerName = `Glow ${state.strength}%`;
      const commitStrength = state.style === "none" ? 0 : state.strength;
      const result = await runtime.callHost("photoshop.runToolAction", [{
        action: "glow",
        style: state.style,
        strength: commitStrength,
        radius: state.radius,
        threshold: state.threshold,
        saturation: state.saturation,
        brightnessBias: state.brightnessBias,
        layerName
      }], { timeoutMs: 120000 });
      glowCpuSourceAsset = null;
      return {
        ok: true,
        message: result && result.message ? result.message : `已按 Photoshop 原生管线生成 ${layerName}。`,
        layerName: result && result.layerName ? result.layerName : layerName
      };
    };

    const getGlowStateSignature = () => {
      const state = readGlowState();
      return [state.style, state.strength, state.radius, state.threshold, state.brightnessBias].join("|");
    };

    const getGlowPreviewDelay = () => {
      const state = readGlowState();
      let delay = 220;
      if (state.radius >= 72) delay = 280;
      if (state.radius >= 92 || state.strength >= 76) delay = 340;
      if (state.brightnessBias >= 32) delay += 20;
      if (state.style === "shine") delay += 20;
      return delay;
    };

    const runGlowPreviewUpdate = async (action = "glowPreviewUpdate") => {
      if (!glowPreviewOpen || !runtime.isPluginRuntime()) return;
      const nextSignature = getGlowStateSignature();
      if (action === "glowPreviewUpdate" && nextSignature === glowLastPreviewSignature && !glowPreviewNeedsReplay) {
        return;
      }
      if (glowPreviewInFlight) {
        glowPreviewNeedsReplay = true;
        glowPreviewJobId += 1;
        return;
      }

      glowPreviewInFlight = true;
      glowPreviewNeedsReplay = false;
      const state = readGlowState();
      setGlowPreviewBadge("正在预览", "pending");
      setGlowStatus(`正在更新辉光预览：${getGlowStyleLabel(state.style)} / 强度 ${state.strength}% / 半径 ${state.radius} / 阈值 ${state.threshold}%`, "pending");

      try {
        const result = await callGlowCpuPreviewAction(action);
        if (result && result.stale) return;
        const message = result && result.message ? result.message : "辉光预览已更新。";
        glowLastPreviewSignature = nextSignature;
        setGlowPreviewBadge("Glow Lab", "success");
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
      glowPreviewJobId += 1;
      const delay = getGlowPreviewDelay();
      glowPreviewTimer = window.setTimeout(() => {
        glowPreviewTimer = 0;
        void runGlowPreviewUpdate("glowPreviewUpdate");
      }, delay);
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
      glowPreviewJobId += 1;
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
      glowCpuSourceAsset = null;
      glowPreviewJobId += 1;
      clearInlineGlowPreview();
      if (glowPreviewTimer) {
        clearTimeout(glowPreviewTimer);
        glowPreviewTimer = 0;
      }

      if (discardPreview) {
        setQuickGlowStatus("已取消插件内辉光预览，未写回 Photoshop。", "info");
      }

      modules.workspace.setModalOpen("glowModal", false);
    };

    updateGlowLabels();
    [glowStyleInput, glowStrengthInput, glowRadiusInput, glowThresholdInput, glowBrightnessBiasInput]
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
          const result = await commitGlowCpuResult();
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

    if (glowDebugPanel) {
      glowDebugPanel.addEventListener("toggle", () => {
        if (glowDebugPanel.open) {
          glowLastPreviewSignature = "";
          scheduleGlowPreviewUpdate();
        }
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
