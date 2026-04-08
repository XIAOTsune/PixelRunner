import { activateDocument, ensureSelectionExists, getDocumentInfo } from "./document.js";
import {
  runDialogCommandWithFallback,
  runMenuCommandByKey,
  runSingleCommandWithDialog
} from "./commands.js";

const GLOW_PREVIEW_LAYER_NAME = "PixelRunner Glow Preview";
const GLOW_PREVIEW_MAX_EDGE = 1280;
const GLOW_STYLE_PRESETS = {
  natural: {
    detailOpacityWeight: 1,
    coreOpacityWeight: 1,
    haloOpacityWeight: 1,
    coreRadiusWeight: 1,
    haloRadiusWeight: 1,
    glowRadiusWeight: 1,
    glowOpacityWeight: 1,
    highlightFuzzinessWeight: 1,
    highlightLowerLimitBias: 0,
    sourceSaturationBias: 0,
    finalSaturationWeight: 1,
    finalVibranceWeight: 1,
    isolationGammaBias: 0,
    glowGammaBias: 0,
    finalGammaBias: 0
  },
  soft: {
    detailOpacityWeight: 0.84,
    coreOpacityWeight: 0.88,
    haloOpacityWeight: 0.92,
    coreRadiusWeight: 0.94,
    haloRadiusWeight: 1.08,
    glowRadiusWeight: 1.16,
    glowOpacityWeight: 0.88,
    highlightFuzzinessWeight: 1.12,
    highlightLowerLimitBias: -10,
    sourceSaturationBias: -6,
    finalSaturationWeight: 0.82,
    finalVibranceWeight: 0.74,
    isolationGammaBias: 0.04,
    glowGammaBias: 0.08,
    finalGammaBias: 0.05
  },
  dreamy: {
    detailOpacityWeight: 0.72,
    coreOpacityWeight: 0.94,
    haloOpacityWeight: 1.08,
    coreRadiusWeight: 0.98,
    haloRadiusWeight: 1.16,
    glowRadiusWeight: 1.3,
    glowOpacityWeight: 1.12,
    highlightFuzzinessWeight: 1.2,
    highlightLowerLimitBias: -16,
    sourceSaturationBias: 4,
    finalSaturationWeight: 1.1,
    finalVibranceWeight: 1.16,
    isolationGammaBias: 0.05,
    glowGammaBias: 0.12,
    finalGammaBias: 0.08
  }
};
const glowPreviewSession = {
  documentId: 0,
  previewLayerId: 0,
  sourceLayerId: 0
};

