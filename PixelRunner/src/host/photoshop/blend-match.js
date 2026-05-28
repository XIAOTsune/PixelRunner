import { getDocumentInfo, normalizeBounds } from "./document.js";
import { ensureDeps } from "./deps.js";

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
  localMeshMaxEdge: 1536,
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
    localMeshMaxEdge: clampNumber(payload.localMeshMaxEdge, 512, 2048, DEFAULT_BLEND_MATCH_CONFIG.localMeshMaxEdge),
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

function concatUint8Arrays(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

async function deflateBytes(bytes) {
  if (!bytes || !bytes.length || typeof CompressionStream !== "function") return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    c = PNG_CRC_TABLE[(c ^ bytes[index]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function asciiBytes(value) {
  return Uint8Array.from(String(value).split("").map((char) => char.charCodeAt(0)));
}

function uint32Bytes(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0);
  return out;
}

function buildPngChunk(type, data = new Uint8Array()) {
  const typeBytes = asciiBytes(type);
  return concatUint8Arrays([uint32Bytes(data.length), typeBytes, data, uint32Bytes(crc32(concatUint8Arrays([typeBytes, data])))]);
}

async function encodeRgbaPng(width, height, rgba) {
  const safeWidth = Math.max(1, Math.floor(Number(width) || 1));
  const safeHeight = Math.max(1, Math.floor(Number(height) || 1));
  if (!rgba || rgba.length < safeWidth * safeHeight * 4) return null;
  const bytesPerLine = safeWidth * 4;
  const scanlines = new Uint8Array((bytesPerLine + 1) * safeHeight);
  for (let y = 0; y < safeHeight; y += 1) {
    const rowOffset = y * (bytesPerLine + 1);
    scanlines[rowOffset] = 0;
    scanlines.set(rgba.subarray(y * bytesPerLine, (y + 1) * bytesPerLine), rowOffset + 1);
  }
  const compressed = await deflateBytes(scanlines);
  if (!compressed) return null;
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, safeWidth >>> 0);
  view.setUint32(4, safeHeight >>> 0);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return concatUint8Arrays([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    buildPngChunk("IHDR", ihdr),
    buildPngChunk("IDAT", compressed),
    buildPngChunk("IEND")
  ]).buffer;
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
  const weighted = { r: 0, g: 0, b: 0, luma: 0, sat: 0, weight: 0 };
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
    const localDetail = previousLuma >= 0 ? Math.abs(luma - previousLuma) : 0;
    if (previousLuma >= 0) sums.detail += localDetail;
    const midtoneWeight = 1 - Math.min(1, Math.abs(luma - 128) / 150);
    const chromaWeight = Math.min(1.8, sat * 2.4);
    const detailWeight = Math.min(1.2, localDetail / 24);
    const pixelWeight = 0.28 + midtoneWeight * 0.42 + chromaWeight * 0.58 + detailWeight * 0.28;
    weighted.r += r * pixelWeight;
    weighted.g += g * pixelWeight;
    weighted.b += b * pixelWeight;
    weighted.luma += luma * pixelWeight;
    weighted.sat += sat * pixelWeight;
    weighted.weight += pixelWeight;
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
    weightedMeanR: weighted.weight > 0 ? weighted.r / weighted.weight : sums.r / sums.count,
    weightedMeanG: weighted.weight > 0 ? weighted.g / weighted.weight : sums.g / sums.count,
    weightedMeanB: weighted.weight > 0 ? weighted.b / weighted.weight : sums.b / sums.count,
    weightedMeanLuma: weighted.weight > 0 ? weighted.luma / weighted.weight : meanLuma,
    weightedMeanSat: weighted.weight > 0 ? weighted.sat / weighted.weight : sums.sat / sums.count,
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
  const sourceLuma = Number(sourceStats.weightedMeanLuma) || sourceStats.meanLuma;
  const referenceLuma = Number(referenceStats.weightedMeanLuma) || referenceStats.meanLuma;
  const sourceSat = Number(sourceStats.weightedMeanSat) || sourceStats.meanSat;
  const referenceSat = Number(referenceStats.weightedMeanSat) || referenceStats.meanSat;
  const lumaDelta = referenceLuma - sourceLuma;
  const stdRatio = sourceStats.stdLuma > 1 ? referenceStats.stdLuma / sourceStats.stdLuma : 1;
  const detailRatio = sourceStats.detailEnergy > 0.5 ? referenceStats.detailEnergy / sourceStats.detailEnergy : 1;
  const rgbDelta = {
    r: referenceStats.meanR - sourceStats.meanR,
    g: referenceStats.meanG - sourceStats.meanG,
    b: referenceStats.meanB - sourceStats.meanB
  };
  const weightedRgbDelta = {
    r: (Number(referenceStats.weightedMeanR) || referenceStats.meanR) - (Number(sourceStats.weightedMeanR) || sourceStats.meanR),
    g: (Number(referenceStats.weightedMeanG) || referenceStats.meanG) - (Number(sourceStats.weightedMeanG) || sourceStats.meanG),
    b: (Number(referenceStats.weightedMeanB) || referenceStats.meanB) - (Number(sourceStats.weightedMeanB) || sourceStats.meanB)
  };
  const avgDelta = (weightedRgbDelta.r + weightedRgbDelta.g + weightedRgbDelta.b) / 3;
  const colorBias = {
    r: weightedRgbDelta.r - avgDelta,
    g: weightedRgbDelta.g - avgDelta,
    b: weightedRgbDelta.b - avgDelta
  };
  const directColorBias = {
    r: weightedRgbDelta.r - lumaDelta * 0.36,
    g: weightedRgbDelta.g - lumaDelta * 0.36,
    b: weightedRgbDelta.b - lumaDelta * 0.36
  };
  const finalColorBias = {
    r: colorBias.r * 0.68 + directColorBias.r * 0.32,
    g: colorBias.g * 0.68 + directColorBias.g * 0.32,
    b: colorBias.b * 0.68 + directColorBias.b * 0.32
  };

  return {
    brightness: clampNumber(Math.round(lumaDelta * 0.78 * luminanceAmount), -45, 45, 0),
    contrast: clampNumber(Math.round((((stdRatio - 1) * 0.72) + ((detailRatio - 1) * 0.28)) * 86 * contrastAmount), -35, 35, 0),
    saturation: clampNumber(Math.round((referenceSat - sourceSat) * 170 * saturationAmount), -35, 35, 0),
    colorBalance: {
      cyanRed: clampNumber(Math.round(finalColorBias.r * 0.72 * colorAmount), -32, 32, 0),
      magentaGreen: clampNumber(Math.round(finalColorBias.g * 0.72 * colorAmount), -32, 32, 0),
      yellowBlue: clampNumber(Math.round(finalColorBias.b * 0.72 * colorAmount), -32, 32, 0)
    },
    raw: {
      lumaDelta,
      stdRatio,
      detailRatio,
      saturationDelta: referenceSat - sourceSat,
      rgbDelta,
      weightedRgbDelta,
      colorBias: finalColorBias
    }
  };
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function lerp(a, b, t) {
  return a * (1 - t) + b * t;
}

function getSamplePixelCount(sample) {
  return Math.max(1, (Number(sample && sample.width) || 1) * (Number(sample && sample.height) || 1));
}

function copyRgba(data) {
  const out = new Uint8Array(data.length);
  out.set(data);
  return out;
}

function boxBlurFloat(input, width, height, radius) {
  const r = Math.max(0, Math.round(Number(radius) || 0));
  if (r <= 0) {
    const copy = new Float32Array(input.length);
    copy.set(input);
    return copy;
  }
  const temp = new Float32Array(input.length);
  const out = new Float32Array(input.length);
  const diameter = r * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let acc = 0;
    for (let x = -r; x <= r; x += 1) {
      acc += input[row + Math.max(0, Math.min(width - 1, x))];
    }
    for (let x = 0; x < width; x += 1) {
      temp[row + x] = acc / diameter;
      acc -= input[row + Math.max(0, x - r)];
      acc += input[row + Math.min(width - 1, x + r + 1)];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let acc = 0;
    for (let y = -r; y <= r; y += 1) {
      acc += temp[Math.max(0, Math.min(height - 1, y)) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = acc / diameter;
      acc -= temp[Math.max(0, y - r) * width + x];
      acc += temp[Math.min(height - 1, y + r + 1) * width + x];
    }
  }

  return out;
}

function buildYuvChannels(data, width, height) {
  const length = width * height;
  const y = new Float32Array(length);
  const u = new Float32Array(length);
  const v = new Float32Array(length);
  const alpha = new Float32Array(length);
  const saturation = new Float32Array(length);
  for (let pixel = 0, index = 0; pixel < length; pixel += 1, index += 4) {
    const r = Number(data[index]) || 0;
    const g = Number(data[index + 1]) || 0;
    const b = Number(data[index + 2]) || 0;
    const a = Math.max(0, Math.min(1, (Number(data[index + 3]) || 0) / 255));
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    y[pixel] = luma;
    u[pixel] = b - luma;
    v[pixel] = r - luma;
    alpha[pixel] = a;
    saturation[pixel] = max <= 0 ? 0 : (max - min) / max;
  }
  return { y, u, v, alpha, saturation };
}

function buildBlendWeights(sourceChannels, referenceChannels, width, height) {
  const length = width * height;
  const weights = new Float32Array(length);
  const sourceGrad = buildSobelMagnitude(sourceChannels.y, width, height);
  const refGrad = buildSobelMagnitude(referenceChannels.y, width, height);
  for (let i = 0; i < length; i += 1) {
    const alpha = Math.max(0, Math.min(1, sourceChannels.alpha[i]));
    if (alpha <= 0.02) {
      weights[i] = 0;
      continue;
    }
    const luma = sourceChannels.y[i];
    const midtone = 1 - Math.min(1, Math.abs(luma - 128) / 150);
    const sat = Math.max(sourceChannels.saturation[i], referenceChannels.saturation[i]);
    const texture = Math.min(1, Math.max(sourceGrad[i], refGrad[i]) / 42);
    weights[i] = alpha * (0.32 + midtone * 0.32 + Math.min(1, sat * 2.2) * 0.24 + texture * 0.28);
  }
  return weights;
}

function weightedStats(values, weights) {
  let sum = 0;
  let sumSq = 0;
  let weight = 0;
  for (let i = 0; i < values.length; i += 1) {
    const w = weights ? Number(weights[i]) || 0 : 1;
    if (w <= 0) continue;
    const value = Number(values[i]) || 0;
    sum += value * w;
    sumSq += value * value * w;
    weight += w;
  }
  if (weight <= 0) return { mean: 0, std: 1, weight: 0 };
  const mean = sum / weight;
  return {
    mean,
    std: Math.sqrt(Math.max(0.0001, sumSq / weight - mean * mean)),
    weight
  };
}

function transformChannelStats(source, reference, weights, amount, options = {}) {
  const sourceStats = weightedStats(source, weights);
  const referenceStats = weightedStats(reference, weights);
  const stdRatio = sourceStats.std > 0.01 ? Math.max(0.45, Math.min(2.25, referenceStats.std / sourceStats.std)) : 1;
  const meanDelta = Math.max(-options.maxMeanDelta || -255, Math.min(options.maxMeanDelta || 255, referenceStats.mean - sourceStats.mean));
  const ratioDelta = Math.max(-options.maxStdDelta || -1.2, Math.min(options.maxStdDelta || 1.2, stdRatio - 1));
  return {
    sourceMean: sourceStats.mean,
    referenceMean: referenceStats.mean,
    sourceStd: sourceStats.std,
    referenceStd: referenceStats.std,
    meanDelta,
    stdRatio,
    amount,
    apply(value) {
      return sourceStats.mean + (value - sourceStats.mean) * (1 + ratioDelta * amount) + meanDelta * amount;
    }
  };
}

function yuvToRgb(y, u, v) {
  const r = y + v;
  const b = y + u;
  const g = (y - 0.299 * r - 0.114 * b) / 0.587;
  return [r, g, b];
}

function applySaturationToRgb(r, g, b, factor) {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [
    y + (r - y) * factor,
    y + (g - y) * factor,
    y + (b - y) * factor
  ];
}

function buildEdgeBlendMask(sourceChannels, width, height, radius, amount) {
  const length = width * height;
  const mask = new Float32Array(length);
  const r = Math.max(1, Math.round(Number(radius) || 0));
  const maxAmount = Math.max(0, Math.min(0.5, Number(amount) || 0));
  if (maxAmount <= 0) return mask;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const alpha = sourceChannels.alpha[i];
      if (alpha <= 0.02) continue;
      const borderDistance = Math.min(x, y, width - 1 - x, height - 1 - y);
      let edge = Math.max(0, 1 - borderDistance / r);
      if (alpha < 0.98) edge = Math.max(edge, 1 - alpha);
      mask[i] = Math.min(maxAmount, edge * edge * maxAmount);
    }
  }
  return mask;
}

function applyGlobalAndLocalWarp(sample, alignment, alignmentSample) {
  if (!sample || !sample.data) return null;
  const width = Math.max(1, Number(sample.width) || 1);
  const height = Math.max(1, Number(sample.height) || 1);
  const out = new Uint8Array(width * height * 4);
  const hasGlobal = Boolean(alignment && alignment.applied);
  const local = alignment && alignment.local && alignment.local.applied ? alignment.local : null;
  const sourceWidth = Math.max(1, Number(alignmentSample && alignmentSample.width) || width);
  const sourceHeight = Math.max(1, Number(alignmentSample && alignmentSample.height) || height);
  const dxScale = width / sourceWidth;
  const dyScale = height / sourceHeight;
  const cx = width / 2;
  const cy = height / 2;
  const scaleX = Math.max(0.92, Math.min(1.08, Number(alignment && alignment.sampleScaleX) || 1));
  const scaleY = Math.max(0.92, Math.min(1.08, Number(alignment && alignment.sampleScaleY) || 1));
  const rotation = ((Number(alignment && alignment.sampleRotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const globalDx = (Number(alignment && alignment.sampleDx) || 0) * dxScale;
  const globalDy = (Number(alignment && alignment.sampleDy) || 0) * dyScale;
  const mesh = local ? buildDenseMeshGrid(local, width, height, dxScale, dyScale) : null;
  const localStrength = local ? Math.max(0, Math.min(1, Number(local.strength) || DEFAULT_BLEND_MATCH_CONFIG.localMeshStrength)) : 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      let sampleX = x;
      let sampleY = y;
      if (hasGlobal) {
        const localX = x - cx;
        const localY = y - cy;
        sampleX = cx + ((localX * cos - localY * sin) / scaleX) + globalDx;
        sampleY = cy + ((localX * sin + localY * cos) / scaleY) + globalDy;
      }
      if (mesh) {
        const flow = interpolateMeshOffset(mesh, x, y);
        sampleX += flow.dx * localStrength;
        sampleY += flow.dy * localStrength;
      }
      sampleRgbaBilinear(sample.data, width, height, sampleX, sampleY, out, offset);
    }
  }

  return {
    width,
    height,
    data: out,
    globalApplied: hasGlobal,
    localApplied: Boolean(local),
    localStrength,
    validTiles: Number(local && local.validTiles) || 0,
    totalTiles: Number(local && local.totalTiles) || 0,
    maxDistance: Number(local && local.maxDistance) || 0
  };
}

function processBlendMatchPixels(sourceSample, referenceSample, config, alignment, alignmentSample) {
  if (!sourceSample || !referenceSample || !sourceSample.data || !referenceSample.data) {
    throw new Error("像素样本不完整。");
  }
  const width = Math.max(1, Number(sourceSample.width) || 1);
  const height = Math.max(1, Number(sourceSample.height) || 1);
  if (width !== Number(referenceSample.width) || height !== Number(referenceSample.height)) {
    throw new Error("source/reference 像素尺寸不一致。");
  }

  const warped = applyGlobalAndLocalWarp(sourceSample, alignment, alignmentSample || sourceSample);
  const sourceData = warped && warped.data ? warped.data : copyRgba(sourceSample.data);
  const sourceChannels = buildYuvChannels(sourceData, width, height);
  const referenceChannels = buildYuvChannels(referenceSample.data, width, height);
  const weights = buildBlendWeights(sourceChannels, referenceChannels, width, height);
  const total = Math.max(0, Math.min(1, Number(config.totalStrength) / 100 || 0));
  const luminanceAmount = total * Math.max(0, Math.min(1.25, Number(config.luminanceStrength) / 100 || 0));
  const colorAmount = total * Math.max(0, Math.min(1.35, Number(config.colorStrength) / 100 || 0));
  const contrastAmount = total * Math.max(0, Math.min(1.25, Number(config.contrastStrength) / 100 || 0));
  const saturationAmount = total * Math.max(-1, Math.min(1.25, Number(config.saturationStrength) / 100 || 0));
  const longEdge = Math.max(width, height);
  const lowRadius = Math.max(7, Math.min(48, Math.round(longEdge / 36)));
  const midRadius = Math.max(2, Math.min(16, Math.round(longEdge / 130)));
  const edgeRadius = Math.max(2, Math.min(80, Math.round((Number(config.featherRadius) || 0) / Math.max(sourceSample.scaleX || 1, sourceSample.scaleY || 1))));

  const srcLowY = boxBlurFloat(sourceChannels.y, width, height, lowRadius);
  const refLowY = boxBlurFloat(referenceChannels.y, width, height, lowRadius);
  const srcMidBaseY = boxBlurFloat(sourceChannels.y, width, height, midRadius);
  const refMidBaseY = boxBlurFloat(referenceChannels.y, width, height, midRadius);
  const srcLowU = boxBlurFloat(sourceChannels.u, width, height, lowRadius);
  const refLowU = boxBlurFloat(referenceChannels.u, width, height, lowRadius);
  const srcLowV = boxBlurFloat(sourceChannels.v, width, height, lowRadius);
  const refLowV = boxBlurFloat(referenceChannels.v, width, height, lowRadius);
  const srcMidBaseU = boxBlurFloat(sourceChannels.u, width, height, midRadius);
  const refMidBaseU = boxBlurFloat(referenceChannels.u, width, height, midRadius);
  const srcMidBaseV = boxBlurFloat(sourceChannels.v, width, height, midRadius);
  const refMidBaseV = boxBlurFloat(referenceChannels.v, width, height, midRadius);

  const length = getSamplePixelCount(sourceSample);
  const srcMidY = new Float32Array(length);
  const refMidY = new Float32Array(length);
  const srcMidU = new Float32Array(length);
  const refMidU = new Float32Array(length);
  const srcMidV = new Float32Array(length);
  const refMidV = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    srcMidY[i] = srcMidBaseY[i] - srcLowY[i];
    refMidY[i] = refMidBaseY[i] - refLowY[i];
    srcMidU[i] = srcMidBaseU[i] - srcLowU[i];
    refMidU[i] = refMidBaseU[i] - refLowU[i];
    srcMidV[i] = srcMidBaseV[i] - srcLowV[i];
    refMidV[i] = refMidBaseV[i] - refLowV[i];
  }

  const lowYAdjust = transformChannelStats(srcLowY, refLowY, weights, luminanceAmount * 0.86 + contrastAmount * 0.16, { maxMeanDelta: 42, maxStdDelta: 0.38 });
  const midYAdjust = transformChannelStats(srcMidY, refMidY, weights, contrastAmount * 0.72 + luminanceAmount * 0.18, { maxMeanDelta: 10, maxStdDelta: 0.52 });
  const lowUAdjust = transformChannelStats(srcLowU, refLowU, weights, colorAmount * 0.96, { maxMeanDelta: 34, maxStdDelta: 0.45 });
  const lowVAdjust = transformChannelStats(srcLowV, refLowV, weights, colorAmount * 0.96, { maxMeanDelta: 34, maxStdDelta: 0.45 });
  const midUAdjust = transformChannelStats(srcMidU, refMidU, weights, colorAmount * 0.56, { maxMeanDelta: 12, maxStdDelta: 0.35 });
  const midVAdjust = transformChannelStats(srcMidV, refMidV, weights, colorAmount * 0.56, { maxMeanDelta: 12, maxStdDelta: 0.35 });
  const sourceSatStats = weightedStats(sourceChannels.saturation, weights);
  const referenceSatStats = weightedStats(referenceChannels.saturation, weights);
  const saturationFactor = Math.max(0.58, Math.min(1.55, 1 + (referenceSatStats.mean - sourceSatStats.mean) * 1.55 * saturationAmount));
  const edgeBlend = buildEdgeBlendMask(sourceChannels, width, height, edgeRadius, total * 0.34);
  const out = new Uint8Array(width * height * 4);

  for (let i = 0, index = 0; i < length; i += 1, index += 4) {
    const alpha = sourceData[index + 3];
    if (alpha <= 0) {
      out[index] = 0;
      out[index + 1] = 0;
      out[index + 2] = 0;
      out[index + 3] = 0;
      continue;
    }
    const highY = sourceChannels.y[i] - srcMidBaseY[i];
    const highU = sourceChannels.u[i] - srcMidBaseU[i];
    const highV = sourceChannels.v[i] - srcMidBaseV[i];
    const y = lowYAdjust.apply(srcLowY[i]) + midYAdjust.apply(srcMidY[i]) + highY * (1 + contrastAmount * 0.08);
    const u = lowUAdjust.apply(srcLowU[i]) + midUAdjust.apply(srcMidU[i]) + highU * (1 - colorAmount * 0.08);
    const v = lowVAdjust.apply(srcLowV[i]) + midVAdjust.apply(srcMidV[i]) + highV * (1 - colorAmount * 0.08);
    let [r, g, b] = yuvToRgb(y, u, v);
    [r, g, b] = applySaturationToRgb(r, g, b, saturationFactor);
    const edge = edgeBlend[i];
    if (edge > 0) {
      r = lerp(r, referenceSample.data[index], edge);
      g = lerp(g, referenceSample.data[index + 1], edge);
      b = lerp(b, referenceSample.data[index + 2], edge);
    }
    out[index] = clampByte(r);
    out[index + 1] = clampByte(g);
    out[index + 2] = clampByte(b);
    out[index + 3] = alpha;
  }

  return {
    width,
    height,
    data: out,
    alignment: {
      globalApplied: Boolean(warped && warped.globalApplied),
      localApplied: Boolean(warped && warped.localApplied),
      validTiles: Number(warped && warped.validTiles) || 0,
      totalTiles: Number(warped && warped.totalTiles) || 0,
      maxDistance: Number(warped && warped.maxDistance) || 0,
      localStrength: Number(warped && warped.localStrength) || 0
    },
    color: {
      lowRadius,
      midRadius,
      edgeRadius,
      luminanceDelta: Number((lowYAdjust.referenceMean - lowYAdjust.sourceMean).toFixed(2)),
      chromaUDelta: Number((lowUAdjust.referenceMean - lowUAdjust.sourceMean).toFixed(2)),
      chromaVDelta: Number((lowVAdjust.referenceMean - lowVAdjust.sourceMean).toFixed(2)),
      luminanceStdRatio: Number(lowYAdjust.stdRatio.toFixed(3)),
      saturationFactor: Number(saturationFactor.toFixed(3)),
      weightedPixels: Math.round(weightedStats(sourceChannels.y, weights).weight)
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
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    _options: { dialogOptions: "dontDisplay" }
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

async function transformLayerScale(action, layerId, scaleXPercent, scaleYPercent) {
  await action.batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _id: Number(layerId) }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    width: { _unit: "percentUnit", _value: scaleXPercent },
    height: { _unit: "percentUnit", _value: scaleYPercent },
    linked: false,
    _options: { dialogOptions: "dontDisplay" }
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
    },
    _options: { dialogOptions: "dontDisplay" }
  }], {});
}

