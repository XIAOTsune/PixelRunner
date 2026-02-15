const { app, core, action } = require("photoshop");
const { storage } = require("uxp");

const fs = storage.localFileSystem;
const formats = storage.formats;

function toPixelNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }
  if (value && typeof value === "object") {
    if (typeof value._value === "number" && Number.isFinite(value._value)) return value._value;
    if (typeof value.value === "number" && Number.isFinite(value.value)) return value.value;
  }
  return fallback;
}

function getDocSizePx(doc) {
  const width = Math.max(1, Math.round(toPixelNumber(doc && doc.width, 1)));
  const height = Math.max(1, Math.round(toPixelNumber(doc && doc.height, 1)));
  return { width, height };
}

function parseRawBounds(rawBounds) {
  if (!rawBounds) return null;
  if (Array.isArray(rawBounds) && rawBounds.length >= 4) {
    return {
      left: toPixelNumber(rawBounds[0], 0),
      top: toPixelNumber(rawBounds[1], 0),
      right: toPixelNumber(rawBounds[2], 0),
      bottom: toPixelNumber(rawBounds[3], 0)
    };
  }
  if (typeof rawBounds === "object") {
    return {
      left: toPixelNumber(rawBounds.left, 0),
      top: toPixelNumber(rawBounds.top, 0),
      right: toPixelNumber(rawBounds.right, 0),
      bottom: toPixelNumber(rawBounds.bottom, 0)
    };
  }
  return null;
}

function buildCropBounds(rawBounds, doc) {
  const size = getDocSizePx(doc);
  const parsed = parseRawBounds(rawBounds);
  if (!parsed) return { left: 0, top: 0, right: size.width, bottom: size.height };

  const left = Math.max(0, Math.min(size.width - 1, Math.round(parsed.left)));
  const top = Math.max(0, Math.min(size.height - 1, Math.round(parsed.top)));
  const right = Math.max(left + 1, Math.min(size.width, Math.round(parsed.right)));
  const bottom = Math.max(top + 1, Math.min(size.height, Math.round(parsed.bottom)));
  return { left, top, right, bottom };
}

async function closeDocNoSave(docRef) {
  if (!docRef) return;
  if (typeof docRef.closeWithoutSaving === "function") {
    await docRef.closeWithoutSaving();
    return;
  }
  await action.batchPlay([{
    _obj: "close",
    _target: [{ _ref: "document", _id: docRef.id }],
    saving: { _enum: "yesNo", _value: "no" }
  }], {});
}

async function exportDocPngToArrayBuffer(docId, fileName = "capture.png") {
  const tempFolder = await fs.getTemporaryFolder();
  const tempFile = await tempFolder.createFile(fileName, { overwrite: true });
  const sessionToken = await fs.createSessionToken(tempFile);

  await action.batchPlay([{
    _obj: "save",
    as: { _obj: "PNGFormat", method: { _enum: "PNGMethod", _value: "quick" } },
    in: { _path: sessionToken, _kind: "local" },
    documentID: docId,
    copy: true,
    lowerCase: true,
    saveStage: { _enum: "saveStageType", _value: "saveStageOS" }
  }], {});

  return tempFile.read({ format: formats.binary });
}

function isNearlyFullBounds(bounds, doc) {
  if (!bounds || !doc) return false;
  const docSize = getDocSizePx(doc);
  const clamped = buildCropBounds(bounds, doc);
  return (
    Math.abs(clamped.left) <= 1 &&
    Math.abs(clamped.top) <= 1 &&
    Math.abs(clamped.right - docSize.width) <= 1 &&
    Math.abs(clamped.bottom - docSize.height) <= 1
  );
}

async function captureSelection(options = {}) {
  const log = options.log || (() => {});
  try {
    const doc = app.activeDocument;
    if (!doc) {
      log("请先在 Photoshop 中打开文档", "error");
      return null;
    }

    let capturedBuffer = null;
    let selectionBounds = null;
    let originalSelectionBounds = null;
    try {
      originalSelectionBounds = doc.selection && doc.selection.bounds;
    } catch (_) {}

    await core.executeAsModal(async () => {
      const rawSelection = parseRawBounds(originalSelectionBounds);
      const useFullDocFastPath = !rawSelection || isNearlyFullBounds(rawSelection, doc);
      if (useFullDocFastPath) {
        selectionBounds = buildCropBounds(null, doc);
        capturedBuffer = await exportDocPngToArrayBuffer(doc.id, "capture_full.png");
        return;
      }

      let tempDoc = null;
      try {
        tempDoc = await doc.duplicate("rh_capture_temp");
        try {
          await tempDoc.flatten();
        } catch (_) {}

        let tempSelectionBounds = null;
        try {
          tempSelectionBounds = tempDoc.selection && tempDoc.selection.bounds;
        } catch (_) {}

        const cropBounds = buildCropBounds(originalSelectionBounds || tempSelectionBounds, tempDoc);
        selectionBounds = { ...cropBounds };
        await tempDoc.crop(cropBounds);
        capturedBuffer = await exportDocPngToArrayBuffer(tempDoc.id, "capture_selection.png");
      } finally {
        await closeDocNoSave(tempDoc);
      }
    }, { commandName: "Capture Selection" });

    if (!capturedBuffer) return null;
    return { arrayBuffer: capturedBuffer, selectionBounds };
  } catch (e) {
    log(`捕获选区失败: ${e.message}`, "error");
    return null;
  }
}

function parseLayerBounds(bounds) {
  const parsed = parseRawBounds(bounds);
  if (!parsed) return null;
  if (parsed.right <= parsed.left || parsed.bottom <= parsed.top) return null;
  return parsed;
}