function buildToolCommandResponse(actionName, app, message, extra = {}) {
  return {
    ok: true,
    action: actionName,
    document: getDocumentInfo(app.activeDocument),
    message,
    ...extra
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function roundToTenth(value, min = 0.1) {
  return Math.max(min, Number(Number(value).toFixed(1)));
}

function normalizeGlowStyle(style) {
  const key = String(style || "").trim().toLowerCase();
  if (key && Object.prototype.hasOwnProperty.call(GLOW_STYLE_PRESETS, key)) return key;
  return "natural";
}

function getStyleFade(style) {
  switch (normalizeGlowStyle(style)) {
    case "soft":
      return 20;
    case "dreamy":
      return 28;
    default:
      return 12;
  }
}

function getGlowConfig(payload = {}) {
  const style = normalizeGlowStyle(payload.style);
  const stylePreset = GLOW_STYLE_PRESETS[style];
  const strength = clampNumber(payload.strength, 0, 100, 47);
  const radius = clampNumber(payload.radius, 1, 120, 81);
  const threshold = clampNumber(payload.threshold, 0, 100, 81);
  const fade = getStyleFade(style);
  const saturation = clampNumber(payload.saturation, -100, 100, 81);
  const brightnessBias = clampNumber(payload.brightnessBias, -50, 50, 0);
  const strengthRatio = strength / 100;
  const fadeRatio = 1 - fade / 140;
  const brightnessLift = brightnessBias / 50;
  const positiveBias = Math.max(0, brightnessLift);
  const negativeBias = Math.max(0, -brightnessLift);
  const highlightSpreadFactor = 1 + positiveBias * 0.12 - negativeBias * 0.08;
  const glowExpansionFactor = 1 + positiveBias * 0.16 - negativeBias * 0.1;
  const glowOpacityFactor = 1 + positiveBias * 0.12 - negativeBias * 0.08;
  const bloomOpacityBase = Math.round(18 + strength * 0.38);
  const detailOpacity = clampNumber(Math.round((18 + strength * 0.22 - fade * 0.1 + brightnessBias * 0.1) * stylePreset.detailOpacityWeight), 10, 48, 24);
  const coreOpacity = clampNumber(Math.round((26 + strength * 0.48 - fade * 0.06 + brightnessBias * 0.18) * stylePreset.coreOpacityWeight), 16, 84, 34);
  const haloOpacity = clampNumber(Math.round((Math.max(20, coreOpacity - 8) + brightnessBias * 0.12) * stylePreset.haloOpacityWeight), 14, 84, 24);
  const coreRadius = Math.max(0.8, roundToTenth(radius * 0.16 * stylePreset.coreRadiusWeight * (1 + positiveBias * 0.08 - negativeBias * 0.04), 0.8));
  const haloRadius = Math.max(coreRadius + 0.6, roundToTenth(radius * 0.34 * stylePreset.haloRadiusWeight * (1 + positiveBias * 0.12 - negativeBias * 0.05), coreRadius + 0.6));
  const midRadius = Math.max(haloRadius + 0.8, roundToTenth(radius * 0.72 * Math.max(1, stylePreset.glowRadiusWeight * 0.94) * glowExpansionFactor, haloRadius + 0.8));
  const bloomRadius = Math.max(midRadius + 1.2, roundToTenth(radius * 1.36 * stylePreset.glowRadiusWeight * glowExpansionFactor, midRadius + 1.2));
  const highlightFuzziness = clampNumber(Math.round((10 + radius * 0.22 + fade * 0.18) * stylePreset.highlightFuzzinessWeight * highlightSpreadFactor + brightnessBias * 0.1), 6, 58, 18);
  const channelOutputClamp = clampNumber(Math.round(18 + threshold * 0.28 + fade * 0.1 - brightnessBias * 0.22), 0, 120, 30);
  const sourceSaturation = clampNumber(Math.round(-24 + saturation * 0.4 + stylePreset.sourceSaturationBias), -100, 50, -24);
  const finalSaturation = clampNumber(Math.round(saturation * 0.85 * stylePreset.finalSaturationWeight), -100, 100, 0);
  const finalVibrance = clampNumber(Math.round(saturation * 0.65 * stylePreset.finalVibranceWeight), -100, 100, 0);
  const highlightLowerLimit = clampNumber(Math.round(208 + threshold * 0.42 + stylePreset.highlightLowerLimitBias - brightnessBias * 0.52), 168, 252, 220);
  const glowRadiiBase = [0.22, 0.48, 0.82, 1.18, 1.62].map((factor, index) => {
    const minRadius = [0.8, 1.4, 2.1, 2.8, 3.8][index];
    return Math.max(minRadius, roundToTenth(radius * factor * stylePreset.glowRadiusWeight * glowExpansionFactor, minRadius));
  });
  const glowOpacitiesBase = [
    Math.min(78, Math.max(20, bloomOpacityBase)),
    Math.min(68, Math.max(16, Math.round(bloomOpacityBase * (0.86 * fadeRatio)))),
    Math.min(56, Math.max(12, Math.round(bloomOpacityBase * (0.68 * fadeRatio)))),
    Math.min(44, Math.max(9, Math.round(bloomOpacityBase * (0.5 * fadeRatio)))),
    Math.min(34, Math.max(6, Math.round(bloomOpacityBase * (0.34 * fadeRatio))))
  ].map((opacity, index) => clampNumber(Math.round(opacity * stylePreset.glowOpacityWeight * glowOpacityFactor), index === 0 ? 18 : 6, 84, opacity));
  return {
    style,
    strength,
    radius,
    threshold,
    fade,
    saturation,
    brightnessBias,
    sourceSaturation,
    finalSaturation,
    finalVibrance,
    detailOpacity,
    coreOpacity,
    haloOpacity,
    coreRadius,
    haloRadius,
    midRadius,
    bloomRadius,
    glowRadii: glowRadiiBase,
    glowOpacities: glowOpacitiesBase,
    sourceOpacity: clampNumber(Math.round(20 + strength * 0.28 + brightnessBias * 0.12), 14, 52, 24),
    isolationExposure: Number((-(0.04 + threshold / 100 * 0.42 + strengthRatio * 0.06) + brightnessLift * 0.05).toFixed(2)),
    isolationGamma: Number((1.01 + fade / 100 * 0.22 + stylePreset.isolationGammaBias - brightnessLift * 0.05).toFixed(2)),
    coreExposure: Number((-(0.01 + threshold / 100 * 0.12) + brightnessLift * 0.03).toFixed(2)),
    coreGamma: Number((0.94 + fade / 100 * 0.08 - brightnessLift * 0.03).toFixed(2)),
    glowExposure: Number((-(0.07 + fade / 100 * 0.12) + brightnessLift * 0.04).toFixed(2)),
    glowGamma: Number((1.08 + fade / 100 * 0.18 + stylePreset.glowGammaBias - brightnessLift * 0.04).toFixed(2)),
    finalGamma: Number((1.01 + fade / 100 * 0.15 + stylePreset.finalGammaBias - brightnessLift * 0.04).toFixed(2)),
    highlightFuzziness,
    highlightLowerLimit,
    channelOutputClamp,
    layerName: String(payload.layerName || `Glow ${Math.round(strength)}%`)
  };
}

async function duplicateActiveLayer(action, layerName) {
  const result = await action.batchPlay([{
    _obj: "duplicate",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    name: layerName
  }], {});
  return Array.isArray(result) ? result[0] : null;
}

async function applyGaussianBlur(action, radius) {
  await action.batchPlay([{
    _obj: "gaussianBlur",
    radius: { _unit: "pixelsUnit", _value: radius }
  }], {});
}

function getDocumentPixelSize(doc) {
  const width = Math.max(1, Number(doc && doc.width && (doc.width._value ?? doc.width.value ?? doc.width)) || 1);
  const height = Math.max(1, Number(doc && doc.height && (doc.height._value ?? doc.height.value ?? doc.height)) || 1);
  return { width, height };
}

async function resizeDocumentToLongEdge(action, docRef, maxEdge) {
  const limitedEdge = Math.max(256, Math.min(4096, Math.floor(Number(maxEdge) || 0)));
  if (!limitedEdge) return { scale: 1, width: getDocumentPixelSize(docRef).width, height: getDocumentPixelSize(docRef).height };

  const current = getDocumentPixelSize(docRef);
  const currentLongEdge = Math.max(current.width, current.height);
  if (currentLongEdge <= limitedEdge) {
    return { scale: 1, width: current.width, height: current.height };
  }

  const scale = limitedEdge / currentLongEdge;
  const targetWidth = Math.max(1, Math.round(current.width * scale));
  const targetHeight = Math.max(1, Math.round(current.height * scale));

  if (typeof docRef.resizeImage === "function") {
    await docRef.resizeImage(targetWidth, targetHeight);
  } else {
    await action.batchPlay([{
      _obj: "imageSize",
      _target: [{ _ref: "document", _id: Number(docRef.id) }],
      width: { _unit: "pixelsUnit", _value: targetWidth },
      height: { _unit: "pixelsUnit", _value: targetHeight },
      constrainProportions: true,
      interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "automaticInterpolation" }
    }], {});
  }

  return { scale, width: targetWidth, height: targetHeight };
}

function getDocumentBitDepth(doc) {
  const raw = doc && doc.bitsPerChannel;
  const numeric = Number(raw && (raw._value ?? raw.value ?? raw));
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const text = String(raw && (raw._value ?? raw.value ?? raw) || "").toLowerCase();
  if (text.includes("thirty") || text.includes("32")) return 32;
  if (text.includes("sixteen") || text.includes("16")) return 16;
  if (text.includes("eight") || text.includes("8")) return 8;
  return 0;
}

async function normalizeWorkingDocumentBitDepth(action, docRef) {
  const bitDepth = getDocumentBitDepth(docRef);
  if (!bitDepth || bitDepth <= 16) return bitDepth || 0;
  await action.batchPlay([{
    _obj: "convertMode",
    depth: 16,
    merge: false
  }], {});
  return 16;
}

async function applyExposureIsolation(action, exposure, gammaCorrection) {
  await action.batchPlay([{
    _obj: "exposure",
    presetKind: {
      _enum: "presetKindType",
      _value: "presetKindCustom"
    },
    exposure,
    offset: 0,
    gammaCorrection
  }], {});
}

async function applyHueSaturation(action, saturation) {
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

async function applyVibrance(action, vibrance, saturation) {
  await action.batchPlay([{
    _obj: "vibrance",
    vibrance,
    saturation
  }], {});
}

async function applyLevelsOutput(action, outputMax) {
  await action.batchPlay([{
    _obj: "levels",
    presetKind: {
      _enum: "presetKindType",
      _value: "presetKindCustom"
    },
    adjustment: [{
      _obj: "levelsAdjustment",
      channel: {
        _ref: "channel",
        _enum: "ordinal",
        _value: "targetEnum"
      },
      output: [0, outputMax]
    }]
  }], {});
}

async function setActiveLayerStyle(action, opacity, blendModeValue) {
  await action.batchPlay([{
    _obj: "set",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    to: {
      _obj: "layer",
      opacity: { _unit: "percentUnit", _value: opacity },
      mode: { _enum: "blendMode", _value: blendModeValue }
    }
  }], {});
}

async function renameActiveLayer(action, layerName) {
  await action.batchPlay([{
    _obj: "set",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    to: {
      _obj: "layer",
      name: layerName
    }
  }], {});
}

async function mergeActiveLayerDown(action) {
  await action.batchPlay([{
    _obj: "mergeLayersNew"
  }], {});
}

async function selectRelativeLayer(action, ordinal) {
  await action.batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: ordinal }],
    makeVisible: false
  }], {});
}

