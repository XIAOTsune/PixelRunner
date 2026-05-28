import { getDocumentInfo, normalizeBounds } from "./document.js";

const DEFAULT_BLEND_MATCH_CONFIG = {
  mode: "balanced",
  totalStrength: 78,
  luminanceStrength: 82,
  colorStrength: 76,
  saturationStrength: 62,
  contrastStrength: 58,
  featherRadius: 16,
  createBackupLayer: true,
  alignmentEnabled: true,
  alignmentMaxOffset: 12,
  alignmentScaleEnabled: true,
  alignmentMaxScale: 2.5,
  alignmentMaxRotation: 1.75,
  alignmentMaxStretch: 2.5,
  localAlignmentEnabled: true,
  localMeshStrength: 0.58,
  localMeshMaxOffset: 6,
  previewMaxEdge: 512
};

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseLayerBounds(bounds) {
  return normalizeBounds(bounds);
}

function getActiveLayer(app) {
  return app && app.activeDocument && app.activeDocument.activeLayers && app.activeDocument.activeLayers[0];
}

function getLayerName(layer) {
  return String((layer && layer.name) || "AI 返图").trim() || "AI 返图";
}

function getLayerId(layer) {
  return Number(layer && layer.id) || 0;
}

function getBlendMatchConfig(payload = {}) {
  const mode = String(payload.mode || DEFAULT_BLEND_MATCH_CONFIG.mode).trim() || DEFAULT_BLEND_MATCH_CONFIG.mode;
  const modeBoost = mode === "strong" ? 1.16 : mode === "natural" ? 0.82 : 1;
  const edgeOnly = mode === "edgeOnly";
  const colorOnly = mode === "colorOnly";
  return {
    mode,
    totalStrength: clampNumber(payload.totalStrength, 0, 100, DEFAULT_BLEND_MATCH_CONFIG.totalStrength),
    luminanceStrength: edgeOnly || colorOnly ? 0 : clampNumber(payload.luminanceStrength, 0, 100, DEFAULT_BLEND_MATCH_CONFIG.luminanceStrength) * modeBoost,
    colorStrength: edgeOnly ? 0 : clampNumber(payload.colorStrength, 0, 100, DEFAULT_BLEND_MATCH_CONFIG.colorStrength) * modeBoost,
    saturationStrength: edgeOnly ? 0 : clampNumber(payload.saturationStrength, -100, 100, DEFAULT_BLEND_MATCH_CONFIG.saturationStrength) * modeBoost,
    contrastStrength: edgeOnly || colorOnly ? 0 : clampNumber(payload.contrastStrength, 0, 100, DEFAULT_BLEND_MATCH_CONFIG.contrastStrength) * modeBoost,
    featherRadius: clampNumber(payload.featherRadius, 0, 64, DEFAULT_BLEND_MATCH_CONFIG.featherRadius),
    createBackupLayer: payload.createBackupLayer !== false,
    alignmentEnabled: payload.alignmentEnabled !== false,
    alignmentMaxOffset: clampNumber(payload.alignmentMaxOffset, 1, 24, DEFAULT_BLEND_MATCH_CONFIG.alignmentMaxOffset),
    alignmentScaleEnabled: payload.alignmentScaleEnabled !== false,
    alignmentMaxScale: clampNumber(payload.alignmentMaxScale, 0, 4, DEFAULT_BLEND_MATCH_CONFIG.alignmentMaxScale),
    alignmentMaxRotation: clampNumber(payload.alignmentMaxRotation, 0, 3, DEFAULT_BLEND_MATCH_CONFIG.alignmentMaxRotation),
    alignmentMaxStretch: clampNumber(payload.alignmentMaxStretch, 0, 4, DEFAULT_BLEND_MATCH_CONFIG.alignmentMaxStretch),
    localAlignmentEnabled: payload.localAlignmentEnabled !== false,
    localMeshStrength: clampNumber(payload.localMeshStrength, 0, 1, DEFAULT_BLEND_MATCH_CONFIG.localMeshStrength),
    localMeshMaxOffset: clampNumber(payload.localMeshMaxOffset, 1, 12, DEFAULT_BLEND_MATCH_CONFIG.localMeshMaxOffset),
    previewMaxEdge: clampNumber(payload.previewMaxEdge, 256, 768, DEFAULT_BLEND_MATCH_CONFIG.previewMaxEdge)
  };
}

