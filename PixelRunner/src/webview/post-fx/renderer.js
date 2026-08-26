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
  grain: 16,
  grainSize: 2,
  grainColor: 18,
  vignette: 12,
  vignetteMidpoint: 62,
  vignetteFeather: 68,
  dispersion: 10,
  dispersionRadius: 58,
  dispersionHighlightsOnly: true,
  seed: 4817
});

const PRESETS = Object.freeze({
  natural: {
    label: "自然胶片",
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
    grain: 16,
    grainSize: 2,
    grainColor: 18,
    vignette: 12,
    dispersion: 10,
    dispersionRadius: 58
  },
  ccd: {
    label: "CCD 直闪",
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
    grain: 22,
    grainSize: 2,
    grainColor: 24,
    vignette: 16,
    dispersion: 16,
    dispersionRadius: 72
  },
  blueHour: {
    label: "蓝调 Live",
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
    grain: 12,
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
    dispersionHighlightsOnly: merged.dispersionHighlightsOnly !== false,
    seed: Math.round(clamp(merged.seed, 0, 2147483647, DEFAULT_FILM_PARAMS.seed))
  };
}

export function getFilmPresets() {
  return Object.entries(PRESETS).map(([id, preset]) => ({ id, label: preset.label }));
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
  const dispersionShift = maxDimension * 0.012 * (params.dispersion / 100) * (params.dispersionRadius / 100);
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
      const radial = distance * distance;
      const sourceLuma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      if (dispersionEnabled) {
        const highlightMix = params.dispersionHighlightsOnly ? smoothstep(0.42, 0.86, sourceLuma) : 1;
        const shift = dispersionShift * radial * highlightMix;
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

  const grainStrength = params.grain / 100 * amount * 0.16;
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
        const noise = hashNoise(Math.floor(globalX / grainSize), Math.floor(globalY / grainSize), params.seed) - 0.5;
        const monochrome = noise * grainStrength;
        const chromaNoise = (hashNoise(Math.floor(globalX / grainSize) + 17, Math.floor(globalY / grainSize) - 11, params.seed + 97) - 0.5) * grainStrength;
        output[index] = Math.round(clamp(output[index] / 255 + monochrome * (1 - colorGrain) + (monochrome + chromaNoise) * colorGrain * 0.45, 0, 1, 0) * 255);
        output[index + 1] = Math.round(clamp(output[index + 1] / 255 + monochrome * (1 - colorGrain) + monochrome * colorGrain * 0.25, 0, 1, 0) * 255);
        output[index + 2] = Math.round(clamp(output[index + 2] / 255 + monochrome * (1 - colorGrain) + (monochrome - chromaNoise) * colorGrain * 0.45, 0, 1, 0) * 255);
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