async function selectLayerByName(action, layerName) {
  await action.batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _name: layerName }],
    makeVisible: false
  }], {});
}

async function selectLayerById(action, layerId) {
  await action.batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _id: layerId }],
    makeVisible: false
  }], {});
}

async function deleteActiveLayer(action) {
  await action.batchPlay([{
    _obj: "delete",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }]
  }], {});
}

async function deleteLayerByName(action, layerName) {
  try {
    await selectLayerByName(action, layerName);
    await deleteActiveLayer(action);
  } catch (_) {}
}

async function deleteLayerById(action, layerId) {
  try {
    await action.batchPlay([{
      _obj: "delete",
      _target: [{ _ref: "layer", _id: layerId }]
    }], {});
  } catch (_) {}
}

function parseLayerBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return null;
  const left = Number(bounds.left && (bounds.left._value ?? bounds.left.value ?? bounds.left));
  const top = Number(bounds.top && (bounds.top._value ?? bounds.top.value ?? bounds.top));
  const right = Number(bounds.right && (bounds.right._value ?? bounds.right.value ?? bounds.right));
  const bottom = Number(bounds.bottom && (bounds.bottom._value ?? bounds.bottom.value ?? bounds.bottom));
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  return { left, top, right, bottom };
}

function getBoundsCenter(bounds) {
  return {
    x: (Number(bounds.left) + Number(bounds.right)) / 2,
    y: (Number(bounds.top) + Number(bounds.bottom)) / 2
  };
}

async function transformLayerScale(action, layerId, scaleXPercent, scaleYPercent) {
  await action.batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _id: layerId }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    width: { _unit: "percentUnit", _value: scaleXPercent },
    height: { _unit: "percentUnit", _value: scaleYPercent },
    linked: false
  }], {});
}

