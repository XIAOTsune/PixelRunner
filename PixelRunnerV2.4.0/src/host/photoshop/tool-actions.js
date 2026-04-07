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
  const baseOpacity = Math.round(14 + strength * 0.3);
  const fadeRatio = 1 - fade / 150;
  const coreRadius = Math.max(0.8, Number((radius * 0.28).toFixed(1)));
  const midRadius = Math.max(coreRadius + 0.5, Number((radius * 0.62).toFixed(1)));
  const bloomRadius = Math.max(midRadius + 0.5, Number((radius * 1.2).toFixed(1)));
  const highlightFuzziness = clampNumber(Math.round(10 + radius * 0.22 + fade * 0.18), 6, 42, 18);
  const channelOutputClamp = clampNumber(Math.round(18 + threshold * 0.28 + fade * 0.1), 0, 120, 30);
  const sourceSaturation = clampNumber(Math.round(-24 + saturation * 0.4), -100, 50, -24);
  const finalSaturation = clampNumber(Math.round(saturation * 0.85), -100, 100, 0);
  const finalVibrance = clampNumber(Math.round(saturation * 0.65), -100, 100, 0);
  const highlightLowerLimit = clampNumber(Math.round(208 + threshold * 0.42), 180, 252, 220);
  return {
    strength,
    radius,
    threshold,
    fade,
    saturation,
    sourceSaturation,
    finalSaturation,
    finalVibrance,
    coreRadius,
    midRadius,
    bloomRadius,
    glowRadii: [
      Math.max(0.7, Number((radius * 0.18).toFixed(1))),
      Math.max(1.1, Number((radius * 0.4).toFixed(1))),
      Math.max(1.8, Number((radius * 0.7).toFixed(1))),
      Math.max(2.4, Number((radius * 1.05).toFixed(1))),
      Math.max(3.2, Number((radius * 1.45).toFixed(1)))
    ],
    glowOpacities: [
      Math.min(72, Math.max(18, baseOpacity)),
      Math.min(60, Math.max(14, Math.round(baseOpacity * (0.82 * fadeRatio)))),
      Math.min(50, Math.max(10, Math.round(baseOpacity * (0.64 * fadeRatio)))),
      Math.min(42, Math.max(8, Math.round(baseOpacity * (0.48 * fadeRatio)))),
      Math.min(34, Math.max(6, Math.round(baseOpacity * (0.34 * fadeRatio))))
    ],
    sourceOpacity: Math.min(54, Math.max(12, Math.round(baseOpacity * 0.65))),
    isolationExposure: Number((-(0.05 + threshold / 100 * 0.35)).toFixed(2)),
    isolationGamma: Number((1.02 + fade / 100 * 0.2).toFixed(2)),
    glowExposure: Number((-(0.08 + fade / 100 * 0.1)).toFixed(2)),
    glowGamma: Number((1.12 + fade / 100 * 0.14).toFixed(2)),
    finalGamma: Number((1.02 + fade / 100 * 0.12).toFixed(2)),
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

async function convertDocumentTo8Bit(action) {
  await action.batchPlay([{
    _obj: "convertMode",
    depth: 8,
    merge: false
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
      const saveOptions = constants.SaveOptions || {};
      const originalDocument = document;
      const sourceName = `${config.layerName} Source`;
      const baseName = `${config.layerName} Base`;
      let tempDoc = null;
      let importedLayer = null;

      try {
        tempDoc = await document.duplicate(`${config.layerName} Temp`, true);
        app.activeDocument = tempDoc;

        await convertDocumentTo8Bit(action);
        await renameActiveLayer(action, baseName);
        await selectHighlights(action, config);
        await copySelectionToLayer(action);
        await renameActiveLayer(action, sourceName);
        await clearSelection(action);
        await deleteLayerByName(action, baseName);

        if (config.sourceSaturation !== 0) {
          await applyHueSaturation(action, config.sourceSaturation);
        }
        if (Math.abs(config.isolationExposure) > 0.01 || Math.abs(config.isolationGamma - 1) > 0.01) {
          await applyExposureIsolation(action, config.isolationExposure, config.isolationGamma);
        }
        await selectChannel(action, "red");
        await applyLevelsOutput(action, 242);
        await selectChannel(action, "grain");
        await applyLevelsOutput(action, 242);
        await selectChannel(action, "blue");
        await applyLevelsOutput(action, 242);
        await selectChannel(action, "RGB");

        for (let index = 0; index < config.glowRadii.length; index += 1) {
          await selectLayerByName(action, sourceName);
          await duplicateActiveLayer(action, `${config.layerName} Glow ${index + 1}`);
          await renameActiveLayer(action, `${config.layerName} Glow ${index + 1}`);
          await applyGaussianBlur(action, config.glowRadii[index]);
          await applyExposureIsolation(action, config.glowExposure, config.glowGamma);
          await setActiveLayerStyle(action, config.glowOpacities[index], "screen");
        }

        await deleteLayerByName(action, sourceName);
        await mergeVisibleLayers(action);
        await renameActiveLayer(action, config.layerName);

        await applyExposureIsolation(action, 0, config.finalGamma);
        const outputMax = Math.max(96, 255 - config.channelOutputClamp);
        await selectChannel(action, "red");
        await applyLevelsOutput(action, outputMax);
        await selectChannel(action, "grain");
        await applyLevelsOutput(action, outputMax);
        await selectChannel(action, "blue");
        await applyLevelsOutput(action, outputMax);
        await selectChannel(action, "RGB");
        if (config.finalVibrance !== 0 || config.finalSaturation !== 0) {
          await applyVibrance(action, config.finalVibrance, config.finalSaturation);
        }
        await setActiveLayerStyle(action, 100, "screen");

        const tempResultLayer = tempDoc && tempDoc.activeLayers && tempDoc.activeLayers[0];
        if (!tempResultLayer) {
          throw new Error("Glow result layer was not created.");
        }

        importedLayer = await tempResultLayer.duplicate(originalDocument);
        app.activeDocument = originalDocument;
        if (importedLayer) {
          try {
            importedLayer.name = config.layerName;
          } catch (_) {}
        }
        await renameActiveLayer(action, config.layerName);
        await setActiveLayerStyle(action, 100, "screen");
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

      const activeLayer = app.activeDocument && app.activeDocument.activeLayers && app.activeDocument.activeLayers[0];
      return buildToolCommandResponse(actionName, app, `Created rebuilt glow layer from isolated highlight source: strength ${config.strength}%, radius ${config.radius}, threshold ${config.threshold}%.`, {
        layerName: String((importedLayer && importedLayer.name) || (activeLayer && activeLayer.name) || config.layerName),
        strength: config.strength,
        radius: config.radius,
        threshold: config.threshold,
        fade: config.fade,
        saturation: config.saturation,
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
