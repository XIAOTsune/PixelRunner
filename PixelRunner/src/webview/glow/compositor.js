(function initGlowCompositorModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
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
    const safeShoulder = clamp(shoulder, 0.04, 0.95);
    return value / (1 + value * safeShoulder);
  }

  function linearToSrgb(value) {
    const v = Math.max(0, value);
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }

  function sampleChannelNearest(layer, x, y, channel) {
    const sx = Math.min(layer.width - 1, Math.max(0, Math.round(x)));
    const sy = Math.min(layer.height - 1, Math.max(0, Math.round(y)));
    return channel[sy * layer.width + sx];
  }

  function hashNoise(x, y, channel) {
    const seed = Math.sin((x * 12.9898 + y * 78.233 + channel * 37.719)) * 43758.5453;
    return seed - Math.floor(seed);
  }

  function visibilityGate(value, params) {
    const floor = clamp(Number(params.composite.energyFloor) || 0, 0, 0.4);
    if (floor <= 0.000001) return value;
    const softness = clamp(Number(params.composite.energyFloorSoftness) || 0.04, 0.001, 0.4);
    const gate = smoothstep(floor, floor + softness, value);
    return value * gate;
  }

  function getChromaticOffset(params) {
    const c = Math.max(0, Math.min(1, Number(params.composite.chromatic) || 0));
    const curved = Math.pow(c, 1.08);
    return Math.max(0, Math.min(20, curved * (2.4 + Math.sqrt(Math.max(1, Number(params.radius) || 1)) * 0.82)));
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

  function getCoreWeight(source) {
    return clamp((source - 0.025) / 0.495, 0, 1);
  }

  function getHaloWeight(source, haloSource, coreWeight = getCoreWeight(source)) {
    const halo = clamp(haloSource, 0, 1);
    const haloOnly = Math.max(0, halo - clamp(source, 0, 1));
    const relativeHalo = clamp(haloOnly / Math.max(0.001, halo), 0, 1);
    const nearHalo = clamp((halo - 0.0015) / 0.0735, 0, 1) * clamp((relativeHalo - 0.04) / 0.78, 0, 1);
    const farHalo = (1 - coreWeight) * 0.38;
    return clamp(Math.max(nearHalo, farHalo), 0, 1);
  }

  function getReceiverGain(baseLuma, protect, coreWeight, params) {
    const composite = params.composite;
    const externalGlow = 1 - coreWeight;
    const highlightGuard =
      clamp(protect, 0, 1) *
      clamp(Number(composite.highlightProtect) || 0, 0, 1) *
      (0.24 + clamp(baseLuma, 0, 1) * 0.36);
    const darkReceiver = clamp((0.34 - baseLuma) / 0.26, 0, 1);
    const shadowGuard = darkReceiver * clamp(Number(composite.shadowProtect) || 0, 0, 1) * 0.82;
    return clamp(1 - externalGlow * clamp(highlightGuard + shadowGuard, 0, 0.82), 0.18, 1);
  }

  function splitCoreAndHaloValue(glow, coreWeight, haloWeight, receiverGain, params) {
    const composite = params.composite;
    const coreSuppression = clamp(Number(composite.coreSuppression) || 0, 0, 1);
    const coreCeiling = clamp(Number(composite.coreCeiling) || 0, 0, 1);
    const haloBoost = Math.max(0, Number(composite.haloBoost) || 0);
    const haloMix = clamp(Number(composite.haloMix) || 0, 0, 1);
    const coreGain = 1 - coreWeight * coreSuppression;
    const coreLimit = coreCeiling + (1 - coreWeight) * (1 - coreCeiling);
    const shapedCore = Math.min(Math.max(0, glow) * coreGain, coreLimit);
    const shapedHalo = Math.max(0, glow) * (1 + haloBoost);
    const haloBlend = haloWeight * haloMix;
    return clamp((shapedCore * (1 - haloBlend) + shapedHalo * haloBlend) * receiverGain, 0, 1);
  }

  function composeProtected(baseImageData, glowLayer, masks, params) {
    const { width, height, data } = baseImageData;
    const out = new ImageData(width, height);
    const composite = params.composite;
    const intensity = Number(composite.intensity) || 0;
    if (intensity <= 0.000001) {
      out.data.set(data);
      return out;
    }
    const coreSuppression = clamp(Number(composite.coreSuppression) || 0, 0, 1);
    const coreCeiling = clamp(Number(composite.coreCeiling) || 0, 0, 1);
    const haloBoost = Math.max(0, Number(composite.haloBoost) || 0);
    const haloMix = clamp(Number(composite.haloMix) || 0, 0, 1);
    const highlightProtectAmount = clamp(Number(composite.highlightProtect) || 0, 0, 1);
    const shadowProtectAmount = clamp(Number(composite.shadowProtect) || 0, 0, 1);
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
      const coreWeight = clamp((source - 0.025) / 0.495, 0, 1);
      const halo = clamp(haloSource, 0, 1);
      const haloOnly = Math.max(0, halo - clamp(source, 0, 1));
      const relativeHalo = clamp(haloOnly / Math.max(0.001, halo), 0, 1);
      const nearHalo = clamp((halo - 0.0015) / 0.0735, 0, 1) * clamp((relativeHalo - 0.04) / 0.78, 0, 1);
      const haloWeight = Math.max(nearHalo, (1 - coreWeight) * 0.38);
      const externalGlow = 1 - coreWeight;
      const highlightGuard = protect * highlightProtectAmount * (0.24 + clamp(baseLuma, 0, 1) * 0.36);
      const darkReceiver = clamp((0.34 - baseLuma) / 0.26, 0, 1);
      const shadowGuard = darkReceiver * shadowProtectAmount * 0.82;
      const receiverGain = clamp(1 - externalGlow * clamp(highlightGuard + shadowGuard, 0, 0.82), 0.18, 1);
      const coreGain = 1 - coreWeight * coreSuppression;
      const coreLimit = coreCeiling + (1 - coreWeight) * (1 - coreCeiling);
      const haloBlend = haloWeight * haloMix;
      const coreBlend = 1 - haloBlend;
      const haloGain = 1 + haloBoost;
      const layerR = chromaticOffset > 0 ? sampleChannelNearest(glowLayer, x + chromaticOffset, y, glowLayer.r) : glowLayer.r[pixel];
      const layerG = glowLayer.g[pixel];
      const layerB = chromaticOffset > 0 ? sampleChannelNearest(glowLayer, x - chromaticOffset, y, glowLayer.b) : glowLayer.b[pixel];
      const centerMax = Math.max(glowLayer.r[pixel], glowLayer.g[pixel], glowLayer.b[pixel]);
      const chromaStrength = Math.pow(Math.max(0, Math.min(1, params.composite.chromatic || 0)), 1.16);
      const edgeGate = source * (0.44 + (1 - protect) * 0.24);
      const redEdge = chromaticOffset > 0 ? Math.max(0, layerR - centerMax * 0.7) * chromaStrength * 0.86 * edgeGate : 0;
      const blueEdge = chromaticOffset > 0 ? Math.max(0, layerB - centerMax * 0.7) * chromaStrength * 0.86 * edgeGate : 0;
      let warmedR = layerR * (1 + params.composite.warmth);
      let warmedG = layerG * (1 + params.composite.warmth * 0.35);
      let warmedB = layerB * (1 - params.composite.warmth * 0.28);
      [warmedR, warmedG, warmedB] = applyGlowColorShift(warmedR, warmedG, warmedB, params.composite.colorShift);
      [warmedR, warmedG, warmedB] = applyGlowTint(warmedR, warmedG, warmedB, params);
      warmedR += redEdge;
      warmedB += blueEdge;
      const [satR, satG, satB] = applySaturation(warmedR, warmedG, warmedB, params.composite.saturation);
      const glowR = clamp(softShoulder(Math.max(0, satR) * intensity, composite.shoulder), 0, 1);
      const glowG = clamp(softShoulder(Math.max(0, satG) * intensity, composite.shoulder), 0, 1);
      const glowB = clamp(softShoulder(Math.max(0, satB) * intensity, composite.shoulder), 0, 1);
      const rawR = clamp((Math.min(glowR * coreGain, coreLimit) * coreBlend + glowR * haloGain * haloBlend) * receiverGain, 0, 1);
      const rawG = clamp((Math.min(glowG * coreGain, coreLimit) * coreBlend + glowG * haloGain * haloBlend) * receiverGain, 0, 1);
      const rawB = clamp((Math.min(glowB * coreGain, coreLimit) * coreBlend + glowB * haloGain * haloBlend) * receiverGain, 0, 1);
      const shapedR = visibilityGate(rawR, params);
      const shapedG = visibilityGate(rawG, params);
      const shapedB = visibilityGate(rawB, params);
      const dither = 0.75 / 255;
      const glowSrgbR = Math.round(clamp(linearToSrgb(shapedR) + (hashNoise(x, y, 0) - 0.5) * dither, 0, 1) * 255) / 255;
      const glowSrgbG = Math.round(clamp(linearToSrgb(shapedG) + (hashNoise(x, y, 1) - 0.5) * dither, 0, 1) * 255) / 255;
      const glowSrgbB = Math.round(clamp(linearToSrgb(shapedB) + (hashNoise(x, y, 2) - 0.5) * dither, 0, 1) * 255) / 255;

      const screenR = 1 - (1 - baseR) * (1 - glowSrgbR);
      const screenG = 1 - (1 - baseG) * (1 - glowSrgbG);
      const screenB = 1 - (1 - baseB) * (1 - glowSrgbB);

      out.data[index] = Math.round(clamp(screenR, 0, 1) * 255);
      out.data[index + 1] = Math.round(clamp(screenG, 0, 1) * 255);
      out.data[index + 2] = Math.round(clamp(screenB, 0, 1) * 255);
      out.data[index + 3] = data[index + 3];
    }
    return out;
  }

  function renderGlowLayer(glowLayer, masks, params) {
    const out = new ImageData(glowLayer.width, glowLayer.height);
    const data = out.data;
    const composite = params.composite;
    const intensity = Number(composite.intensity) || 0;
    if (intensity <= 0.000001) {
      for (let index = 3; index < data.length; index += 4) data[index] = 255;
      return out;
    }
    const coreSuppression = clamp(Number(composite.coreSuppression) || 0, 0, 1);
    const coreCeiling = clamp(Number(composite.coreCeiling) || 0, 0, 1);
    const haloBoost = Math.max(0, Number(composite.haloBoost) || 0);
    const haloMix = clamp(Number(composite.haloMix) || 0, 0, 1);
    const highlightProtectAmount = clamp(Number(composite.highlightProtect) || 0, 0, 1);
    const shadowProtectAmount = clamp(Number(composite.shadowProtect) || 0, 0, 1);
    const chromaticOffset = getChromaticOffset(params);
    for (let pixel = 0, index = 0; pixel < glowLayer.r.length; pixel += 1, index += 4) {
      const x = pixel % glowLayer.width;
      const y = Math.floor(pixel / glowLayer.width);
      const source = masks.sourceMask[pixel];
      const haloSource = masks.haloMask ? masks.haloMask[pixel] : source;
      const protect = masks.protectMask[pixel];
      const baseLuma = masks.luma[pixel];
      const coreWeight = clamp((source - 0.025) / 0.495, 0, 1);
      const halo = clamp(haloSource, 0, 1);
      const haloOnly = Math.max(0, halo - clamp(source, 0, 1));
      const relativeHalo = clamp(haloOnly / Math.max(0.001, halo), 0, 1);
      const nearHalo = clamp((halo - 0.0015) / 0.0735, 0, 1) * clamp((relativeHalo - 0.04) / 0.78, 0, 1);
      const haloWeight = Math.max(nearHalo, (1 - coreWeight) * 0.38);
      const externalGlow = 1 - coreWeight;
      const highlightGuard = protect * highlightProtectAmount * (0.24 + clamp(baseLuma, 0, 1) * 0.36);
      const darkReceiver = clamp((0.34 - baseLuma) / 0.26, 0, 1);
      const shadowGuard = darkReceiver * shadowProtectAmount * 0.82;
      const receiverGain = clamp(1 - externalGlow * clamp(highlightGuard + shadowGuard, 0, 0.82), 0.18, 1);
      const coreGain = 1 - coreWeight * coreSuppression;
      const coreLimit = coreCeiling + (1 - coreWeight) * (1 - coreCeiling);
      const haloBlend = haloWeight * haloMix;
      const coreBlend = 1 - haloBlend;
      const haloGain = 1 + haloBoost;
      const layerR = chromaticOffset > 0 ? sampleChannelNearest(glowLayer, x + chromaticOffset, y, glowLayer.r) : glowLayer.r[pixel];
      const layerG = glowLayer.g[pixel];
      const layerB = chromaticOffset > 0 ? sampleChannelNearest(glowLayer, x - chromaticOffset, y, glowLayer.b) : glowLayer.b[pixel];
      const centerMax = Math.max(glowLayer.r[pixel], glowLayer.g[pixel], glowLayer.b[pixel]);
      const chromaStrength = Math.pow(Math.max(0, Math.min(1, params.composite.chromatic || 0)), 1.16);
      const edgeGate = source * (0.44 + (1 - protect) * 0.24);
      const redEdge = chromaticOffset > 0 ? Math.max(0, layerR - centerMax * 0.7) * chromaStrength * 0.86 * edgeGate : 0;
      const blueEdge = chromaticOffset > 0 ? Math.max(0, layerB - centerMax * 0.7) * chromaStrength * 0.86 * edgeGate : 0;
      let warmedR = layerR * (1 + params.composite.warmth);
      let warmedG = layerG * (1 + params.composite.warmth * 0.35);
      let warmedB = layerB * (1 - params.composite.warmth * 0.28);
      [warmedR, warmedG, warmedB] = applyGlowColorShift(warmedR, warmedG, warmedB, params.composite.colorShift);
      [warmedR, warmedG, warmedB] = applyGlowTint(warmedR, warmedG, warmedB, params);
      warmedR += redEdge;
      warmedB += blueEdge;
      const [satR, satG, satB] = applySaturation(warmedR, warmedG, warmedB, params.composite.saturation);
      const glowR = clamp(softShoulder(Math.max(0, satR) * intensity, composite.shoulder), 0, 1);
      const glowG = clamp(softShoulder(Math.max(0, satG) * intensity, composite.shoulder), 0, 1);
      const glowB = clamp(softShoulder(Math.max(0, satB) * intensity, composite.shoulder), 0, 1);
      const rawR = clamp((Math.min(glowR * coreGain, coreLimit) * coreBlend + glowR * haloGain * haloBlend) * receiverGain, 0, 1);
      const rawG = clamp((Math.min(glowG * coreGain, coreLimit) * coreBlend + glowG * haloGain * haloBlend) * receiverGain, 0, 1);
      const rawB = clamp((Math.min(glowB * coreGain, coreLimit) * coreBlend + glowB * haloGain * haloBlend) * receiverGain, 0, 1);
      const shapedR = visibilityGate(rawR, params);
      const shapedG = visibilityGate(rawG, params);
      const shapedB = visibilityGate(rawB, params);
      const dither = 0.75 / 255;
      data[index] = Math.round(clamp(linearToSrgb(shapedR) + (hashNoise(x, y, 0) - 0.5) * dither, 0, 1) * 255);
      data[index + 1] = Math.round(clamp(linearToSrgb(shapedG) + (hashNoise(x, y, 1) - 0.5) * dither, 0, 1) * 255);
      data[index + 2] = Math.round(clamp(linearToSrgb(shapedB) + (hashNoise(x, y, 2) - 0.5) * dither, 0, 1) * 255);
      // Photoshop Screen already uses RGB energy; alpha here would multiply the glow a second time.
      data[index + 3] = 255;
    }
    return out;
  }

  modules.glowCompositor = {
    composeProtected,
    renderGlowLayer,
    getCoreWeight,
    getHaloWeight,
    getReceiverGain,
    splitCoreAndHaloValue
  };
})(window);