async function transformLayerOffset(action, layerId, dx, dy) {
  await action.batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _id: layerId }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    offset: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: dx },
      vertical: { _unit: "pixelsUnit", _value: dy }
    }
  }], {});
}

async function clearSelection(action) {
  await action.batchPlay([{
    _obj: "set",
    _target: [{ _ref: "channel", _property: "selection" }],
    to: { _enum: "ordinal", _value: "none" }
  }], {});
}

async function selectChannel(action, channel) {
  await action.batchPlay([{
    _obj: "select",
    _target: [{ _ref: "channel", _enum: "channel", _value: channel }]
  }], {});
}

async function selectHighlights(action, config) {
  await action.batchPlay([{
    _obj: "colorRange",
    colors: {
      _enum: "colors",
      _value: "highlights"
    },
    highlightsFuzziness: config.highlightFuzziness,
    highlightsLowerLimit: config.highlightLowerLimit,
    invert: false,
    colorModel: 0
  }], {});
}

async function copySelectionToLayer(action) {
  await action.batchPlay([{
    _obj: "copyToLayer"
  }], {});
}

async function applyMaskFromSelection(action) {
  await action.batchPlay([{
    _obj: "make",
    new: { _class: "channel" },
    at: { _ref: "channel", _enum: "channel", _value: "mask" },
    using: { _enum: "userMaskEnabled", _value: "revealSelection" }
  }], {});
}

async function mergeVisibleLayers(action) {
  await action.batchPlay([{
    _obj: "mergeVisible"
  }], {});
}

function getActiveLayerId(app) {
  const activeLayer = app && app.activeDocument && app.activeDocument.activeLayers && app.activeDocument.activeLayers[0];
  const layerId = Number(activeLayer && activeLayer.id);
  return Number.isFinite(layerId) && layerId > 0 ? layerId : 0;
}

function resetGlowPreviewSessionState() {
  glowPreviewSession.documentId = 0;
  glowPreviewSession.previewLayerId = 0;
  glowPreviewSession.sourceLayerId = 0;
}

async function clearGlowPreviewLayer(app, action, fallbackDocument = null) {
  const targetDocumentId = Number(glowPreviewSession.documentId) || Number(fallbackDocument && fallbackDocument.id) || 0;
  const originalDocument = app && app.activeDocument ? app.activeDocument : null;

  try {
    if (targetDocumentId > 0) {
      await activateDocument(app, action, targetDocumentId);
    } else if (fallbackDocument) {
      app.activeDocument = fallbackDocument;
    }

    if (glowPreviewSession.previewLayerId > 0) {
      await deleteLayerById(action, glowPreviewSession.previewLayerId);
    } else {
      await deleteLayerByName(action, GLOW_PREVIEW_LAYER_NAME);
    }
  } finally {
    if (originalDocument) {
      try {
        app.activeDocument = originalDocument;
      } catch (_) {}
    }
  }

  glowPreviewSession.previewLayerId = 0;
}

function createScaledGlowConfig(config, scale) {
  const safeScale = Math.max(0.05, Math.min(1, Number(scale) || 1));
  if (safeScale >= 0.999) return config;
  return {
    ...config,
    coreRadius: Math.max(0.5, roundToTenth(config.coreRadius * safeScale, 0.5)),
    haloRadius: Math.max(0.8, roundToTenth(config.haloRadius * safeScale, 0.8)),
    midRadius: Math.max(0.8, roundToTenth(config.midRadius * safeScale, 0.8)),
    bloomRadius: Math.max(1.2, roundToTenth(config.bloomRadius * safeScale, 1.2)),
    glowRadii: (Array.isArray(config.glowRadii) ? config.glowRadii : []).map((radius) => Math.max(0.5, roundToTenth(radius * safeScale, 0.5)))
  };
}

function pickGlowPreviewSamples(values, sampleCount) {
  const list = Array.isArray(values) ? values.filter((value) => Number.isFinite(Number(value))) : [];
  if (!list.length) return [];

  const safeCount = Math.max(1, Math.min(list.length, Math.floor(Number(sampleCount) || 0)));
  if (safeCount >= list.length) return list.slice();

  const indexes = new Set();
  for (let index = 0; index < safeCount; index += 1) {
    const ratio = safeCount === 1 ? 0 : index / (safeCount - 1);
    indexes.add(Math.round(ratio * (list.length - 1)));
  }

  return Array.from(indexes)
    .sort((left, right) => left - right)
    .map((index) => list[index]);
}