function getBoundsSize(bounds) {
  return {
    width: Math.max(1, Number(bounds && bounds.right) - Number(bounds && bounds.left)),
    height: Math.max(1, Number(bounds && bounds.bottom) - Number(bounds && bounds.top))
  };
}

function getBoundsCenter(bounds) {
  return {
    x: (Number(bounds.left) + Number(bounds.right)) / 2,
    y: (Number(bounds.top) + Number(bounds.bottom)) / 2
  };
}

async function alignActiveLayerToBounds(app, action, targetBounds) {
  const layer = app && app.activeDocument && app.activeDocument.activeLayers && app.activeDocument.activeLayers[0];
  const bounds = parseLayerBounds(layer && layer.bounds);
  if (!layer || !bounds || !targetBounds) return false;
  const currentSize = getBoundsSize(bounds);
  const targetSize = getBoundsSize(targetBounds);
  const scaleX = targetSize.width / currentSize.width;
  const scaleY = targetSize.height / currentSize.height;
  if (
    Number.isFinite(scaleX) &&
    Number.isFinite(scaleY) &&
    scaleX > 0 &&
    scaleY > 0 &&
    (Math.abs(scaleX - 1) > 0.0001 || Math.abs(scaleY - 1) > 0.0001)
  ) {
    await transformLayerScale(action, layer.id, scaleX * 100, scaleY * 100);
  }

  const nextLayer = app && app.activeDocument && app.activeDocument.activeLayers && app.activeDocument.activeLayers[0];
  const nextBounds = parseLayerBounds(nextLayer && nextLayer.bounds);
  if (!nextLayer || !nextBounds) return false;
  const currentCenter = getBoundsCenter(nextBounds);
  const targetCenter = getBoundsCenter(targetBounds);
  const dx = targetCenter.x - currentCenter.x;
  const dy = targetCenter.y - currentCenter.y;
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
    await transformLayerOffset(action, nextLayer.id, dx, dy);
  }
  return true;
}

