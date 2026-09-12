const DEFAULT_FILM_PARAMS = Object.freeze({
  preset: "natural",
  amount: 68,
  exposure: 0,
  contrast: 8,
  saturation: -4,
  warmth: 8,
  shadowLift: 10,
  highlightRollOff: 28,
  halation: 24,
  halationThreshold: 68,
  halationRadius: 14,
  grain: 28,
  grainSize: 2,
  grainColor: 18,
  vignette: 12,
  vignetteMidpoint: 62,
  vignetteFeather: 68,
  dispersion: 10,
  dispersionRadius: 58,
  dispersionHighlightsOnly: false,
  seed: 4817
});

const PRESETS = Object.freeze({
  natural: {
    label: "自然胶片",
    description: "均衡的负片质感：柔和卤化、细颗粒和轻微暗角，适合人像与日常画面。",
    amount: 68,
    exposure: 0,
    contrast: 8,
    saturation: -4,
    warmth: 8,
    shadowLift: 10,
    highlightRollOff: 28,
    halation: 24,
    halationThreshold: 68,
    halationRadius: 14,
    grain: 28,
    grainSize: 2,
    grainColor: 18,
    vignette: 12,
    dispersion: 10,
    dispersionRadius: 58
  },
  ccd: {
    label: "CCD 直闪",
    description: "模拟小型数码相机直闪：硬朗高光、较强颗粒与边缘色散，适合夜景和闪光灯抓拍。",
    amount: 76,
    exposure: 5,
    contrast: 18,
    saturation: 8,
    warmth: 2,
    shadowLift: 5,
    highlightRollOff: 16,
    halation: 34,
    halationThreshold: 61,
    halationRadius: 18,
    grain: 34,
    grainSize: 2,
    grainColor: 24,
    vignette: 16,
    dispersion: 16,
    dispersionRadius: 72
  },
  blueHour: {
    label: "蓝调 Live",
    description: "偏冷的现场蓝调：保留暗部层次、减弱暖色和高光扩散，适合夜景与 Live 氛围。",
    amount: 64,
    exposure: -3,
    contrast: 2,
    saturation: -8,
    warmth: -18,
    shadowLift: 18,
    highlightRollOff: 34,
    halation: 14,
    halationThreshold: 72,
    halationRadius: 12,
    grain: 20,
    grainSize: 2,
    grainColor: 12,
    vignette: 8,
    dispersion: 6,
    dispersionRadius: 45
  }
});

function clamp(value, min, max, fallback = min) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(0.00001, edge1 - edge0), 0, 1, 0);
  return t * t * (3 - 2 * t);
}

function srgbToLinear(value) {
  const normalized = clamp(value, 0, 1, 0);
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value) {
  const normalized = clamp(value, 0, 1, 0);
  return normalized <= 0.0031308
    ? normalized * 12.92
    : 1.055 * Math.pow(normalized, 1 / 2.4) - 0.055;
}

function hashNoise(x, y, seed) {
  let value = Math.imul((x | 0) ^ Math.imul((y | 0), 374761393) ^ Math.imul(seed | 0, 1442695041), 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
}

function grainNoise(x, y, grainSize, seed) {
  const radius = Math.max(1, Math.round(Number(grainSize) || 1));
  const fine = (
    hashNoise(x, y, seed + 3) +
    hashNoise(x + 5, y - 7, seed + 31) +
    hashNoise(x - 9, y + 4, seed + 67)
  ) / 3;
  const soft = (
    hashNoise(x + radius, y, seed + 11) +
    hashNoise(x - radius, y, seed + 23) +
    hashNoise(x, y + radius, seed + 37) +
    hashNoise(x, y - radius, seed + 53)
  ) / 4;
  const broadRadius = radius * 2 + 1;
  const broad = (
    hashNoise(x + broadRadius, y + broadRadius, seed + 79) +
    hashNoise(x - broadRadius, y + broadRadius, seed + 97) +
    hashNoise(x + broadRadius, y - broadRadius, seed + 113) +
    hashNoise(x - broadRadius, y - broadRadius, seed + 131)
  ) / 4;
  return fine * 0.46 + soft * 0.36 + broad * 0.18;
}

function getDimensions(imageData) {
  return {
    width: Math.max(1, Math.round(Number(imageData && imageData.width) || 0)),
    height: Math.max(1, Math.round(Number(imageData && imageData.height) || 0))
  };
}

function createImageData(width, height, data) {
  if (typeof ImageData === "function") return new ImageData(data, width, height);
  return { width, height, data };
}

function sampleChannel(data, width, height, x, y, channel) {
  const clampedX = clamp(x, 0, width - 1, 0);
  const clampedY = clamp(y, 0, height - 1, 0);
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;
  const i00 = (y0 * width + x0) * 4 + channel;
  const i10 = (y0 * width + x1) * 4 + channel;
  const i01 = (y1 * width + x0) * 4 + channel;
  const i11 = (y1 * width + x1) * 4 + channel;
  return lerp(lerp(data[i00], data[i10], tx), lerp(data[i01], data[i11], tx), ty);
}

function buildBlurredMask(mask, width, height, radius) {
  const size = width * height;
  const source = new Float32Array(mask);
  const horizontal = new Float32Array(size);
  const output = new Float32Array(size);
  const span = Math.max(1, Math.round(radius));
  const windowSize = span * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = -span; x <= span; x += 1) sum += source[y * width + clamp(x, 0, width - 1, 0)];
    for (let x = 0; x < width; x += 1) {
      if (x > 0) {
        const left = clamp(x - span - 1, 0, width - 1, 0);
        const right = clamp(x + span, 0, width - 1, 0);
        sum += source[y * width + right] - source[y * width + left];
      }
      horizontal[y * width + x] = sum / windowSize;
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -span; y <= span; y += 1) sum += horizontal[clamp(y, 0, height - 1, 0) * width + x];
    for (let y = 0; y < height; y += 1) {
      if (y > 0) {
        const top = clamp(y - span - 1, 0, height - 1, 0);
        const bottom = clamp(y + span, 0, height - 1, 0);
        sum += horizontal[bottom * width + x] - horizontal[top * width + x];
      }
      output[y * width + x] = sum / windowSize;
    }
  }
  return output;
}