function getGlowPreviewProfile(config) {
  const radius = Number(config && config.radius) || 0;
  const strength = Number(config && config.strength) || 0;
  const threshold = Number(config && config.threshold) || 0;
  const brightnessBias = Number(config && config.brightnessBias) || 0;
  const style = normalizeGlowStyle(config && config.style);

  let maxEdge = GLOW_PREVIEW_MAX_EDGE;
  let sampleCount = 3;
  let radiusCaps = [18, 40, 70];
  let opacityBoost = 1.04;
  let channelOutputClampOffset = -4;
  let finalSaturationMin = -70;
  let finalSaturationMax = 88;
  let finalVibranceMin = -40;
  let finalVibranceMax = 76;

  if (radius >= 70) {
    maxEdge = 1160;
    radiusCaps = [16, 34, 58];
    finalSaturationMax = 84;
    finalVibranceMax = 70;
  }

  if (radius >= 92 || strength >= 76) {
    maxEdge = 1080;
    sampleCount = 2;
    radiusCaps = [15, 28];
    opacityBoost = 1.08;
    channelOutputClampOffset = -6;
    finalSaturationMax = 80;
    finalVibranceMax = 64;
  }

  if (style === "dreamy") {
    maxEdge -= 80;
    opacityBoost += 0.02;
    channelOutputClampOffset -= 1;
    finalSaturationMax -= 4;
    finalVibranceMax -= 4;
  } else if (style === "soft") {
    maxEdge -= 20;
    finalSaturationMax -= 2;
  }

  if (threshold >= 88) {
    opacityBoost += 0.02;
    finalSaturationMin = -64;
  }

  if (brightnessBias >= 28) {
    maxEdge -= 40;
    opacityBoost += 0.03;
    channelOutputClampOffset -= 3;
    finalSaturationMax -= 2;
    finalVibranceMax -= 2;
  } else if (brightnessBias <= -24) {
    opacityBoost -= 0.02;
    finalSaturationMax += 2;
    finalVibranceMax += 2;
  }

  return {
    maxEdge: Math.max(960, Math.min(GLOW_PREVIEW_MAX_EDGE, maxEdge)),
    sampleCount,
    radiusCaps,
    opacityBoost,
    channelOutputClampOffset,
    finalSaturationMin,
    finalSaturationMax,
    finalVibranceMin,
    finalVibranceMax
  };
}

function createPreviewGlowConfig(config, previewProfile = getGlowPreviewProfile(config)) {
  const sampledRadii = pickGlowPreviewSamples(config.glowRadii, previewProfile.sampleCount);
  const sampledOpacities = pickGlowPreviewSamples(config.glowOpacities, previewProfile.sampleCount);

  return {
    ...config,
    detailOpacity: clampNumber(config.detailOpacity + 2, 10, 48, config.detailOpacity),
    coreOpacity: clampNumber(config.coreOpacity + 2, 16, 84, config.coreOpacity),
    haloOpacity: clampNumber(config.haloOpacity + 1, 14, 84, config.haloOpacity),
    coreRadius: clampNumber(config.coreRadius, 0.5, 18, config.coreRadius),
    haloRadius: clampNumber(config.haloRadius, 0.8, 36, config.haloRadius),
    glowRadii: (sampledRadii.length ? sampledRadii : config.glowRadii).map((radius, index) => {
      const maxRadius = previewProfile.radiusCaps[index] || previewProfile.radiusCaps[previewProfile.radiusCaps.length - 1] || 72;
      return clampNumber(radius, 0.5, maxRadius, radius);
    }),
    glowOpacities: sampledOpacities.map((opacity, index, list) => {
      const boost = index === list.length - 1 ? previewProfile.opacityBoost + 0.04 : previewProfile.opacityBoost;
      return clampNumber(Math.round(opacity * boost), 8, 84, opacity);
    }),
    channelOutputClamp: clampNumber(
      config.channelOutputClamp + previewProfile.channelOutputClampOffset,
      0,
      120,
      config.channelOutputClamp
    ),
    finalSaturation: clampNumber(
      config.finalSaturation,
      previewProfile.finalSaturationMin,
      previewProfile.finalSaturationMax,
      config.finalSaturation
    ),
    finalVibrance: clampNumber(
      config.finalVibrance,
      previewProfile.finalVibranceMin,
      previewProfile.finalVibranceMax,
      config.finalVibrance
    )
  };
}

function getGlowPreviewMaxEdge(config) {
  return getGlowPreviewProfile(config).maxEdge;
}

async function fitImportedLayerToDocument(app, action, layerId, targetWidth, targetHeight) {
  if (!(layerId > 0) || !(targetWidth > 0) || !(targetHeight > 0)) return;
  const activeLayer = app && app.activeDocument && app.activeDocument.activeLayers && app.activeDocument.activeLayers[0];
  const bounds = parseLayerBounds(activeLayer && activeLayer.bounds);
  if (!bounds) return;

  const currentWidth = Math.max(1, Number(bounds.right) - Number(bounds.left));
  const currentHeight = Math.max(1, Number(bounds.bottom) - Number(bounds.top));
  const scaleX = targetWidth / currentWidth;
  const scaleY = targetHeight / currentHeight;

  if (Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001) {
    await transformLayerScale(action, layerId, scaleX * 100, scaleY * 100);
  }

  const nextLayer = app && app.activeDocument && app.activeDocument.activeLayers && app.activeDocument.activeLayers[0];
  const nextBounds = parseLayerBounds(nextLayer && nextLayer.bounds);
  if (!nextBounds) return;

  const currentCenter = getBoundsCenter(nextBounds);
  const targetCenter = { x: targetWidth / 2, y: targetHeight / 2 };
  const dx = targetCenter.x - currentCenter.x;
  const dy = targetCenter.y - currentCenter.y;
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
    await transformLayerOffset(action, layerId, dx, dy);
  }
}