async function placePngBufferAsLayer(app, action, storage, buffer, targetBounds, layerName) {
  const fs = storage && storage.localFileSystem;
  const formats = storage && storage.formats;
  if (!fs || !formats || !(buffer instanceof ArrayBuffer)) return null;
  const tempFolder = await fs.getTemporaryFolder();
  const tempFile = await tempFolder.createFile("pixelrunner-blend-match-mesh.png", { overwrite: true });
  await tempFile.write(buffer, { format: formats.binary });
  const sessionToken = await fs.createSessionToken(tempFile);
  await action.batchPlay([{
    _obj: "placeEvent",
    null: { _path: sessionToken, _kind: "local" },
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    offset: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: 0 },
      vertical: { _unit: "pixelsUnit", _value: 0 }
    },
    _options: { dialogOptions: "dontDisplay" }
  }], {});
  await alignActiveLayerToBounds(app, action, targetBounds);
  const layer = app && app.activeDocument && app.activeDocument.activeLayers && app.activeDocument.activeLayers[0];
  if (!layer) return null;
  try {
    layer.name = String(layerName || "PixelRunner 融合校色").slice(0, 240);
  } catch (_) {}
  return layer;
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

function buildSobelField(luma, width, height) {
  const length = width * height;
  const gxOut = new Float32Array(length);
  const gyOut = new Float32Array(length);
  const mag = new Float32Array(length);
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
      gxOut[i] = gx;
      gyOut[i] = gy;
      mag[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return { gx: gxOut, gy: gyOut, mag };
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

function scoreGradientFieldOffset(sourceField, referenceField, width, height, dx, dy, stride, region = null) {
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  let directionSum = 0;
  let overlapSum = 0;
  let weightSum = 0;
  let count = 0;
  const startX = Math.max(1, region ? region.left : 1);
  const endX = Math.min(width - 1, region ? region.right : width - 1);
  const startY = Math.max(1, region ? region.top : 1);
  const endY = Math.min(height - 1, region ? region.bottom : height - 1);
  const step = Math.max(1, Number(stride) || 1);
  for (let y = startY; y < endY; y += step) {
    const sourceY = y + dy;
    if (sourceY < 1 || sourceY >= height - 1) continue;
    const refRow = y * width;
    const sourceRow = Math.round(sourceY) * width;
    for (let x = startX; x < endX; x += step) {
      const sourceX = x + dx;
      if (sourceX < 1 || sourceX >= width - 1) continue;
      const refIndex = refRow + x;
      const sourceIndex = sourceRow + Math.round(sourceX);
      const a = sourceField.mag[sourceIndex];
      const b = referenceField.mag[refIndex];
      if (a < 6 && b < 6) continue;
      const edgeWeight = Math.min(2.4, Math.max(a, b) / 18) * (0.35 + Math.min(a, b) / Math.max(1, Math.max(a, b)) * 0.65);
      sumA += a * edgeWeight;
      sumB += b * edgeWeight;
      sumAA += a * a * edgeWeight;
      sumBB += b * b * edgeWeight;
      sumAB += a * b * edgeWeight;
      const sourceMag = Math.max(0.001, a);
      const refMag = Math.max(0.001, b);
      const cos = (
        sourceField.gx[sourceIndex] * referenceField.gx[refIndex] +
        sourceField.gy[sourceIndex] * referenceField.gy[refIndex]
      ) / Math.max(0.001, sourceMag * refMag);
      directionSum += Math.max(-1, Math.min(1, cos)) * edgeWeight;
      overlapSum += (Math.min(a, b) / Math.max(1, Math.max(a, b))) * edgeWeight;
      weightSum += edgeWeight;
      count += 1;
    }
  }
  if (count < 36 || weightSum <= 0) {
    return { score: -1, ncc: -1, direction: 0, overlap: 0, count };
  }
  const numerator = sumAB - (sumA * sumB) / weightSum;
  const denomA = sumAA - (sumA * sumA) / weightSum;
  const denomB = sumBB - (sumB * sumB) / weightSum;
  const denom = Math.sqrt(Math.max(0.0001, denomA * denomB));
  const ncc = numerator / denom;
  const direction = directionSum / weightSum;
  const overlap = overlapSum / weightSum;
  return {
    score: ncc * 0.62 + direction * 0.28 + overlap * 0.1,
    ncc,
    direction,
    overlap,
    count
  };
}

function buildScaleCandidates(maxScalePercent, enabled) {
  if (!enabled || !(maxScalePercent > 0)) return [1];
  const maxScale = Math.max(0, Math.min(4, Number(maxScalePercent) || 0));
  const out = [1];
  const unit = maxScale <= 1.25 ? 0.25 : 0.5;
  for (let step = unit; step <= maxScale + 0.001; step += unit) {
    out.push(1 - step / 100, 1 + step / 100);
  }
  if (Math.abs(maxScale % unit) > 0.001) {
    out.push(1 - maxScale / 100, 1 + maxScale / 100);
  }
  return out.sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1));
}

