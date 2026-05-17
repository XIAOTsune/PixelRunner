(function initSpaceFxModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const PREVIEW_MAX_DIMENSION = 1000;
  const CAPTURE_MAX_DIMENSION = 2200;
  const PREVIEW_DEBOUNCE_MS = 90;
  const DISPLACEMENT_FIELD_MAX_DIMENSION = 420;
  const SPACE_FX_ASSET_BASE = "assets/space-fx/generated/";

  const PRESETS = {
    heat: {
      label: "热浪",
      intensity: 48,
      range: 62,
      feather: 54,
      angle: 90,
      detail: 58,
      glow: 12,
      glowColor: 28,
      glowColorEnabled: true,
      glowColorHex: "#ffd27a",
      brush: 42
    },
    airflow: {
      label: "气流",
      intensity: 34,
      range: 78,
      feather: 76,
      angle: 0,
      detail: 48,
      glow: 38,
      glowColor: 64,
      glowColorEnabled: true,
      glowColorHex: "#9fdcff",
      brush: 78
    },
    slash: {
      label: "刀光",
      intensity: 56,
      range: 72,
      feather: 38,
      angle: -24,
      detail: 54,
      glow: 56,
      glowColor: 64,
      glowColorEnabled: true,
      glowColorHex: "#7ddfff",
      brush: 34
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
    pathPoints: [],
    pathVersion: 0,
    pathCache: null,
    drawMode: false,
    isDrawing: false,
    activePointerId: null,
    hasContent: false,
    smokeAsset: {
      status: "idle",
      promise: null,
      image: null,
      meta: null
    },
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

  function hexToRgb(hex, fallback = [255, 210, 135]) {
    const value = String(hex || "").trim();
    const match = value.match(/^#?([0-9a-f]{6})$/i);
    if (!match) return fallback.slice();
    const intValue = parseInt(match[1], 16);
    return [
      (intValue >> 16) & 255,
      (intValue >> 8) & 255,
      intValue & 255
    ];
  }

  function getGlowColor(params, fallback) {
    const amount = params && params.glowColorEnabled !== false
      ? clamp(params.glowColor, 0, 100, 0) / 100
      : 0;
    const picked = hexToRgb(params && params.glowColorHex, fallback);
    return [
      lerp(fallback[0], picked[0], amount),
      lerp(fallback[1], picked[1], amount),
      lerp(fallback[2], picked[2], amount)
    ];
  }

  function limitDisplacementStrength(strengthPx, widthPx, effect) {
    const cap = effect === "slash" ? widthPx * 0.42 : effect === "airflow" ? widthPx * 0.22 : widthPx * 0.28;
    return Math.min(strengthPx, Math.max(1, cap));
  }

  function getAirflowVeil(progress, signedNorm, texture, detail) {
    const longWave = Math.sin(progress * (8 + detail * 10) + texture * 1.15);
    const strandWave = Math.sin(progress * (18 + detail * 18) + signedNorm * (2.1 + detail * 2.6) + texture * 1.35);
    const softStrand = Math.pow(Math.max(0, 0.5 + strandWave * 0.5), 2.7);
    return {
      drift: longWave * 0.58 + strandWave * 0.22 + texture * 0.2,
      strand: softStrand
    };
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
      ["spaceFxGlow", "glow"],
      ["spaceFxGlowColor", "glowColor"],
      ["spaceFxBrush", "brush"]
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
    const drawButton = getById("btnSpaceFxDraw");
    const clearButton = getById("btnSpaceFxClearPath");
    if (drawButton) {
      drawButton.classList.toggle("is-active", state.drawMode);
      drawButton.setAttribute("aria-pressed", state.drawMode ? "true" : "false");
      drawButton.textContent = state.drawMode ? "正在手绘" : "手绘路径";
    }
    if (clearButton) clearButton.disabled = state.pathPoints.length < 2;
    const colorEnabledInput = getById("spaceFxGlowColorEnabledInput");
    const colorPickerInput = getById("spaceFxGlowColorPickerInput");
    const colorAmountInput = getById("spaceFxGlowColorInput");
    if (colorEnabledInput) colorEnabledInput.checked = state.params.glowColorEnabled !== false;
    if (colorPickerInput) colorPickerInput.value = String(state.params.glowColorHex || "#7ddfff");
    if (colorAmountInput) colorAmountInput.disabled = state.params.glowColorEnabled === false;
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
      glow: clamp(getById("spaceFxGlowInput")?.value, 0, 100, state.params.glow),
      glowColor: clamp(getById("spaceFxGlowColorInput")?.value, 0, 100, state.params.glowColor || 0),
      glowColorEnabled: getById("spaceFxGlowColorEnabledInput") ? Boolean(getById("spaceFxGlowColorEnabledInput").checked) : state.params.glowColorEnabled !== false,
      glowColorHex: getById("spaceFxGlowColorPickerInput")?.value || state.params.glowColorHex || "#7ddfff",
      brush: clamp(getById("spaceFxBrushInput")?.value, 8, 120, state.params.brush)
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

  function loadSmokeAsset() {
    if (state.smokeAsset.status === "ready") return Promise.resolve(state.smokeAsset);
    if (state.smokeAsset.status === "missing") return Promise.resolve(null);
    if (state.smokeAsset.promise) return state.smokeAsset.promise;
    state.smokeAsset.status = "loading";
    state.smokeAsset.promise = Promise.all([
      fetch(`${SPACE_FX_ASSET_BASE}smoke-atlas.json`, { cache: "force-cache" }).then((response) => {
        if (!response.ok) throw new Error(`烟雾素材索引不可用：${response.status}`);
        return response.json();
      }),
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("烟雾素材图集不可用"));
        image.src = `${SPACE_FX_ASSET_BASE}smoke-atlas.png`;
      })
    ]).then(([meta, image]) => {
      state.smokeAsset.meta = meta;
      state.smokeAsset.image = image;
      state.smokeAsset.status = "ready";
      return state.smokeAsset;
    }).catch((error) => {
      state.smokeAsset.status = "missing";
      state.smokeAsset.promise = null;
      console.warn("[PixelRunner] Space FX smoke asset unavailable:", error);
      return null;
    });
    return state.smokeAsset.promise;
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

  function sampleFieldBilinear(field, width, height, x, y, out) {
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
      const a = lerp(field[i00 + c], field[i10 + c], tx);
      const b = lerp(field[i01 + c], field[i11 + c], tx);
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

  function markPathChanged() {
    state.pathVersion += 1;
    state.pathCache = null;
  }

  function catmullPoint(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return {
      x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
    };
  }

  function buildPathCenterline(width, height) {
    const source = state.pathPoints || [];
    if (source.length < 2) return [];
    const maxSide = Math.max(width, height);
    const maxStepPx = Math.max(3, maxSide * 0.0045);
    const line = [];
    for (let i = 0; i < source.length - 1; i += 1) {
      const p0 = source[Math.max(0, i - 1)];
      const p1 = source[i];
      const p2 = source[i + 1];
      const p3 = source[Math.min(source.length - 1, i + 2)];
      const dx = (p2.x - p1.x) * width;
      const dy = (p2.y - p1.y) * height;
      const steps = Math.max(3, Math.ceil(Math.sqrt(dx * dx + dy * dy) / maxStepPx));
      for (let step = 0; step < steps; step += 1) {
        if (i > 0 && step === 0) continue;
        const point = catmullPoint(p0, p1, p2, p3, step / steps);
        line.push({
          x: clamp(point.x, 0, 1, p1.x) * width,
          y: clamp(point.y, 0, 1, p1.y) * height
        });
      }
    }
    const last = source[source.length - 1];
    line.push({ x: last.x * width, y: last.y * height });
    return line;
  }

  function getPathSegments(width, height) {
    if (!state.pathPoints || state.pathPoints.length < 2) return null;
    const cache = state.pathCache;
    if (cache && cache.width === width && cache.height === height && cache.version === state.pathVersion) {
      return cache;
    }
    const centerline = buildPathCenterline(width, height);
    const segments = [];
    let totalLength = 0;
    for (let i = 0; i < centerline.length - 1; i += 1) {
      const a = centerline[i];
      const b = centerline[i + 1];
      const ax = a.x;
      const ay = a.y;
      const bx = b.x;
      const by = b.y;
      const vx = bx - ax;
      const vy = by - ay;
      const lengthSq = vx * vx + vy * vy;
      if (lengthSq < 1) continue;
      const length = Math.sqrt(lengthSq);
      segments.push({
        ax,
        ay,
        bx,
        by,
        vx,
        vy,
        lengthSq,
        length,
        startLength: totalLength,
        index: i
      });
      totalLength += length;
    }
    state.pathCache = {
      width,
      height,
      version: state.pathVersion,
      segments,
      totalLength: Math.max(1, totalLength)
    };
    return state.pathCache;
  }

  function getPathInfo(x, y, width, height) {
    if (!state.pathPoints || state.pathPoints.length < 2) return null;
    const path = getPathSegments(width, height);
    if (!path || !path.segments.length) return null;
    let best = null;
    for (let i = 0; i < path.segments.length; i += 1) {
      const segment = path.segments[i];
      const t = clamp(((x - segment.ax) * segment.vx + (y - segment.ay) * segment.vy) / segment.lengthSq, 0, 1, 0);
      const px = segment.ax + segment.vx * t;
      const py = segment.ay + segment.vy * t;
      const dx = x - px;
      const dy = y - py;
      const distSq = dx * dx + dy * dy;
      if (!best || distSq < best.distSq) {
        const prev = path.segments[Math.max(0, i - 1)] || segment;
        const next = path.segments[Math.min(path.segments.length - 1, i + 1)] || segment;
        const blendPrev = 1 - smoothstep(0.12, 0.52, t);
        const blendNext = smoothstep(0.48, 0.88, t);
        let dirX = segment.vx / segment.length;
        let dirY = segment.vy / segment.length;
        dirX += (prev.vx / prev.length - dirX) * blendPrev * 0.48;
        dirY += (prev.vy / prev.length - dirY) * blendPrev * 0.48;
        dirX += (next.vx / next.length - dirX) * blendNext * 0.48;
        dirY += (next.vy / next.length - dirY) * blendNext * 0.48;
        const dirLength = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
        dirX /= dirLength;
        dirY /= dirLength;
        const normalX = -dirY;
        const normalY = dirX;
        const signed = dx * normalX + dy * normalY;
        best = {
          distSq,
          distance: Math.sqrt(distSq),
          signed,
          t,
          progress: clamp((segment.startLength + segment.length * t) / path.totalLength, 0, 1, 0),
          segmentIndex: segment.index,
          dirX,
          dirY,
          normalX,
          normalY
        };
      }
    }
    return best;
  }

  function getPathFieldInfo(x, y, fieldWidth, fieldHeight, sourceWidth, sourceHeight) {
    const sourceX = x / Math.max(1, fieldWidth - 1) * sourceWidth;
    const sourceY = y / Math.max(1, fieldHeight - 1) * sourceHeight;
    return getPathInfo(sourceX, sourceY, sourceWidth, sourceHeight);
  }

  function getAirflowAnchorInfo(x, y, fieldWidth, fieldHeight, sourceWidth, sourceHeight, params) {
    const pathInfo = getPathFieldInfo(x, y, fieldWidth, fieldHeight, sourceWidth, sourceHeight);
    if (pathInfo) return pathInfo;
    const basis = getLocalBasis(params);
    const sourceX = x / Math.max(1, fieldWidth - 1) * sourceWidth;
    const sourceY = y / Math.max(1, fieldHeight - 1) * sourceHeight;
    const cx = state.centerX * sourceWidth;
    const cy = state.centerY * sourceHeight;
    const rx = sourceX - cx;
    const ry = sourceY - cy;
    const along = rx * basis.dirX + ry * basis.dirY;
    const across = rx * basis.normalX + ry * basis.normalY;
    const maxSide = Math.max(sourceWidth, sourceHeight);
    const range = clamp(params.range, 10, 100, 62) / 100;
    const length = maxSide * (0.26 + range * 0.66);
    const progress = clamp((along / Math.max(1, length) + 1) * 0.5, 0, 1, 0.5);
    return {
      distance: Math.abs(across),
      signed: across,
      progress,
      dirX: basis.dirX,
      dirY: basis.dirY,
      normalX: basis.normalX,
      normalY: basis.normalY,
      along
    };
  }

  function buildAirflowDisplacementField(width, height, params, smokeAsset = null) {
    const maxSide = Math.max(width, height);
    const fieldScale = Math.min(1, DISPLACEMENT_FIELD_MAX_DIMENSION / Math.max(1, maxSide));
    const fieldWidth = Math.max(24, Math.round(width * fieldScale));
    const fieldHeight = Math.max(24, Math.round(height * fieldScale));
    const field = new Float32Array(fieldWidth * fieldHeight * 4);
    const intensity = clamp(params.intensity, 0, 100, 48) / 100;
    const range = clamp(params.range, 10, 100, 78) / 100;
    const feather = clamp(params.feather, 0, 100, 76) / 100;
    const detail = clamp(params.detail, 0, 100, 48) / 100;
    const glow = clamp(params.glow, 0, 100, 38) / 100;
    const brushScale = clamp(params.brush, 8, 120, 78) / 78;
    const coreWidth = maxSide * (0.045 + range * 0.18) * (0.72 + brushScale * 0.55);
    const outerWidth = coreWidth * (2.35 + feather * 3.75);
    const strengthPx = Math.min(maxSide * (0.0022 + intensity * 0.024), coreWidth * 0.34);
    const scale = 0.0024 + detail * 0.0065;
    const textureMap = smokeAsset && smokeAsset.image && smokeAsset.meta
      ? buildSmokeTextureField(fieldWidth, fieldHeight, width, height, params, smokeAsset)
      : null;
    const textureSample = [0, 0, 0, 0];

    for (let y = 0; y < fieldHeight; y += 1) {
      for (let x = 0; x < fieldWidth; x += 1) {
        const info = getAirflowAnchorInfo(x, y, fieldWidth, fieldHeight, width, height, params);
        const index = (y * fieldWidth + x) * 4;
        if (!info) continue;
        const absSigned = Math.abs(info.signed);
        const mask = 1 - smoothstep(coreWidth * 0.18, outerWidth, absSigned);
        if (mask <= 0) continue;
        const signedNorm = info.signed / Math.max(1, coreWidth);
        const sx = x / Math.max(1, fieldScale);
        const sy = y / Math.max(1, fieldScale);
        const textureA = (fbm(sx * scale + info.progress * 4.1, sy * scale * 0.72 + 7.4) - 0.5) * 2;
        const textureB = (fbm(sx * scale * 0.48 - 5.2, sy * scale * 1.28 + info.progress * 3.6) - 0.5) * 2;
        let assetAlpha = 0;
        let assetGradX = 0;
        let assetGradY = 0;
        if (textureMap) {
          sampleFieldBilinear(textureMap.data, textureMap.width, textureMap.height, x, y, textureSample);
          assetAlpha = clamp(textureSample[0], 0, 1, 0);
          assetGradX = clamp(textureSample[1], -1, 1, 0);
          assetGradY = clamp(textureSample[2], -1, 1, 0);
        }
        const assetTexture = (assetAlpha - 0.35) * 1.7 + assetGradX * 0.45 + assetGradY * 0.22;
        const textureMix = textureMap ? textureA * 0.35 + textureB * 0.2 + assetTexture * 0.72 : textureA * 0.72 + textureB * 0.28;
        const veil = getAirflowVeil(info.progress, signedNorm, textureMix, detail);
        const envelope = Math.pow(mask, 1.85);
        const longTaper = info.along == null ? 1 : 1 - smoothstep(0.76, 1.08, Math.abs(info.along) / Math.max(1, maxSide * (0.28 + range * 0.68)));
        const curl = Math.sin(info.progress * (5.8 + detail * 4.2) + textureB * 1.4 + assetAlpha * 2.1) * 0.32;
        const assetWeight = textureMap ? smoothstep(0.04, 0.62, assetAlpha) : 0;
        const localEnvelope = envelope * (textureMap ? (0.42 + assetWeight * 0.88) : 1);
        const normalPush = (veil.drift * 0.82 + textureB * 0.14 + assetGradY * 0.58 * assetWeight) * strengthPx * localEnvelope * longTaper;
        const tangentialFlow = (0.05 + veil.strand * 0.12 + curl * 0.12 + assetGradX * 0.32 * assetWeight) * strengthPx * localEnvelope * longTaper;
        const mist = (1 - smoothstep(0.32, 1.72, Math.abs(signedNorm))) * localEnvelope;
        const strand = Math.max(veil.strand * 0.55, assetAlpha * 0.95) * (1 - smoothstep(0.18, 1.18, Math.abs(signedNorm))) * localEnvelope;
        field[index] = info.normalX * normalPush - info.dirX * tangentialFlow;
        field[index + 1] = info.normalY * normalPush - info.dirY * tangentialFlow;
        field[index + 2] = (strand * 0.72 + mist * 0.14 + assetWeight * 0.22) * glow;
        field[index + 3] = clamp(localEnvelope + assetWeight * envelope * 0.32, 0, 1, 0);
      }
    }

    blurDisplacementField(field, fieldWidth, fieldHeight, detail);
    return { data: field, width: fieldWidth, height: fieldHeight };
  }

  function blurDisplacementField(field, width, height, detail) {
    const temp = new Float32Array(field.length);
    const passes = detail > 0.62 ? 1 : 2;
    for (let pass = 0; pass < passes; pass += 1) {
      temp.set(field);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          const x0 = Math.max(0, x - 1);
          const x1 = Math.min(width - 1, x + 1);
          const y0 = Math.max(0, y - 1);
          const y1 = Math.min(height - 1, y + 1);
          for (let c = 0; c < 4; c += 1) {
            field[index + c] = (
              temp[index + c] * 4 +
              temp[(y * width + x0) * 4 + c] * 2 +
              temp[(y * width + x1) * 4 + c] * 2 +
              temp[(y0 * width + x) * 4 + c] * 2 +
              temp[(y1 * width + x) * 4 + c] * 2 +
              temp[(y0 * width + x0) * 4 + c] +
              temp[(y0 * width + x1) * 4 + c] +
              temp[(y1 * width + x0) * 4 + c] +
              temp[(y1 * width + x1) * 4 + c]
            ) / 16;
          }
        }
      }
    }
  }

  function buildSmokeTextureField(fieldWidth, fieldHeight, sourceWidth, sourceHeight, params, smokeAsset) {
    const frames = smokeAsset.meta && Array.isArray(smokeAsset.meta.frames) ? smokeAsset.meta.frames : [];
    if (!frames.length) return null;
    const canvas = document.createElement("canvas");
    canvas.width = fieldWidth;
    canvas.height = fieldHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const anchors = getSmokeAnchors(sourceWidth, sourceHeight, params);
    const sx = fieldWidth / Math.max(1, sourceWidth);
    const sy = fieldHeight / Math.max(1, sourceHeight);
    const range = clamp(params.range, 10, 100, 78) / 100;
    const intensity = clamp(params.intensity, 0, 100, 48) / 100;
    ctx.clearRect(0, 0, fieldWidth, fieldHeight);
    ctx.globalCompositeOperation = "lighter";
    anchors.forEach((anchor, index) => {
      const frame = pickSmokeFrame(frames, index * 7 + Math.round(anchor.progress * 19), index % 3 !== 0);
      if (!frame) return;
      const sourceW = Math.max(1, Number(frame.w) || 1);
      const sourceH = Math.max(1, Number(frame.h) || 1);
      const aspect = sourceW / sourceH;
      const targetLong = Math.max(sourceWidth, sourceHeight) * (0.08 + range * 0.16) * anchor.scale;
      const targetW = (aspect >= 1 ? targetLong : targetLong * aspect) * sx;
      const targetH = (aspect >= 1 ? targetLong / aspect : targetLong) * sy;
      ctx.save();
      ctx.translate(anchor.x * sx, anchor.y * sy);
      ctx.rotate(anchor.angle + (hash2(index * 2.1, 7.3) - 0.5) * 0.85);
      ctx.globalAlpha = clamp(anchor.alpha * (0.78 + intensity * 0.72), 0, 0.78, 0);
      ctx.drawImage(smokeAsset.image, frame.x, frame.y, sourceW, sourceH, -targetW / 2, -targetH / 2, targetW, targetH);
      ctx.restore();
    });

    const pixels = ctx.getImageData(0, 0, fieldWidth, fieldHeight).data;
    const data = new Float32Array(fieldWidth * fieldHeight * 4);
    const alphaAt = (x, y) => {
      const xx = Math.max(0, Math.min(fieldWidth - 1, x));
      const yy = Math.max(0, Math.min(fieldHeight - 1, y));
      const index = (yy * fieldWidth + xx) * 4;
      const luma = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / (3 * 255);
      return Math.max(pixels[index + 3] / 255, luma);
    };
    for (let y = 0; y < fieldHeight; y += 1) {
      for (let x = 0; x < fieldWidth; x += 1) {
        const index = (y * fieldWidth + x) * 4;
        const alpha = Math.pow(alphaAt(x, y), 0.72);
        const gx = (alphaAt(x + 1, y) - alphaAt(x - 1, y)) * 2.8;
        const gy = (alphaAt(x, y + 1) - alphaAt(x, y - 1)) * 2.8;
        data[index] = alpha;
        data[index + 1] = gx;
        data[index + 2] = gy;
        data[index + 3] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    return { data, width: fieldWidth, height: fieldHeight };
  }

  function getPathDisplacement(x, y, width, height, params) {
    const info = getPathInfo(x, y, width, height);
    if (!info) return null;
    const maxSide = Math.max(width, height);
    const effect = String(params.effect || "heat");
    const intensity = clamp(params.intensity, 0, 100, 34) / 100;
    const range = clamp(params.range, 10, 100, 62) / 100;
    const feather = clamp(params.feather, 0, 100, 48) / 100;
    const detail = clamp(params.detail, 0, 100, 58) / 100;
    const glow = clamp(params.glow, 0, 100, 12) / 100;
    const brushScale = clamp(params.brush, 8, 120, 42) / 42;
    const widthPx = maxSide * (effect === "slash"
      ? (0.012 + range * 0.068)
      : effect === "airflow"
        ? (0.028 + range * 0.12)
        : (0.04 + range * 0.15)) * (0.55 + brushScale * 0.45);
    const outerPx = widthPx * (effect === "airflow" ? (2.25 + feather * 3.1) : (1.65 + feather * 2.2));
    const coreRadius = effect === "airflow" ? widthPx * 0.68 : widthPx;
    const mask = effect === "airflow"
      ? 1 - smoothstep(coreRadius, outerPx, info.distance)
      : 1 - smoothstep(widthPx, outerPx, info.distance);
    if (mask <= 0) return { dx: 0, dy: 0, mask: 0, light: 0, line: 0 };
    const rawStrengthPx = maxSide * (effect === "airflow" ? (0.0018 + intensity * 0.018) : (0.004 + intensity * 0.04));
    const strengthPx = limitDisplacementStrength(rawStrengthPx, widthPx, effect);
    const signedNorm = info.signed / Math.max(1, widthPx);
    const side = signedNorm >= 0 ? 1 : -1;
    const progress = Number(info.progress) || 0;
    const phase = progress * (6.5 + detail * 10);
    const textureScale = 0.004 + detail * 0.009;
    const texture = (fbm(x * textureScale + phase * 0.24, y * textureScale * 0.74 + phase * 0.18) - 0.5) * 2;
    const absSigned = Math.abs(signedNorm);
    const core = (1 - smoothstep(0.05, 0.88, absSigned)) * mask;
    const ember = Math.pow(Math.max(0, 0.5 + Math.sin(progress * (28 + detail * 26) + texture * 2.8) * 0.5), 2.5);
    const pulse = 0.72 + 0.28 * Math.sin(progress * (8 + detail * 8) + texture * 1.6);
    const halo = (1 - smoothstep(0.42, 1.72, absSigned)) * mask;

    if (effect === "airflow") {
      const veil = getAirflowVeil(progress, signedNorm, texture, detail);
      const envelope = Math.pow(mask, 1.65);
      const strandMask = (1 - smoothstep(0.14, 1.38, absSigned)) * envelope;
      const line = (veil.strand * 0.46 + ember * halo * 0.18) * strandMask;
      const push = veil.drift * strengthPx * envelope;
      const drag = strengthPx * (0.05 + veil.strand * 0.16) * envelope;
      return {
        dx: info.normalX * push - info.dirX * drag,
        dy: info.normalY * push - info.dirY * drag,
        mask: envelope,
        light: (line * 0.62 + halo * 0.08) * pulse * glow,
        line
      };
    }

    if (effect === "slash") {
      const edge = (1 - smoothstep(0.18, 1.08, absSigned)) * mask;
      const rim = (1 - smoothstep(0.72, 1.42, absSigned)) * mask * (0.55 + ember * 0.45);
      const push = side * strengthPx * (0.62 + edge * 0.72 + texture * 0.12) * mask;
      const drag = strengthPx * core * 0.2;
      return {
        dx: info.normalX * push - info.dirX * drag,
        dy: info.normalY * push - info.dirY * drag,
        mask,
        light: (core * 1.16 + rim * 0.42 + halo * ember * 0.18) * pulse * glow,
        line: clamp(core * 0.82 + rim * 0.24, 0, 1, 0)
      };
    }

    const heat = Math.sin(progress * (10 + detail * 16) + texture * 2.6);
    const push = (heat * 0.68 + texture * 0.46) * strengthPx * mask;
    return {
      dx: info.normalX * push,
      dy: info.normalY * push * 0.28 - info.dirY * Math.abs(texture) * strengthPx * mask * 0.08,
      mask,
      light: (Math.max(0, heat) * mask * 0.38 + halo * ember * 0.16) * pulse * glow,
      line: Math.abs(heat) * mask
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
    const pathDisplacement = getPathDisplacement(x, y, width, height, params);
    if (pathDisplacement) return pathDisplacement;

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
    const effect = String(params.effect || "heat");

    if (effect === "airflow") {
      const length = maxSide * (0.24 + range * 0.62);
      const flowWidth = maxSide * (0.055 + range * 0.2);
      const mask = ellipticalMask(along, across, length, flowWidth, feather);
      const envelope = Math.pow(mask, 1.55);
      const scale = 0.0035 + detail * 0.010;
      const progress = clamp((along / Math.max(1, length) + 1) * 0.5, 0, 1, 0.5);
      const signedNorm = across / Math.max(1, flowWidth);
      const texture = (fbm(along * scale + 8.2, across * scale * 0.72 + 3.4) - 0.5) * 2;
      const veil = getAirflowVeil(progress, signedNorm, texture, detail);
      const taper = 1 - smoothstep(0.72, 1, Math.abs(along) / Math.max(1, length));
      const strengthPx = limitDisplacementStrength(maxSide * (0.0016 + intensity * 0.016), flowWidth, effect);
      const normalPush = veil.drift * strengthPx * envelope * taper;
      const drag = (0.06 + veil.strand * 0.14) * strengthPx * envelope * taper;
      const streak = veil.strand * (1 - smoothstep(0.18, 1.22, Math.abs(signedNorm))) * envelope;
      return {
        dx: basis.normalX * normalPush - basis.dirX * drag,
        dy: basis.normalY * normalPush - basis.dirY * drag,
        mask: envelope,
        light: streak * glow * 0.62,
        line: streak
      };
    }

    const strengthPx = maxSide * (0.004 + intensity * 0.038);

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

  function softenAirflowResult(imageData, width, height, field, params) {
    const source = new Uint8ClampedArray(imageData.data);
    const dst = imageData.data;
    const detail = clamp(params.detail, 0, 100, 58) / 100;
    const passes = detail > 0.68 ? 1 : 2;
    const samplePixel = [0, 0, 0, 0];
    const fieldSample = [0, 0, 0, 0];
    const fieldXScale = (field.width - 1) / Math.max(1, width - 1);
    const fieldYScale = (field.height - 1) / Math.max(1, height - 1);
    for (let pass = 0; pass < passes; pass += 1) {
      source.set(dst);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          sampleFieldBilinear(field.data, field.width, field.height, x * fieldXScale, y * fieldYScale, fieldSample);
          const soften = clamp((fieldSample[3] || 0) * (0.14 + (1 - detail) * 0.1), 0, 0.22, 0);
          if (soften <= 0.001) continue;
          const index = (y * width + x) * 4;
          sampleBilinear(source, width, height, x + fieldSample[0] * 0.16, y + fieldSample[1] * 0.16, samplePixel);
          dst[index] = clamp(lerp(dst[index], samplePixel[0], soften), 0, 255, 0);
          dst[index + 1] = clamp(lerp(dst[index + 1], samplePixel[1], soften), 0, 255, 0);
          dst[index + 2] = clamp(lerp(dst[index + 2], samplePixel[2], soften), 0, 255, 0);
        }
      }
    }
  }

  function renderAirflowImageData(sourceImageData, width, height, params, startedAt, smokeAsset = null) {
    const src = sourceImageData.data;
    const out = new ImageData(width, height);
    const map = new ImageData(width, height);
    const dst = out.data;
    const mapData = map.data;
    const sample = [0, 0, 0, 0];
    const fieldSample = [0, 0, 0, 0];
    const field = buildAirflowDisplacementField(width, height, params, smokeAsset);
    const fallbackColor = [159, 220, 255];
    const glowColor = getGlowColor(params, fallbackColor);
    const fieldXScale = (field.width - 1) / Math.max(1, width - 1);
    const fieldYScale = (field.height - 1) / Math.max(1, height - 1);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        sampleFieldBilinear(field.data, field.width, field.height, x * fieldXScale, y * fieldYScale, fieldSample);
        const dx = fieldSample[0];
        const dy = fieldSample[1];
        const light = clamp(fieldSample[2], 0, 1.3, 0);
        const mask = clamp(fieldSample[3], 0, 1, 0);
        sampleBilinear(src, width, height, x + dx, y + dy, sample);
        const baseMix = clamp(mask * (0.74 + Math.min(1, Math.abs(dx) + Math.abs(dy)) * 0.035), 0, 0.98, 0);
        let r = src[index] * (1 - baseMix) + sample[0] * baseMix;
        let g = src[index + 1] * (1 - baseMix) + sample[1] * baseMix;
        let b = src[index + 2] * (1 - baseMix) + sample[2] * baseMix;
        const shade = mask * 6.5;
        const haze = Math.pow(mask, 1.35) * 0.048;
        const sparkle = light * light * 0.18;
        r = r * (1 - haze) - shade * 0.16 + glowColor[0] * (light * 0.26 + haze) + 255 * sparkle;
        g = g * (1 - haze) - shade * 0.1 + glowColor[1] * (light * 0.26 + haze) + 255 * sparkle;
        b = b * (1 - haze * 0.35) + glowColor[2] * (light * 0.28 + haze) + 255 * sparkle;
        dst[index] = clamp(r, 0, 255, 0);
        dst[index + 1] = clamp(g, 0, 255, 0);
        dst[index + 2] = clamp(b, 0, 255, 0);
        dst[index + 3] = src[index + 3];

        mapData[index] = clamp(128 + dx * 1.6, 0, 255, 128);
        mapData[index + 1] = clamp(28 + mask * 210 + light * 24, 0, 255, 0);
        mapData[index + 2] = clamp(128 + dy * 1.6, 0, 255, 128);
        mapData[index + 3] = 255;
      }
    }

    softenAirflowResult(out, width, height, field, params);
    return {
      imageData: out,
      mapImageData: map,
      elapsedMs: Math.round(performance.now() - startedAt)
    };
  }

  function getSmokeAnchors(width, height, params) {
    const maxSide = Math.max(width, height);
    const range = clamp(params.range, 10, 100, 78) / 100;
    const brush = clamp(params.brush, 8, 120, 78) / 78;
    const basis = getLocalBasis(params);
    const anchors = [];
    const path = getPathSegments(width, height);
    if (path && path.segments.length) {
      const count = clamp(Math.round(path.totalLength / Math.max(90, maxSide * 0.12)), 4, 14, 6);
      for (let i = 0; i < count; i += 1) {
        const progress = count <= 1 ? 0.5 : i / (count - 1);
        const target = progress * path.totalLength;
        let segment = path.segments[path.segments.length - 1];
        for (let s = 0; s < path.segments.length; s += 1) {
          const item = path.segments[s];
          if (target >= item.startLength && target <= item.startLength + item.length) {
            segment = item;
            break;
          }
        }
        const localT = clamp((target - segment.startLength) / Math.max(1, segment.length), 0, 1, 0);
        const dirX = segment.vx / segment.length;
        const dirY = segment.vy / segment.length;
        const normalX = -dirY;
        const normalY = dirX;
        const jitter = (hash2(i * 17.7, count * 3.1) - 0.5) * maxSide * (0.025 + range * 0.045);
        anchors.push({
          x: segment.ax + segment.vx * localT + normalX * jitter,
          y: segment.ay + segment.vy * localT + normalY * jitter,
          angle: Math.atan2(dirY, dirX),
          progress,
          scale: (0.72 + range * 0.8) * (0.76 + brush * 0.38) * (0.82 + hash2(i * 8.1, 2.4) * 0.46),
          alpha: 0.22 + hash2(i * 5.2, 8.8) * 0.22
        });
      }
      return anchors;
    }

    const cx = state.centerX * width;
    const cy = state.centerY * height;
    const length = maxSide * (0.18 + range * 0.46);
    const count = 7;
    for (let i = 0; i < count; i += 1) {
      const progress = count <= 1 ? 0.5 : i / (count - 1);
      const along = (progress - 0.5) * length * 2;
      const across = (hash2(i * 9.3, 4.2) - 0.5) * maxSide * (0.08 + range * 0.12);
      anchors.push({
        x: cx + basis.dirX * along + basis.normalX * across,
        y: cy + basis.dirY * along + basis.normalY * across,
        angle: Math.atan2(basis.dirY, basis.dirX),
        progress,
        scale: (0.82 + range * 0.72) * (0.82 + hash2(i * 3.7, 9.2) * 0.42),
        alpha: 0.18 + hash2(i * 4.9, 2.6) * 0.18
      });
    }
    return anchors;
  }

  function pickSmokeFrame(frames, index, preferStreak) {
    const filtered = frames.filter((frame) => preferStreak ? frame.type === "streak" : frame.type !== "column");
    const pool = filtered.length ? filtered : frames;
    if (!pool.length) return null;
    return pool[index % pool.length];
  }

  function renderSpaceFxImageData(sourceImageData, width, height, params, smokeAsset = null) {
    const startedAt = performance.now();
    const effect = String(params.effect || "heat");
    if (effect === "airflow") {
      return renderAirflowImageData(sourceImageData, width, height, params, startedAt, smokeAsset);
    }
    const src = sourceImageData.data;
    const out = new ImageData(width, height);
    const map = new ImageData(width, height);
    const dst = out.data;
    const mapData = map.data;
    const sample = [0, 0, 0, 0];
    const warm = effect === "slash" ? [125, 215, 255] : effect === "airflow" ? [160, 235, 225] : [255, 210, 135];
    const glowColor = getGlowColor(params, warm);

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
          const sparkle = line * light * 0.18;
          r = r - shade * 0.35 + glowColor[0] * light * 0.34 + 255 * sparkle;
          g = g - shade * 0.2 + glowColor[1] * light * 0.34 + 255 * sparkle;
          b = b + glowColor[2] * light * 0.36 + 255 * sparkle;
        } else if (effect === "slash") {
          const coreBoost = light * 1.25;
          const whiteCore = Math.pow(line, 1.8) * light * 0.42;
          r += glowColor[0] * coreBoost * 0.5 + 255 * whiteCore;
          g += glowColor[1] * coreBoost * 0.52 + 255 * whiteCore;
          b += glowColor[2] * coreBoost * 0.6 + 255 * whiteCore;
        } else {
          r += glowColor[0] * light * 0.2;
          g += glowColor[1] * light * 0.16;
          b += glowColor[2] * light * 0.12;
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

  async function renderToCanvas(image, canvas, maxDimension, params) {
    const source = drawImageToImageData(image, maxDimension);
    const smokeAsset = String(params.effect || "heat") === "airflow" ? await loadSmokeAsset() : null;
    const result = renderSpaceFxImageData(source.imageData, source.width, source.height, params, smokeAsset);
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
    const drawOverlay = getById("spaceFxDrawOverlay");
    const drawPath = getById("spaceFxDrawPath");
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
    if (drawOverlay && drawPath) {
      drawOverlay.setAttribute("viewBox", `0 0 ${Math.max(1, metrics.renderedWidth)} ${Math.max(1, metrics.renderedHeight)}`);
      drawOverlay.style.left = `${metrics.left}px`;
      drawOverlay.style.top = `${metrics.top}px`;
      drawOverlay.style.width = `${metrics.renderedWidth}px`;
      drawOverlay.style.height = `${metrics.renderedHeight}px`;
      const stroke = Math.max(3, Math.min(22, (clamp(state.params.brush, 8, 120, 42) / 42) * 7));
      drawPath.style.setProperty("--space-fx-draw-stroke", `${stroke.toFixed(1)}px`);
      if (state.pathPoints.length >= 2) {
        const d = buildSmoothSvgPath(state.pathPoints, metrics.renderedWidth, metrics.renderedHeight);
        drawPath.setAttribute("d", d);
      } else {
        drawPath.setAttribute("d", "");
      }
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

  function getNormalizedPointFromPointer(event) {
    const metrics = getContentMetrics();
    const localX = event.clientX - metrics.rect.left - metrics.left;
    const localY = event.clientY - metrics.rect.top - metrics.top;
    return {
      x: clamp(localX / Math.max(1, metrics.renderedWidth), 0, 1, 0.5),
      y: clamp(localY / Math.max(1, metrics.renderedHeight), 0, 1, 0.5)
    };
  }

  function addPathPoint(point, force = false) {
    const last = state.pathPoints[state.pathPoints.length - 1];
    if (!force && last) {
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      if (Math.sqrt(dx * dx + dy * dy) < 0.006) return;
    }
    state.pathPoints.push(point);
    if (state.pathPoints.length > 180) {
      state.pathPoints = state.pathPoints.filter((_, index) => index % 2 === 0);
    }
    markPathChanged();
    updateControlOverlay();
    syncControls();
  }

  function buildSmoothSvgPath(points, renderedWidth, renderedHeight) {
    if (!points || points.length < 2) return "";
    const first = points[0];
    let d = `M ${(first.x * renderedWidth).toFixed(1)} ${(first.y * renderedHeight).toFixed(1)}`;
    for (let i = 1; i < points.length - 1; i += 1) {
      const current = points[i];
      const next = points[i + 1];
      const midX = ((current.x + next.x) * 0.5 * renderedWidth).toFixed(1);
      const midY = ((current.y + next.y) * 0.5 * renderedHeight).toFixed(1);
      d += ` Q ${(current.x * renderedWidth).toFixed(1)} ${(current.y * renderedHeight).toFixed(1)} ${midX} ${midY}`;
    }
    const last = points[points.length - 1];
    d += ` L ${(last.x * renderedWidth).toFixed(1)} ${(last.y * renderedHeight).toFixed(1)}`;
    return d;
  }

  function smoothDrawnPath(points) {
    if (!points || points.length < 4) return points || [];
    const simplified = [];
    points.forEach((point) => {
      const last = simplified[simplified.length - 1];
      if (!last) {
        simplified.push(point);
        return;
      }
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      if (Math.sqrt(dx * dx + dy * dy) >= 0.004) simplified.push(point);
    });
    if (simplified.length < 4) return simplified;
    let result = simplified;
    for (let pass = 0; pass < 2; pass += 1) {
      const next = [result[0]];
      for (let i = 0; i < result.length - 1; i += 1) {
        const a = result[i];
        const b = result[i + 1];
        next.push({
          x: a.x * 0.75 + b.x * 0.25,
          y: a.y * 0.75 + b.y * 0.25
        });
        next.push({
          x: a.x * 0.25 + b.x * 0.75,
          y: a.y * 0.25 + b.y * 0.75
        });
      }
      next.push(result[result.length - 1]);
      result = next;
    }
    if (result.length <= 220) return result;
    const step = Math.ceil(result.length / 220);
    return result.filter((_, index) => index === 0 || index === result.length - 1 || index % step === 0);
  }

  function startDrawPath(event) {
    state.isDrawing = true;
    state.activePointerId = event.pointerId;
    state.pathPoints = [];
    const point = getNormalizedPointFromPointer(event);
    state.centerX = point.x;
    state.centerY = point.y;
    addPathPoint(point, true);
  }

  function continueDrawPath(event) {
    if (!state.isDrawing || state.activePointerId !== event.pointerId) return;
    addPathPoint(getNormalizedPointFromPointer(event));
  }

  function finishDrawPath(event) {
    if (!state.isDrawing || (event && state.activePointerId !== event.pointerId)) return;
    state.isDrawing = false;
    state.activePointerId = null;
    state.pathPoints = smoothDrawnPath(state.pathPoints);
    markPathChanged();
    syncControls();
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
      const result = await renderToCanvas(state.sourceImage, canvas, PREVIEW_MAX_DIMENSION, state.params);
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
    updateSpaceFxWorkbenchLayout();
    window.requestAnimationFrame(() => {
      updateSpaceFxWorkbenchLayout();
      applyPreviewTransform();
    });
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
      const result = await renderToCanvas(state.sourceImage, outputCanvas, CAPTURE_MAX_DIMENSION, state.params);
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
        const result = await renderToCanvas(state.sourceImage, outputCanvas, CAPTURE_MAX_DIMENSION, state.params);
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

  function updateSpaceFxWorkbenchLayout() {
    const workbench = document.querySelector("#spaceFxModal .space-fx-workbench");
    const sliderStack = document.querySelector("#spaceFxModal .space-fx-slider-stack");
    if (!workbench || !sliderStack) return;
    const style = window.getComputedStyle(sliderStack);
    const template = String(style.gridTemplateColumns || "").trim();
    const isSingleColumn = !template || !template.includes(" ");
    workbench.classList.toggle("is-side-by-side", !isSingleColumn);
    updateControlOverlay();
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
      if (state.drawMode) {
        viewport.classList.add("is-drawing");
        startDrawPath(event);
        return;
      }
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
      if (state.isDrawing) {
        event.preventDefault();
        continueDrawPath(event);
        return;
      }
      if (!state.view.isPanning) return;
      event.preventDefault();
      state.view.x = state.view.startPanX + event.clientX - state.view.startX;
      state.view.y = state.view.startPanY + event.clientY - state.view.startY;
      applyPreviewTransform();
    };

    const endPan = (event) => {
      if (state.isDrawing) {
        event.preventDefault();
        finishDrawPath(event);
        viewport.classList.remove("is-drawing");
        return;
      }
      if (!state.view.isPanning) return;
      event.preventDefault();
      state.view.isPanning = false;
      viewport.classList.remove("is-panning");
    };

    window.addEventListener("pointermove", movePan, { passive: false });
    window.addEventListener("pointerup", endPan, { passive: false });
    window.addEventListener("pointercancel", endPan, { passive: false });
    window.addEventListener("blur", () => {
      state.isDrawing = false;
      state.activePointerId = null;
      state.view.isPanning = false;
      viewport.classList.remove("is-panning");
      viewport.classList.remove("is-drawing");
    });
    viewport.addEventListener("dblclick", resetPreviewTransform);
  }

  function bindSpaceFxActions() {
    const openButton = getById("btnOpenSpaceFxPanel");
    const closeButton = getById("spaceFxModalClose");
    const recaptureButton = getById("btnSpaceFxRecapture");
    const applyButton = getById("btnSpaceFxApply");
    const mapButton = getById("btnSpaceFxMap");
    const drawButton = getById("btnSpaceFxDraw");
    const clearPathButton = getById("btnSpaceFxClearPath");
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
    if (drawButton) {
      drawButton.addEventListener("click", () => {
        state.drawMode = !state.drawMode;
        syncControls();
        setStatus(state.drawMode ? "手绘路径已开启：在预览图上按住拖一笔生成特效轨迹。" : "手绘路径已关闭：点击预览图放置中心点。", "info");
      });
    }
    if (clearPathButton) {
      clearPathButton.addEventListener("click", () => {
        state.pathPoints = [];
        markPathChanged();
        state.isDrawing = false;
        state.activePointerId = null;
        syncControls();
        schedulePreviewUpdate();
        setStatus("已清除手绘路径，恢复模板默认形状。", "info");
      });
    }
    document.addEventListener("click", (event) => {
      if (event.target && event.target.closest("#spaceFxBackdrop")) closeSpaceFxModal();
    });
    document.querySelectorAll("[data-space-fx-preset]").forEach((button) => {
      button.addEventListener("click", () => applyPreset(button.getAttribute("data-space-fx-preset")));
    });
    ["Intensity", "Range", "Feather", "Angle", "Detail", "Glow", "GlowColor", "Brush"].forEach((name) => {
      const input = getById(`spaceFx${name}Input`);
      if (!input) return;
      input.addEventListener("input", () => {
        readControls();
        schedulePreviewUpdate();
      });
    });
    ["spaceFxGlowColorEnabledInput", "spaceFxGlowColorPickerInput"].forEach((id) => {
      const input = getById(id);
      if (!input) return;
      input.addEventListener("input", () => {
        readControls();
        schedulePreviewUpdate();
      });
      input.addEventListener("change", () => {
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
    updateSpaceFxWorkbenchLayout();
    window.addEventListener("resize", updateSpaceFxWorkbenchLayout);
    const sliderStack = document.querySelector("#spaceFxModal .space-fx-slider-stack");
    const workbench = document.querySelector("#spaceFxModal .space-fx-workbench");
    if (typeof ResizeObserver === "function" && sliderStack) {
      const observer = new ResizeObserver(() => {
        updateSpaceFxWorkbenchLayout();
      });
      observer.observe(sliderStack);
      if (workbench) observer.observe(workbench);
    }
  }

  modules.spaceFx = {
    bindSpaceFxActions,
    renderSpaceFxImageData
  };
})(window);