async function createGlowLayerFromDocument(config, app, document, action, saveOptions = {}, options = {}) {
  const originalDocument = document;
  const sourceName = `${config.layerName} Source`;
  const baseName = `${config.layerName} Base`;
  const detailName = `${config.layerName} Detail`;
  const coreName = `${config.layerName} Core`;
  const haloName = `${config.layerName} Halo`;
  const previewMaxEdge = Math.max(0, Math.floor(Number(options.previewMaxEdge) || 0));
  const sourceSize = getDocumentPixelSize(document);
  let tempDoc = null;
  let importedLayer = null;

  try {
    tempDoc = await document.duplicate(`${config.layerName} Temp`, true);
    app.activeDocument = tempDoc;

    await normalizeWorkingDocumentBitDepth(action, tempDoc);
    const resizeInfo = previewMaxEdge > 0
      ? await resizeDocumentToLongEdge(action, tempDoc, previewMaxEdge)
      : { scale: 1, width: sourceSize.width, height: sourceSize.height };
    let workingConfig = createScaledGlowConfig(config, Number(resizeInfo.scale) || 1);
    if (previewMaxEdge > 0) {
      workingConfig = createPreviewGlowConfig(workingConfig, getGlowPreviewProfile(config));
    }
    await renameActiveLayer(action, baseName);
    await selectHighlights(action, workingConfig);
    await copySelectionToLayer(action);
    await renameActiveLayer(action, sourceName);
    await clearSelection(action);
    await deleteLayerByName(action, baseName);

    if (workingConfig.sourceSaturation !== 0) {
      await applyHueSaturation(action, workingConfig.sourceSaturation);
    }
    if (Math.abs(workingConfig.isolationExposure) > 0.01 || Math.abs(workingConfig.isolationGamma - 1) > 0.01) {
      await applyExposureIsolation(action, workingConfig.isolationExposure, workingConfig.isolationGamma);
    }
    await selectChannel(action, "red");
    await applyLevelsOutput(action, 242);
    await selectChannel(action, "grain");
    await applyLevelsOutput(action, 242);
    await selectChannel(action, "blue");
    await applyLevelsOutput(action, 242);
    await selectChannel(action, "RGB");
    await renameActiveLayer(action, detailName);
    await setActiveLayerStyle(action, workingConfig.detailOpacity, "screen");

    await selectLayerByName(action, detailName);
    await duplicateActiveLayer(action, coreName);
    await renameActiveLayer(action, coreName);
    await applyGaussianBlur(action, workingConfig.coreRadius);
    await applyExposureIsolation(action, workingConfig.coreExposure, workingConfig.coreGamma);
    await setActiveLayerStyle(action, workingConfig.coreOpacity, "screen");

    await selectLayerByName(action, detailName);
    await duplicateActiveLayer(action, haloName);
    await renameActiveLayer(action, haloName);
    await applyGaussianBlur(action, workingConfig.haloRadius);
    await applyExposureIsolation(action, workingConfig.glowExposure, Number((workingConfig.glowGamma - 0.04).toFixed(2)));
    await setActiveLayerStyle(action, workingConfig.haloOpacity, "screen");

    for (let index = 0; index < workingConfig.glowRadii.length; index += 1) {
      await selectLayerByName(action, detailName);
      await duplicateActiveLayer(action, `${config.layerName} Glow ${index + 1}`);
      await renameActiveLayer(action, `${config.layerName} Glow ${index + 1}`);
      await applyGaussianBlur(action, workingConfig.glowRadii[index]);
      await applyExposureIsolation(action, workingConfig.glowExposure, workingConfig.glowGamma);
      await setActiveLayerStyle(action, workingConfig.glowOpacities[index], "screen");
    }

    await mergeVisibleLayers(action);
    await renameActiveLayer(action, config.layerName);

    await applyExposureIsolation(action, 0, workingConfig.finalGamma);
    const outputMax = Math.max(96, 255 - workingConfig.channelOutputClamp);
    await selectChannel(action, "red");
    await applyLevelsOutput(action, outputMax);
    await selectChannel(action, "grain");
    await applyLevelsOutput(action, outputMax);
    await selectChannel(action, "blue");
    await applyLevelsOutput(action, outputMax);
    await selectChannel(action, "RGB");
    if (workingConfig.finalVibrance !== 0 || workingConfig.finalSaturation !== 0) {
      await applyVibrance(action, workingConfig.finalVibrance, workingConfig.finalSaturation);
    }
    await setActiveLayerStyle(action, 100, "screen");

    const tempResultLayer = tempDoc && tempDoc.activeLayers && tempDoc.activeLayers[0];
    if (!tempResultLayer) {
      throw new Error("Glow result layer was not created.");
    }

    importedLayer = await tempResultLayer.duplicate(originalDocument);
    app.activeDocument = originalDocument;
    const importedLayerId = Number((importedLayer && importedLayer.id) || getActiveLayerId(app) || 0);
    if (importedLayerId > 0) {
      await selectLayerById(action, importedLayerId);
    }
    await renameActiveLayer(action, config.layerName);
    await setActiveLayerStyle(action, 100, "screen");
    if (previewMaxEdge > 0) {
      await fitImportedLayerToDocument(app, action, importedLayerId, sourceSize.width, sourceSize.height);
    }
  } finally {
    try {
      app.activeDocument = originalDocument;
    } catch (_) {}
    if (tempDoc) {
      try {
        await tempDoc.close(saveOptions.DONOTSAVECHANGES);
      } catch (_) {}
    }
  }

  return importedLayer;
}