function buildSymmetricCandidates(maxValue, enabled, unit = 1) {
  if (!enabled || !(maxValue > 0)) return [0];
  const max = Math.max(0, Number(maxValue) || 0);
  const step = Math.max(0.05, Number(unit) || 1);
  const raw = [0];
  for (let value = step; value <= max + 0.001; value += step) {
    raw.push(-value, value);
  }
  if (Math.abs(max % step) > 0.001) raw.push(-max, max);
  return Array.from(new Set(raw)).sort((a, b) => Math.abs(a) - Math.abs(b));
}

function buildStretchPairs(maxStretch, enabled) {
  if (!enabled || !(maxStretch > 0)) return [[0, 0]];
  const values = buildSymmetricCandidates(maxStretch, true, maxStretch <= 1.5 ? 0.25 : 0.5);
  const pairs = [[0, 0]];
  const addPair = (x, y) => {
    const key = `${Number(x).toFixed(3)},${Number(y).toFixed(3)}`;
    if (!pairs.some((pair) => `${Number(pair[0]).toFixed(3)},${Number(pair[1]).toFixed(3)}` === key)) {
      pairs.push([x, y]);
    }
  };
  values.forEach((value) => {
    if (Math.abs(value) < 0.0001) return;
    addPair(0, value);
    addPair(value, 0);
    addPair(value, value);
    addPair(value, -value);
    addPair(-value, value);
  });
  return pairs.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
}

