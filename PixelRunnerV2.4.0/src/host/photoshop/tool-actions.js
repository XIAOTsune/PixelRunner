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

async function runDialogToolAction(actionName, core, action, app) {
  if (actionName === "gaussianBlur") {
    await runDialogCommandWithFallback(core, action, {
      label: "Gaussian Blur",
      menuKey: "gaussianBlur",
      descriptor: { _obj: "gaussianBlur", radius: { _unit: "pixelsUnit", _value: 5 } },
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
    await runDialogCommandWithFallback(core, action, {
      label: "High Pass",
      menuKey: "highPass",
      descriptor: { _obj: "highPass", radius: { _unit: "pixelsUnit", _value: 2 } },
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

  const dialogResult = await runDialogToolAction(actionName, core, action, app);
  if (dialogResult) return dialogResult;

  const selectionResult = await runSelectionBasedToolAction(actionName, core, action, app, document);
  if (selectionResult) return selectionResult;

  return core.executeAsModal(async () => {
    return runModalToolAction(actionName, payload, app, document, action, constants);
  }, {
    commandName: `PixelRunner Tool: ${actionName}`
  });
}
