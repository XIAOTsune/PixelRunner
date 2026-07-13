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
    alignmentMaxOffset: 120,
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
  const GPU_ALIGNMENT_SEED_GRACE_MS = 120;
  const GPU_ALIGNMENT_SEED_TTL_MS = 30000;

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
    previewRenderer: null,
    alignmentEngine: null,
    alignmentGpuUnavailableReason: "",
    alignmentValidationDone: false,
    previewPlanBusy: false,
    previewGpuDiagnosticBusy: false,
    latestGpuAlignmentSeed: null,
    gpuAlignmentSeedWaiters: [],
    previewRenderMode: "cpu",
    previewAssets: null,
    previewCache: null,
    previewAssetSeq: 0,
    previewRenderTimer: 0,
    previewRenderQueued: false,
    previewView: {
      scale: 1,
      x: 0,
      y: 0,
      split: 0.5,
      isPanning: false,
      startX: 0,
      startY: 0,
      startPanX: 0,
      startPanY: 0
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
      alignmentMaxOffset: clampNumber(source.alignmentMaxOffset, 1, 320, DEFAULT_SETTINGS.alignmentMaxOffset),
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
    updatePreviewControls();
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
    if (modules.workspace && typeof modules.workspace.setModalOpen === "function") {
      modules.workspace.setModalOpen("blendMatchModal", true);
    } else {
      const modal = getById("blendMatchModal");
      if (modal) modal.classList.add("is-open");
    }
    setText("blendMatchPanelStatus", "当前图层：使用 Photoshop 当前活动图层");
    renderSettings();
    setPreviewLoadingState("正在采样图层", "正在采样当前图层并生成融合预览");
    if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
      modules.ui.logToWorkspace("[融合校色] 已开始准备预览采样：打开面板后立即刷新当前图层。", "info");
    }
    void refreshPreview();
  }

  function closePanel() {
    if (modules.workspace && typeof modules.workspace.setModalOpen === "function") {
      modules.workspace.setModalOpen("blendMatchModal", false);
    } else {
      const modal = getById("blendMatchModal");
      if (modal) modal.classList.remove("is-open");
    }
    disposeAlignmentEngine();
  }

  function resetSettings() {
    localState.settings = { ...DEFAULT_SETTINGS };
    localState.previewCache = null;
    renderSettings();
    void persistSettings();
    if (modules.ui && modules.ui.logToWorkspace) {
      modules.ui.logToWorkspace("融合校色参数已重置为中等偏上默认值。", "info");
    }
  }

  function buildPayload(options = {}) {
    readSettingsFromInputs();
    const detailed = deriveDetailedSettings(localState.settings);
    const payload = {
      action: "blendMatch",
      ...localState.settings,
      ...detailed
    };
    if (options && options.includePreviewCache && localState.preview && localState.preview.previewCacheKey) {
      payload.previewCacheKey = localState.preview.previewCacheKey;
    }
    if (options && options.includePreviewCache && localState.preview && localState.preview.planId) {
      payload.planId = localState.preview.planId;
    }
    return payload;
  }

  function setPreviewOverlay(mode, title, detail, options = {}) {
    const overlay = getById("blendMatchPreviewOverlay");
    const titleNode = getById("blendMatchPreviewOverlayTitle");
    const detailNode = getById("blendMatchPreviewOverlayDetail");
    const normalizedMode = ["blocking", "compact", "gpu", "error"].includes(String(mode || ""))
      ? String(mode)
      : "idle";
    if (overlay) {
      overlay.setAttribute("data-mode", normalizedMode);
      overlay.setAttribute("aria-hidden", normalizedMode === "idle" ? "true" : "false");
      if (options && options.status) {
        overlay.setAttribute("data-status", String(options.status));
      } else {
        overlay.removeAttribute("data-status");
      }
    }
    if (titleNode) titleNode.textContent = String(title || "");
    if (detailNode) detailNode.textContent = String(detail || "");
  }

  function clearPreviewOverlay() {
    setPreviewOverlay("idle", "", "");
  }

  function updatePreviewBackgroundOverlay() {
    if (localState.preview && localState.preview.planHydrationError) {
      setPreviewOverlay(
        "compact",
        "将于融合时完成分析",
        "预览可继续查看，Apply 会复用采样并补建 CPU plan",
        { status: "warn" }
      );
      return;
    }
    const waitingForPlan = Boolean(localState.previewPlanBusy || (localState.preview && localState.preview.planPending));
    if (waitingForPlan && localState.preview) {
      const seed = getLatestGpuAlignmentSeed(localState.preview.previewCacheKey);
      setPreviewOverlay(
        "compact",
        seed ? "GPU 已提供候选" : "正在分析对齐",
        seed ? "CPU 正在验证 hint-only alignment seed" : "后台准备可信 CPU BlendMatchPlan",
        { status: "pending" }
      );
      return;
    }
    if (localState.previewGpuDiagnosticBusy && localState.preview) {
      setPreviewOverlay(
        "gpu",
        "GPU 诊断中",
        "仅做 shadow validation，不影响最终 Apply",
        { status: "info" }
      );
      return;
    }
    if (localState.preview) clearPreviewOverlay();
  }

  function setPreviewFrameMode(mode, message) {
    const frame = getById("blendMatchPreviewFrame");
    const empty = getById("blendMatchPreviewEmpty");
    const normalizedMode = mode === "loading" || mode === "error" || mode === "empty" ? mode : "ready";
    if (frame) {
      frame.classList.toggle("is-loading", normalizedMode === "loading");
      frame.classList.toggle("is-error", normalizedMode === "error");
      frame.classList.toggle("is-empty", normalizedMode === "empty");
      frame.setAttribute("aria-busy", normalizedMode === "loading" ? "true" : "false");
    }
    if (empty && message != null) {
      empty.textContent = String(message);
    }
  }

  function setPreviewState(message, options = {}) {
    const state = getById("blendMatchPreviewState");
    if (state) {
      state.textContent = String(message || "");
      const mode = options && options.mode;
      state.classList.toggle("is-loading", mode === "loading");
      state.classList.toggle("is-error", mode === "error");
      state.classList.toggle("is-ready", mode === "ready");
    }
    if (options && Object.prototype.hasOwnProperty.call(options, "mode")) {
      setPreviewFrameMode(options.mode, options.placeholder);
    }
  }

  function setPreviewLoadingState(message, detail) {
    setPreviewState(message, {
      mode: "loading",
      placeholder: detail || message
    });
    setPreviewOverlay("blocking", message, detail || message, { status: "loading" });
    if (detail) setText("blendMatchPreviewMeta", detail);
    updatePreviewControls();
  }

  function setPreviewErrorState(message, detail) {
    const safeMessage = message || "预览失败";
    setPreviewState(safeMessage, {
      mode: "error",
      placeholder: detail || safeMessage
    });
    setPreviewOverlay("error", safeMessage, detail || safeMessage, { status: "error" });
    setText("blendMatchPreviewMeta", detail || safeMessage);
    updatePreviewControls();
  }

  function setPreviewReadyState(message = "实时预览") {
    setPreviewState(message, { mode: "ready" });
    updatePreviewBackgroundOverlay();
    updatePreviewControls();
  }

  function updatePreviewControls() {
    const refreshButton = getById("btnBlendMatchRefreshPreview");
    if (refreshButton) {
      refreshButton.disabled = Boolean(localState.previewBusy || localState.busy);
      refreshButton.textContent = localState.previewBusy ? "准备中" : "刷新预览";
      refreshButton.setAttribute("aria-busy", localState.previewBusy ? "true" : "false");
    }

    const applyButton = getById("btnBlendMatchApply");
    if (applyButton) {
      const waitingForPreview = Boolean(localState.previewBusy);
      const waitingForPlan = Boolean(localState.previewPlanBusy || (localState.preview && localState.preview.planPending));
      applyButton.disabled = Boolean(localState.busy || waitingForPreview || waitingForPlan);
      applyButton.textContent = localState.busy
        ? "融合中"
        : waitingForPreview
          ? "预览准备中"
          : waitingForPlan
            ? "分析中"
            : localState.preview && localState.preview.planHydrationError
              ? "分析并融合"
          : "分析并融合";
      applyButton.setAttribute("aria-busy", localState.busy || waitingForPlan ? "true" : "false");
    }
  }

  function waitForPreviewPaint() {
    return new Promise((resolve) => {
      const finish = () => {
        if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
          window.setTimeout(resolve, 0);
        } else {
          resolve();
        }
      };
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(finish);
      } else {
        finish();
      }
    });
  }

  function getPreviewNowMs() {
    return typeof performance !== "undefined" && performance && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  function formatPreviewMs(value) {
    const parsed = Number(value);
    return `${Math.max(0, Math.round(Number.isFinite(parsed) ? parsed : 0))}ms`;
  }

  function is16BitErrorMessage(message) {
    const text = String(message || "");
    return text.includes("仅支持 8 位文档") || text.includes("16 位");
  }

  function ensurePreviewRenderer() {
    if (localState.previewRenderer) return localState.previewRenderer;
    if (!modules.blendMatchWebglPreview || typeof modules.blendMatchWebglPreview.createRenderer !== "function") return null;
    try {
      localState.previewRenderer = modules.blendMatchWebglPreview.createRenderer();
      localState.previewRenderMode = "webgl2";
      return localState.previewRenderer;
    } catch (error) {
      localState.previewRenderer = null;
      localState.previewRenderMode = "cpu";
      console.warn("[PixelRunner] BlendMatch WebGL preview unavailable, using CPU fallback:", error);
      return null;
    }
  }

  function disposePreviewRenderer() {
    if (localState.previewRenderer && typeof localState.previewRenderer.dispose === "function") {
      try {
        localState.previewRenderer.dispose();
      } catch (_) {}
    }
    localState.previewRenderer = null;
    localState.previewRenderMode = "cpu";
  }

  function ensureAlignmentEngine() {
    if (localState.alignmentEngine) return localState.alignmentEngine;
    if (!modules.blendMatchWebglAlignment || typeof modules.blendMatchWebglAlignment.createWebglAlignmentEngine !== "function") {
      localState.alignmentGpuUnavailableReason = "webgl-alignment-module-missing";
      return null;
    }
    try {
      if (typeof modules.blendMatchWebglAlignment.detectSupport === "function") {
        const support = modules.blendMatchWebglAlignment.detectSupport();
        if (!support || !support.supported) {
          localState.alignmentGpuUnavailableReason = support && support.reason ? support.reason : "webgl2-unavailable";
          return null;
        }
      }
      localState.alignmentEngine = modules.blendMatchWebglAlignment.createWebglAlignmentEngine();
      localState.alignmentGpuUnavailableReason = "";
      return localState.alignmentEngine;
    } catch (error) {
      localState.alignmentEngine = null;
      localState.alignmentGpuUnavailableReason = error && error.message ? error.message : "webgl-alignment-create-failed";
      console.warn("[PixelRunner] BlendMatch WebGL alignment unavailable:", error);
      return null;
    }
  }

  function disposeAlignmentEngine() {
    if (localState.alignmentEngine && typeof localState.alignmentEngine.dispose === "function") {
      try {
        localState.alignmentEngine.dispose();
      } catch (_) {}
    }
    localState.alignmentEngine = null;
  }

  function resolveGpuAlignmentSeedWaiters(seed) {
    const waiters = Array.isArray(localState.gpuAlignmentSeedWaiters)
      ? localState.gpuAlignmentSeedWaiters
      : [];
    const remaining = [];
    waiters.forEach((waiter) => {
      try {
        if (typeof waiter === "function") {
          waiter(seed || null);
          return;
        }
        if (!waiter || typeof waiter.resolve !== "function") return;
        if (!seed || !waiter.previewCacheKey || String(seed.previewCacheKey || "") === String(waiter.previewCacheKey || "")) {
          waiter.resolve(seed || null);
        } else {
          remaining.push(waiter);
        }
      } catch (_) {}
    });
    localState.gpuAlignmentSeedWaiters = remaining;
  }

  function clearStaleGpuAlignmentSeed() {
    const seed = localState.latestGpuAlignmentSeed;
    if (!seed) return;
    const age = getPreviewNowMs() - Number(seed.createdAt || 0);
    if (age > GPU_ALIGNMENT_SEED_TTL_MS) {
      localState.latestGpuAlignmentSeed = null;
    }
  }

  function isGpuAlignmentSeedPreviewMatch(seed, previewCacheKey) {
    if (!seed || !previewCacheKey) return false;
    return String(seed.previewCacheKey || "") === String(previewCacheKey || "");
  }

  function getLatestGpuAlignmentSeed(previewCacheKey) {
    clearStaleGpuAlignmentSeed();
    const seed = localState.latestGpuAlignmentSeed;
    return isGpuAlignmentSeedPreviewMatch(seed, previewCacheKey) ? seed : null;
  }

  function waitForGpuAlignmentSeed(previewCacheKey, graceMs) {
    const startedAt = getPreviewNowMs();
    const immediateSeed = getLatestGpuAlignmentSeed(previewCacheKey);
    if (immediateSeed || !(Number(graceMs) > 0)) {
      return Promise.resolve({
        seed: immediateSeed || null,
        waitedMs: getPreviewNowMs() - startedAt,
        match: Boolean(immediateSeed),
        timedOut: !immediateSeed && !(Number(graceMs) > 0)
      });
    }
    return new Promise((resolve) => {
      let done = false;
      let timeoutId = 0;
      const finish = (seed, timedOut = false) => {
        if (done) return;
        done = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        localState.gpuAlignmentSeedWaiters = (localState.gpuAlignmentSeedWaiters || []).filter((waiter) => waiter.resolve !== finish);
        const matchedSeed = isGpuAlignmentSeedPreviewMatch(seed, previewCacheKey) ? seed : null;
        resolve({
          seed: matchedSeed,
          waitedMs: getPreviewNowMs() - startedAt,
          match: Boolean(matchedSeed),
          timedOut: Boolean(timedOut && !matchedSeed)
        });
      };
      localState.gpuAlignmentSeedWaiters.push({ previewCacheKey: String(previewCacheKey || ""), resolve: finish });
      timeoutId = window.setTimeout(() => finish(null, true), Math.max(1, Math.round(Number(graceMs) || 1)));
    });
  }

  function decodeBase64Bytes(base64) {
    const text = String(base64 || "");
    if (!text) return null;
    const binary = window.atob(text);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      out[index] = binary.charCodeAt(index);
    }
    return out;
  }

  function decodePreviewSample(rawSample) {
    if (!rawSample || typeof rawSample !== "object") return null;
    const startedAt = getPreviewNowMs();
    const data = decodeBase64Bytes(rawSample.base64);
    return data
      ? {
          width: Math.max(1, Number(rawSample.width) || 1),
          height: Math.max(1, Number(rawSample.height) || 1),
          scaleX: Number(rawSample.scaleX) || 1,
          scaleY: Number(rawSample.scaleY) || 1,
          data,
          byteLength: data.byteLength,
          stats: rawSample.stats || null,
          decodeMs: getPreviewNowMs() - startedAt
        }
      : null;
  }

  function createImageDataFromSample(sample) {
    if (!sample || !sample.data) return null;
    const width = Math.max(1, Math.floor(Number(sample.width) || 1));
    const height = Math.max(1, Math.floor(Number(sample.height) || 1));
    const expectedLength = width * height * 4;
    const data = sample.data instanceof Uint8ClampedArray
      ? sample.data
      : new Uint8ClampedArray(sample.data.buffer, sample.data.byteOffset || 0, Math.min(sample.data.byteLength || sample.data.length || 0, expectedLength));
    if (data.length < expectedLength) return null;
    const clamped = data.length === expectedLength ? data : data.slice(0, expectedLength);
    try {
      return new ImageData(clamped, width, height);
    } catch (_) {
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const imageData = ctx.createImageData(width, height);
      imageData.data.set(clamped);
      return imageData;
    }
  }

  function buildCanvasFromSample(sample, role, assetKey) {
    const imageData = createImageDataFromSample(sample);
    if (!imageData) return null;
    const canvas = imageDataToCanvas(imageData);
    canvas.pixelrunnerTextureKey = `${role}:${assetKey}`;
    return { imageData, canvas };
  }

  const GPU_ALIGNMENT_SHADOW_THRESHOLDS = {
    target: {
      dxDelta: 2,
      dyDelta: 2,
      scaleDelta: 0.15,
      rotationDelta: 0.15
    },
    reject: {
      dxDelta: 10,
      dyDelta: 10,
      scaleDelta: 1.25,
      rotationDelta: 1.25
    }
  };

  function clonePlainValue(value) {
    if (value == null || typeof value !== "object") return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return Array.isArray(value) ? value.slice() : { ...value };
    }
  }

  function readFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function readOptionalNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function getAlignmentScaleXPercent(alignment) {
    if (!alignment || typeof alignment !== "object") return 100;
    return readFiniteNumber(
      alignment.scaleXPercent ?? alignment.scalePercent ?? (alignment.scaleX ? alignment.scaleX * 100 : undefined),
      100
    );
  }

  function getAlignmentScaleYPercent(alignment) {
    if (!alignment || typeof alignment !== "object") return 100;
    return readFiniteNumber(
      alignment.scaleYPercent ?? alignment.scalePercent ?? (alignment.scaleY ? alignment.scaleY * 100 : undefined),
      100
    );
  }

  function getAlignmentDiff(gpuAlignment, cpuAlignment) {
    if (!gpuAlignment || !cpuAlignment) return null;
    const dxDelta = Math.abs(readFiniteNumber(gpuAlignment.dx) - readFiniteNumber(cpuAlignment.dx));
    const dyDelta = Math.abs(readFiniteNumber(gpuAlignment.dy) - readFiniteNumber(cpuAlignment.dy));
    const scaleDelta = Math.max(
      Math.abs(getAlignmentScaleXPercent(gpuAlignment) - getAlignmentScaleXPercent(cpuAlignment)),
      Math.abs(getAlignmentScaleYPercent(gpuAlignment) - getAlignmentScaleYPercent(cpuAlignment))
    );
    const rotationDelta = Math.abs(readFiniteNumber(gpuAlignment.rotation) - readFiniteNumber(cpuAlignment.rotation));
    const confidenceDelta = Math.abs(readFiniteNumber(gpuAlignment.confidence) - readFiniteNumber(cpuAlignment.confidence));
    return {
      dxDelta,
      dyDelta,
      scaleDelta,
      rotationDelta,
      confidenceDelta,
      dx: dxDelta,
      dy: dyDelta,
      scale: scaleDelta,
      rotation: rotationDelta,
      confidence: confidenceDelta
    };
  }

  function formatAlignmentComparison(gpuAlignment, cpuAlignment) {
    const diff = getAlignmentDiff(gpuAlignment, cpuAlignment);
    if (!diff) return "无可比结果";
    return `dxDelta ${diff.dxDelta.toFixed(2)}px / dyDelta ${diff.dyDelta.toFixed(2)}px / scaleDelta ${diff.scaleDelta.toFixed(3)}% / rotationDelta ${diff.rotationDelta.toFixed(3)}° / confidenceDelta ${diff.confidenceDelta.toFixed(3)}`;
  }

  function buildGpuAlignmentWarnings(gpuAlignment) {
    const warnings = [];
    if (!gpuAlignment || typeof gpuAlignment !== "object") return ["gpu-candidate-missing"];
    const search = gpuAlignment.search || {};
    const remaining = Array.isArray(search.remainingCpuStages) ? search.remainingCpuStages : [];
    if (remaining.includes("affine-refine")) warnings.push("missing-affine-refinement");
    if (remaining.includes("local-mesh")) warnings.push("missing-local-mesh");
    if (!gpuAlignment.modelChoice) warnings.push("missing-conservative-model-selection");
    if (!gpuAlignment.local || gpuAlignment.local.applied !== true) warnings.push("missing-local-mesh-validation");
    if (Math.abs(readFiniteNumber(gpuAlignment.rotation)) <= 0.0001) warnings.push("missing-rotation-refinement");
    if (Math.abs(getAlignmentScaleXPercent(gpuAlignment) - getAlignmentScaleYPercent(gpuAlignment)) <= 0.0001) warnings.push("missing-non-uniform-scale");
    return Array.from(new Set(warnings));
  }

  function normalizeGpuAlignmentCandidate(gpuAlignment, options = {}) {
    if (!gpuAlignment || typeof gpuAlignment !== "object") return null;
    const score = readOptionalNumber(gpuAlignment.score);
    const confidence = readOptionalNumber(gpuAlignment.confidence);
    const search = clonePlainValue(gpuAlignment.search) || {};
    const local = clonePlainValue(gpuAlignment.local) || {
      enabled: false,
      applied: false,
      validTiles: 0,
      totalTiles: 0,
      reason: "gpu-local-missing"
    };
    const backend = String(gpuAlignment.backend || gpuAlignment.gpuBackend || "gpu-webgl2-v1");
    return {
      schemaVersion: 2,
      backend,
      sourceBackend: backend,
      analyzer: "webview-shadow-candidate",
      diagnosticOnly: true,
      trusted: false,
      finalApplyEligible: false,
      applied: Boolean(gpuAlignment.applied),
      dx: readFiniteNumber(gpuAlignment.dx),
      dy: readFiniteNumber(gpuAlignment.dy),
      scalePercent: readFiniteNumber(gpuAlignment.scalePercent, getAlignmentScaleXPercent(gpuAlignment)),
      scaleXPercent: getAlignmentScaleXPercent(gpuAlignment),
      scaleYPercent: getAlignmentScaleYPercent(gpuAlignment),
      rotation: readFiniteNumber(gpuAlignment.rotation),
      confidence,
      score,
      sampleDx: readFiniteNumber(gpuAlignment.sampleDx ?? gpuAlignment.rawSampleDx),
      sampleDy: readFiniteNumber(gpuAlignment.sampleDy ?? gpuAlignment.rawSampleDy),
      sampleScale: readFiniteNumber(gpuAlignment.sampleScale ?? gpuAlignment.rawSampleScaleX, 1),
      sampleScaleX: readFiniteNumber(gpuAlignment.sampleScaleX ?? gpuAlignment.rawSampleScaleX, 1),
      sampleScaleY: readFiniteNumber(gpuAlignment.sampleScaleY ?? gpuAlignment.rawSampleScaleY, 1),
      sampleRotation: readFiniteNumber(gpuAlignment.sampleRotation ?? gpuAlignment.rawSampleRotation),
      rawSampleDx: readFiniteNumber(gpuAlignment.rawSampleDx ?? gpuAlignment.sampleDx),
      rawSampleDy: readFiniteNumber(gpuAlignment.rawSampleDy ?? gpuAlignment.sampleDy),
      rawSampleScaleX: readFiniteNumber(gpuAlignment.rawSampleScaleX ?? gpuAlignment.sampleScaleX, 1),
      rawSampleScaleY: readFiniteNumber(gpuAlignment.rawSampleScaleY ?? gpuAlignment.sampleScaleY, 1),
      rawSampleRotation: readFiniteNumber(gpuAlignment.rawSampleRotation ?? gpuAlignment.sampleRotation),
      modelChoice: clonePlainValue(gpuAlignment.modelChoice) || {
        selected: "global-translation-uniform-scale",
        rejectedAffine: true,
        reason: "gpu-v1-global-only"
      },
      search: {
        ...search,
        shadowValidationMode: String(options.validationMode || ""),
        schema: "alignment-candidate-v2"
      },
      validation: {
        verdict: "pending",
        reason: "pending-shadow-validation",
        diagnosticOnly: true,
        finalApplyEligible: false
      },
      local,
      localDeformation: Boolean(gpuAlignment.localDeformation),
      reason: String(gpuAlignment.reason || ""),
      warnings: buildGpuAlignmentWarnings(gpuAlignment),
      gpu: true,
      timings: clonePlainValue(gpuAlignment.timings) || null,
      support: clonePlainValue(gpuAlignment.support) || null
    };
  }

  function trimGpuSeedCandidates(candidates, limit = 8) {
    if (!Array.isArray(candidates)) return [];
    return candidates.slice(0, Math.max(1, Math.min(12, Number(limit) || 8))).map((candidate) => ({
      dx: readFiniteNumber(candidate && candidate.dx),
      dy: readFiniteNumber(candidate && candidate.dy),
      scale: readFiniteNumber(candidate && candidate.scale, 1),
      score: readOptionalNumber(candidate && candidate.score),
      secondScore: readOptionalNumber(candidate && candidate.secondScore),
      scoreGap: readOptionalNumber(candidate && candidate.scoreGap),
      sampleCount: Math.max(0, Math.round(readFiniteNumber(candidate && candidate.sampleCount))),
      directionAgreement: readOptionalNumber(candidate && candidate.directionAgreement),
      edgeOverlap: readOptionalNumber(candidate && candidate.edgeOverlap),
      stage: String(candidate && candidate.stage || "")
    }));
  }

  function normalizeGpuValidationSummary(summary) {
    if (!summary || typeof summary !== "object") return null;
    return {
      schemaVersion: Number(summary.schemaVersion) || 1,
      backend: String(summary.backend || "gpu-webgl2-global-v1"),
      compact: summary.compact !== false,
      score: readOptionalNumber(summary.score),
      secondScore: readOptionalNumber(summary.secondScore),
      scoreGap: readOptionalNumber(summary.scoreGap),
      sampleCount: Math.max(0, Math.round(readFiniteNumber(summary.sampleCount))),
      directionAgreement: readOptionalNumber(summary.directionAgreement),
      edgeOverlap: readOptionalNumber(summary.edgeOverlap),
      scoreCalls: Math.max(0, Math.round(readFiniteNumber(summary.scoreCalls))),
      scoreReadback: String(summary.scoreReadback || "candidate-summary"),
      best: summary.best && typeof summary.best === "object" ? {
        dx: readFiniteNumber(summary.best.dx),
        dy: readFiniteNumber(summary.best.dy),
        scale: readFiniteNumber(summary.best.scale, 1),
        score: readOptionalNumber(summary.best.score),
        secondScore: readOptionalNumber(summary.best.secondScore),
        scoreGap: readOptionalNumber(summary.best.scoreGap),
        sampleCount: Math.max(0, Math.round(readFiniteNumber(summary.best.sampleCount))),
        directionAgreement: readOptionalNumber(summary.best.directionAgreement),
        edgeOverlap: readOptionalNumber(summary.best.edgeOverlap)
      } : null,
      topK: trimGpuSeedCandidates(summary.topK || summary.topCandidates || [], 8)
    };
  }

  function buildGpuAlignmentSeed(candidate, sampleResult, validation, timingInfo = {}) {
    if (!candidate || !sampleResult || !sampleResult.previewCacheKey) return null;
    const search = candidate.search || {};
    const refined = search.refinedCandidate || null;
    const topCandidates = trimGpuSeedCandidates(search.topCandidates || []);
    if (refined && !topCandidates.some((item) => (
      Math.abs(readFiniteNumber(item.dx) - readFiniteNumber(refined.dx)) < 0.001 &&
      Math.abs(readFiniteNumber(item.dy) - readFiniteNumber(refined.dy)) < 0.001 &&
      Math.abs(readFiniteNumber(item.scale, 1) - readFiniteNumber(refined.scale, 1)) < 0.000001
    ))) {
      topCandidates.unshift({
        dx: readFiniteNumber(refined.dx),
        dy: readFiniteNumber(refined.dy),
        scale: readFiniteNumber(refined.scale, 1),
        score: readOptionalNumber(refined.score),
        stage: "refinedCandidate"
      });
    }
    return {
      schemaVersion: 1,
      seedTrust: "hint-only",
      diagnosticOnly: true,
      finalApplyEligible: false,
      previewCacheKey: String(sampleResult.previewCacheKey || ""),
      planId: String(sampleResult.planId || ""),
      layerId: Number(sampleResult.layerId) || 0,
      width: Number(sampleResult.width) || Number(sampleResult.sourceSample && sampleResult.sourceSample.width) || 0,
      height: Number(sampleResult.height) || Number(sampleResult.sourceSample && sampleResult.sourceSample.height) || 0,
      createdAt: getPreviewNowMs(),
      createdTotalMs: Number((Number(timingInfo.totalFromPreviewStartMs) || 0).toFixed(1)),
      candidate: {
        backend: String(candidate.backend || "gpu-webgl2-v1"),
        applied: Boolean(candidate.applied),
        dx: readFiniteNumber(candidate.dx),
        dy: readFiniteNumber(candidate.dy),
        scaleXPercent: getAlignmentScaleXPercent(candidate),
        scaleYPercent: getAlignmentScaleYPercent(candidate),
        rotation: readFiniteNumber(candidate.rotation),
        confidence: readOptionalNumber(candidate.confidence),
        score: readOptionalNumber(candidate.score),
        sampleDx: readFiniteNumber(candidate.sampleDx ?? candidate.rawSampleDx),
        sampleDy: readFiniteNumber(candidate.sampleDy ?? candidate.rawSampleDy),
        sampleScaleX: readFiniteNumber(candidate.sampleScaleX ?? candidate.rawSampleScaleX, 1),
        sampleScaleY: readFiniteNumber(candidate.sampleScaleY ?? candidate.rawSampleScaleY, 1),
        sampleRotation: readFiniteNumber(candidate.sampleRotation ?? candidate.rawSampleRotation)
      },
      search: {
        sampleOffset: Number(search.sampleOffset) || 0,
        stride: Number(search.stride) || 0,
        scoreCalls: Number(search.scoreCalls) || 0,
        coarseStep: Number(search.coarseStep) || 0,
        coarseStride: Number(search.coarseStride) || 0,
        globalValidation: normalizeGpuValidationSummary(search.globalValidation || search.validationSummary),
        refinedCandidate: refined ? {
          dx: readFiniteNumber(refined.dx),
          dy: readFiniteNumber(refined.dy),
          scale: readFiniteNumber(refined.scale, 1),
          score: readOptionalNumber(refined.score),
          secondScore: readOptionalNumber(refined.secondScore),
          scoreGap: readOptionalNumber(refined.scoreGap),
          sampleCount: Math.max(0, Math.round(readFiniteNumber(refined.sampleCount))),
          directionAgreement: readOptionalNumber(refined.directionAgreement),
          edgeOverlap: readOptionalNumber(refined.edgeOverlap)
        } : null,
        topCandidates,
        stages: Array.isArray(search.stages)
          ? search.stages.slice(0, 8).map((stage) => ({
              name: String(stage && stage.name || stage || ""),
              step: Number(stage && stage.step) || 0,
              radius: Number(stage && stage.radius) || 0,
              candidates: Number(stage && stage.candidates) || 0
            }))
          : []
      },
      timings: clonePlainValue(candidate.timings) || null,
      validation: clonePlainValue(validation || candidate.validation) || null
    };
  }

  function saveLatestGpuAlignmentSeed(candidate, sampleResult, validation, timingInfo = {}) {
    const seed = buildGpuAlignmentSeed(candidate, sampleResult, validation, timingInfo);
    if (!seed) return null;
    localState.latestGpuAlignmentSeed = seed;
    resolveGpuAlignmentSeedWaiters(seed);
    if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
      const topCount = seed.search && Array.isArray(seed.search.topCandidates) ? seed.search.topCandidates.length : 0;
      modules.ui.logToWorkspace(`[融合校色] GPU seed ready total：${formatPreviewMs(seed.createdTotalMs)}，previewCacheKey=${seed.previewCacheKey || "无"}，topCandidates=${topCount}，trust=hint-only。`, "info");
    }
    updatePreviewBackgroundOverlay();
    return seed;
  }

  function validateGpuAlignmentCandidate(candidate, cpuAlignment, options = {}) {
    const hasCpuBaseline = Boolean(cpuAlignment && String(cpuAlignment.backend || "") !== "cpu-pending");
    const diff = hasCpuBaseline ? getAlignmentDiff(candidate, cpuAlignment) : null;
    const rejectReasons = [];
    const warnings = [];
    const score = readOptionalNumber(candidate && candidate.score);
    const confidence = readOptionalNumber(candidate && candidate.confidence);
    const thresholds = clonePlainValue(GPU_ALIGNMENT_SHADOW_THRESHOLDS);
    if (score === null || score <= -0.95) rejectReasons.push("gpu-missing-score");
    if (confidence === null || confidence < 0 || confidence > 1) rejectReasons.push("gpu-invalid-confidence");
    if (!hasCpuBaseline) rejectReasons.push("cpu-baseline-missing");
    if (diff) {
      if (diff.dxDelta > thresholds.reject.dxDelta) rejectReasons.push("dx-delta-too-large");
      else if (diff.dxDelta > thresholds.target.dxDelta) warnings.push("dx-delta-above-reference-target");
      if (diff.dyDelta > thresholds.reject.dyDelta) rejectReasons.push("dy-delta-too-large");
      else if (diff.dyDelta > thresholds.target.dyDelta) warnings.push("dy-delta-above-reference-target");
      if (diff.scaleDelta > thresholds.reject.scaleDelta) rejectReasons.push("scale-delta-too-large");
      else if (diff.scaleDelta > thresholds.target.scaleDelta) warnings.push("scale-delta-above-reference-target");
      if (diff.rotationDelta > thresholds.reject.rotationDelta) rejectReasons.push("rotation-delta-too-large");
      else if (diff.rotationDelta > thresholds.target.rotationDelta) warnings.push("rotation-delta-above-reference-target");
    }
    const verdict = rejectReasons.length ? "rejected" : warnings.length ? "suspicious" : "acceptable";
    return {
      schemaVersion: 1,
      mode: String(options.validationMode || ""),
      verdict,
      acceptable: verdict === "acceptable",
      diff,
      reasons: rejectReasons.slice(),
      rejectReasons: rejectReasons.slice(),
      warnings,
      thresholds,
      diagnosticOnly: true,
      finalApplyEligible: false,
      cpuBackend: String(cpuAlignment && cpuAlignment.backend || "cpu")
    };
  }

  function attachGpuShadowValidation(candidate, validation) {
    if (!candidate || typeof candidate !== "object") return candidate;
    candidate.validation = {
      ...candidate.validation,
      ...(validation || {})
    };
    return candidate;
  }

  function formatShadowValidation(validation) {
    if (!validation) return "verdict=unknown";
    const diff = validation.diff || {};
    const reasons = Array.isArray(validation.rejectReasons) && validation.rejectReasons.length
      ? validation.rejectReasons.join(",")
      : Array.isArray(validation.warnings) && validation.warnings.length
        ? validation.warnings.join(",")
        : "none";
    return `verdict=${validation.verdict || "unknown"} / dxDelta=${Number(diff.dxDelta || 0).toFixed(2)}px / dyDelta=${Number(diff.dyDelta || 0).toFixed(2)}px / scaleDelta=${Number(diff.scaleDelta || 0).toFixed(3)}% / rotationDelta=${Number(diff.rotationDelta || 0).toFixed(3)}° / confidenceDelta=${Number(diff.confidenceDelta || 0).toFixed(3)} / reason=${reasons}`;
  }

  function getGpuAlignmentValidationMode() {
    try {
      return String(window.localStorage && window.localStorage.getItem("pixelrunner.blendMatch.gpuAlignmentValidation") || "once").trim();
    } catch (_) {
      return "once";
    }
  }

  function shouldRequestCpuAlignmentBaseline() {
    const mode = getGpuAlignmentValidationMode();
    if (mode === "always" || mode === "true" || mode === "1") return true;
    if (mode === "off" || mode === "false" || mode === "0") return false;
    return !localState.alignmentValidationDone;
  }

  function isAlignmentDiffAcceptable(diff) {
    if (!diff) return true;
    return (
      readFiniteNumber(diff.dxDelta ?? diff.dx) <= GPU_ALIGNMENT_SHADOW_THRESHOLDS.reject.dxDelta &&
      readFiniteNumber(diff.dyDelta ?? diff.dy) <= GPU_ALIGNMENT_SHADOW_THRESHOLDS.reject.dyDelta &&
      readFiniteNumber(diff.scaleDelta ?? diff.scale) <= GPU_ALIGNMENT_SHADOW_THRESHOLDS.reject.scaleDelta &&
      readFiniteNumber(diff.rotationDelta ?? diff.rotation) <= GPU_ALIGNMENT_SHADOW_THRESHOLDS.reject.rotationDelta
    );
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

  function createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(width));
    canvas.height = Math.max(1, Math.floor(height));
    return canvas;
  }

  function imageDataToCanvas(imageData) {
    const canvas = createCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function getPreviewSplit() {
    const splitInput = getById("blendMatchPreviewSplitInput");
    return Math.max(0.02, Math.min(0.98, Number(splitInput && splitInput.value) / 100 || localState.previewView.split || 0.5));
  }

  function getPreviewCorrectionKey(corrections) {
    const balance = corrections && corrections.colorBalance ? corrections.colorBalance : {};
    return [
      Number(corrections && corrections.brightness) || 0,
      Number(corrections && corrections.contrast) || 0,
      Number(corrections && corrections.saturation) || 0,
      Number(balance.cyanRed) || 0,
      Number(balance.magentaGreen) || 0,
      Number(balance.yellowBlue) || 0
    ].join("|");
  }

  function getPreviewColorPlan(preview) {
    if (!preview || typeof preview !== "object") return null;
    if (preview.colorPlan && typeof preview.colorPlan === "object") return preview.colorPlan;
    return null;
  }

  function getPreviewColorSummary(preview) {
    if (!preview || typeof preview !== "object") return null;
    if (preview.colorSummary && typeof preview.colorSummary === "object") return preview.colorSummary;
    const colorPlan = getPreviewColorPlan(preview);
    if (!colorPlan) return null;
    return {
      version: Number(colorPlan.version) || 0,
      backend: String(colorPlan.backend || ""),
      method: String(colorPlan.method || ""),
      executable: colorPlan.executable !== false,
      previewRenderable: colorPlan.previewRenderable === true,
      previewFallback: String(colorPlan.previewFallback || ""),
      profile: colorPlan.summary || null,
      corrections: colorPlan.corrections || null
    };
  }

  function isPreviewUsingSimplifiedColorFallback(preview) {
    const summary = getPreviewColorSummary(preview);
    return !summary || summary.previewRenderable !== true || String(summary.previewFallback || "") === "simplified-corrections";
  }

  function formatColorPlanMeta(preview) {
    const summary = getPreviewColorSummary(preview);
    if (!summary) return "color plan 无";
    const profile = summary.profile || {};
    const weight = Number(profile.subjectWeight) || 0;
    const fallback = isPreviewUsingSimplifiedColorFallback(preview) ? "simplified fallback" : "plan renderer";
    return `ColorPlan ${summary.method || "unknown"} / ${fallback}${weight ? ` / 权重 ${Math.round(weight)}` : ""}`;
  }

  function buildCorrectionsFromStats(sourceStats, referenceStats, config) {
    const safeConfig = config || {};
    const total = (Number(safeConfig.totalStrength) || 0) / 100;
    const luminanceAmount = total * ((Number(safeConfig.luminanceStrength) || 0) / 100);
    const contrastAmount = total * ((Number(safeConfig.contrastStrength) || 0) / 100);
    const colorAmount = total * ((Number(safeConfig.colorStrength) || 0) / 100);
    const saturationAmount = total * ((Number(safeConfig.saturationStrength) || 0) / 100);
    const sourceLuma = Number(sourceStats && sourceStats.weightedMeanLuma) || Number(sourceStats && sourceStats.meanLuma) || 0;
    const referenceLuma = Number(referenceStats && referenceStats.weightedMeanLuma) || Number(referenceStats && referenceStats.meanLuma) || 0;
    const sourceSat = Number(sourceStats && sourceStats.weightedMeanSat) || Number(sourceStats && sourceStats.meanSat) || 0;
    const referenceSat = Number(referenceStats && referenceStats.weightedMeanSat) || Number(referenceStats && referenceStats.meanSat) || 0;
    const lumaDelta = referenceLuma - sourceLuma;
    const sourceStd = Number(sourceStats && sourceStats.stdLuma) || 0;
    const referenceStd = Number(referenceStats && referenceStats.stdLuma) || 0;
    const sourceDetail = Number(sourceStats && sourceStats.detailEnergy) || 0;
    const referenceDetail = Number(referenceStats && referenceStats.detailEnergy) || 0;
    const stdRatio = sourceStd > 1 ? referenceStd / sourceStd : 1;
    const detailRatio = sourceDetail > 0.5 ? referenceDetail / sourceDetail : 1;
    const rgbDelta = {
      r: (Number(referenceStats && referenceStats.meanR) || 0) - (Number(sourceStats && sourceStats.meanR) || 0),
      g: (Number(referenceStats && referenceStats.meanG) || 0) - (Number(sourceStats && sourceStats.meanG) || 0),
      b: (Number(referenceStats && referenceStats.meanB) || 0) - (Number(sourceStats && sourceStats.meanB) || 0)
    };
    const weightedRgbDelta = {
      r: (Number(referenceStats && referenceStats.weightedMeanR) || Number(referenceStats && referenceStats.meanR) || 0) - (Number(sourceStats && sourceStats.weightedMeanR) || Number(sourceStats && sourceStats.meanR) || 0),
      g: (Number(referenceStats && referenceStats.weightedMeanG) || Number(referenceStats && referenceStats.meanG) || 0) - (Number(sourceStats && sourceStats.weightedMeanG) || Number(sourceStats && sourceStats.meanG) || 0),
      b: (Number(referenceStats && referenceStats.weightedMeanB) || Number(referenceStats && referenceStats.meanB) || 0) - (Number(sourceStats && sourceStats.weightedMeanB) || Number(sourceStats && sourceStats.meanB) || 0)
    };
    const avgDelta = (weightedRgbDelta.r + weightedRgbDelta.g + weightedRgbDelta.b) / 3;
    const colorBias = {
      r: weightedRgbDelta.r - avgDelta,
      g: weightedRgbDelta.g - avgDelta,
      b: weightedRgbDelta.b - avgDelta
    };
    const directColorBias = {
      r: weightedRgbDelta.r - lumaDelta * 0.36,
      g: weightedRgbDelta.g - lumaDelta * 0.36,
      b: weightedRgbDelta.b - lumaDelta * 0.36
    };
    const finalColorBias = {
      r: colorBias.r * 0.68 + directColorBias.r * 0.32,
      g: colorBias.g * 0.68 + directColorBias.g * 0.32,
      b: colorBias.b * 0.68 + directColorBias.b * 0.32
    };
    return {
      brightness: clampNumber(Math.round(lumaDelta * 0.78 * luminanceAmount), -45, 45, 0),
      contrast: clampNumber(Math.round((((stdRatio - 1) * 0.72) + ((detailRatio - 1) * 0.28)) * 86 * contrastAmount), -35, 35, 0),
      saturation: clampNumber(Math.round((referenceSat - sourceSat) * 170 * saturationAmount), -35, 35, 0),
      colorBalance: {
        cyanRed: clampNumber(Math.round(finalColorBias.r * 0.72 * colorAmount), -32, 32, 0),
        magentaGreen: clampNumber(Math.round(finalColorBias.g * 0.72 * colorAmount), -32, 32, 0),
        yellowBlue: clampNumber(Math.round(finalColorBias.b * 0.72 * colorAmount), -32, 32, 0)
      },
      raw: {
        lumaDelta,
        stdRatio,
        detailRatio,
        saturationDelta: referenceSat - sourceSat,
        rgbDelta,
        weightedRgbDelta,
        colorBias: finalColorBias
      }
    };
  }

  function buildSampleStatsKey(stats) {
    if (!stats || typeof stats !== "object") return "";
    return [
      stats.count,
      stats.meanR,
      stats.meanG,
      stats.meanB,
      stats.meanLuma,
      stats.weightedMeanR,
      stats.weightedMeanG,
      stats.weightedMeanB,
      stats.weightedMeanLuma,
      stats.stdLuma,
      stats.detailEnergy
    ].map((value) => Number(Number(value) || 0).toFixed(2)).join(",");
  }

  function buildSampleDataFingerprint(sample) {
    if (!sample || typeof sample !== "object") return "missing";
    const data = sample.data || sample.rgba || null;
    const byteLength = Number(sample.byteLength || (data && (data.byteLength || data.length)) || 0) || 0;
    if (!data || byteLength <= 0) return `${byteLength}:no-data:${buildSampleStatsKey(sample.stats)}`;
    const bytes = data instanceof Uint8Array
      ? data
      : data.buffer instanceof ArrayBuffer
        ? new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength || data.length || byteLength)
        : Array.isArray(data)
          ? new Uint8Array(data)
          : null;
    if (!bytes || !bytes.length) return `${byteLength}:unreadable:${buildSampleStatsKey(sample.stats)}`;
    let hash = 2166136261;
    const probeCount = Math.min(96, bytes.length);
    const stride = Math.max(1, Math.floor(bytes.length / probeCount));
    for (let index = 0; index < bytes.length; index += stride) {
      hash ^= bytes[index];
      hash = Math.imul(hash, 16777619);
    }
    const tailStart = Math.max(0, bytes.length - 16);
    for (let index = tailStart; index < bytes.length; index += 1) {
      hash ^= bytes[index];
      hash = Math.imul(hash, 16777619);
    }
    return [
      byteLength,
      (hash >>> 0).toString(36),
      buildSampleStatsKey(sample.stats)
    ].join(":");
  }

  function buildPreviewRawKey(preview) {
    return String(preview && preview.rawAssetKey || [
      preview && preview.previewCacheKey ? preview.previewCacheKey : "",
      preview && preview.planId ? preview.planId : "",
      preview && preview.sourceSample ? preview.sourceSample.byteLength : 0,
      preview && preview.referenceSample ? preview.referenceSample.byteLength : 0,
      preview && preview.width ? preview.width : 0,
      preview && preview.height ? preview.height : 0,
      preview && preview.sourceSample ? buildSampleDataFingerprint(preview.sourceSample) : "",
      preview && preview.referenceSample ? buildSampleDataFingerprint(preview.referenceSample) : "",
      preview && preview.sourceDataUrl ? preview.sourceDataUrl.length : 0,
      preview && preview.referenceDataUrl ? preview.referenceDataUrl.length : 0
    ].join("|"));
  }

  function buildPreviewAssetsKey(preview) {
    return [
      preview && preview.width ? preview.width : 0,
      preview && preview.height ? preview.height : 0,
      buildPreviewRawKey(preview)
    ].join("|");
  }

  function buildPreviewAssetKey(preview, settings) {
    const colorSummary = getPreviewColorSummary(preview);
    return [
      buildPreviewRawKey(preview),
      preview && preview.width ? preview.width : 0,
      preview && preview.height ? preview.height : 0,
      getPreviewCorrectionKey(preview && preview.corrections),
      colorSummary ? [
        Number(colorSummary.version) || 0,
        colorSummary.method || "",
        colorSummary.previewRenderable === true ? "plan" : colorSummary.previewFallback || "fallback",
        JSON.stringify(colorSummary.profile || {})
      ].join(":") : "",
      Number(settings && settings.featherRadius) || 0
    ].join("|");
  }

  function getMaskThresholdFactor() {
    return { offset: 8, scale: 42, edge: 0.18 };
  }

  function buildPreviewAssets(preview) {
    if (!preview) return null;
    const width = Math.max(1, preview.width);
    const height = Math.max(1, preview.height);
    let source = preview.sourceImageData || null;
    let reference = preview.referenceImageData || null;
    let sourceCanvas = preview.sourceCanvas || null;
    let referenceCanvas = preview.referenceCanvas || null;
    if (!source || !reference) {
      if (!preview.sourceImage || !preview.referenceImage) return null;
      sourceCanvas = createCanvas(width, height);
      referenceCanvas = createCanvas(width, height);
      const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
      const referenceCtx = referenceCanvas.getContext("2d", { willReadFrequently: true });
      if (!sourceCtx || !referenceCtx) return null;
      sourceCtx.drawImage(preview.sourceImage, 0, 0, width, height);
      referenceCtx.drawImage(preview.referenceImage, 0, 0, width, height);
      source = sourceCtx.getImageData(0, 0, width, height);
      reference = referenceCtx.getImageData(0, 0, width, height);
    }
    if (!sourceCanvas) sourceCanvas = imageDataToCanvas(source);
    if (!referenceCanvas) referenceCanvas = imageDataToCanvas(reference);
    const threshold = getMaskThresholdFactor();
    const mask = new Float32Array(width * height);
    for (let i = 0, p = 0; i < source.data.length; i += 4, p += 1) {
      const diff = (
        Math.abs(source.data[i] - reference.data[i]) +
        Math.abs(source.data[i + 1] - reference.data[i + 1]) +
        Math.abs(source.data[i + 2] - reference.data[i + 2])
      ) / 3;
      mask[p] = clamp01((diff - threshold.offset) / threshold.scale);
    }
    const key = buildPreviewAssetsKey(preview);
    return {
      key,
      width,
      height,
      sourceImageData: source,
      referenceImageData: reference,
      sourceCanvas,
      referenceCanvas,
      mask,
      maskKey: key
    };
  }

  function computeErodedMask(mask, width, height, radius) {
    const r = Math.max(1, Math.min(18, Math.round(radius)));
    if (r <= 1) return mask;
    const horizontal = new Float32Array(mask.length);
    const vertical = new Float32Array(mask.length);
    const out = new Float32Array(mask.length);
    const windowSize = r * 2 + 1;
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        let minValue = 1;
        for (let xx = -r; xx <= r; xx += 1) {
          const sx = Math.max(0, Math.min(width - 1, x + xx));
          minValue = Math.min(minValue, mask[row + sx]);
        }
        horizontal[row + x] = minValue;
      }
    }
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        let minValue = 1;
        for (let yy = -r; yy <= r; yy += 1) {
          const sy = Math.max(0, Math.min(height - 1, y + yy));
          minValue = Math.min(minValue, horizontal[sy * width + x]);
        }
        vertical[y * width + x] = minValue;
      }
    }
    out.set(vertical);
    return out;
  }

  function computeBlurMask(mask, width, height, radius) {
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

  function computeInwardMask(mask, width, height, radius) {
    return computeErodedMask(mask, width, height, radius);
  }

  function buildCpuPreviewCache(preview, settings) {
    const assets = localState.previewAssets && localState.previewAssets.key === buildPreviewAssetsKey(preview)
      ? localState.previewAssets
      : null;
    const nextAssets = assets || buildPreviewAssets(preview);
    if (!nextAssets) return null;
    const featherScale = Math.max(1, Math.max(preview.boundsWidth || nextAssets.width, preview.boundsHeight || nextAssets.height) / Math.max(nextAssets.width, nextAssets.height));
    const featherRadius = Math.max(1, Number(settings && settings.featherRadius) || 1);
    const scaledRadius = Math.max(1, featherRadius / featherScale);
    const inwardMask = computeInwardMask(nextAssets.mask, nextAssets.width, nextAssets.height, scaledRadius);
    const inwardHasContent = inwardMask.some ? inwardMask.some((value) => value > 0.04) : Array.from(inwardMask).some((value) => value > 0.04);
    const baseMask = inwardHasContent ? inwardMask : nextAssets.mask;
    const blurred = computeBlurMask(baseMask, nextAssets.width, nextAssets.height, scaledRadius);
    const sourceDisplay = createCanvas(nextAssets.width, nextAssets.height);
    const afterDisplay = createCanvas(nextAssets.width, nextAssets.height);
    const sourceCtx = sourceDisplay.getContext("2d");
    const afterCtx = afterDisplay.getContext("2d");
    if (!sourceCtx || !afterCtx) return null;
    sourceCtx.putImageData(nextAssets.sourceImageData, 0, 0);
    const afterImage = sourceCtx.createImageData(nextAssets.width, nextAssets.height);
    for (let i = 0, p = 0; i < nextAssets.sourceImageData.data.length; i += 4, p += 1) {
      const corrected = applyPreviewCorrection(
        nextAssets.sourceImageData.data[i],
        nextAssets.sourceImageData.data[i + 1],
        nextAssets.sourceImageData.data[i + 2],
        preview.corrections
      );
      const alpha = clamp01(blurred[p]);
      afterImage.data[i] = clampByte(nextAssets.referenceImageData.data[i] * (1 - alpha) + corrected[0] * alpha);
      afterImage.data[i + 1] = clampByte(nextAssets.referenceImageData.data[i + 1] * (1 - alpha) + corrected[1] * alpha);
      afterImage.data[i + 2] = clampByte(nextAssets.referenceImageData.data[i + 2] * (1 - alpha) + corrected[2] * alpha);
      afterImage.data[i + 3] = 255;
    }
    afterCtx.putImageData(afterImage, 0, 0);
    return {
      key: buildPreviewAssetKey(preview, settings),
      width: nextAssets.width,
      height: nextAssets.height,
      sourceCanvas: sourceDisplay,
      afterCanvas: afterDisplay,
      sourceImageData: nextAssets.sourceImageData,
      referenceImageData: nextAssets.referenceImageData,
      mask: nextAssets.mask,
      baseMask,
      blurred,
      split: getPreviewSplit()
    };
  }

  function renderCpuPreviewCache(cache, split) {
    if (!cache || !cache.sourceImageData || !cache.referenceImageData) return false;
    const canvas = getById("blendMatchPreviewCanvas");
    const frame = canvas && canvas.closest(".blend-match-preview-frame");
    if (!canvas || !frame) return false;
    const width = Math.max(1, cache.width);
    const height = Math.max(1, cache.height);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const display = ctx.createImageData(width, height);
    const source = cache.sourceImageData.data;
    const reference = cache.referenceImageData.data;
    const blurred = cache.blurred;
    const mask = cache.mask;
    const splitX = Math.round(width * clamp01(split));
    for (let i = 0, p = 0; i < source.length; i += 4, p += 1) {
      const corrected = applyPreviewCorrection(source[i], source[i + 1], source[i + 2], localState.preview && localState.preview.corrections);
      const alpha = Math.max(0, Math.min(1, blurred[p] || 0));
      const afterR = clampByte(reference[i] * (1 - alpha) + corrected[0] * alpha);
      const afterG = clampByte(reference[i + 1] * (1 - alpha) + corrected[1] * alpha);
      const afterB = clampByte(reference[i + 2] * (1 - alpha) + corrected[2] * alpha);
      const x = p % width;
      const useAfter = x >= splitX;
      display.data[i] = useAfter ? afterR : source[i];
      display.data[i + 1] = useAfter ? afterG : source[i + 1];
      display.data[i + 2] = useAfter ? afterB : source[i + 2];
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
    frame.classList.add("has-preview");
    const splitInput = getById("blendMatchPreviewSplitInput");
    if (splitInput) splitInput.classList.add("is-active");
    return true;
  }

  function renderGpuPreview(split) {
    const renderer = ensurePreviewRenderer();
    const preview = localState.preview;
    if (!renderer || !preview) return false;
    const sourceImage = preview.sourceTextureInput || preview.sourceCanvas || preview.sourceImage;
    const referenceImage = preview.referenceTextureInput || preview.referenceCanvas || preview.referenceImage;
    if (!sourceImage || !referenceImage) return false;
    const width = Math.max(1, Number(preview.width) || Number(sourceImage.width) || 1);
    const height = Math.max(1, Number(preview.height) || Number(sourceImage.height) || 1);
    const colorPlan = getPreviewColorPlan(preview);
    const colorSummary = getPreviewColorSummary(preview);
    try {
      renderer.configure({
        width,
        height,
        sourceImage,
        referenceImage,
        brightness: preview.corrections ? preview.corrections.brightness : 0,
        contrast: preview.corrections ? preview.corrections.contrast : 0,
        saturation: preview.corrections ? preview.corrections.saturation : 0,
        colorBalance: preview.corrections && preview.corrections.colorBalance
          ? [
              Number(preview.corrections.colorBalance.cyanRed) || 0,
              Number(preview.corrections.colorBalance.magentaGreen) || 0,
              Number(preview.corrections.colorBalance.yellowBlue) || 0
            ]
          : [0, 0, 0],
        featherMix: 1,
        featherRadius: localState.settings.featherRadius,
        colorPlan,
        colorSummary,
        colorFallbackMode: isPreviewUsingSimplifiedColorFallback(preview) ? "simplified-corrections" : "plan",
        split
      });
      renderer.render();
      const canvas = getById("blendMatchPreviewCanvas");
      const frame = canvas && canvas.closest(".blend-match-preview-frame");
      if (!canvas || !frame) return false;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      renderer.presentTo(canvas);
      frame.classList.add("has-preview");
      const splitInput = getById("blendMatchPreviewSplitInput");
      if (splitInput) splitInput.classList.add("is-active");
      return true;
    } catch (error) {
      console.warn("[PixelRunner] BlendMatch WebGL preview failed, falling back to CPU:", error);
      disposePreviewRenderer();
      return false;
    }
  }

  function applyPreviewTransform() {
    const canvas = getById("blendMatchPreviewCanvas");
    if (!canvas) return;
    clampPreviewView();
    const view = localState.previewView;
    canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  }

  function clampPreviewView() {
    const canvas = getById("blendMatchPreviewCanvas");
    const frame = getById("blendMatchPreviewFrame") || (canvas && canvas.closest(".blend-match-preview-frame"));
    if (!canvas || !frame) return;
    const view = localState.previewView;
    const scale = Math.max(0.35, Math.min(8, Number(view.scale) || 1));
    view.scale = scale;
    const frameRect = frame.getBoundingClientRect
      ? frame.getBoundingClientRect()
      : { width: 0, height: 0 };
    const viewportWidth = Number(frameRect.width) || 0;
    const viewportHeight = Number(frameRect.height) || 0;
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

  function getPreviewPanBounds() {
    const canvas = getById("blendMatchPreviewCanvas");
    const frame = getById("blendMatchPreviewFrame") || (canvas && canvas.closest(".blend-match-preview-frame"));
    if (!canvas || !frame || !frame.getBoundingClientRect) return { maxX: 0, maxY: 0 };
    const view = localState.previewView;
    const rect = frame.getBoundingClientRect();
    const viewportWidth = Number(rect.width) || 0;
    const viewportHeight = Number(rect.height) || 0;
    const contentWidth = Number(canvas.width) || viewportWidth || 1;
    const contentHeight = Number(canvas.height) || viewportHeight || 1;
    const fitScale = Math.min(viewportWidth / contentWidth || 1, viewportHeight / contentHeight || 1);
    const scale = Math.max(0.35, Math.min(8, Number(view.scale) || 1));
    return {
      maxX: Math.max(0, (contentWidth * fitScale * scale - viewportWidth) / 2),
      maxY: Math.max(0, (contentHeight * fitScale * scale - viewportHeight) / 2)
    };
  }

  function canPanPreview() {
    const bounds = getPreviewPanBounds();
    return bounds.maxX > 0.5 || bounds.maxY > 0.5;
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
    const preview = localState.preview;
    if (!preview || !(preview.sourceImage || preview.sourceCanvas || preview.sourceImageData) || !(preview.referenceImage || preview.referenceCanvas || preview.referenceImageData)) return false;
    const split = getPreviewSplit();
    localState.previewView.split = split;
    const cacheKey = buildPreviewAssetKey(preview, localState.settings);
    const assetKey = buildPreviewAssetsKey(preview);

    if (renderGpuPreview(split)) {
      localState.previewRenderMode = "webgl2";
      applyPreviewTransform();
      return true;
    }

    if (!localState.previewAssets || localState.previewAssets.key !== assetKey) {
      localState.previewAssets = buildPreviewAssets(preview);
    }
    if (!localState.previewAssets) return false;

    if (!localState.previewCache || localState.previewCache.key !== cacheKey) {
      localState.previewCache = buildCpuPreviewCache(preview, localState.settings);
    }
    if (!localState.previewCache) return false;

    const rendered = renderCpuPreviewCache(localState.previewCache, split);
    if (!rendered) {
      setPreviewErrorState("预览失败", "预览画布渲染失败，请刷新重试");
      return false;
    }
    localState.previewRenderMode = localState.previewRenderer ? "webgl2" : "cpu";
    applyPreviewTransform();
    return true;
  }

  function schedulePreviewRender(options = {}) {
    if (!localState.preview) return;
    const immediate = options && options.immediate === true;
    if (localState.previewRenderTimer) {
      window.clearTimeout(localState.previewRenderTimer);
      window.cancelAnimationFrame(localState.previewRenderTimer);
      localState.previewRenderTimer = 0;
    }
    if (immediate) {
      localState.previewRenderTimer = window.requestAnimationFrame(() => {
        localState.previewRenderTimer = 0;
        drawPreviewCanvas();
      });
      return;
    }
    localState.previewRenderTimer = window.setTimeout(() => {
      localState.previewRenderTimer = 0;
      drawPreviewCanvas();
    }, 96);
  }

  function logPreviewLines(lines, level = "info") {
    if (!modules.ui || typeof modules.ui.logToWorkspace !== "function") return;
    (Array.isArray(lines) ? lines : []).forEach((line) => modules.ui.logToWorkspace(line, level));
  }

  function logGpuAlignmentCandidate(candidate, validation, context = "") {
    if (!modules.ui || typeof modules.ui.logToWorkspace !== "function" || !candidate) return;
    const label = context ? `${context}：` : "";
    const validationText = validation || candidate.validation
      ? formatShadowValidation(validation || candidate.validation)
      : "verdict=pending";
    modules.ui.logToWorkspace(
      `[融合校色] ${label}GPU alignment candidate backend=${candidate.backend || "unknown"}，generated=true，diagnosticOnly=true，${validationText}。`,
      validation && validation.verdict === "rejected" ? "warn" : "info"
    );
    modules.ui.logToWorkspace("[融合校色] 本轮 Apply 仍使用 host CPU BlendMatchPlan；GPU candidate 不会写入最终执行 alignment。", "info");
  }

  function mergePreviewPlanHydration(planResult) {
    if (!planResult || !localState.preview) return false;
    if (planResult.previewCacheKey && localState.preview.previewCacheKey && planResult.previewCacheKey !== localState.preview.previewCacheKey) {
      return false;
    }
    const previous = localState.preview;
    localState.preview = {
      ...previous,
      corrections: planResult.corrections || previous.corrections,
      alignment: planResult.alignment || previous.alignment,
      cpuAlignment: planResult.cpuAlignment || planResult.alignment || previous.cpuAlignment || null,
      colorPlan: planResult.colorPlan || previous.colorPlan || null,
      colorSummary: planResult.colorSummary || previous.colorSummary || null,
      planId: planResult.planId || previous.planId || "",
      previewCacheKey: planResult.previewCacheKey || previous.previewCacheKey || "",
      planPending: false,
      planHydrated: true,
      planValidation: planResult.planValidation || previous.planValidation || null
    };
    if (localState.preview.cpuAlignment) {
      localState.alignmentValidationDone = true;
    }
    if (localState.preview.gpuAlignmentCandidate) {
      const validation = validateGpuAlignmentCandidate(
        localState.preview.gpuAlignmentCandidate,
        localState.preview.cpuAlignment || localState.preview.alignment,
        {
          validationMode: localState.preview.gpuAlignmentCandidate.search && localState.preview.gpuAlignmentCandidate.search.shadowValidationMode || "post-cpu-plan"
        }
      );
      attachGpuShadowValidation(localState.preview.gpuAlignmentCandidate, validation);
      localState.preview.gpuAlignmentShadowValidation = validation;
      logGpuAlignmentCandidate(localState.preview.gpuAlignmentCandidate, validation, "CPU plan ready shadow validation");
    }
    setText("blendMatchPreviewMeta", `${buildAlignmentMeta(localState.preview.alignment)} / ${formatColorPlanMeta(localState.preview)}`);
    schedulePreviewRender({ immediate: true });
    updatePreviewControls();
    return true;
  }

  async function hydratePreviewPlanFromHost(sampleResult, startedAt) {
    if (!sampleResult || !sampleResult.previewCacheKey || !modules.runtime.isPluginRuntime()) return;
    localState.previewPlanBusy = true;
    updatePreviewBackgroundOverlay();
    updatePreviewControls();
    try {
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace("[融合校色] CPU BlendMatchPlan 后台补齐开始：复用刚才的 raw sample，不重新采样 Photoshop 像素。", "info");
      }
      const seedWait = await waitForGpuAlignmentSeed(sampleResult.previewCacheKey, GPU_ALIGNMENT_SEED_GRACE_MS);
      const gpuSeed = seedWait && seedWait.seed ? seedWait.seed : null;
      const latestSeed = localState.latestGpuAlignmentSeed;
      const seedKeyMatch = Boolean(gpuSeed) || Boolean(latestSeed && String(latestSeed.previewCacheKey || "") === String(sampleResult.previewCacheKey || ""));
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace(
          `[融合校色] GPU seed hydrate grace：window=${formatPreviewMs(GPU_ALIGNMENT_SEED_GRACE_MS)}，waited=${formatPreviewMs(seedWait && seedWait.waitedMs)}，attached=${gpuSeed ? "true" : "false"}，previewCacheKeyMatch=${seedKeyMatch ? "true" : "false"}，timedOut=${seedWait && seedWait.timedOut ? "true" : "false"}。`,
          gpuSeed ? "info" : "warn"
        );
      }
      if (gpuSeed && localState.preview && localState.preview.previewCacheKey === sampleResult.previewCacheKey) {
        localState.preview = {
          ...localState.preview,
          gpuAlignmentSeedAttached: true,
          gpuAlignmentSeedStatus: "attached"
        };
        updatePreviewBackgroundOverlay();
      }
      const hydratePayload = {
        ...buildPayload({ includePreviewCache: true }),
        previewCacheKey: sampleResult.previewCacheKey,
        action: "blendMatchPreviewPlan",
        seedTrust: "hint-only"
      };
      if (gpuSeed) {
        hydratePayload.gpuAlignmentSeed = gpuSeed;
        hydratePayload.alignmentSeedCandidates = gpuSeed.search && Array.isArray(gpuSeed.search.topCandidates)
          ? gpuSeed.search.topCandidates
          : [];
      }
      const planResult = await modules.runtime.callHost("photoshop.runToolAction", [{
        ...hydratePayload
      }], { timeoutMs: 45000 });
      logPreviewLines(planResult && planResult.logs, "info");
      const merged = mergePreviewPlanHydration(planResult);
      if (merged) setPreviewReadyState("实时预览");
      if (merged && modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace(`[融合校色] CPU plan 已补齐：planId=${planResult && planResult.planId || "无"}，从打开面板到 plan ready ${formatPreviewMs(getPreviewNowMs() - startedAt)}；Apply 将复用 cached plan。`, "info");
      }
    } catch (error) {
      const message = error && error.message ? error.message : "CPU plan 后台补齐失败";
      if (localState.preview) {
        localState.preview.planPending = false;
        localState.preview.planHydrationError = message;
      }
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace(`[融合校色] CPU plan 后台补齐失败：${message}。Apply 会优先复用预览 raw sample cache 补建 CPU plan，必要时才重新采样。`, "warn");
      }
    } finally {
      localState.previewPlanBusy = false;
      updatePreviewBackgroundOverlay();
      updatePreviewControls();
    }
  }

  async function runPreviewGpuDiagnostic({ engine, sourceSample, referenceSample, sampleResult, validationMode, startedAt, decodeMs = 0, correctionsMs = 0 }) {
    if (!engine || !sourceSample || !referenceSample || !sampleResult) return;
    localState.previewGpuDiagnosticBusy = true;
    updatePreviewBackgroundOverlay();
    try {
      await waitForPreviewPaint();
      const gpuStartedAt = getPreviewNowMs();
      const gpuAlignment = engine.estimateGradientAlignmentGpu(sourceSample, referenceSample, {
        ...(sampleResult.config || localState.settings),
        previewFastAlignment: true
      });
      const gpuDoneAt = getPreviewNowMs();
      if (!isGpuAlignmentUsable(gpuAlignment)) {
        if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
          modules.ui.logToWorkspace(`[融合校色] GPU candidate 未生成：${gpuAlignment && gpuAlignment.reason || "gpu-unusable"}；快速预览和 CPU plan 不受影响。`, "warn");
        }
        return;
      }
      const candidate = normalizeGpuAlignmentCandidate(gpuAlignment, {
        validationMode
      });
      const currentPreview = localState.preview;
      const samePreview = currentPreview && currentPreview.previewCacheKey === sampleResult.previewCacheKey;
      const cpuBaseline = samePreview
        ? currentPreview.cpuAlignment || currentPreview.alignment
        : sampleResult.cpuAlignment || sampleResult.alignment;
      const validation = validateGpuAlignmentCandidate(candidate, cpuBaseline, {
        validationMode
      });
      attachGpuShadowValidation(candidate, validation);
      if (samePreview) {
        localState.preview = {
          ...currentPreview,
          gpuPreviewAlignment: gpuAlignment,
          gpuAlignmentCandidate: candidate,
          gpuAlignmentShadowValidation: validation
        };
      }
      const seed = saveLatestGpuAlignmentSeed(candidate, sampleResult, validation, {
        totalFromPreviewStartMs: gpuDoneAt - startedAt
      });
      if (samePreview && seed && localState.preview && localState.preview.previewCacheKey === sampleResult.previewCacheKey) {
        localState.preview = {
          ...localState.preview,
          gpuAlignmentSeed: seed,
          gpuAlignmentSeedStatus: "ready"
        };
      }
      logGpuAlignmentCandidate(candidate, validation, "WebGL2 background shadow validation");
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        if (validation.verdict !== "acceptable") {
          modules.ui.logToWorkspace(`[融合校色] GPU candidate ${validation.verdict} 仅记录诊断；预览已显示，最终 Apply 仍等待/使用 host CPU plan。`, validation.verdict === "rejected" ? "warn" : "info");
        }
        const timings = gpuAlignment.timings || {};
        const search = gpuAlignment.search || {};
        const globalValidation = search.globalValidation || null;
        const stages = Array.isArray(search.stages)
          ? search.stages.map((stage) => stage.name || stage).join(" -> ")
          : Array.isArray(search.gpuStages) ? search.gpuStages.join(" -> ") : "sobel-magnitude -> global-translation-scale-search";
        modules.ui.logToWorkspace(`[融合校色] WebGL2 后台对齐 candidate：backend=${candidate.backend}，stages=${stages}；缺失 affine-refine/non-uniform-scale/rotation/local-mesh 完整验证。`, "info");
        if (globalValidation) {
          modules.ui.logToWorkspace(`[融合校色] GPU validation ready total：${formatPreviewMs(gpuDoneAt - startedAt)}，score=${Number(globalValidation.score || 0).toFixed(4)}，scoreGap=${Number(globalValidation.scoreGap || 0).toFixed(4)}，sampleCount=${globalValidation.sampleCount || 0}，topK=${Array.isArray(globalValidation.topK) ? globalValidation.topK.length : 0}，readback=${globalValidation.scoreReadback || "compact-summary"}。`, "info");
        }
        modules.ui.logToWorkspace(`[融合校色] WebGL2 后台对齐耗时：raw 解码 ${formatPreviewMs(decodeMs)} / corrections ${formatPreviewMs(correctionsMs)} / GPU 初始化 ${formatPreviewMs(timings.init || 0)} / 上传 ${formatPreviewMs(timings.upload || 0)} / Sobel ${formatPreviewMs(timings.sobel || 0)} / global search ${formatPreviewMs(timings.globalSearch || 0)} / GPU 总计 ${formatPreviewMs(gpuDoneAt - gpuStartedAt)} / 从打开面板到 GPU ready ${formatPreviewMs(gpuDoneAt - startedAt)}。`, "info");
      }
    } catch (error) {
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace(`[融合校色] GPU 后台诊断失败：${error && error.message ? error.message : "unknown"}；快速预览和 CPU plan 不受影响。`, "warn");
      }
    } finally {
      localState.previewGpuDiagnosticBusy = false;
      updatePreviewBackgroundOverlay();
    }
  }

  function buildAlignmentMeta(alignment) {
    const localMeta = alignment && alignment.local && alignment.local.enabled
      ? ` / 网格 ${alignment.local.validTiles || 0}/${alignment.local.totalTiles || 0}${alignment.localDeformation ? " 已启用" : " 已跳过"}`
      : "";
    if (alignment && alignment.applied) {
      const prefix = alignment.gpu ? "GPU v1 / " : "";
      return `${prefix}左融合前 / 右融合后 / dx ${alignment.dx}px / dy ${alignment.dy}px / X ${Number(alignment.scaleXPercent || alignment.scalePercent || 100).toFixed(2)}% / Y ${Number(alignment.scaleYPercent || alignment.scalePercent || 100).toFixed(2)}% / 旋转 ${Number(alignment.rotation || 0).toFixed(2)}° / 置信 ${Number(alignment.confidence || 0).toFixed(2)}${localMeta}`;
    }
    return `左侧融合前 / 右侧融合后 / 青色边界 / 绿色羽化范围${localMeta}`;
  }

  async function installPreviewResult(result) {
    const rawStartedAt = getPreviewNowMs();
    const rawAssetKey = buildPreviewRawKey(result) || `preview:${++localState.previewAssetSeq}`;
    let sourceImage = null;
    let referenceImage = null;
    let sourceImageData = null;
    let referenceImageData = null;
    let sourceCanvas = null;
    let referenceCanvas = null;
    let sourceTextureInput = null;
    let referenceTextureInput = null;
    let rawCanvasMs = 0;
    if (result && result.sourceSample && result.referenceSample) {
      const sourceAsset = buildCanvasFromSample(result.sourceSample, "source", rawAssetKey);
      const referenceAsset = buildCanvasFromSample(result.referenceSample, "reference", rawAssetKey);
      if (!sourceAsset || !referenceAsset) {
        throw new Error("raw 预览 canvas 构建失败");
      }
      sourceImageData = sourceAsset.imageData;
      referenceImageData = referenceAsset.imageData;
      sourceCanvas = sourceAsset.canvas;
      referenceCanvas = referenceAsset.canvas;
      sourceTextureInput = sourceCanvas;
      referenceTextureInput = referenceCanvas;
      rawCanvasMs = getPreviewNowMs() - rawStartedAt;
    } else {
      const loaded = await Promise.all([
        loadImage(result.sourceDataUrl),
        loadImage(result.referenceDataUrl)
      ]);
      sourceImage = loaded[0];
      referenceImage = loaded[1];
    }
    localState.preview = {
      ...result,
      rawAssetKey,
      sourceImage,
      referenceImage,
      sourceImageData,
      referenceImageData,
      sourceCanvas,
      referenceCanvas,
      sourceTextureInput,
      referenceTextureInput,
      sourceSample: null,
      referenceSample: null,
      rawCanvasMs,
      boundsWidth: result.bounds ? Math.max(1, Number(result.bounds.right) - Number(result.bounds.left)) : result.width,
      boundsHeight: result.bounds ? Math.max(1, Number(result.bounds.bottom) - Number(result.bounds.top)) : result.height
    };
    const colorSummary = getPreviewColorSummary(localState.preview);
    if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
      if (localState.preview.gpuAlignmentCandidate) {
        const candidate = localState.preview.gpuAlignmentCandidate;
        const validation = localState.preview.gpuAlignmentShadowValidation || candidate.validation || null;
        modules.ui.logToWorkspace(
          `[融合校色] 预览 GPU candidate 已挂载为 diagnostic：backend=${candidate.backend || "unknown"}，validation=${validation && validation.verdict || "pending"}，finalApplyEligible=false。`,
          validation && validation.verdict === "rejected" ? "warn" : "info"
        );
      } else {
        modules.ui.logToWorkspace("[融合校色] 预览 GPU candidate：未生成或已回退 CPU-only preview。", "info");
      }
      if (colorSummary) {
        modules.ui.logToWorkspace(`[融合校色] 预览 ColorPlan：method=${colorSummary.method || "unknown"}，profile=${colorSummary.profile ? "yes" : "no"}，renderer=${colorSummary.previewRenderable ? "plan" : colorSummary.previewFallback || "simplified-corrections"}。`, "info");
      } else {
        modules.ui.logToWorkspace("[融合校色] 预览 ColorPlan：host 未返回颜色计划，使用 simplified color fallback。", "warn");
      }
      if (isPreviewUsingSimplifiedColorFallback(localState.preview)) {
        modules.ui.logToWorkspace("[融合校色] 预览颜色仍处于 simplified color fallback；最终 Apply 会优先消费 host ColorPlan。", "info");
      }
    }
    setPreviewLoadingState("正在生成融合预览", "正在绘制融合前后对比");
    setText("blendMatchPreviewMeta", `${buildAlignmentMeta(result.alignment)} / ${formatColorPlanMeta(localState.preview)}`);
    const drawStartedAt = getPreviewNowMs();
    const rendered = drawPreviewCanvas();
    const drawDoneAt = getPreviewNowMs();
    if (rendered) {
      setPreviewReadyState(result && result.planPending ? "快速预览" : "实时预览");
    } else {
      setPreviewErrorState("预览失败", "预览画布渲染失败，请刷新重试");
    }
    if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
      if (result && result.planPending) {
        modules.ui.logToWorkspace(`[融合校色] 快速 preview 已准备：CPU planId 暂无，previewCacheKey=${result.previewCacheKey || "无"}；后台继续补齐可信 CPU BlendMatchPlan。`, "info");
      } else {
        modules.ui.logToWorkspace(`[融合校色] preview planId 准备完成：${result && result.planId || "无"}，previewCacheKey=${result && result.previewCacheKey || "无"}。`, "info");
      }
    }
    updatePreviewControls();
    return {
      rawCanvasMs,
      rawCanvas: Boolean(sourceCanvas && referenceCanvas),
      prepareMs: drawStartedAt - rawStartedAt,
      renderMs: drawDoneAt - drawStartedAt,
      installMs: drawDoneAt - rawStartedAt
    };
  }

  function isGpuAlignmentUsable(alignment) {
    if (!alignment || alignment.gpu !== true) return false;
    if (!Number.isFinite(Number(alignment.score))) return false;
    if (!Number.isFinite(Number(alignment.confidence))) return false;
    if (!alignment.search || !(Number(alignment.search.scoreCalls) > 0)) return false;
    if (Number(alignment.score) <= -0.95) return false;
    return true;
  }

  async function refreshPreviewWithCpu(startedAt, fallbackReason = "", gpuAlignment = null) {
    if (fallbackReason && modules.ui && typeof modules.ui.logToWorkspace === "function") {
      modules.ui.logToWorkspace(`[融合校色] GPU 预览路径回退 CPU：${fallbackReason}。`, "warn");
    }
    setPreviewLoadingState("正在采样图层", "正在采样图层并生成 CPU 融合预览");
    if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
      modules.ui.logToWorkspace("[融合校色] preview host call 开始：blendMatchPreview。", "info");
    }
    await waitForPreviewPaint();
    const result = await modules.runtime.callHost("photoshop.runToolAction", [{
      ...buildPayload(),
      action: "blendMatchPreview"
    }], { timeoutMs: 45000 });
    const hostDoneAt = getPreviewNowMs();
    setPreviewLoadingState("正在解码预览", "正在载入预览图像");
    if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
      modules.ui.logToWorkspace(`[融合校色] preview host call 结束：blendMatchPreview，耗时 ${formatPreviewMs(hostDoneAt - startedAt)}。`, "info");
    }
    logPreviewLines(result && result.logs, "info");
    if (gpuAlignment && result && result.alignment) {
      const candidate = normalizeGpuAlignmentCandidate(gpuAlignment, {
        validationMode: "cpu-fallback-preview"
      });
      const validation = validateGpuAlignmentCandidate(candidate, result.alignment, {
        validationMode: "cpu-fallback-preview"
      });
      attachGpuShadowValidation(candidate, validation);
      result.gpuAlignmentCandidate = candidate;
      result.gpuAlignmentShadowValidation = validation;
      logGpuAlignmentCandidate(candidate, validation, "CPU fallback preview shadow validation");
    }
    const installSummary = await installPreviewResult(result);
    const drawDoneAt = getPreviewNowMs();
    if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
      modules.ui.logToWorkspace(`[融合校色] 预览前端耗时：host ${formatPreviewMs(hostDoneAt - startedAt)} / 图片加载+canvas ${formatPreviewMs(installSummary ? installSummary.prepareMs : drawDoneAt - hostDoneAt)} / canvas render ${formatPreviewMs(installSummary ? installSummary.renderMs : 0)} / 总计 ${formatPreviewMs(drawDoneAt - startedAt)}。`, "info");
    }
  }

  async function useSampleCpuBaselinePreview(sampleResult, startedAt, fallbackReason, gpuAlignment = null) {
    if (!sampleResult || !sampleResult.cpuAlignment) return false;
    if (fallbackReason && modules.ui && typeof modules.ui.logToWorkspace === "function") {
      modules.ui.logToWorkspace(`[融合校色] GPU 预览路径使用 CPU 基准结果：${fallbackReason}。`, "warn");
    }
    setPreviewLoadingState("正在生成融合预览", "正在使用 CPU 基准 plan 绘制融合预览");
    const baselineResult = {
      ...sampleResult,
      alignment: sampleResult.cpuAlignment,
      cpuAlignment: null
    };
    if (gpuAlignment) {
      const candidate = normalizeGpuAlignmentCandidate(gpuAlignment, {
        validationMode: "sample-cpu-baseline"
      });
      const validation = validateGpuAlignmentCandidate(candidate, sampleResult.cpuAlignment, {
        validationMode: "sample-cpu-baseline"
      });
      attachGpuShadowValidation(candidate, validation);
      baselineResult.gpuAlignmentCandidate = candidate;
      baselineResult.gpuAlignmentShadowValidation = validation;
      logGpuAlignmentCandidate(candidate, validation, "sample CPU baseline shadow validation");
    }
    const installStartedAt = getPreviewNowMs();
    const installSummary = await installPreviewResult(baselineResult);
    if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
      modules.ui.logToWorkspace(`[融合校色] 预览前端耗时：host采样+CPU基准 ${formatPreviewMs(installStartedAt - startedAt)} / raw->canvas ${formatPreviewMs(installSummary ? installSummary.rawCanvasMs : 0)} / canvas render ${formatPreviewMs(installSummary ? installSummary.renderMs : 0)} / 未二次调用 CPU 预览。`, "info");
    }
    return true;
  }

  async function refreshPreview() {
    if (localState.previewBusy || !modules.runtime.isPluginRuntime()) return;
    localState.previewBusy = true;
    localState.latestGpuAlignmentSeed = null;
    resolveGpuAlignmentSeedWaiters(null);
    setPreviewLoadingState("正在采样图层", "正在采样当前图层并生成融合预览");
    const startedAt = getPreviewNowMs();
    try {
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace("[融合校色] 预览准备已开始：等待 UI 绘制采样状态后调用 Photoshop。", "info");
      }
      await waitForPreviewPaint();
      const shouldRunGpuDiagnostic = Boolean(localState.settings.alignmentEnabled);
      const requestCpuBaseline = shouldRequestCpuAlignmentBaseline();
      const validationMode = getGpuAlignmentValidationMode();
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace(`[融合校色] 快速预览路径：host 先返回 raw sample，CPU plan 后台补齐；GPU v1 仅用于诊断/对比，validation=${validationMode || "once"}。`, "info");
        modules.ui.logToWorkspace("[融合校色] preview host call 开始：blendMatchPreviewSamples。", "info");
      }
      setPreviewLoadingState("正在采样图层", "正在从 Photoshop 采样 source/reference raw 图层");
      const sampleResult = await modules.runtime.callHost("photoshop.runToolAction", [{
        ...buildPayload(),
        gpuAlignmentValidation: requestCpuBaseline,
        previewDeferCpuPlan: true,
        action: "blendMatchPreviewSamples"
      }], { timeoutMs: 45000 });
      const hostDoneAt = getPreviewNowMs();
      setPreviewLoadingState("正在解码采样", "正在解码 raw 采样数据");
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace(`[融合校色] preview host call 结束：blendMatchPreviewSamples，耗时 ${formatPreviewMs(hostDoneAt - startedAt)}。`, "info");
      }
      logPreviewLines(sampleResult && sampleResult.logs, "info");
      if (sampleResult && sampleResult.cpuAlignment) localState.alignmentValidationDone = true;
      const decodeStartedAt = getPreviewNowMs();
      const sourceSample = decodePreviewSample(sampleResult && sampleResult.sourceSample);
      const referenceSample = decodePreviewSample(sampleResult && sampleResult.referenceSample);
      const decodeDoneAt = getPreviewNowMs();
      if (!sourceSample || !referenceSample) {
        await refreshPreviewWithCpu(startedAt, "raw 采样解码失败");
        return;
      }
      const transferredBytes = Number(sourceSample.byteLength || 0) + Number(referenceSample.byteLength || 0);
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace(`[融合校色] bridge transfer + decode：raw payload ${transferredBytes} bytes，source decode ${formatPreviewMs(sourceSample.decodeMs)} / reference decode ${formatPreviewMs(referenceSample.decodeMs)} / 前端 decode 总计 ${formatPreviewMs(decodeDoneAt - decodeStartedAt)}。`, "info");
      }
      sampleResult.sourceSample = sourceSample;
      sampleResult.referenceSample = referenceSample;
      setPreviewLoadingState("正在分析颜色", "正在准备融合颜色参数");
      const correctionsStartedAt = getPreviewNowMs();
      if (!sampleResult.corrections) {
        sampleResult.corrections = buildCorrectionsFromStats(sourceSample.stats, referenceSample.stats, sampleResult.config || localState.settings);
      }
      const correctionsDoneAt = getPreviewNowMs();
      sampleResult.alignment = sampleResult.cpuAlignment || sampleResult.alignment;
      setPreviewLoadingState("正在生成融合预览", "正在生成融合前后对比");
      const installSummary = await installPreviewResult(sampleResult);
      const drawDoneAt = getPreviewNowMs();
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace(`[融合校色] 快速预览已显示：planPending=${sampleResult.planPending ? "true" : "false"}，CPU plan 和 GPU 诊断转入后台；GPU candidate 不作为最终应用依据。`, "info");
        modules.ui.logToWorkspace(`[融合校色] quick preview render：corrections ${formatPreviewMs(correctionsDoneAt - correctionsStartedAt)} / raw->canvas ${formatPreviewMs(installSummary ? installSummary.rawCanvasMs : 0)} / canvas render ${formatPreviewMs(installSummary ? installSummary.renderMs : drawDoneAt - correctionsDoneAt)} / render install ${formatPreviewMs(installSummary ? installSummary.installMs : drawDoneAt - correctionsDoneAt)}。`, "info");
        modules.ui.logToWorkspace(`[融合校色] first preview visible total：host raw capture+encode+bridge ${formatPreviewMs(hostDoneAt - startedAt)} / front decode ${formatPreviewMs(decodeDoneAt - decodeStartedAt)} / quick render ${formatPreviewMs(drawDoneAt - correctionsStartedAt)} / total ${formatPreviewMs(drawDoneAt - startedAt)}。`, "info");
      }
      void hydratePreviewPlanFromHost(sampleResult, startedAt);
      if (shouldRunGpuDiagnostic) {
        const engine = ensureAlignmentEngine();
        if (engine) {
          if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
            modules.ui.logToWorkspace("[融合校色] GPU diagnostic 已在首屏预览显示后启动，不阻塞 raw preview。", "info");
          }
          void runPreviewGpuDiagnostic({
            engine,
            sourceSample,
            referenceSample,
            sampleResult,
            validationMode,
            startedAt,
            decodeMs: decodeDoneAt - decodeStartedAt,
            correctionsMs: correctionsDoneAt - correctionsStartedAt
          });
        } else if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
          modules.ui.logToWorkspace(`[融合校色] GPU candidate 未启动：${localState.alignmentGpuUnavailableReason || "WebGL2 对齐不可用"}；快速预览和 CPU plan 后台补齐继续。`, "warn");
        }
      }
    } catch (error) {
      const message = error && error.message ? error.message : "预览刷新失败";
      try {
        await refreshPreviewWithCpu(startedAt, `GPU 预览路径失败：${message}`);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError && fallbackError.message ? fallbackError.message : message;
        setPreviewErrorState(is16BitErrorMessage(fallbackMessage) ? "不支持 16 位" : "预览失败", fallbackMessage);
        if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
          modules.ui.logToWorkspace(`[融合校色] 预览失败：${fallbackMessage}。前端等待 ${formatPreviewMs(getPreviewNowMs() - startedAt)}。`, "warn");
        }
      }
    } finally {
      localState.previewBusy = false;
      updatePreviewControls();
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
      const result = await modules.runtime.callHost("photoshop.runToolAction", [buildPayload({ includePreviewCache: true })], { timeoutMs: 90000 });
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
      const message = error && error.message ? error.message : "执行失败";
      modules.ui.logToWorkspace(`[融合校色] 执行失败：${message}`, "error");
      setText("blendMatchPanelStatus", is16BitErrorMessage(message) ? "当前文档为 16 位，请切换到 8 位后再使用" : `执行失败：${message}`);
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
    if (Object.prototype.hasOwnProperty.call(placementResponse, "blendMatchFusion")) {
      const fusion = placementResponse.blendMatchFusion;
      const logs = Array.isArray(fusion && fusion.logs) ? fusion.logs : [];
      logs.forEach((line) => modules.ui.logToWorkspace(line, "info"));
      const bundledError = String(fusion && fusion.error || "").trim();
      modules.ui.logToWorkspace(
        bundledError
          ? `[融合校色] 自动融合失败，已保留原返图：${bundledError}`
          : (fusion && fusion.message ? fusion.message : "[融合校色] 自动融合完成。"),
        bundledError || (fusion && fusion.skipped) ? "warn" : "success"
      );
      return fusion;
    }
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
        schedulePreviewRender({ immediate: true });
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
        if (event.target && typeof event.target.closest === "function" && event.target.closest(".blend-match-preview-tools, .blend-match-preview-split")) return;
        if (!canPanPreview()) return;
        event.preventDefault();
        if (typeof previewFrame.setPointerCapture === "function" && event.pointerId != null) {
          try {
            previewFrame.setPointerCapture(event.pointerId);
          } catch (_) {}
        }
        localState.previewView.isPanning = true;
        localState.previewView.pointerId = event.pointerId;
        localState.previewView.startX = event.clientX;
        localState.previewView.startY = event.clientY;
        localState.previewView.startPanX = localState.previewView.x;
        localState.previewView.startPanY = localState.previewView.y;
        previewFrame.classList.add("is-panning");
      });

      const movePan = (event) => {
        if (!localState.previewView.isPanning) return;
        if (localState.previewView.pointerId != null && event.pointerId != null && event.pointerId !== localState.previewView.pointerId) return;
        event.preventDefault();
        localState.previewView.x = localState.previewView.startPanX + event.clientX - localState.previewView.startX;
        localState.previewView.y = localState.previewView.startPanY + event.clientY - localState.previewView.startY;
        applyPreviewTransform();
      };

      const endPan = (event) => {
        if (!localState.previewView.isPanning) return;
        if (localState.previewView.pointerId != null && event.pointerId != null && event.pointerId !== localState.previewView.pointerId) return;
        event.preventDefault();
        if (typeof previewFrame.releasePointerCapture === "function" && event.pointerId != null) {
          try {
            previewFrame.releasePointerCapture(event.pointerId);
          } catch (_) {}
        }
        localState.previewView.isPanning = false;
        localState.previewView.pointerId = null;
        previewFrame.classList.remove("is-panning");
        applyPreviewTransform();
      };
      previewFrame.addEventListener("pointermove", movePan, { passive: false });
      previewFrame.addEventListener("pointerup", endPan, { passive: false });
      previewFrame.addEventListener("pointercancel", endPan, { passive: false });
      window.addEventListener("pointermove", movePan, { passive: false });
      window.addEventListener("pointerup", endPan, { passive: false });
      window.addEventListener("pointercancel", endPan, { passive: false });
      window.addEventListener("blur", () => {
        localState.previewView.isPanning = false;
        localState.previewView.pointerId = null;
        previewFrame.classList.remove("is-panning");
      });
      previewFrame.addEventListener("dblclick", (event) => {
        if (event.target && typeof event.target.closest === "function" && event.target.closest(".blend-match-preview-tools, .blend-match-preview-split")) return;
        resetPreviewTransform();
      });
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