function refineAffineAlignment(sourceGrad, refGrad, width, height, base, baseSecondScore, config, sampleOffset, stride) {
  const rotationCandidates = buildSymmetricCandidates(config.alignmentMaxRotation, true, 0.25);
  const maxStretch = Math.max(0, Number(config.alignmentMaxStretch) || 0);
  const stretchPairs = buildStretchPairs(maxStretch, config.alignmentScaleEnabled);
  const offsetWindow = Math.max(1, Math.min(2, Math.round(sampleOffset / 5)));
  const refineStride = Math.max(1, stride);
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
        stretchPairs.forEach(([stretchX, stretchY]) => {
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
  const meanDistance = tiles.reduce((sum, tile) => sum + Math.hypot(tile.dx, tile.dy), 0) / tiles.length;
  const meanAbsDx = tiles.reduce((sum, tile) => sum + Math.abs(tile.dx), 0) / tiles.length;
  const meanAbsDy = tiles.reduce((sum, tile) => sum + Math.abs(tile.dy), 0) / tiles.length;
  const meanDirectionAgreement = tiles.reduce((sum, tile) => sum + (Number(tile.directionAgreement) || 0), 0) / tiles.length;
  const coverage = tiles.length / Math.max(1, rows * cols);
  const enoughCoverage = tiles.length >= Math.max(4, Math.round(rows * cols * 0.34));
  const enoughMotion = maxDistance >= 0.55 || meanDistance >= 0.35 || meanAbsDx >= 0.32 || meanAbsDy >= 0.32;
  const enoughLocalShape = spread >= 0.28 || maxDistance >= 0.8 || meanDistance >= 0.42;
  const applied = enoughCoverage && enoughMotion && enoughLocalShape;
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
    meanDistance,
    meanAbsDx,
    meanAbsDy,
    meanDirectionAgreement,
    maxDistance,
    reason: applied ? "local-gradient-mesh" : coverage < 0.34 ? "low-coverage" : !enoughMotion ? "low-local-motion" : "low-local-spread",
    tiles: tiles.map((tile) => ({
      row: tile.row,
      col: tile.col,
      dx: Number(tile.dx.toFixed(2)),
      dy: Number(tile.dy.toFixed(2)),
      score: Number(tile.score.toFixed(3)),
      directionAgreement: Number((Number(tile.directionAgreement) || 0).toFixed(3)),
      scoreGap: Number(tile.scoreGap.toFixed(3)),
      textureEnergy: Number(tile.textureEnergy.toFixed(2))
    }))
  };
}

function buildDenseMeshGrid(local, width, height, scaleX = 1, scaleY = 1) {
  const rows = Math.max(1, Number(local && local.rows) || 1);
  const cols = Math.max(1, Number(local && local.cols) || 1);
  const tiles = Array.isArray(local && local.tiles) ? local.tiles : [];
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
  tiles.forEach((tile) => {
    const row = Number(tile.row);
    const col = Number(tile.col);
    if (row >= 0 && row < rows && col >= 0 && col < cols) {
      grid[row][col] = {
        dx: (Number(tile.dx) || 0) * scaleX,
        dy: (Number(tile.dy) || 0) * scaleY,
        weight: Math.max(0.1, Number(tile.score) || 0.1)
      };
    }
  });

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (grid[row][col]) continue;
      let dx = 0;
      let dy = 0;
      let weight = 0;
      tiles.forEach((tile) => {
        const distance = Math.hypot(Number(tile.row) - row, Number(tile.col) - col);
        const tileWeight = (Math.max(0.1, Number(tile.score) || 0.1)) / Math.max(0.75, distance * distance);
        dx += (Number(tile.dx) || 0) * scaleX * tileWeight;
        dy += (Number(tile.dy) || 0) * scaleY * tileWeight;
        weight += tileWeight;
      });
      grid[row][col] = weight > 0 ? { dx: dx / weight, dy: dy / weight, weight } : { dx: 0, dy: 0, weight: 0 };
    }
  }
  return { rows, cols, grid, width, height };
}

