import {
  FILM_DEFAULTS,
  getFilmPresets,
  normalizeFilmParams,
  renderFilmImageData
} from "./post-fx/renderer.js";

(function initPostFxModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const PREVIEW_CAPTURE_MAX_DIMENSION = 2200;
  const PREVIEW_DEBOUNCE_MS = 90;
  const state = {
    bound: false,
    captured: null,
    sourceImage: null,
    params: normalizeFilmParams(FILM_DEFAULTS),
    previewTimer: 0,
    previewBusy: false,
    pendingPreview: false,
    renderJob: 0,
    lastRender: null,
    mode: "effect"
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
    return normalizeFilmParams({
      preset: value("postFxPresetInput", state.params.preset),
      amount: value("postFxAmountInput", state.params.amount),
      exposure: value("postFxExposureInput", state.params.exposure),
      contrast: value("postFxContrastInput", state.params.contrast),
      saturation: value("postFxSaturationInput", state.params.saturation),
      warmth: value("postFxWarmthInput", state.params.warmth),
      shadowLift: value("postFxShadowLiftInput", state.params.shadowLift),
      highlightRollOff: value("postFxHighlightRollOffInput", state.params.highlightRollOff),
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
    setControlValue("postFxPresetInput", params.preset);
    setControlValue("postFxAmountInput", params.amount);
    setControlValue("postFxExposureInput", params.exposure);
    setControlValue("postFxContrastInput", params.contrast);
    setControlValue("postFxSaturationInput", params.saturation);
    setControlValue("postFxWarmthInput", params.warmth);
    setControlValue("postFxShadowLiftInput", params.shadowLift);
    setControlValue("postFxHighlightRollOffInput", params.highlightRollOff);
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
      ["postFxExposureValue", `${Math.round(params.exposure)}`],
      ["postFxContrastValue", `${Math.round(params.contrast)}`],
      ["postFxSaturationValue", `${Math.round(params.saturation)}`],
      ["postFxWarmthValue", `${Math.round(params.warmth)}`],
      ["postFxShadowLiftValue", `${Math.round(params.shadowLift)}%`],
      ["postFxHighlightRollOffValue", `${Math.round(params.highlightRollOff)}%`],
      ["postFxHalationValue", `${Math.round(params.halation)}%`],
      ["postFxHalationThresholdValue", `${Math.round(params.halationThreshold)}%`],
      ["postFxHalationRadiusValue", `${Math.round(params.halationRadius)}px`],
      ["postFxGrainValue", `${Math.round(params.grain)}%`],
      ["postFxGrainSizeValue", `${Math.round(params.grainSize)}px`],
      ["postFxGrainColorValue", `${Math.round(params.grainColor)}%`],
      ["postFxVignetteValue", `${Math.round(params.vignette)}%`],
      ["postFxDispersionValue", `${Math.round(params.dispersion)}%`],
      ["postFxDispersionRadiusValue", `${Math.round(params.dispersionRadius)}%`]
    ].forEach(([id, value]) => {
      const node = getById(id);
      if (node) node.textContent = value;
    });
    const badge = getById("postFxPresetBadge");
    const label = (getFilmPresets().find((item) => item.id === params.preset) || {}).label || "写实胶片";
    if (badge) badge.textContent = label;
    const modalBadge = getById("postFxPresetBadgeModal");
    if (modalBadge) modalBadge.textContent = label;
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
    setStatus("正在更新写实胶片预览...", "info");
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
        const imageData = renderFilmImageData(source, state.params);
        result = { imageData, width: imageData.width, height: imageData.height };
      }
      if (job !== state.renderJob) return;
      state.lastRender = result;
      if (result.canvas) drawPreviewCanvas(result.canvas);
      else if (result.imageData) drawPreview(result.imageData);
      else if (result.dataUrl) drawPreviewDataUrl(result.dataUrl);
      const elapsed = Math.round(performance.now() - startedAt);
      setBadge("实时预览", "success");
      setMeta(`预览 ${result.width}×${result.height} · ${elapsed}ms · ${backend} · ${getFilmPresets().find((item) => item.id === state.params.preset)?.label || "自定义"}`);
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
      const params = readParams();
      setStatus("正在按预览参数处理原始尺寸图像...", "info");
      let result = null;
      let backend = "cpu";
      const gpuRenderer = modules.postFxWebglRenderer;
      const sourceWidth = Number(fullImage.naturalWidth || fullImage.width) || 0;
      const sourceHeight = Number(fullImage.naturalHeight || fullImage.height) || 0;
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
        const imageData = renderFilmImageData(source, params);
        result = { dataUrl: imageDataToDataUrl(imageData), width: imageData.width, height: imageData.height };
      }
      const dataUrl = result.dataUrl;
      const bounds = getFullBounds(fullCapture, result.width, result.height);
      const label = (getFilmPresets().find((item) => item.id === params.preset) || {}).label || "自定义";
      const response = await modules.runtime.callHost("photoshop.placeLicensedPostFxResult", [{
        dataUrl,
        targetDocumentId: fullCapture.documentId,
        sourceDocumentId: fullCapture.documentId,
        targetBounds: bounds,
        fitMode: "stretch",
        preserveCanvasBounds: true,
        anchorTransparentCanvas: true,
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
    state.params = normalizeFilmParams({ ...state.params, preset });
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
    const presetInput = getById("postFxPresetInput");
    if (presetInput) presetInput.addEventListener("change", () => applyPreset(presetInput.value));
    [
      "postFxAmountInput", "postFxExposureInput", "postFxContrastInput", "postFxSaturationInput",
      "postFxWarmthInput", "postFxShadowLiftInput", "postFxHighlightRollOffInput", "postFxHalationInput",
      "postFxHalationThresholdInput", "postFxHalationRadiusInput", "postFxGrainInput", "postFxGrainSizeInput",
      "postFxGrainColorInput", "postFxVignetteInput", "postFxDispersionInput", "postFxDispersionRadiusInput",
      "postFxDispersionHighlightsInput"
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
      state.params = normalizeFilmParams({ ...state.params, seed: Math.floor(Math.random() * 2147483647) });
      syncControls();
      schedulePreview();
    });
    syncControls();
  }

  modules.postFx = { bindActions, openModal, closeModal, getState: () => ({ ...state, params: { ...state.params } }) };
})(window);