export function normalizeFilmParams(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const preset = String(source.preset || DEFAULT_FILM_PARAMS.preset);
  const presetValues = PRESETS[preset] || {};
  const merged = { ...DEFAULT_FILM_PARAMS, ...presetValues, ...source };
  return {
    preset: PRESETS[preset] ? preset : DEFAULT_FILM_PARAMS.preset,
    amount: clamp(merged.amount, 0, 100, DEFAULT_FILM_PARAMS.amount),
    exposure: clamp(merged.exposure, -100, 100, DEFAULT_FILM_PARAMS.exposure),
    contrast: clamp(merged.contrast, -100, 100, DEFAULT_FILM_PARAMS.contrast),
    saturation: clamp(merged.saturation, -100, 100, DEFAULT_FILM_PARAMS.saturation),
    warmth: clamp(merged.warmth, -100, 100, DEFAULT_FILM_PARAMS.warmth),
    shadowLift: clamp(merged.shadowLift, 0, 100, DEFAULT_FILM_PARAMS.shadowLift),
    highlightRollOff: clamp(merged.highlightRollOff, 0, 100, DEFAULT_FILM_PARAMS.highlightRollOff),
    halation: clamp(merged.halation, 0, 100, DEFAULT_FILM_PARAMS.halation),
    halationThreshold: clamp(merged.halationThreshold, 25, 95, DEFAULT_FILM_PARAMS.halationThreshold),
    halationRadius: clamp(merged.halationRadius, 1, 50, DEFAULT_FILM_PARAMS.halationRadius),
    grain: clamp(merged.grain, 0, 100, DEFAULT_FILM_PARAMS.grain),
    grainSize: clamp(merged.grainSize, 1, 8, DEFAULT_FILM_PARAMS.grainSize),
    grainColor: clamp(merged.grainColor, 0, 100, DEFAULT_FILM_PARAMS.grainColor),
    vignette: clamp(merged.vignette, 0, 100, DEFAULT_FILM_PARAMS.vignette),
    vignetteMidpoint: clamp(merged.vignetteMidpoint, 25, 90, DEFAULT_FILM_PARAMS.vignetteMidpoint),
    vignetteFeather: clamp(merged.vignetteFeather, 5, 100, DEFAULT_FILM_PARAMS.vignetteFeather),
    dispersion: clamp(merged.dispersion, 0, 100, DEFAULT_FILM_PARAMS.dispersion),
    dispersionRadius: clamp(merged.dispersionRadius, 0, 100, DEFAULT_FILM_PARAMS.dispersionRadius),
    dispersionHighlightsOnly: merged.dispersionHighlightsOnly === true,
    seed: Math.round(clamp(merged.seed, 0, 2147483647, DEFAULT_FILM_PARAMS.seed))
  };
}

export function getFilmPresets() {
  return Object.entries(PRESETS).map(([id, preset]) => ({ id, label: preset.label, description: preset.description }));
}

