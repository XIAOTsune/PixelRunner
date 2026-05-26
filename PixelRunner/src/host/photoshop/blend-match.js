import { getDocumentInfo, normalizeBounds } from "./document.js";

const DEFAULT_BLEND_MATCH_CONFIG = {
  mode: "balanced",
  totalStrength: 70,
  luminanceStrength: 75,
  colorStrength: 65,
  saturationStrength: 50,
  contrastStrength: 45,
  featherRadius: 12,
  createBackupLayer: true,
  alignmentEnabled: false,
  alignmentMaxOffset: 8,
  alignmentScaleEnabled: false,
  alignmentMaxScale: 2,
  localAlignmentEnabled: false,
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
    alignmentEnabled: payload.alignmentEnabled === true,
    alignmentMaxOffset: clampNumber(payload.alignmentMaxOffset, 1, 24, DEFAULT_BLEND_MATCH_CONFIG.alignmentMaxOffset),
    alignmentScaleEnabled: payload.alignmentScaleEnabled === true,
    alignmentMaxScale: clampNumber(payload.alignmentMaxScale, 0, 4, DEFAULT_BLEND_MATCH_CONFIG.alignmentMaxScale),
    localAlignmentEnabled: payload.localAlignmentEnabled === true,
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

async function transformLayerOffset(action, layerId, dx, dy) {
  await action.batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _id: Number(layerId) }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    offset: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: dx },
      vertical: { _unit: "pixelsUnit", _value: dy }
    }
  }], {});
}

async function transformLayerScale(action, layerId, scalePercent) {
  await action.batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _id: Number(layerId) }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    width: { _unit: "percentUnit", _value: scalePercent },
    height: { _unit: "percentUnit", _value: scalePercent },
    linked: true
  }], {});
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

async function makeMaskFromActiveLayerTransparency(action) {
  await action.batchPlay([
    {
      _obj: "set",
      _target: [{ _ref: "channel", _property: "selection" }],
      to: { _ref: "channel", _enum: "channel", _value: "transparencyEnum" }
    },
    {
      _obj: "make",
      new: { _class: "channel" },
      at: { _ref: "channel", _enum: "channel", _value: "mask" },
      using: { _enum: "userMaskEnabled", _value: "revealSelection" }
    },
    {
      _obj: "set",
      _target: [{ _ref: "channel", _property: "selection" }],
      to: { _enum: "ordinal", _value: "none" }
    }
  ], {});
}

async function featherActiveLayerMask(action, radius) {
  if (!(radius > 0)) return false;
  await action.batchPlay([
    {
      _obj: "select",
      _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }],
      makeVisible: false
    },
    {
      _obj: "gaussianBlur",
      radius: { _unit: "pixelsUnit", _value: radius }
    },
    {
      _obj: "select",
      _target: [{ _ref: "channel", _enum: "channel", _value: "RGB" }],
      makeVisible: false
    }
  ], {});
  return true;
}

