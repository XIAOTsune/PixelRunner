const { app, core, action } = require("photoshop");

function ensureActiveDocument() {
  const doc = app.activeDocument;
  if (!doc) {
    throw new Error("Please open or activate a Photoshop document first.");
  }
  return doc;
}

async function createNeutralGrayLayer() {
  await core.executeAsModal(async () => {
    await action.batchPlay([
      { _obj: "make", _target: [{ _ref: "layer" }] },
      {
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: { _obj: "layer", name: "Neutral Gray (D&B)" }
      },
      {
        _obj: "fill",
        using: { _enum: "fillContents", _value: "gray" },
        opacity: { _unit: "percentUnit", _value: 100 },
        mode: { _enum: "blendMode", _value: "normal" }
      },
      {
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: { _obj: "layer", mode: { _enum: "blendMode", _value: "softLight" } }
      }
    ], {});
  }, { commandName: "Create Neutral Gray" });
}

async function createObserverLayer() {
  await core.executeAsModal(async () => {
    await action.batchPlay([{ _obj: "make", _target: [{ _ref: "layerSection" }] }], {});
    await action.batchPlay([
      {
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: { _obj: "layer", name: "== Observer Group ==" }
      }
    ], {});

    await action.batchPlay([
      {
        _obj: "make",
        _target: [{ _ref: "adjustmentLayer" }],
        using: {
          _obj: "adjustmentLayer",
          type: {
            _obj: "blackAndWhite",
            red: 40,
            yellow: 60,
            green: 40,
            cyan: 60,
            blue: 20,
            magenta: 80
          }
        }
      }
    ], {});

    await action.batchPlay([
      {
        _obj: "make",
        _target: [{ _ref: "adjustmentLayer" }],
        using: { _obj: "adjustmentLayer", type: { _obj: "curves" } }
      }
    ], {});
  }, { commandName: "Create Observer Layer" });
}

async function stampVisibleLayers() {
  await core.executeAsModal(async () => {
    const doc = app.activeDocument;
    if (!doc) return;

    const beforeCount = Array.isArray(doc.layers) ? doc.layers.length : null;
    let stamped = false;

    try {
      await action.batchPlay([{ _obj: "mergeVisible", duplicate: true }], {});
      stamped = true;
    } catch (_) {
      try {
        await action.batchPlay([
          { _obj: "selectAll", _target: [{ _ref: "channel", _enum: "channel", _value: "component" }] }
        ], {});
        await action.batchPlay([{ _obj: "copyTheMergedLayers" }], {});
        await action.batchPlay([{ _obj: "paste" }], {});
        stamped = true;
      } catch (error) {
        console.error("[PS] stampVisibleLayers failed", error);
        return;
      }
    }

    if (!stamped) return;
    const afterCount = Array.isArray(doc.layers) ? doc.layers.length : null;
    if (beforeCount === null || afterCount === null || afterCount > beforeCount) {
      await action.batchPlay([
        {
          _obj: "set",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          to: { _obj: "layer", name: "Stamped Layer" }
        }
      ], {});
    }
  }, { commandName: "Stamp Visible Layers" });
}

function ensureSelectionExists(doc = app.activeDocument) {
  try {
    const bounds = doc && doc.selection && doc.selection.bounds;
    return Boolean(bounds);
  } catch (_) {
    return false;
  }
}

function assertBatchPlaySucceeded(result, label) {
  const first = Array.isArray(result) ? result[0] : null;
  if (first && first._obj === "error" && Number(first.result) !== 0) {
    throw new Error(first.message || `${label} failed`);
  }
}

const TOOL_MENU_KEYWORDS = {
  gaussianBlur: ["gaussian blur"],
  smartSharpen: ["smart sharpen"],
  highPass: ["high pass"],
  contentAwareFill: ["content-aware fill"]
};

const TOOL_MENU_SCAN_RANGE = { start: 900, end: 5000 };
let toolMenuIdsCache = null;
let toolMenuIdsPromise = null;

function normalizeMenuTitle(title) {
  return String(title || "")
    .replace(/\u2026/g, "...")
    .trim()
    .toLowerCase();
}