export function renderFilmImageData(sourceImageData, inputParams = {}, options = {}) {
  const { width, height } = getDimensions(sourceImageData);
  const source = sourceImageData && sourceImageData.data;
  if (!source || source.length < width * height * 4) throw new Error("胶片渲染缺少有效图像数据");
  const params = normalizeFilmParams(inputParams);
  const output = new Uint8ClampedArray(width * height * 4);
  const originX = Math.round(Number(options.originX) || 0);
  const originY = Math.round(Number(options.originY) || 0);
  const maxDimension = Math.max(width, height);
  const amount = params.amount / 100;
  const exposure = Math.pow(2, params.exposure / 100);
  const contrast = 1 + params.contrast / 100 * 0.72;
  const saturation = 1 + params.saturation / 100;
  const warmth = params.warmth / 100;
  const dispersionShift = maxDimension * 0.024 * (params.dispersion / 100) * Math.pow(params.dispersionRadius / 100, 0.72);
  const dispersionEnabled = dispersionShift > 0.01;
  const highlightThreshold = params.halationThreshold / 100;
  const haloMask = params.halation > 0 ? new Float32Array(width * height) : null;

  for (let y = 0; y < height; y += 1) {
    const ny = height > 1 ? y / (height - 1) : 0.5;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      let r = source[index] / 255;
      let g = source[index + 1] / 255;
      let b = source[index + 2] / 255;
      const alpha = source[index + 3] / 255;
      const dx = x / Math.max(1, width - 1) - 0.5;
      const dy = ny - 0.5;
      const distance = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 1.4143);
      const sourceLuma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      if (dispersionEnabled) {
        const highlightMix = params.dispersionHighlightsOnly ? smoothstep(0.24, 0.78, sourceLuma) : 1;
        const edgeInfluence = 0.18 + 0.82 * smoothstep(0.04, 0.94, distance);
        const shift = dispersionShift * edgeInfluence * highlightMix;
        if (shift > 0.01) {
          r = sampleChannel(source, width, height, x - dx * shift, y - dy * shift, 0) / 255;
          b = sampleChannel(source, width, height, x + dx * shift, y + dy * shift, 2) / 255;
        }
      }
      let linearR = srgbToLinear(r) * exposure;
      let linearG = srgbToLinear(g) * exposure;
      let linearB = srgbToLinear(b) * exposure;
      const linearLuma = linearR * 0.2126 + linearG * 0.7152 + linearB * 0.0722;
      const shadowMask = 1 - smoothstep(0.08, 0.58, linearLuma);
      const highlightMask = smoothstep(0.56, 1, linearLuma);
      const lift = (params.shadowLift / 100) * shadowMask * 0.12;
      linearR += lift;
      linearG += lift;
      linearB += lift;
      const roll = params.highlightRollOff / 100;
      if (roll > 0) {
        const compress = (value) => value > 0.58 ? 0.58 + (value - 0.58) / (1 + roll * (value - 0.58) * 3.2) : value;
        linearR = compress(linearR);
        linearG = compress(linearG);
        linearB = compress(linearB);
      }
      const toneLuma = linearR * 0.2126 + linearG * 0.7152 + linearB * 0.0722;
      linearR = toneLuma + (linearR - toneLuma) * saturation;
      linearG = toneLuma + (linearG - toneLuma) * saturation;
      linearB = toneLuma + (linearB - toneLuma) * saturation;
      linearR += warmth * 0.035 * (0.35 + highlightMask * 0.65);
      linearB -= warmth * 0.026 * (0.35 + highlightMask * 0.65);
      const fade = (100 - params.amount) / 100 * 0.018 + amount * 0.012;
      linearR = linearR * (1 - fade) + fade * 0.055;
      linearG = linearG * (1 - fade) + fade * 0.055;
      linearB = linearB * (1 - fade) + fade * 0.055;
      const adjustContrast = (value) => (value - 0.5) * contrast + 0.5;
      const displayR = adjustContrast(linearToSrgb(linearR));
      const displayG = adjustContrast(linearToSrgb(linearG));
      const displayB = adjustContrast(linearToSrgb(linearB));
      const blend = amount;
      output[index] = Math.round(lerp(source[index] / 255, displayR, blend) * 255);
      output[index + 1] = Math.round(lerp(source[index + 1] / 255, displayG, blend) * 255);
      output[index + 2] = Math.round(lerp(source[index + 2] / 255, displayB, blend) * 255);
      output[index + 3] = source[index + 3];
      if (haloMask) haloMask[y * width + x] = smoothstep(highlightThreshold - 0.1, highlightThreshold + 0.12, sourceLuma) * alpha;
    }
  }

  if (haloMask) {
    const pixelCount = width * height;
    const haloRadius = Math.max(1, Math.round(params.halationRadius * Math.min(width, height) / 1200));
    const blurred = pixelCount <= 9000000 ? buildBlurredMask(haloMask, width, height, haloRadius) : haloMask;
    const haloStrength = params.halation / 100 * amount * 0.34;
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4;
      const halo = blurred[index] * haloStrength;
      if (halo <= 0.0001) continue;
      const r = output[offset] / 255;
      const g = output[offset + 1] / 255;
      const b = output[offset + 2] / 255;
      output[offset] = Math.round(clamp(r + halo * 1.1, 0, 1, r) * 255);
      output[offset + 1] = Math.round(clamp(g + halo * 0.3, 0, 1, g) * 255);
      output[offset + 2] = Math.round(clamp(b + halo * 0.08, 0, 1, b) * 255);
    }
  }

  // Film grain needs enough amplitude to survive 8-bit quantization and the
  // Photoshop placement/readback path. Tone weighting keeps highlights clean
  // while giving shadows the denser grain seen in real negative film.
  const grainStrength = params.grain / 100 * amount * 0.22;
  const grainSize = Math.max(1, Math.round(params.grainSize));
  const colorGrain = params.grainColor / 100;
  const vignetteStrength = params.vignette / 100 * amount * 0.72;
  const midpoint = params.vignetteMidpoint / 100;
  const feather = Math.max(0.06, params.vignetteFeather / 100);
  for (let y = 0; y < height; y += 1) {
    const globalY = originY + y;
    for (let x = 0; x < width; x += 1) {
      const globalX = originX + x;
      const index = (y * width + x) * 4;
      const luma = (output[index] * 0.2126 + output[index + 1] * 0.7152 + output[index + 2] * 0.0722) / 255;
      if (grainStrength > 0) {
        const noise = grainNoise(globalX, globalY, grainSize, params.seed) - 0.5;
        const chromaNoise = grainNoise(globalX + 17, globalY - 11, grainSize, params.seed + 97) - 0.5;
        const shadowWeight = 1 - smoothstep(0.10, 0.52, luma);
        const highlightWeight = smoothstep(0.58, 0.92, luma);
        const toneWeight = clamp(0.92 + shadowWeight * 0.24 - highlightWeight * 0.58, 0.26, 1.18, 0.92);
        const pixelGrainStrength = grainStrength * toneWeight;
        const monochrome = noise * pixelGrainStrength;
        const chroma = chromaNoise * pixelGrainStrength * colorGrain * 0.16;
        output[index] = Math.round(clamp(output[index] / 255 + monochrome + chroma * 0.55, 0, 1, 0) * 255);
        output[index + 1] = Math.round(clamp(output[index + 1] / 255 + monochrome - chroma * 0.20, 0, 1, 0) * 255);
        output[index + 2] = Math.round(clamp(output[index + 2] / 255 + monochrome - chroma * 0.45, 0, 1, 0) * 255);
      }
      if (vignetteStrength > 0) {
        const nx = (x / Math.max(1, width - 1) - 0.5) * 2;
        const ny = (y / Math.max(1, height - 1) - 0.5) * 2;
        const distance = Math.sqrt(nx * nx + ny * ny) / 1.4143;
        const mask = smoothstep(midpoint, Math.min(1, midpoint + feather), distance);
        const vignette = 1 - vignetteStrength * mask;
        output[index] = Math.round(output[index] * vignette);
        output[index + 1] = Math.round(output[index + 1] * vignette);
        output[index + 2] = Math.round(output[index + 2] * vignette);
      }
      output[index + 3] = source[index + 3];
    }
  }
  return createImageData(width, height, output);
}