function interpolateMeshOffset(mesh, x, y) {
  const cols = mesh.cols;
  const rows = mesh.rows;
  if (cols <= 1 || rows <= 1) return mesh.grid[0][0] || { dx: 0, dy: 0 };
  const gx = Math.max(0, Math.min(cols - 1, (x / Math.max(1, mesh.width - 1)) * (cols - 1)));
  const gy = Math.max(0, Math.min(rows - 1, (y / Math.max(1, mesh.height - 1)) * (rows - 1)));
  const x0 = Math.max(0, Math.min(cols - 1, Math.floor(gx)));
  const y0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)));
  const x1 = Math.max(0, Math.min(cols - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(rows - 1, y0 + 1));
  const tx = gx - x0;
  const ty = gy - y0;
  const a = mesh.grid[y0][x0];
  const b = mesh.grid[y0][x1];
  const c = mesh.grid[y1][x0];
  const d = mesh.grid[y1][x1];
  const topDx = a.dx * (1 - tx) + b.dx * tx;
  const topDy = a.dy * (1 - tx) + b.dy * tx;
  const bottomDx = c.dx * (1 - tx) + d.dx * tx;
  const bottomDy = c.dy * (1 - tx) + d.dy * tx;
  return {
    dx: topDx * (1 - ty) + bottomDx * ty,
    dy: topDy * (1 - ty) + bottomDy * ty
  };
}

