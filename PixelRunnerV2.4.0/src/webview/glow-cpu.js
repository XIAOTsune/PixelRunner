(function initGlowCpuModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  function clamp(value, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
  }

  function smoothstep(edge0, edge1, value) {
    const width = Math.max(0.0001, edge1 - edge0);
    const t = clamp((value - edge0) / width, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function getStyleParams(style) {
    const key = String(style || "").trim().toLowerCase();
    if (key === "soft") {
      return {
        thresholdBias: -0.04,
        opacity: 0.82,
        spread: 1.08,
        warmth: 0.03,
        saturation: 0.86
      };
    }
    if (key === "dreamy") {
      return {
        thresholdBias: -0.08,
        opacity: 1.12,
        spread: 1.22,
        warmth: 0.07,
        saturation: 1.08
      };
    }
    return {
      thresholdBias: 0,
      opacity: 1,
      spread: 1,
      warmth: 0.04,
      saturation: 1
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to load glow source image"));
      image.src = src;
    });
  }

  function createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(width));
    canvas.height = Math.max(1, Math.floor(height));
    return canvas;
  }

  function getImageDataFromSource(image) {
    const canvas = createCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D is unavailable for CPU glow");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return {
      width: canvas.width,
      height: canvas.height,
      imageData: ctx.getImageData(0, 0, canvas.width, canvas.height)
    };
  }

  function createEmptyLayer(width, height) {
    return {
      width,
      height,
      r: new Float32Array(width * height),
      g: new Float32Array(width * height),
      b: new Float32Array(width * height)
    };
  }

  function downsampleLayer(layer) {
    const nextWidth = Math.max(1, Math.floor(layer.width / 2));
    const nextHeight = Math.max(1, Math.floor(layer.height / 2));
    const out = createEmptyLayer(nextWidth, nextHeight);

    for (let y = 0; y < nextHeight; y += 1) {
      for (let x = 0; x < nextWidth; x += 1) {
        const sx = x * 2;
        const sy = y * 2;
        const indexes = [
          sy * layer.width + sx,
          sy * layer.width + Math.min(layer.width - 1, sx + 1),
          Math.min(layer.height - 1, sy + 1) * layer.width + sx,
          Math.min(layer.height - 1, sy + 1) * layer.width + Math.min(layer.width - 1, sx + 1)
        ];
        const target = y * nextWidth + x;
        out.r[target] = (layer.r[indexes[0]] + layer.r[indexes[1]] + layer.r[indexes[2]] + layer.r[indexes[3]]) * 0.25;
        out.g[target] = (layer.g[indexes[0]] + layer.g[indexes[1]] + layer.g[indexes[2]] + layer.g[indexes[3]]) * 0.25;
        out.b[target] = (layer.b[indexes[0]] + layer.b[indexes[1]] + layer.b[indexes[2]] + layer.b[indexes[3]]) * 0.25;
      }
    }

    return out;
  }

  function blurChannelHorizontal(src, width, height, radius) {
    const out = new Float32Array(src.length);
    const size = radius * 2 + 1;
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      for (let x = -radius; x <= radius; x += 1) {
        sum += src[row + Math.min(width - 1, Math.max(0, x))];
      }
      for (let x = 0; x < width; x += 1) {
        out[row + x] = sum / size;
        const removeX = Math.max(0, x - radius);
        const addX = Math.min(width - 1, x + radius + 1);
        sum += src[row + addX] - src[row + removeX];
      }
    }
    return out;
  }

  function blurChannelVertical(src, width, height, radius) {
    const out = new Float32Array(src.length);
    const size = radius * 2 + 1;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = -radius; y <= radius; y += 1) {
        sum += src[Math.min(height - 1, Math.max(0, y)) * width + x];
      }
      for (let y = 0; y < height; y += 1) {
        out[y * width + x] = sum / size;
        const removeY = Math.max(0, y - radius);
        const addY = Math.min(height - 1, y + radius + 1);
        sum += src[addY * width + x] - src[removeY * width + x];
      }
    }
    return out;
  }

  function boxBlurLayer(layer, radius, passes = 2) {
    const blurRadius = Math.max(1, Math.floor(radius));
    let r = layer.r;
    let g = layer.g;
    let b = layer.b;

    for (let pass = 0; pass < passes; pass += 1) {
      r = blurChannelVertical(blurChannelHorizontal(r, layer.width, layer.height, blurRadius), layer.width, layer.height, blurRadius);
      g = blurChannelVertical(blurChannelHorizontal(g, layer.width, layer.height, blurRadius), layer.width, layer.height, blurRadius);
      b = blurChannelVertical(blurChannelHorizontal(b, layer.width, layer.height, blurRadius), layer.width, layer.height, blurRadius);
    }

    return {
      width: layer.width,
      height: layer.height,
      r,
      g,
      b
    };
  }

  function addLayerUpsampled(target, source, weight) {
    const xScale = source.width / target.width;
    const yScale = source.height / target.height;
    for (let y = 0; y < target.height; y += 1) {
      const sy = Math.min(source.height - 1, Math.floor((y + 0.5) * yScale));
      for (let x = 0; x < target.width; x += 1) {
        const sx = Math.min(source.width - 1, Math.floor((x + 0.5) * xScale));
        const sourceIndex = sy * source.width + sx;
        const targetIndex = y * target.width + x;
        target.r[targetIndex] += source.r[sourceIndex] * weight;
        target.g[targetIndex] += source.g[sourceIndex] * weight;
        target.b[targetIndex] += source.b[sourceIndex] * weight;
      }
    }
  }

  function buildHighlightLayer(imageData, config) {
    const { width, height, data } = imageData;
    const layer = createEmptyLayer(width, height);
    const style = getStyleParams(config.style);
    const thresholdRatio = clamp(Number(config.threshold) || 0, 0, 100) / 100;
    const radiusRatio = clamp(Number(config.radius) || 1, 1, 120) / 120;
    const brightnessLift = clamp(Number(config.brightnessBias) || 0, -50, 50) / 50;
    const threshold = clamp(0.34 + thresholdRatio * 0.62 + style.thresholdBias * 0.3 - brightnessLift * 0.05, 0.28, 0.97);
    const softness = clamp(0.18 - thresholdRatio * 0.11 + radiusRatio * 0.03, 0.045, 0.2);
    const exposure = 0.88 + brightnessLift * 0.28;

    for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
      const r = data[index] / 255;
      const g = data[index + 1] / 255;
      const b = data[index + 2] / 255;
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const mask = smoothstep(threshold - softness, threshold + softness, luma);
      const excess = clamp((luma - threshold + softness) / Math.max(0.001, 1 - threshold + softness), 0, 1);
      const gain = mask * Math.pow(excess, 0.58) * exposure;
      layer.r[pixel] = Math.min(1, r * gain);
      layer.g[pixel] = Math.min(1, g * gain);
      layer.b[pixel] = Math.min(1, b * gain);
    }

    return layer;
  }

  function buildPyramidGlow(highlight, config) {
    const radius = clamp(Number(config.radius) || 1, 1, 120);
    const style = getStyleParams(config.style);
    const radiusRatio = radius / 120;
    const levels = [highlight];
    while (levels.length < 5 && levels[levels.length - 1].width > 24 && levels[levels.length - 1].height > 24) {
      levels.push(downsampleLayer(levels[levels.length - 1]));
    }

    const out = createEmptyLayer(highlight.width, highlight.height);
    const detailWeight = 0.035 - radiusRatio * 0.025;
    const wideWeight = 0.08 + radiusRatio * 0.2;
    const weights = [detailWeight, 0.2, 0.3, 0.22 + radiusRatio * 0.08, wideWeight];
    for (let level = 0; level < levels.length; level += 1) {
      const scaleRadius = Math.max(1, Math.round((radius * style.spread * (0.8 + radiusRatio * 0.8)) / Math.pow(2, level + 0.65)));
      const blurred = boxBlurLayer(levels[level], Math.min(scaleRadius, 56), level <= 1 ? 1 : 2);
      addLayerUpsampled(out, blurred, weights[level] || 0.06);
    }
    return out;
  }

  function applySaturation(r, g, b, saturation) {
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    return [
      luma + (r - luma) * saturation,
      luma + (g - luma) * saturation,
      luma + (b - luma) * saturation
    ];
  }

  async function createGlowPng(sourceDataUrl, config = {}) {
    if (!sourceDataUrl) throw new Error("Glow source image is missing");

    const startedAt = performance.now();
    const image = await loadImage(sourceDataUrl);
    const source = getImageDataFromSource(image);
    const highlight = buildHighlightLayer(source.imageData, config);
    const glow = buildPyramidGlow(highlight, config);
    const style = getStyleParams(config.style);
    const strength = clamp(Number(config.strength) || 0, 0, 100) / 100;
    const saturation = clamp(1 + (Number(config.saturation) || 0) / 100 * 0.38, 0.55, 1.42) * style.saturation;
    const intensity = strength * style.opacity * 1.75;
    const canvas = createCanvas(source.width, source.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is unavailable for CPU glow output");
    const output = ctx.createImageData(source.width, source.height);
    const previewCanvas = createCanvas(source.width, source.height);
    const previewCtx = previewCanvas.getContext("2d");
    if (!previewCtx) throw new Error("Canvas 2D is unavailable for CPU glow preview");
    const preview = previewCtx.createImageData(source.width, source.height);

    for (let pixel = 0, index = 0; pixel < glow.r.length; pixel += 1, index += 4) {
      const warmedR = glow.r[pixel] * (1 + style.warmth);
      const warmedG = glow.g[pixel] * (1 + style.warmth * 0.42);
      const warmedB = glow.b[pixel] * (1 - style.warmth * 0.35);
      const [sr, sg, sb] = applySaturation(warmedR, warmedG, warmedB, saturation);
      const effectR = clamp(sr * intensity, 0, 1);
      const effectG = clamp(sg * intensity, 0, 1);
      const effectB = clamp(sb * intensity, 0, 1);
      const luma = Math.max(effectR, effectG, effectB);
      const alpha = clamp(Math.pow(luma, 0.72) * 0.86, 0, 0.86);
      output.data[index] = Math.round(effectR * 255);
      output.data[index + 1] = Math.round(effectG * 255);
      output.data[index + 2] = Math.round(effectB * 255);
      output.data[index + 3] = 255;

      const baseR = source.imageData.data[index] / 255;
      const baseG = source.imageData.data[index + 1] / 255;
      const baseB = source.imageData.data[index + 2] / 255;
      const screenR = 1 - (1 - baseR) * (1 - effectR);
      const screenG = 1 - (1 - baseG) * (1 - effectG);
      const screenB = 1 - (1 - baseB) * (1 - effectB);
      preview.data[index] = Math.round(screenR * 255);
      preview.data[index + 1] = Math.round(screenG * 255);
      preview.data[index + 2] = Math.round(screenB * 255);
      preview.data[index + 3] = source.imageData.data[index + 3];
    }

    ctx.putImageData(output, 0, 0);
    previewCtx.putImageData(preview, 0, 0);

    return {
      dataUrl: canvas.toDataURL("image/png"),
      previewDataUrl: previewCanvas.toDataURL("image/jpeg", 0.9),
      width: source.width,
      height: source.height,
      elapsedMs: Math.round(performance.now() - startedAt),
      layerMode: "black-screen"
    };
  }

  modules.glowCpu = {
    createGlowPng
  };
})(window);