export const FILM_DEFAULTS = DEFAULT_FILM_PARAMS;

// The lens stack deliberately has one active image-wide effect. Film remains
// available as a restrained finishing layer so existing presets keep working.
const DEFAULT_POST_FX_PARAMS = Object.freeze({
  effectType: "film",
  effectEnabled: true,
  effectAmount: 100,
  filmFinish: true,
  crtStrength: 72,
  crtPixelGrid: 58,
  crtScanlines: 46,
  crtCurvature: 34,
  crtConvergence: 22,
  pixelBlockSize: 6,
  pixelLevels: 12,
  pixelDither: 22,
  pixelEdgePreserve: 28,
  windDirection: 0,
  windLength: 38,
  windBreakup: 42,
  windEdgeProtect: 32,
  shatterFragmentSize: 28,
  shatterScatter: 36,
  shatterDirection: 18,
  shatterCracks: 28
});

const POST_FX_EFFECTS = Object.freeze([
  { id: "film", label: "胶片质感", description: "自然胶片、CCD 直闪与蓝调 Live，作为可选质感收尾。", finish: true },
  { id: "crt", label: "CRT 显像管", description: "扫描线、RGB 荫罩、轻微会聚偏移与曲面暗角。", finish: false },
  { id: "pixelate", label: "像素化", description: "稳定块状重采样、色阶量化与可控抖动。", finish: false },
  { id: "wind", label: "风切拖影", description: "全图方向性拖曳，断续破碎并保护画面边缘。", finish: false },
  { id: "shatter", label: "破碎", description: "画布内不规则碎片位移、旋转、裂缝与边缘色差。", finish: false }
]);