function sampleRgbaBilinear(data, width, height, x, y, out, offset) {
  const sx = Math.max(0, Math.min(width - 1, x));
  const sy = Math.max(0, Math.min(height - 1, y));
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
  for (let channel = 0; channel < 4; channel += 1) {
    const top = data[i00 + channel] * (1 - tx) + data[i10 + channel] * tx;
    const bottom = data[i01 + channel] * (1 - tx) + data[i11 + channel] * tx;
    out[offset + channel] = Math.max(0, Math.min(255, Math.round(top * (1 - ty) + bottom * ty)));
  }
}

function warpSampleWithLocalMesh(sample, local, alignmentSample) {
  if (!sample || !sample.data || !local || !local.applied) return null;
  const width = Math.max(1, Number(sample.width) || 1);
  const height = Math.max(1, Number(sample.height) || 1);
  const sourceWidth = Math.max(1, Number(alignmentSample && alignmentSample.width) || width);
  const sourceHeight = Math.max(1, Number(alignmentSample && alignmentSample.height) || height);
  const mesh = buildDenseMeshGrid(local, width, height, width / sourceWidth, height / sourceHeight);
  const strength = Math.max(0, Math.min(1, Number(local.strength) || DEFAULT_BLEND_MATCH_CONFIG.localMeshStrength));
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const flow = interpolateMeshOffset(mesh, x, y);
      const sampleX = x + flow.dx * strength;
      const sampleY = y + flow.dy * strength;
      sampleRgbaBilinear(sample.data, width, height, sampleX, sampleY, out, offset);
    }
  }
  return {
    width,
    height,
    data: out,
    strength,
    validTiles: Number(local.validTiles) || 0,
    totalTiles: Number(local.totalTiles) || 0,
    maxDistance: Number(local.maxDistance) || 0
  };
}

