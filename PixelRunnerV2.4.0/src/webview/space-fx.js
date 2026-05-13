(function initSpaceFxModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const PREVIEW_MAX_DIMENSION = 1200;
  const CAPTURE_MAX_DIMENSION = 2200;
  const PREVIEW_DEBOUNCE_MS = 90;

  const PRESETS = {
    heat: {
      label: "热浪",
      intensity: 34,
      range: 62,
      feather: 54,
      angle: 90,
      detail: 58,
      glow: 12
    },
    airflow: {
      label: "气流",
      intensity: 42,
      range: 68,
      feather: 48,
      angle: 0,
      detail: 70,
      glow: 26
    },
    slash: {
      label: "刀光",
      intensity: 56,
      range: 72,
      feather: 38,
      angle: -24,
      detail: 54,
      glow: 56
    }
  };

  const state = {
    captured: null,
    sourceImage: null,
    preset: "heat",
    params: { effect: "heat", ...PRESETS.heat },
    previewTimer: 0,
    previewBusy: false,
    pendingPreview: false,
    lastResultDataUrl: "",
    lastMapDataUrl: "",
    lastRender: null,
    centerX: 0.5,
    centerY: 0.5,
    hasContent: false,
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
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function smoothstep(edge0, edge1, value) {
    const x = clamp((value - edge0) / Math.max(0.00001, edge1 - edge0), 0, 1, 0);
    return x * x * (3 - 2 * x);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function hash2(x, y) {
    const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return value - Math.floor(value);
  }

  function valueNoise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi);
    const b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1);
    const d = hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  function fbm(x, y) {
    let sum = 0;
    let amp = 0.52;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < 4; i += 1) {
      sum += valueNoise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.08;
    }
    return norm > 0 ? sum / norm : 0;
  }

  function setStatus(message, type = "info") {
    modules.runtime.setSummaryStatus(getById("spaceFxHint"), message, type);
  }

  function setQuickStatus(message, type = "info") {
    modules.runtime.setSummaryStatus(getById("spaceFxQuickHint"), message, type);
  }

  function setMeta(message) {
    const meta = getById("spaceFxPreviewMeta");
    if (meta) meta.textContent = String(message || "");
  }

  function getPresetLabel(effect) {
    return (PRESETS[effect] && PRESETS[effect].label) || PRESETS.heat.label;
  }

  function updateBadges() {
    const label = getPresetLabel(state.params.effect);
    const presetBadge = getById("spaceFxPresetBadge");
    const stateBadge = getById("spaceFxStateBadge");
    const typeBadge = getById("spaceFxTypeBadge");
    const intensityBadge = getById("spaceFxIntensityBadge");
    const glowBadge = getById("spaceFxGlowBadge");
    if (presetBadge) presetBadge.textContent = label;
    if (stateBadge) stateBadge.textContent = state.captured ? "实时预览" : "等待捕获";
    if (typeBadge) typeBadge.textContent = label;
    if (intensityBadge) intensityBadge.textContent = `强度 ${state.params.intensity}%`;
    if (glowBadge) glowBadge.textContent = `光效 ${state.params.glow}%`;
  }

  function syncControls() {
    const pairs = [
      ["spaceFxIntensity", "intensity"],
      ["spaceFxRange", "range"],
      ["spaceFxFeather", "feather"],
      ["spaceFxAngle", "angle"],
      ["spaceFxDetail", "detail"],
      ["spaceFxGlow", "glow"]
    ];
    pairs.forEach(([prefix, key]) => {
      const input = getById(`${prefix}Input`);
      const value = getById(`${prefix}Value`);
      if (input) input.value = String(state.params[key]);
      if (value) value.textContent = key === "angle" ? `${state.params[key]}°` : String(state.params[key]);
    });
    document.querySelectorAll("[data-space-fx-preset]").forEach((button) => {
      button.classList.toggle("is-selected", button.getAttribute("data-space-fx-preset") === state.params.effect);
    });
    updateBadges();
    updateControlOverlay();
  }

  function readControls() {
    state.params = {
      ...state.params,
      intensity: clamp(getById("spaceFxIntensityInput")?.value, 0, 100, state.params.intensity),
      range: clamp(getById("spaceFxRangeInput")?.value, 10, 100, state.params.range),
      feather: clamp(getById("spaceFxFeatherInput")?.value, 0, 100, state.params.feather),
      angle: clamp(getById("spaceFxAngleInput")?.value, -180, 180, state.params.angle),
      detail: clamp(getById("spaceFxDetailInput")?.value, 0, 100, state.params.detail),
      glow: clamp(getById("spaceFxGlowInput")?.value, 0, 100, state.params.glow)
    };
    syncControls();
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("空间特效读取图像失败"));
      image.src = dataUrl;
    });
  }

  function getScaledSize(width, height, maxDimension) {
    const sourceWidth = Math.max(1, Number(width) || 1);
    const sourceHeight = Math.max(1, Number(height) || 1);
    const maxEdge = Math.max(sourceWidth, sourceHeight);
    if (maxEdge <= maxDimension) return { width: sourceWidth, height: sourceHeight };
    const scale = maxDimension / maxEdge;
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale))
    };
  }

  function drawImageToImageData(image, maxDimension) {
    const size = getScaledSize(image.naturalWidth || image.width, image.naturalHeight || image.height, maxDimension);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, size.width, size.height);
    return {
      imageData: ctx.getImageData(0, 0, size.width, size.height),
      width: size.width,
      height: size.height
    };
  }

  function sampleBilinear(data, width, height, x, y, out) {
    const sx = clamp(x, 0, width - 1, 0);
    const sy = clamp(y, 0, height - 1, 0);
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = sx - x0;
    const ty = sy - y0;
    const i00 = (y0 * width + x0) * 4;
    const i10 = (y0 * width + x1) * 4;
    const i01 = (y1 * width + x0) * 4;
    const i11 = (y1 * width + x1) * 4;
    for (let c = 0; c < 4; c += 1) {
      const a = lerp(data[i00 + c], data[i10 + c], tx);
      const b = lerp(data[i01 + c], data[i11 + c], tx);
      out[c] = lerp(a, b, ty);
    }
  }

  function getLocalBasis(params) {
    const angle = Number(params.angle || 0) * Math.PI / 180;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    return {
      dirX,
      dirY,
      normalX: -dirY,
      normalY: dirX
    };
  }

  function ellipticalMask(along, across, length, width, feather) {
    const l = Math.abs(along) / Math.max(1, length);
    const a = Math.abs(across) / Math.max(1, width);
    const d = Math.sqrt(l * l + a * a);
    const softness = 0.12 + feather * 0.34;
    return 1 - smoothstep(1 - softness, 1, d);
  }

  function boxMask(along, across, length, width, feather) {
    const l = Math.abs(along) / Math.max(1, length);
    const a = Math.abs(across) / Math.max(1, width);
    const softness = 0.08 + feather * 0.42;
    return (1 - smoothstep(1 - softness, 1, l)) * (1 - smoothstep(1 - softness, 1, a));
  }

  function getDisplacement(x, y, width, height, params) {
    const basis = getLocalBasis(params);
    const maxSide = Math.max(width, height);
    const cx = state.centerX * width;
    const cy = state.centerY * height;
    const rx = x - cx;
    const ry = y - cy;
    const along = rx * basis.dirX + ry * basis.dirY;
    const across = rx * basis.normalX + ry * basis.normalY;
    const intensity = clamp(params.intensity, 0, 100, 34) / 100;
    const range = clamp(params.range, 10, 100, 62) / 100;
    const feather = clamp(params.feather, 0, 100, 48) / 100;
    const detail = clamp(params.detail, 0, 100, 58) / 100;
    const glow = clamp(params.glow, 0, 100, 12) / 100;
    const strengthPx = maxSide * (0.004 + intensity * 0.038);
    const effect = String(params.effect || "heat");

    if (effect === "airflow") {
      const length = maxSide * (0.24 + range * 0.62);
      const flowWidth = maxSide * (0.055 + range * 0.2);
      const mask = boxMask(along, across, length, flowWidth, feather);
      const scale = 0.006 + detail * 0.018;
      const stream = Math.sin(across * (0.035 + detail * 0.055) + fbm(along * scale, across * scale * 0.22) * 8);
      const streak = Math.pow(Math.max(0, 0.5 + stream * 0.5), 2.2);
      const turbulence = (fbm(along * scale * 0.55 + 11.2, across * scale + 3.3) - 0.5) * 2;
      const taper = 1 - smoothstep(0.62, 1, Math.abs(along) / Math.max(1, length));
      const normalPush = (stream * 0.72 + turbulence * 0.5) * strengthPx * mask * taper;
      const drag = (0.35 + streak * 0.5) * strengthPx * mask * 0.42;
      return {
        dx: basis.normalX * normalPush - basis.dirX * drag,
        dy: basis.normalY * normalPush - basis.dirY * drag,
        mask,
        light: streak * mask * glow,
        line: streak * mask
      };
    }

    if (effect === "slash") {
      const length = maxSide * (0.18 + range * 0.58);
      const slashWidth = maxSide * (0.018 + detail * 0.07);
      const curve = Math.sin((along / Math.max(1, length)) * Math.PI) * maxSide * (detail - 0.45) * 0.045;
      const curvedAcross = across - curve;
      const mask = boxMask(along, curvedAcross, length, slashWidth * 2.8, feather);
      const core = (1 - smoothstep(0.08, 1, Math.abs(curvedAcross) / Math.max(1, slashWidth))) *
        (1 - smoothstep(0.72, 1, Math.abs(along) / Math.max(1, length)));
      const edge = (1 - smoothstep(0.2, 1, Math.abs(curvedAcross) / Math.max(1, slashWidth * 2.6))) * mask;
      const sign = curvedAcross >= 0 ? 1 : -1;
      const texture = (fbm(x * 0.018 + 4.7, y * 0.018 - 2.1) - 0.5) * 2;
      const push = sign * strengthPx * (0.45 + edge * 0.72 + texture * 0.16) * mask;
      const drag = strengthPx * core * 0.18;
      return {
        dx: basis.normalX * push - basis.dirX * drag,
        dy: basis.normalY * push - basis.dirY * drag,
        mask,
        light: (core * 1.15 + edge * 0.35) * glow,
        line: core
      };
    }

    const length = maxSide * (0.22 + range * 0.54);
    const heatWidth = maxSide * (0.12 + range * 0.28);
    const mask = ellipticalMask(along, across, length, heatWidth, feather);
    const verticalScale = 0.006 + detail * 0.024;
    const shimmer = Math.sin(along * (0.035 + detail * 0.04) + fbm(x * verticalScale, y * verticalScale * 0.45) * 6);
    const roll = (fbm(x * verticalScale * 0.72 + 8.5, y * verticalScale * 1.6) - 0.5) * 2;
    const lift = 1 - smoothstep(0.82, 1, Math.abs(along) / Math.max(1, length));
    const push = (shimmer * 0.7 + roll * 0.62) * strengthPx * mask * lift;
    return {
      dx: basis.normalX * push,
      dy: basis.normalY * push * 0.18 - basis.dirY * Math.abs(roll) * strengthPx * mask * 0.08,
      mask,
      light: Math.max(0, shimmer) * mask * glow * 0.45,
      line: Math.abs(shimmer) * mask
    };
  }

  function renderSpaceFxImageData(sourceImageData, width, height, params) {
    const startedAt = performance.now();
    const src = sourceImageData.data;
    const out = new ImageData(width, height);
    const map = new ImageData(width, height);
    const dst = out.data;
    const mapData = map.data;
    const sample = [0, 0, 0, 0];
    const effect = String(params.effect || "heat");
    const warm = effect === "slash" ? [125, 215, 255] : effect === "airflow" ? [160, 235, 225] : [255, 210, 135];

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const displacement = getDisplacement(x, y, width, height, params);
        sampleBilinear(src, width, height, x + displacement.dx, y + displacement.dy, sample);
        const mask = clamp(displacement.mask, 0, 1, 0);
        const light = clamp(displacement.light, 0, 1.5, 0);
        const line = clamp(displacement.line, 0, 1, 0);
        const baseMix = mask;
        let r = src[index] * (1 - baseMix) + sample[0] * baseMix;
        let g = src[index + 1] * (1 - baseMix) + sample[1] * baseMix;
        let b = src[index + 2] * (1 - baseMix) + sample[2] * baseMix;

        if (effect === "airflow") {
          const shade = line * mask * 16;
          r = r - shade * 0.35 + warm[0] * light * 0.32;
          g = g - shade * 0.2 + warm[1] * light * 0.32;
          b = b + warm[2] * light * 0.34;
        } else if (effect === "slash") {
          const coreBoost = light * 1.25;
          r += warm[0] * coreBoost * 0.48;
          g += warm[1] * coreBoost * 0.5;
          b += warm[2] * coreBoost * 0.58;
        } else {
          r += warm[0] * light * 0.18;
          g += warm[1] * light * 0.14;
          b += warm[2] * light * 0.1;
        }

        dst[index] = clamp(r, 0, 255, 0);
        dst[index + 1] = clamp(g, 0, 255, 0);
        dst[index + 2] = clamp(b, 0, 255, 0);
        dst[index + 3] = src[index + 3];

        const mapValue = clamp(128 + displacement.dx * 1.15 + displacement.dy * 0.55, 0, 255, 128);
        const maskValue = clamp(28 + mask * 190 + line * 35, 0, 255, 0);
        mapData[index] = mapValue;
        mapData[index + 1] = maskValue;
        mapData[index + 2] = clamp(128 - displacement.dx * 0.6 + displacement.dy * 0.95, 0, 255, 128);
        mapData[index + 3] = 255;
      }
    }

    return {
      imageData: out,
      mapImageData: map,
      elapsedMs: Math.round(performance.now() - startedAt)
    };
  }

  function imageDataToDataUrl(imageData) {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext("2d");
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  }

  function renderToCanvas(image, canvas, maxDimension, params) {
    const source = drawImageToImageData(image, maxDimension);
    const result = renderSpaceFxImageData(source.imageData, source.width, source.height, params);
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d");
    ctx.putImageData(result.imageData, 0, 0);
    return {
      width: source.width,
      height: source.height,
      elapsedMs: result.elapsedMs,
      dataUrl: canvas.toDataURL("image/png"),
      mapDataUrl: imageDataToDataUrl(result.mapImageData)
    };
  }

  function getFullDocumentBounds(captured, fallbackWidth = 1, fallbackHeight = 1) {
    const doc = captured && captured.document;
    const width = Math.max(1, Number(doc && doc.width) || Number(captured && captured.originalWidth) || fallbackWidth);
    const height = Math.max(1, Number(doc && doc.height) || Number(captured && captured.originalHeight) || fallbackHeight);
    return { left: 0, top: 0, right: width, bottom: height };
  }

  function getContentMetrics() {
    const viewport = getById("spaceFxPreviewViewport");
    const canvas = getById("spaceFxResultCanvas");
    const rect = viewport && viewport.getBoundingClientRect ? viewport.getBoundingClientRect() : { width: 0, height: 0, left: 0, top: 0 };
    const contentWidth = Number(canvas && canvas.width) || Number(state.sourceImage && state.sourceImage.naturalWidth) || rect.width || 1;
    const contentHeight = Number(canvas && canvas.height) || Number(state.sourceImage && state.sourceImage.naturalHeight) || rect.height || 1;
    const scale = Math.max(0.35, Math.min(8, Number(state.view.scale) || 1));
    const fitScale = Math.min(rect.width / contentWidth || 1, rect.height / contentHeight || 1);
    const renderedWidth = contentWidth * fitScale * scale;
    const renderedHeight = contentHeight * fitScale * scale;
    const left = rect.width / 2 - renderedWidth / 2 + state.view.x;
    const top = rect.height / 2 - renderedHeight / 2 + state.view.y;
    return { rect, contentWidth, contentHeight, renderedWidth, renderedHeight, left, top, scale };
  }

  function clampPreviewView() {
    const viewport = getById("spaceFxPreviewViewport");
    if (!viewport) return;
    const metrics = getContentMetrics();
    state.view.scale = metrics.scale;
    const maxX = Math.max(0, (metrics.renderedWidth - metrics.rect.width) / 2);
    const maxY = Math.max(0, (metrics.renderedHeight - metrics.rect.height) / 2);
    state.view.x = clamp(state.view.x, -maxX, maxX, 0);
    state.view.y = clamp(state.view.y, -maxY, maxY, 0);
  }

  function applyPreviewTransform() {
    clampPreviewView();
    const transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`;
    [getById("spaceFxSourceImage"), getById("spaceFxResultCanvas")].filter(Boolean).forEach((element) => {
      element.style.transform = transform;
    });
    updateControlOverlay();
  }

  function resetPreviewTransform() {
    state.view.scale = 1;
    state.view.x = 0;
    state.view.y = 0;
    applyPreviewTransform();
  }

  function zoomPreview(nextScale, anchorX, anchorY) {
    const viewport = getById("spaceFxPreviewViewport");
    if (!viewport) return;
    const previousScale = Math.max(0.35, Number(state.view.scale) || 1);
    const scale = Math.max(0.35, Math.min(8, Number(nextScale) || 1));
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

  function updateControlOverlay() {
    const overlay = getById("spaceFxControlOverlay");
    if (!overlay) return;
    const metrics = getContentMetrics();
    const cx = metrics.left + state.centerX * metrics.renderedWidth;
    const cy = metrics.top + state.centerY * metrics.renderedHeight;
    const angle = Number(state.params.angle || 0);
    const range = clamp(state.params.range, 10, 100, 62) / 100;
    const effect = String(state.params.effect || "heat");
    const line = overlay.querySelector(".space-fx-control-line");
    const center = overlay.querySelector(".space-fx-control-center");
    const rangeEl = overlay.querySelector(".space-fx-control-range");
    if (center) {
      center.style.left = `${cx}px`;
      center.style.top = `${cy}px`;
    }
    if (line) {
      const length = Math.max(80, Math.min(metrics.renderedWidth, metrics.renderedHeight) * (0.22 + range * 0.38));
      line.style.left = `${cx}px`;
      line.style.top = `${cy}px`;
      line.style.width = `${length}px`;
      line.style.transform = `rotate(${angle}deg)`;
    }
    if (rangeEl) {
      const base = Math.min(metrics.renderedWidth, metrics.renderedHeight);
      const width = base * (effect === "slash" ? 0.36 + range * 0.78 : 0.24 + range * 0.56);
      const height = base * (effect === "slash" ? 0.09 + range * 0.18 : effect === "airflow" ? 0.16 + range * 0.26 : 0.28 + range * 0.42);
      rangeEl.style.left = `${cx}px`;
      rangeEl.style.top = `${cy}px`;
      rangeEl.style.width = `${width}px`;
      rangeEl.style.height = `${height}px`;
      rangeEl.style.marginLeft = `${-width / 2}px`;
      rangeEl.style.marginTop = `${-height / 2}px`;
      rangeEl.style.transform = `rotate(${angle}deg)`;
    }
  }

  function setCenterFromPointer(event) {
    const metrics = getContentMetrics();
    const localX = event.clientX - metrics.rect.left - metrics.left;
    const localY = event.clientY - metrics.rect.top - metrics.top;
    state.centerX = clamp(localX / Math.max(1, metrics.renderedWidth), 0, 1, state.centerX);
    state.centerY = clamp(localY / Math.max(1, metrics.renderedHeight), 0, 1, state.centerY);
    updateControlOverlay();
    schedulePreviewUpdate();
  }

  function schedulePreviewUpdate() {
    if (!state.sourceImage) return;
    if (state.previewTimer) clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(() => {
      state.previewTimer = 0;
      void updatePreview();
    }, PREVIEW_DEBOUNCE_MS);
  }

  async function updatePreview() {
    if (!state.sourceImage) return;
    if (state.previewBusy) {
      state.pendingPreview = true;
      return;
    }
    const canvas = getById("spaceFxResultCanvas");
    if (!canvas) return;
    const applyButton = getById("btnSpaceFxApply");
    const mapButton = getById("btnSpaceFxMap");
    if (applyButton) applyButton.disabled = true;
    if (mapButton) mapButton.disabled = true;
    state.previewBusy = true;
    state.pendingPreview = false;
    setMeta("正在生成空间特效预览...");
    try {
      const result = renderToCanvas(state.sourceImage, canvas, PREVIEW_MAX_DIMENSION, state.params);
      state.lastRender = result;
      state.lastResultDataUrl = result.dataUrl;
      state.lastMapDataUrl = result.mapDataUrl;
      state.hasContent = true;
      if (getById("spaceFxInlinePreview")) getById("spaceFxInlinePreview").hidden = false;
      canvas.classList.add("is-active");
      setMeta(`预览 ${result.width}x${result.height} · 本地位移纹理 · ${result.elapsedMs}ms · 中心 ${Math.round(state.centerX * 100)}%/${Math.round(state.centerY * 100)}%`);
      if (applyButton) applyButton.disabled = false;
      if (mapButton) mapButton.disabled = false;
      applyPreviewTransform();
      updateBadges();
    } catch (error) {
      setStatus(`空间特效预览失败：${error.message}`, "error");
      setMeta("预览失败，请降低强度或重新捕获图像。");
    } finally {
      state.previewBusy = false;
      if (state.pendingPreview) schedulePreviewUpdate();
    }
  }

  async function captureSource() {
    if (!modules.runtime.isPluginRuntime()) {
      throw new Error("浏览器预览模式下不可捕获 Photoshop 图像");
    }
    const captured = await modules.runtime.callHost("photoshop.captureDocumentPreview", [{
      maxDimension: CAPTURE_MAX_DIMENSION,
      ignoreSelection: true,
      quality: 92,
      uploadTargetBytes: 18_000_000,
      uploadHardLimitBytes: 24_000_000
    }], { timeoutMs: 60000 });
    if (!captured || !String(captured.dataUrl || "").trim()) {
      throw new Error("Photoshop 未返回可用图像");
    }
    return captured;
  }

  async function recaptureAndPreview() {
    const openButton = getById("btnOpenSpaceFxPanel");
    const recaptureButton = getById("btnSpaceFxRecapture");
    const applyButton = getById("btnSpaceFxApply");
    const mapButton = getById("btnSpaceFxMap");
    [openButton, recaptureButton, applyButton, mapButton].filter(Boolean).forEach((button) => {
      button.disabled = true;
    });
    setStatus("正在捕获当前 Photoshop 图像...", "info");
    setMeta("正在捕获当前图像...");
    try {
      const captured = await captureSource();
      const image = await loadImage(captured.dataUrl);
      state.captured = captured;
      state.sourceImage = image;
      state.lastResultDataUrl = "";
      state.lastMapDataUrl = "";
      state.hasContent = false;
      const sourceImage = getById("spaceFxSourceImage");
      if (sourceImage) sourceImage.src = captured.dataUrl;
      if (getById("spaceFxInlinePreview")) getById("spaceFxInlinePreview").hidden = false;
      resetPreviewTransform();
      setStatus("已捕获当前文档，正在生成空间特效预览。", "success");
      await updatePreview();
    } catch (error) {
      setStatus(`空间特效捕获失败：${error.message}`, "error");
      setMeta("捕获失败，请确认 Photoshop 中存在打开的文档。");
    } finally {
      if (openButton) openButton.disabled = false;
      if (recaptureButton) recaptureButton.disabled = false;
      updateBadges();
    }
  }

  async function openSpaceFxModal() {
    modules.workspace.setModalOpen("spaceFxModal", true);
    syncControls();
    if (!modules.runtime.isPluginRuntime()) {
      setStatus("浏览器预览模式下可查看界面，但不会捕获或写回 Photoshop。", "warn");
      return;
    }
    if (!state.sourceImage) {
      await recaptureAndPreview();
    } else {
      schedulePreviewUpdate();
    }
  }

  function closeSpaceFxModal() {
    modules.workspace.setModalOpen("spaceFxModal", false);
  }

  async function placeDataUrl(dataUrl, layerName, opacity = 100, blendMode = "normal") {
    if (!state.captured) throw new Error("缺少捕获图像信息");
    const bounds = getFullDocumentBounds(state.captured, state.lastRender && state.lastRender.width, state.lastRender && state.lastRender.height);
    return modules.runtime.callHost("photoshop.placeResultFromUrl", [{
      dataUrl,
      targetDocumentId: state.captured.documentId,
      sourceDocumentId: state.captured.documentId,
      targetBounds: bounds,
      fitMode: "stretch",
      preserveCanvasBounds: true,
      anchorTransparentCanvas: true,
      applyMask: false,
      opacity,
      blendMode,
      layerName
    }], { timeoutMs: 120000 });
  }

  async function applySpaceFx() {
    const applyButton = getById("btnSpaceFxApply");
    if (!state.captured || !state.sourceImage) {
      setStatus("请先捕获图像并生成预览。", "warn");
      return;
    }
    if (!modules.runtime.isPluginRuntime()) {
      setStatus("浏览器预览模式下不可写回 Photoshop。", "warn");
      return;
    }
    if (applyButton) applyButton.disabled = true;
    setStatus("正在生成空间特效结果层...", "info");
    setMeta("正在准备写回 Photoshop...");
    try {
      const outputCanvas = document.createElement("canvas");
      const result = renderToCanvas(state.sourceImage, outputCanvas, CAPTURE_MAX_DIMENSION, state.params);
      const label = getPresetLabel(state.params.effect);
      const placed = await placeDataUrl(result.dataUrl, `PixelRunner 空间特效 - ${label}`, 100, "normal");
      setStatus(placed && placed.layerName ? `已生成空间特效结果层：${placed.layerName}` : "已生成空间特效结果层。", "success");
      setMeta(`已应用 ${result.width}x${result.height} · ${result.elapsedMs}ms`);
      modules.ui.logToWorkspace(`空间特效已应用：${label}。`, "success");
    } catch (error) {
      setStatus(`应用空间特效失败：${error.message}`, "error");
      modules.ui.logToWorkspace(`空间特效应用失败：${error.message}`, "error");
    } finally {
      if (applyButton) applyButton.disabled = false;
    }
  }

  async function applyDisplacementMap() {
    const mapButton = getById("btnSpaceFxMap");
    if (!state.captured || !state.sourceImage) {
      setStatus("请先捕获图像并生成预览。", "warn");
      return;
    }
    if (!modules.runtime.isPluginRuntime()) {
      setStatus("浏览器预览模式下不可写回 Photoshop。", "warn");
      return;
    }
    if (mapButton) mapButton.disabled = true;
    setStatus("正在生成置换图层...", "info");
    try {
      let mapDataUrl = state.lastMapDataUrl;
      if (!mapDataUrl) {
        const outputCanvas = document.createElement("canvas");
        const result = renderToCanvas(state.sourceImage, outputCanvas, CAPTURE_MAX_DIMENSION, state.params);
        mapDataUrl = result.mapDataUrl;
      }
      const label = getPresetLabel(state.params.effect);
      const placed = await placeDataUrl(mapDataUrl, `PixelRunner 置换图 - ${label}`, 100, "normal");
      setStatus(placed && placed.layerName ? `已生成置换图层：${placed.layerName}` : "已生成置换图层。", "success");
      modules.ui.logToWorkspace(`空间特效置换图已生成：${label}。`, "success");
    } catch (error) {
      setStatus(`生成置换图失败：${error.message}`, "error");
      modules.ui.logToWorkspace(`生成置换图失败：${error.message}`, "error");
    } finally {
      if (mapButton) mapButton.disabled = false;
    }
  }

  function applyPreset(name) {
    if (!PRESETS[name]) return;
    state.preset = name;
    state.params = { effect: name, ...PRESETS[name] };
    syncControls();
    schedulePreviewUpdate();
  }

  function bindPreviewInteractions() {
    const viewport = getById("spaceFxPreviewViewport");
    if (!viewport) return;
    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1 / 1.18 : 1.18;
      zoomPreview(state.view.scale * factor, event.clientX, event.clientY);
    }, { passive: false });

    viewport.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      if (event.target && event.target.closest(".space-fx-preview-tools")) return;
      event.preventDefault();
      if ((Number(state.view.scale) || 1) > 1.001) {
        state.view.isPanning = true;
        state.view.startX = event.clientX;
        state.view.startY = event.clientY;
        state.view.startPanX = state.view.x;
        state.view.startPanY = state.view.y;
        viewport.classList.add("is-panning");
        return;
      }
      setCenterFromPointer(event);
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
    viewport.addEventListener("dblclick", resetPreviewTransform);
  }

  function bindSpaceFxActions() {
    const openButton = getById("btnOpenSpaceFxPanel");
    const closeButton = getById("spaceFxModalClose");
    const recaptureButton = getById("btnSpaceFxRecapture");
    const applyButton = getById("btnSpaceFxApply");
    const mapButton = getById("btnSpaceFxMap");
    if (openButton) {
      openButton.addEventListener("click", () => {
        void openSpaceFxModal();
      });
    }
    if (closeButton) closeButton.addEventListener("click", closeSpaceFxModal);
    if (recaptureButton) {
      recaptureButton.addEventListener("click", () => {
        void recaptureAndPreview();
      });
    }
    if (applyButton) {
      applyButton.addEventListener("click", () => {
        void applySpaceFx();
      });
    }
    if (mapButton) {
      mapButton.addEventListener("click", () => {
        void applyDisplacementMap();
      });
    }
    document.addEventListener("click", (event) => {
      if (event.target && event.target.closest("#spaceFxBackdrop")) closeSpaceFxModal();
    });
    document.querySelectorAll("[data-space-fx-preset]").forEach((button) => {
      button.addEventListener("click", () => applyPreset(button.getAttribute("data-space-fx-preset")));
    });
    ["Intensity", "Range", "Feather", "Angle", "Detail", "Glow"].forEach((name) => {
      const input = getById(`spaceFx${name}Input`);
      if (!input) return;
      input.addEventListener("input", () => {
        readControls();
        schedulePreviewUpdate();
      });
    });
    document.querySelectorAll("[data-space-fx-zoom]").forEach((button) => {
      button.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = String(button.getAttribute("data-space-fx-zoom") || "");
        if (action === "reset") {
          resetPreviewTransform();
          return;
        }
        const viewport = getById("spaceFxPreviewViewport");
        if (!viewport) return;
        const rect = viewport.getBoundingClientRect();
        const factor = action === "in" ? 1.25 : 1 / 1.25;
        zoomPreview(state.view.scale * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
      });
    });
    bindPreviewInteractions();
    syncControls();
  }

  modules.spaceFx = {
    bindSpaceFxActions,
    renderSpaceFxImageData
  };
})(window);
