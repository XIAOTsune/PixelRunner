import { activateDocument, getDocumentInfo, normalizeBounds } from "./document.js";
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
  pixelPipelineEnabled: true,
  alignmentEnabled: true,
  alignmentMaxOffset: 120,
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

const BLEND_MATCH_PREVIEW_CACHE_TTL_MS = 120000;
const BLEND_MATCH_PREVIEW_CACHE_LIMIT = 3;
const BLEND_MATCH_PLAN_VERSION = 1;
const BLEND_MATCH_COLOR_PLAN_VERSION = 1;
const blendMatchPreviewCache = new Map();

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getNowMs() {
  return typeof performance !== "undefined" && performance && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function formatMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${Math.round(parsed)}ms` : "0ms";
}

function createTimingRecorder() {
  const startedAt = getNowMs();
  let lastMark = startedAt;
  const entries = [];
  return {
    mark(label, details = null) {
      const now = getNowMs();
      const entry = {
        label: String(label || ""),
        ms: Number((now - lastMark).toFixed(1)),
        totalMs: Number((now - startedAt).toFixed(1))
      };
      if (details && typeof details === "object") entry.details = details;
      entries.push(entry);
      lastMark = now;
      return entry;
    },
    totalMs() {
      return Number((getNowMs() - startedAt).toFixed(1));
    },
    entries() {
      return entries.slice();
    },
    logTo(logs, prefix = "[融合校色] 耗时") {
      if (!Array.isArray(logs) || !entries.length) return;
      const segments = entries.map((entry) => `${entry.label} ${formatMs(entry.ms)}`);
      logs.push(`${prefix}：${segments.join(" / ")} / 总计 ${formatMs(this.totalMs())}。`);
    }
  };
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

function isUnsupportedBitsPerChannel(docInfo) {
  const bits = String(docInfo && (docInfo.bitsPerChannel || docInfo.bitsPerChannelLabel) || "").trim().toUpperCase();
  return bits === "THIRTYTWO" || bits === "32 位" || bits === "32BIT" || bits === "32-BIT" || bits === "32" || bits === "ONE" || bits === "1 位" || bits === "1";
}

function buildUnsupportedBitsError(docInfo) {
  const bitsLabel = String(docInfo && docInfo.bitsPerChannelLabel) || "当前位深";
  return new Error(`融合校色支持 8 位和 16 位 RGB 文档，当前文档为 ${bitsLabel}，请切换到 8 位或 16 位后再使用。`);
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
    pixelPipelineEnabled: payload.pixelPipelineEnabled !== false && payload.pixelCorrectionEnabled !== false,
    alignmentEnabled: payload.alignmentEnabled !== false,
    alignmentMaxOffset: clampNumber(payload.alignmentMaxOffset, 1, 320, DEFAULT_BLEND_MATCH_CONFIG.alignmentMaxOffset),
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

function getBlendMatchAnalysisConfigKey(config) {
  const source = config && typeof config === "object" ? config : {};
  return [
    source.mode,
    Math.round(Number(source.totalStrength) || 0),
    Math.round(Number(source.luminanceStrength) || 0),
    Math.round(Number(source.colorStrength) || 0),
    Math.round(Number(source.saturationStrength) || 0),
    Math.round(Number(source.contrastStrength) || 0),
    Math.round(Number(source.featherRadius) || 0),
    source.alignmentEnabled !== false ? 1 : 0,
    Math.round(Number(source.alignmentMaxOffset) || 0),
    source.alignmentScaleEnabled !== false ? 1 : 0,
    Number(source.alignmentMaxScale || 0).toFixed(2),
    Number(source.alignmentMaxRotation || 0).toFixed(2),
    Number(source.alignmentMaxStretch || 0).toFixed(2),
    source.localAlignmentEnabled !== false ? 1 : 0,
    Number(source.localMeshStrength || 0).toFixed(3),
    Number(source.localMeshMaxOffset || 0).toFixed(2),
    Math.round(Number(source.previewMaxEdge) || 0)
  ].join("|");
}

function buildBoundsCacheKey(bounds) {
  return [
    Math.round(Number(bounds && bounds.left) || 0),
    Math.round(Number(bounds && bounds.top) || 0),
    Math.round(Number(bounds && bounds.right) || 0),
    Math.round(Number(bounds && bounds.bottom) || 0)
  ].join(",");
}

function buildBlendMatchPreviewCacheKey(documentId, layerId, bounds, config) {
  return [
    Number(documentId) || 0,
    Number(layerId) || 0,
    buildBoundsCacheKey(bounds),
    getBlendMatchAnalysisConfigKey(config)
  ].join("::");
}

function cloneAlignmentResult(alignment) {
  return alignment && typeof alignment === "object" ? JSON.parse(JSON.stringify(alignment)) : alignment;
}

function cloneSampleForPreviewCache(sample, includeEncoded = false) {
  if (!sample || !sample.data) return null;
  return {
    width: sample.width,
    height: sample.height,
    scaleX: sample.scaleX,
    scaleY: sample.scaleY,
    data: sample.data instanceof Uint8Array ? new Uint8Array(sample.data) : sample.data,
    sourceComponents: sample.sourceComponents,
    sourcePixelFormat: sample.sourcePixelFormat,
    stats: sample.stats,
    base64: includeEncoded ? sample.base64 : "",
    mimeType: includeEncoded ? sample.mimeType : "",
    dataUrl: includeEncoded ? sample.dataUrl : ""
  };
}

function pruneBlendMatchPreviewCache(now = getNowMs()) {
  for (const [key, entry] of blendMatchPreviewCache.entries()) {
    if (!entry || now - Number(entry.createdAt || 0) > BLEND_MATCH_PREVIEW_CACHE_TTL_MS) {
      blendMatchPreviewCache.delete(key);
    }
  }
  while (blendMatchPreviewCache.size > BLEND_MATCH_PREVIEW_CACHE_LIMIT) {
    const oldestKey = blendMatchPreviewCache.keys().next().value;
    if (!oldestKey) break;
    blendMatchPreviewCache.delete(oldestKey);
  }
}

function storeBlendMatchPreviewCache(key, entry) {
  if (!key || !entry) return;
  pruneBlendMatchPreviewCache();
  blendMatchPreviewCache.set(key, {
    ...entry,
    createdAt: getNowMs()
  });
  pruneBlendMatchPreviewCache();
}

function getBlendMatchPreviewCache(key) {
  if (!key) return null;
  pruneBlendMatchPreviewCache();
  const entry = blendMatchPreviewCache.get(key);
  if (!entry) return null;
  entry.lastUsedAt = getNowMs();
  return {
    ...entry,
    sourceSample: cloneSampleForPreviewCache(entry.sourceSample),
    referenceSample: cloneSampleForPreviewCache(entry.referenceSample),
    alignment: cloneAlignmentResult(entry.alignment),
    plan: cloneJsonValue(entry.plan),
    planId: entry.planId || (entry.plan && entry.plan.planId) || ""
  };
}

function findBlendMatchPreviewCacheByPlanId(planId) {
  const requestedPlanId = String(planId || "");
  if (!requestedPlanId) return null;
  pruneBlendMatchPreviewCache();
  for (const [key, entry] of blendMatchPreviewCache.entries()) {
    if (!entry) continue;
    const entryPlanId = String(entry.planId || (entry.plan && entry.plan.planId) || "");
    if (entryPlanId !== requestedPlanId) continue;
    entry.lastUsedAt = getNowMs();
    return {
      key,
      ...entry,
      sourceSample: cloneSampleForPreviewCache(entry.sourceSample),
      referenceSample: cloneSampleForPreviewCache(entry.referenceSample),
      alignment: cloneAlignmentResult(entry.alignment),
      plan: cloneJsonValue(entry.plan),
      planId: entryPlanId
    };
  }
  return null;
}

function validateBlendMatchPlanForRequest(plan, request) {
  if (!plan || typeof plan !== "object") return { ok: false, reason: "missing-plan" };
  if (Number(plan.version) !== BLEND_MATCH_PLAN_VERSION) return { ok: false, reason: "version-mismatch" };
  const documentId = Number(request && request.documentId) || 0;
  const layerId = Number(request && request.layerId) || 0;
  if (Number(plan.documentId) !== documentId) return { ok: false, reason: "document-mismatch" };
  if (Number(plan.layerId) !== layerId) return { ok: false, reason: "layer-mismatch" };
  if (buildBoundsCacheKey(plan.bounds) !== buildBoundsCacheKey(request && request.bounds)) {
    return { ok: false, reason: "bounds-mismatch" };
  }
  const expectedConfigHash = getBlendMatchAnalysisConfigKey(request && request.config);
  if (String(plan.configHash || "") !== expectedConfigHash) {
    return { ok: false, reason: "config-mismatch" };
  }
  const expectedPreviewCacheKey = String(request && request.previewCacheKey || "");
  if (expectedPreviewCacheKey && String(plan.previewCacheKey || "") !== expectedPreviewCacheKey) {
    return { ok: false, reason: "preview-cache-key-mismatch" };
  }
  const sourceSample = request && request.sourceSample;
  const referenceSample = request && request.referenceSample;
  if (sourceSample && referenceSample) {
    const expectedSampleHash = buildBlendMatchSampleHash(sourceSample, referenceSample);
    if (String(plan.sampleHash || "") !== expectedSampleHash) {
      return { ok: false, reason: "sample-mismatch" };
    }
  }
  if (!plan.alignment || plan.alignment.backend !== "cpu") {
    return { ok: false, reason: "non-cpu-plan" };
  }
  return { ok: true, reason: "valid" };
}

function resolveBlendMatchCachedPlan({ planId, previewCacheKey, expectedPreviewCacheKey, documentId, layerId, bounds, config }) {
  const requestedPlanId = String(planId || "");
  const requestedPreviewCacheKey = String(previewCacheKey || "");
  let entry = requestedPlanId ? findBlendMatchPreviewCacheByPlanId(requestedPlanId) : null;
  let lookup = requestedPlanId ? "planId" : "";
  if (!entry && requestedPreviewCacheKey) {
    entry = getBlendMatchPreviewCache(requestedPreviewCacheKey);
    lookup = "previewCacheKey";
  }
  if (!entry) {
    return {
      entry: null,
      plan: null,
      validation: { ok: false, reason: requestedPlanId || requestedPreviewCacheKey ? "cache-miss" : "not-requested" },
      lookup
    };
  }
  if (!entry.plan) {
    return {
      entry,
      plan: null,
      validation: { ok: false, reason: entry.sourceSample && entry.referenceSample ? "plan-missing-sample-cache-hit" : "plan-missing" },
      lookup
    };
  }
  if (expectedPreviewCacheKey && entry.key && String(entry.key) !== String(expectedPreviewCacheKey)) {
    return {
      entry,
      plan: entry.plan,
      validation: { ok: false, reason: "preview-cache-key-mismatch" },
      lookup
    };
  }
  const validation = validateBlendMatchPlanForRequest(entry.plan, {
    documentId,
    layerId,
    bounds,
    config,
    previewCacheKey: expectedPreviewCacheKey,
    sourceSample: entry.sourceSample,
    referenceSample: entry.referenceSample
  });
  return {
    entry,
    plan: entry.plan,
    validation,
    lookup
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

function arrayBufferToBase64(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
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
  if (!bytes || !bytes.length) return null;
  if (typeof CompressionStream === "function") {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
      const buffer = await new Response(stream).arrayBuffer();
      return new Uint8Array(buffer);
    } catch (_) {}
  }
  return buildStoredZlibStream(bytes);
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    a = (a + bytes[index]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function buildStoredZlibStream(bytes) {
  if (!bytes || !bytes.length) return null;
  const blockSize = 0xffff;
  const blockCount = Math.ceil(bytes.length / blockSize);
  const out = new Uint8Array(2 + blockCount * 5 + bytes.length + 4);
  let offset = 0;
  out[offset++] = 0x78;
  out[offset++] = 0x01;
  for (let block = 0; block < blockCount; block += 1) {
    const start = block * blockSize;
    const chunk = bytes.subarray(start, Math.min(bytes.length, start + blockSize));
    const finalBlock = block === blockCount - 1;
    const len = chunk.length;
    const nlen = (~len) & 0xffff;
    out[offset++] = finalBlock ? 0x01 : 0x00;
    out[offset++] = len & 0xff;
    out[offset++] = (len >>> 8) & 0xff;
    out[offset++] = nlen & 0xff;
    out[offset++] = (nlen >>> 8) & 0xff;
    out.set(chunk, offset);
    offset += len;
  }
  const checksum = adler32(bytes);
  out[offset++] = (checksum >>> 24) & 0xff;
  out[offset++] = (checksum >>> 16) & 0xff;
  out[offset++] = (checksum >>> 8) & 0xff;
  out[offset++] = checksum & 0xff;
  return out;
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

function isFullDocumentBounds(bounds, docInfo, tolerance = 1) {
  if (!bounds || !docInfo) return false;
  const width = Math.max(1, Number(docInfo.width) || 1);
  const height = Math.max(1, Number(docInfo.height) || 1);
  return (
    Math.abs(Number(bounds.left) || 0) <= tolerance &&
    Math.abs(Number(bounds.top) || 0) <= tolerance &&
    Math.abs((Number(bounds.right) || 0) - width) <= tolerance &&
    Math.abs((Number(bounds.bottom) || 0) - height) <= tolerance
  );
}

function getDocumentPixelSize(doc) {
  return {
    width: Math.max(1, Number(doc && doc.width && (doc.width._value ?? doc.width.value ?? doc.width)) || 1),
    height: Math.max(1, Number(doc && doc.height && (doc.height._value ?? doc.height.value ?? doc.height)) || 1)
  };
}

function getDocumentResolutionValue(doc) {
  const raw = doc && doc.resolution;
  const parsed = Number(raw && (raw._value ?? raw.value ?? raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 72;
}

async function createTransparentTempDocument(app, action, name, size, resolution) {
  const width = Math.max(1, Math.floor(Number(size && size.width) || 1));
  const height = Math.max(1, Math.floor(Number(size && size.height) || 1));
  const safeResolution = Math.max(1, Number(resolution) || 72);
  if (app && app.documents && typeof app.documents.add === "function") {
    try {
      const doc = await app.documents.add({
        width,
        height,
        resolution: safeResolution,
        name,
        mode: "RGBColorMode",
        fill: "transparent"
      });
      if (doc) return doc;
    } catch (_) {}
  }
  await action.batchPlay([{
    _obj: "make",
    new: { _class: "document" },
    using: {
      _obj: "document",
      name,
      mode: { _class: "RGBColorMode" },
      width: { _unit: "pixelsUnit", _value: width },
      height: { _unit: "pixelsUnit", _value: height },
      resolution: { _unit: "densityUnit", _value: safeResolution },
      pixelScaleFactor: 1,
      fill: { _enum: "fill", _value: "transparent" }
    },
    _options: { dialogOptions: "dontDisplay" }
  }], {});
  const doc = app && app.activeDocument ? app.activeDocument : null;
  if (!doc) throw new Error("无法创建融合校色临时文档。");
  return doc;
}

async function closeDocumentWithoutSaving(action, docRef) {
  if (!docRef) return;
  if (typeof docRef.closeWithoutSaving === "function") {
    await docRef.closeWithoutSaving();
    return;
  }
  await action.batchPlay([{
    _obj: "close",
    _target: [{ _ref: "document", _id: Number(docRef.id) }],
    saving: { _enum: "yesNo", _value: "no" },
    _options: { dialogOptions: "dontDisplay" }
  }], {});
}

async function duplicateDocumentForIsolation(app, action, docRef, name) {
  if (!docRef) throw new Error("原 Photoshop 文档不可用，无法创建隔离采样临时文档。");
  if (typeof docRef.duplicate === "function") {
    const duplicated = await docRef.duplicate(name, false);
    if (duplicated) return duplicated;
  }
  await activateDocument(app, action, Number(docRef.id));
  await action.batchPlay([{
    _obj: "duplicate",
    _target: [{ _ref: "document", _id: Number(docRef.id) }],
    name,
    merged: false,
    _options: { dialogOptions: "dontDisplay" }
  }], {});
  const duplicated = app && app.activeDocument ? app.activeDocument : null;
  if (!duplicated) throw new Error("Photoshop 未返回隔离采样临时文档。");
  return duplicated;
}

function listChildLayers(layerOrDocument) {
  const layers = layerOrDocument && layerOrDocument.layers;
  if (!layers) return [];
  if (Array.isArray(layers)) return layers;
  if (typeof layers.length === "number") return Array.from(layers);
  if (typeof layers.forEach === "function") {
    const out = [];
    layers.forEach((item) => out.push(item));
    return out;
  }
  return [];
}

function branchContainsLayerId(layer, targetLayerId) {
  if (!layer) return false;
  if (Number(layer.id) === Number(targetLayerId)) return true;
  return listChildLayers(layer).some((child) => branchContainsLayerId(child, targetLayerId));
}

async function setOnlyLayerVisibleInDocument(action, docRef, targetLayerId) {
  const targetId = Number(targetLayerId) || 0;
  if (!(targetId > 0)) throw new Error("隔离采样缺少临时 source 图层 ID。");
  const visit = async (layer) => {
    const layerId = Number(layer && layer.id) || 0;
    if (!(layerId > 0)) return;
    const containsTarget = branchContainsLayerId(layer, targetId);
    await setLayerVisible(action, layerId, containsTarget);
    const children = listChildLayers(layer);
    for (const child of children) {
      if (containsTarget) {
        await visit(child);
      } else {
        const childId = Number(child && child.id) || 0;
        if (childId > 0) await setLayerVisible(action, childId, false);
      }
    }
  };
  const roots = listChildLayers(docRef);
  if (!roots.length) throw new Error("隔离采样临时文档没有可枚举图层。");
  for (const layer of roots) {
    await visit(layer);
  }
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
  if (typeof imageData.getData === "function") {
    try {
      const data = await imageData.getData({ chunky: true, fullRange: true });
      if (data) return data;
    } catch (_) {}
    try {
      const data = await imageData.getData({ chunky: true });
      if (data) return data;
    } catch (_) {}
    try {
      const data = await imageData.getData();
      if (data) return data;
    } catch (_) {}
  }
  if (imageData.data) return imageData.data;
  return null;
}

function getImageDataLength(data) {
  if (!data) return 0;
  if (typeof data.length === "number") return data.length;
  if (typeof data.byteLength === "number") return data.byteLength;
  return 0;
}

function getImageDataComponentSize(imageData, data) {
  const candidates = [
    imageData && imageData.componentSize,
    imageData && imageData.bitsPerComponent,
    imageData && imageData.bitsPerChannel,
    imageData && imageData.depth
  ];
  for (const value of candidates) {
    const parsed = Number(value && (value._value ?? value.value ?? value));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (data instanceof Uint16Array || data instanceof Int16Array) return 16;
  if (data instanceof Float32Array || data instanceof Float64Array) return 32;
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray || data instanceof Int8Array) return 8;
  return 8;
}

function getImageDataComponents(imageData, data, pixelCount) {
  const declared = Number(imageData && imageData.components);
  if (Number.isFinite(declared) && declared > 0) return Math.max(1, Math.floor(declared));
  const length = getImageDataLength(data);
  if (!length || !pixelCount) return 4;
  const componentSize = getImageDataComponentSize(imageData, data);
  if (data instanceof ArrayBuffer) {
    return Math.max(1, Math.floor(length / Math.max(1, Math.ceil(componentSize / 8)) / Math.max(1, pixelCount)));
  }
  return Math.max(1, Math.floor(length / Math.max(1, pixelCount)));
}

function getImageDataValueReader(imageData, data) {
  if (!data) return () => 0;
  const componentSize = getImageDataComponentSize(imageData, data);
  const maxValue = componentSize > 8 ? Math.pow(2, Math.min(16, componentSize)) - 1 : 255;
  let source = data;
  if (data instanceof ArrayBuffer) {
    source = componentSize > 8 ? new Uint16Array(data) : new Uint8Array(data);
  }
  if (source instanceof Float32Array || source instanceof Float64Array) {
    return (index) => {
      const value = Number(source[index]) || 0;
      return Math.max(0, Math.min(255, Math.round((value <= 1 ? value * 255 : value))));
    };
  }
  if (componentSize > 8 || source instanceof Uint16Array || source instanceof Int16Array) {
    return (index) => {
      const value = Number(source[index]) || 0;
      return Math.max(0, Math.min(255, Math.round(value * 255 / maxValue)));
    };
  }
  return (index) => Math.max(0, Math.min(255, Number(source[index]) || 0));
}

function normalizeImageDataToRgba(imageData, data, width, height) {
  const safeWidth = Math.max(1, Number(width) || Number(imageData && imageData.width) || 1);
  const safeHeight = Math.max(1, Number(height) || Number(imageData && imageData.height) || 1);
  const pixelCount = safeWidth * safeHeight;
  const components = getImageDataComponents(imageData, data, pixelCount);
  const pixelFormat = String((imageData && imageData.pixelFormat) || (components === 4 ? "RGBA" : components === 3 ? "RGB" : components === 2 ? "GrayscaleAlpha" : "Grayscale"));
  const out = new Uint8Array(pixelCount * 4);
  if (!data || getImageDataLength(data) < pixelCount * components) return out;
  const readValue = getImageDataValueReader(imageData, data);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const sourceIndex = pixel * components;
    const targetIndex = pixel * 4;
    if (pixelFormat === "RGBA" || components >= 4) {
      out[targetIndex] = readValue(sourceIndex);
      out[targetIndex + 1] = readValue(sourceIndex + 1);
      out[targetIndex + 2] = readValue(sourceIndex + 2);
      out[targetIndex + 3] = readValue(sourceIndex + 3);
    } else if (pixelFormat === "RGB" || components === 3) {
      out[targetIndex] = readValue(sourceIndex);
      out[targetIndex + 1] = readValue(sourceIndex + 1);
      out[targetIndex + 2] = readValue(sourceIndex + 2);
      out[targetIndex + 3] = 255;
    } else if (pixelFormat === "GrayscaleAlpha" || components === 2) {
      const gray = readValue(sourceIndex);
      out[targetIndex] = gray;
      out[targetIndex + 1] = gray;
      out[targetIndex + 2] = gray;
      out[targetIndex + 3] = readValue(sourceIndex + 1);
    } else {
      const gray = readValue(sourceIndex);
      out[targetIndex] = gray;
      out[targetIndex + 1] = gray;
      out[targetIndex + 2] = gray;
      out[targetIndex + 3] = 255;
    }
  }
  return out;
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
      applyAlpha: false
    });
    const data = await getImageDataBytes(pixels && pixels.imageData);
    if (!data || data.length < 4) throw new Error("Photoshop 未返回可读取的像素数据。");
    const rgba = normalizeImageDataToRgba(pixels && pixels.imageData, data, targetSize.width, targetSize.height);
    return buildStatsFromRgba(rgba);
  } finally {
    try {
      pixels && pixels.imageData && typeof pixels.imageData.dispose === "function" && pixels.imageData.dispose();
    } catch (_) {}
  }
}

async function captureCompositeSample(imaging, doc, bounds, maxEdge = 512, encode = false, allowEmptyStats = false) {
  const targetSize = getSamplingTargetSize(bounds, maxEdge);
  let pixels = null;
  try {
    pixels = await getPixelsWithFallback(imaging, {
      documentID: Number(doc.id),
      sourceBounds: bounds,
      targetSize,
      componentSize: 8,
      applyAlpha: false
    });
    const data = await getImageDataBytes(pixels && pixels.imageData);
    if (!data || data.length < 4) throw new Error("Photoshop 未返回可读取的像素数据。");
    const copy = normalizeImageDataToRgba(pixels && pixels.imageData, data, targetSize.width, targetSize.height);
    let base64 = "";
    let mimeType = "image/jpeg";
    if (encode && typeof imaging.encodeImageData === "function") {
      try {
        const encoded = await imaging.encodeImageData({
          imageData: pixels.imageData,
          base64: true,
          format: "jpeg",
          quality: 78
        });
        base64 = extractEncodedBase64(encoded);
      } catch (_) {
        base64 = "";
      }
    }
    let stats = null;
    try {
      stats = buildStatsFromRgba(copy);
    } catch (error) {
      if (!allowEmptyStats) throw error;
      stats = {
        count: 0,
        meanR: 0,
        meanG: 0,
        meanB: 0,
        weightedMeanR: 0,
        weightedMeanG: 0,
        weightedMeanB: 0,
        weightedMeanLuma: 0,
        weightedMeanSat: 0,
        meanLuma: 0,
        stdLuma: 0,
        meanSat: 0,
        detailEnergy: 0,
        statsError: error.message || "empty-stats"
      };
    }
    if (encode && !base64) {
      const pngBuffer = await encodeRgbaPng(targetSize.width, targetSize.height, copy);
      base64 = arrayBufferToBase64(pngBuffer);
      mimeType = "image/png";
    }
    return {
      width: targetSize.width,
      height: targetSize.height,
      scaleX: (Math.max(1, Number(bounds.right) - Number(bounds.left))) / Math.max(1, targetSize.width),
      scaleY: (Math.max(1, Number(bounds.bottom) - Number(bounds.top))) / Math.max(1, targetSize.height),
      data: copy,
      sourceComponents: Number(pixels && pixels.imageData && pixels.imageData.components) || Math.floor(data.length / Math.max(1, targetSize.width * targetSize.height)) || 0,
      sourcePixelFormat: String((pixels && pixels.imageData && pixels.imageData.pixelFormat) || ""),
      stats,
      base64,
      mimeType,
      dataUrl: buildDataUrl(mimeType, base64)
    };
  } finally {
    try {
      pixels && pixels.imageData && typeof pixels.imageData.dispose === "function" && pixels.imageData.dispose();
    } catch (_) {}
  }
}

function normalizeSampleHashPart(sample) {
  return [
    Math.max(1, Math.round(Number(sample && sample.width) || 1)),
    Math.max(1, Math.round(Number(sample && sample.height) || 1)),
    Number(sample && sample.scaleX || 1).toFixed(6),
    Number(sample && sample.scaleY || 1).toFixed(6),
    Math.round(Number(sample && sample.stats && sample.stats.count) || 0),
    Number(sample && sample.stats && sample.stats.weightedMeanLuma || sample && sample.stats && sample.stats.meanLuma || 0).toFixed(3),
    Number(sample && sample.stats && sample.stats.weightedMeanSat || sample && sample.stats && sample.stats.meanSat || 0).toFixed(5),
    Number(sample && sample.stats && sample.stats.detailEnergy || 0).toFixed(5)
  ].join(":");
}

function buildBlendMatchSampleHash(sourceSample, referenceSample) {
  return `${normalizeSampleHashPart(sourceSample)}::${normalizeSampleHashPart(referenceSample)}`;
}

function createBlendMatchPlanId(documentId, layerId, previewCacheKey, sampleHash) {
  const seed = [
    Number(documentId) || 0,
    Number(layerId) || 0,
    String(previewCacheKey || ""),
    String(sampleHash || ""),
    Date.now().toString(36),
    Math.floor(Math.random() * 0xffffff).toString(36)
  ].join(":");
  return `bmp-${seed.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

function cloneJsonValue(value) {
  return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
}

function readFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readOptionalNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableJsonValue(item));
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((out, key) => {
        const current = value[key];
        if (typeof current !== "undefined" && typeof current !== "function") {
          out[key] = stableJsonValue(current);
        }
        return out;
      }, {});
  }
  if (typeof value === "number") return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
  return value;
}