function clampBoundsToDocument(bounds, docInfo) {
  const width = Math.max(1, Number(docInfo && docInfo.width) || 1);
  const height = Math.max(1, Number(docInfo && docInfo.height) || 1);
  const source = bounds || { left: 0, top: 0, right: width, bottom: height };
  const left = Math.max(0, Math.min(width - 1, Math.floor(Number(source.left) || 0)));
  const top = Math.max(0, Math.min(height - 1, Math.floor(Number(source.top) || 0)));
  const right = Math.max(left + 1, Math.min(width, Math.ceil(Number(source.right) || width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.ceil(Number(source.bottom) || height)));
  return { left, top, right, bottom };
}

function getSamplingTargetSize(bounds, maxEdge = 768) {
  const width = Math.max(1, Number(bounds.right) - Number(bounds.left));
  const height = Math.max(1, Number(bounds.bottom) - Number(bounds.top));
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function buildDataUrl(mimeType, base64) {
  return base64 ? `data:${mimeType};base64,${base64}` : "";
}

function extractEncodedBase64(encoded) {
  const value = typeof encoded === "string" ? encoded : String((encoded && (encoded.base64 || encoded.data)) || "");
  const commaIndex = value.indexOf(",");
  return commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

async function getPixelsWithFallback(imaging, options) {
  try {
    return await imaging.getPixels(options);
  } catch (_) {
    const fallbackOptions = { ...options };
    delete fallbackOptions.componentSize;
    return imaging.getPixels(fallbackOptions);
  }
}

async function getImageDataBytes(imageData) {
  if (!imageData) return null;
  if (imageData.data) return imageData.data;
  if (typeof imageData.getData === "function") {
    const data = await imageData.getData();
    if (data) return data;
  }
  return null;
}

async function sampleCompositeStats(imaging, doc, bounds) {
  const targetSize = getSamplingTargetSize(bounds);
  let pixels = null;
  try {
    pixels = await getPixelsWithFallback(imaging, {
      documentID: Number(doc.id),
      sourceBounds: bounds,
      targetSize,
      componentSize: 8,
      applyAlpha: true
    });
    const data = await getImageDataBytes(pixels && pixels.imageData);
    if (!data || data.length < 4) throw new Error("Photoshop 未返回可读取的像素数据。");
    return buildStatsFromRgba(data);
  } finally {
    try {
      pixels && pixels.imageData && typeof pixels.imageData.dispose === "function" && pixels.imageData.dispose();
    } catch (_) {}
  }
}

async function captureCompositeSample(imaging, doc, bounds, maxEdge = 512, encode = false) {
  const targetSize = getSamplingTargetSize(bounds, maxEdge);
  let pixels = null;
  try {
    pixels = await getPixelsWithFallback(imaging, {
      documentID: Number(doc.id),
      sourceBounds: bounds,
      targetSize,
      componentSize: 8,
      applyAlpha: true
    });
    const data = await getImageDataBytes(pixels && pixels.imageData);
    if (!data || data.length < 4) throw new Error("Photoshop 未返回可读取的像素数据。");
    const copy = new Uint8Array(data.length);
    copy.set(data);
    let base64 = "";
    if (encode && typeof imaging.encodeImageData === "function") {
      const encoded = await imaging.encodeImageData({
        imageData: pixels.imageData,
        base64: true,
        format: "jpeg",
        quality: 78
      });
      base64 = extractEncodedBase64(encoded);
    }
    return {
      width: targetSize.width,
      height: targetSize.height,
      scaleX: (Math.max(1, Number(bounds.right) - Number(bounds.left))) / Math.max(1, targetSize.width),
      scaleY: (Math.max(1, Number(bounds.bottom) - Number(bounds.top))) / Math.max(1, targetSize.height),
      data: copy,
      stats: buildStatsFromRgba(copy),
      base64,
      dataUrl: buildDataUrl("image/jpeg", base64)
    };
  } finally {
    try {
      pixels && pixels.imageData && typeof pixels.imageData.dispose === "function" && pixels.imageData.dispose();
    } catch (_) {}
  }
}

function buildStatsFromRgba(data) {
  const sums = { r: 0, g: 0, b: 0, luma: 0, sat: 0, detail: 0, count: 0 };
  const lumas = [];
  const length = Math.floor(data.length / 4) * 4;
  const step = Math.max(4, Math.floor(length / (4 * 180000)) * 4);
  let previousLuma = -1;
  for (let index = 0; index < length; index += step) {
    const alpha = Number(data[index + 3]);
    if (alpha <= 4) continue;
    const r = Number(data[index]);
    const g = Number(data[index + 1]);
    const b = Number(data[index + 2]);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = max <= 0 ? 0 : (max - min) / max;
    sums.r += r;
    sums.g += g;
    sums.b += b;
    sums.luma += luma;
    sums.sat += sat;
    if (previousLuma >= 0) sums.detail += Math.abs(luma - previousLuma);
    previousLuma = luma;
    sums.count += 1;
    lumas.push(luma);
  }

  if (!sums.count) throw new Error("当前区域没有可用于融合校色的有效像素。");

  const meanLuma = sums.luma / sums.count;
  let variance = 0;
  for (let index = 0; index < lumas.length; index += 1) {
    const diff = lumas[index] - meanLuma;
    variance += diff * diff;
  }
  variance /= Math.max(1, lumas.length);

  return {
    count: sums.count,
    meanR: sums.r / sums.count,
    meanG: sums.g / sums.count,
    meanB: sums.b / sums.count,
    meanLuma,
    stdLuma: Math.sqrt(variance),
    meanSat: sums.sat / sums.count,
    detailEnergy: sums.detail / Math.max(1, sums.count - 1)
  };
}

function buildCorrections(sourceStats, referenceStats, config) {
  const total = config.totalStrength / 100;
  const luminanceAmount = total * (config.luminanceStrength / 100);
  const contrastAmount = total * (config.contrastStrength / 100);
  const colorAmount = total * (config.colorStrength / 100);
  const saturationAmount = total * (config.saturationStrength / 100);
  const lumaDelta = referenceStats.meanLuma - sourceStats.meanLuma;
  const stdRatio = sourceStats.stdLuma > 1 ? referenceStats.stdLuma / sourceStats.stdLuma : 1;
  const detailRatio = sourceStats.detailEnergy > 0.5 ? referenceStats.detailEnergy / sourceStats.detailEnergy : 1;
  const rgbDelta = {
    r: referenceStats.meanR - sourceStats.meanR,
    g: referenceStats.meanG - sourceStats.meanG,
    b: referenceStats.meanB - sourceStats.meanB
  };
  const avgDelta = (rgbDelta.r + rgbDelta.g + rgbDelta.b) / 3;
  const colorBias = {
    r: rgbDelta.r - avgDelta,
    g: rgbDelta.g - avgDelta,
    b: rgbDelta.b - avgDelta
  };

  return {
    brightness: clampNumber(Math.round(lumaDelta * 0.72 * luminanceAmount), -45, 45, 0),
    contrast: clampNumber(Math.round((((stdRatio - 1) * 0.72) + ((detailRatio - 1) * 0.28)) * 86 * contrastAmount), -35, 35, 0),
    saturation: clampNumber(Math.round((referenceStats.meanSat - sourceStats.meanSat) * 145 * saturationAmount), -35, 35, 0),
    colorBalance: {
      cyanRed: clampNumber(Math.round(colorBias.r * 0.42 * colorAmount), -24, 24, 0),
      magentaGreen: clampNumber(Math.round(colorBias.g * 0.42 * colorAmount), -24, 24, 0),
      yellowBlue: clampNumber(Math.round(colorBias.b * 0.42 * colorAmount), -24, 24, 0)
    },
    raw: {
      lumaDelta,
      stdRatio,
      detailRatio,
      saturationDelta: referenceStats.meanSat - sourceStats.meanSat,
      rgbDelta
    }
  };
}

async function setLayerVisible(action, layerId, visible) {
  await action.batchPlay([{
    _obj: visible ? "show" : "hide",
    _target: [{ _ref: "layer", _id: Number(layerId) }]
  }], {});
}

async function selectLayerById(action, layerId) {
  await action.batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _id: Number(layerId) }],
    makeVisible: false
  }], {});
}