function normalizeEffectType(value) {
  const id = String(value || DEFAULT_POST_FX_PARAMS.effectType);
  return POST_FX_EFFECTS.some((effect) => effect.id === id) ? id : DEFAULT_POST_FX_PARAMS.effectType;
}

export function normalizePostFxParams(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const film = normalizeFilmParams(source);
  const effectType = normalizeEffectType(source.effectType || source.type);
  return {
    ...film,
    effectType,
    effectEnabled: source.effectEnabled !== false,
    effectAmount: clamp(source.effectAmount, 0, 100, DEFAULT_POST_FX_PARAMS.effectAmount),
    filmFinish: source.filmFinish === true || (effectType === "film" && source.filmFinish !== false),
    crtStrength: clamp(source.crtStrength, 0, 100, DEFAULT_POST_FX_PARAMS.crtStrength),
    crtPixelGrid: clamp(source.crtPixelGrid, 0, 100, DEFAULT_POST_FX_PARAMS.crtPixelGrid),
    crtScanlines: clamp(source.crtScanlines, 0, 100, DEFAULT_POST_FX_PARAMS.crtScanlines),
    crtCurvature: clamp(source.crtCurvature, 0, 100, DEFAULT_POST_FX_PARAMS.crtCurvature),
    crtConvergence: clamp(source.crtConvergence, 0, 100, DEFAULT_POST_FX_PARAMS.crtConvergence),
    pixelBlockSize: Math.round(clamp(source.pixelBlockSize, 2, 64, DEFAULT_POST_FX_PARAMS.pixelBlockSize)),
    pixelLevels: Math.round(clamp(source.pixelLevels, 2, 32, DEFAULT_POST_FX_PARAMS.pixelLevels)),
    pixelDither: clamp(source.pixelDither, 0, 100, DEFAULT_POST_FX_PARAMS.pixelDither),
    pixelEdgePreserve: clamp(source.pixelEdgePreserve, 0, 100, DEFAULT_POST_FX_PARAMS.pixelEdgePreserve),
    windDirection: clamp(source.windDirection, -180, 180, DEFAULT_POST_FX_PARAMS.windDirection),
    windLength: clamp(source.windLength, 0, 100, DEFAULT_POST_FX_PARAMS.windLength),
    windBreakup: clamp(source.windBreakup, 0, 100, DEFAULT_POST_FX_PARAMS.windBreakup),
    windEdgeProtect: clamp(source.windEdgeProtect, 0, 100, DEFAULT_POST_FX_PARAMS.windEdgeProtect),
    shatterFragmentSize: Math.round(clamp(source.shatterFragmentSize, 8, 128, DEFAULT_POST_FX_PARAMS.shatterFragmentSize)),
    shatterScatter: clamp(source.shatterScatter, 0, 100, DEFAULT_POST_FX_PARAMS.shatterScatter),
    shatterDirection: clamp(source.shatterDirection, -180, 180, DEFAULT_POST_FX_PARAMS.shatterDirection),
    shatterCracks: clamp(source.shatterCracks, 0, 100, DEFAULT_POST_FX_PARAMS.shatterCracks)
  };
}

export function getPostFxEffects() {
  return POST_FX_EFFECTS.map((effect) => ({ ...effect }));
}

export const getPostFxEffectCatalog = getPostFxEffects;

function cloneSource(sourceImageData) {
  const { width, height } = getDimensions(sourceImageData);
  const source = sourceImageData && sourceImageData.data;
  return createImageData(width, height, new Uint8ClampedArray(source));
}

function sampleRgb(source, width, height, x, y, channel) {
  return sampleChannel(source, width, height, x, y, channel) / 255;
}

function sampleColor(source, width, height, x, y) {
  return [sampleRgb(source, width, height, x, y, 0), sampleRgb(source, width, height, x, y, 1), sampleRgb(source, width, height, x, y, 2)];
}

function blendColor(base, effect, amount) {
  return [
    lerp(base[0], effect[0], amount),
    lerp(base[1], effect[1], amount),
    lerp(base[2], effect[2], amount)
  ];
}

function sinApprox(value) {
  const period = Math.PI * 2;
  let x = value - Math.floor((value + Math.PI) / period) * period;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  if (x > Math.PI) x = period - x;
  const x2 = x * x;
  return sign * (x - x2 * x / 6 + x2 * x2 * x / 120 - x2 * x2 * x2 * x / 5040);
}

function cosApprox(value) {
  return sinApprox(value + Math.PI * 0.5);
}

function directionVector(degrees) {
  const radians = Number(degrees || 0) * Math.PI / 180;
  return [cosApprox(radians), sinApprox(radians)];
}

