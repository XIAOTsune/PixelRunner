(function initUiModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const DONATION_LINKS = {
    wx: "wxp://f2f0xp-V9KpvqacwxxGZ3zXDCGI_z11NO-xT2ukCb4JHZyI",
    zfb: "https://qr.alipay.com/fkx12142r0sdwj4kizujk2f",
    runninghub: "https://www.runninghub.cn",
    tutorial: "./pages/runninghub-guide.html"
  };
  const GLOW_DEFAULTS = {
    style: "shine",
    strength: 40,
    radius: 20,
    threshold: 20,
    saturation: 0,
    brightnessBias: 0,
    colorEnabled: false,
    colorAmount: 0,
    colorHex: "#ffd27a",
    chromatic: 0
  };
  const GLOW_THRESHOLD_CURVE_EXPONENT = 1.8;
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
    const glowColorEnabledInput = runtime.getById("glowColorEnabledInput");
    const glowColorAmountInput = runtime.getById("glowColorAmountInput");
    const glowColorPickerInput = runtime.getById("glowColorPickerInput");
    const glowChromaticEnabledInput = runtime.getById("glowChromaticEnabledInput");
    const glowChromaticInput = runtime.getById("glowChromaticInput");
    const glowStrengthValue = runtime.getById("glowStrengthValue");
    const glowStrengthParamValue = runtime.getById("glowStrengthParamValue");
    const glowRadiusParamValue = runtime.getById("glowRadiusParamValue");
    const glowThresholdParamValue = runtime.getById("glowThresholdParamValue");
    const glowExposureParamValue = runtime.getById("glowExposureParamValue");
    const glowColorParamValue = runtime.getById("glowColorParamValue");
    const glowChromaticParamValue = runtime.getById("glowChromaticParamValue");
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
    const glowPreviewViewport = runtime.getById("glowPreviewViewport");
    const glowPreviewResultCanvas = runtime.getById("glowPreviewResultCanvas");
    const glowPreviewBaseImage = runtime.getById("glowPreviewBaseImage");
    const glowPreviewGlowImage = runtime.getById("glowPreviewGlowImage");
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
    const glowWorkbench = document.querySelector("#glowModal .glow-workbench");
    const glowSliderStack = document.querySelector("#glowModal .glow-slider-stack");

    let glowPreviewTimer = 0;
    let glowRefinePreviewTimer = 0;
    let glowPreviewInFlight = false;
    let glowPreviewNeedsReplay = false;
    let glowPreviewOpen = false;
    let glowPreviewHasContent = false;
    let glowLastPreviewSignature = "";
    let glowLastPreviewQuality = "";
    let glowPreviewQuality = "full";
    let glowCpuSourceAsset = null;
    let glowPreviewJobId = 0;
    let glowSliderDragging = false;
    let glowDragPreviewRaf = 0;
    let glowDragKickoffTimer = 0;
    let glowDragStartedAt = 0;
    let glowGpuFastPathAvailable = true;
    const GLOW_PROCESS_DIMENSION = 1000;
    const GLOW_INTERACTIVE_PROCESS_DIMENSION = GLOW_PROCESS_DIMENSION;
    const GLOW_DRAG_PROCESS_DIMENSION = GLOW_PROCESS_DIMENSION;
    const GLOW_FULL_PROCESS_DIMENSION = GLOW_PROCESS_DIMENSION;
    const glowPreviewView = {
      scale: 1,
      x: 0,
      y: 0,
      isPanning: false,
      startX: 0,
      startY: 0,
      startPanX: 0,
      startPanY: 0
    };

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

    const readGlowColorHex = () => {
      const value = String((glowColorPickerInput && glowColorPickerInput.value) || GLOW_DEFAULTS.colorHex).trim();
      return /^#[0-9a-fA-F]{6}$/.test(value) ? value : GLOW_DEFAULTS.colorHex;
    };

    const mapThresholdSliderToEffective = (sliderValue) => {
      const normalized = Math.max(0, Math.min(100, Number(sliderValue) || 0)) / 100;
      return Math.round(Math.pow(normalized, GLOW_THRESHOLD_CURVE_EXPONENT) * 100);
    };

    const readGlowState = () => ({
      style: readGlowStyle(),
      strength: readGlowSlider(glowStrengthInput, GLOW_DEFAULTS.strength, 0, 100),
      radius: readGlowSlider(glowRadiusInput, GLOW_DEFAULTS.radius, 1, 500),
      threshold: mapThresholdSliderToEffective(readGlowSlider(glowThresholdInput, GLOW_DEFAULTS.threshold, 0, 100)),
      saturation: 0,
      brightnessBias: readGlowSlider(glowBrightnessBiasInput, GLOW_DEFAULTS.brightnessBias, -100, 100),
      colorEnabled: !!(glowColorEnabledInput && glowColorEnabledInput.checked),
      colorAmount: readGlowSlider(glowColorAmountInput, GLOW_DEFAULTS.colorAmount, 0, 100),
      colorHex: readGlowColorHex(),
      chromaticEnabled: !!(glowChromaticEnabledInput && glowChromaticEnabledInput.checked),
      chromatic: readGlowSlider(glowChromaticInput, GLOW_DEFAULTS.chromatic, 0, 100)
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
      const thresholdSlider = readGlowSlider(glowThresholdInput, GLOW_DEFAULTS.threshold, 0, 100);
      if (glowStrengthValue) glowStrengthValue.textContent = `${getGlowStyleLabel(state.style)} ${state.strength}%`;
      if (glowStyleBadge) glowStyleBadge.textContent = `风格 ${getGlowStyleLabel(state.style)}`;
      if (glowRadiusValue) glowRadiusValue.textContent = `扩散 ${state.radius}`;
      if (glowThresholdValue) glowThresholdValue.textContent = `阈值 ${(state.threshold / 100).toFixed(2)}`;
      if (glowStrengthParamValue) glowStrengthParamValue.textContent = String(state.strength);
      if (glowRadiusParamValue) glowRadiusParamValue.textContent = String(state.radius);
      if (glowThresholdParamValue) glowThresholdParamValue.textContent = `${(state.threshold / 100).toFixed(2)} (滑块 ${thresholdSlider})`;
      if (glowExposureParamValue) glowExposureParamValue.textContent = String(state.brightnessBias);
      if (glowColorParamValue) glowColorParamValue.textContent = state.colorEnabled ? `${state.colorAmount}%` : "关";
      if (glowChromaticParamValue) glowChromaticParamValue.textContent = state.chromaticEnabled ? String(state.chromatic) : "关";
      if (glowColorAmountInput) glowColorAmountInput.disabled = !state.colorEnabled;
      if (glowColorPickerInput) glowColorPickerInput.disabled = !state.colorEnabled;
      if (glowChromaticInput) glowChromaticInput.disabled = !state.chromaticEnabled;
    };

    const updateGlowWorkbenchLayout = () => {
      if (!glowWorkbench || !glowSliderStack) return;
      const style = window.getComputedStyle(glowSliderStack);
      const template = String(style.gridTemplateColumns || "").trim();
      const isSingleColumn = !template || !template.includes(" ");
      glowWorkbench.classList.toggle("is-side-by-side", !isSingleColumn);
    };

    const clampGlowPreviewView = () => {
      const scale = Math.max(0.35, Math.min(8, Number(glowPreviewView.scale) || 1));
      glowPreviewView.scale = scale;
      const viewportRect = glowPreviewViewport && glowPreviewViewport.getBoundingClientRect
        ? glowPreviewViewport.getBoundingClientRect()
        : { width: 0, height: 0 };
      const viewportWidth = Number(viewportRect.width) || 0;
      const viewportHeight = Number(viewportRect.height) || 0;
      const naturalWidth = Number(glowPreviewResultImage && glowPreviewResultImage.naturalWidth) || viewportWidth || 1;
      const naturalHeight = Number(glowPreviewResultImage && glowPreviewResultImage.naturalHeight) || viewportHeight || 1;
      const baseNaturalWidth = Number(glowPreviewBaseImage && glowPreviewBaseImage.naturalWidth) || 0;
      const baseNaturalHeight = Number(glowPreviewBaseImage && glowPreviewBaseImage.naturalHeight) || 0;
      const canvasWidth = Number(glowPreviewResultCanvas && glowPreviewResultCanvas.width) || 0;
      const canvasHeight = Number(glowPreviewResultCanvas && glowPreviewResultCanvas.height) || 0;
      const contentWidth = baseNaturalWidth || canvasWidth || naturalWidth;
      const contentHeight = baseNaturalHeight || canvasHeight || naturalHeight;
      const fitScale = Math.min(viewportWidth / contentWidth || 1, viewportHeight / contentHeight || 1);
      const renderedWidth = contentWidth * fitScale * scale;
      const renderedHeight = contentHeight * fitScale * scale;
      const maxX = Math.max(0, (renderedWidth - viewportWidth) / 2);
      const maxY = Math.max(0, (renderedHeight - viewportHeight) / 2);
      glowPreviewView.x = Math.max(-maxX, Math.min(maxX, Number(glowPreviewView.x) || 0));
      glowPreviewView.y = Math.max(-maxY, Math.min(maxY, Number(glowPreviewView.y) || 0));
    };

    const applyGlowPreviewTransform = () => {
      clampGlowPreviewView();
      if (glowPreviewBaseImage) {
        glowPreviewBaseImage.style.transform = `translate(${glowPreviewView.x}px, ${glowPreviewView.y}px) scale(${glowPreviewView.scale})`;
      }
      if (glowPreviewGlowImage) {
        glowPreviewGlowImage.style.transform = `translate(${glowPreviewView.x}px, ${glowPreviewView.y}px) scale(${glowPreviewView.scale})`;
      }
      if (glowPreviewResultCanvas) {
        glowPreviewResultCanvas.style.transform = `translate(${glowPreviewView.x}px, ${glowPreviewView.y}px) scale(${glowPreviewView.scale})`;
      }
      if (!glowPreviewResultImage) return;
      glowPreviewResultImage.style.transform = `translate(${glowPreviewView.x}px, ${glowPreviewView.y}px) scale(${glowPreviewView.scale})`;
    };

    const drawGlowPreviewToCanvas = (glowResult) => {
      if (!glowPreviewResultCanvas || !glowResult) return false;
      const imageData = glowResult.previewImageData || glowResult.finalSimImageData;
      if (!imageData || !imageData.width || !imageData.height) return false;
      const width = Number(imageData.width) || 1;
      const height = Number(imageData.height) || 1;
      if (glowPreviewResultCanvas.width !== width) glowPreviewResultCanvas.width = width;
      if (glowPreviewResultCanvas.height !== height) glowPreviewResultCanvas.height = height;
      const ctx = glowPreviewResultCanvas.getContext("2d", { alpha: true, desynchronized: true });
      if (!ctx) return false;
      ctx.putImageData(imageData, 0, 0);
      glowPreviewResultCanvas.classList.add("is-active");
      if (glowPreviewResultImage) glowPreviewResultImage.classList.remove("is-active");
      return true;
    };

    const resetGlowPreviewTransform = () => {
      glowPreviewView.scale = 1;
      glowPreviewView.x = 0;
      glowPreviewView.y = 0;
      applyGlowPreviewTransform();
    };

    const zoomGlowPreview = (nextScale, anchorX, anchorY) => {
      if (!glowPreviewViewport) return;
      const previousScale = Math.max(0.35, Number(glowPreviewView.scale) || 1);
      const scale = Math.max(0.35, Math.min(8, Number(nextScale) || 1));
      const rect = glowPreviewViewport.getBoundingClientRect();
      const localX = Number(anchorX) - rect.left - rect.width / 2;
      const localY = Number(anchorY) - rect.top - rect.height / 2;
      if (Math.abs(scale - previousScale) >= 0.001) {
        glowPreviewView.x = (glowPreviewView.x - localX) * (scale / previousScale) + localX;
        glowPreviewView.y = (glowPreviewView.y - localY) * (scale / previousScale) + localY;
      }
      glowPreviewView.scale = scale;
      if (scale <= 1.001) {
        glowPreviewView.x = 0;
        glowPreviewView.y = 0;
      }
      applyGlowPreviewTransform();
    };

    const GLOW_PREVIEW_MAX_DIMENSION = 3000;

    const captureGlowCpuSource = async (maxDimension = GLOW_PREVIEW_MAX_DIMENSION) => {
      const captured = await runtime.callHost("photoshop.captureDocumentPreview", [{
        maxDimension,
        ignoreSelection: true,
        quality: 92,
        uploadTargetBytes: 18_000_000,
        uploadHardLimitBytes: 24_000_000
      }], { timeoutMs: 60000 });
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
        glowPreviewGlowImage,
        glowPreviewSourceMaskImage,
        glowPreviewProtectMaskImage,
        glowPreviewLumaImage,
        glowPreviewContrastImage,
        glowPreviewWhiteFlatImage,
        glowPreviewSkinLikeImage,
        glowPreviewDarkProtectImage
      ].filter(Boolean).forEach((image) => image.removeAttribute("src"));
      if (glowPreviewResultCanvas) {
        const ctx = glowPreviewResultCanvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, glowPreviewResultCanvas.width || 0, glowPreviewResultCanvas.height || 0);
        glowPreviewResultCanvas.classList.remove("is-active");
      }
      if (glowPreviewGlowImage) glowPreviewGlowImage.removeAttribute("src");
      if (glowPreviewResultImage) {
        glowPreviewResultImage.removeAttribute("src");
        glowPreviewResultImage.classList.remove("is-active");
      }
      glowPreviewHasContent = false;
      resetGlowPreviewTransform();
      if (glowPreviewMeta) glowPreviewMeta.textContent = "Glow Lab 等待捕获图像";
    };

    const updateInlineGlowPreview = (asset, glowResult) => {
      if (!asset || !glowResult) return;
      const sourceDataUrl = String(asset.dataUrl || "").trim();
      if (glowPreviewBaseImage) glowPreviewBaseImage.removeAttribute("src");
      if (glowPreviewGlowImage) glowPreviewGlowImage.removeAttribute("src");
      if (glowPreviewResultImage) {
        glowPreviewResultImage.removeAttribute("src");
        glowPreviewResultImage.classList.remove("is-active");
      }
      let drawn = false;
      if (glowResult.previewRenderedOnGpu && glowPreviewResultCanvas) {
        glowPreviewResultCanvas.classList.add("is-active");
        drawn = true;
      } else {
        drawn = drawGlowPreviewToCanvas(glowResult);
      }
      if (!drawn && !glowResult.previewRenderedOnGpu && glowPreviewResultImage) {
        glowPreviewResultImage.src = String(glowResult.previewDataUrl || glowResult.finalSimDataUrl || "").trim() || sourceDataUrl;
        glowPreviewResultImage.classList.add("is-active");
        if (glowPreviewResultCanvas) glowPreviewResultCanvas.classList.remove("is-active");
      }
      if (!glowPreviewHasContent) {
        resetGlowPreviewTransform();
      } else {
        applyGlowPreviewTransform();
      }
      glowPreviewHasContent = true;
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
        const sourceBackend = timings.sourceBackend ? ` ${timings.sourceBackend}` : "";
        const blurBackend = timings.blurBackend ? ` ${timings.blurBackend}` : "";
        const compositeBackend = timings.compositeBackend ? ` ${timings.compositeBackend}` : "";
        const qualityLabel = glowPreviewQuality === "interactive" ? "快速" : "精细";
        glowPreviewMeta.textContent = `预览 ${qualityLabel} · ${glowResult.width}x${glowResult.height} · total ${timings.totalMs || glowResult.elapsedMs || 0}ms · source${sourceBackend} ${timings.sourceMs || 0}ms / blur${blurBackend} ${timings.blurMs || 0}ms / composite${compositeBackend} ${timings.compositeMs || 0}ms · 强度 ${state.strength} / 扩散 ${state.radius} / 阈值 ${(state.threshold / 100).toFixed(2)} / 曝光 ${state.brightnessBias} / 颜色 ${state.colorEnabled ? `${state.colorHex} ${state.colorAmount}%` : "关"} / 色散 ${state.chromaticEnabled ? state.chromatic : "关"}`;
      }
    };

    const callGlowCpuPreviewAction = async (action) => {
      const state = readGlowState();
      if (action === "glowPreviewStart" || !glowCpuSourceAsset) {
        glowCpuSourceAsset = await captureGlowCpuSource(GLOW_PREVIEW_MAX_DIMENSION);
      }
      const sourceDataUrl = String(glowCpuSourceAsset.dataUrl || "").trim();
      const jobId = glowPreviewJobId + 1;
      glowPreviewJobId = jobId;
      const isInteractive = glowPreviewQuality === "interactive";
      const useFastInteractivePath = isInteractive && glowSliderDragging;
      const targetProcessDimension = useFastInteractivePath
        ? GLOW_DRAG_PROCESS_DIMENSION
        : (isInteractive ? GLOW_INTERACTIVE_PROCESS_DIMENSION : GLOW_FULL_PROCESS_DIMENSION);
      const sourceDocWidth = Number(glowCpuSourceAsset && (glowCpuSourceAsset.originalWidth || glowCpuSourceAsset.width)) || 0;
      const sourceDocHeight = Number(glowCpuSourceAsset && (glowCpuSourceAsset.originalHeight || glowCpuSourceAsset.height)) || 0;
      const sourceMaxSide = Math.max(1, sourceDocWidth, sourceDocHeight);
      const previewScale = targetProcessDimension > 0 ? Math.min(1, targetProcessDimension / sourceMaxSide) : 1;
      const targetWidth = Math.max(1, Math.round(sourceDocWidth * previewScale) || targetProcessDimension || sourceDocWidth || 1);
      const targetHeight = Math.max(1, Math.round(sourceDocHeight * previewScale) || targetProcessDimension || sourceDocHeight || 1);
      const gpuOnlyEligible = !!(
        useFastInteractivePath &&
        glowGpuFastPathAvailable &&
        modules.glowGpuCapabilities &&
        typeof modules.glowGpuCapabilities.canUseWebgl2 === "function" &&
        modules.glowGpuCapabilities.canUseWebgl2(targetWidth, targetHeight)
      );
      let glowResult;
      try {
        glowResult = await modules.glowPreviewEngine.createPreview(sourceDataUrl, state, {
          jobId,
          includeDebug: false,
          includeGlowLayer: true,
          returnImageData: true,
          gpuOnly: gpuOnlyEligible,
          previewQuality: isInteractive ? 0.76 : 0.82,
          processMaxDimension: targetProcessDimension
        });
      } catch (error) {
        if (!gpuOnlyEligible) throw error;
        glowGpuFastPathAvailable = false;
        glowResult = await modules.glowPreviewEngine.createPreview(sourceDataUrl, state, {
          jobId,
          includeDebug: false,
          includeGlowLayer: true,
          returnImageData: true,
          gpuOnly: false,
          previewQuality: isInteractive ? 0.76 : 0.82,
          processMaxDimension: targetProcessDimension
        });
      }
      if (Number(glowResult.jobId) !== Number(glowPreviewJobId)) {
        return {
          ok: false,
          stale: true,
          message: "已丢弃过期辉光预览结果。"
        };
      }
      updateInlineGlowPreview(glowCpuSourceAsset, glowResult);
      const timings = glowResult.timings || {};
      const sourceBackend = timings.sourceBackend || "cpu";
      const blurBackend = timings.blurBackend || "cpu";
      const compositeBackend = timings.compositeBackend || "cpu";
      const qualityLabel = glowPreviewQuality === "interactive" ? "快速" : "精细";
      return {
        ok: true,
        message: `Glow Lab 已更新（${qualityLabel}）：${glowResult.width}x${glowResult.height}，source ${sourceBackend} ${timings.sourceMs || 0}ms / blur ${blurBackend} ${timings.blurMs || 0}ms / composite ${compositeBackend} ${timings.compositeMs || 0}ms / total ${timings.totalMs || 0}ms。`,
        layerName: GLOW_PREVIEW_LAYER_NAME,
        elapsedMs: timings.totalMs || 0
      };
    };

    const commitGlowCpuResult = async () => {
      const state = readGlowState();
      const layerName = `Glow ${state.strength}%`;
      const commitStrength = state.style === "none" ? 0 : state.strength;
      if (!glowCpuSourceAsset) {
        glowCpuSourceAsset = await captureGlowCpuSource(GLOW_PREVIEW_MAX_DIMENSION);
      }
      let glowResult;
      try {
        glowResult = await modules.glowPreviewEngine.createPreview(
          String(glowCpuSourceAsset.dataUrl || "").trim(),
          { ...state, strength: commitStrength, useGpu: true },
          { includeDebug: false, processMaxDimension: GLOW_FULL_PROCESS_DIMENSION }
        );
      } catch (_) {
        glowResult = await modules.glowPreviewEngine.createPreview(
          String(glowCpuSourceAsset.dataUrl || "").trim(),
          { ...state, strength: commitStrength, useGpu: false },
          { includeDebug: false, processMaxDimension: GLOW_FULL_PROCESS_DIMENSION }
        );
      }
      const documentInfo = glowCpuSourceAsset.document || {};
      const result = await runtime.callHost("photoshop.placeResultFromUrl", [{
        dataUrl: glowResult.glowLayerDataUrl,
        targetDocumentId: glowCpuSourceAsset.documentId,
        targetBounds: {
          left: 0,
          top: 0,
          right: Number(documentInfo.width) || Number(glowCpuSourceAsset.originalWidth) || Number(glowResult.width) || 1,
          bottom: Number(documentInfo.height) || Number(glowCpuSourceAsset.originalHeight) || Number(glowResult.height) || 1
        },
        fitMode: "stretch",
        preserveCanvasBounds: true,
        anchorTransparentCanvas: true,
        applyMask: false,
        opacity: 100,
        blendMode: "screen",
        layerName
      }], { timeoutMs: 120000 });
      glowCpuSourceAsset = null;
      const timings = glowResult && glowResult.timings ? glowResult.timings : {};
      const backendLabel = [
        timings.sourceBackend || "cpu",
        timings.blurBackend || "cpu",
        timings.compositeBackend || "cpu"
      ].join("/");
      return {
        ok: true,
        message: result && result.message ? `${result.message}（backend ${backendLabel}）` : `已按预览一致算法生成 ${layerName}（backend ${backendLabel}）。`,
        layerName: result && result.layerName ? result.layerName : layerName
      };
    };

    const getGlowStateSignature = () => {
      const state = readGlowState();
      return [
        state.style,
        state.strength,
        state.radius,
        state.threshold,
        state.brightnessBias,
        state.colorEnabled ? state.colorHex : "color-off",
        state.colorEnabled ? state.colorAmount : 0,
        state.chromaticEnabled ? state.chromatic : 0
      ].join("|");
    };

    const getGlowPreviewSignature = () => `${getGlowStateSignature()}|${glowPreviewQuality}`;

    const getGlowPreviewDelay = () => {
      if (glowSliderDragging) return 24;
      const state = readGlowState();
      const cacheInfo = modules.glowPreviewEngine && typeof modules.glowPreviewEngine.getCacheInfo === "function"
        ? modules.glowPreviewEngine.getCacheInfo()
        : null;
      if (cacheInfo && cacheInfo.hasBlurResult) {
        return state.strength >= 76 ? 160 : 120;
      }
      if (cacheInfo && cacheInfo.hasSourceResult) {
        return state.radius >= 92 ? 210 : 170;
      }
      let delay = 220;
      if (state.radius >= 72) delay = 280;
      if (state.radius >= 92 || state.strength >= 76) delay = 340;
      if (state.brightnessBias >= 32) delay += 20;
      if (state.style === "shine") delay += 20;
      return delay;
    };

    const requestLiveGlowPreviewDuringDrag = () => {
      if (!glowPreviewOpen || !runtime.isPluginRuntime()) return;
      if (glowDragPreviewRaf) return;
      glowDragPreviewRaf = window.requestAnimationFrame(() => {
        glowDragPreviewRaf = 0;
        glowPreviewQuality = "interactive";
        glowPreviewJobId += 1;
        void runGlowPreviewUpdate("glowPreviewUpdate");
      });
    };

    const runGlowPreviewUpdate = async (action = "glowPreviewUpdate") => {
      if (!glowPreviewOpen || !runtime.isPluginRuntime()) return;
      const nextSignature = getGlowStateSignature();
      const nextPreviewSignature = getGlowPreviewSignature();
      if (action === "glowPreviewUpdate" && nextSignature === glowLastPreviewSignature && nextPreviewSignature === glowLastPreviewQuality && !glowPreviewNeedsReplay) {
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
      setGlowStatus(`正在更新辉光预览：${getGlowStyleLabel(state.style)} / 强度 ${state.strength}% / 扩散 ${state.radius} / 阈值 ${state.threshold}%`, "pending");

      try {
        const result = await callGlowCpuPreviewAction(action);
        if (result && result.stale) return;
        const message = result && result.message ? result.message : "辉光预览已更新。";
        glowLastPreviewSignature = nextSignature;
        glowLastPreviewQuality = nextPreviewSignature;
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

    const scheduleGlowPreviewUpdate = (quality = "interactive") => {
      if (!glowPreviewOpen || !runtime.isPluginRuntime()) return;
      if (glowPreviewTimer) clearTimeout(glowPreviewTimer);
      if (glowRefinePreviewTimer) {
        clearTimeout(glowRefinePreviewTimer);
        glowRefinePreviewTimer = 0;
      }
      glowPreviewQuality = quality;
      glowPreviewJobId += 1;
      const delay = getGlowPreviewDelay();
      glowPreviewTimer = window.setTimeout(() => {
        glowPreviewTimer = 0;
        void runGlowPreviewUpdate("glowPreviewUpdate");
      }, delay);
      if (quality === "interactive") {
        glowRefinePreviewTimer = 0;
      }
    };

    const flushGlowPreviewUpdate = async () => {
      if (!glowPreviewOpen || !runtime.isPluginRuntime()) return;
      if (glowPreviewTimer) {
        clearTimeout(glowPreviewTimer);
        glowPreviewTimer = 0;
      }
      if (glowRefinePreviewTimer) {
        clearTimeout(glowRefinePreviewTimer);
        glowRefinePreviewTimer = 0;
      }
      glowPreviewQuality = "full";
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
      glowLastPreviewQuality = "";
      glowPreviewQuality = "full";
      glowGpuFastPathAvailable = true;
      glowPreviewJobId += 1;
      if (modules.glowPreviewEngine && typeof modules.glowPreviewEngine.clearCache === "function") {
        modules.glowPreviewEngine.clearCache();
      }
      updateGlowWorkbenchLayout();
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
      if (glowRefinePreviewTimer) {
        clearTimeout(glowRefinePreviewTimer);
        glowRefinePreviewTimer = 0;
      }

      if (discardPreview) {
        setQuickGlowStatus("已取消插件内辉光预览，未写回 Photoshop。", "info");
      }

      modules.workspace.setModalOpen("glowModal", false);
    };

    updateGlowLabels();
    updateGlowWorkbenchLayout();
    window.addEventListener("resize", updateGlowWorkbenchLayout);
    if (typeof ResizeObserver === "function" && glowSliderStack) {
      const glowLayoutObserver = new ResizeObserver(() => {
        updateGlowWorkbenchLayout();
      });
      glowLayoutObserver.observe(glowSliderStack);
      if (glowWorkbench) glowLayoutObserver.observe(glowWorkbench);
    }

    if (glowPreviewViewport) {
      glowPreviewViewport.addEventListener("wheel", (event) => {
        event.preventDefault();
        const direction = event.deltaY > 0 ? -1 : 1;
        const factor = direction > 0 ? 1.18 : 1 / 1.18;
        zoomGlowPreview(glowPreviewView.scale * factor, event.clientX, event.clientY);
      }, { passive: false });

      glowPreviewViewport.addEventListener("pointerdown", (event) => {
        if (event.button != null && event.button !== 0) return;
        if ((Number(glowPreviewView.scale) || 1) <= 1.001) return;
        event.preventDefault();
        glowPreviewView.isPanning = true;
        glowPreviewView.startX = event.clientX;
        glowPreviewView.startY = event.clientY;
        glowPreviewView.startPanX = glowPreviewView.x;
        glowPreviewView.startPanY = glowPreviewView.y;
        glowPreviewViewport.classList.add("is-panning");
      });

      const movePan = (event) => {
        if (!glowPreviewView.isPanning) return;
        event.preventDefault();
        glowPreviewView.x = glowPreviewView.startPanX + event.clientX - glowPreviewView.startX;
        glowPreviewView.y = glowPreviewView.startPanY + event.clientY - glowPreviewView.startY;
        applyGlowPreviewTransform();
      };

      const endPan = (event) => {
        if (!glowPreviewView.isPanning) return;
        event.preventDefault();
        glowPreviewView.isPanning = false;
        glowPreviewViewport.classList.remove("is-panning");
      };
      window.addEventListener("pointermove", movePan, { passive: false });
      window.addEventListener("pointerup", endPan, { passive: false });
      window.addEventListener("pointercancel", endPan, { passive: false });
      window.addEventListener("blur", () => {
        glowPreviewView.isPanning = false;
        glowPreviewViewport.classList.remove("is-panning");
      });
      glowPreviewViewport.addEventListener("dblclick", resetGlowPreviewTransform);
    }

    if (glowPreviewResultImage) {
      glowPreviewResultImage.addEventListener("load", applyGlowPreviewTransform);
    }

    document.querySelectorAll("[data-glow-zoom]").forEach((button) => {
      button.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = String(button.getAttribute("data-glow-zoom") || "");
        if (action === "reset") {
          resetGlowPreviewTransform();
          return;
        }
        if (!glowPreviewViewport) return;
        const rect = glowPreviewViewport.getBoundingClientRect();
        const factor = action === "in" ? 1.25 : 1 / 1.25;
        zoomGlowPreview(glowPreviewView.scale * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
      });
    });

    const glowRealtimeInputs = [glowStrengthInput, glowRadiusInput, glowThresholdInput, glowBrightnessBiasInput, glowColorAmountInput, glowChromaticInput]
      .filter(Boolean);

    const stopSliderDragging = () => {
      if (!glowSliderDragging) return;
      glowSliderDragging = false;
      glowDragStartedAt = 0;
      if (glowDragKickoffTimer) {
        clearTimeout(glowDragKickoffTimer);
        glowDragKickoffTimer = 0;
      }
      if (glowDragPreviewRaf) {
        window.cancelAnimationFrame(glowDragPreviewRaf);
        glowDragPreviewRaf = 0;
      }
      scheduleGlowPreviewUpdate("full");
    };

    glowRealtimeInputs.forEach((input) => {
      input.addEventListener("pointerdown", () => {
        if (glowPreviewTimer) {
          clearTimeout(glowPreviewTimer);
          glowPreviewTimer = 0;
        }
        if (glowRefinePreviewTimer) {
          clearTimeout(glowRefinePreviewTimer);
          glowRefinePreviewTimer = 0;
        }
        glowSliderDragging = true;
        glowDragStartedAt = performance.now();
      });
      input.addEventListener("pointerup", stopSliderDragging);
      input.addEventListener("pointercancel", stopSliderDragging);
    });
    window.addEventListener("pointerup", stopSliderDragging);
    window.addEventListener("blur", stopSliderDragging);

    [glowStyleInput, glowStrengthInput, glowRadiusInput, glowThresholdInput, glowBrightnessBiasInput, glowColorEnabledInput, glowColorAmountInput, glowColorPickerInput, glowChromaticEnabledInput, glowChromaticInput]
      .filter(Boolean)
      .forEach((input) => {
        input.addEventListener("input", () => {
          updateGlowLabels();
          if (glowSliderDragging) {
            requestLiveGlowPreviewDuringDrag();
          } else {
            scheduleGlowPreviewUpdate("interactive");
          }
        });
        input.addEventListener("change", () => {
          updateGlowLabels();
          stopSliderDragging();
          scheduleGlowPreviewUpdate("full");
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
          setQuickGlowStatus(`${getGlowStyleLabel(state.style)} / 强度 ${state.strength}% / 扩散 ${state.radius} / 阈值 ${state.threshold}%`, "success");
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
