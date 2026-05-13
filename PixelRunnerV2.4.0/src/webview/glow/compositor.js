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
    const c = Math.max(0, Math.min(1, Number(params.composite.chromatic) || 0));
    const curved = Math.pow(c, 0.96);
    return Math.max(0, Math.min(30, curved * (4.2 + Math.sqrt(Math.max(1, Number(params.radius) || 1)) * 1.22)));
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

  function applyGlowTint(r, g, b, params) {
    const amount = clamp(Number(params.composite.colorAmount) || 0, 0, 1);
    if (amount <= 0.0001) return [r, g, b];
    const tint = Array.isArray(params.composite.colorTint) ? params.composite.colorTint : [1, 0.82, 0.48];
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const tintR = luma * (tint[0] || 1) * 1.32;
    const tintG = luma * (tint[1] || 1) * 1.32;
    const tintB = luma * (tint[2] || 1) * 1.32;
    return [
      r * (1 - amount) + tintR * amount,
      g * (1 - amount) + tintG * amount,
      b * (1 - amount) + tintB * amount
    ];
  }

  function splitCoreAndHalo(glow, baseLuma, protect, source, params) {
    const coreSuppression = clamp(Number(params.composite.coreSuppression) || 0.5, 0, 1);
    const haloBoost = Math.max(0, Number(params.composite.haloBoost) || 1);
    const haloMix = clamp(Number(params.composite.haloMix) || 0.5, 0, 1);
    const brightCoreGate = clamp(1 - baseLuma * (0.64 + coreSuppression * 0.28), 0.12, 1);
    const protectCoreGate = clamp(1 - protect * (0.46 + coreSuppression * 0.4), 0.08, 1);
    const coreGate = brightCoreGate * protectCoreGate;
    const glowLuma = glow[0] * 0.2126 + glow[1] * 0.7152 + glow[2] * 0.0722;
    const energyGate = Math.pow(clamp(glowLuma, 0, 1), 0.66);
    // The source stage already decides where light exists; do not lift dark image shapes into halo.
    const haloGate = clamp(
      (1 - protect * 0.5) * (0.28 + source * 0.72) * (0.5 + energyGate),
      0,
      1.12
    );
    const coreScale = 1 - haloMix * 0.48;
    const haloScale = 1 + haloMix * 0.66;
    const coreR = glow[0] * coreGate * coreScale;
    const coreG = glow[1] * coreGate * coreScale;
    const coreB = glow[2] * coreGate * coreScale;
    const haloR = glow[0] * haloGate * haloBoost * haloScale;
    const haloG = glow[1] * haloGate * haloBoost * haloScale;
    const haloB = glow[2] * haloGate * haloBoost * haloScale;
    return [
      clamp(coreR * (1 - haloMix) + haloR * haloMix, 0, 1),
      clamp(coreG * (1 - haloMix) + haloG * haloMix, 0, 1),
      clamp(coreB * (1 - haloMix) + haloB * haloMix, 0, 1)
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
      const haloSource = masks.haloMask ? masks.haloMask[pixel] : source;
      const protect = masks.protectMask[pixel];
      const baseSat = Math.max(baseR, baseG, baseB) > 0 ? (Math.max(baseR, baseG, baseB) - Math.min(baseR, baseG, baseB)) / Math.max(baseR, baseG, baseB) : 0;
      const highlightProtect = protect * params.composite.highlightProtect * (0.5 + baseLuma * 0.78 + (1 - baseSat) * 0.08);
      const radiusRatio = clamp((Number(params.radius) || 0) / 500, 0, 1);
      const sourceAnchor = (0.12 + radiusRatio * 0.04) + haloSource * (0.72 - radiusRatio * 0.18);
      const protectGain = clamp((1 - highlightProtect * 0.42) * sourceAnchor, 0, 1);
      const layerR = chromaticOffset > 0 ? sampleChannelNearest(glowLayer, x + chromaticOffset, y, glowLayer.r) : glowLayer.r[pixel];
      const layerG = glowLayer.g[pixel];
      const layerB = chromaticOffset > 0 ? sampleChannelNearest(glowLayer, x - chromaticOffset, y, glowLayer.b) : glowLayer.b[pixel];
      const centerMax = Math.max(glowLayer.r[pixel], glowLayer.g[pixel], glowLayer.b[pixel]);
      const chromaStrength = Math.pow(Math.max(0, Math.min(1, params.composite.chromatic || 0)), 1.02);
      const edgeGate = source * (0.68 + (1 - protect) * 0.32);
      const redEdge = chromaticOffset > 0 ? Math.max(0, layerR - centerMax * 0.62) * chromaStrength * 2.18 * edgeGate : 0;
      const blueEdge = chromaticOffset > 0 ? Math.max(0, layerB - centerMax * 0.62) * chromaStrength * 2.18 * edgeGate : 0;
      let warmedR = layerR * (1 + params.composite.warmth);
      let warmedG = layerG * (1 + params.composite.warmth * 0.35);
      let warmedB = layerB * (1 - params.composite.warmth * 0.28);
      [warmedR, warmedG, warmedB] = applyGlowColorShift(warmedR, warmedG, warmedB, params.composite.colorShift);
      [warmedR, warmedG, warmedB] = applyGlowTint(warmedR, warmedG, warmedB, params);
      warmedR += redEdge;
      warmedB += blueEdge;
      const [satR, satG, satB] = applySaturation(warmedR, warmedG, warmedB, params.composite.saturation);
      const glowR = clamp(softShoulder(Math.max(0, satR) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);
      const glowG = clamp(softShoulder(Math.max(0, satG) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);
      const glowB = clamp(softShoulder(Math.max(0, satB) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);
      const [shapedR, shapedG, shapedB] = splitCoreAndHalo([glowR, glowG, glowB], baseLuma, protect, haloSource, params);

      const screenR = 1 - (1 - baseR) * (1 - shapedR);
      const screenG = 1 - (1 - baseG) * (1 - shapedG);
      const screenB = 1 - (1 - baseB) * (1 - shapedB);
      const softR = clamp(baseR + shapedR * (1 - baseR * (0.58 + protect * 0.34)), 0, 1);
      const softG = clamp(baseG + shapedG * (1 - baseG * (0.58 + protect * 0.34)), 0, 1);
      const softB = clamp(baseB + shapedB * (1 - baseB * (0.58 + protect * 0.34)), 0, 1);
      const mix = params.composite.softAddMix;
      const maxGlow = Math.max(shapedR, shapedG, shapedB);
      const colorProtect = clamp(1 - maxGlow * params.composite.colorProtect * (0.88 + baseSat * 0.22), 0.86, 1);
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
      const haloSource = masks.haloMask ? masks.haloMask[pixel] : source;
      const protect = masks.protectMask[pixel];
      const highlightProtect = protect * params.composite.highlightProtect * 0.86;
      const radiusRatio = clamp((Number(params.radius) || 0) / 500, 0, 1);
      const sourceAnchor = (0.12 + radiusRatio * 0.04) + haloSource * (0.72 - radiusRatio * 0.18);
      const protectGain = clamp((1 - highlightProtect * 0.42) * sourceAnchor, 0, 1);
      const layerR = chromaticOffset > 0 ? sampleChannelNearest(glowLayer, x + chromaticOffset, y, glowLayer.r) : glowLayer.r[pixel];
      const layerG = glowLayer.g[pixel];
      const layerB = chromaticOffset > 0 ? sampleChannelNearest(glowLayer, x - chromaticOffset, y, glowLayer.b) : glowLayer.b[pixel];
      const centerMax = Math.max(glowLayer.r[pixel], glowLayer.g[pixel], glowLayer.b[pixel]);
      const chromaStrength = Math.pow(Math.max(0, Math.min(1, params.composite.chromatic || 0)), 1.02);
      const edgeGate = source * (0.68 + (1 - protect) * 0.32);
      const redEdge = chromaticOffset > 0 ? Math.max(0, layerR - centerMax * 0.62) * chromaStrength * 2.18 * edgeGate : 0;
      const blueEdge = chromaticOffset > 0 ? Math.max(0, layerB - centerMax * 0.62) * chromaStrength * 2.18 * edgeGate : 0;
      let warmedR = layerR * (1 + params.composite.warmth);
      let warmedG = layerG * (1 + params.composite.warmth * 0.35);
      let warmedB = layerB * (1 - params.composite.warmth * 0.28);
      [warmedR, warmedG, warmedB] = applyGlowColorShift(warmedR, warmedG, warmedB, params.composite.colorShift);
      [warmedR, warmedG, warmedB] = applyGlowTint(warmedR, warmedG, warmedB, params);
      warmedR += redEdge;
      warmedB += blueEdge;
      const [satR, satG, satB] = applySaturation(warmedR, warmedG, warmedB, params.composite.saturation);
      const glowR = clamp(softShoulder(Math.max(0, satR) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);
      const glowG = clamp(softShoulder(Math.max(0, satG) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);
      const glowB = clamp(softShoulder(Math.max(0, satB) * params.composite.intensity * protectGain, params.composite.shoulder), 0, 1);
      const [shapedR, shapedG, shapedB] = splitCoreAndHalo([glowR, glowG, glowB], masks.luma[pixel], protect, haloSource, params);
      data[index] = Math.round(clamp(shapedR, 0, 1) * 255);
      data[index + 1] = Math.round(clamp(shapedG, 0, 1) * 255);
      data[index + 2] = Math.round(clamp(shapedB, 0, 1) * 255);
      // Photoshop Screen already uses RGB energy; alpha here would multiply the glow a second time.
      data[index + 3] = 255;
    }
    return out;
  }

  modules.glowCompositor = {
    composeProtected,
    renderGlowLayer
  };
})(window);