async function transformLayerAlignment(action, layerId, alignment) {
  const scaleX = Number(alignment && alignment.scaleXPercent) || Number(alignment && alignment.scalePercent) || 100;
  const scaleY = Number(alignment && alignment.scaleYPercent) || Number(alignment && alignment.scalePercent) || 100;
  const rotation = Number(alignment && alignment.rotation) || 0;
  const dx = Number(alignment && alignment.dx) || 0;
  const dy = Number(alignment && alignment.dy) || 0;
  const descriptor = {
    _obj: "transform",
    _target: [{ _ref: "layer", _id: Number(layerId) }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" }
  };
  if (Math.abs(scaleX - 100) >= 0.08 || Math.abs(scaleY - 100) >= 0.08) {
    descriptor.width = { _unit: "percentUnit", _value: scaleX };
    descriptor.height = { _unit: "percentUnit", _value: scaleY };
    descriptor.linked = Math.abs(scaleX - scaleY) < 0.001;
  }
  if (Math.abs(rotation) >= 0.03) {
    descriptor.angle = { _unit: "angleUnit", _value: rotation };
  }
  if (Math.abs(dx) >= 0.01 || Math.abs(dy) >= 0.01) {
    descriptor.offset = {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: dx },
      vertical: { _unit: "pixelsUnit", _value: dy }
    };
  }
  await action.batchPlay([descriptor], {});
}

async function duplicateActiveLayer(action, layerName) {
  await action.batchPlay([{
    _obj: "duplicate",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    name: layerName
  }], {});
}

async function applyBrightnessContrast(action, brightness, contrast) {
  if (!brightness && !contrast) return;
  await action.batchPlay([{
    _obj: "brightnessEvent",
    brightness,
    contrast,
    useLegacy: false
  }], {});
}

async function applyHueSaturation(action, saturation) {
  if (!saturation) return;
  await action.batchPlay([{
    _obj: "hueSaturation",
    presetKind: {
      _enum: "presetKindType",
      _value: "presetKindCustom"
    },
    colorize: false,
    adjustment: [{
      _obj: "hueSatAdjustmentV2",
      hue: 0,
      saturation,
      lightness: 0
    }]
  }], {});
}

async function applyColorBalance(action, correction) {
  const cyanRed = Number(correction && correction.cyanRed) || 0;
  const magentaGreen = Number(correction && correction.magentaGreen) || 0;
  const yellowBlue = Number(correction && correction.yellowBlue) || 0;
  if (!cyanRed && !magentaGreen && !yellowBlue) return;
  await action.batchPlay([{
    _obj: "colorBalance",
    shadowLevels: [0, 0, 0],
    midtoneLevels: [cyanRed, magentaGreen, yellowBlue],
    highlightLevels: [Math.round(cyanRed * 0.45), Math.round(magentaGreen * 0.45), Math.round(yellowBlue * 0.45)],
    preserveLuminosity: true
  }], {});
}

async function setSelectionFromActiveLayerTransparency(action) {
  await action.batchPlay([
    {
      _obj: "set",
      _target: [{ _ref: "channel", _property: "selection" }],
      to: { _ref: "channel", _enum: "channel", _value: "transparencyEnum" }
    }
  ], {});
}

async function clearSelection(action) {
  await action.batchPlay([{
    _obj: "set",
    _target: [{ _ref: "channel", _property: "selection" }],
    to: { _enum: "ordinal", _value: "none" }
  }], {});
}

async function makeMaskFromCurrentSelection(action) {
  await action.batchPlay([
    {
      _obj: "make",
      new: { _class: "channel" },
      at: { _ref: "channel", _enum: "channel", _value: "mask" },
      using: { _enum: "userMaskEnabled", _value: "revealSelection" }
    }
  ], {});
}

async function contractSelection(action, radius) {
  await action.batchPlay([{
    _obj: "contract",
    by: { _unit: "pixelsUnit", _value: radius },
    selectionModifyEffectAtCanvasBounds: false
  }], {});
}

async function featherSelection(action, radius) {
  await action.batchPlay([{
    _obj: "feather",
    radius: { _unit: "pixelsUnit", _value: radius }
  }], {});
}

async function makeInwardFeatherMaskFromActiveLayerTransparency(action, radius) {
  if (!(radius > 0)) return false;
  const baseRadius = Math.max(1, Math.round(Number(radius) || 0));
  const candidates = Array.from(new Set([
    baseRadius,
    Math.max(1, Math.round(baseRadius * 0.65)),
    Math.max(1, Math.round(baseRadius * 0.35))
  ])).filter((value) => value > 0);

  let lastError = null;
  for (const insetRadius of candidates) {
    try {
      await setSelectionFromActiveLayerTransparency(action);
      await contractSelection(action, insetRadius);
      await featherSelection(action, insetRadius);
      await makeMaskFromCurrentSelection(action);
      await clearSelection(action);
      return { applied: true, insetRadius };
    } catch (error) {
      lastError = error;
      try {
        await clearSelection(action);
      } catch (_) {}
    }
  }
  if (lastError) throw lastError;
  return true;
}