async function runDialogToolAction(actionName, payload, core, action, app) {
  if (actionName === "gaussianBlur") {
    const radius = clampNumber(payload.radius, 0.1, 250, 5);
    await runDialogCommandWithFallback(core, action, {
      label: "Gaussian Blur",
      menuKey: "gaussianBlur",
      descriptor: { _obj: "gaussianBlur", radius: { _unit: "pixelsUnit", _value: radius } },
      commandName: "Gaussian Blur"
    });
    return buildToolCommandResponse(actionName, app, "Opened Gaussian Blur dialog.");
  }

  if (actionName === "sharpen") {
    await runDialogCommandWithFallback(core, action, {
      label: "Smart Sharpen",
      menuKey: "smartSharpen",
      descriptor: { _obj: "smartSharpen" },
      commandName: "Smart Sharpen"
    });
    return buildToolCommandResponse(actionName, app, "Opened Smart Sharpen dialog.");
  }

  if (actionName === "highPass") {
    const radius = clampNumber(payload.radius, 0.1, 250, 2);
    await runDialogCommandWithFallback(core, action, {
      label: "High Pass",
      menuKey: "highPass",
      descriptor: { _obj: "highPass", radius: { _unit: "pixelsUnit", _value: radius } },
      commandName: "High Pass"
    });
    return buildToolCommandResponse(actionName, app, "Opened High Pass dialog.");
  }

  return null;
}

async function runSelectionBasedToolAction(actionName, core, action, app, document) {
  if (actionName === "contentAwareFill") {
    if (!ensureSelectionExists(document)) {
      throw new Error("Please create a selection before running Content-Aware Fill.");
    }

    try {
      await runMenuCommandByKey(core, "contentAwareFill", "Content-Aware Fill");
    } catch (error) {
      const message = error && error.message ? String(error.message) : String(error || "");
      throw new Error(`Content-Aware Fill failed: ${message}`);
    }

    return buildToolCommandResponse(actionName, app, "Opened Content-Aware Fill.");
  }

  if (actionName !== "selectAndMask") return null;

  let menuError = null;
  try {
    await runMenuCommandByKey(core, "selectAndMask", "Select and Mask");
    return buildToolCommandResponse(actionName, app, "Opened Select and Mask.");
  } catch (error) {
    menuError = error;
  }

  const menuMessage = menuError && menuError.message ? String(menuError.message) : String(menuError || "");
  if (menuMessage.toLowerCase().includes("disabled")) {
    throw new Error(`Select and Mask failed: ${menuMessage}`);
  }

  let actionError = null;
  try {
    await core.executeAsModal(async () => {
      await runSingleCommandWithDialog(action, { _obj: "selectAndMask" }, "Select and Mask");
    }, { commandName: "Select and Mask", interactive: true });
    return buildToolCommandResponse(actionName, app, "Opened Select and Mask.");
  } catch (primaryActionError) {
    actionError = primaryActionError;
  }

  try {
    await core.executeAsModal(async () => {
      await runSingleCommandWithDialog(action, { _obj: "refineSelectionEdge" }, "Select and Mask");
    }, { commandName: "Select and Mask", interactive: true });
    return buildToolCommandResponse(actionName, app, "Opened Select and Mask.");
  } catch (fallbackError) {
    const actionMessage = actionError && actionError.message ? String(actionError.message) : String(actionError || "");
    const fallbackMessage = fallbackError && fallbackError.message ? String(fallbackError.message) : String(fallbackError || "");
    throw new Error(`Select and Mask failed. Menu: ${menuMessage}; Action(selectAndMask): ${actionMessage}; Action(refineSelectionEdge): ${fallbackMessage}`);
  }
}

