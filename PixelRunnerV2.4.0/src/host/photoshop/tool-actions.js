import { ensureSelectionExists, getDocumentInfo } from "./document.js";
import {
  runDialogCommandWithFallback,
  runMenuCommandByKey,
  runSingleCommandWithDialog
} from "./commands.js";

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

function getGlowConfig(payload = {}) {
  const strength = clampNumber(payload.strength, 0, 100, 35);
  const radius = clampNumber(payload.radius, 1, 120, 18);
  const threshold = clampNumber(payload.threshold, 0, 100, 58);
  const fade = clampNumber(payload.fade, 0, 100, 28);
  const saturation = clampNumber(payload.saturation, -100, 100, 0);
  const baseOpacity = Math.round(18 + strength * 0.42);
  const coreRadius = Math.max(0.8, Number((radius * 0.35).toFixed(1)));
  const midRadius = Math.max(coreRadius + 0.5, Number((radius * 0.78).toFixed(1)));
  const bloomRadius = Math.max(midRadius + 0.5, Number((radius * 1.45).toFixed(1)));
  const fadeRatio = 1 - fade / 140;
  return {
    strength,
    radius,
    threshold,
    fade,
    saturation,
    coreRadius,
    midRadius,
    bloomRadius,
    midBlurIncrement: Math.max(0.5, Number((midRadius - coreRadius).toFixed(1))),
    bloomBlurIncrement: Math.max(0.5, Number((bloomRadius - midRadius).toFixed(1))),
    coreOpacity: Math.min(90, Math.max(10, baseOpacity)),
    midOpacity: Math.min(80, Math.max(8, Math.round(baseOpacity * (0.7 * fadeRatio)))),
    bloomOpacity: Math.min(68, Math.max(5, Math.round(baseOpacity * (0.42 * fadeRatio)))),
    isolationExposure: Number((-(threshold / 100) * 2.2).toFixed(2)),
    isolationGamma: Number((1 + fade / 100 * 0.65).toFixed(2)),
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
    case "glow": {
      const config = getGlowConfig(payload);
      await duplicateActiveLayer(action, `${config.layerName} Core`);
      await applyHueSaturation(action, config.saturation);
      await applyExposureIsolation(action, config.isolationExposure, config.isolationGamma);
      await applyGaussianBlur(action, config.coreRadius);
      await setActiveLayerStyle(action, config.coreOpacity, "screen");

      await duplicateActiveLayer(action, `${config.layerName} Mid`);
      await applyGaussianBlur(action, config.midBlurIncrement);
      await setActiveLayerStyle(action, config.midOpacity, "screen");

      await duplicateActiveLayer(action, `${config.layerName} Bloom`);
      await applyGaussianBlur(action, config.bloomBlurIncrement);
      await setActiveLayerStyle(action, config.bloomOpacity, "screen");
      await renameActiveLayer(action, config.layerName);

      const activeLayer = app.activeDocument && app.activeDocument.activeLayers && app.activeDocument.activeLayers[0];
      return buildToolCommandResponse(actionName, app, `Created highlight glow: strength ${config.strength}%, radius ${config.radius}, threshold ${config.threshold}%.`, {
        layerName: String((activeLayer && activeLayer.name) || config.layerName),
        strength: config.strength,
        radius: config.radius,
        threshold: config.threshold,
        fade: config.fade,
        saturation: config.saturation,
        coreRadius: config.coreRadius,
        bloomRadius: config.bloomRadius,
        coreOpacity: config.coreOpacity,
        bloomOpacity: config.bloomOpacity,
        layerId: Number((activeLayer && activeLayer.id) || 0) || 0
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