async function applyFeatherBestEffort(action, radius, logs) {
  if (!(radius > 0)) {
    logs.push("[融合校色] 羽化半径为 0，已跳过边缘羽化。");
    return false;
  }
  try {
    const result = await makeInwardFeatherMaskFromActiveLayerTransparency(action, radius);
    const insetRadius = result && result.insetRadius ? result.insetRadius : radius;
    logs.push(`[融合校色] 已基于当前图层透明度创建向内羽化蒙版：羽化 ${insetRadius}px。`);
    return true;
  } catch (error) {
    logs.push(`[融合校色] 蒙版羽化未完成：${error.message || "Photoshop 未接受蒙版命令"}。已保留校色结果层。`);
    try {
      await action.batchPlay([{
        _obj: "select",
        _target: [{ _ref: "channel", _enum: "channel", _value: "RGB" }],
        makeVisible: false
      }], {});
    } catch (_) {}
    return false;
  }
}

function buildLuma(data, width, height) {
  const luma = new Float32Array(width * height);
  for (let index = 0, pixel = 0; pixel < luma.length; index += 4, pixel += 1) {
    const alpha = Number(data[index + 3]) / 255;
    luma[pixel] = alpha <= 0.02
      ? 0
      : (0.2126 * Number(data[index]) + 0.7152 * Number(data[index + 1]) + 0.0722 * Number(data[index + 2])) * alpha;
  }
  return luma;
}

function buildSobelMagnitude(luma, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;
      const gx =
        -luma[i - width - 1] + luma[i - width + 1] -
        2 * luma[i - 1] + 2 * luma[i + 1] -
        luma[i + width - 1] + luma[i + width + 1];
      const gy =
        -luma[i - width - 1] - 2 * luma[i - width] - luma[i - width + 1] +
        luma[i + width - 1] + 2 * luma[i + width] + luma[i + width + 1];
      out[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

function sampleNearest(buffer, width, height, x, y) {
  const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
  return buffer[iy * width + ix];
}

function scoreTransform(source, reference, width, height, dx, dy, scale, stride, region = null) {
  return scoreAffineTransform(source, reference, width, height, {
    dx,
    dy,
    scaleX: scale,
    scaleY: scale,
    rotation: 0
  }, stride, region);
}

function scoreAffineTransform(source, reference, width, height, transform, stride, region = null) {
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  let count = 0;
  const cx = width / 2;
  const cy = height / 2;
  const scaleX = Math.max(0.92, Math.min(1.08, Number(transform && transform.scaleX) || 1));
  const scaleY = Math.max(0.92, Math.min(1.08, Number(transform && transform.scaleY) || 1));
  const rotation = ((Number(transform && transform.rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const dx = Number(transform && transform.dx) || 0;
  const dy = Number(transform && transform.dy) || 0;
  const startX = Math.max(1, region ? region.left : 1);
  const endX = Math.min(width - 1, region ? region.right : width - 1);
  const startY = Math.max(1, region ? region.top : 1);
  const endY = Math.min(height - 1, region ? region.bottom : height - 1);
  for (let y = startY; y < endY; y += stride) {
    const refRow = y * width;
    for (let x = startX; x < endX; x += stride) {
      const localX = x - cx;
      const localY = y - cy;
      const sourceX = cx + ((localX * cos - localY * sin) / scaleX) + dx;
      const sourceY = cy + ((localX * sin + localY * cos) / scaleY) + dy;
      if (sourceX < 1 || sourceX >= width - 1 || sourceY < 1 || sourceY >= height - 1) continue;
      const a = sampleNearest(source, width, height, sourceX, sourceY);
      const b = reference[refRow + x];
      if (a < 8 && b < 8) continue;
      sumA += a;
      sumB += b;
      sumAA += a * a;
      sumBB += b * b;
      sumAB += a * b;
      count += 1;
    }
  }
  if (count < 64) return -1;
  const numerator = sumAB - (sumA * sumB) / count;
  const denomA = sumAA - (sumA * sumA) / count;
  const denomB = sumBB - (sumB * sumB) / count;
  const denom = Math.sqrt(Math.max(0.0001, denomA * denomB));
  return numerator / denom;
}

function buildScaleCandidates(maxScalePercent, enabled) {
  if (!enabled || !(maxScalePercent > 0)) return [1];
  const maxScale = Math.max(0, Math.min(4, Number(maxScalePercent) || 0));
  const out = [1];
  const steps = maxScale <= 1 ? [maxScale] : [maxScale / 2, maxScale];
  steps.forEach((step) => {
    if (step > 0.05) {
      out.push(1 - step / 100, 1 + step / 100);
    }
  });
  return out.sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1));
}

function buildSymmetricCandidates(maxValue, enabled, unit = 1) {
  if (!enabled || !(maxValue > 0)) return [0];
  const max = Math.max(0, Number(maxValue) || 0);
  const half = max / 2;
  const raw = [0, -half, half, -max, max]
    .map((value) => Math.round(value / unit) * unit)
    .filter((value, index, list) => Math.abs(value) > 0.0001 || index === list.indexOf(0));
  return Array.from(new Set(raw)).sort((a, b) => Math.abs(a) - Math.abs(b));
}

function refineAffineAlignment(sourceGrad, refGrad, width, height, base, baseSecondScore, config, sampleOffset, stride) {
  const rotationCandidates = buildSymmetricCandidates(config.alignmentMaxRotation, true, 0.25);
  const maxStretch = Math.max(0, Number(config.alignmentMaxStretch) || 0);
  const stretchCandidates = config.alignmentScaleEnabled && maxStretch > 0 ? [0, -maxStretch, maxStretch] : [0];
  const offsetWindow = Math.max(1, Math.min(2, Math.round(sampleOffset / 5)));
  const refineStride = Math.max(stride, Math.floor(stride * 1.5));
  let best = {
    dx: base.dx,
    dy: base.dy,
    scaleX: base.scale,
    scaleY: base.scale,
    rotation: 0,
    score: base.score
  };
  let second = Number(baseSecondScore) || -1;
  for (let dy = base.dy - offsetWindow; dy <= base.dy + offsetWindow; dy += 1) {
    for (let dx = base.dx - offsetWindow; dx <= base.dx + offsetWindow; dx += 1) {
      rotationCandidates.forEach((rotation) => {
        stretchCandidates.forEach((stretchX) => {
          stretchCandidates.forEach((stretchY) => {
            const scaleX = Math.max(0.92, Math.min(1.08, base.scale * (1 + stretchX / 100)));
            const scaleY = Math.max(0.92, Math.min(1.08, base.scale * (1 + stretchY / 100)));
            const score = scoreAffineTransform(sourceGrad, refGrad, width, height, { dx, dy, scaleX, scaleY, rotation }, refineStride);
            if (score > best.score) {
              second = best.score;
              best = { dx, dy, scaleX, scaleY, rotation, score };
            } else if (score > second) {
              second = score;
            }
          });
        });
      });
    }
  }
  return {
    ...best,
    secondScore: second
  };
}

function buildLocalMeshProfile(width, height, config) {
  const shortEdge = Math.min(width, height);
  const mode = String(config && config.mode || "balanced");
  const baseGrid = shortEdge < 220 ? 4 : shortEdge > 520 || mode === "strong" ? 7 : 5;
  return {
    cols: baseGrid,
    rows: baseGrid,
    overlap: mode === "natural" ? 0.22 : mode === "strong" ? 0.34 : 0.28,
    strength: Math.max(0.25, Math.min(0.72, Number(config && config.localMeshStrength) || DEFAULT_BLEND_MATCH_CONFIG.localMeshStrength)),
    maxOffset: Math.max(2, Math.min(12, Number(config && config.localMeshMaxOffset) || DEFAULT_BLEND_MATCH_CONFIG.localMeshMaxOffset))
  };
}

function sampleGradientEnergy(grad, width, height, region, stride) {
  const left = Math.max(1, Math.floor(region.left));
  const right = Math.min(width - 1, Math.ceil(region.right));
  const top = Math.max(1, Math.floor(region.top));
  const bottom = Math.min(height - 1, Math.ceil(region.bottom));
  const step = Math.max(1, Number(stride) || 1);
  let sum = 0;
  let count = 0;
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      sum += Number(grad[y * width + x]) || 0;
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

function smoothTileOffsets(tiles, rows, cols, passes = 2) {
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
  tiles.forEach((tile) => {
    if (tile.row >= 0 && tile.row < rows && tile.col >= 0 && tile.col < cols) {
      grid[tile.row][tile.col] = { ...tile };
    }
  });

  for (let pass = 0; pass < passes; pass += 1) {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const tile = grid[row][col];
        if (!tile) continue;
        let weight = 1.8;
        let dx = tile.dx * weight;
        let dy = tile.dy * weight;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (!ox && !oy) continue;
            const neighbor = grid[row + oy] && grid[row + oy][col + ox];
            if (!neighbor) continue;
            const neighborWeight = ox && oy ? 0.42 : 0.68;
            dx += neighbor.dx * neighborWeight;
            dy += neighbor.dy * neighborWeight;
            weight += neighborWeight;
          }
        }
        tile.smoothedDx = dx / Math.max(0.001, weight);
        tile.smoothedDy = dy / Math.max(0.001, weight);
      }
    }
    tiles.forEach((tile) => {
      tile.dx = Number.isFinite(tile.smoothedDx) ? tile.smoothedDx : tile.dx;
      tile.dy = Number.isFinite(tile.smoothedDy) ? tile.smoothedDy : tile.dy;
    });
  }
  return tiles;
}