function valueNoise2d(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(0, 1, x - x0);
  const ty = smoothstep(0, 1, y - y0);
  const top = lerp(hashNoise(x0, y0, seed), hashNoise(x0 + 1, y0, seed), tx);
  const bottom = lerp(hashNoise(x0, y0 + 1, seed), hashNoise(x0 + 1, y0 + 1, seed), tx);
  return lerp(top, bottom, ty);
}

function shatterSite(cellX, cellY, size, seed) {
  const jitterX = (hashNoise(cellX, cellY, seed + 73) - 0.5) * 0.62;
  const jitterY = (hashNoise(cellX, cellY, seed + 89) - 0.5) * 0.62;
  return {
    x: (cellX + 0.5 + jitterX) * size,
    y: (cellY + 0.5 + jitterY) * size,
    angle: (hashNoise(cellX, cellY, seed + 101) - 0.5) * 0.45,
    scatter: hashNoise(cellX, cellY, seed + 149),
    cross: hashNoise(cellX, cellY, seed + 191) - 0.5
  };
}

function renderCrt(sourceImageData, params) {
  const { width, height } = getDimensions(sourceImageData);
  const source = sourceImageData.data;
  const output = new Uint8ClampedArray(source);
  const strength = params.effectAmount / 100 * params.crtStrength / 100;
  const curvature = params.crtCurvature / 100 * 0.12;
  const convergence = params.crtConvergence / 100 * 0.008 * Math.max(width, height);
  const grid = params.crtPixelGrid / 100 * 0.038;
  const lines = params.crtScanlines / 100;
  const aspect = width / Math.max(1, height);
  // Scanline density is defined as a fraction of the image height, rather
  // than a fixed physical-pixel period. This keeps CRT character consistent
  // when the same effect is applied to a 1080px or 6000px image.
  const scanlineCount = 18 + lines * 142;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      // Use pixel-center coordinates so CPU and WebGL paths sample the same
      // source location and never introduce a half-pixel translation.
      const ux = (x + 0.5) / width;
      const uy = (y + 0.5) / height;
      const dx = ux * 2 - 1;
      const dy = uy * 2 - 1;
      const radialX = dx * aspect;
      const radiusSquared = Math.min(1, (radialX * radialX + dy * dy) / (aspect * aspect + 1));
      // Normalize the warp at the outer edge. This preserves the full canvas
      // bounds instead of cropping/zooming the image as curvature increases.
      const curve = (1 + curvature * radiusSquared) / (1 + curvature);
      const warpedX = 0.5 + dx * curve * 0.5;
      const warpedY = 0.5 + dy * curve * 0.5;
      const warpedRadialX = (warpedX - 0.5) * 2;
      const warpedRadialY = (warpedY - 0.5) * 2;
      const red = sampleRgb(source, width, height, warpedX * width - 0.5 - warpedRadialX * convergence, warpedY * height - 0.5 - warpedRadialY * convergence, 0);
      const green = sampleRgb(source, width, height, warpedX * width - 0.5, warpedY * height - 0.5, 1);
      const blue = sampleRgb(source, width, height, warpedX * width - 0.5 + warpedRadialX * convergence, warpedY * height - 0.5 + warpedRadialY * convergence, 2);
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const scanPhase = 0.5 + 0.5 * cosApprox(((y + 0.5) / height) * scanlineCount * Math.PI * 2);
      const scan = 1 - lines * (0.035 + luma * 0.13) * scanPhase;
      const grillePhase = (((x + (y & 1)) % 3) + 3) % 3;
      const redMask = grid * (grillePhase === 0 ? 1.15 : -0.32);
      const greenMask = grid * (grillePhase === 1 ? 1.05 : -0.24);
      const blueMask = grid * (grillePhase === 2 ? 1.15 : -0.32);
      const radius = Math.min(1, Math.sqrt(radiusSquared));
      const vignette = 1 - smoothstep(0.56, 0.98, radius) * (0.08 + strength * 0.22);
      const phosphor = scan * vignette;
      const effect = [red * phosphor * (1 + redMask), green * phosphor * (1 + greenMask), blue * phosphor * (1 + blueMask)];
      const base = [source[index] / 255, source[index + 1] / 255, source[index + 2] / 255];
      const color = blendColor(base, effect, strength);
      output[index] = Math.round(clamp(color[0], 0, 1, 0) * 255);
      output[index + 1] = Math.round(clamp(color[1], 0, 1, 0) * 255);
      output[index + 2] = Math.round(clamp(color[2], 0, 1, 0) * 255);
    }
  }
  return createImageData(width, height, output);
}