async function runModalToolAction(actionName, payload, app, document, action, constants) {
  switch (actionName) {
    case "observerLayer": {
      const result = await action.batchPlay([{
        _obj: "make",
        _target: [{ _ref: "adjustmentLayer" }],
        using: { _obj: "adjustmentLayer", name: String(payload.layerName || "Black & White Observer"), type: { _obj: "blackAndWhite" } }
      }], {});
      const activeLayer = app.activeDocument && app.activeDocument.activeLayers && app.activeDocument.activeLayers[0];
      return buildToolCommandResponse(actionName, app, "Created observer layer.", {
        result,
        layerName: String((activeLayer && activeLayer.name) || payload.layerName || "Black & White Observer")
      });
    }
    case "neutralGrayLayer": {
      const layer = await document.createLayer({
        name: "Neutral Gray Layer",
        blendMode: constants.BlendMode ? constants.BlendMode.SOFTLIGHT : undefined,
        fillNeutral: true,
        opacity: 100
      });
      return buildToolCommandResponse(actionName, app, "Created neutral gray layer.", {
        layerName: String((layer && layer.name) || "Neutral Gray Layer")
      });
    }
    case "stampVisible": {
      const saveOptions = constants.SaveOptions || {};
      const tempDoc = await document.duplicate("PixelRunner Stamp Temp", true);
      try {
        const tempLayer = tempDoc && tempDoc.activeLayers && tempDoc.activeLayers[0];
        if (!tempLayer) throw new Error("Stamp visible temp layer is unavailable");

        const duplicatedLayer = await tempLayer.duplicate(document);
        if (duplicatedLayer) {
          try {
            duplicatedLayer.name = String(payload.layerName || "Stamp Visible");
          } catch (_) {}
        }

        app.activeDocument = document;
        return buildToolCommandResponse(actionName, app, "Created stamp visible layer.", {
          layerName: String((duplicatedLayer && duplicatedLayer.name) || payload.layerName || "Stamp Visible")
        });
      } finally {
        try {
          await tempDoc.close(saveOptions.DONOTSAVECHANGES);
        } catch (_) {}
        try {
          app.activeDocument = document;
        } catch (_) {}
      }
    }
    case "glow":
    case "glowPreviewStart":
    case "glowPreviewUpdate":
    case "glowPreviewCommit":
    case "glowPreviewCancel": {
      const config = getGlowConfig(payload);
      const originalDocument = document;
      let importedLayer = null;

      if (actionName === "glowPreviewCancel") {
        await clearGlowPreviewLayer(app, action, originalDocument);
        resetGlowPreviewSessionState();
        return buildToolCommandResponse(actionName, app, "已清理辉光预览层。");
      }

      if (actionName === "glowPreviewStart") {
        if (Number(glowPreviewSession.documentId) && Number(glowPreviewSession.documentId) !== Number(originalDocument.id)) {
          await clearGlowPreviewLayer(app, action, originalDocument);
          resetGlowPreviewSessionState();
        }
        glowPreviewSession.documentId = Number(originalDocument.id) || 0;
        glowPreviewSession.sourceLayerId = getActiveLayerId(app);
      }

      if (actionName === "glowPreviewUpdate" || actionName === "glowPreviewStart") {
        if (Number(glowPreviewSession.documentId) && Number(glowPreviewSession.documentId) !== Number(originalDocument.id)) {
          glowPreviewSession.documentId = Number(originalDocument.id) || 0;
        }
        await clearGlowPreviewLayer(app, action, originalDocument);
        importedLayer = await createGlowLayerFromDocument(
          { ...config, layerName: GLOW_PREVIEW_LAYER_NAME },
          app,
          originalDocument,
          action,
          constants.SaveOptions || {},
          { previewMaxEdge: getGlowPreviewMaxEdge(config) }
        );
        glowPreviewSession.documentId = Number(originalDocument.id) || 0;
        glowPreviewSession.previewLayerId = Number((importedLayer && importedLayer.id) || getActiveLayerId(app) || 0);
        return buildToolCommandResponse(actionName, app, `已更新辉光预览：强度 ${config.strength}% / 半径 ${config.radius} / 阈值 ${config.threshold}%。`, {
          layerName: GLOW_PREVIEW_LAYER_NAME,
          layerId: glowPreviewSession.previewLayerId,
          brightnessBias: config.brightnessBias
        });
      }

      if (actionName === "glowPreviewCommit") {
        if (Number(glowPreviewSession.documentId) === Number(originalDocument.id)) {
          const sourceLayerId = Number(glowPreviewSession.sourceLayerId) || 0;
          await clearGlowPreviewLayer(app, action, originalDocument);
          if (sourceLayerId > 0) {
            try {
              await selectLayerById(action, sourceLayerId);
            } catch (_) {}
          }
          resetGlowPreviewSessionState();
          importedLayer = await createGlowLayerFromDocument(
            config,
            app,
            originalDocument,
            action,
            constants.SaveOptions || {},
            { previewMaxEdge: 0 }
          );
          const committedLayerId = Number((importedLayer && importedLayer.id) || getActiveLayerId(app) || 0);
          return buildToolCommandResponse(actionName, app, `已按全分辨率生成 ${config.layerName}。`, {
            layerName: config.layerName,
            style: config.style,
            strength: config.strength,
            radius: config.radius,
            threshold: config.threshold,
            saturation: config.saturation,
            brightnessBias: config.brightnessBias,
            layerId: committedLayerId
          });
        }
      }

      if (actionName === "glow") {
        await clearGlowPreviewLayer(app, action, originalDocument);
        resetGlowPreviewSessionState();
      }

      importedLayer = await createGlowLayerFromDocument(
        config,
        app,
        originalDocument,
        action,
        constants.SaveOptions || {},
        { previewMaxEdge: 0 }
      );

      const activeLayer = app.activeDocument && app.activeDocument.activeLayers && app.activeDocument.activeLayers[0];
      return buildToolCommandResponse(actionName, app, `Created rebuilt glow layer from isolated highlight source: strength ${config.strength}%, radius ${config.radius}, threshold ${config.threshold}%.`, {
        layerName: String((importedLayer && importedLayer.name) || (activeLayer && activeLayer.name) || config.layerName),
        style: config.style,
        strength: config.strength,
        radius: config.radius,
        threshold: config.threshold,
        saturation: config.saturation,
        brightnessBias: config.brightnessBias,
        coreRadius: config.coreRadius,
        bloomRadius: config.bloomRadius,
        coreOpacity: config.glowOpacities[0],
        bloomOpacity: config.glowOpacities[config.glowOpacities.length - 1],
        layerId: Number((importedLayer && importedLayer.id) || (activeLayer && activeLayer.id) || 0) || 0
      });
    }
    default:
      throw new Error(`Unsupported tool action: ${actionName}`);
  }
}

export async function runToolActionByName(payload, context) {
  const { photoshop, app, document } = context;
  const core = photoshop.core;
  const action = photoshop.action;
  const constants = photoshop.constants || {};
  const actionName = String(payload.action || "").trim();

  if (!actionName) throw new Error("Tool action is missing");

  const dialogResult = await runDialogToolAction(actionName, payload, core, action, app);
  if (dialogResult) return dialogResult;

  const selectionResult = await runSelectionBasedToolAction(actionName, core, action, app, document);
  if (selectionResult) return selectionResult;

  return core.executeAsModal(async () => {
    return runModalToolAction(actionName, payload, app, document, action, constants);
  }, {
    commandName: `PixelRunner Tool: ${actionName}`
  });
}