function buildLocalMeshSummary(tiles, rows, cols, strength, maxOffset) {
  if (!tiles.length) {
    return {
      enabled: true,
      applied: false,
      rows,
      cols,
      strength,
      maxOffset,
      validTiles: 0,
      totalTiles: rows * cols,
      spread: 0,
      meanDx: 0,
      meanDy: 0,
      maxDistance: 0,
      reason: "no-reliable-tiles",
      tiles: []
    };
  }
  const meanDx = tiles.reduce((sum, tile) => sum + tile.dx, 0) / tiles.length;
  const meanDy = tiles.reduce((sum, tile) => sum + tile.dy, 0) / tiles.length;
  const spread = tiles.reduce((sum, tile) => sum + Math.hypot(tile.dx - meanDx, tile.dy - meanDy), 0) / tiles.length;
  const maxDistance = tiles.reduce((max, tile) => Math.max(max, Math.hypot(tile.dx, tile.dy)), 0);
  const coverage = tiles.length / Math.max(1, rows * cols);
  const applied = tiles.length >= Math.max(4, Math.round(rows * cols * 0.34)) && spread >= 0.85 && maxDistance >= 1;
  return {
    enabled: true,
    applied,
    rows,
    cols,
    strength,
    maxOffset,
    validTiles: tiles.length,
    totalTiles: rows * cols,
    coverage,
    spread,
    meanDx,
    meanDy,
    maxDistance,
    reason: applied ? "local-gradient-mesh" : coverage < 0.34 ? "low-coverage" : "low-local-spread",
    tiles: tiles.map((tile) => ({
      row: tile.row,
      col: tile.col,
      dx: Number(tile.dx.toFixed(2)),
      dy: Number(tile.dy.toFixed(2)),
      score: Number(tile.score.toFixed(3)),
      scoreGap: Number(tile.scoreGap.toFixed(3)),
      textureEnergy: Number(tile.textureEnergy.toFixed(2))
    }))
  };
}