function estimateTileOffsets(sourceField, refField, width, height, sampleOffset, stride, config = {}) {
  const tiles = [];
  const profile = buildLocalMeshProfile(width, height, config);
  const cols = profile.cols;
  const rows = profile.rows;
  const searchOffset = Math.max(1, Math.min(profile.maxOffset, sampleOffset));
  const minTileScore = 0.18;
  const minScoreGap = 0.004;
  const minTextureEnergy = 4.5;
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
      const textureEnergy = sampleGradientEnergy(refField.mag, width, height, region, Math.max(1, stride));
      if (textureEnergy < minTextureEnergy) continue;
      let best = { dx: 0, dy: 0, score: -1, directionAgreement: 0 };
      let second = -1;
      for (let dy = -searchOffset; dy <= searchOffset; dy += 1) {
        for (let dx = -searchOffset; dx <= searchOffset; dx += 1) {
          const scored = scoreGradientFieldOffset(sourceField, refField, width, height, dx, dy, stride, region);
          const score = scored.score;
          const distance = Math.hypot(dx, dy);
          const bestDistance = Math.hypot(best.dx, best.dy);
          const beatsBest =
            score > best.score + 0.00001 ||
            (Math.abs(score - best.score) <= 0.00001 && distance > bestDistance && scored.direction > best.directionAgreement + 0.02);
          if (beatsBest) {
            second = best.score;
            best = { dx, dy, score, directionAgreement: scored.direction, overlap: scored.overlap, ncc: scored.ncc };
          } else if (score > second) {
            second = score;
          }
        }
      }
      const scoreGap = best.score - Math.max(0, second);
      const nonZeroMotion = Math.hypot(best.dx, best.dy) >= 0.75;
      const directionOk = best.directionAgreement > 0.18;
      if (best.score > minTileScore && directionOk && (scoreGap > minScoreGap || (nonZeroMotion && best.score > minTileScore + 0.06))) {
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
  const sourceField = buildSobelField(buildLuma(sourceSample.data, width, height), width, height);
  const refField = buildSobelField(buildLuma(referenceSample.data, width, height), width, height);
  const sourceGrad = sourceField.mag;
  const refGrad = refField.mag;
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
    ? estimateTileOffsets(sourceField, refField, width, height, Math.max(1, Math.min(8, sampleOffset)), Math.max(1, stride), config)
    : { enabled: false, applied: false, tiles: [], spread: 0, meanDx: 0, meanDy: 0, validTiles: 0, totalTiles: 0, reason: "disabled" };
  const localDeformation = Boolean(local.applied);
  const localDampen = localDeformation ? Math.max(0.12, Math.min(0.38, local.strength * 0.5)) : 0;
  const effectiveBest = localDeformation
    ? {
        ...affineBest,
        dx: affineBest.dx * (1 - localDampen * 0.25) + local.meanDx * localDampen * 0.25,
        dy: affineBest.dy * (1 - localDampen * 0.25) + local.meanDy * localDampen * 0.25,
        scaleX: affineBest.scaleX,
        scaleY: affineBest.scaleY,
        rotation: affineBest.rotation * (1 - localDampen * 0.5)
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
        const rawScaleX = Number(alignment.rawSampleScaleX) * 100;
        const rawScaleY = Number(alignment.rawSampleScaleY) * 100;
        const rawRotation = Number(alignment.rawSampleRotation) || 0;
        if (
          Number.isFinite(rawScaleX) &&
          (Math.abs(rawScaleX - Number(alignment.scaleXPercent || 100)) >= 0.03 ||
            Math.abs(rawScaleY - Number(alignment.scaleYPercent || 100)) >= 0.03 ||
            Math.abs(rawRotation - Number(alignment.rotation || 0)) >= 0.03)
        ) {
          logs.push(`[融合校色] 对齐原始搜索：scaleX ${rawScaleX.toFixed(2)}%, scaleY ${rawScaleY.toFixed(2)}%, rotate ${rawRotation.toFixed(2)}°；最终应用已按局部网格稳定性约束。`);
        }
      } else {
        logs.push(`[融合校色] 梯度对齐已跳过：${alignment.reason}，confidence ${Number(alignment.confidence || 0).toFixed(2)}。`);
      }
      if (alignment.localDeformation) {
        logs.push(`[融合校色] 局部网格对齐：${alignment.local.validTiles}/${alignment.local.totalTiles} 个分块有效，最大局部偏移 ${alignment.local.maxDistance.toFixed(2)}px，平均偏移 ${Number(alignment.local.meanDistance || 0).toFixed(2)}px，方向一致性 ${Number(alignment.local.meanDirectionAgreement || 0).toFixed(2)}，离散度 ${alignment.local.spread.toFixed(2)}px，强度 ${Math.round(alignment.local.strength * 100)}%。`);
      } else if (alignment.local && alignment.local.enabled) {
        logs.push(`[融合校色] 局部网格对齐已跳过：${alignment.local.reason}，有效分块 ${alignment.local.validTiles || 0}/${alignment.local.totalTiles || 0}，最大偏移 ${Number(alignment.local.maxDistance || 0).toFixed(2)}px，平均偏移 ${Number(alignment.local.meanDistance || 0).toFixed(2)}px，方向一致性 ${Number(alignment.local.meanDirectionAgreement || 0).toFixed(2)}，离散度 ${Number(alignment.local.spread || 0).toFixed(2)}px。`);
      }
    }

    const corrections = buildCorrections(sourceStats, referenceStats, config);
    await selectLayerById(action, sourceLayerId);
    let resultLayer = null;
    let resultLayerId = 0;
    let pixelPipelineUsed = false;
    let pixelResult = null;

    try {
      const { storage } = await ensureDeps();
      const processingTargetSize = getSamplingTargetSize(sourceBounds, config.localMeshMaxEdge);
      let processingSourceSample = sourceSample;
      let processingReferenceSample = referenceSample;
      if (processingTargetSize.width !== sourceSample.width || processingTargetSize.height !== sourceSample.height) {
        let processingRestoredVisibility = false;
        try {
          processingSourceSample = await captureCompositeSample(imaging, document, sourceBounds, config.localMeshMaxEdge, false);
          await setLayerVisible(action, sourceLayerId, false);
          processingReferenceSample = await captureCompositeSample(imaging, document, sourceBounds, config.localMeshMaxEdge, false);
          await setLayerVisible(action, sourceLayerId, sourceWasVisible);
          processingRestoredVisibility = true;
          logs.push(`[融合校色] 像素处理采样：${processingSourceSample.width}x${processingSourceSample.height}。`);
        } finally {
          if (!processingRestoredVisibility) {
            try {
              await setLayerVisible(action, sourceLayerId, sourceWasVisible);
            } catch (_) {}
          }
        }
      } else {
        logs.push(`[融合校色] 像素处理复用分析采样：${processingSourceSample.width}x${processingSourceSample.height}。`);
      }

      pixelResult = processBlendMatchPixels(processingSourceSample, processingReferenceSample, config, alignment, sourceSample);
      const pngBuffer = await encodeRgbaPng(pixelResult.width, pixelResult.height, pixelResult.data);
      if (!pngBuffer) throw new Error("像素结果 PNG 编码不可用。");
      resultLayer = await placePngBufferAsLayer(app, action, storage, pngBuffer, sourceBounds, resultLayerName);
      resultLayerId = getLayerId(resultLayer);
      if (!(resultLayerId > 0)) throw new Error("像素结果层置入失败。");
      pixelPipelineUsed = true;
      logs.push(`[融合校色] 像素网格对齐：全局 ${pixelResult.alignment.globalApplied ? "启用" : "跳过"}，局部 ${pixelResult.alignment.localApplied ? "启用" : "跳过"}，有效分块 ${pixelResult.alignment.validTiles}/${pixelResult.alignment.totalTiles}，最大偏移 ${Number(pixelResult.alignment.maxDistance || 0).toFixed(2)}px。`);
      logs.push(`[融合校色] 像素校色：亮度 ${pixelResult.color.luminanceDelta >= 0 ? "+" : ""}${pixelResult.color.luminanceDelta}，色度 U ${pixelResult.color.chromaUDelta >= 0 ? "+" : ""}${pixelResult.color.chromaUDelta} / V ${pixelResult.color.chromaVDelta >= 0 ? "+" : ""}${pixelResult.color.chromaVDelta}，饱和系数 ${pixelResult.color.saturationFactor.toFixed(2)}，多尺度 ${pixelResult.color.lowRadius}px/${pixelResult.color.midRadius}px。`);
      logs.push(`[融合校色] 像素边缘融合：边缘半径 ${pixelResult.color.edgeRadius}px，已保护透明像素并输出 PNG 结果层。`);
    } catch (error) {
      logs.push(`[融合校色] 像素级处理未完成：${error.message || "未知错误"}。已回退为旧版普通融合结果。`);
      await selectLayerById(action, sourceLayerId);
      await duplicateActiveLayer(action, resultLayerName);
      resultLayer = getActiveLayer(app);
      resultLayerId = getLayerId(resultLayer);
    }
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

    if (!pixelPipelineUsed && alignment.applied) {
      await transformLayerAlignment(action, resultLayerId, alignment);
      await selectLayerById(action, resultLayerId);
      logs.push("[融合校色] 已向 Photoshop 提交对齐变换。");
    }

    if (pixelPipelineUsed) {
      logs.push(`[融合校色] 已使用插件内像素级校色/对齐结果；Photoshop 阶段不再叠加亮度、色彩平衡或饱和度调整命令。`);
    } else {
      logs.push(`[融合校色] 明度 ${corrections.brightness >= 0 ? "+" : ""}${corrections.brightness} / 对比 ${corrections.contrast >= 0 ? "+" : ""}${corrections.contrast} / 饱和 ${corrections.saturation >= 0 ? "+" : ""}${corrections.saturation}。`);
      logs.push(`[融合校色] 色偏校正：R ${corrections.colorBalance.cyanRed >= 0 ? "+" : ""}${corrections.colorBalance.cyanRed} / G ${corrections.colorBalance.magentaGreen >= 0 ? "+" : ""}${corrections.colorBalance.magentaGreen} / B ${corrections.colorBalance.yellowBlue >= 0 ? "+" : ""}${corrections.colorBalance.yellowBlue}。`);
      await applyBrightnessContrast(action, corrections.brightness, corrections.contrast);
      await applyColorBalance(action, corrections.colorBalance);
      await applyHueSaturation(action, corrections.saturation);
      logs.push(`[融合校色] 已应用旧版基础明度、对比、色偏和饱和度匹配，总强度 ${config.totalStrength}% 已写入校正量。`);
    }

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
      pixelPipeline: {
        used: pixelPipelineUsed,
        width: pixelResult ? pixelResult.width : 0,
        height: pixelResult ? pixelResult.height : 0,
        color: pixelResult ? pixelResult.color : null,
        alignment: pixelResult ? pixelResult.alignment : null
      },
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
