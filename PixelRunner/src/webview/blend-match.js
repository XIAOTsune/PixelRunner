(function initBlendMatchModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  const DEFAULT_SETTINGS = {
    autoEnabled: false,
    mode: "balanced",
    totalStrength: 70,
    luminanceStrength: 75,
    colorStrength: 65,
    saturationStrength: 50,
    contrastStrength: 45,
    featherRadius: 12,
    createBackupLayer: true,
    alignmentEnabled: false,
    alignmentMaxOffset: 8,
    alignmentScaleEnabled: false,
    alignmentMaxScale: 2,
    localAlignmentEnabled: false,
    previewMaxEdge: 512
  };

  const MODE_LABELS = {
    natural: "自然",
    balanced: "均衡",
    strong: "强融合",
    colorOnly: "仅校色",
    edgeOnly: "仅边缘"
  };

  const localState = {
    settings: { ...DEFAULT_SETTINGS },
    busy: false,
    previewBusy: false,
    preview: null,
    previewRenderTimer: 0
  };

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  }

  function normalizeSettings(settings) {
    const source = settings && typeof settings === "object" ? settings : {};
    const mode = Object.prototype.hasOwnProperty.call(MODE_LABELS, String(source.mode || ""))
      ? String(source.mode)
      : DEFAULT_SETTINGS.mode;
    const edgeOnly = mode === "edgeOnly";
    const colorOnly = mode === "colorOnly";
    return {
      autoEnabled: Boolean(source.autoEnabled),
      mode,
      totalStrength: clampNumber(source.totalStrength, 0, 100, DEFAULT_SETTINGS.totalStrength),
      luminanceStrength: edgeOnly || colorOnly ? 0 : clampNumber(source.luminanceStrength, 0, 100, DEFAULT_SETTINGS.luminanceStrength),
      colorStrength: edgeOnly ? 0 : clampNumber(source.colorStrength, 0, 100, DEFAULT_SETTINGS.colorStrength),
      saturationStrength: edgeOnly ? 0 : clampNumber(source.saturationStrength, -100, 100, DEFAULT_SETTINGS.saturationStrength),
      contrastStrength: edgeOnly || colorOnly ? 0 : clampNumber(source.contrastStrength, 0, 100, DEFAULT_SETTINGS.contrastStrength),
      featherRadius: clampNumber(source.featherRadius, 0, 64, DEFAULT_SETTINGS.featherRadius),
      createBackupLayer: source.createBackupLayer !== false,
      alignmentEnabled: Boolean(source.alignmentEnabled),
      alignmentMaxOffset: clampNumber(source.alignmentMaxOffset, 1, 24, DEFAULT_SETTINGS.alignmentMaxOffset),
      alignmentScaleEnabled: Boolean(source.alignmentScaleEnabled),
      alignmentMaxScale: Math.max(0, Math.min(4, Number(source.alignmentMaxScale ?? DEFAULT_SETTINGS.alignmentMaxScale) || DEFAULT_SETTINGS.alignmentMaxScale)),
      localAlignmentEnabled: Boolean(source.localAlignmentEnabled),
      previewMaxEdge: clampNumber(source.previewMaxEdge, 256, 768, DEFAULT_SETTINGS.previewMaxEdge)
    };
  }

  function getStorageKey() {
    return (modules.state && modules.state.STORAGE_KEYS && modules.state.STORAGE_KEYS.BLEND_MATCH_SETTINGS) || "pixelrunner.blendMatch.settings.v1";
  }

  async function loadSettings() {
    try {
      const raw = await modules.runtime.storageGetItem(getStorageKey());
      localState.settings = normalizeSettings(modules.runtime.readJsonText(raw, DEFAULT_SETTINGS));
    } catch (_) {
      localState.settings = { ...DEFAULT_SETTINGS };
    }
    renderSettings();
  }

  async function persistSettings() {
    try {
      await modules.runtime.storageSetItem(getStorageKey(), JSON.stringify(localState.settings));
    } catch (_) {}
  }

  function getById(id) {
    return modules.runtime && modules.runtime.getById ? modules.runtime.getById(id) : document.getElementById(id);
  }

  function setText(id, value) {
    const node = getById(id);
    if (node) node.textContent = String(value);
  }

  function setValue(id, value) {
    const input = getById(id);
    if (input) input.value = String(value);
  }

  function setChecked(id, checked) {
    const input = getById(id);
    if (input) input.checked = Boolean(checked);
  }

  function renderSettings() {
    const settings = localState.settings;
    const modeLabel = MODE_LABELS[settings.mode] || MODE_LABELS.balanced;
    setText("blendMatchModeBadge", modeLabel);
    setText("blendMatchStatus", localState.busy ? "正在执行融合校色" : "等待选择返图图层");
    setText("blendMatchQuickHint", `模式 ${modeLabel} / 强度 ${settings.totalStrength}% / 羽化 ${settings.featherRadius}px`);
    setText("blendMatchTotalValue", settings.totalStrength);
    setText("blendMatchLuminanceValue", settings.luminanceStrength);
    setText("blendMatchColorValue", settings.colorStrength);
    setText("blendMatchSaturationValue", settings.saturationStrength);
    setText("blendMatchContrastValue", settings.contrastStrength);
    setText("blendMatchFeatherValue", settings.featherRadius);
    setText("blendMatchAlignValue", settings.alignmentMaxOffset);
    setText("blendMatchScaleValue", settings.alignmentMaxScale);
    setValue("blendMatchModeInput", settings.mode);
    setValue("blendMatchTotalInput", settings.totalStrength);
    setValue("blendMatchLuminanceInput", settings.luminanceStrength);
    setValue("blendMatchColorInput", settings.colorStrength);
    setValue("blendMatchSaturationInput", settings.saturationStrength);
    setValue("blendMatchContrastInput", settings.contrastStrength);
    setValue("blendMatchFeatherInput", settings.featherRadius);
    setValue("blendMatchAlignInput", settings.alignmentMaxOffset);
    setValue("blendMatchScaleInput", settings.alignmentMaxScale);
    setChecked("blendMatchBackupToggle", settings.createBackupLayer);
    setChecked("blendMatchAlignmentToggle", settings.alignmentEnabled);
    setChecked("blendMatchScaleToggle", settings.alignmentScaleEnabled);
    setChecked("blendMatchLocalToggle", settings.localAlignmentEnabled);
    setChecked("blendMatchAutoToggle", settings.autoEnabled);
  }

  function readSettingsFromInputs() {
    localState.settings = normalizeSettings({
      ...localState.settings,
      mode: String((getById("blendMatchModeInput") && getById("blendMatchModeInput").value) || localState.settings.mode),
      totalStrength: getById("blendMatchTotalInput") && getById("blendMatchTotalInput").value,
      luminanceStrength: getById("blendMatchLuminanceInput") && getById("blendMatchLuminanceInput").value,
      colorStrength: getById("blendMatchColorInput") && getById("blendMatchColorInput").value,
      saturationStrength: getById("blendMatchSaturationInput") && getById("blendMatchSaturationInput").value,
      contrastStrength: getById("blendMatchContrastInput") && getById("blendMatchContrastInput").value,
      featherRadius: getById("blendMatchFeatherInput") && getById("blendMatchFeatherInput").value,
      alignmentMaxOffset: getById("blendMatchAlignInput") && getById("blendMatchAlignInput").value,
      alignmentMaxScale: getById("blendMatchScaleInput") && getById("blendMatchScaleInput").value,
      createBackupLayer: !getById("blendMatchBackupToggle") || getById("blendMatchBackupToggle").checked,
      alignmentEnabled: Boolean(getById("blendMatchAlignmentToggle") && getById("blendMatchAlignmentToggle").checked),
      alignmentScaleEnabled: Boolean(getById("blendMatchScaleToggle") && getById("blendMatchScaleToggle").checked),
      localAlignmentEnabled: Boolean(getById("blendMatchLocalToggle") && getById("blendMatchLocalToggle").checked),
      autoEnabled: Boolean(getById("blendMatchAutoToggle") && getById("blendMatchAutoToggle").checked)
    });
    renderSettings();
    void persistSettings();
    schedulePreviewRender();
  }

  function openPanel() {
    const modal = getById("blendMatchModal");
    if (modal) modal.classList.add("is-open");
    setText("blendMatchPanelStatus", "当前图层：使用 Photoshop 当前活动图层");
    renderSettings();
    void refreshPreview();
  }

  function closePanel() {
    const modal = getById("blendMatchModal");
    if (modal) modal.classList.remove("is-open");
  }

  function resetSettings() {
    localState.settings = { ...DEFAULT_SETTINGS };
    renderSettings();
    void persistSettings();
    if (modules.ui && modules.ui.logToWorkspace) {
      modules.ui.logToWorkspace("融合校色参数已重置为 MVP 默认值。", "info");
    }
  }

  function buildPayload() {
    readSettingsFromInputs();
    return {
      action: "blendMatch",
      ...localState.settings
    };
  }

  function setPreviewState(message) {
    setText("blendMatchPreviewState", message);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("预览图像加载失败"));
      image.src = src;
    });
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function applyPreviewCorrection(r, g, b, corrections) {
    const brightness = Number(corrections && corrections.brightness) || 0;
    const contrast = Number(corrections && corrections.contrast) || 0;
    const saturation = Number(corrections && corrections.saturation) || 0;
    const balance = corrections && corrections.colorBalance ? corrections.colorBalance : {};
    let nr = r + brightness + (Number(balance.cyanRed) || 0);
    let ng = g + brightness + (Number(balance.magentaGreen) || 0);
    let nb = b + brightness + (Number(balance.yellowBlue) || 0);
    const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    nr = contrastFactor * (nr - 128) + 128;
    ng = contrastFactor * (ng - 128) + 128;
    nb = contrastFactor * (nb - 128) + 128;
    const luma = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
    const satFactor = 1 + saturation / 100;
    return [
      clampByte(luma + (nr - luma) * satFactor),
      clampByte(luma + (ng - luma) * satFactor),
      clampByte(luma + (nb - luma) * satFactor)
    ];
  }

  function boxBlurMask(mask, width, height, radius) {
    const r = Math.max(1, Math.min(18, Math.round(radius)));
    if (r <= 1) return mask;
    const temp = new Float32Array(mask.length);
    const out = new Float32Array(mask.length);
    for (let y = 0; y < height; y += 1) {
      let acc = 0;
      for (let x = -r; x <= r; x += 1) acc += mask[y * width + Math.max(0, Math.min(width - 1, x))];
      for (let x = 0; x < width; x += 1) {
        temp[y * width + x] = acc / (r * 2 + 1);
        acc -= mask[y * width + Math.max(0, x - r)];
        acc += mask[y * width + Math.min(width - 1, x + r + 1)];
      }
    }
    for (let x = 0; x < width; x += 1) {
      let acc = 0;
      for (let y = -r; y <= r; y += 1) acc += temp[Math.max(0, Math.min(height - 1, y)) * width + x];
      for (let y = 0; y < height; y += 1) {
        out[y * width + x] = acc / (r * 2 + 1);
        acc -= temp[Math.max(0, y - r) * width + x];
        acc += temp[Math.min(height - 1, y + r + 1) * width + x];
      }
    }
    return out;
  }

  function drawPreviewCanvas() {
    const canvas = getById("blendMatchPreviewCanvas");
    const frame = canvas && canvas.closest(".blend-match-preview-frame");
    const preview = localState.preview;
    if (!canvas || !preview || !preview.sourceImage || !preview.referenceImage) return;
    const width = Math.max(1, preview.width);
    const height = Math.max(1, preview.height);
    const gap = 8;
    const labelHeight = 22;
    canvas.width = width * 3 + gap * 2;
    canvas.height = height + labelHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#080e12";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const makeData = (image) => {
      const off = document.createElement("canvas");
      off.width = width;
      off.height = height;
      const offCtx = off.getContext("2d");
      offCtx.drawImage(image, 0, 0, width, height);
      return offCtx.getImageData(0, 0, width, height);
    };
    const source = makeData(preview.sourceImage);
    const reference = makeData(preview.referenceImage);
    const result = ctx.createImageData(width, height);
    const mask = new Float32Array(width * height);
    for (let i = 0, p = 0; i < source.data.length; i += 4, p += 1) {
      const diff = (
        Math.abs(source.data[i] - reference.data[i]) +
        Math.abs(source.data[i + 1] - reference.data[i + 1]) +
        Math.abs(source.data[i + 2] - reference.data[i + 2])
      ) / 3;
      mask[p] = Math.max(0, Math.min(1, (diff - 8) / 42));
    }
    const featherScale = Math.max(1, Math.max(preview.boundsWidth || width, preview.boundsHeight || height) / Math.max(width, height));
    const blurred = boxBlurMask(mask, width, height, Math.max(1, localState.settings.featherRadius / featherScale));
    for (let i = 0, p = 0; i < source.data.length; i += 4, p += 1) {
      const corrected = applyPreviewCorrection(source.data[i], source.data[i + 1], source.data[i + 2], preview.corrections);
      const alpha = Math.max(0, Math.min(1, blurred[p]));
      result.data[i] = clampByte(reference.data[i] * (1 - alpha) + corrected[0] * alpha);
      result.data[i + 1] = clampByte(reference.data[i + 1] * (1 - alpha) + corrected[1] * alpha);
      result.data[i + 2] = clampByte(reference.data[i + 2] * (1 - alpha) + corrected[2] * alpha);
      result.data[i + 3] = 255;
    }
    ctx.drawImage(preview.sourceImage, 0, labelHeight, width, height);
    ctx.drawImage(preview.referenceImage, width + gap, labelHeight, width, height);
    ctx.putImageData(result, width * 2 + gap * 2, labelHeight);
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.font = "12px sans-serif";
    ctx.fillText("当前", 8, 15);
    ctx.fillText("参考", width + gap + 8, 15);
    ctx.fillText("边界融合预览", width * 2 + gap * 2 + 8, 15);
    frame && frame.classList.add("has-preview");
  }

  function schedulePreviewRender() {
    if (!localState.preview) return;
    if (localState.previewRenderTimer) window.cancelAnimationFrame(localState.previewRenderTimer);
    localState.previewRenderTimer = window.requestAnimationFrame(() => {
      localState.previewRenderTimer = 0;
      drawPreviewCanvas();
    });
  }

  async function refreshPreview() {
    if (localState.previewBusy || !modules.runtime.isPluginRuntime()) return;
    localState.previewBusy = true;
    setPreviewState("正在采样");
    try {
      const result = await modules.runtime.callHost("photoshop.runToolAction", [{
        ...buildPayload(),
        action: "blendMatchPreview"
      }], { timeoutMs: 45000 });
      const [sourceImage, referenceImage] = await Promise.all([
        loadImage(result.sourceDataUrl),
        loadImage(result.referenceDataUrl)
      ]);
      localState.preview = {
        ...result,
        sourceImage,
        referenceImage,
        boundsWidth: result.bounds ? Math.max(1, Number(result.bounds.right) - Number(result.bounds.left)) : result.width,
        boundsHeight: result.bounds ? Math.max(1, Number(result.bounds.bottom) - Number(result.bounds.top)) : result.height
      };
      setPreviewState("实时预览");
      const alignment = result.alignment;
      setText("blendMatchPreviewMeta", alignment && alignment.applied
        ? `梯度对齐建议 dx ${alignment.dx}px / dy ${alignment.dy}px / scale ${Number(alignment.scalePercent || 100).toFixed(2)}% / 置信 ${Number(alignment.confidence || 0).toFixed(2)}${alignment.localDeformation ? " / 局部变形" : ""}`
        : "当前图层 / 隐藏返图参考 / 模拟融合边界");
      drawPreviewCanvas();
    } catch (error) {
      setPreviewState("预览失败");
      setText("blendMatchPreviewMeta", error.message || "预览刷新失败");
    } finally {
      localState.previewBusy = false;
    }
  }

  async function runBlendMatch() {
    if (localState.busy) return;
    if (!modules.runtime.isPluginRuntime()) {
      modules.ui.logToWorkspace("浏览器预览模式下不会执行融合校色。", "info");
      return;
    }

    localState.busy = true;
    renderSettings();
    const applyButton = getById("btnBlendMatchApply");
    if (applyButton) applyButton.disabled = true;
    modules.ui.logToWorkspace("[融合校色] 准备使用当前活动图层作为 AI 返图图层。", "info");

    try {
      const result = await modules.runtime.callHost("photoshop.runToolAction", [buildPayload()], { timeoutMs: 90000 });
      const logs = Array.isArray(result && result.logs) ? result.logs : [];
      logs.forEach((line) => modules.ui.logToWorkspace(line, "info"));
      modules.ui.logToWorkspace(result && result.message ? result.message : "融合校色完成。", "success");
      setText("blendMatchPanelStatus", result && result.layerName ? `结果图层：${result.layerName}` : "融合校色已完成");
      closePanel();
    } catch (error) {
      modules.ui.logToWorkspace(`[融合校色] 执行失败：${error.message}`, "error");
      setText("blendMatchPanelStatus", `执行失败：${error.message}`);
    } finally {
      localState.busy = false;
      if (applyButton) applyButton.disabled = false;
      renderSettings();
    }
  }

  async function applyAutoPlacementFusion(placementResponse, resultContext = {}) {
    if (!localState.settings.autoEnabled || !placementResponse || !placementResponse.layerId || !modules.runtime.isPluginRuntime()) {
      return null;
    }
    const taskId = String((resultContext && resultContext.taskId) || "").trim();
    modules.ui.logToWorkspace(`[融合校色] 自动贴回后开始融合${taskId ? `：${taskId}` : ""}。`, "info");
    const payload = {
      action: "blendMatch",
      ...localState.settings,
      layerId: Number(placementResponse.layerId) || 0
    };
    try {
      const fusion = await modules.runtime.callHost("photoshop.runToolAction", [payload], { timeoutMs: 90000 });
      const logs = Array.isArray(fusion && fusion.logs) ? fusion.logs : [];
      logs.forEach((line) => modules.ui.logToWorkspace(line, "info"));
      modules.ui.logToWorkspace(fusion && fusion.message ? fusion.message : "[融合校色] 自动融合完成。", "success");
      return fusion;
    } catch (error) {
      modules.ui.logToWorkspace(`[融合校色] 自动融合失败，已保留原返图：${error.message}`, "warn");
      return { ok: false, error: error.message || String(error || "自动融合失败") };
    }
  }

  function bindBlendMatchActions() {
    void loadSettings();

    const openButton = getById("btnOpenBlendMatchPanel");
    if (openButton) openButton.addEventListener("click", openPanel);

    ["blendMatchModalClose", "btnBlendMatchCancel"].forEach((id) => {
      const button = getById(id);
      if (button) button.addEventListener("click", closePanel);
    });

    const resetButton = getById("btnBlendMatchReset");
    if (resetButton) resetButton.addEventListener("click", resetSettings);

    const applyButton = getById("btnBlendMatchApply");
    if (applyButton) applyButton.addEventListener("click", () => void runBlendMatch());
    const previewButton = getById("btnBlendMatchRefreshPreview");
    if (previewButton) previewButton.addEventListener("click", () => void refreshPreview());

    const backdrop = getById("blendMatchBackdrop");
    if (backdrop) backdrop.addEventListener("click", closePanel);

    [
      "blendMatchModeInput",
      "blendMatchTotalInput",
      "blendMatchLuminanceInput",
      "blendMatchColorInput",
      "blendMatchSaturationInput",
      "blendMatchContrastInput",
      "blendMatchFeatherInput",
      "blendMatchAlignInput",
      "blendMatchScaleInput",
      "blendMatchBackupToggle",
      "blendMatchAlignmentToggle",
      "blendMatchScaleToggle",
      "blendMatchLocalToggle",
      "blendMatchAutoToggle"
    ].forEach((id) => {
      const input = getById(id);
      if (!input) return;
      input.addEventListener("input", readSettingsFromInputs);
      input.addEventListener("change", readSettingsFromInputs);
    });
  }

  modules.blendMatch = {
    DEFAULT_SETTINGS,
    bindBlendMatchActions,
    applyAutoPlacementFusion,
    getSettings: () => ({ ...localState.settings })
  };
})(window);