function estimateTileOffsets(sourceGrad, refGrad, width, height, sampleOffset, stride, config = {}) {
  const tiles = [];
  const profile = buildLocalMeshProfile(width, height, config);
  const cols = profile.cols;
  const rows = profile.rows;
  const searchOffset = Math.max(1, Math.min(profile.maxOffset, sampleOffset));
  const minTileScore = 0.21;
  const minScoreGap = 0.01;
  const minTextureEnergy = 6;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const tileWidth = width / cols;
      const tileHeight = height / rows;
      const padX = tileWidth * profile.overlap;
      const padY = tileHeight * profile.overlap;
      const region = {
        left: Math.max(0, Math.floor((width * col) / cols - padX)),
        right: Math.min(width, Math.ceil((width * (col + 1)) / cols + padX)),
        top: Math.max(0, Math.floor((height * row) / rows - padY)),
        bottom: Math.min(height, Math.ceil((height * (row + 1)) / rows + padY))
      };
      const textureEnergy = sampleGradientEnergy(refGrad, width, height, region, Math.max(1, stride));
      if (textureEnergy < minTextureEnergy) continue;
      let best = { dx: 0, dy: 0, score: -1 };
      let second = -1;
      for (let dy = -searchOffset; dy <= searchOffset; dy += 1) {
        for (let dx = -searchOffset; dx <= searchOffset; dx += 1) {
          const score = scoreTransform(sourceGrad, refGrad, width, height, dx, dy, 1, stride, region);
          if (score > best.score) {
            second = best.score;
            best = { dx, dy, score };
          } else if (score > second) {
            second = score;
          }
        }
      }
      const scoreGap = best.score - Math.max(0, second);
      if (best.score > minTileScore && scoreGap > minScoreGap) {
        tiles.push({ ...best, row, col, scoreGap, textureEnergy });
      }
    }
  }
  return buildLocalMeshSummary(smoothTileOffsets(tiles, rows, cols, 2), rows, cols, profile.strength, profile.maxOffset);
}

function estimateGradientAlignment(sourceSample, referenceSample, configOrMaxOffset) {
  if (!sourceSample || !referenceSample || sourceSample.width !== referenceSample.width || sourceSample.height !== referenceSample.height) {
    return { applied: false, dx: 0, dy: 0, confidence: 0, reason: "preview-size-mismatch" };
  }
  const config = typeof configOrMaxOffset === "object"
    ? configOrMaxOffset
    : { alignmentMaxOffset: configOrMaxOffset, alignmentScaleEnabled: false, alignmentMaxScale: 0, alignmentMaxRotation: 0, alignmentMaxStretch: 0, localAlignmentEnabled: false };
  const width = sourceSample.width;
  const height = sourceSample.height;
  if (width < 32 || height < 32) return { applied: false, dx: 0, dy: 0, confidence: 0, reason: "too-small" };
  const sampleOffset = Math.max(1, Math.min(24, Math.round(Number(config.alignmentMaxOffset) / Math.max(sourceSample.scaleX, sourceSample.scaleY))));
  const sourceGrad = buildSobelMagnitude(buildLuma(sourceSample.data, width, height), width, height);
  const refGrad = buildSobelMagnitude(buildLuma(referenceSample.data, width, height), width, height);
  const stride = Math.max(1, Math.floor(Math.max(width, height) / 180));
  const scaleCandidates = buildScaleCandidates(config.alignmentMaxScale, config.alignmentScaleEnabled);
  let best = { dx: 0, dy: 0, scale: 1, score: -1 };
  let second = -1;
  scaleCandidates.forEach((scale) => {
    for (let dy = -sampleOffset; dy <= sampleOffset; dy += 1) {
      for (let dx = -sampleOffset; dx <= sampleOffset; dx += 1) {
        const score = scoreTransform(sourceGrad, refGrad, width, height, dx, dy, scale, stride);
        if (score > best.score) {
          second = best.score;
          best = { dx, dy, scale, score };
        } else if (score > second) {
          second = score;
        }
      }
    }
  });
  const affineBest = refineAffineAlignment(sourceGrad, refGrad, width, height, best, second, config, sampleOffset, stride);
  const local = config.localAlignmentEnabled
    ? estimateTileOffsets(sourceGrad, refGrad, width, height, Math.max(1, Math.min(8, sampleOffset)), Math.max(1, stride), config)
    : { enabled: false, applied: false, tiles: [], spread: 0, meanDx: 0, meanDy: 0, validTiles: 0, totalTiles: 0, reason: "disabled" };
  const localDeformation = Boolean(local.applied);
  const localDampen = localDeformation ? Math.max(0.12, Math.min(0.38, local.strength * 0.5)) : 0;
  const effectiveBest = localDeformation
    ? {
        ...affineBest,
        dx: affineBest.dx * (1 - localDampen * 0.25) + local.meanDx * localDampen * 0.25,
        dy: affineBest.dy * (1 - localDampen * 0.25) + local.meanDy * localDampen * 0.25,
        scaleX: 1 + (affineBest.scaleX - 1) * (1 - localDampen),
        scaleY: 1 + (affineBest.scaleY - 1) * (1 - localDampen),
        rotation: affineBest.rotation * (1 - localDampen)
      }
    : affineBest;
  const comparisonScore = Math.max(0, affineBest.secondScore, second);
  const confidence = Math.max(0, Math.min(1, (affineBest.score - comparisonScore) * 3 + Math.max(0, affineBest.score - 0.22)));
  const docDx = -effectiveBest.dx * sourceSample.scaleX;
  const docDy = -effectiveBest.dy * sourceSample.scaleY;
  const scaleXPercent = Number((effectiveBest.scaleX * 100).toFixed(3));
  const scaleYPercent = Number((effectiveBest.scaleY * 100).toFixed(3));
  const scalePercent = Number((((effectiveBest.scaleX + effectiveBest.scaleY) / 2) * 100).toFixed(3));
  const rotation = Number((Number(effectiveBest.rotation) || 0).toFixed(3));
  const significant =
    Math.abs(docDx) >= 0.35 ||
    Math.abs(docDy) >= 0.35 ||
    Math.abs(scaleXPercent - 100) >= 0.08 ||
    Math.abs(scaleYPercent - 100) >= 0.08 ||
    Math.abs(rotation) >= 0.03;
  if (confidence < 0.18 || !significant) {
    return {
      applied: false,
      dx: 0,
      dy: 0,
      scalePercent: 100,
      scaleXPercent: 100,
      scaleYPercent: 100,
      rotation: 0,
      confidence,
      score: affineBest.score,
      sampleDx: effectiveBest.dx,
      sampleDy: effectiveBest.dy,
      sampleScale: (effectiveBest.scaleX + effectiveBest.scaleY) / 2,
      sampleScaleX: effectiveBest.scaleX,
      sampleScaleY: effectiveBest.scaleY,
      sampleRotation: effectiveBest.rotation,
      rawSampleDx: affineBest.dx,
      rawSampleDy: affineBest.dy,
      rawSampleScaleX: affineBest.scaleX,
      rawSampleScaleY: affineBest.scaleY,
      rawSampleRotation: affineBest.rotation,
      local,
      localDeformation,
      reason: significant ? "low-confidence" : "already-aligned"
    };
  }
  return {
    applied: true,
    dx: Number(docDx.toFixed(2)),
    dy: Number(docDy.toFixed(2)),
    scalePercent,
    scaleXPercent,
    scaleYPercent,
    rotation,
    confidence,
    score: affineBest.score,
    sampleDx: effectiveBest.dx,
    sampleDy: effectiveBest.dy,
    sampleScale: (effectiveBest.scaleX + effectiveBest.scaleY) / 2,
    sampleScaleX: effectiveBest.scaleX,
    sampleScaleY: effectiveBest.scaleY,
    sampleRotation: effectiveBest.rotation,
    rawSampleDx: affineBest.dx,
    rawSampleDy: affineBest.dy,
    rawSampleScaleX: affineBest.scaleX,
    rawSampleScaleY: affineBest.scaleY,
    rawSampleRotation: affineBest.rotation,
    local,
    localDeformation,
    reason: Math.abs(rotation) >= 0.03 || Math.abs(scaleXPercent - scaleYPercent) >= 0.08 ? "gradient-ncc-affine" : scalePercent === 100 ? "gradient-ncc" : "gradient-ncc-scale"
  };
}