const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function renderPixelate(sourceImageData, params) {
  const { width, height } = getDimensions(sourceImageData);
  const source = sourceImageData.data;
  const output = new Uint8ClampedArray(source);
  const amount = params.effectAmount / 100;
  const block = Math.max(2, params.pixelBlockSize);
  const levels = Math.max(2, params.pixelLevels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const blockX = Math.floor(x / block);
      const blockY = Math.floor(y / block);
      const cellX = blockX * block + Math.floor((block - 1) * 0.5);
      const cellY = blockY * block + Math.floor((block - 1) * 0.5);
      const color = sampleColor(source, width, height, cellX, cellY);
      const threshold = (BAYER_4[(blockY % 4) * 4 + (blockX % 4)] / 16 - 0.5) * (params.pixelDither / 100) / levels;
      const quantized = color.map((value) => clamp(Math.round((value + threshold) * (levels - 1)) / (levels - 1), 0, 1, value));
      const lumaAt = (sx, sy) => {
        const r = sampleRgb(source, width, height, sx, sy, 0);
        const g = sampleRgb(source, width, height, sx, sy, 1);
        const b = sampleRgb(source, width, height, sx, sy, 2);
        return r * 0.2126 + g * 0.7152 + b * 0.0722;
      };
      const edgeGradient = Math.abs(lumaAt(x + 1, y) - lumaAt(x - 1, y)) + Math.abs(lumaAt(x, y + 1) - lumaAt(x, y - 1));
      const preserve = params.pixelEdgePreserve / 100 * smoothstep(0.035, 0.24, edgeGradient);
      const colorOut = blendColor([source[index] / 255, source[index + 1] / 255, source[index + 2] / 255], quantized, amount * (1 - preserve));
      output[index] = Math.round(colorOut[0] * 255);
      output[index + 1] = Math.round(colorOut[1] * 255);
      output[index + 2] = Math.round(colorOut[2] * 255);
    }
  }
  return createImageData(width, height, output);
}

function renderWind(sourceImageData, params) {
  const { width, height } = getDimensions(sourceImageData);
  const source = sourceImageData.data;
  const output = new Uint8ClampedArray(source);
  const [dx, dy] = directionVector(params.windDirection);
  const maxDimension = Math.max(width, height);
  const length = params.windLength / 100 * maxDimension * 0.14;
  const amount = params.effectAmount / 100;
  const breakup = params.windBreakup / 100;
  const noiseScale = Math.max(3, length * 0.22);
  const tapCount = width * height > 2000000 ? 3 : 9;
  const tapFractions = new Float32Array(tapCount);
  for (let tap = 0; tap < tapFractions.length; tap += 1) {
    const t = tap / Math.max(1, tapFractions.length - 1);
    tapFractions[tap] = clamp(t + (valueNoise2d(t * 2, 0, 9137) - 0.5) * 0.18, 0, 1, t);
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const ux = width > 1 ? x / (width - 1) : 0.5;
      const uy = height > 1 ? y / (height - 1) : 0.5;
      const edgeDistance = Math.min(1, Math.min(Math.min(ux, 1 - ux), Math.min(uy, 1 - uy)) * 2);
      const edgeGate = lerp(1, 0.35 + 0.65 * smoothstep(0.02, 0.34, edgeDistance), params.windEdgeProtect / 100);
      let sum = [0, 0, 0];
      let weightSum = 0;
      for (let tap = 0; tap < tapCount; tap += 1) {
        const jitteredT = tapFractions[tap];
        const distance = jitteredT * length;
        const sampleX = x - dx * distance;
        const sampleY = y - dy * distance;
        const inside = sampleX >= 0 && sampleX <= width - 1 && sampleY >= 0 && sampleY <= height - 1 ? 1 : 0;
        const noise = valueNoise2d(sampleX / noiseScale, sampleY / noiseScale, 9173);
        const continuity = lerp(1, smoothstep(0.18, 0.82, noise), breakup);
        const weight = (0.14 + 0.86 * Math.pow(1 - jitteredT, 1.55)) * continuity * inside;
        const color = sampleColor(source, width, height, sampleX, sampleY);
        sum[0] += color[0] * weight;
        sum[1] += color[1] * weight;
        sum[2] += color[2] * weight;
        weightSum += weight;
      }
      const dragged = weightSum > 0.0001 ? sum.map((value) => value / weightSum) : [source[index] / 255, source[index + 1] / 255, source[index + 2] / 255];
      const base = [source[index] / 255, source[index + 1] / 255, source[index + 2] / 255];
      const color = blendColor(base, dragged, amount * edgeGate);
      output[index] = Math.round(color[0] * 255);
      output[index + 1] = Math.round(color[1] * 255);
      output[index + 2] = Math.round(color[2] * 255);
    }
  }
  return createImageData(width, height, output);
}