async function applyFeatherBestEffort(action, radius, logs) {
  if (!(radius > 0)) {
    logs.push("[融合校色] 羽化半径为 0，已跳过边缘羽化。");
    return false;
  }
  try {
    await makeMaskFromActiveLayerTransparency(action);
    await featherActiveLayerMask(action, radius);
    logs.push(`[融合校色] 已基于当前图层透明度创建并羽化蒙版：${radius}px。`);
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
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  let count = 0;
  const cx = width / 2;
  const cy = height / 2;
  const safeScale = Math.max(0.92, Math.min(1.08, Number(scale) || 1));
  const startX = Math.max(1, region ? region.left : 1);
  const endX = Math.min(width - 1, region ? region.right : width - 1);
  const startY = Math.max(1, region ? region.top : 1);
  const endY = Math.min(height - 1, region ? region.bottom : height - 1);
  for (let y = startY; y < endY; y += stride) {
    const refRow = y * width;
    for (let x = startX; x < endX; x += stride) {
      const sourceX = cx + (x - cx) / safeScale + dx;
      const sourceY = cy + (y - cy) / safeScale + dy;
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

function estimateTileOffsets(sourceGrad, refGrad, width, height, sampleOffset, stride) {
  const tiles = [];
  const cols = 3;
  const rows = 3;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const region = {
        left: Math.floor((width * col) / cols),
        right: Math.floor((width * (col + 1)) / cols),
        top: Math.floor((height * row) / rows),
        bottom: Math.floor((height * (row + 1)) / rows)
      };
      let best = { dx: 0, dy: 0, score: -1 };
      for (let dy = -sampleOffset; dy <= sampleOffset; dy += 1) {
        for (let dx = -sampleOffset; dx <= sampleOffset; dx += 1) {
          const score = scoreTransform(sourceGrad, refGrad, width, height, dx, dy, 1, stride, region);
          if (score > best.score) best = { dx, dy, score };
        }
      }
      if (best.score > 0.18) tiles.push({ ...best, row, col });
    }
  }
  if (!tiles.length) return { tiles, spread: 0, meanDx: 0, meanDy: 0 };
  const meanDx = tiles.reduce((sum, tile) => sum + tile.dx, 0) / tiles.length;
  const meanDy = tiles.reduce((sum, tile) => sum + tile.dy, 0) / tiles.length;
  const spread = tiles.reduce((sum, tile) => sum + Math.hypot(tile.dx - meanDx, tile.dy - meanDy), 0) / tiles.length;
  return { tiles, spread, meanDx, meanDy };
}

function estimateGradientAlignment(sourceSample, referenceSample, configOrMaxOffset) {
  if (!sourceSample || !referenceSample || sourceSample.width !== referenceSample.width || sourceSample.height !== referenceSample.height) {
    return { applied: false, dx: 0, dy: 0, confidence: 0, reason: "preview-size-mismatch" };
  }
  const config = typeof configOrMaxOffset === "object"
    ? configOrMaxOffset
    : { alignmentMaxOffset: configOrMaxOffset, alignmentScaleEnabled: false, alignmentMaxScale: 0, localAlignmentEnabled: false };
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
  const local = config.localAlignmentEnabled
    ? estimateTileOffsets(sourceGrad, refGrad, width, height, Math.max(1, Math.min(8, sampleOffset)), Math.max(1, stride))
    : { tiles: [], spread: 0, meanDx: 0, meanDy: 0 };
  const localDeformation = local.tiles.length >= 4 && local.spread >= 1.4;
  const confidence = Math.max(0, Math.min(1, (best.score - Math.max(0, second)) * 3 + Math.max(0, best.score - 0.22)));
  const docDx = -best.dx * sourceSample.scaleX;
  const docDy = -best.dy * sourceSample.scaleY;
  const scalePercent = Number((best.scale * 100).toFixed(3));
  const significant = Math.abs(docDx) >= 0.35 || Math.abs(docDy) >= 0.35 || Math.abs(scalePercent - 100) >= 0.08;
  if (confidence < 0.18 || !significant) {
    return {
      applied: false,
      dx: 0,
      dy: 0,
      scalePercent: 100,
      confidence,
      score: best.score,
      sampleDx: best.dx,
      sampleDy: best.dy,
      sampleScale: best.scale,
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
    confidence,
    score: best.score,
    sampleDx: best.dx,
    sampleDy: best.dy,
    sampleScale: best.scale,
    local,
    localDeformation,
    reason: best.scale === 1 ? "gradient-ncc" : "gradient-ncc-scale"
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
        logs.push(`[融合校色] 梯度对齐：dx ${alignment.dx}px, dy ${alignment.dy}px, scale ${Number(alignment.scalePercent || 100).toFixed(2)}%, confidence ${alignment.confidence.toFixed(2)}。`);
      } else {
        logs.push(`[融合校色] 梯度对齐已跳过：${alignment.reason}，confidence ${Number(alignment.confidence || 0).toFixed(2)}。`);
      }
      if (alignment.localDeformation) {
        logs.push(`[融合校色] 局部对齐检测到轻微变形：${alignment.local.tiles.length} 个分块，偏移离散度 ${alignment.local.spread.toFixed(2)}px；已保守使用全局变换并依赖边缘融合过渡。`);
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
      if (Math.abs(Number(alignment.scalePercent || 100) - 100) >= 0.08) {
        await transformLayerScale(action, resultLayerId, alignment.scalePercent);
      }
      await transformLayerOffset(action, resultLayerId, alignment.dx, alignment.dy);
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