function buildStableJsonHash(value) {
  return JSON.stringify(stableJsonValue(value));
}

function buildBlendMatchAlignmentHash(alignment) {
  const local = alignment && alignment.local ? alignment.local : null;
  return buildStableJsonHash({
    backend: alignment && alignment.backend || "cpu",
    applied: Boolean(alignment && alignment.applied),
    dx: Number(alignment && alignment.dx) || 0,
    dy: Number(alignment && alignment.dy) || 0,
    sampleDx: Number(alignment && alignment.sampleDx) || 0,
    sampleDy: Number(alignment && alignment.sampleDy) || 0,
    sampleScaleX: Number(alignment && alignment.sampleScaleX) || 1,
    sampleScaleY: Number(alignment && alignment.sampleScaleY) || 1,
    sampleRotation: Number(alignment && alignment.sampleRotation) || 0,
    localApplied: Boolean(alignment && alignment.localDeformation),
    localValidTiles: Number(local && local.validTiles) || 0,
    localTotalTiles: Number(local && local.totalTiles) || 0,
    localMaxDistance: Number(local && local.maxDistance) || 0,
    localStrength: Number(local && local.strength) || 0,
    localTiles: Array.isArray(local && local.tiles)
      ? local.tiles.map((tile) => ({
          row: Number(tile && tile.row) || 0,
          col: Number(tile && tile.col) || 0,
          dx: Number(tile && tile.dx) || 0,
          dy: Number(tile && tile.dy) || 0
        }))
      : []
  });
}

function summarizeColorProfile(profile) {
  if (!profile) return null;
  return {
    method: profile.significantMismatch ? "enhanced-tone-chroma-profile" : "protected-tone-chroma-profile",
    significantMismatch: Boolean(profile.significantMismatch),
    subjectWeight: Math.round(Number(profile.subjectWeight || profile.weight) || 0),
    midDelta: Number((Number(profile.midDelta) || 0).toFixed(3)),
    shadowDelta: Number((Number(profile.shadowDelta) || 0).toFixed(3)),
    highlightDelta: Number((Number(profile.highlightDelta) || 0).toFixed(3)),
    uDelta: Number((Number(profile.uDelta) || 0).toFixed(3)),
    vDelta: Number((Number(profile.vDelta) || 0).toFixed(3)),
    neutralUDelta: Number((Number(profile.neutralUDelta) || 0).toFixed(3)),
    neutralVDelta: Number((Number(profile.neutralVDelta) || 0).toFixed(3)),
    chromaScale: Number((Number(profile.chromaScale) || 1).toFixed(4)),
    saturationFactor: Number((Number(profile.saturationFactor) || 1).toFixed(4)),
    toneCurveStrength: Number(summarizeToneCurveStrength(profile.toneCurve).toFixed(3))
  };
}

function buildColorPlanValidation({ configHash, sampleHash, alignmentHash, colorProfile, corrections }) {
  const hasCorrections = Boolean(corrections);
  const hasProfile = Boolean(colorProfile);
  return {
    ok: hasProfile || hasCorrections,
    reason: hasProfile ? "valid" : hasCorrections ? "valid-legacy-corrections" : "missing-color-data",
    configHash: String(configHash || ""),
    sampleHash: String(sampleHash || ""),
    alignmentHash: String(alignmentHash || "")
  };
}

function buildBlendMatchColorPlan({ corrections, colorProfile, configHash, sampleHash, alignmentHash }) {
  const method = colorProfile ? "internal-color-profile" : "legacy-corrections";
  const summary = summarizeColorProfile(colorProfile);
  return {
    version: BLEND_MATCH_COLOR_PLAN_VERSION,
    backend: "cpu",
    method,
    executable: true,
    previewRenderable: false,
    previewFallback: "simplified-corrections",
    corrections: cloneJsonValue(corrections),
    profile: cloneJsonValue(colorProfile),
    summary,
    hashes: {
      configHash: String(configHash || ""),
      sampleHash: String(sampleHash || ""),
      alignmentHash: String(alignmentHash || "")
    },
    validation: buildColorPlanValidation({ configHash, sampleHash, alignmentHash, colorProfile, corrections })
  };
}

function summarizeColorPlan(colorPlan) {
  if (!colorPlan || typeof colorPlan !== "object") return null;
  return {
    version: Number(colorPlan.version) || 0,
    backend: String(colorPlan.backend || ""),
    method: String(colorPlan.method || ""),
    executable: colorPlan.executable !== false,
    previewRenderable: colorPlan.previewRenderable === true,
    previewFallback: String(colorPlan.previewFallback || ""),
    profile: cloneJsonValue(colorPlan.summary || summarizeColorProfile(colorPlan.profile)),
    corrections: cloneJsonValue(colorPlan.corrections)
  };
}

function validateBlendMatchColorPlan(colorPlan, request) {
  if (!colorPlan || typeof colorPlan !== "object") return { ok: false, reason: "missing-color-plan" };
  if (Number(colorPlan.version) !== BLEND_MATCH_COLOR_PLAN_VERSION) return { ok: false, reason: "color-version-mismatch" };
  if (String(colorPlan.backend || "") !== "cpu") return { ok: false, reason: "color-backend-mismatch" };
  if (colorPlan.executable === false) return { ok: false, reason: "color-not-executable" };
  const hashes = colorPlan.hashes || {};
  const expectedConfigHash = String(request && request.configHash || "");
  const expectedSampleHash = String(request && request.sampleHash || "");
  const expectedAlignmentHash = String(request && request.alignmentHash || "");
  if (String(hashes.configHash || "") !== expectedConfigHash) return { ok: false, reason: "color-config-mismatch" };
  if (String(hashes.sampleHash || "") !== expectedSampleHash) return { ok: false, reason: "color-sample-mismatch" };
  if (String(hashes.alignmentHash || "") !== expectedAlignmentHash) return { ok: false, reason: "color-alignment-mismatch" };
  if (colorPlan.method === "internal-color-profile" && !colorPlan.profile) return { ok: false, reason: "color-profile-missing" };
  if (!colorPlan.corrections) return { ok: false, reason: "color-corrections-missing" };
  return { ok: true, reason: "valid" };
}

function getPlanColorPlan(plan) {
  return plan && plan.color ? cloneJsonValue(plan.color) : null;
}

function buildBlendMatchPlan({
  documentId,
  layerId,
  layerName,
  bounds,
  config,
  previewCacheKey,
  sourceSample,
  referenceSample,
  alignment,
  corrections,
  colorProfile = null,
  timings = null,
  warnings = []
}) {
  const sampleHash = buildBlendMatchSampleHash(sourceSample, referenceSample);
  const configHash = getBlendMatchAnalysisConfigKey(config);
  const alignmentHash = buildBlendMatchAlignmentHash(alignment);
  const colorPlan = buildBlendMatchColorPlan({
    corrections,
    colorProfile,
    configHash,
    sampleHash,
    alignmentHash
  });
  colorPlan.stats = {
    source: cloneJsonValue(sourceSample && sourceSample.stats),
    reference: cloneJsonValue(referenceSample && referenceSample.stats)
  };
  const planId = createBlendMatchPlanId(documentId, layerId, previewCacheKey, sampleHash);
  return {
    planId,
    version: BLEND_MATCH_PLAN_VERSION,
    documentId: Number(documentId) || 0,
    layerId: Number(layerId) || 0,
    layerName: String(layerName || ""),
    bounds: bounds ? { ...bounds } : null,
    config: cloneJsonValue(config),
    configHash,
    previewCacheKey: String(previewCacheKey || ""),
    sampleHash,
    sampleSize: {
      width: Math.max(1, Number(sourceSample && sourceSample.width) || 1),
      height: Math.max(1, Number(sourceSample && sourceSample.height) || 1),
      scaleX: Number(sourceSample && sourceSample.scaleX) || 1,
      scaleY: Number(sourceSample && sourceSample.scaleY) || 1
    },
    alignment: {
      ...(cloneAlignmentResult(alignment) || { applied: false, dx: 0, dy: 0, confidence: 0, reason: "missing" }),
      backend: "cpu",
      trusted: true
    },
    color: colorPlan,
    preview: {
      sourceTextureKey: "",
      referenceTextureKey: "",
      renderMode: "existing-preview-pipeline"
    },
    timings: timings ? cloneJsonValue(timings) : null,
    warnings: Array.isArray(warnings) ? warnings.slice() : []
  };
}

function buildCpuBlendMatchPlanFromSamples(options) {
  const {
    config,
    sourceSample,
    referenceSample,
    alignmentConfig = config,
    existingAlignment = null,
    timing = null,
    logs = null,
    gpuAlignmentSeed = null,
    alignmentSeedCandidates = null,
    seedTrust = ""
  } = options || {};
  const corrections = buildCorrections(sourceSample.stats, referenceSample.stats, config);
  if (timing) timing.mark("plan 颜色统计");
  const effectiveAlignmentConfig = alignmentConfig && typeof alignmentConfig === "object"
    ? { ...alignmentConfig }
    : alignmentConfig;
  if (effectiveAlignmentConfig && typeof effectiveAlignmentConfig === "object" && seedTrust === "hint-only" && gpuAlignmentSeed) {
    effectiveAlignmentConfig.gpuAlignmentSeed = gpuAlignmentSeed;
    effectiveAlignmentConfig.alignmentSeedCandidates = Array.isArray(alignmentSeedCandidates) ? alignmentSeedCandidates.slice(0, 12) : [];
    effectiveAlignmentConfig.seedTrust = "hint-only";
  }
  const alignment = existingAlignment
    ? cloneAlignmentResult(existingAlignment)
    : config.alignmentEnabled
    ? estimateGradientAlignment(sourceSample, referenceSample, effectiveAlignmentConfig || config)
    : { applied: false, dx: 0, dy: 0, confidence: 0, reason: "disabled" };
  const gpuSeedDiagnostics = alignment && alignment.search && alignment.search.gpuSeed ? alignment.search.gpuSeed : null;
  if (timing) {
    timing.mark("plan CPU 对齐", {
      applied: Boolean(alignment && alignment.applied),
      confidence: Number((Number(alignment && alignment.confidence) || 0).toFixed(3)),
      reason: alignment && alignment.reason || "",
      localApplied: Boolean(alignment && alignment.localDeformation),
      localRejected: Boolean(alignment && alignment.local && alignment.local.rejected),
      gpuSeed: Boolean(gpuAlignmentSeed),
      seedAccepted: Boolean(gpuSeedDiagnostics && gpuSeedDiagnostics.accepted),
      fallbackFullCpu: Boolean(gpuSeedDiagnostics && gpuSeedDiagnostics.fallbackFullCpu)
    });
  }
  if (Array.isArray(logs) && seedTrust === "hint-only") {
    logs.push(`[融合校色] CPU hydrate gpuSeed=${gpuAlignmentSeed ? "true" : "false"}，seedCandidates=${gpuSeedDiagnostics && Number(gpuSeedDiagnostics.seedCandidates) || 0}，seedAccepted=${gpuSeedDiagnostics && gpuSeedDiagnostics.accepted ? "true" : "false"}，fallbackFullCpu=${gpuSeedDiagnostics && gpuSeedDiagnostics.fallbackFullCpu ? "true" : "false"}，seedRejectReason=${gpuSeedDiagnostics && gpuSeedDiagnostics.rejectReason || "none"}。`);
    if (gpuSeedDiagnostics) {
      const seedMs = Number(gpuSeedDiagnostics.seedValidationMs) || 0;
      const fullMs = Number(gpuSeedDiagnostics.fullCpuSearchMs) || 0;
      const bestSeed = gpuSeedDiagnostics.bestSeed || null;
      logs.push(`[融合校色] CPU hydrate seed search：accepted=${gpuSeedDiagnostics.accepted ? "true" : "false"}，seedValidationMs=${formatMs(seedMs)}，fullCpuSearchMs=${formatMs(fullMs)}，bestSeed=${bestSeed ? `${bestSeed.dx},${bestSeed.dy},${formatFixed(bestSeed.scale, 4)}` : "none"}，refinedScore=${formatFixed(gpuSeedDiagnostics.refinedScore, 4)}。`);
      if (gpuSeedDiagnostics.gpuValidation) {
        const evidence = gpuSeedDiagnostics.gpuValidation;
        logs.push(`[融合校色] GPU validation evidence：score=${formatFixed(evidence.score, 4)}，secondScore=${formatFixed(evidence.secondScore, 4)}，scoreGap=${formatFixed(evidence.scoreGap, 4)}，sampleCount=${evidence.sampleCount || 0}/${evidence.minSamples || 0}，directionAgreement=${evidence.directionAgreement === null ? "n/a" : formatFixed(evidence.directionAgreement, 4)}，edgeOverlap=${evidence.edgeOverlap === null ? "n/a" : formatFixed(evidence.edgeOverlap, 4)}，topK=${evidence.topK || 0}。`);
      }
      if (gpuSeedDiagnostics.cpuSpotCheck) {
        const spot = gpuSeedDiagnostics.cpuSpotCheck;
        logs.push(`[融合校色] CPU spot-check：score=${formatFixed(spot.score, 4)}，scoreGap=${formatFixed(spot.scoreGap, 4)}，refinedScore=${formatFixed(spot.refinedScore, 4)}，refinedGap=${formatFixed(spot.refinedGap, 4)}，dx=${spot.dx || 0}，dy=${spot.dy || 0}，scale=${formatFixed(spot.scale || 1, 4)}。`);
      }
      if (gpuSeedDiagnostics.parity) {
        const parity = gpuSeedDiagnostics.parity;
        logs.push(`[融合校色] GPU/CPU parity：scoreDelta=${parity.scoreDelta === null ? "n/a" : formatFixed(parity.scoreDelta, 4)}，scoreGapDelta=${parity.scoreGapDelta === null ? "n/a" : formatFixed(parity.scoreGapDelta, 4)}，dxDelta=${formatFixed(parity.dxDelta, 2)}，dyDelta=${formatFixed(parity.dyDelta, 2)}，scaleDelta=${formatFixed(parity.scaleDelta, 4)}，acceptParity=${parity.acceptParity ? "true" : "false"}，verdict=${parity.verdict || "parity-fallback"}。`);
      }
    }
  }
  const alignmentTimings = alignment && alignment.search && alignment.search.timings ? alignment.search.timings : null;
  const colorPlanStartedAt = getNowMs();
  const colorProfile = buildInternalColorProfile(sourceSample, referenceSample, config, alignment);
  const colorPlanMs = Number((getNowMs() - colorPlanStartedAt).toFixed(1));
  if (timing) {
    timing.mark("plan 颜色画像", colorProfile ? { weight: Math.round(colorProfile.subjectWeight || 0) } : null);
  }
  if (Array.isArray(logs) && alignmentTimings) {
    const hydrateAnalysisTotal = Number(alignmentTimings.totalMs || 0) + colorPlanMs;
    logs.push(`[融合校色] CPU alignment 分段：sobel=${formatMs(alignmentTimings.sobelMs)}，global=${formatMs(alignmentTimings.globalSearchMs)}，refine=${formatMs(alignmentTimings.refineMs)}，localMesh=${formatMs(alignmentTimings.localMeshMs)}，ColorPlan=${formatMs(colorPlanMs)}，total=${formatMs(hydrateAnalysisTotal)}。`);
  }
  return buildBlendMatchPlan({
    ...options,
    alignment,
    corrections,
    colorProfile,
    timings: timing && typeof timing.entries === "function" ? timing.entries() : null
  });
}

function getPlanAlignment(plan) {
  return plan && plan.alignment ? cloneAlignmentResult(plan.alignment) : null;
}

function getPlanCorrections(plan) {
  return plan && plan.color && plan.color.corrections ? cloneJsonValue(plan.color.corrections) : null;
}

function getPlanColorProfile(plan) {
  return plan && plan.color && plan.color.profile ? cloneJsonValue(plan.color.profile) : null;
}

function ensurePlanColorStats(plan, sourceSample, referenceSample) {
  if (!plan || !plan.color) return;
  plan.color.stats = {
    source: cloneJsonValue(sourceSample && sourceSample.stats),
    reference: cloneJsonValue(referenceSample && referenceSample.stats)
  };
}

function rebuildBlendMatchColorPlanForSamples({ plan, config, sourceSample, referenceSample, alignment, reason = "rebuild" }) {
  const corrections = buildCorrections(sourceSample && sourceSample.stats, referenceSample && referenceSample.stats, config);
  const colorProfile = buildInternalColorProfile(sourceSample, referenceSample, config, alignment);
  const sampleHash = buildBlendMatchSampleHash(sourceSample, referenceSample);
  const configHash = getBlendMatchAnalysisConfigKey(config);
  const alignmentHash = buildBlendMatchAlignmentHash(alignment);
  const colorPlan = buildBlendMatchColorPlan({
    corrections,
    colorProfile,
    configHash,
    sampleHash,
    alignmentHash
  });
  colorPlan.rebuilt = true;
  colorPlan.rebuildReason = String(reason || "rebuild");
  colorPlan.stats = {
    source: cloneJsonValue(sourceSample && sourceSample.stats),
    reference: cloneJsonValue(referenceSample && referenceSample.stats)
  };
  if (plan && typeof plan === "object") {
    plan.color = cloneJsonValue(colorPlan);
    plan.sampleHash = sampleHash;
    plan.configHash = configHash;
  }
  return colorPlan;
}

function resolveBlendMatchColorPlan({ plan, config, sourceSample, referenceSample, alignment, logs, timing, allowRebuild = true }) {
  const existingColorPlan = getPlanColorPlan(plan);
  const expected = {
    configHash: getBlendMatchAnalysisConfigKey(config),
    sampleHash: buildBlendMatchSampleHash(sourceSample, referenceSample),
    alignmentHash: buildBlendMatchAlignmentHash(alignment)
  };
  const validation = validateBlendMatchColorPlan(existingColorPlan, expected);
  if (validation.ok) {
    if (timing) {
      timing.mark("复用 ColorPlan", {
        method: existingColorPlan.method || "",
        previewFallback: existingColorPlan.previewFallback || "",
        weight: Math.round(Number(existingColorPlan.profile && existingColorPlan.profile.subjectWeight) || 0)
      });
    }
    if (Array.isArray(logs)) {
      logs.push(`[融合校色] ColorPlan 复用：method=${existingColorPlan.method || "unknown"}，profile=${existingColorPlan.profile ? "yes" : "no"}，preview=${existingColorPlan.previewRenderable ? "plan" : existingColorPlan.previewFallback || "fallback"}。`);
    }
    return {
      colorPlan: existingColorPlan,
      validation,
      reused: true,
      rebuilt: false,
      corrections: cloneJsonValue(existingColorPlan.corrections),
      colorProfile: cloneJsonValue(existingColorPlan.profile)
    };
  }
  if (Array.isArray(logs)) {
    logs.push(`[融合校色] ColorPlan 未复用：${validation.reason}；${allowRebuild ? "将重建颜色画像" : "使用 legacy corrections fallback"}。`);
  }
  if (!allowRebuild) {
    const corrections = getPlanCorrections(plan) || buildCorrections(sourceSample && sourceSample.stats, referenceSample && referenceSample.stats, config);
    return {
      colorPlan: null,
      validation,
      reused: false,
      rebuilt: false,
      corrections,
      colorProfile: null
    };
  }
  const rebuilt = rebuildBlendMatchColorPlanForSamples({
    plan,
    config,
    sourceSample,
    referenceSample,
    alignment,
    reason: validation.reason
  });
  if (timing) {
    timing.mark("重建 ColorPlan", {
      reason: validation.reason,
      method: rebuilt.method,
      weight: Math.round(Number(rebuilt.profile && rebuilt.profile.subjectWeight) || 0)
    });
  }
  if (Array.isArray(logs)) {
    logs.push(`[融合校色] ColorPlan 已重建：reason=${validation.reason}，method=${rebuilt.method}，profile=${rebuilt.profile ? "yes" : "no"}。`);
  }
  return {
    colorPlan: rebuilt,
    validation,
    reused: false,
    rebuilt: true,
    corrections: cloneJsonValue(rebuilt.corrections),
    colorProfile: cloneJsonValue(rebuilt.profile)
  };
}

async function captureCompositeRawSample(imaging, doc, bounds, maxEdge = 512) {
  const targetSize = getSamplingTargetSize(bounds, maxEdge);
  let pixels = null;
  try {
    pixels = await getPixelsWithFallback(imaging, {
      documentID: Number(doc.id),
      sourceBounds: bounds,
      targetSize,
      componentSize: 8,
      applyAlpha: false
    });
    const data = await getImageDataBytes(pixels && pixels.imageData);
    if (!data || data.length < 4) throw new Error("Photoshop 未返回可读取的像素数据。");
    const copy = normalizeImageDataToRgba(pixels && pixels.imageData, data, targetSize.width, targetSize.height);
    return {
      width: targetSize.width,
      height: targetSize.height,
      scaleX: (Math.max(1, Number(bounds.right) - Number(bounds.left))) / Math.max(1, targetSize.width),
      scaleY: (Math.max(1, Number(bounds.bottom) - Number(bounds.top))) / Math.max(1, targetSize.height),
      data: copy,
      sourceComponents: Number(pixels && pixels.imageData && pixels.imageData.components) || Math.floor(data.length / Math.max(1, targetSize.width * targetSize.height)) || 0,
      sourcePixelFormat: String((pixels && pixels.imageData && pixels.imageData.pixelFormat) || ""),
      stats: null,
      base64: "",
      mimeType: "",
      dataUrl: ""
    };
  } finally {
    try {
      pixels && pixels.imageData && typeof pixels.imageData.dispose === "function" && pixels.imageData.dispose();
    } catch (_) {}
  }
}

async function captureIsolatedLayerSample(imaging, app, action, originalDocument, sourceLayerId, bounds, maxEdge = 512) {
  const docSize = getDocumentPixelSize(originalDocument);
  const resolution = getDocumentResolutionValue(originalDocument);
  const originalDocumentId = Number(originalDocument && originalDocument.id) || 0;
  let tempDoc = null;
  try {
    tempDoc = await createTransparentTempDocument(
      app,
      action,
      "PixelRunner Blend Match Source Temp",
      docSize,
      resolution
    );
    await activateDocument(app, action, originalDocumentId);
    await selectLayerById(action, sourceLayerId);
    const sourceLayer = getActiveLayer(app);
    if (!sourceLayer || typeof sourceLayer.duplicate !== "function") {
      throw new Error("当前返图图层无法复制到临时文档。");
    }
    await sourceLayer.duplicate(tempDoc);
    await activateDocument(app, action, Number(tempDoc.id));
    return await captureCompositeSample(imaging, tempDoc, bounds, maxEdge, false);
  } finally {
    try {
      await activateDocument(app, action, originalDocumentId);
    } catch (_) {}
    if (tempDoc) {
      try {
        await closeDocumentWithoutSaving(action, tempDoc);
      } catch (_) {}
      try {
        await activateDocument(app, action, originalDocumentId);
      } catch (_) {}
    }
  }
}

async function captureIsolatedSourceSampleV2(imaging, app, action, originalDocument, sourceLayerId, bounds, maxEdge = 1536) {
  const originalDocumentId = Number(originalDocument && originalDocument.id) || 0;
  let tempDoc = null;
  try {
    await activateDocument(app, action, originalDocumentId);
    await selectLayerById(action, sourceLayerId);
    tempDoc = await duplicateDocumentForIsolation(app, action, originalDocument, "PixelRunner Pixel Align Source Isolation");
    await activateDocument(app, action, Number(tempDoc.id));
    const tempSourceLayer = getActiveLayer(app);
    const tempSourceLayerId = getLayerId(tempSourceLayer);
    if (!(tempSourceLayerId > 0)) {
      throw new Error("隔离文档未保留活动 source 图层。");
    }
    await setOnlyLayerVisibleInDocument(action, tempDoc, tempSourceLayerId);
    await selectLayerById(action, tempSourceLayerId);
    const sample = await captureCompositeSample(imaging, tempDoc, bounds, maxEdge, false, true);
    sample.captureMethod = "document-duplicate-hide-others";
    sample.tempLayerId = tempSourceLayerId;
    return sample;
  } finally {
    try {
      await activateDocument(app, action, originalDocumentId);
    } catch (_) {}
    if (tempDoc) {
      try {
        await closeDocumentWithoutSaving(action, tempDoc);
      } catch (_) {}
      try {
        await activateDocument(app, action, originalDocumentId);
      } catch (_) {}
    }
  }
}

