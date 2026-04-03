var PixelRunnerHostBundle = (() => {
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });

  // src/host/photoshop/deps.js
  async function ensureDeps() {
    if (typeof __require !== "function") {
      throw new Error("Photoshop host dependencies are unavailable");
    }
    const photoshop = __require("photoshop");
    const uxp = __require("uxp");
    if (!photoshop || !uxp || !uxp.storage) {
      throw new Error("Photoshop or UXP storage module is unavailable");
    }
    return {
      photoshop,
      storage: uxp.storage
    };
  }
  async function fetchBinary(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download result (HTTP ${response.status})`);
    }
    return response.arrayBuffer();
  }

  // src/host/photoshop/document.js
  function toNumberValue(value) {
    if (value == null) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "object") {
      const nested = value._value ?? value.value;
      const result2 = Number(nested);
      return Number.isFinite(result2) ? result2 : null;
    }
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }
  function getDocumentInfo(doc) {
    if (!doc) {
      return {
        ok: false,
        hasActiveDocument: false
      };
    }
    return {
      ok: true,
      hasActiveDocument: true,
      documentId: Number(doc.id) || 0,
      title: String(doc.title || doc.name || "Untitled"),
      width: toNumberValue(doc.width),
      height: toNumberValue(doc.height),
      resolution: toNumberValue(doc.resolution),
      selectionBounds: getSelectionBounds(doc)
    };
  }
  function buildDataUrl(mimeType, base64) {
    return `data:${mimeType};base64,${base64}`;
  }
  function ensureSelectionExists(doc) {
    try {
      const bounds = doc && doc.selection && doc.selection.bounds;
      return Boolean(bounds);
    } catch (_) {
      return false;
    }
  }
  function normalizeBounds(rawBounds) {
    if (!rawBounds) return null;
    if (Array.isArray(rawBounds) && rawBounds.length >= 4) {
      const left = toNumberValue(rawBounds[0]);
      const top = toNumberValue(rawBounds[1]);
      const right = toNumberValue(rawBounds[2]);
      const bottom = toNumberValue(rawBounds[3]);
      if (![left, top, right, bottom].every(Number.isFinite)) return null;
      if (right <= left || bottom <= top) return null;
      return { left, top, right, bottom };
    }
    if (typeof rawBounds === "object") {
      const left = toNumberValue(rawBounds.left);
      const top = toNumberValue(rawBounds.top);
      const right = toNumberValue(rawBounds.right);
      const bottom = toNumberValue(rawBounds.bottom);
      if (![left, top, right, bottom].every(Number.isFinite)) return null;
      if (right <= left || bottom <= top) return null;
      return { left, top, right, bottom };
    }
    return null;
  }
  function getSelectionBounds(doc) {
    try {
      return normalizeBounds(doc && doc.selection && doc.selection.bounds);
    } catch (_) {
      return null;
    }
  }
  function listOpenDocuments(app) {
    const docs = app && app.documents;
    if (!docs) return [];
    if (Array.isArray(docs)) return docs;
    if (typeof docs.length === "number") return Array.from(docs);
    if (typeof docs.forEach === "function") {
      const out = [];
      docs.forEach((item) => out.push(item));
      return out;
    }
    return [];
  }
  function findOpenDocumentById(app, documentId) {
    const targetId = Number(documentId);
    if (!Number.isFinite(targetId) || targetId <= 0) return null;
    return listOpenDocuments(app).find((doc) => Number(doc && doc.id) === targetId) || null;
  }
  async function activateDocument(app, action, documentId) {
    const targetId = Number(documentId);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return app && app.activeDocument ? app.activeDocument : null;
    }
    const target = findOpenDocumentById(app, targetId);
    if (!target) {
      throw new Error(`Target document is unavailable: #${targetId}`);
    }
    if (app.activeDocument && Number(app.activeDocument.id) === targetId) {
      return app.activeDocument;
    }
    if (typeof target.activate === "function") {
      try {
        await target.activate();
      } catch (_) {
      }
    }
    if (app.activeDocument && Number(app.activeDocument.id) === targetId) {
      return app.activeDocument;
    }
    try {
      app.activeDocument = target;
    } catch (_) {
    }
    if (app.activeDocument && Number(app.activeDocument.id) === targetId) {
      return app.activeDocument;
    }
    if (action && typeof action.batchPlay === "function") {
      await action.batchPlay([{
        _obj: "select",
        _target: [{ _ref: "document", _id: targetId }]
      }], {});
    }
    if (app.activeDocument && Number(app.activeDocument.id) === targetId) {
      return app.activeDocument;
    }
    throw new Error(`Failed to activate target document: #${targetId}`);
  }
  async function renameActiveLayer(layerName) {
    const trimmed = String(layerName || "").trim();
    if (!trimmed) return null;
    const { photoshop } = await ensureDeps();
    const app = photoshop.app;
    if (!app || !app.activeDocument || !app.activeDocument.activeLayers || !app.activeDocument.activeLayers.length) {
      return null;
    }
    const layer = app.activeDocument.activeLayers[0];
    try {
      layer.name = trimmed;
      return trimmed;
    } catch (_) {
      return String(layer.name || trimmed);
    }
  }
  async function ensureActiveDocument() {
    const { photoshop } = await ensureDeps();
    const app = photoshop.app;
    if (!app || !app.activeDocument) {
      throw new Error("No active Photoshop document");
    }
    return {
      photoshop,
      app,
      document: app.activeDocument
    };
  }

  // src/host/photoshop/commands.js
  function assertBatchPlaySucceeded(result, label) {
    const first = Array.isArray(result) ? result[0] : null;
    if (first && first._obj === "error" && Number(first.result) !== 0) {
      throw new Error(first.message || `${label} failed`);
    }
  }
  var TOOL_MENU_KEYWORDS = {
    gaussianBlur: ["gaussian blur"],
    smartSharpen: ["smart sharpen"],
    highPass: ["high pass"],
    selectAndMask: ["select and mask", "选择并遮住", "选择并遮罩"],
    contentAwareFill: ["content-aware fill", "content aware fill", "内容识别填充", "内容感知填充"]
  };
  var TOOL_MENU_SCAN_RANGE = { start: 900, end: 5e3 };
  var toolMenuIdsCache = null;
  var toolMenuIdsPromise = null;
  function normalizeMenuTitle(title) {
    return String(title || "").replace(/\u2026/g, "...").trim().toLowerCase();
  }
  async function scanToolMenuIds(core) {
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
  async function scanMenuIdByKey(core, menuKey, range = TOOL_MENU_SCAN_RANGE) {
    if (!core || typeof core.getMenuCommandTitle !== "function") return 0;
    const patterns = TOOL_MENU_KEYWORDS[menuKey];
    if (!Array.isArray(patterns) || patterns.length === 0) return 0;
    const start = Number(range && range.start) || TOOL_MENU_SCAN_RANGE.start;
    const end = Number(range && range.end) || TOOL_MENU_SCAN_RANGE.end;
    for (let commandID = start; commandID <= end; commandID += 1) {
      let title = "";
      try {
        title = await core.getMenuCommandTitle({ commandID });
      } catch (_) {
        continue;
      }
      const normalized = normalizeMenuTitle(title);
      if (!normalized) continue;
      for (let i = 0; i < patterns.length; i += 1) {
        if (normalized.includes(patterns[i])) {
          return commandID;
        }
      }
    }
    return 0;
  }
  async function getToolMenuIds(core) {
    if (toolMenuIdsCache) return toolMenuIdsCache;
    if (!toolMenuIdsPromise) {
      toolMenuIdsPromise = scanToolMenuIds(core).then((ids) => {
        toolMenuIdsCache = ids;
        return ids;
      }).finally(() => {
        toolMenuIdsPromise = null;
      });
    }
    return toolMenuIdsPromise;
  }
  async function runMenuCommandByKey(core, menuKey, label) {
    if (!core || typeof core.performMenuCommand !== "function") {
      throw new Error("Current Photoshop host does not support menu commands.");
    }
    const ids = await getToolMenuIds(core);
    let commandID = ids[menuKey];
    if (!commandID && menuKey === "selectAndMask") {
      const deepScanId = await scanMenuIdByKey(core, menuKey, { start: 5001, end: 12e3 });
      if (deepScanId) {
        commandID = deepScanId;
        toolMenuIdsCache = {
          ...toolMenuIdsCache || {},
          [menuKey]: deepScanId
        };
      }
    }
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
        const msg = String(error && error.message || "").toLowerCase();
        if (msg.includes("disabled")) throw error;
      }
    }
    const ok = await core.performMenuCommand({ commandID });
    if (ok === false) {
      throw new Error(`${label}: menu command failed.`);
    }
  }
  async function runSingleCommand(action, descriptor, label, dialogOptions = "dontDisplay") {
    const command = {
      ...descriptor,
      _options: {
        ...descriptor._options || {},
        dialogOptions
      }
    };
    const result = await action.batchPlay([command], {});
    assertBatchPlaySucceeded(result, label);
    return result;
  }
  async function runSingleCommandWithDialog(action, descriptor, label) {
    return runSingleCommand(action, descriptor, label, "display");
  }
  async function runDialogCommandWithFallback(core, action, options) {
    const { label, menuKey, descriptor, commandName } = options || {};
    let menuError = null;
    try {
      await runMenuCommandByKey(core, menuKey, label);
      return;
    } catch (error) {
      menuError = error;
    }
    try {
      await core.executeAsModal(async () => {
        await runSingleCommandWithDialog(action, descriptor, label);
      }, { commandName, interactive: true });
      return;
    } catch (batchError) {
      const menuMsg = menuError && menuError.message ? menuError.message : String(menuError || "");
      const batchMsg = batchError && batchError.message ? batchError.message : String(batchError || "");
      throw new Error(`${label} failed. Menu: ${menuMsg}; BatchPlay: ${batchMsg}`);
    }
  }

  // src/host/photoshop/tool-actions.js
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
  async function runSelectionBasedToolAction(actionName, core, action, app, document2) {
    if (actionName === "contentAwareFill") {
      if (!ensureSelectionExists(document2)) {
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
  async function runModalToolAction(actionName, payload, app, document2, action, constants) {
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
          layerName: String(activeLayer && activeLayer.name || payload.layerName || "Black & White Observer")
        });
      }
      case "neutralGrayLayer": {
        const layer = await document2.createLayer({
          name: "Neutral Gray Layer",
          blendMode: constants.BlendMode ? constants.BlendMode.SOFTLIGHT : void 0,
          fillNeutral: true,
          opacity: 100
        });
        return buildToolCommandResponse(actionName, app, "Created neutral gray layer.", {
          layerName: String(layer && layer.name || "Neutral Gray Layer")
        });
      }
      case "stampVisible": {
        const saveOptions = constants.SaveOptions || {};
        const tempDoc = await document2.duplicate("PixelRunner Stamp Temp", true);
        try {
          const tempLayer = tempDoc && tempDoc.activeLayers && tempDoc.activeLayers[0];
          if (!tempLayer) throw new Error("Stamp visible temp layer is unavailable");
          const duplicatedLayer = await tempLayer.duplicate(document2);
          if (duplicatedLayer) {
            try {
              duplicatedLayer.name = String(payload.layerName || "Stamp Visible");
            } catch (_) {
            }
          }
          app.activeDocument = document2;
          return buildToolCommandResponse(actionName, app, "Created stamp visible layer.", {
            layerName: String(duplicatedLayer && duplicatedLayer.name || payload.layerName || "Stamp Visible")
          });
        } finally {
          try {
            await tempDoc.close(saveOptions.DONOTSAVECHANGES);
          } catch (_) {
          }
          try {
            app.activeDocument = document2;
          } catch (_) {
          }
        }
      }
      default:
        throw new Error(`Unsupported tool action: ${actionName}`);
    }
  }
  async function runToolActionByName(payload, context) {
    const { photoshop, app, document: document2 } = context;
    const core = photoshop.core;
    const action = photoshop.action;
    const constants = photoshop.constants || {};
    const actionName = String(payload.action || "").trim();
    if (!actionName) throw new Error("Tool action is missing");
    const dialogResult = await runDialogToolAction(actionName, core, action, app);
    if (dialogResult) return dialogResult;
    const selectionResult = await runSelectionBasedToolAction(actionName, core, action, app, document2);
    if (selectionResult) return selectionResult;
    return core.executeAsModal(async () => {
      return runModalToolAction(actionName, payload, app, document2, action, constants);
    }, {
      commandName: `PixelRunner Tool: ${actionName}`
    });
  }

  // src/host/photoshop/service.js
  function getBoundsSize(bounds) {
    return {
      width: Math.max(1, Number(bounds.right) - Number(bounds.left)),
      height: Math.max(1, Number(bounds.bottom) - Number(bounds.top))
    };
  }
  function getBoundsCenter(bounds) {
    return {
      x: (Number(bounds.left) + Number(bounds.right)) / 2,
      y: (Number(bounds.top) + Number(bounds.bottom)) / 2
    };
  }
  function parseLayerBounds(bounds) {
    return normalizeBounds(bounds);
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
  async function createSelectionFromBounds(doc, bounds) {
    if (!doc || !bounds || !doc.selection || typeof doc.selection.select !== "function") return;
    const region = [
      [bounds.left, bounds.top],
      [bounds.right, bounds.top],
      [bounds.right, bounds.bottom],
      [bounds.left, bounds.bottom]
    ];
    await doc.selection.select(region);
  }
  async function applyLayerMaskFromSelection(action) {
    await action.batchPlay([{
      _obj: "make",
      new: { _class: "channel" },
      at: { _ref: "channel", _enum: "channel", _value: "mask" },
      using: { _enum: "userMaskEnabled", _value: "revealSelection" }
    }], {});
  }
  async function alignPlacedLayerToBounds(doc, action, targetBounds, options = {}) {
    const layer = doc && doc.activeLayers && doc.activeLayers[0];
    const bounds = parseLayerBounds(layer && layer.bounds);
    if (!layer || !bounds || !targetBounds) return;
    const currentSize = getBoundsSize(bounds);
    const targetSize = getBoundsSize(targetBounds);
    const scale = options.mode === "cover" ? Math.max(targetSize.width / currentSize.width, targetSize.height / currentSize.height) : Math.min(targetSize.width / currentSize.width, targetSize.height / currentSize.height);
    if (Number.isFinite(scale) && scale > 0 && Math.abs(scale - 1) > 1e-3) {
      await transformLayerScale(action, layer.id, scale * 100, scale * 100);
    }
    const nextLayer = doc && doc.activeLayers && doc.activeLayers[0];
    const nextBounds = parseLayerBounds(nextLayer && nextLayer.bounds);
    if (!nextLayer || !nextBounds) return;
    const currentCenter = getBoundsCenter(nextBounds);
    const targetCenter = getBoundsCenter(targetBounds);
    const dx = targetCenter.x - currentCenter.x;
    const dy = targetCenter.y - currentCenter.y;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      await transformLayerOffset(action, nextLayer.id, dx, dy);
    }
    if (options.applyMask) {
      await createSelectionFromBounds(doc, targetBounds);
      await applyLayerMaskFromSelection(action);
    }
  }
  async function getActiveDocumentInfo() {
    const { photoshop } = await ensureDeps();
    return getDocumentInfo(photoshop.app && photoshop.app.activeDocument);
  }
  async function captureDocumentPreview(options = {}) {
    const { photoshop } = await ensureDeps();
    const app = photoshop.app;
    const imaging = photoshop.imaging;
    const doc = app && app.activeDocument;
    if (!doc) throw new Error("No active Photoshop document");
    if (!imaging || typeof imaging.getPixels !== "function" || typeof imaging.encodeImageData !== "function") {
      throw new Error("Photoshop imaging API is unavailable");
    }
    const docInfo = getDocumentInfo(doc);
    const maxDimension = Math.max(256, Math.min(4096, Math.floor(Number(options.maxDimension) || 1536)));
    const quality = Math.max(20, Math.min(100, Math.floor(Number(options.quality) || 82)));
    const width = Math.max(1, Number(docInfo.width) || 1);
    const height = Math.max(1, Number(docInfo.height) || 1);
    const ratio = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * ratio));
    const targetHeight = Math.max(1, Math.round(height * ratio));
    let pixels = null;
    try {
      pixels = await imaging.getPixels({
        documentID: Number(doc.id),
        targetSize: { width: targetWidth, height: targetHeight },
        componentSize: 8,
        applyAlpha: true
      });
      const encoded = await imaging.encodeImageData({
        imageData: pixels.imageData,
        base64: true,
        format: "jpeg",
        quality
      });
      const base64 = String(encoded || "");
      return {
        ok: true,
        kind: "captured-document-image",
        source: "photoshop-document",
        document: docInfo,
        documentId: docInfo.documentId,
        width: targetWidth,
        height: targetHeight,
        originalWidth: width,
        originalHeight: height,
        mimeType: "image/jpeg",
        quality,
        maxDimension,
        base64,
        dataUrl: buildDataUrl("image/jpeg", base64)
      };
    } finally {
      try {
        pixels && pixels.imageData && typeof pixels.imageData.dispose === "function" && pixels.imageData.dispose();
      } catch (_) {
      }
    }
  }
  async function runToolAction(payload = {}) {
    const context = await ensureActiveDocument();
    return runToolActionByName(payload, context);
  }
  async function placeImageFromUrl(payload) {
    const options = payload && typeof payload === "object" ? payload : {};
    const url = String(options.url || "").trim();
    if (!url) throw new Error("Result URL is missing");
    const { photoshop, storage } = await ensureDeps();
    const app = photoshop.app;
    const core = photoshop.core;
    const action = photoshop.action;
    if (!app || !app.activeDocument) throw new Error("No active Photoshop document");
    const buffer = await fetchBinary(url);
    const fs = storage.localFileSystem;
    const formats = storage.formats;
    const tempFolder = await fs.getTemporaryFolder();
    const tempFile = await tempFolder.createFile("pixelrunner-result.png", { overwrite: true });
    await tempFile.write(buffer, { format: formats.binary });
    const sessionToken = await fs.createSessionToken(tempFile);
    const targetDocumentId = Number(options.targetDocumentId || options.sourceDocumentId);
    const targetBounds = normalizeBounds(options.targetBounds);
    const placementMode = String(options.fitMode || "contain").trim().toLowerCase() === "cover" ? "cover" : "contain";
    const applyMask = options.applyMask !== false;
    await core.executeAsModal(async () => {
      const targetDocument = await activateDocument(app, action, targetDocumentId);
      await action.batchPlay([{
        _obj: "placeEvent",
        null: { _path: sessionToken, _kind: "local" },
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        offset: {
          _obj: "offset",
          horizontal: { _unit: "pixelsUnit", _value: 0 },
          vertical: { _unit: "pixelsUnit", _value: 0 }
        }
      }], {});
      if (targetBounds) {
        await alignPlacedLayerToBounds(targetDocument || app.activeDocument, action, targetBounds, {
          mode: placementMode,
          applyMask
        });
      }
    }, { commandName: "Place PixelRunner Result" });
    const layerName = await renameActiveLayer(options.layerName);
    const latestInfo = getDocumentInfo(app.activeDocument);
    return {
      ok: true,
      placed: true,
      documentId: Number(latestInfo.documentId) || 0,
      layerName: layerName || null,
      document: latestInfo,
      targetBounds
    };
  }

  // src/host/photoshop.js
  (function initPixelRunnerHostPhotoshop(global) {
    global.PixelRunnerHost = global.PixelRunnerHost || {};
    global.PixelRunnerHost.photoshop = {
      getActiveDocumentInfo,
      captureDocumentPreview,
      runToolAction,
      placeImageFromUrl
    };
  })(window);

  // src/host/bridge.js
  function getById(id) {
    return document.getElementById(id);
  }
  function registerListener(target, type, listener) {
    if (!target || typeof target.addEventListener !== "function") {
      return () => {
      };
    }
    target.addEventListener(type, listener);
    return () => {
      try {
        target.removeEventListener(type, listener);
      } catch (_) {
      }
    };
  }
  function setHostStatus(message, level = "info") {
    const statusEl = getById("hostStatus");
    if (!statusEl) return;
    statusEl.textContent = String(message || "");
    statusEl.classList.remove("is-info", "is-success", "is-warning");
    statusEl.classList.add(`is-${level}`);
  }
  function createBridgeResponse(message, result, error) {
    return {
      id: message && message.id,
      result: error ? null : result,
      error: error ? {
        message: String(error && error.message ? error.message : error || "Unknown bridge error")
      } : null
    };
  }

  // src/host/runninghub.js
  var runninghubTaskControllers = /* @__PURE__ */ new Map();
  function normalizeAppId(value) {
    return String(value == null ? "" : value).trim();
  }
  function parseBooleanValue(value) {
    if (value === true || value === false) return value;
    const marker = String(value == null ? "" : value).trim().toLowerCase();
    if (!marker) return null;
    if (["true", "1", "yes", "y", "on", "shi", "是"].includes(marker)) return true;
    if (["false", "0", "no", "n", "off", "fou", "否"].includes(marker)) return false;
    return null;
  }
  function isFilledInputValue(value) {
    if (value === void 0 || value === null) return false;
    if (typeof value === "boolean") return true;
    if (typeof value === "object") {
      return Boolean(
        typeof value.dataUrl === "string" && value.dataUrl.trim() || typeof value.base64 === "string" && value.base64.trim() || typeof value.url === "string" && value.url.trim()
      );
    }
    return String(value).trim() !== "";
  }
  function normalizeImageInputValue(input, value) {
    if (!value || typeof value !== "object") {
      return value;
    }
    if (input && input.passObject === true) {
      return value;
    }
    const mode = String(
      input && (input.imageValueMode || input.valueMode || input.transferMode || input.transport) || ""
    ).trim().toLowerCase();
    if (mode === "base64") {
      return String(value.base64 || "");
    }
    if (mode === "url") {
      return String(value.url || "");
    }
    if (mode === "object" || mode === "json") {
      return value;
    }
    return String(value.dataUrl || value.base64 || value.url || "");
  }
  function normalizeInputValue(input, value) {
    const typeMarker = String(input && input.type || "").trim().toLowerCase();
    if (typeMarker === "image" || typeMarker === "file") {
      return normalizeImageInputValue(input, value);
    }
    if (typeMarker === "number" || typeMarker === "int" || typeMarker === "float") {
      const num = Number(value);
      return Number.isFinite(num) ? num : value;
    }
    if (typeMarker === "boolean" || typeMarker === "switch" || typeMarker === "checkbox") {
      const boolValue = parseBooleanValue(value);
      return boolValue === null ? Boolean(value) : boolValue;
    }
    return value;
  }
  function buildNodeInfoList(app, inputValues) {
    const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
    const values = inputValues && typeof inputValues === "object" ? inputValues : {};
    return inputs.map((input, index) => {
      const key = String(input && input.key || "").trim() || `param_${index + 1}`;
      const rawValue = values[key];
      if (!isFilledInputValue(rawValue)) {
        if (input && input.required && typeof rawValue !== "boolean") {
          throw new Error(`Missing required input: ${input.label || input.name || key}`);
        }
        return null;
      }
      const fieldName = String(input && (input.fieldName || input.key || input.name) || key).trim();
      const payload = {
        nodeId: input && input.nodeId ? input.nodeId : key,
        fieldName,
        fieldValue: normalizeInputValue(input, rawValue)
      };
      if (input && input.fieldType) payload.fieldType = input.fieldType;
      if (input && input.fieldData !== void 0) payload.fieldData = input.fieldData;
      return payload;
    }).filter(Boolean);
  }
  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 3e4) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => {
      try {
        controller.abort();
      } catch (_) {
      }
    }, timeoutMs) : null;
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller ? controller.signal : options.signal
      });
      const text = await response.text();
      let result = null;
      try {
        result = text ? JSON.parse(text) : null;
      } catch (_) {
        result = { rawText: text };
      }
      if (!response.ok) {
        const message = result && (result.message || result.msg || result.error) || `Request failed (HTTP ${response.status})`;
        throw new Error(String(message));
      }
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }
  function extractOutputUrl(payload) {
    if (!payload) return "";
    if (typeof payload === "string") {
      return /^https?:\/\//i.test(payload) ? payload : "";
    }
    if (Array.isArray(payload)) {
      for (const item of payload) {
        const url = extractOutputUrl(item);
        if (url) return url;
      }
      return "";
    }
    if (typeof payload === "object") {
      const directKeys = ["fileUrl", "url", "downloadUrl", "download_url", "imageUrl", "resultUrl"];
      for (const key of directKeys) {
        const value = payload[key];
        if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
      }
      const nestedKeys = ["outputs", "data", "result", "list", "items", "nodeOutputs"];
      for (const key of nestedKeys) {
        const url = extractOutputUrl(payload[key]);
        if (url) return url;
      }
    }
    return "";
  }
  function extractTaskStatus(payload) {
    if (!payload || typeof payload !== "object") return "";
    return String(payload.status || payload.state || payload.taskStatus || "").toUpperCase();
  }
  function isPendingStatus(status) {
    return ["PENDING", "RUNNING", "PROCESSING", "QUEUED", "QUEUE", "WAITING", "IN_PROGRESS"].includes(status);
  }
  function isFailedStatus(status) {
    return ["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(status);
  }
  function isPendingMessage(message) {
    const text = String(message || "").toLowerCase();
    return /(processing|pending|running|queue|wait|运行中|排队|处理中)/i.test(text);
  }
  async function submitRunningHubTask(args = []) {
    const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
    const app = payload.app && typeof payload.app === "object" ? payload.app : {};
    const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
    const apiKey = String(payload.apiKey || "").trim();
    const appId = normalizeAppId(app.appId || payload.appId);
    if (!apiKey) throw new Error("RunningHub API Key is missing");
    if (!appId) throw new Error("RunningHub App ID is missing");
    const nodeInfoList = buildNodeInfoList(app, payload.inputs);
    const bodyCandidates = [
      { apiKey, webappId: appId, nodeInfoList },
      { apiKey, webAppId: appId, nodeInfoList },
      { apiKey, appId, nodeInfoList }
    ];
    let lastError = null;
    for (const body of bodyCandidates) {
      try {
        const result = await fetchJsonWithTimeout(
          "https://www.runninghub.cn/task/openapi/ai-app/run",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
          },
          Math.max(5e3, Number(settings.timeout || 180) * 1e3)
        );
        const taskId = result && result.data && (result.data.taskId || result.data.id) || result && (result.taskId || result.id) || "";
        if (!taskId) {
          throw new Error(result && (result.message || result.msg) || "Task created but taskId missing");
        }
        return { ok: true, taskId: String(taskId), result };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("RunningHub task submission failed");
  }
  async function fetchRunningHubAccountStatus(args = []) {
    const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
    const apiKey = String(payload.apiKey || "").trim();
    if (!apiKey) {
      return { ok: false, balance: null, coins: null };
    }
    const result = await fetchJsonWithTimeout("https://www.runninghub.cn/uc/openapi/accountStatus", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    const data = result && (result.data || result.result) || {};
    return {
      ok: true,
      balance: data.balance ?? data.amount ?? data.walletBalance ?? null,
      coins: data.coins ?? data.rhCoins ?? data.integral ?? null,
      result
    };
  }
  async function pollRunningHubTask(args = []) {
    const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
    const apiKey = String(payload.apiKey || "").trim();
    const taskId = String(payload.taskId || "").trim();
    const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
    if (!apiKey) throw new Error("RunningHub API Key is missing");
    if (!taskId) throw new Error("RunningHub taskId is missing");
    const pollIntervalMs = Math.max(1, Number(settings.pollInterval) || 2) * 1e3;
    const timeoutMs = Math.max(10, Number(settings.timeout) || 180) * 1e3;
    const startedAt = Date.now();
    const localController = typeof AbortController !== "undefined" ? new AbortController() : null;
    runninghubTaskControllers.set(taskId, localController);
    try {
      while (Date.now() - startedAt < timeoutMs) {
        if (localController && localController.signal.aborted) {
          throw new Error("Task polling cancelled");
        }
        try {
          const result = await fetchJsonWithTimeout(
            "https://www.runninghub.cn/task/openapi/outputs",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ apiKey, taskId }),
              signal: localController ? localController.signal : void 0
            },
            3e4
          );
          const payloadData = result && (result.data || result.result) || result;
          const outputUrl = extractOutputUrl(payloadData);
          if (outputUrl) {
            return { ok: true, taskId, status: "SUCCEEDED", outputUrl, result };
          }
          const status = extractTaskStatus(payloadData);
          if (isFailedStatus(status)) {
            throw new Error(result && (result.message || result.msg) || `Task failed (${status})`);
          }
          if (!isPendingStatus(status) && !isPendingMessage(result && (result.message || result.msg))) {
            throw new Error(result && (result.message || result.msg) || "Unknown task status");
          }
        } catch (error) {
          if (localController && localController.signal.aborted) {
            throw new Error("Task polling cancelled");
          }
          if (!isPendingMessage(error && error.message)) {
            throw error;
          }
        }
        await sleep(pollIntervalMs);
      }
      throw new Error("Task polling timed out. Please check the RunningHub task list later.");
    } finally {
      runninghubTaskControllers.delete(taskId);
    }
  }
  async function cancelRunningHubTask(args = []) {
    const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
    const apiKey = String(payload.apiKey || "").trim();
    const taskId = String(payload.taskId || "").trim();
    if (!apiKey) throw new Error("RunningHub API Key is missing");
    if (!taskId) throw new Error("RunningHub taskId is missing");
    const controller = runninghubTaskControllers.get(taskId);
    if (controller && typeof controller.abort === "function") {
      try {
        controller.abort();
      } catch (_) {
      }
    }
    const result = await fetchJsonWithTimeout("https://www.runninghub.cn/task/openapi/cancel", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ apiKey, taskId })
    });
    return { ok: true, taskId, result };
  }

  // src/host/photoshop-bridge.js
  function getPhotoshopService() {
    const photoshopService = typeof window !== "undefined" && window.PixelRunnerHost && window.PixelRunnerHost.photoshop;
    if (!photoshopService) {
      throw new Error("Photoshop host service is unavailable");
    }
    return photoshopService;
  }
  async function getPhotoshopDocumentInfo() {
    const photoshopService = getPhotoshopService();
    if (typeof photoshopService.getActiveDocumentInfo !== "function") {
      throw new Error("Photoshop host service is unavailable");
    }
    return photoshopService.getActiveDocumentInfo();
  }
  async function capturePhotoshopDocumentPreview(args = []) {
    const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
    const photoshopService = getPhotoshopService();
    if (typeof photoshopService.captureDocumentPreview !== "function") {
      throw new Error("Photoshop host service is unavailable");
    }
    return photoshopService.captureDocumentPreview(payload);
  }
  async function runPhotoshopToolAction(args = []) {
    const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
    const photoshopService = getPhotoshopService();
    if (typeof photoshopService.runToolAction !== "function") {
      throw new Error("Photoshop host service is unavailable");
    }
    return photoshopService.runToolAction(payload);
  }
  async function placeResultIntoPhotoshop(args = []) {
    const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
    const url = String(payload.url || "").trim();
    if (!url) {
      throw new Error("Result URL is missing");
    }
    const photoshopService = getPhotoshopService();
    if (typeof photoshopService.placeImageFromUrl !== "function") {
      throw new Error("Photoshop host service is unavailable");
    }
    return photoshopService.placeImageFromUrl(payload);
  }

  // src/host/main.js
  function readHostStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }
  function writeHostStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }
  async function handleBridgeRequest(message, webviewEl) {
    if (!message || typeof message !== "object" || !message.method) return;
    if (!webviewEl || typeof webviewEl.postMessage !== "function") return;
    try {
      let result = null;
      switch (message.method) {
        case "host.ping":
          result = {
            runtime: "uxp-host",
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : ""
          };
          break;
        case "storage.getItem":
          result = readHostStorage(message.args && message.args[0]);
          break;
        case "storage.setItem":
          result = writeHostStorage(message.args && message.args[0], message.args && message.args[1]);
          break;
        case "runninghub.submitTask":
          result = await submitRunningHubTask(message.args);
          break;
        case "runninghub.pollTask":
          result = await pollRunningHubTask(message.args);
          break;
        case "runninghub.cancelTask":
          result = await cancelRunningHubTask(message.args);
          break;
        case "runninghub.fetchAccountStatus":
          result = await fetchRunningHubAccountStatus(message.args);
          break;
        case "photoshop.getActiveDocumentInfo":
          result = await getPhotoshopDocumentInfo();
          break;
        case "photoshop.captureDocumentPreview":
          result = await capturePhotoshopDocumentPreview(message.args);
          break;
        case "photoshop.runToolAction":
          result = await runPhotoshopToolAction(message.args);
          break;
        case "photoshop.placeResultFromUrl":
          result = await placeResultIntoPhotoshop(message.args);
          break;
        default:
          throw new Error(`Unknown bridge method: ${message.method}`);
      }
      webviewEl.postMessage(createBridgeResponse(message, result, null));
    } catch (error) {
      webviewEl.postMessage(createBridgeResponse(message, null, error));
    }
  }
  function mountWebView() {
    const nextWebview = getById("pixelrunnerWebview");
    if (!nextWebview) {
      setHostStatus("WebView element not found in host shell.", "warning");
      return;
    }
    const onMessage = (event) => {
      const payload = event && event.data;
      if (!payload || typeof payload !== "object") return;
      if (payload.type === "pixelrunner.webview.ready") {
        setHostStatus("PixelRunner WebView ready", "success");
        document.body.classList.add("webview-ready");
        return;
      }
      if (payload.type === "pixelrunner.webview.log") {
        if (payload.level === "error") {
          console.error("[PixelRunner/WebView]", payload.message || payload);
        } else {
          console.log("[PixelRunner/WebView]", payload.message || payload);
        }
        return;
      }
      if (typeof payload.method === "string" && "id" in payload) {
        handleBridgeRequest(payload, nextWebview);
      }
    };
    registerListener(window, "message", onMessage);
    registerListener(nextWebview, "message", onMessage);
    setHostStatus("PixelRunner WebView mounted, waiting for ready signal...", "info");
  }
  document.addEventListener("DOMContentLoaded", () => {
    const looksLikeBrowserPreview = typeof window !== "undefined" && typeof location !== "undefined" && String(location.protocol || "").toLowerCase() === "file:";
    if (looksLikeBrowserPreview) {
      setHostStatus("This is the UXP host shell. Open app.html in a browser for UI preview.", "warning");
      return;
    }
    setHostStatus("Mounting PixelRunner WebView...", "info");
    mountWebView();
  });
})();
//# sourceMappingURL=host.bundle.js.map
