(function initBlendMatchModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  const DEFAULT_SETTINGS = {
    autoEnabled: false,
    mode: "balanced",
    totalStrength: 78,
    toneStrength: 78,
    colorMatchStrength: 76,
    luminanceStrength: 82,
    colorStrength: 76,
    saturationStrength: 62,
    contrastStrength: 58,
    featherRadius: 16,
    createBackupLayer: true,
    pixelPipelineEnabled: true,
    alignmentEnabled: true,
    alignmentMaxOffset: 12,
    alignmentScaleEnabled: true,
    alignmentFlex: 63,
    alignmentMaxScale: 2.5,
    alignmentMaxRotation: 1.75,
    alignmentMaxStretch: 2.5,
    localAlignmentEnabled: true,
    previewMaxEdge: 512
  };
  const LEGACY_DEFAULT_SETTINGS = {
    mode: "balanced",
    totalStrength: 70,
    luminanceStrength: 75,
    colorStrength: 65,
    saturationStrength: 50,
    contrastStrength: 45,
    featherRadius: 12,
    alignmentMaxOffset: 8,
    alignmentMaxScale: 2,
    alignmentMaxRotation: 1.5,
    alignmentMaxStretch: 2
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
    previewRenderTimer: 0,
    previewView: {
      scale: 1,
      x: 0,
      y: 0,
      split: 0.5,
      isPanning: false
    }
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
    const toneStrength = edgeOnly || colorOnly
      ? 0
      : clampNumber(
          source.toneStrength ?? source.luminanceStrength,
          0,
          100,
          DEFAULT_SETTINGS.toneStrength
        );
    const colorMatchStrength = edgeOnly
      ? 0
      : clampNumber(
          source.colorMatchStrength ?? source.colorStrength,
          0,
          100,
          DEFAULT_SETTINGS.colorMatchStrength
        );
    const alignmentFlex = clampNumber(
      source.alignmentFlex ?? ((Number(source.alignmentMaxScale) || DEFAULT_SETTINGS.alignmentMaxScale) / 4) * 100,
      0,
      100,
      DEFAULT_SETTINGS.alignmentFlex
    );
    const detailed = deriveDetailedSettings({
      toneStrength,
      colorMatchStrength,
      alignmentFlex,
      alignmentEnabled: source.alignmentEnabled !== false
    });
    return {
      autoEnabled: Boolean(source.autoEnabled),
      mode,
      totalStrength: clampNumber(source.totalStrength, 0, 100, DEFAULT_SETTINGS.totalStrength),
      toneStrength,
      colorMatchStrength,
      luminanceStrength: detailed.luminanceStrength,
      colorStrength: detailed.colorStrength,
      saturationStrength: detailed.saturationStrength,
      contrastStrength: detailed.contrastStrength,
      featherRadius: clampNumber(source.featherRadius, 0, 64, DEFAULT_SETTINGS.featherRadius),
      createBackupLayer: source.createBackupLayer !== false,
      pixelPipelineEnabled: true,
      alignmentEnabled: source.alignmentEnabled !== false,
      alignmentMaxOffset: clampNumber(source.alignmentMaxOffset, 1, 24, DEFAULT_SETTINGS.alignmentMaxOffset),
      alignmentScaleEnabled: detailed.alignmentScaleEnabled,
      alignmentFlex,
      alignmentMaxScale: detailed.alignmentMaxScale,
      alignmentMaxRotation: detailed.alignmentMaxRotation,
      alignmentMaxStretch: detailed.alignmentMaxStretch,
      localAlignmentEnabled: detailed.localAlignmentEnabled,
      previewMaxEdge: clampNumber(source.previewMaxEdge, 256, 768, DEFAULT_SETTINGS.previewMaxEdge)
    };
  }

  function deriveDetailedSettings(settings) {
    const tone = clampNumber(settings && settings.toneStrength, 0, 100, DEFAULT_SETTINGS.toneStrength);
    const color = clampNumber(settings && settings.colorMatchStrength, 0, 100, DEFAULT_SETTINGS.colorMatchStrength);
    const flex = clampNumber(settings && settings.alignmentFlex, 0, 100, DEFAULT_SETTINGS.alignmentFlex);
    const alignmentEnabled = !settings || settings.alignmentEnabled !== false;
    return {
      luminanceStrength: tone <= 0 ? 0 : clampNumber(tone + 4, 0, 100, DEFAULT_SETTINGS.luminanceStrength),
      contrastStrength: tone <= 0 ? 0 : clampNumber(tone * 0.74, 0, 100, DEFAULT_SETTINGS.contrastStrength),
      colorStrength: color <= 0 ? 0 : color,
      saturationStrength: color <= 0 ? 0 : clampNumber(color * 0.82, -100, 100, DEFAULT_SETTINGS.saturationStrength),
      alignmentScaleEnabled: alignmentEnabled && flex > 0,
      localAlignmentEnabled: alignmentEnabled,
      alignmentMaxScale: Math.max(0, Math.min(4, Number((flex * 0.04).toFixed(2)))),
      alignmentMaxRotation: Math.max(0, Math.min(3, Number((flex * 0.0278).toFixed(2)))),
      alignmentMaxStretch: Math.max(0, Math.min(4, Number((flex * 0.04).toFixed(2))))
    };
  }

  function getStorageKey() {
    return (modules.state && modules.state.STORAGE_KEYS && modules.state.STORAGE_KEYS.BLEND_MATCH_SETTINGS) || "pixelrunner.blendMatch.settings.v1";
  }

  async function loadSettings() {
    try {
      const raw = await modules.runtime.storageGetItem(getStorageKey());
      const parsed = modules.runtime.readJsonText(raw, DEFAULT_SETTINGS);
      const shouldUpgradeDefaults = parsed && typeof parsed === "object" && Object.keys(LEGACY_DEFAULT_SETTINGS).every((key) => {
        return String(parsed[key]) === String(LEGACY_DEFAULT_SETTINGS[key]);
      });
      localState.settings = shouldUpgradeDefaults
        ? normalizeSettings({ ...DEFAULT_SETTINGS, autoEnabled: Boolean(parsed.autoEnabled) })
        : normalizeSettings(parsed);
      if (shouldUpgradeDefaults) void persistSettings();
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
    setText("blendMatchToneValue", settings.toneStrength);
    setText("blendMatchColorMatchValue", settings.colorMatchStrength);
    setText("blendMatchFeatherValue", settings.featherRadius);
    setText("blendMatchAlignValue", settings.alignmentMaxOffset);
    setText("blendMatchAlignmentFlexValue", settings.alignmentFlex);
    setValue("blendMatchModeInput", settings.mode);
    setValue("blendMatchTotalInput", settings.totalStrength);
    setValue("blendMatchToneInput", settings.toneStrength);
    setValue("blendMatchColorMatchInput", settings.colorMatchStrength);
    setValue("blendMatchFeatherInput", settings.featherRadius);
    setValue("blendMatchAlignInput", settings.alignmentMaxOffset);
    setValue("blendMatchAlignmentFlexInput", settings.alignmentFlex);
    setChecked("blendMatchBackupToggle", settings.createBackupLayer);
    setChecked("blendMatchAlignmentToggle", settings.alignmentEnabled);
    setChecked("blendMatchAutoToggle", settings.autoEnabled);
  }

  function readSettingsFromInputs() {
    localState.settings = normalizeSettings({
      ...localState.settings,
      mode: String((getById("blendMatchModeInput") && getById("blendMatchModeInput").value) || localState.settings.mode),
      totalStrength: getById("blendMatchTotalInput") && getById("blendMatchTotalInput").value,
      toneStrength: getById("blendMatchToneInput") && getById("blendMatchToneInput").value,
      colorMatchStrength: getById("blendMatchColorMatchInput") && getById("blendMatchColorMatchInput").value,
      featherRadius: getById("blendMatchFeatherInput") && getById("blendMatchFeatherInput").value,
      alignmentMaxOffset: getById("blendMatchAlignInput") && getById("blendMatchAlignInput").value,
      alignmentFlex: getById("blendMatchAlignmentFlexInput") && getById("blendMatchAlignmentFlexInput").value,
      createBackupLayer: !getById("blendMatchBackupToggle") || getById("blendMatchBackupToggle").checked,
      pixelPipelineEnabled: true,
      alignmentEnabled: Boolean(getById("blendMatchAlignmentToggle") && getById("blendMatchAlignmentToggle").checked),
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
      modules.ui.logToWorkspace("融合校色参数已重置为中等偏上默认值。", "info");
    }
  }

  function buildPayload() {
    readSettingsFromInputs();
    const detailed = deriveDetailedSettings(localState.settings);
    return {
      action: "blendMatch",
      ...localState.settings,
      ...detailed
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

  function erodeMask(mask, width, height, radius) {
    const r = Math.max(1, Math.min(18, Math.round(radius)));
    const out = new Float32Array(mask.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let minValue = 1;
        for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy += 1) {
          for (let xx = Math.max(0, x - r); xx <= Math.min(width - 1, x + r); xx += 1) {
            minValue = Math.min(minValue, mask[yy * width + xx]);
          }
        }
        out[y * width + x] = minValue;
      }
    }
    return out;
  }

  function findMaskEdge(mask, width, height, index, threshold) {
    if (mask[index] <= threshold) return false;
    const x = index % width;
    const y = Math.floor(index / width);
    const left = x > 0 ? mask[index - 1] : 0;
    const right = x < width - 1 ? mask[index + 1] : 0;
    const top = y > 0 ? mask[index - width] : 0;
    const bottom = y < height - 1 ? mask[index + width] : 0;
    return left <= threshold || right <= threshold || top <= threshold || bottom <= threshold;
  }

  function clampPreviewView() {
    const canvas = getById("blendMatchPreviewCanvas");
    const frame = getById("blendMatchPreviewFrame") || (canvas && canvas.closest(".blend-match-preview-frame"));
    if (!canvas || !frame) return;
    const view = localState.previewView;
    const scale = Math.max(0.35, Math.min(8, Number(view.scale) || 1));
    view.scale = scale;
    const rect = frame.getBoundingClientRect ? frame.getBoundingClientRect() : { width: 0, height: 0 };
    const viewportWidth = Number(rect.width) || 0;
    const viewportHeight = Number(rect.height) || 0;
    const contentWidth = Number(canvas.width) || viewportWidth || 1;
    const contentHeight = Number(canvas.height) || viewportHeight || 1;
    const fitScale = Math.min(viewportWidth / contentWidth || 1, viewportHeight / contentHeight || 1);
    const renderedWidth = contentWidth * fitScale * scale;
    const renderedHeight = contentHeight * fitScale * scale;
    const maxX = Math.max(0, (renderedWidth - viewportWidth) / 2);
    const maxY = Math.max(0, (renderedHeight - viewportHeight) / 2);
    view.x = Math.max(-maxX, Math.min(maxX, Number(view.x) || 0));
    view.y = Math.max(-maxY, Math.min(maxY, Number(view.y) || 0));
  }

  function applyPreviewTransform() {
    const canvas = getById("blendMatchPreviewCanvas");
    if (!canvas) return;
    clampPreviewView();
    const view = localState.previewView;
    canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  }

  function resetPreviewTransform() {
    localState.previewView.scale = 1;
    localState.previewView.x = 0;
    localState.previewView.y = 0;
    applyPreviewTransform();
  }

  function zoomPreview(nextScale, anchorX, anchorY) {
    const frame = getById("blendMatchPreviewFrame");
    if (!frame) return;
    const view = localState.previewView;
    const previousScale = Math.max(0.35, Number(view.scale) || 1);
    const scale = Math.max(0.35, Math.min(8, Number(nextScale) || 1));
    const rect = frame.getBoundingClientRect();
    const localX = Number(anchorX) - rect.left - rect.width / 2;
    const localY = Number(anchorY) - rect.top - rect.height / 2;
    if (Math.abs(scale - previousScale) >= 0.001) {
      view.x = (view.x - localX) * (scale / previousScale) + localX;
      view.y = (view.y - localY) * (scale / previousScale) + localY;
    }
    view.scale = scale;
    if (scale <= 1.001) {
      view.x = 0;
      view.y = 0;
    }
    applyPreviewTransform();
  }

  function drawPreviewCanvas() {
    const canvas = getById("blendMatchPreviewCanvas");
    const frame = canvas && canvas.closest(".blend-match-preview-frame");
    const preview = localState.preview;
    if (!canvas || !preview || !preview.sourceImage || !preview.referenceImage) return;
    const width = Math.max(1, preview.width);
    const height = Math.max(1, preview.height);
    const splitInput = getById("blendMatchPreviewSplitInput");
    const split = Math.max(0.02, Math.min(0.98, Number(splitInput && splitInput.value) / 100 || localState.previewView.split || 0.5));
    localState.previewView.split = split;
    canvas.width = width;
    canvas.height = height;
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
    const display = ctx.createImageData(width, height);
    const after = ctx.createImageData(width, height);
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
    const featherRadius = Math.max(1, localState.settings.featherRadius / featherScale);
    const inwardMask = erodeMask(mask, width, height, featherRadius);
    const inwardHasContent = inwardMask.some ? inwardMask.some((value) => value > 0.04) : Array.from(inwardMask).some((value) => value > 0.04);
    const baseMask = inwardHasContent ? inwardMask : mask;
    const blurred = boxBlurMask(baseMask, width, height, featherRadius);
    const splitX = Math.round(width * split);
    for (let i = 0, p = 0; i < source.data.length; i += 4, p += 1) {
      const corrected = applyPreviewCorrection(source.data[i], source.data[i + 1], source.data[i + 2], preview.corrections);
      const alpha = Math.max(0, Math.min(1, blurred[p]));
      after.data[i] = clampByte(reference.data[i] * (1 - alpha) + corrected[0] * alpha);
      after.data[i + 1] = clampByte(reference.data[i + 1] * (1 - alpha) + corrected[1] * alpha);
      after.data[i + 2] = clampByte(reference.data[i + 2] * (1 - alpha) + corrected[2] * alpha);
      after.data[i + 3] = 255;
      const x = p % width;
      const useAfter = x >= splitX;
      display.data[i] = useAfter ? after.data[i] : source.data[i];
      display.data[i + 1] = useAfter ? after.data[i + 1] : source.data[i + 1];
      display.data[i + 2] = useAfter ? after.data[i + 2] : source.data[i + 2];
      display.data[i + 3] = 255;
      const band = alpha > 0.08 && alpha < 0.92 ? Math.min(0.34, 0.08 + Math.sin(alpha * Math.PI) * 0.22) : 0;
      if (band > 0) {
        display.data[i] = clampByte(display.data[i] * (1 - band) + 80 * band);
        display.data[i + 1] = clampByte(display.data[i + 1] * (1 - band) + 226 * band);
        display.data[i + 2] = clampByte(display.data[i + 2] * (1 - band) + 140 * band);
      }
      if (findMaskEdge(mask, width, height, p, 0.18)) {
        display.data[i] = 80;
        display.data[i + 1] = 232;
        display.data[i + 2] = 232;
      }
    }
    ctx.putImageData(display, 0, 0);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = Math.max(1, Math.round(width / 420));
    ctx.beginPath();
    ctx.moveTo(splitX + 0.5, 0);
    ctx.lineTo(splitX + 0.5, height);
    ctx.stroke();
    ctx.fillStyle = "rgba(5, 12, 16, 0.68)";
    ctx.fillRect(8, 8, 74, 22);
    ctx.fillRect(Math.max(8, width - 82), 8, 74, 22);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `${Math.max(11, Math.round(width / 62))}px sans-serif`;
    ctx.fillText("融合前", 16, 24);
    ctx.fillText("融合后", Math.max(16, width - 74), 24);
    ctx.restore();
    frame && frame.classList.add("has-preview");
    if (splitInput) splitInput.classList.add("is-active");
    applyPreviewTransform();
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
      const localMeta = alignment && alignment.local && alignment.local.enabled
        ? ` / 网格 ${alignment.local.validTiles || 0}/${alignment.local.totalTiles || 0}${alignment.localDeformation ? " 已启用" : " 已跳过"}`
        : "";
      setText("blendMatchPreviewMeta", alignment && alignment.applied
        ? `左融合前 / 右融合后 / dx ${alignment.dx}px / dy ${alignment.dy}px / X ${Number(alignment.scaleXPercent || alignment.scalePercent || 100).toFixed(2)}% / Y ${Number(alignment.scaleYPercent || alignment.scalePercent || 100).toFixed(2)}% / 旋转 ${Number(alignment.rotation || 0).toFixed(2)}° / 置信 ${Number(alignment.confidence || 0).toFixed(2)}${localMeta}`
        : `左侧融合前 / 右侧融合后 / 青色边界 / 绿色羽化范围${localMeta}`);
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
      if (result && result.skipped) {
        modules.ui.logToWorkspace(result.message || "融合校色已跳过，未生成结果层。", "warn");
        setText("blendMatchPanelStatus", result.message || "融合校色已跳过");
      } else {
        modules.ui.logToWorkspace(result && result.message ? result.message : "融合校色完成。", "success");
        setText("blendMatchPanelStatus", result && result.layerName ? `结果图层：${result.layerName}` : "融合校色已完成");
        closePanel();
      }
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
      modules.ui.logToWorkspace(
        fusion && fusion.message ? fusion.message : "[融合校色] 自动融合完成。",
        fusion && fusion.skipped ? "warn" : "success"
      );
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
      "blendMatchToneInput",
      "blendMatchColorMatchInput",
      "blendMatchFeatherInput",
      "blendMatchAlignInput",
      "blendMatchAlignmentFlexInput",
      "blendMatchBackupToggle",
      "blendMatchAlignmentToggle",
      "blendMatchAutoToggle"
    ].forEach((id) => {
      const input = getById(id);
      if (!input) return;
      input.addEventListener("input", readSettingsFromInputs);
      input.addEventListener("change", readSettingsFromInputs);
    });

    const splitInput = getById("blendMatchPreviewSplitInput");
    if (splitInput) {
      splitInput.addEventListener("input", () => {
        localState.previewView.split = Math.max(0.02, Math.min(0.98, Number(splitInput.value) / 100 || 0.5));
        schedulePreviewRender();
      });
      splitInput.addEventListener("pointerdown", (event) => event.stopPropagation());
    }

    const previewFrame = getById("blendMatchPreviewFrame");
    if (previewFrame) {
      previewFrame.addEventListener("wheel", (event) => {
        event.preventDefault();
        const direction = event.deltaY > 0 ? -1 : 1;
        const factor = direction > 0 ? 1.18 : 1 / 1.18;
        zoomPreview(localState.previewView.scale * factor, event.clientX, event.clientY);
      }, { passive: false });

      previewFrame.addEventListener("pointerdown", (event) => {
        if (event.button != null && event.button !== 0) return;
        if ((Number(localState.previewView.scale) || 1) <= 1.001) return;
        event.preventDefault();
        localState.previewView.isPanning = true;
        localState.previewView.startX = event.clientX;
        localState.previewView.startY = event.clientY;
        localState.previewView.startPanX = localState.previewView.x;
        localState.previewView.startPanY = localState.previewView.y;
        previewFrame.classList.add("is-panning");
      });

      const movePan = (event) => {
        if (!localState.previewView.isPanning) return;
        event.preventDefault();
        localState.previewView.x = localState.previewView.startPanX + event.clientX - localState.previewView.startX;
        localState.previewView.y = localState.previewView.startPanY + event.clientY - localState.previewView.startY;
        applyPreviewTransform();
      };

      const endPan = (event) => {
        if (!localState.previewView.isPanning) return;
        event.preventDefault();
        localState.previewView.isPanning = false;
        previewFrame.classList.remove("is-panning");
      };
      window.addEventListener("pointermove", movePan, { passive: false });
      window.addEventListener("pointerup", endPan, { passive: false });
      window.addEventListener("pointercancel", endPan, { passive: false });
      window.addEventListener("blur", () => {
        localState.previewView.isPanning = false;
        previewFrame.classList.remove("is-panning");
      });
      previewFrame.addEventListener("dblclick", resetPreviewTransform);
    }

    document.querySelectorAll("[data-blend-match-zoom]").forEach((button) => {
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = String(button.getAttribute("data-blend-match-zoom") || "");
        if (action === "reset") {
          resetPreviewTransform();
          return;
        }
        const frame = getById("blendMatchPreviewFrame");
        if (!frame) return;
        const rect = frame.getBoundingClientRect();
        const factor = action === "in" ? 1.25 : 1 / 1.25;
        zoomPreview(localState.previewView.scale * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
      });
    });
  }

  modules.blendMatch = {
    DEFAULT_SETTINGS,
    bindBlendMatchActions,
    applyAutoPlacementFusion,
    getSettings: () => ({ ...localState.settings })
  };
})(window);