async function captureReferenceSample(imaging, app, action, originalDocument, sourceLayerId, bounds, maxEdge, sourceWasVisible) {
  const originalDocumentId = Number(originalDocument && originalDocument.id) || 0;
  let restoredVisibility = false;
  try {
    await activateDocument(app, action, originalDocumentId);
    await selectLayerById(action, sourceLayerId);
    await setLayerVisible(action, sourceLayerId, false);
    const sample = await captureCompositeSample(imaging, originalDocument, bounds, maxEdge, false, true);
    sample.captureMethod = "original-document-source-hidden-composite";
    await setLayerVisible(action, sourceLayerId, sourceWasVisible);
    restoredVisibility = true;
    return sample;
  } finally {
    if (!restoredVisibility) {
      try {
        await activateDocument(app, action, originalDocumentId);
        await setLayerVisible(action, sourceLayerId, sourceWasVisible);
      } catch (_) {}
    }
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

function buildStatsFromRgbaSafe(data) {
  try {
    return buildStatsFromRgba(data);
  } catch (error) {
    return {
      count: 0,
      meanR: 0,
      meanG: 0,
      meanB: 0,
      weightedMeanR: 0,
      weightedMeanG: 0,
      weightedMeanB: 0,
      weightedMeanLuma: 0,
      weightedMeanSat: 0,
      meanLuma: 0,
      stdLuma: 0,
      meanSat: 0,
      detailEnergy: 0,
      statsError: error && error.message ? error.message : "empty-stats"
    };
  }
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

function getAlphaStats(data) {
  const length = Math.floor((data && data.length ? data.length : 0) / 4);
  if (!length) return { count: 0, opaqueRatio: 0, transparentRatio: 1, minAlpha: 0, maxAlpha: 0 };
  let opaque = 0;
  let transparent = 0;
  let minAlpha = 255;
  let maxAlpha = 0;
  for (let index = 3; index < data.length; index += 4) {
    const alpha = Number(data[index]) || 0;
    if (alpha >= 250) opaque += 1;
    if (alpha <= 4) transparent += 1;
    minAlpha = Math.min(minAlpha, alpha);
    maxAlpha = Math.max(maxAlpha, alpha);
  }
  return {
    count: length,
    opaqueRatio: opaque / length,
    transparentRatio: transparent / length,
    minAlpha,
    maxAlpha
  };
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

function buildSubjectAwareColorWeights(sourceChannels, referenceChannels, width, height) {
  const length = width * height;
  const weights = new Float32Array(length);
  const sourceGrad = buildSobelMagnitude(sourceChannels.y, width, height);
  const refGrad = buildSobelMagnitude(referenceChannels.y, width, height);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const maxDistance = Math.max(1, Math.hypot(centerX, centerY));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const alpha = Math.max(0, Math.min(1, sourceChannels.alpha[i]));
      if (alpha <= 0.04) {
        weights[i] = 0;
        continue;
      }
      const sourceY = sourceChannels.y[i];
      const refY = referenceChannels.y[i];
      const diffY = Math.abs(sourceY - refY);
      const diffChroma = Math.hypot(sourceChannels.u[i] - referenceChannels.u[i], sourceChannels.v[i] - referenceChannels.v[i]);
      const sourceEdge = sourceGrad[i];
      const refEdge = refGrad[i];
      const edge = Math.max(sourceEdge, refEdge);
      const edgeAgreement = Math.min(sourceEdge, refEdge) / Math.max(1, edge);
      const midtone = 1 - Math.min(1, Math.abs(sourceY - 132) / 132);
      const saturation = Math.max(sourceChannels.saturation[i], referenceChannels.saturation[i]);
      const distance = Math.hypot(x - centerX, y - centerY) / maxDistance;
      const centerBias = 1 - Math.min(1, distance * 0.82);
      const differenceCue = Math.min(1, (diffY * 0.72 + diffChroma * 0.45) / 48);
      const edgeCue = Math.min(1, edge / 42) * (0.45 + edgeAgreement * 0.55);
      const colorCue = Math.min(1, saturation * 2.4);
      const highlightPenalty = smoothstep(222, 252, Math.max(sourceY, refY)) * 0.68;
      const shadowPenalty = (1 - smoothstep(12, 38, Math.min(sourceY, refY))) * 0.62;
      const flatBackgroundPenalty = edge < 6 && diffY < 7 && diffChroma < 7 ? 0.58 : 0;
      let weight = alpha * (
        0.08 +
        differenceCue * 0.42 +
        edgeCue * 0.36 +
        colorCue * 0.18 +
        midtone * 0.24 +
        centerBias * 0.16
      );
      weight *= 1 - Math.min(0.82, highlightPenalty + shadowPenalty + flatBackgroundPenalty);
      weights[i] = Math.max(0, weight);
    }
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

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (Number(value) - edge0) / Math.max(0.0001, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function weightedStatsWhere(values, weights, predicate) {
  let sum = 0;
  let sumSq = 0;
  let weight = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (predicate && !predicate(i)) continue;
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

function serializeSampleForWebview(sample) {
  if (!sample || !sample.data) return null;
  const data = sample.data instanceof Uint8Array
    ? sample.data
    : new Uint8Array(sample.data);
  const encodedAt = getNowMs();
  return {
    width: sample.width,
    height: sample.height,
    scaleX: sample.scaleX,
    scaleY: sample.scaleY,
    sourceComponents: sample.sourceComponents,
    sourcePixelFormat: sample.sourcePixelFormat,
    stats: sample.stats,
    base64: arrayBufferToBase64(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
    encodingMs: Number((getNowMs() - encodedAt).toFixed(1)),
    byteLength: data.byteLength
  };
}

function weightedPercentiles(values, weights, percentiles, predicate, min = 0, max = 255, bins = 256) {
  const safeMin = Number.isFinite(Number(min)) ? Number(min) : 0;
  const safeMax = Number.isFinite(Number(max)) && Number(max) > safeMin ? Number(max) : safeMin + 1;
  const binCount = Math.max(16, Math.floor(Number(bins) || 256));
  const histogram = new Float64Array(binCount);
  let totalWeight = 0;
  const scale = (binCount - 1) / (safeMax - safeMin);
  for (let i = 0; i < values.length; i += 1) {
    if (predicate && !predicate(i)) continue;
    const weight = weights ? Number(weights[i]) || 0 : 1;
    if (weight <= 0) continue;
    const value = Math.max(safeMin, Math.min(safeMax, Number(values[i]) || 0));
    const bin = Math.max(0, Math.min(binCount - 1, Math.round((value - safeMin) * scale)));
    histogram[bin] += weight;
    totalWeight += weight;
  }
  if (totalWeight <= 0) return null;
  const targets = Array.isArray(percentiles) && percentiles.length ? percentiles : [0.5];
  const out = {};
  const sorted = targets
    .map((value) => Math.max(0, Math.min(1, Number(value) || 0)))
    .sort((a, b) => a - b);
  let targetIndex = 0;
  let accumulated = 0;
  for (let bin = 0; bin < binCount && targetIndex < sorted.length; bin += 1) {
    accumulated += histogram[bin];
    while (targetIndex < sorted.length && accumulated >= totalWeight * sorted[targetIndex]) {
      out[sorted[targetIndex]] = safeMin + (bin / Math.max(1, binCount - 1)) * (safeMax - safeMin);
      targetIndex += 1;
    }
  }
  while (targetIndex < sorted.length) {
    out[sorted[targetIndex]] = safeMax;
    targetIndex += 1;
  }
  return {
    values: out,
    weight: totalWeight
  };
}

function weightedChromaStats(uValues, vValues, weights, predicate) {
  let sum = 0;
  let sumSq = 0;
  let weight = 0;
  for (let i = 0; i < uValues.length; i += 1) {
    if (predicate && !predicate(i)) continue;
    const w = weights ? Number(weights[i]) || 0 : 1;
    if (w <= 0) continue;
    const u = Number(uValues[i]) || 0;
    const v = Number(vValues[i]) || 0;
    const value = Math.hypot(u, v);
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

function getColorProfileLimits(config, significantMismatch) {
  const mode = String(config && config.mode || "balanced");
  const strong = mode === "strong";
  const natural = mode === "natural";
  return {
    toneCap: significantMismatch ? (strong ? 76 : natural ? 44 : 62) : (strong ? 52 : natural ? 30 : 42),
    shadowCap: significantMismatch ? (strong ? 38 : natural ? 22 : 30) : (strong ? 26 : natural ? 14 : 20),
    colorCap: significantMismatch ? (strong ? 64 : natural ? 40 : 54) : (strong ? 44 : natural ? 28 : 36),
    chromaMin: significantMismatch ? (strong ? 0.68 : natural ? 0.82 : 0.76) : (strong ? 0.82 : natural ? 0.9 : 0.86),
    chromaMax: significantMismatch ? (strong ? 1.46 : natural ? 1.2 : 1.34) : (strong ? 1.22 : natural ? 1.1 : 1.16),
    saturationMin: significantMismatch ? (strong ? 0.78 : natural ? 0.88 : 0.82) : (strong ? 0.86 : natural ? 0.94 : 0.9),
    saturationMax: significantMismatch ? (strong ? 1.3 : natural ? 1.16 : 1.24) : (strong ? 1.16 : natural ? 1.08 : 1.12)
  };
}

function buildToneCurveProfile(sourceChannels, referenceChannels, weights, predicate, toneStrength, limits, significantMismatch) {
  const sourceTone = weightedPercentiles(sourceChannels.y, weights, [0.1, 0.5, 0.9], predicate, 0, 255, 256);
  const referenceTone = weightedPercentiles(referenceChannels.y, weights, [0.1, 0.5, 0.9], predicate, 0, 255, 256);
  if (!sourceTone || !referenceTone || sourceTone.weight <= 12 || referenceTone.weight <= 12) return null;
  const source = [
    Number(sourceTone.values[0.1]) || 0,
    Number(sourceTone.values[0.5]) || 0,
    Number(sourceTone.values[0.9]) || 0
  ];
  const reference = [
    Number(referenceTone.values[0.1]) || 0,
    Number(referenceTone.values[0.5]) || 0,
    Number(referenceTone.values[0.9]) || 0
  ];
  const cap = Math.max(1, Number(limits && limits.toneCap) || 42);
  const shadowCap = Math.max(1, Number(limits && limits.shadowCap) || 20);
  const curveStrength = Math.max(0, Math.min(significantMismatch ? 0.88 : 0.7, Number(toneStrength) || 0));
  const delta10 = Math.max(-shadowCap, Math.min(shadowCap, (reference[0] - source[0]) * curveStrength));
  const delta50 = Math.max(-cap, Math.min(cap, (reference[1] - source[1]) * curveStrength));
  const delta90 = Math.max(-shadowCap, Math.min(shadowCap, (reference[2] - source[2]) * curveStrength));
  const meanAbsDelta = (Math.abs(delta10) + Math.abs(delta50) + Math.abs(delta90)) / 3;
  if (meanAbsDelta < 0.35) return null;
  return {
    source,
    reference,
    deltas: [delta10, delta50, delta90],
    shadowDelta: delta10,
    midDelta: delta50,
    highlightDelta: delta90,
    mix: significantMismatch ? 0.82 : 0.58,
    weight: sourceTone.weight
  };
}

function getToneCurveDelta(value, curve) {
  if (!curve || !Array.isArray(curve.source) || !Array.isArray(curve.deltas)) return null;
  const y = Math.max(0, Math.min(255, Number(value) || 0));
  const s10 = Math.max(0, Math.min(255, Number(curve.source[0]) || 0));
  const s50 = Math.max(s10 + 1, Math.min(255, Number(curve.source[1]) || s10 + 1));
  const s90 = Math.max(s50 + 1, Math.min(255, Number(curve.source[2]) || s50 + 1));
  const d10 = Number(curve.deltas[0]) || 0;
  const d50 = Number(curve.deltas[1]) || 0;
  const d90 = Number(curve.deltas[2]) || 0;
  const shadowDelta = Number(curve.shadowDelta) || d10;
  const highlightDelta = Number(curve.highlightDelta) || d90;
  if (y <= s10) {
    return lerp(shadowDelta, d10, smoothstep(0, Math.max(1, s10), y));
  }
  if (y <= s50) {
    return lerp(d10, d50, (y - s10) / Math.max(1, s50 - s10));
  }
  if (y <= s90) {
    return lerp(d50, d90, (y - s50) / Math.max(1, s90 - s50));
  }
  return lerp(d90, highlightDelta, smoothstep(s90, 255, y));
}

function summarizeToneCurveStrength(curve) {
  if (!curve || !Array.isArray(curve.deltas) || !curve.deltas.length) return 0;
  const total = curve.deltas.reduce((sum, value) => sum + Math.abs(Number(value) || 0), 0);
  return total / curve.deltas.length;
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
  const hasGlobal = Boolean(alignment && alignment.applied);
  const local = alignment && alignment.local && alignment.local.applied ? alignment.local : null;
  if (!hasGlobal && !local) return null;
  const out = new Uint8Array(width * height * 4);
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

function processBlendMatchPixels(sourceSample, referenceSample, config, alignment, alignmentSample, options = {}) {
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
    out[index + 3] = options.forceOpaque === true ? 255 : alpha;
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

function applyInternalColorCorrectionsToRgba(sourceSample, config, corrections, options = {}) {
  if (!sourceSample || !sourceSample.data) throw new Error("内部融合缺少 source 像素。");
  const width = Math.max(1, Number(sourceSample.width) || 1);
  const height = Math.max(1, Number(sourceSample.height) || 1);
  const sourceData = sourceSample.data;
  const out = new Uint8Array(sourceData.length);
  const profile = options.colorProfile || null;
  const total = Math.max(0, Math.min(1, Number(config && config.totalStrength) / 100 || 0));
  const brightness = (Number(corrections && corrections.brightness) || 0) * (0.72 + total * 0.28);
  const contrast = Number(corrections && corrections.contrast) || 0;
  const saturation = Number(corrections && corrections.saturation) || 0;
  const balance = corrections && corrections.colorBalance ? corrections.colorBalance : {};
  const colorScale = 0.85 + total * 0.15;
  const contrastFactor = (259 * (contrast + 255)) / Math.max(1, 255 * (259 - contrast));
  const saturationFactor = Math.max(0.45, Math.min(1.75, 1 + saturation / 100));
  const forceOpaque = options.forceOpaque === true;
  for (let index = 0; index < sourceData.length; index += 4) {
    const alpha = sourceData[index + 3];
    if (alpha <= 0) {
      out[index] = 0;
      out[index + 1] = 0;
      out[index + 2] = 0;
      out[index + 3] = 0;
      continue;
    }
    let r = sourceData[index];
    let g = sourceData[index + 1];
    let b = sourceData[index + 2];
    if (profile) {
      const y0 = 0.299 * r + 0.587 * g + 0.114 * b;
      const u0 = b - y0;
      const v0 = r - y0;
      const maxChannel = Math.max(r, g, b);
      const minChannel = Math.min(r, g, b);
      const sat0 = maxChannel <= 0 ? 0 : (maxChannel - minChannel) / maxChannel;
      const shadowWeight = 1 - smoothstep(42, 118, y0);
      const highlightWeight = smoothstep(172, 238, y0);
      const midWeight = Math.max(0, 1 - Math.max(shadowWeight, highlightWeight));
      let toneDelta =
        (Number(profile.shadowDelta) || 0) * shadowWeight +
        (Number(profile.midDelta) || 0) * midWeight +
        (Number(profile.highlightDelta) || 0) * highlightWeight;
      const curveDelta = getToneCurveDelta(y0, profile.toneCurve);
      if (Number.isFinite(curveDelta)) {
        toneDelta = lerp(toneDelta, curveDelta, Math.max(0, Math.min(1, Number(profile.toneCurve && profile.toneCurve.mix) || 0.62)));
      }
      if (y0 > 218 && toneDelta > 0) toneDelta *= 0.35;
      if (y0 < 32 && toneDelta < 0) toneDelta *= 0.35;
      const y = y0 + toneDelta;
      const chromaProtect = 0.52 + midWeight * 0.48;
      const neutralWeight = (1 - smoothstep(0.06, 0.32, sat0)) * (0.36 + midWeight * 0.64);
      const chromaScale = Number(profile.chromaScale) || 1;
      const u = u0 * (1 + (chromaScale - 1) * chromaProtect) + profile.uDelta * chromaProtect + (Number(profile.neutralUDelta) || 0) * neutralWeight;
      const v = v0 * (1 + (chromaScale - 1) * chromaProtect) + profile.vDelta * chromaProtect + (Number(profile.neutralVDelta) || 0) * neutralWeight;
      [r, g, b] = yuvToRgb(y, u, v);
      [r, g, b] = applySaturationToRgb(r, g, b, 1 + (profile.saturationFactor - 1) * chromaProtect);
    } else {
      r += brightness + (Number(balance.cyanRed) || 0) * colorScale;
      g += brightness + (Number(balance.magentaGreen) || 0) * colorScale;
      b += brightness + (Number(balance.yellowBlue) || 0) * colorScale;
      r = contrastFactor * (r - 128) + 128;
      g = contrastFactor * (g - 128) + 128;
      b = contrastFactor * (b - 128) + 128;
      [r, g, b] = applySaturationToRgb(r, g, b, saturationFactor);
    }
    out[index] = clampByte(r);
    out[index + 1] = clampByte(g);
    out[index + 2] = clampByte(b);
    out[index + 3] = forceOpaque ? 255 : alpha;
  }
  return {
    width,
    height,
    scaleX: sourceSample.scaleX,
    scaleY: sourceSample.scaleY,
    data: out,
    color: {
      method: profile ? (profile.significantMismatch ? "enhanced-tone-chroma-profile" : "protected-tone-chroma-profile") : "legacy-correction-profile",
      brightness: profile ? Number(profile.midDelta.toFixed(2)) : Number(brightness.toFixed(2)),
      contrast: profile ? Number(summarizeToneCurveStrength(profile.toneCurve).toFixed(2)) : Number(contrast.toFixed(2)),
      saturation: profile ? Number(((profile.saturationFactor - 1) * 100).toFixed(2)) : Number(saturation.toFixed(2)),
      colorBalance: profile
        ? {
            cyanRed: Number((profile.vDelta + (Number(profile.neutralVDelta) || 0)).toFixed(2)),
            magentaGreen: 0,
            yellowBlue: Number((profile.uDelta + (Number(profile.neutralUDelta) || 0)).toFixed(2))
          }
        : {
            cyanRed: Number(((Number(balance.cyanRed) || 0) * colorScale).toFixed(2)),
            magentaGreen: Number(((Number(balance.magentaGreen) || 0) * colorScale).toFixed(2)),
            yellowBlue: Number(((Number(balance.yellowBlue) || 0) * colorScale).toFixed(2))
          }
    }
  };
}

function buildInternalColorProfile(sourceSample, referenceSample, config, alignment) {
  if (!sourceSample || !referenceSample || !sourceSample.data || !referenceSample.data || sourceSample.width !== referenceSample.width || sourceSample.height !== referenceSample.height) {
    return null;
  }
  const alignedSource = applyGlobalAndLocalWarp(sourceSample, alignment, sourceSample) || sourceSample;
  const width = Math.max(1, Number(sourceSample.width) || 1);
  const height = Math.max(1, Number(sourceSample.height) || 1);
  const sourceChannels = buildYuvChannels(alignedSource.data, width, height);
  const referenceChannels = buildYuvChannels(referenceSample.data, width, height);
  const weights = buildSubjectAwareColorWeights(sourceChannels, referenceChannels, width, height);
  const total = Math.max(0, Math.min(1, Number(config && config.totalStrength) / 100 || 0));
  const luminanceAmount = total * Math.max(0, Math.min(1.15, Number(config && config.luminanceStrength) / 100 || 0));
  const colorAmount = total * Math.max(0, Math.min(1.2, Number(config && config.colorStrength) / 100 || 0));
  const saturationAmount = total * Math.max(-1, Math.min(1.05, Number(config && config.saturationStrength) / 100 || 0));
  const validAny = (i) => sourceChannels.alpha[i] > 0.08 && sourceChannels.y[i] >= 8 && sourceChannels.y[i] <= 248 && referenceChannels.y[i] >= 6 && referenceChannels.y[i] <= 250;
  const validMidStrict = (i) => sourceChannels.alpha[i] > 0.08 && sourceChannels.y[i] >= 42 && sourceChannels.y[i] <= 218 && referenceChannels.y[i] >= 32 && referenceChannels.y[i] <= 232;
  const strictY = weightedStatsWhere(sourceChannels.y, weights, validMidStrict);
  const validMid = strictY.weight > 24 ? validMidStrict : validAny;
  const validShadow = (i) => sourceChannels.alpha[i] > 0.08 && sourceChannels.y[i] < 112 && sourceChannels.y[i] >= 12;
  const validHighlight = (i) => sourceChannels.alpha[i] > 0.08 && sourceChannels.y[i] > 146 && sourceChannels.y[i] <= 248;
  const validNeutral = (i) => {
    if (!validMid(i)) return false;
    const sourceNeutral = sourceChannels.saturation[i] <= 0.34 && Math.hypot(sourceChannels.u[i], sourceChannels.v[i]) <= 42;
    const referenceNeutral = referenceChannels.saturation[i] <= 0.38 && Math.hypot(referenceChannels.u[i], referenceChannels.v[i]) <= 48;
    return sourceNeutral || referenceNeutral;
  };
  const sourceY = weightedStatsWhere(sourceChannels.y, weights, validMid);
  const referenceY = weightedStatsWhere(referenceChannels.y, weights, validMid);
  if (Math.min(sourceY.weight, referenceY.weight) <= 12) return null;
  const sourceShadowY = weightedStatsWhere(sourceChannels.y, weights, validShadow);
  const referenceShadowY = weightedStatsWhere(referenceChannels.y, weights, validShadow);
  const sourceHighlightY = weightedStatsWhere(sourceChannels.y, weights, validHighlight);
  const referenceHighlightY = weightedStatsWhere(referenceChannels.y, weights, validHighlight);
  const sourceU = weightedStatsWhere(sourceChannels.u, weights, validMid);
  const referenceU = weightedStatsWhere(referenceChannels.u, weights, validMid);
  const sourceV = weightedStatsWhere(sourceChannels.v, weights, validMid);
  const referenceV = weightedStatsWhere(referenceChannels.v, weights, validMid);
  const sourceNeutralU = weightedStatsWhere(sourceChannels.u, weights, validNeutral);
  const referenceNeutralU = weightedStatsWhere(referenceChannels.u, weights, validNeutral);
  const sourceNeutralV = weightedStatsWhere(sourceChannels.v, weights, validNeutral);
  const referenceNeutralV = weightedStatsWhere(referenceChannels.v, weights, validNeutral);
  const sourceSat = weightedStatsWhere(sourceChannels.saturation, weights, validMid);
  const referenceSat = weightedStatsWhere(referenceChannels.saturation, weights, validMid);
  const sourceChroma = weightedChromaStats(sourceChannels.u, sourceChannels.v, weights, validMid);
  const referenceChroma = weightedChromaStats(referenceChannels.u, referenceChannels.v, weights, validMid);
  const lumaDeltaRaw = referenceY.mean - sourceY.mean;
  const chromaDeltaRaw = Math.hypot(referenceU.mean - sourceU.mean, referenceV.mean - sourceV.mean);
  const saturationDeltaRaw = referenceSat.mean - sourceSat.mean;
  const chromaRatioRaw = sourceChroma.mean > 1 ? referenceChroma.mean / sourceChroma.mean : 1;
  const significantMismatch =
    Math.abs(lumaDeltaRaw) > 18 ||
    chromaDeltaRaw > 16 ||
    Math.abs(saturationDeltaRaw) > 0.12 ||
    chromaRatioRaw > 1.24 ||
    chromaRatioRaw < 0.78;
  const limits = getColorProfileLimits(config, significantMismatch);
  const toneStrength = Math.min(significantMismatch ? 0.88 : 0.72, luminanceAmount * (significantMismatch ? 0.98 : 0.82));
  const colorStrength = Math.min(significantMismatch ? 0.92 : 0.82, colorAmount * (significantMismatch ? 1.02 : 0.86));
  const saturationStrength = significantMismatch ? saturationAmount * 1.24 : saturationAmount;
  const midDelta = Math.max(-limits.toneCap, Math.min(limits.toneCap, lumaDeltaRaw * toneStrength));
  const shadowRawDelta = referenceShadowY.weight > 16 ? referenceShadowY.mean - sourceShadowY.mean : lumaDeltaRaw;
  const highlightRawDelta = referenceHighlightY.weight > 16 ? referenceHighlightY.mean - sourceHighlightY.mean : lumaDeltaRaw;
  const shadowDelta = Math.max(-limits.shadowCap, Math.min(limits.shadowCap, (shadowRawDelta * 0.52 + lumaDeltaRaw * 0.24) * toneStrength));
  const highlightDelta = Math.max(-limits.shadowCap, Math.min(limits.shadowCap, (highlightRawDelta * 0.48 + lumaDeltaRaw * 0.2) * toneStrength));
  const neutralWeight = Math.min(sourceNeutralU.weight, referenceNeutralU.weight);
  const neutralMix = neutralWeight > 18 ? (significantMismatch ? 0.54 : 0.38) : 0;
  const neutralRawU = neutralWeight > 18 ? referenceNeutralU.mean - sourceNeutralU.mean : 0;
  const neutralRawV = neutralWeight > 18 ? referenceNeutralV.mean - sourceNeutralV.mean : 0;
  const uRawDelta = referenceU.mean - sourceU.mean;
  const vRawDelta = referenceV.mean - sourceV.mean;
  const uDelta = Math.max(-limits.colorCap, Math.min(limits.colorCap, (uRawDelta * (1 - neutralMix * 0.45) + neutralRawU * neutralMix * 0.45) * colorStrength));
  const vDelta = Math.max(-limits.colorCap, Math.min(limits.colorCap, (vRawDelta * (1 - neutralMix * 0.45) + neutralRawV * neutralMix * 0.45) * colorStrength));
  const neutralUDelta = Math.max(-limits.colorCap * 0.5, Math.min(limits.colorCap * 0.5, neutralRawU * neutralMix * colorStrength));
  const neutralVDelta = Math.max(-limits.colorCap * 0.5, Math.min(limits.colorCap * 0.5, neutralRawV * neutralMix * colorStrength));
  const saturationFactor = Math.max(limits.saturationMin, Math.min(limits.saturationMax, 1 + saturationDeltaRaw * 1.28 * saturationStrength));
  const rawChromaScale = sourceChroma.mean > 1 ? referenceChroma.mean / sourceChroma.mean : 1;
  const chromaScale = Math.max(limits.chromaMin, Math.min(limits.chromaMax, 1 + (rawChromaScale - 1) * colorStrength));
  const toneCurve = buildToneCurveProfile(sourceChannels, referenceChannels, weights, validAny, toneStrength, limits, significantMismatch);
  return {
    midDelta,
    shadowDelta,
    highlightDelta,
    uDelta,
    vDelta,
    neutralUDelta,
    neutralVDelta,
    chromaScale,
    saturationFactor,
    toneCurve,
    significantMismatch,
    subjectWeight: sourceY.weight,
    weight: sourceY.weight,
    raw: {
      significantMismatch,
      lumaDeltaRaw,
      chromaDeltaRaw,
      saturationDeltaRaw,
      chromaRatioRaw,
      sourceY,
      referenceY,
      sourceShadowY,
      referenceShadowY,
      sourceHighlightY,
      referenceHighlightY,
      sourceU,
      referenceU,
      sourceV,
      referenceV,
      sourceNeutralU,
      referenceNeutralU,
      sourceNeutralV,
      referenceNeutralV,
      sourceSat,
      referenceSat,
      sourceChroma,
      referenceChroma
    }
  };
}

async function createInternalBlendMatchResult({
  app,
  action,
  imaging,
  document,
  storage,
  sourceLayerId,
  sourceBounds,
  resultLayerName,
  alignment,
  alignmentSample,
  config,
  corrections,
  colorPlan: plannedColorPlan = null,
  colorProfile: plannedColorProfile = null,
  referenceSample,
  fullDocumentTarget,
  logs,
  timing
}) {
  const outputLongEdge = Math.max(
    Math.max(1, Math.ceil(Number(sourceBounds.right) - Number(sourceBounds.left))),
    Math.max(1, Math.ceil(Number(sourceBounds.bottom) - Number(sourceBounds.top)))
  );
  const sourceSample = await captureIsolatedSourceSampleV2(imaging, app, action, document, sourceLayerId, sourceBounds, outputLongEdge);
  if (timing) timing.mark("隔离输出采样", { width: sourceSample.width, height: sourceSample.height });
  logs.push(`[融合校色] 内部处理：预览 ${alignmentSample.width}x${alignmentSample.height}，输出 ${sourceSample.width}x${sourceSample.height}，source ${sourceSample.sourceComponents || 0}${sourceSample.sourcePixelFormat ? `/${sourceSample.sourcePixelFormat}` : ""}->RGBA。`);
  const alpha = getAlphaStats(sourceSample.data);
  const forceOpaque = fullDocumentTarget && alpha.opaqueRatio > 0.995 && alpha.transparentRatio < 0.001;
  let effectiveCorrections = corrections;
  let colorProfile = plannedColorProfile;
  if (plannedColorPlan && typeof plannedColorPlan === "object") {
    if (plannedColorPlan.corrections) effectiveCorrections = cloneJsonValue(plannedColorPlan.corrections);
    if (plannedColorPlan.profile) colorProfile = cloneJsonValue(plannedColorPlan.profile);
  }
  const hasPlannedColorPlan = Boolean(plannedColorPlan && typeof plannedColorPlan === "object");
  const plannedLegacyFallback = hasPlannedColorPlan && plannedColorPlan.method === "legacy-corrections";
  if (!colorProfile && hasPlannedColorPlan && plannedColorPlan.method === "internal-color-profile") {
    logs.push("[融合校色] ColorPlan 标记为 internal profile 但缺少 profile，执行前重建颜色画像。");
  }
  if (!colorProfile && !plannedLegacyFallback) {
    colorProfile = buildInternalColorProfile(alignmentSample, referenceSample, config, alignment);
  }
  const colorPlanReused = Boolean(hasPlannedColorPlan && (plannedLegacyFallback || plannedColorPlan.profile && colorProfile));
  if (timing) {
    timing.mark(colorPlanReused ? "执行复用 ColorPlan" : "执行颜色画像", colorProfile ? { weight: Math.round(colorProfile.subjectWeight || 0) } : { method: plannedLegacyFallback ? "legacy-corrections" : "profile-missing" });
  }
  const warped = applyGlobalAndLocalWarp(sourceSample, alignment, alignmentSample || sourceSample) || {
    width: sourceSample.width,
    height: sourceSample.height,
    data: copyRgba(sourceSample.data),
    globalApplied: false,
    localApplied: false,
    validTiles: 0,
    totalTiles: 0,
    maxDistance: 0
  };
  if (timing) timing.mark(warped.globalApplied || warped.localApplied ? "原尺寸变形" : "跳过变形");
  const corrected = applyInternalColorCorrectionsToRgba(warped, config, effectiveCorrections, { forceOpaque, colorProfile });
  if (timing) timing.mark("原尺寸校色");
  const pngBuffer = await encodeRgbaPng(corrected.width, corrected.height, corrected.data);
  if (!pngBuffer) throw new Error("内部融合 PNG 编码失败。");
  if (timing) timing.mark("PNG 编码", { bytes: pngBuffer.byteLength || 0 });
  await activateDocument(app, action, Number(document.id));
  const placed = await placeAlignedPngResult(app, action, storage, pngBuffer, sourceBounds, resultLayerName);
  if (timing) timing.mark("置入结果层");
  logs.push(`[融合校色] 内部融合：对齐 ${warped.globalApplied ? "全局" : "无全局"}/${warped.localApplied ? `局部 ${warped.validTiles || 0}/${warped.totalTiles || 0}` : "无局部"}，颜色 ${corrected.color.method}${colorProfile ? `，主体权重 ${Math.round(colorProfile.subjectWeight || 0)}` : ""}，亮度 ${corrected.color.brightness >= 0 ? "+" : ""}${corrected.color.brightness}，对比 ${corrected.color.contrast >= 0 ? "+" : ""}${corrected.color.contrast}%，饱和 ${corrected.color.saturation >= 0 ? "+" : ""}${corrected.color.saturation}%。`);
  return {
    layer: placed.layer,
    layerId: placed.layerId,
    width: corrected.width,
    height: corrected.height,
    color: corrected.color,
    colorPlan: summarizeColorPlan(plannedColorPlan) || null,
    alignment: {
      globalApplied: Boolean(warped.globalApplied),
      localApplied: Boolean(warped.localApplied),
      validTiles: Number(warped.validTiles) || 0,
      totalTiles: Number(warped.totalTiles) || 0,
      maxDistance: Number(warped.maxDistance) || 0,
      localStrength: Number(warped.localStrength) || 0
    },
    forceOpaque
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

function toPixelNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value && typeof value === "object") {
    const nested = value._value ?? value.value;
    const parsed = Number(nested);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTransformPoint(point) {
  if (Array.isArray(point) && point.length >= 2) {
    const x = toPixelNumber(point[0]);
    const y = toPixelNumber(point[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  if (point && typeof point === "object") {
    const x = toPixelNumber(point.x ?? point.horizontal ?? point.left);
    const y = toPixelNumber(point.y ?? point.vertical ?? point.top);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  return null;
}

function parseTransformBounds(transform) {
  if (!transform) return null;
  let points = [];
  if (Array.isArray(transform)) {
    if (transform.length >= 8 && transform.every((item) => toPixelNumber(item) !== null)) {
      points = [
        { x: toPixelNumber(transform[0]), y: toPixelNumber(transform[1]) },
        { x: toPixelNumber(transform[2]), y: toPixelNumber(transform[3]) },
        { x: toPixelNumber(transform[4]), y: toPixelNumber(transform[5]) },
        { x: toPixelNumber(transform[6]), y: toPixelNumber(transform[7]) }
      ];
    } else {
      points = transform.map(parseTransformPoint).filter(Boolean);
    }
  } else if (typeof transform === "object") {
    points = [
      transform.topLeft,
      transform.topRight,
      transform.bottomRight,
      transform.bottomLeft,
      transform.quadTopLeft,
      transform.quadTopRight,
      transform.quadBottomRight,
      transform.quadBottomLeft
    ].map(parseTransformPoint).filter(Boolean);
  }
  if (points.length < 2) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

async function getActivePlacedLayerTransformBounds(action) {
  if (!action || typeof action.batchPlay !== "function") return null;
  try {
    const result = await action.batchPlay([{
      _obj: "get",
      _target: [
        { _property: "smartObjectMore" },
        { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }
      ],
      _options: { dialogOptions: "dontDisplay" }
    }], {});
    const smartObjectMore = result && result[0] && result[0].smartObjectMore;
    return parseTransformBounds(smartObjectMore && (smartObjectMore.transform || smartObjectMore.nonAffineTransform));
  } catch (_) {
    return null;
  }
}

async function alignActiveLayerToBounds(app, action, targetBounds) {
  const layer = app && app.activeDocument && app.activeDocument.activeLayers && app.activeDocument.activeLayers[0];
  const transformBounds = await getActivePlacedLayerTransformBounds(action);
  const bounds = transformBounds || parseLayerBounds(layer && layer.bounds);
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

async function deleteLayerByIdBestEffort(action, layerId) {
  const id = Number(layerId) || 0;
  if (!(id > 0)) return false;
  try {
    await action.batchPlay([{
      _obj: "delete",
      _target: [{ _ref: "layer", _id: id }],
      _options: { dialogOptions: "dontDisplay" }
    }], {});
    return true;
  } catch (_) {
    return false;
  }
}

async function rasterizeActiveLayerBestEffort(action) {
  try {
    await action.batchPlay([{
      _obj: "rasterizeLayer",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      _options: { dialogOptions: "dontDisplay" }
    }], {});
    return true;
  } catch (_) {
    return false;
  }
}

async function duplicateActiveLayer(action, layerName) {
  await action.batchPlay([{
    _obj: "duplicate",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    name: layerName
  }], {});
}

async function placeAlignedPngResult(app, action, storage, pngBuffer, sourceBounds, resultLayerName) {
  let placedLayer = null;
  let placedLayerId = 0;
  try {
    placedLayer = await placePngBufferAsLayer(app, action, storage, pngBuffer, sourceBounds, resultLayerName);
    placedLayerId = getLayerId(placedLayer);
    if (!(placedLayerId > 0)) throw new Error("像素对齐 PNG 置入失败。");
    const rasterized = await rasterizeActiveLayerBestEffort(action);
    if (!rasterized) throw new Error("像素对齐结果栅格化失败。");
    placedLayer = getActiveLayer(app);
    placedLayerId = getLayerId(placedLayer);
    if (!(placedLayerId > 0)) throw new Error("像素对齐结果层不可用。");
    try {
      placedLayer.name = resultLayerName;
    } catch (_) {}
    return { layer: placedLayer, layerId: placedLayerId, rasterized };
  } catch (error) {
    const activeLayerId = getLayerId(getActiveLayer(app));
    await deleteLayerByIdBestEffort(action, placedLayerId || activeLayerId);
    throw error;
  }
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

function sampleFloatBilinear(buffer, width, height, x, y) {
  const sx = Math.max(0, Math.min(width - 1, x));
  const sy = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = sx - x0;
  const ty = sy - y0;
  const i00 = y0 * width + x0;
  const i10 = y0 * width + x1;
  const i01 = y1 * width + x0;
  const i11 = y1 * width + x1;
  const top = buffer[i00] * (1 - tx) + buffer[i10] * tx;
  const bottom = buffer[i01] * (1 - tx) + buffer[i11] * tx;
  return top * (1 - ty) + bottom * ty;
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
    for (let x = startX; x < endX; x += step) {
      const sourceX = x + dx;
      if (sourceX < 1 || sourceX >= width - 1) continue;
      const refIndex = refRow + x;
      const a = sampleFloatBilinear(sourceField.mag, width, height, sourceX, sourceY);
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
      const sourceGx = sampleFloatBilinear(sourceField.gx, width, height, sourceX, sourceY);
      const sourceGy = sampleFloatBilinear(sourceField.gy, width, height, sourceX, sourceY);
      const cos = (
        sourceGx * referenceField.gx[refIndex] +
        sourceGy * referenceField.gy[refIndex]
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

function scoreGradientFieldWarp(sourceField, referenceField, width, height, transform, local, stride, region = null) {
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  let directionSum = 0;
  let overlapSum = 0;
  let weightSum = 0;
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
  const mesh = local && local.applied ? buildDenseMeshGrid(local, width, height) : null;
  const localStrength = mesh ? Math.max(0, Math.min(1, Number(local.strength) || DEFAULT_BLEND_MATCH_CONFIG.localMeshStrength)) : 0;
  const startX = Math.max(1, region ? region.left : 1);
  const endX = Math.min(width - 1, region ? region.right : width - 1);
  const startY = Math.max(1, region ? region.top : 1);
  const endY = Math.min(height - 1, region ? region.bottom : height - 1);
  const step = Math.max(1, Number(stride) || 1);
  for (let y = startY; y < endY; y += step) {
    const refRow = y * width;
    for (let x = startX; x < endX; x += step) {
      const localX = x - cx;
      const localY = y - cy;
      let sourceX = cx + ((localX * cos - localY * sin) / scaleX) + dx;
      let sourceY = cy + ((localX * sin + localY * cos) / scaleY) + dy;
      if (mesh) {
        const flow = interpolateMeshOffset(mesh, x, y);
        sourceX += flow.dx * localStrength;
        sourceY += flow.dy * localStrength;
      }
      if (sourceX < 1 || sourceX >= width - 1 || sourceY < 1 || sourceY >= height - 1) continue;
      const refIndex = refRow + x;
      const a = sampleFloatBilinear(sourceField.mag, width, height, sourceX, sourceY);
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
      const sourceGx = sampleFloatBilinear(sourceField.gx, width, height, sourceX, sourceY);
      const sourceGy = sampleFloatBilinear(sourceField.gy, width, height, sourceX, sourceY);
      const cosAngle = (
        sourceGx * referenceField.gx[refIndex] +
        sourceGy * referenceField.gy[refIndex]
      ) / Math.max(0.001, sourceMag * refMag);
      directionSum += Math.max(-1, Math.min(1, cosAngle)) * edgeWeight;
      overlapSum += (Math.min(a, b) / Math.max(1, Math.max(a, b))) * edgeWeight;
      weightSum += edgeWeight;
      count += 1;
    }
  }
  if (count < 64 || weightSum <= 0) {
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

function getRgbDiagnostics(data) {
  let count = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumL = 0;
  let sumLSq = 0;
  const length = Math.floor((data && data.length ? data.length : 0) / 4) * 4;
  const step = Math.max(4, Math.floor(length / (4 * 220000)) * 4);
  for (let index = 0; index < length; index += step) {
    const alpha = Number(data[index + 3]) || 0;
    if (alpha <= 4) continue;
    const r = Number(data[index]) || 0;
    const g = Number(data[index + 1]) || 0;
    const b = Number(data[index + 2]) || 0;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sumR += r;
    sumG += g;
    sumB += b;
    sumL += luma;
    sumLSq += luma * luma;
    count += 1;
  }
  if (!count) return { count: 0, meanR: 0, meanG: 0, meanB: 0, meanLuma: 0, varianceLuma: 0, stdLuma: 0 };
  const meanLuma = sumL / count;
  const varianceLuma = Math.max(0, sumLSq / count - meanLuma * meanLuma);
  return {
    count,
    meanR: sumR / count,
    meanG: sumG / count,
    meanB: sumB / count,
    meanLuma,
    varianceLuma,
    stdLuma: Math.sqrt(varianceLuma)
  };
}

function getBorderBlackRatio(data, width, height) {
  const border = Math.max(1, Math.round(Math.min(width, height) * 0.025));
  let count = 0;
  let black = 0;
  for (let y = 0; y < height; y += 1) {
    const inBorderY = y < border || y >= height - border;
    for (let x = 0; x < width; x += 1) {
      if (!inBorderY && x >= border && x < width - border) continue;
      const index = (y * width + x) * 4;
      const alpha = Number(data[index + 3]) || 0;
      if (alpha <= 4) continue;
      const luma = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
      count += 1;
      if (luma <= 3) black += 1;
    }
  }
  return count ? black / count : 0;
}

function getRepeatedPatternScore(data, width, height) {
  const periods = [
    { dx: Math.floor(width / 2), dy: 0 },
    { dx: Math.floor(width / 3), dy: 0 },
    { dx: 0, dy: Math.floor(height / 2) }
  ].filter((period) => Math.abs(period.dx) >= 8 || Math.abs(period.dy) >= 8);
  let best = 0;
  const step = Math.max(1, Math.floor(Math.max(width, height) / 180));
  periods.forEach((period) => {
    let diffSum = 0;
    let count = 0;
    const maxY = period.dy ? height - period.dy : height;
    const maxX = period.dx ? width - period.dx : width;
    for (let y = 0; y < maxY; y += step) {
      for (let x = 0; x < maxX; x += step) {
        const a = (y * width + x) * 4;
        const b = ((y + period.dy) * width + x + period.dx) * 4;
        const alphaA = Number(data[a + 3]) || 0;
        const alphaB = Number(data[b + 3]) || 0;
        if (alphaA <= 32 || alphaB <= 32) continue;
        diffSum += (
          Math.abs(data[a] - data[b]) +
          Math.abs(data[a + 1] - data[b + 1]) +
          Math.abs(data[a + 2] - data[b + 2])
        ) / 3;
        count += 1;
      }
    }
    if (count >= 64) {
      const meanDiff = diffSum / count;
      best = Math.max(best, 1 - Math.min(1, meanDiff / 36));
    }
  });
  return Math.max(0, Math.min(1, best));
}

function meanGradientEnergy(field, mask = null) {
  const mag = field && field.mag;
  if (!mag || !mag.length) return 0;
  let sum = 0;
  let weight = 0;
  const step = Math.max(1, Math.floor(mag.length / 260000));
  for (let index = 0; index < mag.length; index += step) {
    const w = mask ? Number(mask[index]) || 0 : 1;
    if (w <= 0) continue;
    sum += mag[index] * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : 0;
}

function buildCaptureDiagnostics(sample) {
  const width = Math.max(1, Number(sample && sample.width) || 1);
  const height = Math.max(1, Number(sample && sample.height) || 1);
  const data = sample && sample.data ? sample.data : new Uint8Array();
  const alpha = getAlphaStats(data);
  const rgb = getRgbDiagnostics(data);
  const luma = buildLuma(data, width, height);
  const field = buildSobelField(luma, width, height);
  const gradientEnergy = meanGradientEnergy(field);
  const borderBlackRatio = getBorderBlackRatio(data, width, height);
  const repeatedPatternScore = getRepeatedPatternScore(data, width, height);
  const reasons = [];
  if (alpha.maxAlpha <= 4 || alpha.transparentRatio > 0.995) reasons.push("source-all-transparent");
  if (rgb.count <= 24) reasons.push("source-too-few-visible-pixels");
  if (rgb.meanLuma <= 2 && rgb.stdLuma <= 1.5) reasons.push("source-nearly-black");
  if (gradientEnergy <= 0.8 && rgb.stdLuma <= 2.5) reasons.push("source-low-texture");
  if (borderBlackRatio > 0.45 && alpha.transparentRatio < 0.05) reasons.push("source-black-border-suspicious");
  if (repeatedPatternScore > 0.975 && alpha.opaqueRatio > 0.35 && gradientEnergy < 3) reasons.push("source-repeated-pattern-suspicious");
  return {
    width,
    height,
    alpha,
    rgb,
    gradientEnergy,
    borderBlackRatio,
    repeatedPatternScore,
    suspicious: reasons.length > 0,
    reasons,
    field
  };
}

function buildAlignmentMask(sourceSample, referenceSample) {
  const width = Math.max(1, Number(sourceSample && sourceSample.width) || 1);
  const height = Math.max(1, Number(sourceSample && sourceSample.height) || 1);
  const sourceLuma = buildLuma(sourceSample.data, width, height);
  const referenceLuma = buildLuma(referenceSample.data, width, height);
  const sourceField = buildSobelField(sourceLuma, width, height);
  const referenceField = buildSobelField(referenceLuma, width, height);
  const length = width * height;
  const alpha = new Float32Array(length);
  const mask = new Float32Array(length);
  let edgeSum = 0;
  let alphaCount = 0;
  for (let pixel = 0, index = 3; pixel < length; pixel += 1, index += 4) {
    const a = Math.max(0, Math.min(1, (Number(sourceSample.data[index]) || 0) / 255));
    alpha[pixel] = a;
    if (a > 0.08) {
      edgeSum += Math.max(sourceField.mag[pixel], referenceField.mag[pixel]);
      alphaCount += 1;
    }
  }
  const meanEdge = alphaCount ? edgeSum / alphaCount : 0;
  const minEdge = Math.max(5, meanEdge * 0.7);
  const border = Math.max(1, Math.round(Math.min(width, height) * 0.012));
  let covered = 0;
  let totalWeight = 0;
  let edgeEnergy = 0;
  let diffEnergy = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (x <= border || y <= border || x >= width - border - 1 || y >= height - border - 1) continue;
      const pixel = y * width + x;
      const a = alpha[pixel];
      if (a <= 0.06) continue;
      const sourceIndex = pixel * 4;
      const diff = (
        Math.abs(sourceSample.data[sourceIndex] - referenceSample.data[sourceIndex]) +
        Math.abs(sourceSample.data[sourceIndex + 1] - referenceSample.data[sourceIndex + 1]) +
        Math.abs(sourceSample.data[sourceIndex + 2] - referenceSample.data[sourceIndex + 2])
      ) / 3;
      const edge = Math.max(sourceField.mag[pixel], referenceField.mag[pixel]);
      const alphaEdge = Math.max(
        Math.abs(alpha[pixel] - alpha[pixel - 1]),
        Math.abs(alpha[pixel] - alpha[pixel + 1]),
        Math.abs(alpha[pixel] - alpha[pixel - width]),
        Math.abs(alpha[pixel] - alpha[pixel + width])
      );
      if (edge < minEdge && diff < 10 && alphaEdge < 0.18) continue;
      const edgeWeight = Math.min(1.8, edge / Math.max(1, minEdge * 1.6));
      const diffWeight = Math.min(1.2, diff / 42);
      const alphaEdgeWeight = Math.min(1.4, alphaEdge * 3.2);
      const weight = a * (0.16 + edgeWeight * 0.62 + diffWeight * 0.24 + alphaEdgeWeight * 0.54);
      if (weight <= 0.04) continue;
      mask[pixel] = weight;
      covered += 1;
      totalWeight += weight;
      edgeEnergy += edge * weight;
      diffEnergy += diff * weight;
    }
  }
  return {
    width,
    height,
    mask,
    sourceField,
    referenceField,
    coverage: covered / Math.max(1, length),
    coveredPixels: covered,
    totalWeight,
    meanEdgeEnergy: totalWeight > 0 ? edgeEnergy / totalWeight : 0,
    meanDiffEnergy: totalWeight > 0 ? diffEnergy / totalWeight : 0,
    reason: covered < Math.max(128, length * 0.006) ? "roi-too-small" : "ok"
  };
}

function scoreMaskedOffset(sourceField, referenceField, mask, width, height, dx, dy, stride, region = null) {
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  let directionSum = 0;
  let overlapSum = 0;
  let weightSum = 0;
  let count = 0;
  const startX = Math.max(1, region ? Math.floor(region.left) : 1);
  const endX = Math.min(width - 1, region ? Math.ceil(region.right) : width - 1);
  const startY = Math.max(1, region ? Math.floor(region.top) : 1);
  const endY = Math.min(height - 1, region ? Math.ceil(region.bottom) : height - 1);
  const step = Math.max(1, Number(stride) || 1);
  for (let y = startY; y < endY; y += step) {
    const sourceY = y + dy;
    if (sourceY < 1 || sourceY >= height - 1) continue;
    for (let x = startX; x < endX; x += step) {
      const sourceX = x + dx;
      if (sourceX < 1 || sourceX >= width - 1) continue;
      const refIndex = y * width + x;
      const maskWeight = Number(mask && mask[refIndex]) || 0;
      if (maskWeight <= 0) continue;
      const a = sampleFloatBilinear(sourceField.mag, width, height, sourceX, sourceY);
      const b = referenceField.mag[refIndex];
      if (a < 3 && b < 3) continue;
      const edgeWeight = maskWeight * Math.min(2.8, Math.max(a, b) / 16) * (0.35 + Math.min(a, b) / Math.max(1, Math.max(a, b)) * 0.65);
      sumA += a * edgeWeight;
      sumB += b * edgeWeight;
      sumAA += a * a * edgeWeight;
      sumBB += b * b * edgeWeight;
      sumAB += a * b * edgeWeight;
      const sourceMag = Math.max(0.001, a);
      const refMag = Math.max(0.001, b);
      const sourceGx = sampleFloatBilinear(sourceField.gx, width, height, sourceX, sourceY);
      const sourceGy = sampleFloatBilinear(sourceField.gy, width, height, sourceX, sourceY);
      const cos = (
        sourceGx * referenceField.gx[refIndex] +
        sourceGy * referenceField.gy[refIndex]
      ) / Math.max(0.001, sourceMag * refMag);
      directionSum += Math.max(-1, Math.min(1, cos)) * edgeWeight;
      overlapSum += (Math.min(a, b) / Math.max(1, Math.max(a, b))) * edgeWeight;
      weightSum += edgeWeight;
      count += 1;
    }
  }
  if (count < 32 || weightSum <= 0) return { score: -1, ncc: -1, direction: 0, overlap: 0, count, weight: weightSum };
  const numerator = sumAB - (sumA * sumB) / weightSum;
  const denomA = sumAA - (sumA * sumA) / weightSum;
  const denomB = sumBB - (sumB * sumB) / weightSum;
  const denom = Math.sqrt(Math.max(0.0001, denomA * denomB));
  const ncc = numerator / denom;
  const direction = directionSum / weightSum;
  const overlap = overlapSum / weightSum;
  return {
    score: ncc * 0.62 + direction * 0.26 + overlap * 0.12,
    ncc,
    direction,
    overlap,
    count,
    weight: weightSum
  };
}

function estimateGlobalOffset(maskInfo, config) {
  const width = maskInfo.width;
  const height = maskInfo.height;
  const maxOffset = Math.max(1, Math.min(Math.floor(Math.min(width, height) * 0.45), Math.round(Number(config && config.sampleMaxOffset) || 8)));
  const stride = Math.max(1, Math.floor(Math.max(width, height) / 240));
  const coarseStep = getLargeOffsetStep(maxOffset);
  const coarseStride = Math.max(1, Math.floor(stride * (coarseStep >= 6 ? 1.65 : coarseStep >= 4 ? 1.35 : 1)));
  let best = { dx: 0, dy: 0, score: -1, ncc: -1, direction: 0, overlap: 0, count: 0 };
  let second = -1;
  const update = (dx, dy, activeStride) => {
    const scored = scoreMaskedOffset(maskInfo.sourceField, maskInfo.referenceField, maskInfo.mask, width, height, dx, dy, activeStride);
    if (scored.score > best.score) {
      second = best.score;
      best = { dx, dy, ...scored };
    } else if (scored.score > second) {
      second = scored.score;
    }
  };
  const searchGrid = (step, centerDx = 0, centerDy = 0, radius = null, activeStride = stride) => {
    const dxValues = buildOffsetCandidates(maxOffset, step, centerDx, radius);
    const dyValues = buildOffsetCandidates(maxOffset, step, centerDy, radius);
    dyValues.forEach((dy) => {
      dxValues.forEach((dx) => {
        update(dx, dy, activeStride);
      });
    });
  };
  searchGrid(coarseStep, 0, 0, null, coarseStride);
  if (coarseStep > 1) {
    const refineRadius = Math.min(maxOffset, Math.max(3, coarseStep * 2));
    searchGrid(Math.max(1, Math.floor(coarseStep / 2)), best.dx, best.dy, refineRadius, stride);
    searchGrid(1, best.dx, best.dy, Math.min(maxOffset, 2), stride);
  } else {
    for (let dy = -maxOffset; dy <= maxOffset; dy += 1) {
      for (let dx = -maxOffset; dx <= maxOffset; dx += 1) {
        update(dx, dy, stride);
      }
    }
  }
  const refine = [];
  for (let dy = best.dy - 1; dy <= best.dy + 1.001; dy += 0.5) {
    for (let dx = best.dx - 1; dx <= best.dx + 1.001; dx += 0.5) {
      if (Math.abs(dx) > maxOffset || Math.abs(dy) > maxOffset) continue;
      refine.push([Number(dx.toFixed(2)), Number(dy.toFixed(2))]);
    }
  }
  refine.forEach(([dx, dy]) => {
    const scored = scoreMaskedOffset(maskInfo.sourceField, maskInfo.referenceField, maskInfo.mask, width, height, dx, dy, Math.max(1, Math.floor(stride * 0.75)));
    if (scored.score > best.score) {
      second = Math.max(second, best.score);
      best = { dx, dy, ...scored };
    } else if (scored.score > second && (Math.abs(dx - best.dx) > 0.001 || Math.abs(dy - best.dy) > 0.001)) {
      second = scored.score;
    }
  });
  const scoreGap = best.score - Math.max(-1, second);
  const reliable = best.count >= 80 && best.score > 0.12 && scoreGap > 0.004;
  return {
    ...best,
    maxOffset,
    stride,
    coarseStep,
    scoreGap,
    reliable,
    reason: reliable ? "global-gradient-roi" : best.count < 80 ? "insufficient-roi-samples" : best.score <= 0.12 ? "low-global-score" : "ambiguous-global-offset"
  };
}

function regionMaskStats(maskInfo, region, stride) {
  const width = maskInfo.width;
  const height = maskInfo.height;
  let covered = 0;
  let total = 0;
  let weight = 0;
  let edge = 0;
  const step = Math.max(1, Number(stride) || 1);
  for (let y = Math.max(1, Math.floor(region.top)); y < Math.min(height - 1, Math.ceil(region.bottom)); y += step) {
    for (let x = Math.max(1, Math.floor(region.left)); x < Math.min(width - 1, Math.ceil(region.right)); x += step) {
      const index = y * width + x;
      const w = Number(maskInfo.mask[index]) || 0;
      total += 1;
      if (w > 0) {
        covered += 1;
        weight += w;
        edge += Math.max(maskInfo.sourceField.mag[index], maskInfo.referenceField.mag[index]) * w;
      }
    }
  }
  return {
    coverage: total ? covered / total : 0,
    weight,
    edgeEnergy: weight > 0 ? edge / weight : 0
  };
}

function estimateTileMotion(maskInfo, globalMotion, config) {
  const width = maskInfo.width;
  const height = maskInfo.height;
  const shortEdge = Math.min(width, height);
  const cols = shortEdge < 260 ? 5 : 7;
  const rows = shortEdge < 260 ? 4 : 5;
  const totalTiles = cols * rows;
  const searchOffset = Math.max(1, Math.min(12, Math.round(Number(config && config.sampleMaxOffset) || Number(globalMotion && globalMotion.maxOffset) || 8)));
  const stride = Math.max(1, Math.floor(Math.max(width, height) / 260));
  const tiles = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const tileWidth = width / cols;
      const tileHeight = height / rows;
      const region = {
        left: Math.max(1, Math.floor(col * tileWidth - tileWidth * 0.18)),
        right: Math.min(width - 1, Math.ceil((col + 1) * tileWidth + tileWidth * 0.18)),
        top: Math.max(1, Math.floor(row * tileHeight - tileHeight * 0.18)),
        bottom: Math.min(height - 1, Math.ceil((row + 1) * tileHeight + tileHeight * 0.18))
      };
      const stats = regionMaskStats(maskInfo, region, Math.max(1, stride));
      if (stats.coverage < 0.018 || stats.edgeEnergy < 5 || stats.weight < 8) continue;
      let best = { dx: 0, dy: 0, score: -1, ncc: -1, direction: 0, overlap: 0, count: 0 };
      let second = -1;
      for (let dy = -searchOffset; dy <= searchOffset; dy += 1) {
        for (let dx = -searchOffset; dx <= searchOffset; dx += 1) {
          const scored = scoreMaskedOffset(maskInfo.sourceField, maskInfo.referenceField, maskInfo.mask, width, height, dx, dy, stride, region);
          const score = scored.score;
          if (score > best.score) {
            second = best.score;
            best = { dx, dy, ...scored };
          } else if (score > second) {
            second = score;
          }
        }
      }
      const scoreGap = best.score - Math.max(-1, second);
      const displacement = Math.hypot(best.dx, best.dy);
      if (best.score > 0.14 && best.direction > 0.08 && best.count >= 24 && (scoreGap > 0.004 || displacement >= 0.75)) {
        tiles.push({
          row,
          col,
          x: (region.left + region.right) / 2,
          y: (region.top + region.bottom) / 2,
          dx: best.dx,
          dy: best.dy,
          score: best.score,
          ncc: best.ncc,
          direction: best.direction,
          overlap: best.overlap,
          count: best.count,
          scoreGap,
          coverage: stats.coverage,
          edgeEnergy: stats.edgeEnergy,
          weight: Math.max(0.1, best.score) * Math.max(1, stats.weight)
        });
      }
    }
  }
  const validTiles = tiles.length;
  const meanDx = validTiles ? tiles.reduce((sum, tile) => sum + tile.dx, 0) / validTiles : 0;
  const meanDy = validTiles ? tiles.reduce((sum, tile) => sum + tile.dy, 0) / validTiles : 0;
  const meanDistance = validTiles ? tiles.reduce((sum, tile) => sum + Math.hypot(tile.dx, tile.dy), 0) / validTiles : 0;
  const maxDistance = validTiles ? tiles.reduce((max, tile) => Math.max(max, Math.hypot(tile.dx, tile.dy)), 0) : 0;
  const spread = validTiles ? tiles.reduce((sum, tile) => sum + Math.hypot(tile.dx - meanDx, tile.dy - meanDy), 0) / validTiles : 0;
  const coverage = validTiles / Math.max(1, totalTiles);
  const reliable = validTiles >= Math.max(4, Math.round(totalTiles * 0.22)) && maxDistance <= searchOffset + 0.25 && (meanDistance >= 0.25 || spread >= 0.22);
  return {
    enabled: true,
    rows,
    cols,
    totalTiles,
    validTiles,
    coverage,
    meanDx,
    meanDy,
    meanDistance,
    maxDistance,
    spread,
    reliable,
    reason: reliable ? "tile-gradient-roi" : validTiles < Math.max(4, Math.round(totalTiles * 0.22)) ? "low-tile-coverage" : "low-local-motion",
    tiles
  };
}

function solve3x3(matrix, vector) {
  const a = matrix.map((row, index) => row.concat([vector[index]]));
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-8) return null;
    if (pivot !== col) {
      const temp = a[col];
      a[col] = a[pivot];
      a[pivot] = temp;
    }
    const divisor = a[col][col];
    for (let item = col; item < 4; item += 1) a[col][item] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let item = col; item < 4; item += 1) a[row][item] -= factor * a[col][item];
    }
  }
  return [a[0][3], a[1][3], a[2][3]];
}

function fitQuadraticDy(tiles, width, globalMotion) {
  const matrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  const vector = [0, 0, 0];
  const add = (xNorm, dy, weight) => {
    const basis = [1, xNorm, xNorm * xNorm];
    for (let row = 0; row < 3; row += 1) {
      vector[row] += basis[row] * dy * weight;
      for (let col = 0; col < 3; col += 1) matrix[row][col] += basis[row] * basis[col] * weight;
    }
  };
  tiles.forEach((tile) => {
    const xNorm = ((Number(tile.x) || 0) / Math.max(1, width - 1)) * 2 - 1;
    add(xNorm, Number(tile.dy) || 0, Math.max(0.1, Number(tile.weight) || 1));
  });
  add(0, Number(globalMotion && globalMotion.dy) || 0, Math.max(3, tiles.length * 0.38));
  const solved = solve3x3(matrix, vector);
  return solved || [Number(globalMotion && globalMotion.dy) || 0, 0, 0];
}

function weightedMedian(items, fallback = 0) {
  const values = items
    .map((item) => ({ value: Number(item.value), weight: Math.max(0.001, Number(item.weight) || 1) }))
    .filter((item) => Number.isFinite(item.value) && item.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (!values.length) return fallback;
  const total = values.reduce((sum, item) => sum + item.weight, 0);
  let acc = 0;
  for (const item of values) {
    acc += item.weight;
    if (acc >= total * 0.5) return item.value;
  }
  return values[values.length - 1].value;
}

function fitPiecewiseVerticalControls(tiles, width, globalMotion, maxOffset) {
  const globalDy = Number(globalMotion && globalMotion.dy) || 0;
  const bands = [
    { x: 0, xNorm: -1, min: -1.01, max: -0.18 },
    { x: Math.max(0, (width - 1) * 0.5), xNorm: 0, min: -0.42, max: 0.42 },
    { x: Math.max(0, width - 1), xNorm: 1, min: 0.18, max: 1.01 }
  ];
  const controls = bands.map((band) => {
    const bandTiles = tiles.filter((tile) => {
      const xNorm = ((Number(tile.x) || 0) / Math.max(1, width - 1)) * 2 - 1;
      return xNorm >= band.min && xNorm <= band.max;
    });
    const values = bandTiles.map((tile) => ({
      value: Number(tile.dy) || 0,
      weight: Math.max(0.1, Number(tile.weight) || 1) * (0.65 + Math.min(2.5, Math.hypot(Number(tile.dx) || 0, Number(tile.dy) || 0)) * 0.18)
    }));
    if (Math.abs(band.xNorm) < 0.001) {
      values.push({ value: globalDy, weight: Math.max(1.4, bandTiles.length * 0.18) });
    }
    const dy = weightedMedian(values, globalDy);
    return {
      x: band.x,
      xNorm: band.xNorm,
      dy: Math.max(-maxOffset, Math.min(maxOffset, dy)),
      count: bandTiles.length
    };
  });

  if (controls[1].count <= 0) {
    controls[1].dy = Math.max(-maxOffset, Math.min(maxOffset, globalDy));
  }
  return controls;
}

function fitVerticalWarpModel(maskInfo, globalMotion, tileMotion, config) {
  const maxOffset = Math.max(1, Math.min(Math.floor(Math.min(maskInfo.width, maskInfo.height) * 0.45), Number(config && config.sampleMaxOffset) || Number(globalMotion && globalMotion.maxOffset) || 8));
  const tiles = tileMotion && tileMotion.reliable ? tileMotion.tiles : [];
  const useTiles = tiles.length >= Math.max(4, Math.round((tileMotion && tileMotion.totalTiles || 1) * 0.22));
  const dxValues = useTiles ? tiles : [];
  let dx = Number(globalMotion && globalMotion.dx) || 0;
  if (dxValues.length) {
    const totalWeight = dxValues.reduce((sum, tile) => sum + Math.max(0.1, Number(tile.weight) || 1), 0);
    const tileDx = dxValues.reduce((sum, tile) => sum + (Number(tile.dx) || 0) * Math.max(0.1, Number(tile.weight) || 1), 0) / Math.max(0.1, totalWeight);
    dx = dx * 0.45 + tileDx * 0.55;
  }
  dx = Math.max(-maxOffset, Math.min(maxOffset, dx));
  const usePiecewise = useTiles && ((Number(tileMotion && tileMotion.maxDistance) || 0) >= 1.15 || (Number(tileMotion && tileMotion.spread) || 0) >= 0.65);
  const controls = usePiecewise ? fitPiecewiseVerticalControls(tiles, maskInfo.width, globalMotion, maxOffset) : null;
  const coefficients = !usePiecewise && useTiles
    ? fitQuadraticDy(tiles, maskInfo.width, globalMotion)
    : [Number(globalMotion && globalMotion.dy) || 0, 0, 0];
  const limited = coefficients.map((value) => Math.max(-maxOffset, Math.min(maxOffset, Number(value) || 0)));
  const model = {
    type: usePiecewise ? "piecewise-y-by-x" : useTiles ? "quadratic-y-by-x" : "global-translation",
    dx,
    dyCoefficients: limited,
    yControls: controls,
    maxOffset,
    sourceWidth: maskInfo.width,
    sourceHeight: maskInfo.height,
    validTiles: tileMotion ? tileMotion.validTiles : 0,
    totalTiles: tileMotion ? tileMotion.totalTiles : 0,
    global: globalMotion,
    tileMotion
  };
  model.maxDisplacement = getModelMaxDisplacement(model);
  model.smoothness = getModelSmoothness(model);
  model.reliable = Boolean((globalMotion && globalMotion.reliable) || useTiles) && model.maxDisplacement <= maxOffset + 0.1 && model.smoothness <= Math.max(2.5, maxOffset * 0.7);
  model.reason = model.reliable ? model.type : model.maxDisplacement > maxOffset + 0.1 ? "motion-exceeds-limit" : "unreliable-motion";
  return model;
}

function getModelDyAt(model, x) {
  const width = Math.max(1, Number(model && model.sourceWidth) || 1);
  if (model && model.type === "piecewise-y-by-x" && Array.isArray(model.yControls) && model.yControls.length >= 2) {
    const controls = model.yControls.slice().sort((a, b) => Number(a.x) - Number(b.x));
    const sx = Math.max(0, Math.min(width - 1, x));
    if (sx <= Number(controls[0].x)) return Number(controls[0].dy) || 0;
    for (let index = 0; index < controls.length - 1; index += 1) {
      const left = controls[index];
      const right = controls[index + 1];
      const lx = Number(left.x) || 0;
      const rx = Number(right.x) || lx + 1;
      if (sx <= rx || index === controls.length - 2) {
        const t = Math.max(0, Math.min(1, (sx - lx) / Math.max(1, rx - lx)));
        return (Number(left.dy) || 0) * (1 - t) + (Number(right.dy) || 0) * t;
      }
    }
    return Number(controls[controls.length - 1].dy) || 0;
  }
  const xNorm = (Math.max(0, Math.min(width - 1, x)) / Math.max(1, width - 1)) * 2 - 1;
  const c = model && model.dyCoefficients ? model.dyCoefficients : [0, 0, 0];
  return (Number(c[0]) || 0) + (Number(c[1]) || 0) * xNorm + (Number(c[2]) || 0) * xNorm * xNorm;
}

function getModelDisplacement(model, x, y) {
  return {
    dx: Number(model && model.dx) || 0,
    dy: getModelDyAt(model, x, y)
  };
}

function getModelMaxDisplacement(model) {
  const width = Math.max(1, Number(model && model.sourceWidth) || 1);
  const samples = [0, width * 0.25, width * 0.5, width * 0.75, width - 1];
  return samples.reduce((max, x) => {
    const flow = getModelDisplacement(model, x, 0);
    return Math.max(max, Math.hypot(flow.dx, flow.dy));
  }, 0);
}

function getModelSmoothness(model) {
  const width = Math.max(1, Number(model && model.sourceWidth) || 1);
  let previous = getModelDyAt(model, 0);
  let maxDelta = 0;
  for (let i = 1; i <= 12; i += 1) {
    const dy = getModelDyAt(model, (width - 1) * (i / 12));
    maxDelta = Math.max(maxDelta, Math.abs(dy - previous));
    previous = dy;
  }
  return maxDelta;
}

function scoreDisplacementModel(maskInfo, model, stride) {
  const width = maskInfo.width;
  const height = maskInfo.height;
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  let directionSum = 0;
  let overlapSum = 0;
  let weightSum = 0;
  let count = 0;
  const step = Math.max(1, Number(stride) || 1);
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const refIndex = y * width + x;
      const maskWeight = Number(maskInfo.mask[refIndex]) || 0;
      if (maskWeight <= 0) continue;
      const flow = model ? getModelDisplacement(model, x, y) : { dx: 0, dy: 0 };
      const sourceX = x + flow.dx;
      const sourceY = y + flow.dy;
      if (sourceX < 1 || sourceX >= width - 1 || sourceY < 1 || sourceY >= height - 1) continue;
      const a = sampleFloatBilinear(maskInfo.sourceField.mag, width, height, sourceX, sourceY);
      const b = maskInfo.referenceField.mag[refIndex];
      if (a < 3 && b < 3) continue;
      const edgeWeight = maskWeight * Math.min(2.8, Math.max(a, b) / 16);
      sumA += a * edgeWeight;
      sumB += b * edgeWeight;
      sumAA += a * a * edgeWeight;
      sumBB += b * b * edgeWeight;
      sumAB += a * b * edgeWeight;
      const sourceMag = Math.max(0.001, a);
      const refMag = Math.max(0.001, b);
      const sourceGx = sampleFloatBilinear(maskInfo.sourceField.gx, width, height, sourceX, sourceY);
      const sourceGy = sampleFloatBilinear(maskInfo.sourceField.gy, width, height, sourceX, sourceY);
      const cos = (
        sourceGx * maskInfo.referenceField.gx[refIndex] +
        sourceGy * maskInfo.referenceField.gy[refIndex]
      ) / Math.max(0.001, sourceMag * refMag);
      directionSum += Math.max(-1, Math.min(1, cos)) * edgeWeight;
      overlapSum += (Math.min(a, b) / Math.max(1, Math.max(a, b))) * edgeWeight;
      weightSum += edgeWeight;
      count += 1;
    }
  }
  if (count < 48 || weightSum <= 0) return { score: -1, ncc: -1, direction: 0, overlap: 0, count };
  const numerator = sumAB - (sumA * sumB) / weightSum;
  const denomA = sumAA - (sumA * sumA) / weightSum;
  const denomB = sumBB - (sumB * sumB) / weightSum;
  const denom = Math.sqrt(Math.max(0.0001, denomA * denomB));
  const ncc = numerator / denom;
  const direction = directionSum / weightSum;
  const overlap = overlapSum / weightSum;
  return {
    score: ncc * 0.62 + direction * 0.26 + overlap * 0.12,
    ncc,
    direction,
    overlap,
    count
  };
}

function validateWarpImprovement(maskInfo, model) {
  if (!model || !model.reliable) {
    return { applied: false, reason: model && model.reason ? model.reason : "unreliable-motion", before: null, after: null, improvement: 0 };
  }
  const stride = Math.max(1, Math.floor(Math.max(maskInfo.width, maskInfo.height) / 300));
  const before = scoreDisplacementModel(maskInfo, null, stride);
  const after = scoreDisplacementModel(maskInfo, model, stride);
  const improvement = after.score - before.score;
  const enoughTiles = (model.type !== "quadratic-y-by-x" && model.type !== "piecewise-y-by-x") || model.validTiles >= Math.max(4, Math.round(model.totalTiles * 0.22));
  if (before.count < 64 || after.count < 64) return { applied: false, reason: "insufficient-validation-samples", before, after, improvement };
  if (!enoughTiles) return { applied: false, reason: "unreliable-motion", before, after, improvement };
  if (model.maxDisplacement > model.maxOffset + 0.1) return { applied: false, reason: "motion-exceeds-limit", before, after, improvement };
  if (model.smoothness > Math.max(2.5, model.maxOffset * 0.7)) return { applied: false, reason: "warp-not-smooth", before, after, improvement };
  if (improvement < 0.012 || after.score < before.score * 1.01) return { applied: false, reason: "score-improvement-too-low", before, after, improvement };
  if (after.direction < Math.max(0.04, before.direction - 0.03)) return { applied: false, reason: "direction-agreement-regressed", before, after, improvement };
  return { applied: true, reason: "score-improved", before, after, improvement };
}

function sampleRgbaBilinearTransparent(data, width, height, x, y, out, offset) {
  if (x < 0 || x > width - 1 || y < 0 || y > height - 1) {
    out[offset] = 0;
    out[offset + 1] = 0;
    out[offset + 2] = 0;
    out[offset + 3] = 0;
    return;
  }
  sampleRgbaBilinear(data, width, height, x, y, out, offset);
}

function warpRgbaWithDisplacement(sourceSample, model, options = {}) {
  const width = Math.max(1, Number(sourceSample && sourceSample.width) || 1);
  const height = Math.max(1, Number(sourceSample && sourceSample.height) || 1);
  const out = new Uint8Array(width * height * 4);
  const clampEdges = options.clampEdges === true;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const flow = getModelDisplacement(model, x, y);
      if (clampEdges) {
        sampleRgbaBilinear(sourceSample.data, width, height, x + flow.dx, y + flow.dy, out, offset);
      } else {
        sampleRgbaBilinearTransparent(sourceSample.data, width, height, x + flow.dx, y + flow.dy, out, offset);
      }
    }
  }
  return {
    width,
    height,
    scaleX: sourceSample.scaleX,
    scaleY: sourceSample.scaleY,
    data: out,
    model
  };
}

function buildPixelAlignmentV2(sourceSample, referenceSample, config) {
  if (!sourceSample || !referenceSample || !sourceSample.data || !referenceSample.data) {
    return { applied: false, reason: "missing-samples" };
  }
  if (sourceSample.width !== referenceSample.width || sourceSample.height !== referenceSample.height) {
    return { applied: false, reason: "sample-size-mismatch" };
  }
  const scale = Math.max(Number(sourceSample.scaleX) || 1, Number(sourceSample.scaleY) || 1);
  const sampleMaxOffset = Math.max(1, Math.min(Math.floor(Math.min(sourceSample.width, sourceSample.height) * 0.45), Math.round((Number(config.alignmentMaxOffset) || DEFAULT_BLEND_MATCH_CONFIG.alignmentMaxOffset) / scale)));
  const maskInfo = buildAlignmentMask(sourceSample, referenceSample);
  if (maskInfo.reason !== "ok") {
    return { applied: false, reason: maskInfo.reason, mask: maskInfo };
  }
  const globalMotion = estimateGlobalOffset(maskInfo, { ...config, sampleMaxOffset });
  const tileMotion = estimateTileMotion(maskInfo, globalMotion, { ...config, sampleMaxOffset });
  const model = fitVerticalWarpModel(maskInfo, globalMotion, tileMotion, { ...config, sampleMaxOffset });
  const validation = validateWarpImprovement(maskInfo, model);
  if (!validation.applied) {
    return { applied: false, reason: validation.reason, mask: maskInfo, globalMotion, tileMotion, model, validation };
  }
  return {
    applied: true,
    reason: "pixel-align-v2",
    mask: maskInfo,
    globalMotion,
    tileMotion,
    model,
    validation
  };
}

function scaleDisplacementModel(model, fromSample, toSample) {
  const fromWidth = Math.max(1, Number(fromSample && fromSample.width) || Number(model && model.sourceWidth) || 1);
  const fromHeight = Math.max(1, Number(fromSample && fromSample.height) || Number(model && model.sourceHeight) || 1);
  const toWidth = Math.max(1, Number(toSample && toSample.width) || fromWidth);
  const toHeight = Math.max(1, Number(toSample && toSample.height) || fromHeight);
  const scaleX = toWidth / fromWidth;
  const scaleY = toHeight / fromHeight;
  const scaled = {
    ...model,
    dx: (Number(model && model.dx) || 0) * scaleX,
    dyCoefficients: Array.isArray(model && model.dyCoefficients)
      ? model.dyCoefficients.map((value) => (Number(value) || 0) * scaleY)
      : [0, 0, 0],
    yControls: Array.isArray(model && model.yControls)
      ? model.yControls.map((control) => ({
          ...control,
          x: (Number(control.x) || 0) * scaleX,
          dy: (Number(control.dy) || 0) * scaleY
        }))
      : null,
    maxOffset: (Number(model && model.maxOffset) || 0) * Math.max(scaleX, scaleY),
    sourceWidth: toWidth,
    sourceHeight: toHeight
  };
  scaled.maxDisplacement = getModelMaxDisplacement(scaled);
  scaled.smoothness = getModelSmoothness(scaled);
  return scaled;
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

function buildOffsetCandidates(maxOffset, step = 1, center = 0, radius = null) {
  const max = Math.max(0, Number(maxOffset) || 0);
  const stride = Math.max(1, Math.round(Number(step) || 1));
  const origin = Math.max(-max, Math.min(max, Math.round(Number(center) || 0)));
  const searchRadius = radius === null || radius === undefined
    ? max
    : Math.max(0, Math.min(max, Number(radius) || 0));
  const start = Math.max(-max, Math.round(origin - searchRadius));
  const end = Math.min(max, Math.round(origin + searchRadius));
  const values = [];
  for (let value = start; value <= end; value += stride) {
    values.push(Math.round(value));
  }
  values.push(start, origin, end);
  if (radius === null || radius === undefined) {
    values.push(-max, 0, max);
  }
  return Array.from(new Set(values)).sort((a, b) => {
    const da = Math.abs(a - origin);
    const db = Math.abs(b - origin);
    return da === db ? Math.abs(a) - Math.abs(b) : da - db;
  });
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

function refineTranslationAlignment(sourceGrad, refGrad, width, height, base, baseSecondScore, sampleOffset, stride) {
  const offsetWindow = Math.max(1, Math.min(2, Math.round(sampleOffset / 5)));
  const refineStride = Math.max(1, stride);
  const baseDx = Number(base && base.dx) || 0;
  const baseDy = Number(base && base.dy) || 0;
  let best = {
    dx: baseDx,
    dy: baseDy,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    score: Number(base && base.score) || -1
  };
  let second = Number(baseSecondScore) || -1;
  for (let dy = baseDy - offsetWindow; dy <= baseDy + offsetWindow; dy += 1) {
    for (let dx = baseDx - offsetWindow; dx <= baseDx + offsetWindow; dx += 1) {
      const score = scoreAffineTransform(sourceGrad, refGrad, width, height, { dx, dy, scaleX: 1, scaleY: 1, rotation: 0 }, refineStride);
      if (score > best.score) {
        second = best.score;
        best = { dx, dy, scaleX: 1, scaleY: 1, rotation: 0, score };
      } else if (score > second) {
        second = score;
      }
    }
  }
  return {
    ...best,
    secondScore: second
  };
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

function selectConservativeAlignmentModel(translationBest, affineBest) {
  const safeTranslation = translationBest && Number.isFinite(Number(translationBest.score))
    ? translationBest
    : { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0, score: -1, secondScore: -1 };
  const safeAffine = affineBest && Number.isFinite(Number(affineBest.score))
    ? affineBest
    : safeTranslation;
  const scaleDelta = Math.max(Math.abs((Number(safeAffine.scaleX) || 1) - 1), Math.abs((Number(safeAffine.scaleY) || 1) - 1));
  const stretchDelta = Math.abs((Number(safeAffine.scaleX) || 1) - (Number(safeAffine.scaleY) || 1));
  const rotationDelta = Math.abs(Number(safeAffine.rotation) || 0);
  const affineComplexity = scaleDelta * 100 + stretchDelta * 80 + rotationDelta * 0.55;
  const affineGain = Number(safeAffine.score) - Number(safeTranslation.score);
  const translationIsUsable = Number(safeTranslation.score) >= 0.18;
  const minAffineGain = translationIsUsable
    ? 0.012 + Math.min(0.028, affineComplexity * 0.006)
    : 0.006;
  const affineHasMeaningfulTransform =
    scaleDelta >= 0.0012 ||
    stretchDelta >= 0.001 ||
    rotationDelta >= 0.035;
  const preferTranslation =
    translationIsUsable &&
    affineHasMeaningfulTransform &&
    affineGain < minAffineGain;
  return {
    best: preferTranslation ? safeTranslation : safeAffine,
    rejectedAffine: preferTranslation,
    reason: preferTranslation ? "translation-preferred-over-weak-affine" : "affine-accepted",
    translationScore: Number(safeTranslation.score) || -1,
    affineScore: Number(safeAffine.score) || -1,
    affineGain,
    minAffineGain,
    scaleDelta,
    stretchDelta,
    rotationDelta,
    affineComplexity
  };
}

function getLargeOffsetStep(sampleOffset) {
  const max = Math.max(1, Number(sampleOffset) || 1);
  if (max > 96) return 8;
  if (max > 48) return 6;
  if (max > 28) return 4;
  if (max > 16) return 2;
  return 1;
}

function searchGlobalAlignment(sourceGrad, refGrad, width, height, sampleOffset, scaleCandidates, stride) {
  const coarseStep = getLargeOffsetStep(sampleOffset);
  const coarseStride = Math.max(1, Math.floor((Number(stride) || 1) * (coarseStep >= 6 ? 1.65 : coarseStep >= 4 ? 1.35 : 1)));
  let best = { dx: 0, dy: 0, scale: 1, score: -1 };
  let second = -1;
  let translationBase = { dx: 0, dy: 0, scale: 1, score: -1 };
  let translationSecond = -1;
  const update = (dx, dy, scale, score) => {
    if (Math.abs(scale - 1) < 0.000001) {
      if (score > translationBase.score) {
        translationSecond = translationBase.score;
        translationBase = { dx, dy, scale: 1, score };
      } else if (score > translationSecond) {
        translationSecond = score;
      }
    }
    if (score > best.score) {
      second = best.score;
      best = { dx, dy, scale, score };
    } else if (score > second) {
      second = score;
    }
  };
  const runGrid = (maxOffset, step, centerDx, centerDy, activeStride, radius = null) => {
    const dxValues = buildOffsetCandidates(maxOffset, step, centerDx, radius);
    const dyValues = buildOffsetCandidates(maxOffset, step, centerDy, radius);
    scaleCandidates.forEach((scale) => {
      dyValues.forEach((dy) => {
        dxValues.forEach((dx) => {
          const score = scoreTransform(sourceGrad, refGrad, width, height, dx, dy, scale, activeStride);
          update(dx, dy, scale, score);
        });
      });
    });
  };
  runGrid(sampleOffset, coarseStep, 0, 0, coarseStride);
  if (coarseStep > 1) {
    const refineRadius = Math.min(sampleOffset, Math.max(3, coarseStep * 2));
    runGrid(sampleOffset, Math.max(1, Math.floor(coarseStep / 2)), best.dx, best.dy, Math.max(1, stride), refineRadius);
    runGrid(sampleOffset, 1, best.dx, best.dy, Math.max(1, stride), Math.min(sampleOffset, 2));
  }
  return {
    best,
    second,
    translationBase,
    translationSecond,
    coarseStep,
    coarseStride
  };
}

function normalizeGpuAlignmentSeedCandidate(candidate, fallbackStage = "gpu-seed") {
  if (!candidate || typeof candidate !== "object") return null;
  const dx = readFiniteNumber(candidate.sampleDx ?? candidate.rawSampleDx ?? candidate.dx);
  const dy = readFiniteNumber(candidate.sampleDy ?? candidate.rawSampleDy ?? candidate.dy);
  const scale = readFiniteNumber(candidate.scale ?? candidate.sampleScale ?? candidate.rawSampleScaleX ?? candidate.sampleScaleX, 1);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(scale)) return null;
  return {
    dx,
    dy,
    scale: Math.max(0.92, Math.min(1.08, scale)),
    score: readOptionalNumber(candidate.score),
    secondScore: readOptionalNumber(candidate.secondScore),
    scoreGap: readOptionalNumber(candidate.scoreGap),
    sampleCount: Math.max(0, Math.round(readFiniteNumber(candidate.sampleCount))),
    directionAgreement: readOptionalNumber(candidate.directionAgreement),
    edgeOverlap: readOptionalNumber(candidate.edgeOverlap),
    stage: String(candidate.stage || fallbackStage || "gpu-seed")
  };
}

function normalizeGpuGlobalValidationSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  const best = summary.best && typeof summary.best === "object"
    ? normalizeGpuAlignmentSeedCandidate(summary.best, "gpu-validation-best")
    : null;
  const topK = Array.isArray(summary.topK || summary.topCandidates)
    ? (summary.topK || summary.topCandidates).slice(0, 8).map((candidate) => normalizeGpuAlignmentSeedCandidate(candidate, "gpu-validation-top-k")).filter(Boolean)
    : [];
  const score = readOptionalNumber(summary.score ?? (best && best.score));
  const secondScore = readOptionalNumber(summary.secondScore ?? (best && best.secondScore));
  const rawScoreGap = readOptionalNumber(summary.scoreGap ?? (best && best.scoreGap));
  const scoreGap = rawScoreGap !== null
    ? rawScoreGap
    : score !== null ? score - Math.max(0, secondScore !== null ? secondScore : -1) : null;
  const sampleCount = Math.max(0, Math.round(readFiniteNumber(summary.sampleCount ?? (best && best.sampleCount))));
  const directionAgreement = readOptionalNumber(summary.directionAgreement ?? (best && best.directionAgreement));
  const edgeOverlap = readOptionalNumber(summary.edgeOverlap ?? (best && best.edgeOverlap));
  return {
    schemaVersion: Number(summary.schemaVersion) || 1,
    backend: String(summary.backend || "gpu-webgl2-global-v1"),
    compact: summary.compact !== false,
    score,
    secondScore,
    scoreGap,
    sampleCount,
    directionAgreement,
    edgeOverlap,
    scoreCalls: Math.max(0, Math.round(readFiniteNumber(summary.scoreCalls))),
    scoreReadback: String(summary.scoreReadback || "candidate-summary"),
    best,
    topK
  };
}

function evaluateGpuGlobalValidationEvidence(seedInfo, sampleOffset, width, height) {
  const summary = seedInfo && seedInfo.validationSummary ? seedInfo.validationSummary : null;
  if (!summary) {
    return { ok: false, reason: "gpu-validation-summary-missing", summary: null };
  }
  const minSamples = Math.max(96, Math.round((Math.max(32, Math.min(width, height)) / Math.max(1, Math.round(Math.max(width, height) / 180))) * 0.35));
  const score = Number(summary.score);
  const scoreGap = Number(summary.scoreGap);
  const sampleCount = Number(summary.sampleCount) || 0;
  const directionAgreement = summary.directionAgreement === null ? null : Number(summary.directionAgreement);
  const edgeOverlap = summary.edgeOverlap === null ? null : Number(summary.edgeOverlap);
  const topK = Array.isArray(summary.topK) ? summary.topK : [];
  const best = summary.best || topK[0] || null;
  const reasons = [];
  if (!best) reasons.push("gpu-validation-best-missing");
  if (!Number.isFinite(score) || score < 0.26) reasons.push("gpu-validation-score-weak");
  if (!Number.isFinite(scoreGap) || (scoreGap < 0.014 && !(Number.isFinite(score) && score >= 0.46))) reasons.push("gpu-validation-gap-weak");
  if (sampleCount < minSamples) reasons.push("gpu-validation-sample-count-low");
  if (directionAgreement !== null && Number.isFinite(directionAgreement) && directionAgreement < -0.08) reasons.push("gpu-validation-direction-disagree");
  if (edgeOverlap !== null && Number.isFinite(edgeOverlap) && edgeOverlap < 0.12 && !(Number.isFinite(score) && score >= 0.48)) reasons.push("gpu-validation-edge-overlap-low");
  if (best && (Math.abs(best.dx) > sampleOffset || Math.abs(best.dy) > sampleOffset || Math.abs((Number(best.scale) || 1) - 1) > 0.085)) {
    reasons.push("gpu-validation-transform-out-of-range");
  }
  return {
    ok: reasons.length === 0,
    reason: reasons[0] || "gpu-validation-strong",
    summary: {
      score: Number.isFinite(score) ? Number(score.toFixed(4)) : -1,
      secondScore: Number.isFinite(Number(summary.secondScore)) ? Number(Number(summary.secondScore).toFixed(4)) : -1,
      scoreGap: Number.isFinite(scoreGap) ? Number(scoreGap.toFixed(4)) : -1,
      sampleCount,
      minSamples,
      directionAgreement: directionAgreement !== null && Number.isFinite(directionAgreement) ? Number(directionAgreement.toFixed(4)) : null,
      edgeOverlap: edgeOverlap !== null && Number.isFinite(edgeOverlap) ? Number(edgeOverlap.toFixed(4)) : null,
      topK: topK.length,
      scoreReadback: summary.scoreReadback
    }
  };
}

function buildGpuCpuParityLog({ gpuSummary, cpuSpot, accepted, fallbackFullCpu, rejectReason }) {
  const gpuScore = Number(gpuSummary && gpuSummary.score);
  const gpuGap = Number(gpuSummary && gpuSummary.scoreGap);
  const cpuScore = Number(cpuSpot && cpuSpot.refinedScore);
  const cpuGap = Number(cpuSpot && cpuSpot.refinedGap);
  const dxDelta = Math.abs((Number(cpuSpot && cpuSpot.dx) || 0) - (Number(gpuSummary && gpuSummary.best && gpuSummary.best.dx) || 0));
  const dyDelta = Math.abs((Number(cpuSpot && cpuSpot.dy) || 0) - (Number(gpuSummary && gpuSummary.best && gpuSummary.best.dy) || 0));
  const scaleDelta = Math.abs((Number(cpuSpot && cpuSpot.scale) || 1) - (Number(gpuSummary && gpuSummary.best && gpuSummary.best.scale) || 1));
  const scoreDelta = Number.isFinite(gpuScore) && Number.isFinite(cpuScore) ? Math.abs(cpuScore - gpuScore) : null;
  const scoreGapDelta = Number.isFinite(gpuGap) && Number.isFinite(cpuGap) ? Math.abs(cpuGap - gpuGap) : null;
  const acceptParity = Boolean(accepted && !fallbackFullCpu);
  const verdict = acceptParity
    ? ((scoreDelta === null || scoreDelta <= 0.08) && dxDelta <= 2 && dyDelta <= 2 && scaleDelta <= 0.004 ? "parity-ok" : "parity-warn")
    : "parity-fallback";
  return {
    scoreDelta,
    scoreGapDelta,
    dxDelta,
    dyDelta,
    scaleDelta,
    acceptParity,
    verdict,
    rejectReason: rejectReason || ""
  };
}

function normalizeGpuAlignmentSeed(seed, sampleOffset, width = 0, height = 0) {
  if (!seed || typeof seed !== "object") {
    return {
      accepted: false,
      reason: "missing-gpu-seed",
      candidates: []
    };
  }
  if (String(seed.seedTrust || "") !== "hint-only") {
    return {
      accepted: false,
      reason: "seed-trust-not-hint-only",
      candidates: []
    };
  }
  const seedWidth = Number(seed.width) || 0;
  const seedHeight = Number(seed.height) || 0;
  if ((seedWidth > 0 && Number(width) > 0 && seedWidth !== Number(width)) || (seedHeight > 0 && Number(height) > 0 && seedHeight !== Number(height))) {
    return {
      accepted: false,
      reason: "seed-sample-size-mismatch",
      candidates: []
    };
  }
  if (seed.finalApplyEligible === true || seed.trusted === true) {
    return {
      accepted: false,
      reason: "seed-claims-final-eligibility",
      candidates: []
    };
  }
  const validation = seed.validation && typeof seed.validation === "object" ? seed.validation : null;
  const rejectReasons = Array.isArray(validation && validation.rejectReasons) ? validation.rejectReasons : [];
  const hardRejectReasons = rejectReasons.filter((reason) => reason !== "cpu-baseline-missing");
  if (validation && validation.verdict === "rejected" && hardRejectReasons.length) {
    return {
      accepted: false,
      reason: `seed-shadow-rejected:${hardRejectReasons[0]}`,
      candidates: []
    };
  }
  const search = seed.search && typeof seed.search === "object" ? seed.search : {};
  const validationSummary = normalizeGpuGlobalValidationSummary(search.globalValidation || seed.globalValidation || seed.validationSummary);
  const candidates = [];
  const addCandidate = (candidate, stage) => {
    const normalized = normalizeGpuAlignmentSeedCandidate(candidate, stage);
    if (!normalized) return;
    if (Math.abs(normalized.dx) > sampleOffset || Math.abs(normalized.dy) > sampleOffset) return;
    if (Math.abs(normalized.scale - 1) > 0.085) return;
    const key = `${Math.round(normalized.dx * 1000)}:${Math.round(normalized.dy * 1000)}:${Math.round(normalized.scale * 1000000)}`;
    if (candidates.some((item) => item.key === key)) return;
    candidates.push({ ...normalized, key });
  };
  addCandidate(search.refinedCandidate, "gpu-refined");
  if (seed.candidate) addCandidate(seed.candidate, "gpu-candidate");
  if (Array.isArray(search.topCandidates)) {
    search.topCandidates.slice(0, 8).forEach((candidate) => addCandidate(candidate, candidate && candidate.stage || "gpu-top-k"));
  }
  if (!candidates.length) {
    return {
      accepted: false,
      reason: "no-valid-gpu-seed-candidates",
      candidates: []
    };
  }
  return {
    accepted: true,
    reason: "seed-candidates-ready",
    candidates: candidates.map(({ key, ...candidate }) => candidate),
    validationSummary,
    metadata: {
      backend: String(seed.candidate && seed.candidate.backend || "gpu-webgl2-v1"),
      previewCacheKey: String(seed.previewCacheKey || ""),
      validationVerdict: String(seed.validation && seed.validation.verdict || ""),
      gpuScoreCalls: Number(search.scoreCalls) || 0,
      gpuReadyTotalMs: readOptionalNumber(seed.createdTotalMs)
    }
  };
}

function searchGlobalAlignmentWithSeed(sourceGrad, refGrad, width, height, sampleOffset, scaleCandidates, stride, gpuAlignmentSeed) {
  const seedInfo = normalizeGpuAlignmentSeed(gpuAlignmentSeed, sampleOffset, width, height);
  const fullCpu = () => {
    const startedAt = getNowMs();
    const search = searchGlobalAlignment(sourceGrad, refGrad, width, height, sampleOffset, scaleCandidates, stride);
    return {
      search,
      seedDiagnostics: {
        used: false,
        accepted: false,
        fallbackFullCpu: true,
        rejectReason: seedInfo.reason || "seed-not-usable",
        seedCandidates: seedInfo.candidates.length,
        fullCpuSearchMs: Number((getNowMs() - startedAt).toFixed(1))
      }
    };
  };
  if (!seedInfo.accepted) return fullCpu();
  const evidence = evaluateGpuGlobalValidationEvidence(seedInfo, sampleOffset, width, height);
  if (!evidence.ok) {
    const fallback = fullCpu();
    fallback.seedDiagnostics = {
      ...fallback.seedDiagnostics,
      used: true,
      accepted: false,
      rejectReason: evidence.reason,
      seedCandidates: seedInfo.candidates.length,
      gpuValidation: evidence.summary,
      parity: buildGpuCpuParityLog({
        gpuSummary: seedInfo.validationSummary,
        cpuSpot: null,
        accepted: false,
        fallbackFullCpu: true,
        rejectReason: evidence.reason
      })
    };
    return fallback;
  }

  const startedAt = getNowMs();
  const validationStride = Math.max(1, stride);
  const validated = [];
  seedInfo.candidates.forEach((candidate) => {
    const roundedDx = Math.max(-sampleOffset, Math.min(sampleOffset, Math.round(candidate.dx)));
    const roundedDy = Math.max(-sampleOffset, Math.min(sampleOffset, Math.round(candidate.dy)));
    const scale = scaleCandidates.reduce((best, current) => (
      Math.abs(current - candidate.scale) < Math.abs(best - candidate.scale) ? current : best
    ), scaleCandidates[0] || 1);
    const score = scoreTransform(sourceGrad, refGrad, width, height, roundedDx, roundedDy, scale, validationStride);
    validated.push({
      ...candidate,
      dx: roundedDx,
      dy: roundedDy,
      scale,
      cpuScore: score
    });
  });
  validated.sort((a, b) => Number(b.cpuScore) - Number(a.cpuScore));
  const bestSeed = validated[0] || null;
  const secondSeed = validated[1] || null;
  const seedScore = bestSeed ? Number(bestSeed.cpuScore) : NaN;
  const seedSecondScore = secondSeed ? Number(secondSeed.cpuScore) : NaN;
  const seedScoreGap = Number.isFinite(seedScore) ? seedScore - Math.max(0, Number.isFinite(seedSecondScore) ? seedSecondScore : -1) : -1;
  const seedStrongEnough =
    bestSeed &&
    Number.isFinite(seedScore) &&
    seedScore >= 0.24 &&
    (seedScoreGap >= 0.012 || seedScore >= 0.42);
  const buildCpuSpot = (refinedSearch = null) => ({
    dx: Number(bestSeed && bestSeed.dx) || 0,
    dy: Number(bestSeed && bestSeed.dy) || 0,
    scale: Number(bestSeed && bestSeed.scale) || 1,
    score: Number.isFinite(seedScore) ? Number(seedScore.toFixed(4)) : -1,
    scoreGap: Number.isFinite(seedScoreGap) ? Number(seedScoreGap.toFixed(4)) : -1,
    refinedScore: refinedSearch && refinedSearch.best
      ? Number((Number(refinedSearch.best.score) || -1).toFixed(4))
      : Number.isFinite(seedScore) ? Number(seedScore.toFixed(4)) : -1,
    refinedGap: refinedSearch && refinedSearch.best
      ? Number((Number(refinedSearch.best.score) - Math.max(0, Number(refinedSearch.second) || -1)).toFixed(4))
      : Number.isFinite(seedScoreGap) ? Number(seedScoreGap.toFixed(4)) : -1
  });
  if (!seedStrongEnough) {
    const cpuSpot = buildCpuSpot(null);
    const fallback = fullCpu();
    const rejectReason = bestSeed ? "seed-cpu-validation-low-score" : "seed-cpu-validation-empty";
    fallback.seedDiagnostics = {
      ...fallback.seedDiagnostics,
      used: true,
      accepted: false,
      rejectReason,
      bestSeedScore: Number.isFinite(seedScore) ? Number(seedScore.toFixed(4)) : -1,
      bestSeedGap: Number.isFinite(seedScoreGap) ? Number(seedScoreGap.toFixed(4)) : -1,
      seedValidationMs: Number((getNowMs() - startedAt).toFixed(1)),
      seedCandidates: validated.length,
      gpuValidation: evidence.summary,
      cpuSpotCheck: cpuSpot,
      parity: buildGpuCpuParityLog({
        gpuSummary: seedInfo.validationSummary,
        cpuSpot,
        accepted: false,
        fallbackFullCpu: true,
        rejectReason
      })
    };
    return fallback;
  }

  const refineRadius = Math.min(sampleOffset, Math.max(3, getLargeOffsetStep(sampleOffset) * 2));
  const refined = searchGlobalAlignmentAroundSeed(sourceGrad, refGrad, width, height, sampleOffset, scaleCandidates, stride, bestSeed, refineRadius);
  const candidateGap = Number(refined.best && refined.best.score) - Math.max(0, Number(refined.second) || -1);
  const cpuSpot = buildCpuSpot(refined);
  const refinedAccepted =
    refined.best &&
    Number(refined.best.score) >= Math.max(0.22, seedScore - 0.018) &&
    (candidateGap >= 0.01 || Number(refined.best.score) >= 0.42);
  if (!refinedAccepted) {
    const fallback = fullCpu();
    const rejectReason = "seed-refine-validation-failed";
    fallback.seedDiagnostics = {
      ...fallback.seedDiagnostics,
      used: true,
      accepted: false,
      rejectReason,
      bestSeedScore: Number(seedScore.toFixed(4)),
      seedRefinedScore: Number(refined.best && Number(refined.best.score).toFixed(4)) || -1,
      seedRefinedGap: Number.isFinite(candidateGap) ? Number(candidateGap.toFixed(4)) : -1,
      seedValidationMs: Number((getNowMs() - startedAt).toFixed(1)),
      seedCandidates: validated.length,
      gpuValidation: evidence.summary,
      cpuSpotCheck: cpuSpot,
      parity: buildGpuCpuParityLog({
        gpuSummary: seedInfo.validationSummary,
        cpuSpot,
        accepted: false,
        fallbackFullCpu: true,
        rejectReason
      })
    };
    return fallback;
  }

  const parity = buildGpuCpuParityLog({
    gpuSummary: seedInfo.validationSummary,
    cpuSpot,
    accepted: true,
    fallbackFullCpu: false,
    rejectReason: ""
  });
  return {
    search: refined,
    seedDiagnostics: {
      used: true,
      accepted: true,
      fallbackFullCpu: false,
      rejectReason: "",
      seedCandidates: validated.length,
      bestSeed: {
        dx: bestSeed.dx,
        dy: bestSeed.dy,
        scale: Number(bestSeed.scale.toFixed(6)),
        gpuScore: readOptionalNumber(bestSeed.score),
        cpuScore: Number(seedScore.toFixed(4)),
        stage: bestSeed.stage
      },
      refinedScore: Number((Number(refined.best && refined.best.score) || 0).toFixed(4)),
      refinedGap: Number.isFinite(candidateGap) ? Number(candidateGap.toFixed(4)) : -1,
      seedValidationMs: Number((getNowMs() - startedAt).toFixed(1)),
      gpuValidation: evidence.summary,
      cpuSpotCheck: cpuSpot,
      parity,
      metadata: seedInfo.metadata || null
    }
  };
}

function searchGlobalAlignmentAroundSeed(sourceGrad, refGrad, width, height, sampleOffset, scaleCandidates, stride, seed, radius) {
  const coarseStep = getLargeOffsetStep(sampleOffset);
  const coarseStride = Math.max(1, Math.floor((Number(stride) || 1) * (coarseStep >= 6 ? 1.65 : coarseStep >= 4 ? 1.35 : 1)));
  const searchRadius = Math.max(1, Math.min(sampleOffset, Math.round(Number(radius) || 3)));
  let best = { dx: Math.round(Number(seed && seed.dx) || 0), dy: Math.round(Number(seed && seed.dy) || 0), scale: Number(seed && seed.scale) || 1, score: Number(seed && seed.cpuScore) || -1 };
  let second = -1;
  let translationBase = { dx: 0, dy: 0, scale: 1, score: -1 };
  let translationSecond = -1;
  const update = (dx, dy, scale, score) => {
    if (Math.abs(scale - 1) < 0.000001) {
      if (score > translationBase.score) {
        translationSecond = translationBase.score;
        translationBase = { dx, dy, scale: 1, score };
      } else if (score > translationSecond) {
        translationSecond = score;
      }
    }
    if (score > best.score) {
      second = best.score;
      best = { dx, dy, scale, score };
    } else if (score > second) {
      second = score;
    }
  };
  const runGrid = (step, activeStride, activeRadius) => {
    const dxValues = buildOffsetCandidates(sampleOffset, step, best.dx, activeRadius);
    const dyValues = buildOffsetCandidates(sampleOffset, step, best.dy, activeRadius);
    scaleCandidates.forEach((scale) => {
      dyValues.forEach((dy) => {
        dxValues.forEach((dx) => {
          const score = scoreTransform(sourceGrad, refGrad, width, height, dx, dy, scale, activeStride);
          update(dx, dy, scale, score);
        });
      });
    });
  };
  runGrid(Math.max(1, Math.floor(coarseStep / 2)), Math.max(1, stride), searchRadius);
  runGrid(1, Math.max(1, stride), Math.min(sampleOffset, 2));
  if (translationBase.score < 0) {
    const translationScore = scoreTransform(sourceGrad, refGrad, width, height, best.dx, best.dy, 1, Math.max(1, stride));
    translationBase = { dx: best.dx, dy: best.dy, scale: 1, score: translationScore };
  }
  return {
    best,
    second,
    translationBase,
    translationSecond,
    coarseStep,
    coarseStride,
    gpuSeedFastPath: true,
    seedRadius: searchRadius
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

function roundMetric(value, digits = 4) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : 0;
}

function rejectLocalMesh(local, validation, reason = "local-validation-rejected") {
  return {
    ...local,
    applied: false,
    rejected: true,
    reason,
    validation
  };
}

function validateLocalMeshImprovement(sourceField, refField, width, height, affineBest, local, stride, context = {}) {
  if (!local || !local.applied) return local;
  const validationStrideScale = context.previewFastAlignment ? 1.75 : 1.35;
  const validationStride = Math.max(1, Math.floor((Number(stride) || 1) * validationStrideScale));
  const globalScore = scoreGradientFieldWarp(sourceField, refField, width, height, affineBest, null, validationStride);
  const localScore = scoreGradientFieldWarp(sourceField, refField, width, height, affineBest, local, validationStride);
  const scoreGain = localScore.score - globalScore.score;
  const nccGain = localScore.ncc - globalScore.ncc;
  const directionGain = localScore.direction - globalScore.direction;
  const complexity = Math.max(0, (Number(local.spread) || 0) * 0.55 + (Number(local.maxDistance) || 0) * 0.18);
  const maxDistance = Number(local.maxDistance) || 0;
  const confidence = Number(context.confidence) || 0;
  const globalScoreGap = Number(context.globalScoreGap) || 0;
  const alreadyAligned = Boolean(context.alreadyAligned);
  const lowConfidence = confidence < 0.28 || globalScoreGap < 0.012;
  const minGain = alreadyAligned
    ? 0.028
    : lowConfidence
      ? 0.024
      : maxDistance > 3.2 || complexity > 0.95
        ? 0.018
        : 0.012;
  const minNccGain = lowConfidence || maxDistance > 3.2 ? 0.006 : -0.002;
  const directionFloor = lowConfidence ? -0.012 : -0.03;
  const complexityPenalty = scoreGain < minGain * 1.45 && (maxDistance > 4.5 || complexity > 1.25);
  const validation = {
    globalScore: roundMetric(globalScore.score),
    localScore: roundMetric(localScore.score),
    scoreGain: roundMetric(scoreGain),
    globalNcc: roundMetric(globalScore.ncc),
    localNcc: roundMetric(localScore.ncc),
    nccGain: roundMetric(nccGain),
    directionGain: roundMetric(directionGain),
    minGain: roundMetric(minGain),
    minNccGain: roundMetric(minNccGain),
    complexity: roundMetric(complexity),
    maxDistance: roundMetric(maxDistance, 2),
    lowConfidence,
    alreadyAligned,
    globalCount: globalScore.count,
    localCount: localScore.count,
    accepted: false
  };
  const enoughSamples = localScore.count >= 64 && globalScore.count >= 64;
  const accepted =
    enoughSamples &&
    scoreGain >= minGain &&
    nccGain >= minNccGain &&
    directionGain >= directionFloor &&
    !complexityPenalty;
  validation.accepted = accepted;
  validation.reason = accepted
    ? "local-validation-accepted"
    : !enoughSamples
      ? "insufficient-validation-samples"
      : scoreGain < minGain
        ? "insufficient-score-gain"
        : nccGain < minNccGain
          ? "ncc-regression"
          : directionGain < directionFloor
            ? "direction-regression"
            : "complexity-penalty";
  if (!accepted) return rejectLocalMesh(local, validation);
  return {
    ...local,
    validation
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
  const conservative = config.localConservativeMode === true;
  const lowGlobalConfidence = config.localLowGlobalConfidence === true;
  const minTileScore = conservative ? 0.235 : lowGlobalConfidence ? 0.215 : 0.18;
  const minScoreGap = conservative ? 0.014 : lowGlobalConfidence ? 0.01 : 0.004;
  const minTextureEnergy = conservative ? 7.5 : lowGlobalConfidence ? 6.2 : 4.5;
  const minDirectionAgreement = conservative ? 0.28 : lowGlobalConfidence ? 0.24 : 0.18;
  const baseDx = Number(config.baseDx) || 0;
  const baseDy = Number(config.baseDy) || 0;
  const residualMode = config.localResidualMode !== false;
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
          const scored = scoreGradientFieldOffset(sourceField, refField, width, height, baseDx + dx, baseDy + dy, stride, region);
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
      const refineCandidates = [];
      for (let refineDy = best.dy - 1; refineDy <= best.dy + 1.001; refineDy += 0.5) {
        for (let refineDx = best.dx - 1; refineDx <= best.dx + 1.001; refineDx += 0.5) {
          if (Math.abs(refineDx) > searchOffset || Math.abs(refineDy) > searchOffset) continue;
          refineCandidates.push([Number(refineDx.toFixed(2)), Number(refineDy.toFixed(2))]);
        }
      }
      refineCandidates.forEach(([dx, dy]) => {
        const scored = scoreGradientFieldOffset(sourceField, refField, width, height, baseDx + dx, baseDy + dy, Math.max(1, Math.floor(stride * 0.75)), region);
        const score = scored.score;
        const distance = Math.hypot(dx, dy);
        const bestDistance = Math.hypot(best.dx, best.dy);
        if (
          score > best.score + 0.00001 ||
          (Math.abs(score - best.score) <= 0.00001 && distance > bestDistance && scored.direction > best.directionAgreement + 0.02)
        ) {
          second = Math.max(second, best.score);
          best = { dx, dy, score, directionAgreement: scored.direction, overlap: scored.overlap, ncc: scored.ncc };
        } else if (score > second && (Math.abs(dx - best.dx) > 0.001 || Math.abs(dy - best.dy) > 0.001)) {
          second = score;
        }
      });
      const scoreGap = best.score - Math.max(0, second);
      const nonZeroMotion = Math.hypot(best.dx, best.dy) >= 0.75;
      const directionOk = best.directionAgreement > minDirectionAgreement;
      if (best.score > minTileScore && directionOk && (scoreGap > minScoreGap || (!conservative && nonZeroMotion && best.score > minTileScore + 0.06))) {
        tiles.push({ ...best, row, col, scoreGap, textureEnergy, residual: residualMode });
      }
    }
  }
  return {
    ...buildLocalMeshSummary(smoothTileOffsets(tiles, rows, cols, 2), rows, cols, profile.strength, profile.maxOffset),
    residualMode,
    baseDx,
    baseDy
  };
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
  const alignmentStartedAt = getNowMs();
  const sampleOffset = Math.max(1, Math.min(Math.floor(Math.min(width, height) * 0.45), Math.round(Number(config.alignmentMaxOffset) / Math.max(sourceSample.scaleX, sourceSample.scaleY))));
  const sobelStartedAt = getNowMs();
  const sourceField = buildSobelField(buildLuma(sourceSample.data, width, height), width, height);
  const refField = buildSobelField(buildLuma(referenceSample.data, width, height), width, height);
  const sobelMs = Number((getNowMs() - sobelStartedAt).toFixed(1));
  const sourceGrad = sourceField.mag;
  const refGrad = refField.mag;
  const stride = Math.max(1, Math.floor(Math.max(width, height) / 180));
  const scaleCandidates = buildScaleCandidates(config.alignmentMaxScale, config.alignmentScaleEnabled);
  const globalSearchStartedAt = getNowMs();
  const seedSearch = config.seedTrust === "hint-only" && config.gpuAlignmentSeed
    ? searchGlobalAlignmentWithSeed(sourceGrad, refGrad, width, height, sampleOffset, scaleCandidates, stride, config.gpuAlignmentSeed)
    : {
        search: searchGlobalAlignment(sourceGrad, refGrad, width, height, sampleOffset, scaleCandidates, stride),
        seedDiagnostics: {
          used: false,
          accepted: false,
          fallbackFullCpu: false,
          rejectReason: config.gpuAlignmentSeed ? "seed-trust-missing" : "no-gpu-seed",
          seedCandidates: 0
        }
      };
  const globalSearchMs = Number((getNowMs() - globalSearchStartedAt).toFixed(1));
  const globalSearch = seedSearch.search;
  const gpuSeedDiagnostics = seedSearch.seedDiagnostics || null;
  const best = globalSearch.best;
  const second = globalSearch.second;
  const translationBase = globalSearch.translationBase;
  const translationSecond = globalSearch.translationSecond;
  const translationSeed = {
    dx: translationBase.dx,
    dy: translationBase.dy,
    scale: 1,
    score: translationBase.score
  };
  const refineStartedAt = getNowMs();
  const translationBest = refineTranslationAlignment(sourceGrad, refGrad, width, height, translationSeed, translationSecond, sampleOffset, stride);
  const affineCandidate = refineAffineAlignment(sourceGrad, refGrad, width, height, best, second, config, sampleOffset, stride);
  const refineMs = Number((getNowMs() - refineStartedAt).toFixed(1));
  const modelChoice = selectConservativeAlignmentModel(translationBest, affineCandidate);
  const affineBest = modelChoice.best;
  const comparisonScore = modelChoice.rejectedAffine
    ? Math.max(0, translationBest.secondScore)
    : Math.max(0, affineBest.secondScore, second, translationBest.score);
  const confidence = Math.max(0, Math.min(1, (affineBest.score - comparisonScore) * 3 + Math.max(0, affineBest.score - 0.22)));
  const affineDocDx = -affineBest.dx * sourceSample.scaleX;
  const affineDocDy = -affineBest.dy * sourceSample.scaleY;
  const affineScaleXPercent = Number((affineBest.scaleX * 100).toFixed(3));
  const affineScaleYPercent = Number((affineBest.scaleY * 100).toFixed(3));
  const affineRotation = Number((Number(affineBest.rotation) || 0).toFixed(3));
  const affineSignificant =
    Math.abs(affineDocDx) >= 0.35 ||
    Math.abs(affineDocDy) >= 0.35 ||
    Math.abs(affineScaleXPercent - 100) >= 0.08 ||
    Math.abs(affineScaleYPercent - 100) >= 0.08 ||
    Math.abs(affineRotation) >= 0.03;
  const globalIsConfident =
    confidence >= 0.46 &&
    affineBest.score >= 0.28 &&
    affineBest.score - comparisonScore >= 0.035;
  const globalMotionIsSimple =
    Math.abs(affineScaleXPercent - affineScaleYPercent) < 0.12 &&
    Math.abs(affineRotation) < 0.08;
  const localGuardConfig = {
    ...config,
    localConservativeMode: !affineSignificant || confidence < 0.28,
    localLowGlobalConfidence: confidence < 0.34 || affineBest.score - comparisonScore < 0.018,
    localResidualMode: true,
    baseDx: affineBest.dx,
    baseDy: affineBest.dy
  };
  const localStartedAt = getNowMs();
  const estimatedLocal = config.localAlignmentEnabled && !(globalIsConfident && globalMotionIsSimple)
    ? estimateTileOffsets(sourceField, refField, width, height, Math.max(1, Math.min(8, sampleOffset)), Math.max(1, stride), localGuardConfig)
    : {
        enabled: Boolean(config.localAlignmentEnabled),
        applied: false,
        tiles: [],
        spread: 0,
        meanDx: 0,
        meanDy: 0,
        validTiles: 0,
        totalTiles: 0,
        reason: config.localAlignmentEnabled ? "global-confidence-fast-path" : "disabled"
      };
  const local = validateLocalMeshImprovement(sourceField, refField, width, height, affineBest, estimatedLocal, Math.max(1, stride), {
    confidence,
    globalScoreGap: affineBest.score - comparisonScore,
    alreadyAligned: !affineSignificant,
    previewFastAlignment: config.previewFastAlignment === true
  });
  const localMeshMs = Number((getNowMs() - localStartedAt).toFixed(1));
  const alignmentTimings = () => ({
    sobelMs,
    globalSearchMs,
    refineMs,
    localMeshMs,
    totalMs: Number((getNowMs() - alignmentStartedAt).toFixed(1))
  });
  const localDeformation = Boolean(local.applied);
  const effectiveBest = affineBest;
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
      modelChoice,
      search: {
        sampleOffset,
        coarseStep: globalSearch.coarseStep,
        coarseStride: globalSearch.coarseStride,
        timings: alignmentTimings(),
        gpuSeed: gpuSeedDiagnostics
      },
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
    modelChoice,
    search: {
      sampleOffset,
      coarseStep: globalSearch.coarseStep,
      coarseStride: globalSearch.coarseStride,
      timings: alignmentTimings(),
      gpuSeed: gpuSeedDiagnostics
    },
    local,
    localDeformation,
    reason: Math.abs(rotation) >= 0.03 || Math.abs(scaleXPercent - scaleYPercent) >= 0.08 ? "gradient-ncc-affine" : scalePercent === 100 ? "gradient-ncc" : "gradient-ncc-scale"
  };
}

function formatFixed(value, digits = 2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : (0).toFixed(digits);
}

function formatRatioPercent(value) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
}

function sanitizeCaptureDiagnostics(diagnostics) {
  if (!diagnostics) return null;
  const { field, ...safe } = diagnostics;
  return safe;
}

function sanitizeMaskInfo(maskInfo) {
  if (!maskInfo) return null;
  return {
    width: maskInfo.width,
    height: maskInfo.height,
    coverage: maskInfo.coverage,
    coveredPixels: maskInfo.coveredPixels,
    totalWeight: maskInfo.totalWeight,
    meanEdgeEnergy: maskInfo.meanEdgeEnergy,
    meanDiffEnergy: maskInfo.meanDiffEnergy,
    reason: maskInfo.reason
  };
}

function sanitizeAlignmentV2(alignment) {
  if (!alignment) return null;
  return {
    applied: Boolean(alignment.applied),
    reason: alignment.reason,
    mask: sanitizeMaskInfo(alignment.mask),
    globalMotion: alignment.globalMotion || null,
    tileMotion: alignment.tileMotion ? {
      ...alignment.tileMotion,
      tiles: Array.isArray(alignment.tileMotion.tiles)
        ? alignment.tileMotion.tiles.slice(0, 64).map((tile) => ({
            row: tile.row,
            col: tile.col,
            x: Number((Number(tile.x) || 0).toFixed(1)),
            y: Number((Number(tile.y) || 0).toFixed(1)),
            dx: Number((Number(tile.dx) || 0).toFixed(2)),
            dy: Number((Number(tile.dy) || 0).toFixed(2)),
            score: Number((Number(tile.score) || 0).toFixed(4)),
            direction: Number((Number(tile.direction) || 0).toFixed(4)),
            scoreGap: Number((Number(tile.scoreGap) || 0).toFixed(4)),
            coverage: Number((Number(tile.coverage) || 0).toFixed(4)),
            edgeEnergy: Number((Number(tile.edgeEnergy) || 0).toFixed(2))
          }))
        : []
    } : null,
    model: alignment.model ? {
      type: alignment.model.type,
      dx: alignment.model.dx,
      dyCoefficients: alignment.model.dyCoefficients,
      yControls: alignment.model.yControls,
      maxOffset: alignment.model.maxOffset,
      maxDisplacement: alignment.model.maxDisplacement,
      smoothness: alignment.model.smoothness,
      validTiles: alignment.model.validTiles,
      totalTiles: alignment.model.totalTiles,
      reliable: alignment.model.reliable,
      reason: alignment.model.reason
    } : null,
    validation: alignment.validation || null
  };
}

function buildSkippedPixelAlignmentResult({
  app,
  sourceLayerName,
  sourceLayerId,
  sourceBounds,
  config,
  logs,
  reason,
  sourceStats = null,
  referenceStats = null,
  diagnostics = null,
  alignmentV2 = null
}) {
  logs.push(`[融合校色] 实验像素级对齐未应用：${reason}。未生成像素结果层，原返图保持不变。`);
  return {
    ok: true,
    skipped: true,
    action: "blendMatch",
    document: getDocumentInfo(app.activeDocument),
    message: `实验像素级对齐已跳过：${reason}`,
    logs,
    layerId: 0,
    sourceLayerId,
    layerName: null,
    bounds: sourceBounds,
    config,
    stats: {
      source: sourceStats,
      reference: referenceStats
    },
    corrections: null,
    alignment: {
      applied: false,
      reason
    },
    pixelPipeline: {
      used: false,
      skipped: true,
      reason,
      diagnostics: diagnostics ? {
        source: sanitizeCaptureDiagnostics(diagnostics.source),
        reference: sanitizeCaptureDiagnostics(diagnostics.reference)
      } : null,
      alignment: sanitizeAlignmentV2(alignmentV2)
    },
    featherApplied: false
  };
}

async function runPixelAlignmentV2Flow({
  photoshop,
  app,
  action,
  imaging,
  document,
  logs,
  sourceLayerId,
  sourceLayerName,
  sourceBounds,
  sourceWasVisible,
  config
}) {
  const resultLayerName = `PixelRunner 像素对齐 - ${sourceLayerName}`.slice(0, 240);
  const maxEdge = Math.max(512, Math.min(2048, Number(config.localMeshMaxEdge) || DEFAULT_BLEND_MATCH_CONFIG.localMeshMaxEdge));
  let sourceSample = null;
  let referenceSample = null;
  let sourceDiagnostics = null;
  let referenceDiagnostics = null;
  let alignmentV2 = null;

  try {
    logs.push("[融合校色] 实验像素级对齐 v2 已启用：仅执行 source RGBA 对齐，不做像素校色、边缘融合或羽化蒙版。");
    sourceSample = await captureIsolatedSourceSampleV2(imaging, app, action, document, sourceLayerId, sourceBounds, maxEdge);
    logs.push(`[融合校色] v2 source capture method：${sourceSample.captureMethod || "unknown"}。`);
    referenceSample = await captureReferenceSample(imaging, app, action, document, sourceLayerId, sourceBounds, maxEdge, sourceWasVisible);
    logs.push(`[融合校色] v2 reference capture method：${referenceSample.captureMethod || "unknown"}。`);
  } catch (error) {
    return buildSkippedPixelAlignmentResult({
      app,
      sourceLayerName,
      sourceLayerId,
      sourceBounds,
      config,
      logs,
      reason: `bad-capture/${error.message || "unknown"}`
    });
  }

  const sameSize = sourceSample.width === referenceSample.width && sourceSample.height === referenceSample.height;
  const sameScale =
    Math.abs((Number(sourceSample.scaleX) || 1) - (Number(referenceSample.scaleX) || 1)) < 0.0001 &&
    Math.abs((Number(sourceSample.scaleY) || 1) - (Number(referenceSample.scaleY) || 1)) < 0.0001;
  logs.push(`[融合校色] v2 capture size：source ${sourceSample.width}x${sourceSample.height} / reference ${referenceSample.width}x${referenceSample.height} / scale ${formatFixed(sourceSample.scaleX, 3)}x${formatFixed(sourceSample.scaleY, 3)}。`);
  logs.push(`[融合校色] v2 capture channels：source ${sourceSample.sourceComponents || 0}${sourceSample.sourcePixelFormat ? `/${sourceSample.sourcePixelFormat}` : ""} -> RGBA，reference ${referenceSample.sourceComponents || 0}${referenceSample.sourcePixelFormat ? `/${referenceSample.sourcePixelFormat}` : ""} -> RGBA。`);
  if (!sameSize || !sameScale) {
    return buildSkippedPixelAlignmentResult({
      app,
      sourceLayerName,
      sourceLayerId,
      sourceBounds,
      config,
      logs,
      reason: "capture-size-mismatch",
      sourceStats: sourceSample.stats,
      referenceStats: referenceSample.stats
    });
  }

  sourceDiagnostics = buildCaptureDiagnostics(sourceSample);
  referenceDiagnostics = buildCaptureDiagnostics(referenceSample);
  logs.push(`[融合校色] v2 source alpha：不透明 ${formatRatioPercent(sourceDiagnostics.alpha.opaqueRatio)}，透明 ${formatRatioPercent(sourceDiagnostics.alpha.transparentRatio)}，min/max ${sourceDiagnostics.alpha.minAlpha}/${sourceDiagnostics.alpha.maxAlpha}。`);
  logs.push(`[融合校色] v2 source RGB：mean ${formatFixed(sourceDiagnostics.rgb.meanR, 1)}/${formatFixed(sourceDiagnostics.rgb.meanG, 1)}/${formatFixed(sourceDiagnostics.rgb.meanB, 1)}，luma 方差 ${formatFixed(sourceDiagnostics.rgb.varianceLuma, 2)}。`);
  logs.push(`[融合校色] v2 gradient energy：source ${formatFixed(sourceDiagnostics.gradientEnergy, 2)} / reference ${formatFixed(referenceDiagnostics.gradientEnergy, 2)}。`);
  logs.push(`[融合校色] v2 source 异常检测：黑边 ${formatRatioPercent(sourceDiagnostics.borderBlackRatio)}，重复图案 ${formatRatioPercent(sourceDiagnostics.repeatedPatternScore)}${sourceDiagnostics.suspicious ? `，命中 ${sourceDiagnostics.reasons.join(", ")}` : "，未命中明显异常"}。`);

  if (sourceDiagnostics.suspicious) {
    return buildSkippedPixelAlignmentResult({
      app,
      sourceLayerName,
      sourceLayerId,
      sourceBounds,
      config,
      logs,
      reason: `bad-capture/${sourceDiagnostics.reasons.join("+")}`,
      sourceStats: sourceSample.stats,
      referenceStats: referenceSample.stats,
      diagnostics: { source: sourceDiagnostics, reference: referenceDiagnostics }
    });
  }

  alignmentV2 = buildPixelAlignmentV2(sourceSample, referenceSample, config);
  const mask = alignmentV2.mask || {};
  logs.push(`[融合校色] v2 ROI：覆盖 ${formatRatioPercent(mask.coverage)}，有效像素 ${Math.round(Number(mask.coveredPixels) || 0)}，edge ${formatFixed(mask.meanEdgeEnergy, 2)}，diff ${formatFixed(mask.meanDiffEnergy, 2)}。`);
  if (alignmentV2.globalMotion) {
    const g = alignmentV2.globalMotion;
    logs.push(`[融合校色] v2 global motion：dx ${formatFixed(g.dx, 2)}px，dy ${formatFixed(g.dy, 2)}px，score ${formatFixed(g.score, 3)}，gap ${formatFixed(g.scoreGap, 3)}，${g.reliable ? "可靠" : `跳过 ${g.reason}`}。`);
  }
  if (alignmentV2.tileMotion) {
    const t = alignmentV2.tileMotion;
    logs.push(`[融合校色] v2 tile motion：有效 ${t.validTiles}/${t.totalTiles}，最大 ${formatFixed(t.maxDistance, 2)}px，平均 ${formatFixed(t.meanDistance, 2)}px，离散 ${formatFixed(t.spread, 2)}px，${t.reliable ? "可靠" : `跳过 ${t.reason}`}。`);
  }
  if (alignmentV2.model) {
    const m = alignmentV2.model;
    const c = m.dyCoefficients || [0, 0, 0];
    const controlText = Array.isArray(m.yControls) && m.yControls.length
      ? `，controls ${m.yControls.map((control) => `${formatFixed(control.xNorm, 1)}:${formatFixed(control.dy, 2)}`).join(" / ")}`
      : "";
    logs.push(`[融合校色] v2 warp model：${m.type}，dx ${formatFixed(m.dx, 2)}px，dy(x) ${formatFixed(c[0], 2)} + ${formatFixed(c[1], 2)}x + ${formatFixed(c[2], 2)}x^2${controlText}，最大位移 ${formatFixed(m.maxDisplacement, 2)}px，平滑度 ${formatFixed(m.smoothness, 2)}。`);
  }
  if (alignmentV2.validation) {
    const v = alignmentV2.validation;
    logs.push(`[融合校色] v2 before/after：score ${formatFixed(v.before && v.before.score, 4)} -> ${formatFixed(v.after && v.after.score, 4)}，NCC ${formatFixed(v.before && v.before.ncc, 4)} -> ${formatFixed(v.after && v.after.ncc, 4)}，方向 ${formatFixed(v.before && v.before.direction, 4)} -> ${formatFixed(v.after && v.after.direction, 4)}，edge overlap ${formatFixed(v.before && v.before.overlap, 4)} -> ${formatFixed(v.after && v.after.overlap, 4)}。`);
  }

  if (!alignmentV2.applied) {
    return buildSkippedPixelAlignmentResult({
      app,
      sourceLayerName,
      sourceLayerId,
      sourceBounds,
      config,
      logs,
      reason: alignmentV2.reason || "unreliable-motion",
      sourceStats: sourceSample.stats,
      referenceStats: referenceSample.stats,
      diagnostics: { source: sourceDiagnostics, reference: referenceDiagnostics },
      alignmentV2
    });
  }

  let placed = null;
  let outputSampleSize = { width: sourceSample.width, height: sourceSample.height };
  try {
    const { storage } = await ensureDeps();
    const outputLongEdge = Math.max(
      Math.max(1, Math.ceil(Number(sourceBounds.right) - Number(sourceBounds.left))),
      Math.max(1, Math.ceil(Number(sourceBounds.bottom) - Number(sourceBounds.top)))
    );
    logs.push(`[融合校色] v2 输出阶段：重新捕获原尺寸 source，长边 ${outputLongEdge}px，避免预览采样放大造成画质损失。`);
    const outputSourceSample = await captureIsolatedSourceSampleV2(imaging, app, action, document, sourceLayerId, sourceBounds, outputLongEdge);
    outputSampleSize = { width: outputSourceSample.width, height: outputSourceSample.height };
    logs.push(`[融合校色] v2 output capture：${outputSourceSample.width}x${outputSourceSample.height}，channels ${outputSourceSample.sourceComponents || 0}${outputSourceSample.sourcePixelFormat ? `/${outputSourceSample.sourcePixelFormat}` : ""} -> RGBA。`);
    const outputModel = scaleDisplacementModel(alignmentV2.model, sourceSample, outputSourceSample);
    logs.push(`[融合校色] v2 output warp：模型缩放到原尺寸，最大位移 ${formatFixed(outputModel.maxDisplacement, 2)}px。`);
    const outputAlpha = getAlphaStats(outputSourceSample.data);
    const fullDocumentTarget = isFullDocumentBounds(sourceBounds, getDocumentInfo(document));
    const clampEdges = fullDocumentTarget && outputAlpha.opaqueRatio > 0.995 && outputAlpha.transparentRatio < 0.001;
    const warped = warpRgbaWithDisplacement(outputSourceSample, outputModel, { clampEdges });
    const warpedAlpha = getAlphaStats(warped.data);
    if (warpedAlpha.maxAlpha <= 4 || warpedAlpha.transparentRatio - outputAlpha.transparentRatio > 0.18) {
      throw new Error("warped-alpha-invalid");
    }
    const pngBuffer = await encodeRgbaPng(warped.width, warped.height, warped.data);
    if (!pngBuffer) throw new Error("像素对齐 PNG 编码失败。");
    await activateDocument(app, action, Number(document.id));
    placed = await placeAlignedPngResult(app, action, storage, pngBuffer, sourceBounds, resultLayerName);
    logs.push(`[融合校色] v2 像素对齐结果已置入并栅格化：${resultLayerName}。`);
  } catch (error) {
    return buildSkippedPixelAlignmentResult({
      app,
      sourceLayerName,
      sourceLayerId,
      sourceBounds,
      config,
      logs,
      reason: `output-failed/${error.message || "unknown"}`,
      sourceStats: sourceSample.stats,
      referenceStats: referenceSample.stats,
      diagnostics: { source: sourceDiagnostics, reference: referenceDiagnostics },
      alignmentV2
    });
  }

  if (config.createBackupLayer) {
    try {
      await setLayerVisible(action, sourceLayerId, false);
      logs.push("[融合校色] v2 对齐成功后，原返图图层已隐藏保留为备份。");
    } catch (error) {
      logs.push(`[融合校色] 原图层备份隐藏失败：${error.message || "未知错误"}。`);
    }
  } else {
    logs.push("[融合校色] v2 对齐成功，按设置保留原返图图层可见性。");
  }
  await selectLayerById(action, placed.layerId);
  logs.push("[融合校色] v2 已跳过像素校色、Photoshop 调整命令、边缘融合和羽化蒙版。");

  return {
    ok: true,
    action: "blendMatch",
    document: getDocumentInfo(app.activeDocument),
    message: `像素对齐完成：${sourceLayerName} -> ${resultLayerName}`,
    logs,
    layerId: placed.layerId,
    sourceLayerId,
    layerName: resultLayerName,
    bounds: sourceBounds,
    config,
    stats: {
      source: sourceSample.stats,
      reference: referenceSample.stats
    },
    corrections: null,
    alignment: {
      applied: true,
      reason: "pixel-align-v2",
      dx: Number((-(Number(alignmentV2.model.dx) || 0) * (Number(sourceSample.scaleX) || 1)).toFixed(2)),
      dy: Number((-(Number(alignmentV2.model.dyCoefficients && alignmentV2.model.dyCoefficients[0]) || 0) * (Number(sourceSample.scaleY) || 1)).toFixed(2)),
      confidence: Math.max(0, Math.min(1, Number(alignmentV2.validation && alignmentV2.validation.improvement) * 12))
    },
    pixelPipeline: {
      used: true,
      version: 2,
      width: outputSampleSize.width,
      height: outputSampleSize.height,
      color: null,
      diagnostics: {
        source: sanitizeCaptureDiagnostics(sourceDiagnostics),
        reference: sanitizeCaptureDiagnostics(referenceDiagnostics)
      },
      alignment: sanitizeAlignmentV2(alignmentV2)
    },
    featherApplied: false
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
    const timing = createTimingRecorder();
    const docInfo = getDocumentInfo(document);
    if (isUnsupportedBitsPerChannel(docInfo)) {
      throw buildUnsupportedBitsError(docInfo);
    }
    const requestedLayerId = Number(payload.layerId || payload.targetLayerId) || 0;
    if (requestedLayerId > 0) {
      await selectLayerById(action, requestedLayerId);
    }
    const sourceLayer = getActiveLayer(app);
    const sourceLayerId = getLayerId(sourceLayer);
    if (!(sourceLayerId > 0)) throw new Error("请先选中一张 AI 返图图层。");

    const sourceLayerName = getLayerName(sourceLayer);
    const sourceBounds = clampBoundsToDocument(parseLayerBounds(sourceLayer && sourceLayer.bounds), docInfo);
    const previewCacheKey = buildBlendMatchPreviewCacheKey(document.id, sourceLayerId, sourceBounds, config);
    const fullDocumentTarget = isFullDocumentBounds(sourceBounds, docInfo);
    const resultLayerName = `PixelRunner 融合校色 - ${sourceLayerName}`.slice(0, 240);
    logs.push(`[融合校色] 开始分析图层：${sourceLayerName}。`);
    logs.push(`[融合校色] 区域 ${sourceBounds.left},${sourceBounds.top} - ${sourceBounds.right},${sourceBounds.bottom}；内部颜色匹配与快速对齐。`);

    let sourceWasVisible = true;
    try {
      sourceWasVisible = sourceLayer.visible !== false;
    } catch (_) {}

    let sourceSample = null;
    let referenceSample = null;
    let restoredVisibility = false;
    let activePlan = null;
    let cachedPlanUsed = false;
    let previewSampleCacheUsed = false;
    let cachedPlanValidation = { ok: false, reason: "not-requested" };
    const requestedPreviewCacheKey = String(payload.previewCacheKey || "");
    const requestedPlanId = String(payload.planId || payload.blendMatchPlanId || "");
    const resolvedPlan = resolveBlendMatchCachedPlan({
      planId: requestedPlanId,
      previewCacheKey: requestedPreviewCacheKey,
      expectedPreviewCacheKey: previewCacheKey,
      documentId: document.id,
      layerId: sourceLayerId,
      bounds: sourceBounds,
      config
    });
    const previewCache = resolvedPlan.validation.ok ? resolvedPlan.entry : null;
    const previewSampleCache = !previewCache && resolvedPlan.entry && resolvedPlan.entry.sourceSample && resolvedPlan.entry.referenceSample
      ? resolvedPlan.entry
      : null;

    if (previewCache && previewCache.sourceSample && previewCache.referenceSample) {
      sourceSample = previewCache.sourceSample;
      referenceSample = previewCache.referenceSample;
      activePlan = resolvedPlan.plan;
      cachedPlanUsed = true;
      cachedPlanValidation = resolvedPlan.validation;
      timing.mark("复用 BlendMatchPlan", {
        planId: activePlan && activePlan.planId || "",
        width: sourceSample.width,
        height: sourceSample.height
      });
      logs.push(`[融合校色] Apply 复用 BlendMatchPlan：planId ${activePlan.planId}，source/reference ${sourceSample.width}x${sourceSample.height}。`);
    } else if (previewSampleCache) {
      sourceSample = previewSampleCache.sourceSample;
      referenceSample = previewSampleCache.referenceSample;
      previewSampleCacheUsed = true;
      cachedPlanValidation = resolvedPlan.validation;
      timing.mark("复用预览 raw sample", {
        reason: cachedPlanValidation.reason || "",
        width: sourceSample.width,
        height: sourceSample.height
      });
      logs.push(`[融合校色] Apply 未复用完整 plan：${cachedPlanValidation.reason}；已复用预览 raw sample cache，直接补建 CPU BlendMatchPlan，未重新 Photoshop 采样。`);
    } else {
      cachedPlanValidation = resolvedPlan.validation;
      if (requestedPlanId || requestedPreviewCacheKey) {
        logs.push(`[融合校色] Apply 未复用预览 plan：${cachedPlanValidation.reason}；将重新采样并用 CPU 重新分析。`);
      } else {
        logs.push("[融合校色] Apply 未收到预览 plan；将采样并用 CPU 分析。");
      }
      try {
        sourceSample = await captureCompositeSample(imaging, document, sourceBounds, 768, false);
        timing.mark("source 采样", { width: sourceSample.width, height: sourceSample.height });
        await selectLayerById(action, sourceLayerId);

        await setLayerVisible(action, sourceLayerId, false);
        referenceSample = await captureCompositeSample(imaging, document, sourceBounds, 768, false);
        timing.mark("reference 采样", { width: referenceSample.width, height: referenceSample.height });

        await setLayerVisible(action, sourceLayerId, sourceWasVisible);
        timing.mark("恢复图层");
        restoredVisibility = true;
        logs.push(`[融合校色] 采样完成：source/reference ${sourceSample.width}x${sourceSample.height}。`);
      } finally {
        if (!restoredVisibility) {
          try {
            await setLayerVisible(action, sourceLayerId, sourceWasVisible);
            logs.push("[融合校色] 异常回滚：已恢复返图图层可见性。");
          } catch (_) {}
        }
      }
    }

    const sourceStats = sourceSample.stats;
    const referenceStats = referenceSample.stats;
    if (!activePlan) {
      activePlan = buildCpuBlendMatchPlanFromSamples({
        documentId: document.id,
        layerId: sourceLayerId,
        layerName: sourceLayerName,
        bounds: sourceBounds,
        config,
        previewCacheKey,
        sourceSample,
        referenceSample,
        alignmentConfig: config,
        timing
      });
      storeBlendMatchPreviewCache(previewCacheKey, {
        sourceSample: cloneSampleForPreviewCache(sourceSample),
        referenceSample: cloneSampleForPreviewCache(referenceSample),
        alignment: getPlanAlignment(activePlan),
        plan: activePlan,
        planId: activePlan.planId
      });
      logs.push(`[融合校色] Apply 已重建 CPU BlendMatchPlan：planId ${activePlan.planId}。`);
    }
    const alignment = getPlanAlignment(activePlan) || { applied: false, dx: 0, dy: 0, confidence: 0, reason: "missing-plan-alignment" };
    ensurePlanColorStats(activePlan, sourceSample, referenceSample);
    const colorPlanResolution = resolveBlendMatchColorPlan({
      plan: activePlan,
      config,
      sourceSample,
      referenceSample,
      alignment,
      logs,
      timing
    });
    const colorPlan = colorPlanResolution.colorPlan;
    const corrections = colorPlanResolution.corrections || getPlanCorrections(activePlan) || buildCorrections(sourceStats, referenceStats, config);
    const colorProfile = colorPlanResolution.colorProfile;
    timing.mark(cachedPlanUsed ? "使用缓存 plan 对齐/颜色" : "使用新建 plan 对齐/颜色", {
      applied: Boolean(alignment.applied),
      confidence: Number((Number(alignment.confidence) || 0).toFixed(3)),
      reason: alignment.reason || "",
      localApplied: Boolean(alignment.localDeformation),
      localRejected: Boolean(alignment.local && alignment.local.rejected),
      localReason: alignment.local && alignment.local.reason || "",
      cachedPlan: cachedPlanUsed,
      planId: activePlan && activePlan.planId || "",
      colorPlan: colorPlanResolution.reused ? "reused" : colorPlanResolution.rebuilt ? "rebuilt" : "fallback",
      colorReason: colorPlanResolution.validation && colorPlanResolution.validation.reason || ""
    });
    logs.push(`[融合校色] Apply plan 状态：cachedPlan=${cachedPlanUsed ? "true" : "false"}，sampleCache=${previewSampleCacheUsed ? "true" : "false"}，reason=${cachedPlanValidation.reason || "new-analysis"}，planId=${activePlan.planId}。`);
    logs.push("[融合校色] Apply GPU seed 状态：never final；最终执行只消费 host CPU trusted BlendMatchPlan，GPU 仅可作为 hydrate hint。");
    logs.push(`[融合校色] Apply ColorPlan 状态：${colorPlanResolution.reused ? "reused" : colorPlanResolution.rebuilt ? "rebuilt" : "fallback"}，reason=${colorPlanResolution.validation.reason}，method=${colorPlan && colorPlan.method || "legacy-corrections"}。`);
    if (config.alignmentEnabled) {
      if (alignment.applied) {
        logs.push(`[融合校色] 快速对齐：dx ${alignment.dx}px，dy ${alignment.dy}px，scale ${Number(alignment.scaleXPercent || 100).toFixed(2)}%/${Number(alignment.scaleYPercent || 100).toFixed(2)}%，置信 ${alignment.confidence.toFixed(2)}。`);
      } else {
        logs.push(`[融合校色] 快速对齐跳过：${alignment.reason}。`);
      }
      if (alignment.modelChoice && alignment.modelChoice.rejectedAffine) {
        logs.push(`[融合校色] 对齐模型：纯平移优先，已拒绝弱仿射缩放/旋转；平移分 ${formatFixed(alignment.modelChoice.translationScore, 4)}，仿射分 ${formatFixed(alignment.modelChoice.affineScore, 4)}，增益 ${formatFixed(alignment.modelChoice.affineGain, 4)}，要求 ${formatFixed(alignment.modelChoice.minAffineGain, 4)}。`);
      }
      if (alignment.search && Number(alignment.search.coarseStep) > 1) {
        logs.push(`[融合校色] 大偏移搜索：采样半径 ${alignment.search.sampleOffset}px，粗搜步长 ${alignment.search.coarseStep}px，已精修到 1px。`);
      }
      if (alignment.localDeformation) {
        const validation = alignment.local && alignment.local.validation;
        const validationText = validation
          ? `，验证提升 ${formatFixed(validation.scoreGain, 4)}（全局 ${formatFixed(validation.globalScore, 4)} -> 局部 ${formatFixed(validation.localScore, 4)}）`
          : "";
        logs.push(`[融合校色] 局部对齐：${alignment.local.validTiles}/${alignment.local.totalTiles}，最大 ${alignment.local.maxDistance.toFixed(2)}px${validationText}。`);
      } else if (alignment.local && alignment.local.rejected) {
        const validation = alignment.local.validation || {};
        logs.push(`[融合校色] 局部对齐验证回退：${validation.reason || alignment.local.reason}，提升 ${formatFixed(validation.scoreGain, 4)}，要求 ${formatFixed(validation.minGain, 4)}；保留全局对齐。`);
      }
    }

    await selectLayerById(action, sourceLayerId);
    let resultLayer = null;
    let resultLayerId = 0;
    let pixelResult = null;

    try {
      const { storage } = await ensureDeps();
      timing.mark("加载依赖");
      pixelResult = await createInternalBlendMatchResult({
        app,
        action,
        imaging,
        document,
        storage,
        sourceLayerId,
        sourceBounds,
        resultLayerName,
        alignment,
        alignmentSample: sourceSample,
        config,
        corrections,
        colorPlan,
        colorProfile,
        referenceSample,
        fullDocumentTarget,
        logs,
        timing
      });
      resultLayer = pixelResult.layer;
      resultLayerId = pixelResult.layerId;
    } catch (error) {
      logs.push(`[融合校色] 插件内部融合未完成：${error.message || "未知错误"}。已回退为复制返图图层，不执行 Photoshop 颜色调整。`);
      await activateDocument(app, action, Number(document.id));
      await selectLayerById(action, sourceLayerId);
      await duplicateActiveLayer(action, resultLayerName);
      timing.mark("fallback 复制图层");
      resultLayer = getActiveLayer(app);
      resultLayerId = getLayerId(resultLayer);
      pixelResult = {
        width: 0,
        height: 0,
        color: null,
        alignment: null,
        forceOpaque: false,
        fallbackCopy: true
      };
    }
    if (!(resultLayerId > 0)) throw new Error("融合校色结果层创建失败。");
    logs.push(`[融合校色] 结果层：${resultLayerName}。`);

    if (config.createBackupLayer) {
      try {
        await setLayerVisible(action, sourceLayerId, false);
        timing.mark("隐藏备份层");
        logs.push("[融合校色] 原返图图层已隐藏保留为备份。");
      } catch (error) {
        logs.push(`[融合校色] 原图层备份隐藏失败：${error.message || "未知错误"}。`);
      }
      await selectLayerById(action, resultLayerId);
    }

    let featherApplied = false;
    if (fullDocumentTarget && pixelResult && pixelResult.forceOpaque) {
      logs.push("[融合校色] 整画布不透明，跳过羽化蒙版。");
      timing.mark("跳过羽化蒙版");
    } else {
      featherApplied = await applyFeatherBestEffort(action, config.featherRadius, logs);
      timing.mark("羽化蒙版", { applied: featherApplied });
    }
    await selectLayerById(action, resultLayerId);
    timing.mark("选择结果层");
    timing.logTo(logs);

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
      planId: activePlan ? activePlan.planId : "",
      previewCacheKey,
      cachedPlan: cachedPlanUsed,
      previewSampleCacheUsed,
      planValidation: cachedPlanValidation,
      pixelPipeline: {
        used: true,
        version: "internal-unified",
        width: pixelResult ? pixelResult.width : 0,
        height: pixelResult ? pixelResult.height : 0,
        color: pixelResult ? pixelResult.color : null,
        colorPlan: pixelResult ? pixelResult.colorPlan : null,
        alignment: pixelResult ? pixelResult.alignment : null,
        timings: timing.entries()
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
    const timing = createTimingRecorder();
    const docInfo = getDocumentInfo(document);
    if (isUnsupportedBitsPerChannel(docInfo)) {
      throw buildUnsupportedBitsError(docInfo);
    }
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
    const previewCacheKey = buildBlendMatchPreviewCacheKey(document.id, sourceLayerId, sourceBounds, config);
    let sourceWasVisible = true;
    try {
      sourceWasVisible = sourceLayer.visible !== false;
    } catch (_) {}

    let sourceSample = null;
    let referenceSample = null;
    let restoredVisibility = false;
    try {
      sourceSample = await captureCompositeSample(imaging, document, sourceBounds, previewMaxEdge, true);
      timing.mark("source 预览采样", { width: sourceSample.width, height: sourceSample.height });
      await setLayerVisible(action, sourceLayerId, false);
      referenceSample = await captureCompositeSample(imaging, document, sourceBounds, previewMaxEdge, true);
      timing.mark("reference 预览采样", { width: referenceSample.width, height: referenceSample.height });
      await setLayerVisible(action, sourceLayerId, sourceWasVisible);
      timing.mark("恢复图层");
      restoredVisibility = true;
    } finally {
      if (!restoredVisibility) {
        try {
          await setLayerVisible(action, sourceLayerId, sourceWasVisible);
        } catch (_) {}
      }
    }

    const plan = buildCpuBlendMatchPlanFromSamples({
      documentId: document.id,
      layerId: sourceLayerId,
      layerName: sourceLayerName,
      bounds: sourceBounds,
      config,
      previewCacheKey,
      sourceSample,
      referenceSample,
      alignmentConfig: config,
      timing
    });
    const corrections = getPlanCorrections(plan);
    const alignment = getPlanAlignment(plan);
    const colorPlan = getPlanColorPlan(plan);
    const colorSummary = summarizeColorPlan(colorPlan);
    storeBlendMatchPreviewCache(previewCacheKey, {
      sourceSample: cloneSampleForPreviewCache(sourceSample),
      referenceSample: cloneSampleForPreviewCache(referenceSample),
      alignment: cloneAlignmentResult(alignment),
      plan,
      planId: plan.planId
    });
    logs.push(`[融合校色] 预览已刷新：${sourceLayerName}，${sourceSample.width}x${sourceSample.height}，CPU plan ${plan.planId}。`);
    timing.logTo(logs, "[融合校色] 预览耗时");

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
      colorPlan,
      colorSummary,
      planId: plan.planId,
      previewCacheKey,
      config,
      logs
    };
  }, {
    commandName: "PixelRunner 融合校色预览"
  });
}

export async function previewBlendMatchSamplesActiveLayer(payload = {}, context) {
  const { photoshop, app, document } = context;
  const core = photoshop.core;
  const action = photoshop.action;
  const imaging = photoshop.imaging;
  if (!imaging || typeof imaging.getPixels !== "function") {
    throw new Error("Photoshop imaging API 不可用，无法生成融合校色预览采样。");
  }
  const config = getBlendMatchConfig(payload);
  const actionTiming = createTimingRecorder();
  const logs = [];
  const deferCpuPlan = payload.previewDeferCpuPlan === true || payload.deferCpuPlan === true;

  const modalResult = await core.executeAsModal(async () => {
    const logs = [];
    const modalTiming = createTimingRecorder();
    const docInfo = getDocumentInfo(document);
    if (isUnsupportedBitsPerChannel(docInfo)) {
      throw buildUnsupportedBitsError(docInfo);
    }
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
      sourceSample = await captureCompositeRawSample(imaging, document, sourceBounds, previewMaxEdge);
      modalTiming.mark("source raw capture", { width: sourceSample.width, height: sourceSample.height });
      await setLayerVisible(action, sourceLayerId, false);
      referenceSample = await captureCompositeRawSample(imaging, document, sourceBounds, previewMaxEdge);
      modalTiming.mark("reference raw capture", { width: referenceSample.width, height: referenceSample.height });
      await setLayerVisible(action, sourceLayerId, sourceWasVisible);
      modalTiming.mark("restore visibility");
      restoredVisibility = true;
    } finally {
      if (!restoredVisibility) {
        try {
          await setLayerVisible(action, sourceLayerId, sourceWasVisible);
          logs.push("[融合校色] 预览采样异常回滚：已恢复返图图层可见性。");
        } catch (_) {}
      }
    }

    logs.push(`[融合校色] 预览采样 modal：仅执行 Photoshop raw 采样与图层可见性恢复；未执行 JPEG/PNG 编码、raw base64 序列化、颜色修正或 CPU 对齐。`);
    modalTiming.logTo(logs, "[融合校色] 预览采样 modal 耗时");

    return {
      ok: true,
      action: "blendMatchPreviewSamples",
      document: getDocumentInfo(app.activeDocument),
      layerId: sourceLayerId,
      layerName: sourceLayerName,
      bounds: sourceBounds,
      width: sourceSample.width,
      height: sourceSample.height,
      sourceSample,
      referenceSample,
      config,
      logs,
      modalMs: modalTiming.totalMs()
    };
  }, {
    commandName: "PixelRunner 融合校色预览采样"
  });

  actionTiming.mark("executeAsModal", {
    modalMs: Number((Number(modalResult && modalResult.modalMs) || 0).toFixed(1)),
    width: modalResult && modalResult.width,
    height: modalResult && modalResult.height
  });
  if (Array.isArray(modalResult && modalResult.logs)) {
    logs.push(...modalResult.logs);
  }

  const sourceSample = modalResult.sourceSample;
  const referenceSample = modalResult.referenceSample;
  const modalDocumentId = Number(modalResult.document && (modalResult.document.documentId || modalResult.document.id)) || Number(document && document.id) || 0;
  const previewCacheKey = buildBlendMatchPreviewCacheKey(modalDocumentId, modalResult.layerId, modalResult.bounds, config);
  const statsStartedAt = getNowMs();
  sourceSample.stats = buildStatsFromRgbaSafe(sourceSample.data);
  referenceSample.stats = buildStatsFromRgbaSafe(referenceSample.data);
  actionTiming.mark("modal 外颜色统计", {
    ms: Number((getNowMs() - statsStartedAt).toFixed(1)),
    sourceCount: sourceSample.stats.count,
    referenceCount: referenceSample.stats.count
  });

  if (deferCpuPlan) {
    const corrections = buildCorrections(sourceSample.stats, referenceSample.stats, config);
    storeBlendMatchPreviewCache(previewCacheKey, {
      sourceSample: cloneSampleForPreviewCache(sourceSample),
      referenceSample: cloneSampleForPreviewCache(referenceSample),
      alignment: null,
      corrections: cloneJsonValue(corrections),
      plan: null,
      planId: "",
      pendingPlan: true
    });

    const sourceRaw = serializeSampleForWebview(sourceSample);
    const referenceRaw = serializeSampleForWebview(referenceSample);
    actionTiming.mark("modal 外 raw 序列化", {
      sourceBytes: sourceRaw ? sourceRaw.byteLength : 0,
      referenceBytes: referenceRaw ? referenceRaw.byteLength : 0,
      sourceEncodeMs: sourceRaw ? sourceRaw.encodingMs : 0,
      referenceEncodeMs: referenceRaw ? referenceRaw.encodingMs : 0,
      cpuPlanDeferred: true
    });

    logs.push(`[融合校色] 预览采样快速返回：${modalResult.layerName}，${sourceSample.width}x${sourceSample.height}；CPU BlendMatchPlan 已延后生成，先显示 raw preview。`);
    logs.push(`[融合校色] 预览采样传输：source ${sourceRaw ? sourceRaw.byteLength : 0} bytes / reference ${referenceRaw ? referenceRaw.byteLength : 0} bytes；raw base64 在 modal 外生成。`);
    logs.push(`[融合校色] raw base64 encode：source ${formatMs(sourceRaw ? sourceRaw.encodingMs : 0)} / reference ${formatMs(referenceRaw ? referenceRaw.encodingMs : 0)}；modal raw capture ${formatMs(modalResult.modalMs)}。`);
    logs.push("[融合校色] 快速预览：本次 host call 跳过 CPU 对齐/ColorPlan，WebView 将随后请求 host CPU plan 补齐；Apply 在 plan 准备完成前保持禁用。");
    actionTiming.logTo(logs, "[融合校色] 快速预览采样 host action 耗时");

    return {
      ok: true,
      action: "blendMatchPreviewSamples",
      document: modalResult.document,
      layerId: modalResult.layerId,
      layerName: modalResult.layerName,
      bounds: modalResult.bounds,
      width: sourceSample.width,
      height: sourceSample.height,
      sourceDataUrl: "",
      referenceDataUrl: "",
      sourceSample: sourceRaw,
      referenceSample: referenceRaw,
      corrections,
      alignment: {
        backend: "cpu-pending",
        applied: false,
        dx: 0,
        dy: 0,
        scalePercent: 100,
        scaleXPercent: 100,
        scaleYPercent: 100,
        rotation: 0,
        confidence: 0,
        score: 0,
        reason: "cpu-plan-deferred",
        validation: {
          ok: false,
          reason: "pending-host-cpu-plan"
        }
      },
      cpuAlignment: null,
      colorPlan: null,
      colorSummary: null,
      planId: "",
      previewCacheKey,
      planPending: true,
      fastPreview: true,
      config,
      logs
    };
  }

  const plan = buildCpuBlendMatchPlanFromSamples({
    documentId: modalDocumentId,
    layerId: modalResult.layerId,
    layerName: modalResult.layerName,
    bounds: modalResult.bounds,
    config,
    previewCacheKey,
    sourceSample,
    referenceSample,
    alignmentConfig: config,
    timing: actionTiming
  });
  const cpuAlignment = getPlanAlignment(plan);
  const corrections = getPlanCorrections(plan);
  const colorPlan = getPlanColorPlan(plan);
  const colorSummary = summarizeColorPlan(colorPlan);
  storeBlendMatchPreviewCache(previewCacheKey, {
    sourceSample: cloneSampleForPreviewCache(sourceSample),
    referenceSample: cloneSampleForPreviewCache(referenceSample),
    alignment: cloneAlignmentResult(cpuAlignment),
    plan,
    planId: plan.planId
  });

  const sourceRaw = serializeSampleForWebview(sourceSample);
  const referenceRaw = serializeSampleForWebview(referenceSample);
  actionTiming.mark("modal 外 raw 序列化", {
    sourceBytes: sourceRaw ? sourceRaw.byteLength : 0,
    referenceBytes: referenceRaw ? referenceRaw.byteLength : 0,
    sourceEncodeMs: sourceRaw ? sourceRaw.encodingMs : 0,
    referenceEncodeMs: referenceRaw ? referenceRaw.encodingMs : 0
  });

  logs.push(`[融合校色] 预览采样已刷新：${modalResult.layerName}，${sourceSample.width}x${sourceSample.height}，已生成 CPU BlendMatchPlan ${plan.planId}。`);
  logs.push(`[融合校色] 预览采样传输：source ${sourceRaw ? sourceRaw.byteLength : 0} bytes / reference ${referenceRaw ? referenceRaw.byteLength : 0} bytes；raw base64 在 modal 外生成，未生成 host preview JPEG/PNG。`);
  logs.push(`[融合校色] raw base64 encode：source ${formatMs(sourceRaw ? sourceRaw.encodingMs : 0)} / reference ${formatMs(referenceRaw ? referenceRaw.encodingMs : 0)}；modal raw capture ${formatMs(modalResult.modalMs)}。`);
  logs.push("[融合校色] WebGL2 对齐仅作为预览诊断；可复用 plan 来自主机 CPU 完整分析。");
  actionTiming.logTo(logs, "[融合校色] 预览采样 host action 耗时");

  return {
    ok: true,
    action: "blendMatchPreviewSamples",
    document: modalResult.document,
    layerId: modalResult.layerId,
    layerName: modalResult.layerName,
    bounds: modalResult.bounds,
    width: sourceSample.width,
    height: sourceSample.height,
    sourceDataUrl: "",
    referenceDataUrl: "",
    sourceSample: sourceRaw,
    referenceSample: referenceRaw,
    corrections,
    alignment: cpuAlignment,
    cpuAlignment,
    colorPlan,
    colorSummary,
    planId: plan.planId,
    previewCacheKey,
    config,
    logs
  };
}

export async function hydrateBlendMatchPreviewPlan(payload = {}, context) {
  const { photoshop, app, document } = context;
  const core = photoshop.core;
  const action = photoshop.action;
  const config = getBlendMatchConfig(payload);
  const actionTiming = createTimingRecorder();
  const logs = [];
  const payloadGpuSeed = payload && payload.gpuAlignmentSeed && typeof payload.gpuAlignmentSeed === "object"
    ? cloneJsonValue(payload.gpuAlignmentSeed)
    : null;
  const payloadSeedTrust = String(payload && payload.seedTrust || payload && payload.gpuAlignmentSeed && payload.gpuAlignmentSeed.seedTrust || "");
  const payloadSeedCandidates = Array.isArray(payload && payload.alignmentSeedCandidates)
    ? cloneJsonValue(payload.alignmentSeedCandidates.slice(0, 12))
    : [];

  const modalResult = await core.executeAsModal(async () => {
    const docInfo = getDocumentInfo(document);
    if (isUnsupportedBitsPerChannel(docInfo)) {
      throw buildUnsupportedBitsError(docInfo);
    }
    const requestedLayerId = Number(payload.layerId || payload.targetLayerId) || 0;
    if (requestedLayerId > 0) {
      await selectLayerById(action, requestedLayerId);
    }
    const sourceLayer = getActiveLayer(app);
    const sourceLayerId = getLayerId(sourceLayer);
    if (!(sourceLayerId > 0)) throw new Error("请先选中一张 AI 返图图层。");
    const sourceLayerName = getLayerName(sourceLayer);
    const sourceBounds = clampBoundsToDocument(parseLayerBounds(sourceLayer && sourceLayer.bounds), docInfo);
    const previewCacheKey = buildBlendMatchPreviewCacheKey(document.id, sourceLayerId, sourceBounds, config);
    return {
      document: getDocumentInfo(app.activeDocument),
      documentId: Number(document.id) || 0,
      layerId: sourceLayerId,
      layerName: sourceLayerName,
      bounds: sourceBounds,
      previewCacheKey
    };
  }, {
    commandName: "PixelRunner 融合校色预览分析"
  });

  actionTiming.mark("校验当前图层", {
    previewCacheKey: modalResult.previewCacheKey
  });

  const requestedPreviewCacheKey = String(payload.previewCacheKey || "");
  if (requestedPreviewCacheKey && requestedPreviewCacheKey !== modalResult.previewCacheKey) {
    throw new Error("preview-cache-key-mismatch");
  }
  const seedPreviewCacheKey = String(payloadGpuSeed && payloadGpuSeed.previewCacheKey || "");
  const gpuSeedPreviewMatch = Boolean(payloadGpuSeed && seedPreviewCacheKey && seedPreviewCacheKey === modalResult.previewCacheKey);
  const effectiveGpuSeed = payloadGpuSeed && payloadSeedTrust === "hint-only" && gpuSeedPreviewMatch
    ? payloadGpuSeed
    : null;
  logs.push(`[融合校色] CPU hydrate gpuSeed=${payloadGpuSeed ? "true" : "false"}，previewCacheKeyMatch=${gpuSeedPreviewMatch ? "true" : "false"}，seedTrust=${payloadSeedTrust || "none"}，seedCandidates=${payloadSeedCandidates.length}。`);
  if (payloadGpuSeed && !effectiveGpuSeed) {
    logs.push(`[融合校色] GPU seed 未进入 CPU fast path：${payloadSeedTrust !== "hint-only" ? "seed-trust-not-hint-only" : !gpuSeedPreviewMatch ? "preview-cache-key-mismatch" : "seed-unusable"}；将完整 CPU fallback。`);
  }

  const cache = getBlendMatchPreviewCache(modalResult.previewCacheKey);
  if (!cache || !cache.sourceSample || !cache.referenceSample) {
    throw new Error("preview-sample-cache-miss");
  }

  let plan = cache.plan || null;
  let validation = plan
    ? validateBlendMatchPlanForRequest(plan, {
        documentId: modalResult.documentId,
        layerId: modalResult.layerId,
        bounds: modalResult.bounds,
        config,
        previewCacheKey: modalResult.previewCacheKey,
        sourceSample: cache.sourceSample,
        referenceSample: cache.referenceSample
      })
    : { ok: false, reason: "missing-plan" };

  if (!validation.ok) {
    const sourceSample = cache.sourceSample;
    const referenceSample = cache.referenceSample;
    if (!sourceSample.stats) sourceSample.stats = buildStatsFromRgbaSafe(sourceSample.data);
    if (!referenceSample.stats) referenceSample.stats = buildStatsFromRgbaSafe(referenceSample.data);
    plan = buildCpuBlendMatchPlanFromSamples({
      documentId: modalResult.documentId,
      layerId: modalResult.layerId,
      layerName: modalResult.layerName,
      bounds: modalResult.bounds,
      config,
      previewCacheKey: modalResult.previewCacheKey,
      sourceSample,
      referenceSample,
      alignmentConfig: config,
      timing: actionTiming,
      logs,
      gpuAlignmentSeed: effectiveGpuSeed,
      alignmentSeedCandidates: payloadSeedCandidates,
      seedTrust: effectiveGpuSeed ? "hint-only" : ""
    });
    validation = { ok: true, reason: "rebuilt-from-preview-samples" };
    storeBlendMatchPreviewCache(modalResult.previewCacheKey, {
      sourceSample: cloneSampleForPreviewCache(sourceSample),
      referenceSample: cloneSampleForPreviewCache(referenceSample),
      alignment: getPlanAlignment(plan),
      plan,
      planId: plan.planId
    });
    logs.push(`[融合校色] CPU BlendMatchPlan 后台补齐完成：planId ${plan.planId}，source/reference ${sourceSample.width}x${sourceSample.height}。`);
    logs.push("[融合校色] CPU plan hydrate：命中 preview raw sample cache，未重新 Photoshop getPixels，未重新切换图层可见性。");
  } else {
    logs.push(`[融合校色] CPU BlendMatchPlan 后台补齐命中缓存：planId ${plan.planId}。`);
  }

  const alignment = getPlanAlignment(plan);
  const corrections = getPlanCorrections(plan);
  const colorPlan = getPlanColorPlan(plan);
  const colorSummary = summarizeColorPlan(colorPlan);
  actionTiming.logTo(logs, "[融合校色] CPU plan 后台补齐耗时");
  logs.push(`[融合校色] CPU plan ready total：${formatMs(actionTiming.totalMs())}，validation=${validation.reason || "valid"}。`);

  return {
    ok: true,
    action: "blendMatchPreviewPlan",
    document: modalResult.document,
    layerId: modalResult.layerId,
    layerName: modalResult.layerName,
    bounds: modalResult.bounds,
    corrections,
    alignment,
    cpuAlignment: alignment,
    colorPlan,
    colorSummary,
    planId: plan.planId,
    previewCacheKey: modalResult.previewCacheKey,
    planPending: false,
    planHydrated: true,
    planValidation: validation,
    config,
    logs
  };
}
