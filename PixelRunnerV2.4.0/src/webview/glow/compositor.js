(function initGlowCompositorModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function applySaturation(r, g, b, saturation) {
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    return [
      luma + (r - luma) * saturation,
      luma + (g - luma) * saturation,
      luma + (b - luma) * saturation
    ];
  }

  function softShoulder(value, shoulder) {
    const safeShoulder = clamp(shoulder, 0.1, 0.95);
    return value / (1 + value * safeShoulder);
  }

  function sampleChannelNearest(layer, x, y, channel) {
    const sx = Math.min(layer.width - 1, Math.max(0, Math.round(x)));
    const sy = Math.min(layer.height - 1, Math.max(0, Math.round(y)));
    return channel[sy * layer.width + sx];
  }

  function getChromaticOffset(params) {
    return Math.max(0, Math.min(10, (Number(params.composite.chromatic) || 0) * Math.max(1, Number(params.radius) || 1) * 0.07));
  }

  function applyGlowColorShift(r, g, b, shift) {
    const amount = clamp(Number(shift) || 0, -1, 1);
    if (amount >= 0) {
      return [
        r * (1 + amount * 0.34),
        g * (1 + amount * 0.1),
        b * (1 - amount * 0.24)
      ];
    }
    const cool = -amount;
    return [
      r * (1 - cool * 0.18),
      g * (1 + cool * 0.04),
      b * (1 + cool * 0.38)
    ];
  }

  function composeProtected(baseImageData, glowLayer, masks, params) {
    const { width, height, data } = baseImageData;
    const out = new ImageData(width, height);
    const chromaticOffset = getChromaticOffset(params);
    for (let pixel = 0, index = 0; pixel < glowLayer.r.length; pixel += 1, index += 4) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const baseR = data[index] / 255;
      const baseG = data[index + 1] / 255;
      const baseB = data[index + 2] / 255;
      const baseLuma = masks.luma[pixel];
      const source = masks.sourceMask[pixel];
      const protect = masks.protectMask[pixel];
      const darkProtect = masks.darkProtect[pixel];
      const highlightProtect = protect * params.composite.highlightProtect * (0.45 + baseLuma * 0.72);
      const shadowProtect = darkProtect * params.composite.shadowProtect;
      const sourceAnchor = 0.62 + source * 0.38;
      const protectGain = clamp((1 - highlightProtect * 0.72) * (1 - shadowProtect * 0.82) * sourceAnchor, 0, 1);
      const layerR = chromaticOffset > 0 ? sampleChannelNearest(glowLayer, x + chromaticOffset, y, glowLayer.r) : glowLayer.r[pixel];
      const layerG = glowLayer.g[pixel];
      const layerB = chromaticOffset > 0 ? sampleChannelNearest(glowLayer, x - chromaticOffset, y, glowLayer.b) : glowLayer.b[pixel];
      let warmedR = layerR * (1 + params.composite.warmth);
      let warmedG = layerG * (1 + params.composite.warmth * 0.35);
      let warmedB = layerB * (1 - params.composite.warmth * 0.28);
      [warmedR, warmedG, warmedB] = applyGlowColorShift(warmedR, warmedG, warmedB, params.composite.colorShift);
      const [satR, satG, satB] = applySaturation(warmedR, warmedG, warmedB, params.composite.saturation);
      const glowR = clamp(softShoulder(Math.max(0, satR) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);
      const glowG = clamp(softShoulder(Math.max(0, satG) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);
      const glowB = clamp(softShoulder(Math.max(0, satB) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);

      const screenR = 1 - (1 - baseR) * (1 - glowR);
      const screenG = 1 - (1 - baseG) * (1 - glowG);
      const screenB = 1 - (1 - baseB) * (1 - glowB);
      const softR = clamp(baseR + glowR * (1 - baseR * (0.58 + protect * 0.34)), 0, 1);
      const softG = clamp(baseG + glowG * (1 - baseG * (0.58 + protect * 0.34)), 0, 1);
      const softB = clamp(baseB + glowB * (1 - baseB * (0.58 + protect * 0.34)), 0, 1);
      const mix = params.composite.softAddMix;
      const colorProtect = clamp(1 - Math.max(glowR, glowG, glowB) * params.composite.colorProtect, 0.84, 1);
      const resultR = (screenR * (1 - mix) + softR * mix) * colorProtect + baseR * (1 - colorProtect);
      const resultG = (screenG * (1 - mix) + softG * mix) * colorProtect + baseG * (1 - colorProtect);
      const resultB = (screenB * (1 - mix) + softB * mix) * colorProtect + baseB * (1 - colorProtect);

      out.data[index] = Math.round(clamp(resultR, 0, 1) * 255);
      out.data[index + 1] = Math.round(clamp(resultG, 0, 1) * 255);
      out.data[index + 2] = Math.round(clamp(resultB, 0, 1) * 255);
      out.data[index + 3] = data[index + 3];
    }
    return out;
  }

  function renderGlowLayer(glowLayer, masks, params) {
    const out = new ImageData(glowLayer.width, glowLayer.height);
    const data = out.data;
    const chromaticOffset = getChromaticOffset(params);
    for (let pixel = 0, index = 0; pixel < glowLayer.r.length; pixel += 1, index += 4) {
      const x = pixel % glowLayer.width;
      const y = Math.floor(pixel / glowLayer.width);
      const source = masks.sourceMask[pixel];
      const protect = masks.protectMask[pixel];
      const darkProtect = masks.darkProtect[pixel];
      const highlightProtect = protect * params.composite.highlightProtect * 0.82;
      const shadowProtect = darkProtect * params.composite.shadowProtect;
      const sourceAnchor = 0.62 + source * 0.38;
      const protectGain = clamp((1 - highlightProtect * 0.72) * (1 - shadowProtect * 0.82) * sourceAnchor, 0, 1);
      const layerR = chromaticOffset > 0 ? sampleChannelNearest(glowLayer, x + chromaticOffset, y, glowLayer.r) : glowLayer.r[pixel];
      const layerG = glowLayer.g[pixel];
      const layerB = chromaticOffset > 0 ? sampleChannelNearest(glowLayer, x - chromaticOffset, y, glowLayer.b) : glowLayer.b[pixel];
      let warmedR = layerR * (1 + params.composite.warmth);
      let warmedG = layerG * (1 + params.composite.warmth * 0.35);
      let warmedB = layerB * (1 - params.composite.warmth * 0.28);
      [warmedR, warmedG, warmedB] = applyGlowColorShift(warmedR, warmedG, warmedB, params.composite.colorShift);
      const [satR, satG, satB] = applySaturation(warmedR, warmedG, warmedB, params.composite.saturation);
      const glowR = clamp(softShoulder(Math.max(0, satR) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);
      const glowG = clamp(softShoulder(Math.max(0, satG) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);
      const glowB = clamp(softShoulder(Math.max(0, satB) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);
      const alpha = clamp(Math.max(glowR, glowG, glowB), 0, 1);
      data[index] = Math.round(clamp(glowR, 0, 1) * 255);
      data[index + 1] = Math.round(clamp(glowG, 0, 1) * 255);
      data[index + 2] = Math.round(clamp(glowB, 0, 1) * 255);
      data[index + 3] = Math.round(alpha * 255);
    }
    return out;
  }

  modules.glowCompositor = {
    composeProtected,
    renderGlowLayer
  };
})(window);
