import {
  FILM_DEFAULTS,
  getFilmPresets,
  getPostFxEffects,
  normalizePostFxParams,
  renderPostFxImageData
} from "./post-fx/renderer.js";

(function initPostFxModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const PREVIEW_CAPTURE_MAX_DIMENSION = 4000;
  const PREVIEW_MAX_SCALE = 24;
  const PREVIEW_DEBOUNCE_MS = 90;
  const state = {
    bound: false,
    captured: null,
    sourceImage: null,
    params: normalizePostFxParams({ ...FILM_DEFAULTS, effectType: "film" }),
    previewTimer: 0,
    previewBusy: false,
    pendingPreview: false,
    renderJob: 0,
    lastRender: null,
    mode: "effect",
    view: {
      scale: 1,
      x: 0,
      y: 0,
      isPanning: false,
      startX: 0,
      startY: 0,
      startPanX: 0,
      startPanY: 0
    }
  };

  function getById(id) {
    return modules.runtime.getById(id);
  }

  function clamp(value, min, max, fallback = min) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("无法读取 Photoshop 预览图像"));
      image.src = dataUrl;
    });
  }

  function imageToImageData(image) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, image.naturalWidth || image.width || 1);
    canvas.height = Math.max(1, image.naturalHeight || image.height || 1);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前环境不支持 Canvas 预览");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }

  function imageDataToDataUrl(imageData) {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境不支持 Canvas 输出");
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  }

  function setStatus(message, type = "info") {
    modules.runtime.setSummaryStatus(getById("postFxHint"), message, type);
  }

  function setMeta(message) {
    const node = getById("postFxPreviewMeta");
    if (node) node.textContent = String(message || "");
  }

  function setBadge(message, type = "info") {
    const node = getById("postFxPreviewState");
    if (!node) return;
    node.textContent = String(message || "");
    node.dataset.status = type;
  }

  function getFullBounds(captured, width, height) {
    const documentInfo = captured && captured.document && typeof captured.document === "object"
      ? captured.document
      : {};
    return {
      left: 0,
      top: 0,
      right: Math.max(1, Number(documentInfo.width) || Number(captured && captured.originalWidth) || Number(width) || 1),
      bottom: Math.max(1, Number(documentInfo.height) || Number(captured && captured.originalHeight) || Number(height) || 1)
    };
  }

  function readParams() {
    const value = (id, fallback) => getById(id) ? getById(id).value : fallback;
    const checked = (id, fallback) => getById(id) ? Boolean(getById(id).checked) : fallback;
    return normalizePostFxParams({
      effectType: value("postFxEffectTypeInput", state.params.effectType),
      effectEnabled: checked("postFxEffectEnabledInput", state.params.effectEnabled),
      effectAmount: value("postFxEffectAmountInput", state.params.effectAmount),
      filmFinish: checked("postFxFilmFinishInput", state.params.filmFinish),
      preset: value("postFxPresetInput", state.params.preset),
      amount: value("postFxAmountInput", state.params.amount),
      halation: value("postFxHalationInput", state.params.halation),
      halationThreshold: value("postFxHalationThresholdInput", state.params.halationThreshold),
      halationRadius: value("postFxHalationRadiusInput", state.params.halationRadius),
      grain: value("postFxGrainInput", state.params.grain),
      grainSize: value("postFxGrainSizeInput", state.params.grainSize),
      grainColor: value("postFxGrainColorInput", state.params.grainColor),
      vignette: value("postFxVignetteInput", state.params.vignette),
      dispersion: value("postFxDispersionInput", state.params.dispersion),
      dispersionRadius: value("postFxDispersionRadiusInput", state.params.dispersionRadius),
      dispersionHighlightsOnly: checked("postFxDispersionHighlightsInput", state.params.dispersionHighlightsOnly),
      crtStrength: value("postFxCrtStrengthInput", state.params.crtStrength),
      crtPixelGrid: value("postFxCrtPixelGridInput", state.params.crtPixelGrid),
      crtScanlines: value("postFxCrtScanlinesInput", state.params.crtScanlines),
      crtCurvature: value("postFxCrtCurvatureInput", state.params.crtCurvature),
      crtConvergence: value("postFxCrtConvergenceInput", state.params.crtConvergence),
      pixelBlockSize: value("postFxPixelBlockSizeInput", state.params.pixelBlockSize),
      pixelLevels: value("postFxPixelLevelsInput", state.params.pixelLevels),
      pixelDither: value("postFxPixelDitherInput", state.params.pixelDither),
      pixelEdgePreserve: value("postFxPixelEdgePreserveInput", state.params.pixelEdgePreserve),
      windDirection: value("postFxWindDirectionInput", state.params.windDirection),
      windLength: value("postFxWindLengthInput", state.params.windLength),
      windBreakup: value("postFxWindBreakupInput", state.params.windBreakup),
      windEdgeProtect: value("postFxWindEdgeProtectInput", state.params.windEdgeProtect),
      shatterFragmentSize: value("postFxShatterFragmentSizeInput", state.params.shatterFragmentSize),
      shatterScatter: value("postFxShatterScatterInput", state.params.shatterScatter),
      shatterDirection: value("postFxShatterDirectionInput", state.params.shatterDirection),
      shatterCracks: value("postFxShatterCracksInput", state.params.shatterCracks),
      seed: state.params.seed
    });
  }

  function setControlValue(id, value) {
    const node = getById(id);
    if (node) node.value = String(value);
  }

  function setChecked(id, value) {
    const node = getById(id);
    if (node) node.checked = Boolean(value);
  }

  function syncControls() {
    const params = state.params;
    setControlValue("postFxEffectTypeInput", params.effectType);
    setChecked("postFxEffectEnabledInput", params.effectEnabled);
    setControlValue("postFxEffectAmountInput", params.effectAmount);
    setChecked("postFxFilmFinishInput", params.filmFinish);
    setControlValue("postFxPresetInput", params.preset);
    setControlValue("postFxAmountInput", params.amount);
    setControlValue("postFxHalationInput", params.halation);
    setControlValue("postFxHalationThresholdInput", params.halationThreshold);
    setControlValue("postFxHalationRadiusInput", params.halationRadius);
    setControlValue("postFxGrainInput", params.grain);
    setControlValue("postFxGrainSizeInput", params.grainSize);
    setControlValue("postFxGrainColorInput", params.grainColor);
    setControlValue("postFxVignetteInput", params.vignette);
    setControlValue("postFxDispersionInput", params.dispersion);
    setControlValue("postFxDispersionRadiusInput", params.dispersionRadius);
    setChecked("postFxDispersionHighlightsInput", params.dispersionHighlightsOnly);
    [
      ["postFxAmountValue", `${Math.round(params.amount)}%`],
      ["postFxHalationValue", `${Math.round(params.halation)}%`],
      ["postFxHalationThresholdValue", `${Math.round(params.halationThreshold)}%`],
      ["postFxHalationRadiusValue", `${Math.round(params.halationRadius)}px`],
      ["postFxGrainValue", `${Math.round(params.grain)}%`],
      ["postFxGrainSizeValue", `${Math.round(params.grainSize)}px`],
      ["postFxGrainColorValue", `${Math.round(params.grainColor)}%`],
      ["postFxVignetteValue", `${Math.round(params.vignette)}%`],
      ["postFxDispersionValue", `${Math.round(params.dispersion)}%`],
      ["postFxDispersionRadiusValue", `${Math.round(params.dispersionRadius)}%`],
      ["postFxEffectAmountValue", `${Math.round(params.effectAmount)}%`],
      ["postFxCrtStrengthValue", `${Math.round(params.crtStrength)}%`],
      ["postFxCrtPixelGridValue", `${Math.round(params.crtPixelGrid)}%`],
      ["postFxCrtScanlinesValue", `${Math.round(params.crtScanlines)}%`],
      ["postFxCrtCurvatureValue", `${Math.round(params.crtCurvature)}%`],
      ["postFxCrtConvergenceValue", `${Math.round(params.crtConvergence)}%`],
      ["postFxPixelBlockSizeValue", `${Math.round(params.pixelBlockSize)}px`],
      ["postFxPixelLevelsValue", `${Math.round(params.pixelLevels)}`],
      ["postFxPixelDitherValue", `${Math.round(params.pixelDither)}%`],
      ["postFxPixelEdgePreserveValue", `${Math.round(params.pixelEdgePreserve)}%`],
      ["postFxWindDirectionValue", `${Math.round(params.windDirection)}°`],
      ["postFxWindLengthValue", `${Math.round(params.windLength)}%`],
      ["postFxWindBreakupValue", `${Math.round(params.windBreakup)}%`],
      ["postFxWindEdgeProtectValue", `${Math.round(params.windEdgeProtect)}%`],
      ["postFxShatterFragmentSizeValue", `${Math.round(params.shatterFragmentSize)}px`],
      ["postFxShatterScatterValue", `${Math.round(params.shatterScatter)}%`],
      ["postFxShatterDirectionValue", `${Math.round(params.shatterDirection)}°`],
      ["postFxShatterCracksValue", `${Math.round(params.shatterCracks)}%`]
    ].forEach(([id, value]) => {
      const node = getById(id);
      if (node) node.textContent = value;
    });
    const badge = getById("postFxPresetBadge");
    const preset = getFilmPresets().find((item) => item.id === params.preset) || {};
    const effect = getPostFxEffects().find((item) => item.id === params.effectType) || {};
    const label = effect.label || preset.label || "镜头与后期";
    const description = getById("postFxPresetDescription");
    if (description) description.textContent = effect.description || preset.description || "选择一种效果，再用胶片质感收尾。";
    if (badge) badge.textContent = label;
    const modalBadge = getById("postFxPresetBadgeModal");
    if (modalBadge) modalBadge.textContent = label;
    document.querySelectorAll("[data-post-fx-effect]").forEach((button) => {
      const active = button.getAttribute("data-post-fx-effect") === params.effectType;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    document.querySelectorAll("[data-post-fx-effect-controls]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-post-fx-effect-controls") !== params.effectType;
    });
    const finish = getById("postFxFinishOptions");
    if (finish) finish.hidden = params.effectType === "film";
  }

  function getPreviewContentMetrics() {
    const viewport = getById("postFxPreviewViewport");
    const canvas = getById("postFxResultCanvas");
    const rect = viewport && viewport.getBoundingClientRect
      ? viewport.getBoundingClientRect()
      : { width: 0, height: 0, left: 0, top: 0 };
    const contentWidth = Number(canvas && canvas.width) || Number(state.sourceImage && state.sourceImage.naturalWidth) || rect.width || 1;
    const contentHeight = Number(canvas && canvas.height) || Number(state.sourceImage && state.sourceImage.naturalHeight) || rect.height || 1;
    const scale = Math.max(0.35, Math.min(PREVIEW_MAX_SCALE, Number(state.view.scale) || 1));
    const fitScale = Math.min(rect.width / contentWidth || 1, rect.height / contentHeight || 1);
    const renderedWidth = contentWidth * fitScale * scale;
    const renderedHeight = contentHeight * fitScale * scale;
    return { rect, renderedWidth, renderedHeight, scale };
  }

  function clampPreviewView() {
    const viewport = getById("postFxPreviewViewport");
    if (!viewport) return;
    const metrics = getPreviewContentMetrics();
    state.view.scale = metrics.scale;
    const maxX = Math.max(0, (metrics.renderedWidth - metrics.rect.width) / 2);
    const maxY = Math.max(0, (metrics.renderedHeight - metrics.rect.height) / 2);
    state.view.x = clamp(state.view.x, -maxX, maxX, 0);
    state.view.y = clamp(state.view.y, -maxY, maxY, 0);
  }

  function applyPreviewTransform() {
    clampPreviewView();
    const transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`;
    [
      getById("postFxSourceImage"),
      getById("postFxResultCanvas"),
      getById("postFxResultImage")
    ].filter(Boolean).forEach((element) => {
      element.style.transform = transform;
    });
  }

  function resetPreviewTransform() {
    state.view.scale = 1;
    state.view.x = 0;
    state.view.y = 0;
    applyPreviewTransform();
  }

  function zoomPreview(nextScale, anchorX, anchorY) {
    const viewport = getById("postFxPreviewViewport");
    if (!viewport) return;
    const previousScale = Math.max(0.35, Number(state.view.scale) || 1);
    const scale = Math.max(0.35, Math.min(PREVIEW_MAX_SCALE, Number(nextScale) || 1));
    const rect = viewport.getBoundingClientRect();
    const localX = Number(anchorX) - rect.left - rect.width / 2;
    const localY = Number(anchorY) - rect.top - rect.height / 2;
    if (Math.abs(scale - previousScale) >= 0.001) {
      state.view.x = (state.view.x - localX) * (scale / previousScale) + localX;
      state.view.y = (state.view.y - localY) * (scale / previousScale) + localY;
    }
    state.view.scale = scale;
    if (scale <= 1.001) {
      state.view.x = 0;
      state.view.y = 0;
    }
    applyPreviewTransform();
  }

  function bindPreviewInteractions() {
    const viewport = getById("postFxPreviewViewport");
    if (!viewport) return;
    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1 / 1.18 : 1.18;
      zoomPreview(state.view.scale * factor, event.clientX, event.clientY);
    }, { passive: false });

    viewport.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      if (event.target && event.target.closest(".post-fx-preview-tools, .post-fx-preview-zoom-tools")) return;
      event.preventDefault();
      if ((Number(state.view.scale) || 1) <= 1.001) return;
      state.view.isPanning = true;
      state.view.startX = event.clientX;
      state.view.startY = event.clientY;
      state.view.startPanX = state.view.x;
      state.view.startPanY = state.view.y;
      viewport.classList.add("is-panning");
    });

    const movePan = (event) => {
      if (!state.view.isPanning) return;
      event.preventDefault();
      state.view.x = state.view.startPanX + event.clientX - state.view.startX;
      state.view.y = state.view.startPanY + event.clientY - state.view.startY;
      applyPreviewTransform();
    };
    const endPan = (event) => {
      if (!state.view.isPanning) return;
      event.preventDefault();
      state.view.isPanning = false;
      viewport.classList.remove("is-panning");
    };
    window.addEventListener("pointermove", movePan, { passive: false });
    window.addEventListener("pointerup", endPan, { passive: false });
    window.addEventListener("pointercancel", endPan, { passive: false });
    window.addEventListener("blur", () => {
      state.view.isPanning = false;
      viewport.classList.remove("is-panning");
    });
    window.addEventListener("resize", applyPreviewTransform);
    viewport.addEventListener("dblclick", resetPreviewTransform);
  }

  function setButtonsDisabled(disabled) {
    ["btnPostFxRecapture", "btnPostFxApply"].forEach((id) => {
      const button = getById(id);
      if (button) button.disabled = Boolean(disabled) || (id === "btnPostFxApply" && !state.lastRender);
    });
  }

  function drawPreview(imageData) {
    const canvas = getById("postFxResultCanvas");
    const resultImage = getById("postFxResultImage");
    if (!canvas) return;
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.putImageData(imageData, 0, 0);
    canvas.classList.add("is-active");
    if (resultImage) {
      resultImage.removeAttribute("src");
      resultImage.classList.remove("is-active");
    }
    const sourceImage = getById("postFxSourceImage");
    if (sourceImage) sourceImage.classList.toggle("is-active", state.mode === "original");
    canvas.classList.toggle("is-hidden-preview", state.mode === "original");
    applyPreviewTransform();
  }

  function drawPreviewCanvas(sourceCanvas) {
    const canvas = getById("postFxResultCanvas");
    const resultImage = getById("postFxResultImage");
    if (!canvas || !sourceCanvas) return;
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(sourceCanvas, 0, 0);
    canvas.classList.add("is-active");
    canvas.classList.toggle("is-hidden-preview", state.mode === "original");
    if (resultImage) {
      resultImage.removeAttribute("src");
      resultImage.classList.remove("is-active");
    }
    const sourceImage = getById("postFxSourceImage");
    if (sourceImage) sourceImage.classList.toggle("is-active", state.mode === "original");
    applyPreviewTransform();
  }

  function drawPreviewDataUrl(dataUrl) {
    const resultImage = getById("postFxResultImage");
    const canvas = getById("postFxResultCanvas");
    if (!resultImage) return;
    resultImage.src = String(dataUrl || "");
    resultImage.classList.add("is-active");
    if (canvas) {
      canvas.classList.remove("is-active");
      canvas.classList.remove("is-hidden-preview");
    }
    const sourceImage = getById("postFxSourceImage");
    if (sourceImage) sourceImage.classList.toggle("is-active", state.mode === "original");
    resultImage.classList.toggle("is-hidden-preview", state.mode === "original");
    applyPreviewTransform();
  }

  function setPreviewMode(mode) {
    state.mode = ["original", "effect"].includes(mode) ? mode : "effect";
    document.querySelectorAll("[data-post-fx-preview-mode]").forEach((button) => {
      button.classList.toggle("active", button.getAttribute("data-post-fx-preview-mode") === state.mode);
    });
    const sourceImage = getById("postFxSourceImage");
    const canvas = getById("postFxResultCanvas");
    const resultImage = getById("postFxResultImage");
    if (sourceImage) sourceImage.classList.toggle("is-active", state.mode === "original");
    if (canvas) canvas.classList.toggle("is-hidden-preview", state.mode === "original");
    if (resultImage) {
      resultImage.classList.toggle("is-active", state.mode === "effect" && resultImage.hasAttribute("src"));
      resultImage.classList.toggle("is-hidden-preview", state.mode === "original");
    }
    applyPreviewTransform();
  }

  async function capturePreview() {
    if (!modules.runtime.isPluginRuntime()) throw new Error("浏览器预览模式下不可捕获 Photoshop 图像");
    if (modules.license && !modules.license.requireFeature("postFx")) throw new Error("镜头与后期需要授权");
    const captured = await modules.runtime.callHost("photoshop.captureLicensedPostFxPreview", [{
      maxDimension: PREVIEW_CAPTURE_MAX_DIMENSION,
      ignoreSelection: true,
      quality: 92,
      captureFormat: "jpeg",
      uploadTargetBytes: 18_000_000,
      uploadHardLimitBytes: 24_000_000
    }], { timeoutMs: 60000 });
    if (!captured || !String(captured.dataUrl || "").trim()) throw new Error("Photoshop 未返回可用图像");
    return captured;
  }

  async function refreshPreview() {
    if (!state.sourceImage) return;
    const job = ++state.renderJob;
    state.params = readParams();
    setBadge("正在预览", "pending");
    const effectLabel = (getPostFxEffects().find((item) => item.id === state.params.effectType) || {}).label || "后期效果";
    setStatus(`正在更新${effectLabel}预览...`, "info");
    const startedAt = performance.now();
    try {
      let result = null;
      let backend = "cpu";
      const gpuRenderer = modules.postFxWebglRenderer;
      const sourceWidth = Number(state.sourceImage.naturalWidth || state.sourceImage.width) || 0;
      const sourceHeight = Number(state.sourceImage.naturalHeight || state.sourceImage.height) || 0;
      if (gpuRenderer && gpuRenderer.canRender(sourceWidth, sourceHeight)) {
        try {
          result = gpuRenderer.renderImage(state.sourceImage, state.params, { returnDataUrl: false });
          backend = result.backend || "webgl2";
        } catch (error) {
          console.warn("[PixelRunner] WebGL2 post FX preview failed, falling back to CPU:", error);
        }
      }
      if (!result) {
        const source = imageToImageData(state.sourceImage);
        const imageData = renderPostFxImageData(source, state.params);
        result = { imageData, width: imageData.width, height: imageData.height };
      }
      if (job !== state.renderJob) return;
      state.lastRender = result;
      if (result.canvas) drawPreviewCanvas(result.canvas);
      else if (result.imageData) drawPreview(result.imageData);
      else if (result.dataUrl) drawPreviewDataUrl(result.dataUrl);
      const elapsed = Math.round(performance.now() - startedAt);
      setBadge("实时预览", "success");
      setMeta(`预览 ${result.width}×${result.height} · ${elapsed}ms · ${backend} · ${effectLabel}`);
      setStatus("预览已更新，确认后会重新读取原始尺寸并生成盖印结果层。", "success");
      setButtonsDisabled(false);
    } catch (error) {
      setBadge("预览失败", "error");
      setStatus(`镜头与后期预览失败：${error.message}`, "error");
      setMeta("预览失败，请重新捕获当前 Photoshop 图像。");
    } finally {
      state.previewBusy = false;
      if (state.pendingPreview) {
        state.pendingPreview = false;
        schedulePreview();
      }
    }
  }

  function schedulePreview() {
    if (!state.sourceImage) return;
    if (state.previewBusy) {
      state.pendingPreview = true;
      return;
    }
    if (state.previewTimer) window.clearTimeout(state.previewTimer);
    state.previewTimer = window.setTimeout(() => {
      state.previewTimer = 0;
      state.previewBusy = true;
      void refreshPreview();
    }, PREVIEW_DEBOUNCE_MS);
  }

  async function recapture() {
    const openButton = getById("btnOpenPostFxPanel");
    const recaptureButton = getById("btnPostFxRecapture");
    const applyButton = getById("btnPostFxApply");
    [openButton, recaptureButton, applyButton].filter(Boolean).forEach((button) => { button.disabled = true; });
    state.lastRender = null;
    setBadge("正在捕获", "pending");
    setStatus("正在盖印当前可见图层并捕获预览...", "info");
    setMeta("正在读取 Photoshop 当前可见内容...");
    try {
      const captured = await capturePreview();
      const image = await loadImage(captured.dataUrl);
      state.captured = captured;
      state.sourceImage = image;
      resetPreviewTransform();
      const sourceImage = getById("postFxSourceImage");
      if (sourceImage) {
        sourceImage.src = captured.dataUrl;
        sourceImage.classList.remove("is-active");
      }
      const inline = getById("postFxInlinePreview");
      if (inline) inline.hidden = false;
      setPreviewMode("effect");
      syncControls();
      await refreshPreview();
    } catch (error) {
      setBadge("捕获失败", "error");
      setStatus(`镜头与后期捕获失败：${error.message}`, "error");
      setMeta("捕获失败，请确认 Photoshop 中存在打开的文档。");
    } finally {
      if (openButton) openButton.disabled = false;
      if (recaptureButton) recaptureButton.disabled = false;
      setButtonsDisabled(false);
    }
  }

  async function captureFullResolution() {
    if (!state.captured) throw new Error("缺少预览捕获信息");
    const captured = await modules.runtime.callHost("photoshop.captureLicensedPostFxSource", [{
      expectedDocumentId: state.captured.documentId,
      fullResolution: true,
      ignoreSelection: true,
      captureFormat: "png"
    }], { timeoutMs: 180000 });
    if (!captured || !String(captured.dataUrl || "").trim()) throw new Error("Photoshop 未返回原始尺寸图像");
    const expected = getFullBounds(state.captured);
    const actual = getFullBounds(captured);
    if (expected.right !== actual.right || expected.bottom !== actual.bottom) {
      throw new Error("Photoshop 文档尺寸已变化，请重新捕获后再应用");
    }
    return captured;
  }

  async function apply() {
    if (!state.captured || !state.sourceImage) {
      setStatus("请先捕获图像并生成预览。", "warn");
      return;
    }
    if (!modules.runtime.isPluginRuntime()) {
      setStatus("浏览器预览模式下不会写回 Photoshop。", "warn");
      return;
    }
    if (modules.license && !modules.license.requireFeature("postFx")) return;
    const applyButton = getById("btnPostFxApply");
    if (applyButton) applyButton.disabled = true;
    setBadge("正在应用", "pending");
    setStatus("正在重新捕获原始尺寸的盖印图像...", "info");
    setMeta("原始尺寸应用不会使用低分辨率预览像素。");
    try {
      const fullCapture = await captureFullResolution();
      const fullImage = await loadImage(fullCapture.dataUrl);
      const expectedBounds = getFullBounds(fullCapture);
      const params = readParams();
      setStatus("正在按预览参数处理原始尺寸图像...", "info");
      let result = null;
      let backend = "cpu";
      const gpuRenderer = modules.postFxWebglRenderer;
      const sourceWidth = Number(fullImage.naturalWidth || fullImage.width) || 0;
      const sourceHeight = Number(fullImage.naturalHeight || fullImage.height) || 0;
      const expectedWidth = Math.max(1, Math.round(expectedBounds.right - expectedBounds.left));
      const expectedHeight = Math.max(1, Math.round(expectedBounds.bottom - expectedBounds.top));
      if (sourceWidth !== expectedWidth || sourceHeight !== expectedHeight) {
        throw new Error(`原始捕获尺寸不完整：${sourceWidth}×${sourceHeight}，文档应为 ${expectedWidth}×${expectedHeight}。请降低图像尺寸或重新捕获`);
      }
      if (gpuRenderer && gpuRenderer.canRender(sourceWidth, sourceHeight)) {
        try {
          result = gpuRenderer.renderImage(fullImage, params);
          backend = result.backend || "webgl2";
        } catch (error) {
          console.warn("[PixelRunner] WebGL2 post FX apply failed, falling back to CPU:", error);
        }
      }
      if (!result) {
        const source = imageToImageData(fullImage);
        const imageData = renderPostFxImageData(source, params);
        result = { dataUrl: imageDataToDataUrl(imageData), width: imageData.width, height: imageData.height };
      }
      const dataUrl = result.dataUrl;
      if (Number(result.width) !== Number(fullCapture.width) || Number(result.height) !== Number(fullCapture.height)) {
        throw new Error(`后期结果尺寸不一致：结果 ${result.width}×${result.height}，来源 ${fullCapture.width}×${fullCapture.height}`);
      }
      const bounds = getFullBounds(fullCapture, result.width, result.height);
      const label = (getPostFxEffects().find((item) => item.id === params.effectType) || {}).label || "自定义";
      const response = await modules.runtime.callHost("photoshop.placeLicensedPostFxResult", [{
        dataUrl,
        targetDocumentId: fullCapture.documentId,
        sourceDocumentId: fullCapture.documentId,
        targetBounds: bounds,
        // The result and capture share the complete document canvas. Stretch
        // against those exact bounds so transparent content cannot make
        // Photoshop treat the visible subject bounds as the image canvas.
        fitMode: "stretch",
        preserveCanvasBounds: true,
        anchorTransparentCanvas: true,
        preferTransformBounds: false,
        applyMask: false,
        opacity: 100,
        blendMode: "normal",
        layerName: `像素起子 镜头与后期 - ${label}`
      }], { timeoutMs: 180000 });
      setBadge("已应用", "success");
      setStatus(response && response.message ? response.message : `已生成盖印结果层：像素起子 镜头与后期 - ${label}`, "success");
      setMeta(`已按 ${result.width}×${result.height} 原始尺寸生成新结果层（${backend}）。`);
      modules.ui && modules.ui.logToWorkspace && modules.ui.logToWorkspace(`镜头与后期已应用：${label}，${result.width}×${result.height}。`, "success");
    } catch (error) {
      setBadge("应用失败", "error");
      setStatus(`镜头与后期应用失败：${error.message}`, "error");
    } finally {
      if (applyButton) applyButton.disabled = false;
    }
  }

  function applyPreset(presetId) {
    const preset = getFilmPresets().some((item) => item.id === presetId) ? presetId : "natural";
    state.params = normalizePostFxParams({ ...state.params, preset, effectType: "film", filmFinish: true });
    syncControls();
    schedulePreview();
  }

  async function openModal() {
    if (modules.license && !modules.license.requireFeature("postFx")) return;
    modules.workspace.setModalOpen("postFxModal", true);
    syncControls();
    if (!modules.runtime.isPluginRuntime()) {
      setStatus("浏览器预览模式下可查看界面，但不会捕获或写回 Photoshop。", "warn");
      return;
    }
    if (!state.sourceImage) await recapture();
    else schedulePreview();
  }

  function closeModal() {
    modules.workspace.setModalOpen("postFxModal", false);
  }

  function bindActions() {
    if (state.bound) return;
    state.bound = true;
    const openButton = getById("btnOpenPostFxPanel");
    if (openButton) openButton.addEventListener("click", () => void openModal());
    ["postFxModalClose", "postFxBackdrop", "btnPostFxCancel"].forEach((id) => {
      const node = getById(id);
      if (node) node.addEventListener("click", closeModal);
    });
    const recaptureButton = getById("btnPostFxRecapture");
    if (recaptureButton) recaptureButton.addEventListener("click", () => void recapture());
    const applyButton = getById("btnPostFxApply");
    if (applyButton) applyButton.addEventListener("click", () => void apply());
    document.querySelectorAll("[data-post-fx-preview-mode]").forEach((button) => {
      button.addEventListener("click", () => setPreviewMode(button.getAttribute("data-post-fx-preview-mode")));
    });
    document.querySelectorAll("[data-post-fx-zoom]").forEach((button) => {
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = String(button.getAttribute("data-post-fx-zoom") || "");
        if (action === "reset") {
          resetPreviewTransform();
          return;
        }
        const viewport = getById("postFxPreviewViewport");
        if (!viewport) return;
        const rect = viewport.getBoundingClientRect();
        const factor = action === "in" ? 1.25 : 1 / 1.25;
        zoomPreview(state.view.scale * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
      });
    });
    bindPreviewInteractions();
    const presetInput = getById("postFxPresetInput");
    if (presetInput) presetInput.addEventListener("change", () => applyPreset(presetInput.value));
    document.querySelectorAll("[data-post-fx-effect]").forEach((button) => {
      button.addEventListener("click", () => {
        state.params = normalizePostFxParams({ ...state.params, effectType: button.getAttribute("data-post-fx-effect") });
        syncControls();
        schedulePreview();
      });
    });
    [
      "postFxEffectTypeInput", "postFxEffectEnabledInput", "postFxEffectAmountInput", "postFxFilmFinishInput",
      "postFxAmountInput", "postFxHalationInput",
      "postFxHalationThresholdInput", "postFxHalationRadiusInput", "postFxGrainInput", "postFxGrainSizeInput",
      "postFxGrainColorInput", "postFxVignetteInput", "postFxDispersionInput", "postFxDispersionRadiusInput",
      "postFxDispersionHighlightsInput", "postFxCrtStrengthInput", "postFxCrtPixelGridInput", "postFxCrtScanlinesInput", "postFxCrtCurvatureInput", "postFxCrtConvergenceInput",
      "postFxPixelBlockSizeInput", "postFxPixelLevelsInput", "postFxPixelDitherInput", "postFxPixelEdgePreserveInput",
      "postFxWindDirectionInput", "postFxWindLengthInput", "postFxWindBreakupInput", "postFxWindEdgeProtectInput",
      "postFxShatterFragmentSizeInput", "postFxShatterScatterInput", "postFxShatterDirectionInput", "postFxShatterCracksInput"
    ].forEach((id) => {
      const node = getById(id);
      if (!node) return;
      node.addEventListener("input", () => {
        state.params = readParams();
        syncControls();
        schedulePreview();
      });
      node.addEventListener("change", () => {
        state.params = readParams();
        syncControls();
        schedulePreview();
      });
    });
    const seedButton = getById("btnPostFxReseed");
    if (seedButton) seedButton.addEventListener("click", () => {
      state.params = normalizePostFxParams({ ...state.params, seed: Math.floor(Math.random() * 2147483647) });
      syncControls();
      schedulePreview();
    });
    syncControls();
  }

  modules.postFx = { bindActions, openModal, closeModal, getState: () => ({ ...state, params: { ...state.params } }) };
})(window);