export async function blendMatchActiveLayer(payload = {}, context) {
  const { photoshop, app, document } = context;
  const core = photoshop.core;
  const action = photoshop.action;
  const imaging = photoshop.imaging;
  if (!imaging || typeof imaging.getPixels !== "function") {
    throw new Error("Photoshop imaging API 不可用，无法分析融合校色。");
  }

  const config = getBlendMatchConfig(payload);

  return core.executeAsModal(async () => {
    const logs = [];
    const docInfo = getDocumentInfo(document);
    const requestedLayerId = Number(payload.layerId || payload.targetLayerId) || 0;
    if (requestedLayerId > 0) {
      await selectLayerById(action, requestedLayerId);
    }
    const sourceLayer = getActiveLayer(app);
    const sourceLayerId = getLayerId(sourceLayer);
    if (!(sourceLayerId > 0)) throw new Error("请先选中一张 AI 返图图层。");

    const sourceLayerName = getLayerName(sourceLayer);
    const sourceBounds = clampBoundsToDocument(parseLayerBounds(sourceLayer && sourceLayer.bounds), docInfo);
    const resultLayerName = `PixelRunner 融合校色 - ${sourceLayerName}`.slice(0, 240);
    logs.push(`[融合校色] 开始分析图层：${sourceLayerName}。`);
    logs.push(`[融合校色] 处理区域：${sourceBounds.left},${sourceBounds.top} - ${sourceBounds.right},${sourceBounds.bottom}。`);

    let sourceWasVisible = true;
    try {
      sourceWasVisible = sourceLayer.visible !== false;
    } catch (_) {}

    let sourceSample = null;
    let referenceSample = null;
    let restoredVisibility = false;

    try {
      sourceSample = await captureCompositeSample(imaging, document, sourceBounds, 768, false);
      logs.push("[融合校色] 已采样当前返图可见状态。");

      await setLayerVisible(action, sourceLayerId, false);
      logs.push("[融合校色] 已临时隐藏当前返图图层，开始捕获隐藏后的可见合成参考。");
      referenceSample = await captureCompositeSample(imaging, document, sourceBounds, 768, false);
      logs.push("[融合校色] 参考图已捕获：隐藏返图后的用户可见画面。");

      await setLayerVisible(action, sourceLayerId, sourceWasVisible);
      restoredVisibility = true;
      logs.push("[融合校色] 已恢复返图图层可见性。");
    } finally {
      if (!restoredVisibility) {
        try {
          await setLayerVisible(action, sourceLayerId, sourceWasVisible);
          logs.push("[融合校色] 异常回滚：已恢复返图图层可见性。");
        } catch (_) {}
      }
    }

    const sourceStats = sourceSample.stats;
    const referenceStats = referenceSample.stats;
    const alignment = config.alignmentEnabled
      ? estimateGradientAlignment(sourceSample, referenceSample, config)
      : { applied: false, dx: 0, dy: 0, confidence: 0, reason: "disabled" };
    if (config.alignmentEnabled) {
      if (alignment.applied) {
        logs.push(`[融合校色] 梯度对齐：dx ${alignment.dx}px, dy ${alignment.dy}px, scaleX ${Number(alignment.scaleXPercent || 100).toFixed(2)}%, scaleY ${Number(alignment.scaleYPercent || 100).toFixed(2)}%, rotate ${Number(alignment.rotation || 0).toFixed(2)}°, confidence ${alignment.confidence.toFixed(2)}。`);
      } else {
        logs.push(`[融合校色] 梯度对齐已跳过：${alignment.reason}，confidence ${Number(alignment.confidence || 0).toFixed(2)}。`);
      }
      if (alignment.localDeformation) {
        logs.push(`[融合校色] 局部网格对齐：${alignment.local.validTiles}/${alignment.local.totalTiles} 个分块有效，最大局部偏移 ${alignment.local.maxDistance.toFixed(2)}px，离散度 ${alignment.local.spread.toFixed(2)}px，强度 ${Math.round(alignment.local.strength * 100)}%；已用于约束全局对齐并交给边缘融合过渡。`);
      } else if (alignment.local && alignment.local.enabled) {
        logs.push(`[融合校色] 局部网格对齐已跳过：${alignment.local.reason}，有效分块 ${alignment.local.validTiles || 0}/${alignment.local.totalTiles || 0}。`);
      }
    }

    await selectLayerById(action, sourceLayerId);
    await duplicateActiveLayer(action, resultLayerName);
    const resultLayer = getActiveLayer(app);
    const resultLayerId = getLayerId(resultLayer);
    if (!(resultLayerId > 0)) throw new Error("融合校色结果层创建失败。");
    logs.push(`[融合校色] 已创建结果层：${resultLayerName}。`);

    if (config.createBackupLayer) {
      try {
        await setLayerVisible(action, sourceLayerId, false);
        logs.push("[融合校色] 原返图图层已隐藏保留为备份。");
      } catch (error) {
        logs.push(`[融合校色] 原图层备份隐藏失败：${error.message || "未知错误"}。`);
      }
      await selectLayerById(action, resultLayerId);
    }

    if (alignment.applied) {
      await transformLayerAlignment(action, resultLayerId, alignment);
      await selectLayerById(action, resultLayerId);
    }

    const corrections = buildCorrections(sourceStats, referenceStats, config);
    logs.push(`[融合校色] 明度 ${corrections.brightness >= 0 ? "+" : ""}${corrections.brightness} / 对比 ${corrections.contrast >= 0 ? "+" : ""}${corrections.contrast} / 饱和 ${corrections.saturation >= 0 ? "+" : ""}${corrections.saturation}。`);
    logs.push(`[融合校色] 色偏校正：R ${corrections.colorBalance.cyanRed >= 0 ? "+" : ""}${corrections.colorBalance.cyanRed} / G ${corrections.colorBalance.magentaGreen >= 0 ? "+" : ""}${corrections.colorBalance.magentaGreen} / B ${corrections.colorBalance.yellowBlue >= 0 ? "+" : ""}${corrections.colorBalance.yellowBlue}。`);

    await applyBrightnessContrast(action, corrections.brightness, corrections.contrast);
    await applyColorBalance(action, corrections.colorBalance);
    await applyHueSaturation(action, corrections.saturation);
    logs.push(`[融合校色] 已应用基础明度、对比、色偏和饱和度匹配，总强度 ${config.totalStrength}% 已写入校正量。`);

    const featherApplied = await applyFeatherBestEffort(action, config.featherRadius, logs);
    await selectLayerById(action, resultLayerId);

    return {
      ok: true,
      action: "blendMatch",
      document: getDocumentInfo(app.activeDocument),
      message: `融合校色完成：${sourceLayerName} -> ${resultLayerName}`,
      logs,
      layerId: resultLayerId,
      sourceLayerId,
      layerName: resultLayerName,
      bounds: sourceBounds,
      config,
      stats: {
        source: sourceStats,
        reference: referenceStats
      },
      corrections,
      alignment,
      featherApplied
    };
  }, {
    commandName: "PixelRunner 融合校色"
  });
}