function renderShatter(sourceImageData, params) {
  const { width, height } = getDimensions(sourceImageData);
  const source = sourceImageData.data;
  const output = new Uint8ClampedArray(source);
  const size = Math.max(8, params.shatterFragmentSize);
  const [dx, dy] = directionVector(params.shatterDirection);
  const perpendicularX = -dy;
  const perpendicularY = dx;
  const scatter = params.shatterScatter / 100 * size * 0.92;
  const amount = params.effectAmount / 100;
  const crackStrength = params.shatterCracks / 100;
  const seed = Math.round(params.seed || 0);
  const siteColumns = Math.ceil(width / size) + 2;
  const siteRows = Math.ceil(height / size) + 2;
  const sites = new Array(siteColumns * siteRows);
  for (let cellY = -1; cellY <= Math.ceil(height / size); cellY += 1) {
    for (let cellX = -1; cellX <= Math.ceil(width / size); cellX += 1) {
      sites[(cellY + 1) * siteColumns + cellX + 1] = shatterSite(cellX, cellY, size, seed);
    }
  }
  const getSite = (cellX, cellY) => sites[(cellY + 1) * siteColumns + cellX + 1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const baseCellX = Math.floor(x / size);
      const baseCellY = Math.floor(y / size);
      const localGridX = x / size - baseCellX;
      const localGridY = y / size - baseCellY;
      const originCellX = baseCellX + (localGridX < 0.5 ? -1 : 0);
      const originCellY = baseCellY + (localGridY < 0.5 ? -1 : 0);
      let nearestDistance = Number.POSITIVE_INFINITY;
      let secondDistance = Number.POSITIVE_INFINITY;
      let nearestSite = null;
      for (let oy = 0; oy < 2; oy += 1) {
        for (let ox = 0; ox < 2; ox += 1) {
          const candidateX = originCellX + ox;
          const candidateY = originCellY + oy;
          const site = getSite(candidateX, candidateY);
          const distance = (x - site.x) ** 2 + (y - site.y) ** 2;
          if (distance < nearestDistance) {
            secondDistance = nearestDistance;
            nearestDistance = distance;
            nearestSite = site;
          } else if (distance < secondDistance) {
            secondDistance = distance;
          }
        }
      }
      const localX = x - nearestSite.x;
      const localY = y - nearestSite.y;
      const c = cosApprox(nearestSite.angle * amount);
      const s = sinApprox(nearestSite.angle * amount);
      const rotatedX = localX * c - localY * s;
      const rotatedY = localX * s + localY * c;
      const scatterDistance = scatter * (0.22 + nearestSite.scatter * 0.78) * amount;
      const crossDistance = scatter * nearestSite.cross * 0.34 * amount;
      const sourceX = nearestSite.x + rotatedX - dx * scatterDistance - perpendicularX * crossDistance;
      const sourceY = nearestSite.y + rotatedY - dy * scatterDistance - perpendicularY * crossDistance;
      const fragment = sampleColor(source, width, height, sourceX, sourceY);
      const boundaryGap = Math.max(0, Math.sqrt(secondDistance) - Math.sqrt(nearestDistance));
      const crack = smoothstep(0, size * (0.008 + crackStrength * 0.052), boundaryGap);
      const crackEdge = 1 - crack;
      const aberration = crackEdge * crackStrength * 0.05;
      const shaded = 1 - crackEdge * crackStrength * 0.72;
      const fragmentColor = [fragment[0] + aberration, fragment[1] * (0.96 + crack * 0.04), fragment[2] + aberration * 1.25];
      const color = blendColor([source[index] / 255, source[index + 1] / 255, source[index + 2] / 255], fragmentColor.map((value) => value * shaded), amount);
      output[index] = Math.round(clamp(color[0], 0, 1, 0) * 255);
      output[index + 1] = Math.round(clamp(color[1], 0, 1, 0) * 255);
      output[index + 2] = Math.round(clamp(color[2], 0, 1, 0) * 255);
    }
  }
  return createImageData(width, height, output);
}

export function renderPostFxImageData(sourceImageData, inputParams = {}, options = {}) {
  const params = normalizePostFxParams(inputParams);
  if (!params.effectEnabled || params.effectAmount <= 0) {
    return params.filmFinish && params.effectType !== "film"
      ? renderFilmImageData(sourceImageData, params, options)
      : cloneSource(sourceImageData);
  }
  let result = sourceImageData;
  if (params.effectType === "crt") result = renderCrt(sourceImageData, params);
  else if (params.effectType === "pixelate") result = renderPixelate(sourceImageData, params);
  else if (params.effectType === "wind") result = renderWind(sourceImageData, params);
  else if (params.effectType === "shatter") result = renderShatter(sourceImageData, params);
  if (params.effectType === "film" || params.filmFinish) {
    const filmAmount = params.effectType === "film"
      ? params.amount * params.effectAmount / 100
      : params.amount;
    result = renderFilmImageData(result, { ...params, amount: filmAmount }, options);
  }
  return result;
}

export const renderEffectImageData = renderPostFxImageData;
export const normalizeEffectParams = normalizePostFxParams;

export const POST_FX_DEFAULTS = DEFAULT_POST_FX_PARAMS;