async function scanToolMenuIds() {
  const ids = {};
  if (!core || typeof core.getMenuCommandTitle !== "function") return ids;

  const keys = Object.keys(TOOL_MENU_KEYWORDS);
  for (let commandID = TOOL_MENU_SCAN_RANGE.start; commandID <= TOOL_MENU_SCAN_RANGE.end; commandID += 1) {
    let title = "";
    try {
      title = await core.getMenuCommandTitle({ commandID });
    } catch (_) {
      continue;
    }

    const normalized = normalizeMenuTitle(title);
    if (!normalized) continue;

    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (ids[key]) continue;
      const patterns = TOOL_MENU_KEYWORDS[key];
      for (let j = 0; j < patterns.length; j += 1) {
        if (normalized.includes(patterns[j])) {
          ids[key] = commandID;
          break;
        }
      }
    }

    if (keys.every((key) => Boolean(ids[key]))) break;
  }

  return ids;
}

async function getToolMenuIds() {
  if (toolMenuIdsCache) return toolMenuIdsCache;
  if (!toolMenuIdsPromise) {
    toolMenuIdsPromise = scanToolMenuIds()
      .then((ids) => {
        toolMenuIdsCache = ids;
        return ids;
      })
      .finally(() => {
        toolMenuIdsPromise = null;
      });
  }
  return toolMenuIdsPromise;
}

async function runMenuCommandByKey(menuKey, label) {
  if (!core || typeof core.performMenuCommand !== "function") {
    throw new Error("Current Photoshop host does not support menu commands.");
  }

  const ids = await getToolMenuIds();
  const commandID = ids[menuKey];
  if (!commandID) {
    throw new Error(`${label}: menu command not found.`);
  }

  if (typeof core.getMenuCommandState === "function") {
    try {
      const enabled = await core.getMenuCommandState({ commandID });
      if (enabled === false) {
        throw new Error(`${label}: menu command is currently disabled.`);
      }
    } catch (error) {
      const msg = String((error && error.message) || "").toLowerCase();
      if (msg.includes("disabled")) throw error;
    }
  }

  const ok = await core.performMenuCommand({ commandID });
  if (ok === false) {
    throw new Error(`${label}: menu command failed.`);
  }
}

async function runSingleCommandWithDialog(descriptor, label) {
  const command = {
    ...descriptor,
    _options: {
      ...(descriptor._options || {}),
      dialogOptions: "display"
    }
  };

  const result = await action.batchPlay([command], {});
  assertBatchPlaySucceeded(result, label);
  return result;
}

async function runDialogCommandWithFallback({ label, menuKey, descriptor, commandName }) {
  let menuError = null;
  try {
    await runMenuCommandByKey(menuKey, label);
    return;
  } catch (error) {
    menuError = error;
  }

  try {
    await core.executeAsModal(async () => {
      await runSingleCommandWithDialog(descriptor, label);
    }, { commandName, interactive: true });
    return;
  } catch (batchError) {
    const menuMsg = menuError && menuError.message ? menuError.message : String(menuError || "");
    const batchMsg = batchError && batchError.message ? batchError.message : String(batchError || "");
    throw new Error(`${label} failed. Menu: ${menuMsg}; BatchPlay: ${batchMsg}`);
  }
}

async function runGaussianBlur() {
  ensureActiveDocument();
  await runDialogCommandWithFallback({
    label: "Gaussian Blur",
    menuKey: "gaussianBlur",
    descriptor: {
      _obj: "gaussianBlur",
      radius: { _unit: "pixelsUnit", _value: 5 }
    },
    commandName: "Gaussian Blur"
  });
}

async function runSharpen() {
  ensureActiveDocument();
  await runDialogCommandWithFallback({
    label: "Smart Sharpen",
    menuKey: "smartSharpen",
    descriptor: { _obj: "smartSharpen" },
    commandName: "Smart Sharpen"
  });
}

async function runHighPass() {
  ensureActiveDocument();
  await runDialogCommandWithFallback({
    label: "High Pass",
    menuKey: "highPass",
    descriptor: {
      _obj: "highPass",
      radius: { _unit: "pixelsUnit", _value: 2 }
    },
    commandName: "High Pass"
  });
}

async function runContentAwareFill() {
  const doc = ensureActiveDocument();
  if (!ensureSelectionExists(doc)) {
    throw new Error("Please create a selection before running Content-Aware Fill.");
  }
  await runDialogCommandWithFallback({
    label: "Content-Aware Fill",
    menuKey: "contentAwareFill",
    descriptor: { _obj: "contentAwareFill" },
    commandName: "Content-Aware Fill"
  });
}

module.exports = {
  createNeutralGrayLayer,
  createObserverLayer,
  stampVisibleLayers,
  runGaussianBlur,
  runSharpen,
  runHighPass,
  runContentAwareFill
};