function getBoundsSize(bounds) {
  return {
    width: Math.max(1, bounds.right - bounds.left),
    height: Math.max(1, bounds.bottom - bounds.top)
  };
}

function getBoundsCenter(bounds) {
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2
  };
}

async function transformLayerScale(layerId, scaleXPercent, scaleYPercent) {
  await action.batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _id: layerId }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    width: { _unit: "percentUnit", _value: scaleXPercent },
    height: { _unit: "percentUnit", _value: scaleYPercent },
    linked: false
  }], {});
}

async function transformLayerOffset(layerId, dx, dy) {
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

async function alignActiveLayerToBounds(targetBounds) {
  const doc = app.activeDocument;
  const layer = doc && doc.activeLayers && doc.activeLayers[0];
  if (!layer) return;

  const layerId = layer.id;
  const currentBounds0 = parseLayerBounds(layer.bounds);
  if (!currentBounds0) return;

  const cSize = getBoundsSize(currentBounds0);
  const tSize = getBoundsSize(targetBounds);
  const scaleX = (tSize.width / cSize.width) * 100;
  const scaleY = (tSize.height / cSize.height) * 100;

  if (Number.isFinite(scaleX) && Number.isFinite(scaleY) && (Math.abs(scaleX - 100) > 0.2 || Math.abs(scaleY - 100) > 0.2)) {
    await transformLayerScale(layerId, scaleX, scaleY);
  }

  const layerAfterScale = doc.activeLayers && doc.activeLayers[0];
  const currentBounds1 = parseLayerBounds(layerAfterScale && layerAfterScale.bounds);
  if (!currentBounds1) return;

  const cCenter = getBoundsCenter(currentBounds1);
  const tCenter = getBoundsCenter(targetBounds);
  const dx = tCenter.x - cCenter.x;
  const dy = tCenter.y - cCenter.y;

  if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
    await transformLayerOffset(layerId, dx, dy);
  }
}

async function placeImage(arrayBuffer, options = {}) {
  const log = options.log || (() => {});
  const targetBoundsRaw = options.targetBounds || null;

  await core.executeAsModal(async () => {
    const doc = app.activeDocument;
    const tempFolder = await fs.getTemporaryFolder();
    const tempFile = await tempFolder.createFile("result.png", { overwrite: true });
    await tempFile.write(arrayBuffer, { format: formats.binary });
    const sessionToken = await fs.createSessionToken(tempFile);

    await action.batchPlay([{
      _obj: "placeEvent",
      ID: 5,
      null: { _path: sessionToken, _kind: "local" },
      freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
      offset: {
        _obj: "offset",
        horizontal: { _unit: "pixelsUnit", _value: 0 },
        vertical: { _unit: "pixelsUnit", _value: 0 }
      }
    }], {});

    if (!targetBoundsRaw) return;

    const targetBounds = buildCropBounds(targetBoundsRaw, doc);
    try {
      await alignActiveLayerToBounds(targetBounds);
    } catch (e) {
      log(`结果图对齐失败，已保留默认位置: ${e.message}`, "warn");
    }
  }, { commandName: "Place AI Result" });
}

/**
 * 创建中性灰图层（用于加深减淡）
 * 逻辑：新建图层 -> 填充50%灰 -> 模式设为柔光
 */
async function createNeutralGrayLayer() {
  await core.executeAsModal(async () => {
    await action.batchPlay([
      // 1. 创建新图层
      { _obj: "make", _target: [{ _ref: "layer" }] },
      // 2. 命名
      { _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "layer", name: "中性灰 (D&B)" } },
      // 3. 填充 50% 灰
      { _obj: "fill", using: { _enum: "fillContents", _value: "gray" }, opacity: { _unit: "percentUnit", _value: 100 }, mode: { _enum: "blendMode", _value: "normal" } },
      // 4. 混合模式改为柔光 (Soft Light)
      { _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "layer", mode: { _enum: "blendMode", _value: "softLight" } } }
    ], {});
  }, { commandName: "新建中性灰" });
}

/**
 * 创建观察组（黑白观察层 + 曲线）
 */
async function createObserverLayer() {
  await core.executeAsModal(async () => {
    // 1. 创建图层组
    await action.batchPlay([{ _obj: "make", _target: [{ _ref: "layerSection" }] }], {});
    await action.batchPlay([{ _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "layer", name: "== 观察组 ==" } }], {});

    // 2. 创建黑白调整层 (让画面变黑白)
    await action.batchPlay([{ _obj: "make", _target: [{ _ref: "adjustmentLayer" }], using: { _obj: "adjustmentLayer", type: { _obj: "blackAndWhite", red: 40, yellow: 60, green: 40, cyan: 60, blue: 20, magenta: 80 } } }], {});
    
    // 3. 创建曲线调整层 (增加对比度)
    // 这里简化处理，直接创建一个空的曲线层，用户自己调
    await action.batchPlay([{ _obj: "make", _target: [{ _ref: "adjustmentLayer" }], using: { _obj: "adjustmentLayer", type: { _obj: "curves" } } }], {});
  }, { commandName: "创建观察层" });
}

/**
 * 盖印可见图层
 */
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
        // 备用方案：复制合并 + 粘贴
        await action.batchPlay([{ _obj: "selectAll", _target: [{ _ref: "channel", _enum: "channel", _value: "component" }] }], {});
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
        { _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "layer", name: "盖印图层" } }
      ], {});
    }
  }, { commandName: "盖印图层" });
}

// 记得在 module.exports 里导出这些新函数
module.exports = {
  captureSelection,
  placeImage,
  createNeutralGrayLayer, // 新增
  createObserverLayer,    // 新增
  stampVisibleLayers      // 新增
};