export async function previewBlendMatchActiveLayer(payload = {}, context) {
  const { photoshop, app, document } = context;
  const core = photoshop.core;
  const action = photoshop.action;
  const imaging = photoshop.imaging;
  if (!imaging || typeof imaging.getPixels !== "function" || typeof imaging.encodeImageData !== "function") {
    throw new Error("Photoshop imaging API 不可用，无法生成融合校色预览。");
  }
  const config = getBlendMatchConfig(payload);

  return core.executeAsModal(async () => {
    const logs = [];
    const docInfo = getDocumentInfo(document);
    const requestedLayerId = Number(payload.layerId || payload.targetLayerId) || 0;
    if (requestedLayerId > 0) {
      await selectLayerById(action, requestedLayerId);
    }
    const sourceLayer = getActiveLayer(app);
    const sourceLayerId = getLayerId(sourceLayer);
    if (!(sourceLayerId > 0)) throw new Error("请先选中一张 AI 返图图层。");
    const sourceLayerName = getLayerName(sourceLayer);
    const sourceBounds = clampBoundsToDocument(parseLayerBounds(sourceLayer && sourceLayer.bounds), docInfo);
    const previewMaxEdge = config.previewMaxEdge;
    let sourceWasVisible = true;
    try {
      sourceWasVisible = sourceLayer.visible !== false;
    } catch (_) {}

    let sourceSample = null;
    let referenceSample = null;
    let restoredVisibility = false;
    try {
      sourceSample = await captureCompositeSample(imaging, document, sourceBounds, previewMaxEdge, true);
      await setLayerVisible(action, sourceLayerId, false);
      referenceSample = await captureCompositeSample(imaging, document, sourceBounds, previewMaxEdge, true);
      await setLayerVisible(action, sourceLayerId, sourceWasVisible);
      restoredVisibility = true;
    } finally {
      if (!restoredVisibility) {
        try {
          await setLayerVisible(action, sourceLayerId, sourceWasVisible);
        } catch (_) {}
      }
    }

    const corrections = buildCorrections(sourceSample.stats, referenceSample.stats, config);
    const alignment = config.alignmentEnabled
      ? estimateGradientAlignment(sourceSample, referenceSample, config)
      : { applied: false, dx: 0, dy: 0, confidence: 0, reason: "disabled" };
    logs.push(`[融合校色] 预览已刷新：${sourceLayerName}，${sourceSample.width}x${sourceSample.height}。`);

    return {
      ok: true,
      action: "blendMatchPreview",
      document: getDocumentInfo(app.activeDocument),
      layerId: sourceLayerId,
      layerName: sourceLayerName,
      bounds: sourceBounds,
      width: sourceSample.width,
      height: sourceSample.height,
      sourceDataUrl: sourceSample.dataUrl,
      referenceDataUrl: referenceSample.dataUrl,
      corrections,
      alignment,
      config,
      logs
    };
  }, {
    commandName: "PixelRunner 融合校色预览"
  });
}
