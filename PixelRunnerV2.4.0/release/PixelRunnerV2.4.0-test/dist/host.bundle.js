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
  var DEFAULT_UPLOAD_TARGET_BYTES = 1e7;
  var DEFAULT_UPLOAD_HARD_LIMIT_BYTES = 11e6;
  var DEFAULT_UPLOAD_QUALITY_STEPS = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
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
  function arrayBufferToBase64(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) return "";
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 32768;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }
  function extractEncodedBase64(encoded) {
    if (!encoded) return "";
    if (typeof encoded === "string") return encoded.trim();
    if (encoded instanceof ArrayBuffer) return arrayBufferToBase64(encoded);
    if (ArrayBuffer.isView(encoded)) {
      const view = encoded;
      return arrayBufferToBase64(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    }
    if (typeof encoded === "object") {
      const direct = [
        encoded.base64,
        encoded.data,
        encoded.value,
        encoded.string,
        encoded.output
      ].find((item) => typeof item === "string" && item.trim());
      if (direct) return direct.trim();
      const nestedBuffer = [encoded.arrayBuffer, encoded.buffer, encoded.dataBuffer].find(
        (item) => item instanceof ArrayBuffer || ArrayBuffer.isView(item)
      );
      if (nestedBuffer instanceof ArrayBuffer) return arrayBufferToBase64(nestedBuffer);
      if (nestedBuffer && ArrayBuffer.isView(nestedBuffer)) {
        return arrayBufferToBase64(
          nestedBuffer.buffer.slice(nestedBuffer.byteOffset, nestedBuffer.byteOffset + nestedBuffer.byteLength)
        );
      }
    }
    return "";
  }
  function parseLayerBounds(bounds) {
    return normalizeBounds(bounds);
  }
  function clampBoundsToDocument(bounds, docInfo) {
    const width = Math.max(1, Number(docInfo && docInfo.width) || 1);
    const height = Math.max(1, Number(docInfo && docInfo.height) || 1);
    if (!bounds) {
      return {
        left: 0,
        top: 0,
        right: width,
        bottom: height
      };
    }
    const left = Math.max(0, Math.min(width - 1, Math.floor(Number(bounds.left) || 0)));
    const top = Math.max(0, Math.min(height - 1, Math.floor(Number(bounds.top) || 0)));
    const right = Math.max(left + 1, Math.min(width, Math.ceil(Number(bounds.right) || width)));
    const bottom = Math.max(top + 1, Math.min(height, Math.ceil(Number(bounds.bottom) || height)));
    return { left, top, right, bottom };
  }
  function getPreviewTargetSize(sourceWidth, sourceHeight, maxDimension) {
    const width = Math.max(1, Number(sourceWidth) || 1);
    const height = Math.max(1, Number(sourceHeight) || 1);
    const limitedMax = Math.max(256, Math.min(4096, Math.floor(Number(maxDimension) || 1536)));
    const ratio = Math.min(1, limitedMax / Math.max(width, height));
    return {
      width: Math.max(1, Math.round(width * ratio)),
      height: Math.max(1, Math.round(height * ratio))
    };
  }
  async function getPixelsWithFallback(imaging, options) {
    try {
      return await imaging.getPixels(options);
    } catch (error) {
      const fallbackOptions = { ...options };
      delete fallbackOptions.componentSize;
      return imaging.getPixels(fallbackOptions);
    }
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
      saving: { _enum: "yesNo", _value: "no" }
    }], {});
  }
  function jpegDescriptor(quality) {
    return {
      _obj: "JPEG",
      extendedQuality: Math.max(1, Math.min(12, Math.floor(Number(quality) || 8))),
      matteColor: { _enum: "matteColor", _value: "none" }
    };
  }
  async function deleteFileQuietly(file) {
    if (!file || typeof file.delete !== "function") return;
    try {
      await file.delete();
    } catch (_) {
    }
  }
  async function exportDocumentAsJpeg(storage, action, docRef, quality, filePrefix = "pixelrunner-capture") {
    const tempFolder = await storage.localFileSystem.getTemporaryFolder();
    const tempFile = await tempFolder.createFile(`${filePrefix}-${Date.now()}-${quality}.jpg`, { overwrite: true });
    try {
      const sessionToken = await storage.localFileSystem.createSessionToken(tempFile);
      await action.batchPlay([{
        _obj: "save",
        as: jpegDescriptor(quality),
        in: { _path: sessionToken, _kind: "local" },
        documentID: Number(docRef.id),
        copy: true,
        lowerCase: true,
        saveStage: { _enum: "saveStageType", _value: "saveStageOS" }
      }], {});
      const rawBuffer = await tempFile.read({ format: storage.formats.binary });
      const arrayBuffer = rawBuffer instanceof ArrayBuffer ? rawBuffer : ArrayBuffer.isView(rawBuffer) ? rawBuffer.buffer.slice(rawBuffer.byteOffset, rawBuffer.byteOffset + rawBuffer.byteLength) : new Uint8Array(rawBuffer || []).buffer;
      return {
        arrayBuffer,
        bytes: Math.max(0, Number(arrayBuffer && arrayBuffer.byteLength) || 0),
        mimeType: "image/jpeg"
      };
    } finally {
      await deleteFileQuietly(tempFile);
    }
  }
  async function buildCompressedUploadAsset(doc, docInfo, selectionBounds, compressionOptions = {}, modalDeps = null) {
    const deps = modalDeps && typeof modalDeps === "object" ? modalDeps : await ensureDeps();
    const action = deps.photoshop.action;
    const storage = deps.storage;
    const cropBounds = clampBoundsToDocument(selectionBounds, docInfo);
    const targetBytes = Math.max(1, Math.floor(Number(compressionOptions.targetBytes) || DEFAULT_UPLOAD_TARGET_BYTES));
    const hardLimitBytes = Math.max(targetBytes, Math.floor(Number(compressionOptions.hardLimitBytes) || DEFAULT_UPLOAD_HARD_LIMIT_BYTES));
    const qualitySteps = Array.isArray(compressionOptions.qualitySteps) && compressionOptions.qualitySteps.length ? compressionOptions.qualitySteps : DEFAULT_UPLOAD_QUALITY_STEPS;
    let uploadResult = null;
    let tempDoc = null;
    try {
      tempDoc = await doc.duplicate("pixelrunner_upload_capture");
      try {
        await tempDoc.flatten();
      } catch (_) {
      }
      const isSelectionCapture = selectionBounds && (cropBounds.left > 0 || cropBounds.top > 0 || cropBounds.right < Math.max(1, Number(docInfo.width) || 1) || cropBounds.bottom < Math.max(1, Number(docInfo.height) || 1));
      if (isSelectionCapture && typeof tempDoc.crop === "function") {
        await tempDoc.crop(cropBounds);
      }
      let lastAttempt = null;
      const attempts = [];
      for (const quality of qualitySteps) {
        const exported = await exportDocumentAsJpeg(storage, action, tempDoc, quality, "pixelrunner-upload");
        const attempt = {
          quality: Math.max(1, Math.min(12, Math.floor(Number(quality) || 8))),
          bytes: exported.bytes
        };
        attempts.push(attempt);
        lastAttempt = { ...exported, quality: attempt.quality };
        if (exported.bytes <= targetBytes) {
          uploadResult = {
            ...exported,
            quality: attempt.quality,
            attempts,
            targetBytes,
            hardLimitBytes
          };
          return;
        }
      }
      if (lastAttempt && lastAttempt.bytes <= hardLimitBytes) {
        uploadResult = {
          ...lastAttempt,
          attempts,
          targetBytes,
          hardLimitBytes
        };
        return;
      }
      const error = new Error("图片压缩后仍超过上传限制");
      error.attempts = attempts;
      error.targetBytes = targetBytes;
      error.hardLimitBytes = hardLimitBytes;
      throw error;
    } finally {
      await closeDocumentWithoutSaving(action, tempDoc);
    }
    if (!uploadResult || !(uploadResult.arrayBuffer instanceof ArrayBuffer)) {
      throw new Error("Failed to build upload asset");
    }
    const base64 = arrayBufferToBase64(uploadResult.arrayBuffer);
    return {
      mimeType: uploadResult.mimeType,
      base64,
      dataUrl: buildDataUrl(uploadResult.mimeType, base64),
      bytes: uploadResult.bytes,
      quality: uploadResult.quality,
      targetBytes: uploadResult.targetBytes,
      hardLimitBytes: uploadResult.hardLimitBytes,
      attempts: uploadResult.attempts || []
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
    console.log("[PixelRunner/Photoshop] captureDocumentPreview:start", options);
    const deps = await ensureDeps();
    const { photoshop } = deps;
    const app = photoshop.app;
    const imaging = photoshop.imaging;
    const core = photoshop.core;
    const doc = app && app.activeDocument;
    if (!doc) throw new Error("No active Photoshop document");
    if (!imaging || typeof imaging.getPixels !== "function" || typeof imaging.encodeImageData !== "function") {
      throw new Error("Photoshop imaging API is unavailable");
    }
    const docInfo = getDocumentInfo(doc);
    const maxDimension = Math.max(256, Math.min(4096, Math.floor(Number(options.maxDimension) || 1536)));
    const quality = Math.max(20, Math.min(100, Math.floor(Number(options.quality) || 82)));
    const rawSelectionBounds = normalizeBounds(docInfo.selectionBounds);
    const selectionBounds = rawSelectionBounds ? clampBoundsToDocument(rawSelectionBounds, docInfo) : null;
    const captureBounds = clampBoundsToDocument(selectionBounds, docInfo);
    const sourceWidth = Math.max(1, Number(captureBounds.right) - Number(captureBounds.left));
    const sourceHeight = Math.max(1, Number(captureBounds.bottom) - Number(captureBounds.top));
    const targetSize = getPreviewTargetSize(sourceWidth, sourceHeight, maxDimension);
    return core.executeAsModal(async () => {
      const uploadAsset = await buildCompressedUploadAsset(doc, docInfo, selectionBounds, options, deps);
      let pixels = null;
      try {
        pixels = await getPixelsWithFallback(imaging, {
          documentID: Number(doc.id),
          sourceBounds: captureBounds,
          targetSize,
          componentSize: 8,
          applyAlpha: true
        });
        const encoded = await imaging.encodeImageData({
          imageData: pixels.imageData,
          base64: true,
          format: "jpeg",
          quality
        });
        const base64 = extractEncodedBase64(encoded);
        if (!base64) {
          throw new Error("Photoshop returned an empty capture payload");
        }
        const result = {
          ok: true,
          kind: "captured-document-image",
          source: "photoshop-document",
          document: docInfo,
          documentId: docInfo.documentId,
          selectionBounds,
          capturedFromSelection: Boolean(selectionBounds),
          width: targetSize.width,
          height: targetSize.height,
          originalWidth: sourceWidth,
          originalHeight: sourceHeight,
          mimeType: "image/jpeg",
          quality,
          maxDimension,
          base64,
          dataUrl: buildDataUrl("image/jpeg", base64),
          uploadMimeType: uploadAsset.mimeType,
          uploadBase64: uploadAsset.base64,
          uploadDataUrl: uploadAsset.dataUrl,
          uploadBytes: uploadAsset.bytes,
          uploadQuality: uploadAsset.quality,
          uploadTargetBytes: uploadAsset.targetBytes,
          uploadHardLimitBytes: uploadAsset.hardLimitBytes,
          compressionAttempts: uploadAsset.attempts
        };
        console.log("[PixelRunner/Photoshop] captureDocumentPreview:success", {
          documentId: result.documentId,
          width: result.width,
          height: result.height,
          capturedFromSelection: result.capturedFromSelection,
          hasBase64: Boolean(result.base64),
          uploadBytes: result.uploadBytes,
          uploadQuality: result.uploadQuality
        });
        return result;
      } finally {
        try {
          pixels && pixels.imageData && typeof pixels.imageData.dispose === "function" && pixels.imageData.dispose();
        } catch (_) {
        }
      }
    }, { commandName: "PixelRunner Capture Preview" });
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
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ apikey: apiKey })
    });
    const data = result && (result.data || result.result) || {};
    const account = data && data.accountStatus && typeof data.accountStatus === "object" ? data.accountStatus : data;
    return {
      ok: true,
      balance: account.remainMoney ?? account.balance ?? account.amount ?? account.walletBalance ?? account.money ?? null,
      coins: account.remainCoins ?? account.coins ?? account.rhCoins ?? account.integral ?? null,
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

  // src/host/runninghub-parser.js
  var API_BASE_URL = "https://www.runninghub.cn";
  var PARSE_ENDPOINT = "/api/webapp/apiCallDemo";
  var PARSE_FALLBACKS = ["/uc/openapi/app", "/uc/openapi/community/app", "/uc/openapi/workflow"];
  var PARSE_DEBUG_STORAGE_KEY = "rh_last_parse_debug";
  function normalizeAppId2(rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) return "";
    if (!/[/?#]/.test(value) && !value.includes("runninghub.cn")) return value;
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch (_) {
    }
    try {
      const url = new URL(decoded);
      const keys = ["webappId", "webappid", "appId", "appid", "workflowId", "workflowid", "id", "code"];
      for (const key of keys) {
        const nextValue = url.searchParams.get(key);
        if (nextValue && nextValue.trim()) return nextValue.trim();
      }
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length > 0) {
        for (let index = 0; index < segments.length; index += 1) {
          const segment = segments[index].toLowerCase();
          if (["app", "workflow", "community", "detail"].includes(segment) && segments[index + 1]) {
            return segments[index + 1].trim();
          }
        }
        return segments[segments.length - 1].trim();
      }
    } catch (_) {
    }
    const numeric = decoded.match(/\d{5,}/);
    return numeric ? numeric[0] : value;
  }
  function inferInputType(rawType) {
    const marker = String(rawType || "").toLowerCase();
    if (marker.includes("image") || marker.includes("file") || marker.includes("img")) return "image";
    if (marker.includes("number") || marker.includes("int") || marker.includes("float") || marker.includes("slider")) return "number";
    if (marker === "list") return "select";
    if (marker.includes("select") || marker.includes("enum") || marker.includes("option")) return "select";
    if (marker.includes("bool") || marker.includes("checkbox") || marker.includes("toggle")) return "boolean";
    if (marker.includes("switch")) return "select";
    return "text";
  }
  function parseJsonText(raw) {
    if (typeof raw !== "string") return void 0;
    const text = raw.trim();
    if (!text) return void 0;
    try {
      return JSON.parse(text);
    } catch (_) {
      return void 0;
    }
  }
  function parseJsonFromEscapedText(raw) {
    if (typeof raw !== "string") return void 0;
    const text = raw.trim();
    if (!text) return void 0;
    const candidates = [
      text,
      text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\"/g, '"'),
      text.replace(/\\u0022/g, '"')
    ];
    for (const candidate of candidates) {
      const parsed = parseJsonText(candidate);
      if (parsed !== void 0) return parsed;
    }
    return void 0;
  }
  function createParseError(message, options = {}) {
    const error = new Error(String(message || "应用解析失败"));
    error.code = "PARSE_APP_FAILED";
    error.appId = String(options.appId || "");
    error.endpoint = String(options.endpoint || "");
    error.retryable = true;
    error.reasons = Array.isArray(options.reasons) ? options.reasons.map((item) => String(item)) : [];
    return error;
  }
  function persistParseDebug(record) {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(PARSE_DEBUG_STORAGE_KEY, JSON.stringify(record));
    } catch (_) {
    }
  }
  function buildParseUrl(pathname, queryParams) {
    const url = new URL(`${API_BASE_URL}${pathname}`);
    Object.entries(queryParams || {}).forEach(([key, value]) => {
      if (value === void 0 || value === null || value === "") return;
      url.searchParams.set(key, value);
    });
    return url.toString();
  }
  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    let result = null;
    try {
      result = text ? JSON.parse(text) : null;
    } catch (_) {
      result = { rawText: text };
    }
    return { ok: response.ok, status: response.status, result };
  }
  function normalizeFieldToken(text) {
    return String(text || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function isWeakLabel(label) {
    const text = String(label || "").trim().toLowerCase();
    if (!text) return true;
    return ["value", "text", "string", "number", "int", "float", "double", "bool", "boolean"].includes(text);
  }
  function resolveDisplayLabel({ key, fieldName, rawLabel, rawName }) {
    const preferred = String(rawLabel || rawName || "").trim();
    if (preferred && !isWeakLabel(preferred)) {
      return { label: preferred, source: "raw", confidence: 1 };
    }
    const labelMap = {
      aspectratio: "比例",
      resolution: "分辨率",
      channel: "通道",
      prompt: "提示词",
      negativeprompt: "反向提示词",
      seed: "随机种子",
      steps: "步数",
      cfg: "CFG",
      cfgscale: "CFG 强度",
      sampler: "采样器",
      scheduler: "调度器",
      width: "宽度",
      height: "高度",
      model: "模型",
      style: "风格",
      strength: "强度",
      denoise: "降噪强度"
    };
    const candidates = [fieldName, key, key && String(key).includes(":") ? String(key).split(":").pop() : ""];
    for (const item of candidates) {
      const mapped = labelMap[normalizeFieldToken(item)];
      if (mapped) return { label: mapped, source: "map", confidence: 0.6 };
    }
    const fallback = preferred || String(fieldName || key || "").trim();
    return { label: fallback, source: "fallback", confidence: 0.4 };
  }
  function resolveFieldDataLabel(fieldData) {
    if (!fieldData) return "";
    let parsed = fieldData;
    if (typeof fieldData === "string") parsed = parseJsonFromEscapedText(fieldData);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    if (Array.isArray(parsed.options) || Array.isArray(parsed.items) || Array.isArray(parsed.values)) return "";
    return String(parsed.label || parsed.name || parsed.title || parsed.description || "").trim();
  }
  function parseBooleanLike(value) {
    if (value === true || value === false) return value;
    const marker = String(value == null ? "" : value).trim().toLowerCase();
    if (!marker) return null;
    if (["true", "1", "yes", "y", "on", "是"].includes(marker)) return true;
    if (["false", "0", "no", "n", "off", "否"].includes(marker)) return false;
    return null;
  }
  function normalizeOptionText(value) {
    if (value === void 0 || value === null) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value).trim();
    }
    if (typeof value !== "object" || Array.isArray(value)) return "";
    const keys = ["value", "optionValue", "enumValue", "id", "key", "code", "index", "fastIndex", "name", "label", "title", "text"];
    for (const key of keys) {
      const nextValue = value[key];
      if (typeof nextValue === "string" || typeof nextValue === "number" || typeof nextValue === "boolean") {
        const text = String(nextValue).trim();
        if (text) return text;
      }
    }
    return "";
  }
  function extractOptionEntries(raw, depth = 0) {
    if (depth > 8 || raw === void 0 || raw === null) return [];
    if (typeof raw === "string") {
      const text = raw.trim();
      if (!text) return [];
      const parsed = parseJsonFromEscapedText(text);
      if (parsed !== void 0) return extractOptionEntries(parsed, depth + 1);
      if (text.includes("|") || text.includes(",") || text.includes("\n")) {
        return text.split(/[|,\r\n]+/).map((item) => item.trim()).filter(Boolean).map((item) => ({ value: item, label: item }));
      }
      return [{ value: text, label: text }];
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
      return [{ value: raw, label: String(raw) }];
    }
    if (Array.isArray(raw)) {
      return raw.flatMap((item) => extractOptionEntries(item, depth + 1));
    }
    if (typeof raw !== "object") return [];
    const containerKeys = ["options", "enums", "values", "items", "list", "data", "children", "selectOptions", "optionList", "fieldOptions"];
    const valueKeys = ["value", "optionValue", "enumValue", "id", "key", "code", "index", "fastIndex", "name", "label", "title", "text"];
    const labelKeys = ["label", "title", "text", "description", "descriptionCn", "descriptionEn", "name", "value", "index", "id", "key"];
    const collected = [];
    let hasContainer = false;
    for (const key of containerKeys) {
      if (raw[key] === void 0) continue;
      hasContainer = true;
      collected.push(...extractOptionEntries(raw[key], depth + 1));
    }
    const nextValue = valueKeys.map((key) => raw[key]).find((item) => item !== void 0 && item !== null && String(item).trim() !== "");
    const nextLabel = labelKeys.map((key) => raw[key]).find((item) => item !== void 0 && item !== null && String(item).trim() !== "");
    if (nextValue !== void 0 || nextLabel !== void 0) {
      collected.push({
        value: nextValue !== void 0 ? nextValue : nextLabel,
        label: String(nextLabel !== void 0 ? nextLabel : nextValue)
      });
    }
    if (!hasContainer) {
      Object.values(raw).forEach((value) => {
        if (!value || typeof value !== "object") return;
        collected.push(...extractOptionEntries(value, depth + 1));
      });
    }
    const seen = /* @__PURE__ */ new Set();
    return collected.filter((item) => {
      const value = normalizeOptionText(item && item.value);
      if (!value) return false;
      const marker = value.toLowerCase();
      if (seen.has(marker)) return false;
      seen.add(marker);
      item.value = value;
      item.label = normalizeOptionText(item.label) || value;
      return true;
    });
  }
  function resolveInputType(input) {
    const rawType = inferInputType(input && (input.type || input.fieldType));
    const entries = extractOptionEntries(input && input.options);
    const optionValues = entries.map((entry) => entry.value);
    const optionBooleans = optionValues.length > 0 && optionValues.every((item) => parseBooleanLike(item) !== null);
    const optionNumbers = optionValues.length > 0 && optionValues.every((item) => /^-?\d+(?:\.\d+)?$/.test(String(item)));
    const defaultValue = input && input.default;
    const defaultBoolean = parseBooleanLike(defaultValue) !== null;
    const defaultNumber = defaultValue !== void 0 && defaultValue !== null && /^-?\d+(?:\.\d+)?$/.test(String(defaultValue).trim());
    const fieldType = String(input && input.fieldType || "");
    const numericHint = /(?:^|[^a-z])(int|integer|float|double|decimal|number)(?:[^a-z]|$)/i.test(fieldType);
    const booleanHint = /(?:^|[^a-z])(bool|boolean|checkbox|toggle|switch)(?:[^a-z]|$)/i.test(fieldType);
    if (rawType === "image" || rawType === "number") return rawType;
    if (rawType === "select") {
      if (optionBooleans) return "boolean";
      if (entries.length > 0) return "select";
      if (defaultBoolean && booleanHint) return "boolean";
      if (defaultNumber && numericHint) return "number";
      return "text";
    }
    if (rawType === "boolean") {
      if (optionNumbers) return "number";
      if (optionBooleans || defaultBoolean || booleanHint) return "boolean";
      return "boolean";
    }
    if (rawType === "text" && entries.length > 1) {
      if (optionBooleans) return "boolean";
      return "select";
    }
    if (rawType === "text" && numericHint) return "number";
    if (rawType === "text" && (optionBooleans || booleanHint && defaultBoolean)) return "boolean";
    return rawType;
  }
  function isPromptLikeText(text) {
    return /prompt|提示词|negative|正向|负向/i.test(String(text || ""));
  }
  function parseExplicitRequired(value) {
    if (value === void 0) return null;
    if (value === null) return false;
    if (value === true || value === false) return value;
    if (typeof value === "number") return value !== 0;
    const marker = String(value || "").trim().toLowerCase();
    if (!marker) return false;
    if (["true", "1", "yes", "y", "on", "required", "是"].includes(marker)) return true;
    if (["false", "0", "no", "n", "off", "optional", "否"].includes(marker)) return false;
    return Boolean(marker);
  }
  function resolveRequiredSpec(raw, type) {
    const keys = ["required", "isRequired", "must", "need", "needRequired", "mandatory"];
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(raw || {}, key)) continue;
      const parsed = parseExplicitRequired(raw[key]);
      if (parsed !== null) return { required: parsed, explicit: true };
    }
    if (type === "image") return { required: false, explicit: false };
    return { required: true, explicit: false };
  }
  function normalizeInput(raw, index = 0) {
    const source = raw && typeof raw === "object" ? raw : {};
    const nodeId = String(source.nodeId || source.nodeID || source.node || source.node_id || "").trim();
    const fieldName = String(source.fieldName || source.field || source.name || "").trim();
    const derivedKey = nodeId && fieldName ? `${nodeId}:${fieldName}` : "";
    const key = String(source.key || source.paramKey || derivedKey || source.fieldName || `param_${index + 1}`).trim();
    let options = [
      ...extractOptionEntries(source.options),
      ...extractOptionEntries(source.enums),
      ...extractOptionEntries(source.values),
      ...extractOptionEntries(source.selectOptions),
      ...extractOptionEntries(source.optionList),
      ...extractOptionEntries(source.fieldOptions)
    ];
    if (options.length === 0) {
      options = extractOptionEntries(source.fieldData);
    }
    const normalizedOptions = [];
    const seen = /* @__PURE__ */ new Set();
    options.forEach((item) => {
      const value = normalizeOptionText(item && item.value);
      if (!value) return;
      const marker = value.toLowerCase();
      if (seen.has(marker)) return;
      seen.add(marker);
      normalizedOptions.push({ value, label: normalizeOptionText(item.label) || value });
    });
    const hintText = `${key} ${source.fieldName || ""} ${source.label || ""} ${source.name || ""} ${source.description || ""}`;
    const looksPromptLike = isPromptLikeText(hintText);
    const provisionalType = resolveInputType({
      type: inferInputType(source.type || source.valueType || source.widget || source.inputType || source.fieldType),
      fieldType: source.fieldType,
      options: normalizedOptions,
      default: source.default ?? source.fieldValue
    });
    const type = looksPromptLike ? "text" : provisionalType;
    const fieldDataLabel = resolveFieldDataLabel(source.fieldData);
    const baseName = String(source.name || source.label || source.title || fieldDataLabel || source.description || fieldName || key).trim();
    const baseLabel = String(source.label || source.name || source.title || fieldDataLabel || source.description || fieldName || key).trim();
    const labelMeta = resolveDisplayLabel({
      key,
      fieldName,
      rawLabel: baseLabel,
      rawName: baseName
    });
    const requiredSpec = resolveRequiredSpec(source, type);
    return {
      key,
      name: baseName,
      label: labelMeta.label || baseLabel || baseName || key,
      type,
      required: requiredSpec.required,
      requiredExplicit: requiredSpec.explicit,
      default: source.default ?? source.fieldValue,
      options: type === "select" && normalizedOptions.length > 0 ? normalizedOptions : void 0,
      nodeId: nodeId || void 0,
      fieldName: fieldName || void 0,
      fieldType: source.fieldType || void 0,
      fieldData: source.fieldData || void 0,
      labelSource: labelMeta.source,
      labelConfidence: labelMeta.confidence
    };
  }
  function isGhostSchemaInput(raw, input) {
    if (!raw || !input) return false;
    const hint = `${input.key || ""} ${input.fieldName || ""} ${input.label || ""}`;
    if (!isPromptLikeText(hint)) return false;
    const hasBinding = Boolean(String(input.nodeId || "").trim() && String(input.fieldName || "").trim());
    if (hasBinding) return false;
    const rawType = String(raw.type || raw.valueType || raw.widget || raw.inputType || raw.fieldType || "").toLowerCase();
    const defaultMarker = String(input.default || "").trim().toLowerCase();
    return /string|text|schema/.test(rawType) && (!input.options || input.options.length <= 1) && /string|text/.test(defaultMarker || rawType);
  }
  function buildInputMergeKey(input) {
    if (!input || typeof input !== "object") return "";
    const nodeId = String(input.nodeId || "").trim();
    const fieldName = String(input.fieldName || "").trim();
    if (nodeId && fieldName) return `${nodeId}:${fieldName}`.toLowerCase();
    const key = String(input.key || "").trim();
    if (key) return key.toLowerCase();
    if (fieldName) return fieldName.toLowerCase();
    return "";
  }
  function mergeInputsWithFallback(primaryInputs, fallbackInputs) {
    const primary = Array.isArray(primaryInputs) ? primaryInputs : [];
    const fallback = Array.isArray(fallbackInputs) ? fallbackInputs : [];
    if (primary.length === 0) return fallback;
    if (fallback.length === 0) return primary;
    const fallbackMap = /* @__PURE__ */ new Map();
    fallback.forEach((item) => {
      const marker = buildInputMergeKey(item);
      if (!marker || fallbackMap.has(marker)) return;
      fallbackMap.set(marker, item);
    });
    const merged = primary.map((input) => {
      const marker = buildInputMergeKey(input);
      const alt = marker ? fallbackMap.get(marker) : null;
      if (!alt) return input;
      const needsOptions = input.type === "select" && (!Array.isArray(input.options) || input.options.length <= 1) && Array.isArray(alt.options) && alt.options.length > 1;
      const betterLabel = typeof alt.labelConfidence === "number" && (!input.labelConfidence || alt.labelConfidence > input.labelConfidence + 0.2) && !isWeakLabel(alt.label);
      if (!needsOptions && !betterLabel) return input;
      return {
        ...input,
        options: needsOptions ? alt.options : input.options,
        label: betterLabel ? alt.label : input.label,
        labelSource: betterLabel ? alt.labelSource : input.labelSource,
        labelConfidence: betterLabel ? alt.labelConfidence : input.labelConfidence
      };
    });
    const seen = new Set(merged.map((item) => buildInputMergeKey(item)).filter(Boolean));
    fallback.forEach((item) => {
      const marker = buildInputMergeKey(item);
      if (!marker || seen.has(marker)) return;
      merged.push(item);
      seen.add(marker);
    });
    return merged;
  }
  function sanitizeDebugRawEntry(raw) {
    if (!raw || typeof raw !== "object") return raw;
    return {
      key: raw.key || raw.paramKey || "",
      name: raw.name || raw.label || raw.title || "",
      nodeId: raw.nodeId || raw.nodeID || "",
      fieldName: raw.fieldName || "",
      type: raw.type || raw.fieldType || raw.inputType || raw.widget || raw.valueType || "",
      required: raw.required,
      default: raw.default ?? raw.fieldValue,
      hasFieldData: raw.fieldData !== void 0,
      optionsCount: Array.isArray(raw.options) ? raw.options.length : void 0
    };
  }
  function buildSourceCandidateMarker(candidate) {
    if (Array.isArray(candidate)) {
      const first = candidate[0];
      const firstShape = first && typeof first === "object" ? Object.keys(first).sort().slice(0, 6).join(",") : typeof first;
      return `arr:${candidate.length}:${firstShape}`;
    }
    return `obj:${Object.keys(candidate || {}).sort().slice(0, 12).join(",")}`;
  }
  function collectSourceCandidatesFromValue(value, depth = 0, bucket = [], seen = /* @__PURE__ */ new Set()) {
    if (depth > 6 || value === void 0 || value === null) return bucket;
    if (typeof value === "string") {
      const parsed = parseJsonFromEscapedText(value);
      if (parsed !== void 0) collectSourceCandidatesFromValue(parsed, depth + 1, bucket, seen);
      return bucket;
    }
    if (Array.isArray(value)) {
      const marker2 = buildSourceCandidateMarker(value);
      if (!seen.has(marker2)) {
        seen.add(marker2);
        bucket.push(value);
      }
      value.slice(0, 20).forEach((item) => collectSourceCandidatesFromValue(item, depth + 1, bucket, seen));
      return bucket;
    }
    if (typeof value !== "object") return bucket;
    const marker = buildSourceCandidateMarker(value);
    if (!seen.has(marker)) {
      seen.add(marker);
      bucket.push(value);
    }
    ["data", "result", "payload", "content", "body", "value", "appInfo", "webappInfo", "workflow", "nodeInfoList", "inputs", "params"].forEach((key) => {
      if (value[key] !== void 0) collectSourceCandidatesFromValue(value[key], depth + 1, bucket, seen);
    });
    return bucket;
  }
  function isLikelyInputRecord(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    if (String(item.key || item.paramKey || "").trim()) return true;
    if (String(item.fieldName || "").trim()) return true;
    if (String(item.nodeId || item.nodeID || "").trim() && String(item.fieldName || "").trim()) return true;
    if (item.fieldData !== void 0 && (item.fieldName || item.key || item.paramKey)) return true;
    if ((item.default !== void 0 || item.fieldValue !== void 0) && (item.name || item.label || item.fieldName || item.key)) return true;
    return Boolean(String(item.type || item.fieldType || item.inputType || item.widget || item.valueType || "").trim());
  }
  function toInputListFromUnknown(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    const values = Object.values(value);
    const inputLike = values.filter(isLikelyInputRecord);
    return inputLike.length > 0 ? inputLike : [];
  }
  function getNodeBindingCount(list) {
    if (!Array.isArray(list)) return 0;
    return list.reduce((count, item) => {
      if (!item || typeof item !== "object") return count;
      return String(item.nodeId || item.nodeID || "").trim() && String(item.fieldName || item.field || "").trim() ? count + 1 : count;
    }, 0);
  }
  function collectInputCandidates(source, depth = 0, path = "root", out = []) {
    if (!source || depth > 8) return out;
    if (Array.isArray(source)) {
      const inputLikeCount = source.filter(isLikelyInputRecord).length;
      if (source.length > 0 && inputLikeCount > 0) {
        out.push({ path, list: source, inputLikeCount, nodeBindingCount: getNodeBindingCount(source) });
      }
      source.forEach((item, index) => collectInputCandidates(item, depth + 1, `${path}[${index}]`, out));
      return out;
    }
    if (typeof source !== "object") return out;
    const objectList = toInputListFromUnknown(source);
    if (objectList.length > 0) {
      out.push({
        path,
        list: objectList,
        inputLikeCount: objectList.filter(isLikelyInputRecord).length,
        nodeBindingCount: getNodeBindingCount(objectList)
      });
    }
    Object.entries(source).forEach(([key, value]) => {
      collectInputCandidates(value, depth + 1, `${path}.${key}`, out);
    });
    return out;
  }
  function dedupeCandidates(candidates) {
    const seen = /* @__PURE__ */ new Set();
    return (candidates || []).filter((item) => item && Array.isArray(item.list) && item.list.length > 0).filter((item) => {
      const marker = `${item.path}|${item.list.length}|${item.inputLikeCount || 0}`;
      if (seen.has(marker)) return false;
      seen.add(marker);
      return true;
    }).sort((a, b) => {
      if ((b.nodeBindingCount || 0) !== (a.nodeBindingCount || 0)) return (b.nodeBindingCount || 0) - (a.nodeBindingCount || 0);
      if ((b.inputLikeCount || 0) !== (a.inputLikeCount || 0)) return (b.inputLikeCount || 0) - (a.inputLikeCount || 0);
      return b.list.length - a.list.length;
    });
  }
  function collectAppNameCandidates(value, depth = 0, bucket = [], seen = /* @__PURE__ */ new Set(), parentKey = "") {
    if (depth > 8 || value === void 0 || value === null) return bucket;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const key = normalizeFieldToken(parentKey);
      if (["name", "title", "appname", "webappname", "workflowname", "displayname"].includes(key)) {
        const text = String(value).trim();
        if (text && !seen.has(text.toLowerCase())) {
          seen.add(text.toLowerCase());
          const weights = { webappname: 50, appname: 46, workflowname: 44, displayname: 42, title: 38, name: 34 };
          bucket.push({ value: text, depth, score: (weights[key] || 20) + Math.min(12, text.length) - depth });
        }
      }
      if (typeof value === "string") {
        const parsed = parseJsonFromEscapedText(value);
        if (parsed !== void 0) collectAppNameCandidates(parsed, depth + 1, bucket, seen, "");
      }
      return bucket;
    }
    if (Array.isArray(value)) {
      value.slice(0, 30).forEach((item) => collectAppNameCandidates(item, depth + 1, bucket, seen, parentKey));
      return bucket;
    }
    if (typeof value !== "object") return bucket;
    ["webappName", "appName", "workflowName", "displayName", "title", "name"].forEach((key) => {
      if (value[key] !== void 0) collectAppNameCandidates(value[key], depth, bucket, seen, key);
    });
    Object.entries(value).forEach(([key, child]) => collectAppNameCandidates(child, depth + 1, bucket, seen, key));
    return bucket;
  }
  function resolveBestAppName(data) {
    const candidates = collectAppNameCandidates(data, 0, [], /* @__PURE__ */ new Set(), "");
    candidates.sort((a, b) => {
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      return (a.depth || 0) - (b.depth || 0);
    });
    return candidates[0] && candidates[0].value ? candidates[0].value : "未命名应用";
  }
  function extractNodeInfoListFromText(rawText) {
    if (typeof rawText !== "string" || !rawText.trim()) return [];
    const parsed = parseJsonFromEscapedText(rawText);
    if (parsed && Array.isArray(parsed.nodeInfoList)) return parsed.nodeInfoList;
    const fragment = rawText.match(/"nodeInfoList"\s*:\s*(\[[\s\S]*?\])\s*(?:,|\})/);
    if (!fragment || !fragment[1]) return [];
    const list = parseJsonFromEscapedText(fragment[1]);
    return Array.isArray(list) ? list : [];
  }
  function findCurlDemoText(data, depth = 0) {
    if (!data || typeof data !== "object" || depth > 8) return "";
    const keys = ["curl", "curlCmd", "curlCommand", "apiCallDemo", "requestDemo", "requestExample", "demo", "example", "doc", "docs", "apiDoc", "apiDocs"];
    for (const key of keys) {
      if (typeof data[key] === "string" && data[key].trim()) return data[key];
    }
    if (Array.isArray(data)) {
      for (const item of data) {
        const found = findCurlDemoText(item, depth + 1);
        if (found) return found;
      }
      return "";
    }
    for (const value of Object.values(data)) {
      if (!value || typeof value !== "object") continue;
      const found = findCurlDemoText(value, depth + 1);
      if (found) return found;
    }
    return "";
  }
  function extractAppInfoPayload(data) {
    if (typeof data === "string") {
      const parsedString = parseJsonFromEscapedText(data);
      if (parsedString && typeof parsedString === "object") return extractAppInfoPayload(parsedString);
    }
    if (!data || typeof data !== "object") {
      return {
        payload: { name: "未命名应用", description: "", inputs: [] },
        debug: { candidates: [], selectedPath: "", selectedRawCount: 0, selectedRawPreview: [], curlFound: false, curlNodeInfoCount: 0 }
      };
    }
    const legacySources = [
      data.nodeInfoList,
      data.inputs,
      data.params,
      data.inputParams,
      data.nodeList,
      data.workflow && data.workflow.inputs,
      data.workflow && data.workflow.nodeInfoList,
      data.appInfo && data.appInfo.nodeInfoList,
      data.webappInfo && data.webappInfo.nodeInfoList,
      data.webappInfo && data.webappInfo.nodeList,
      data.workflow && data.workflow.nodeList,
      data.workflow && data.workflow.nodes,
      data.nodeInfo,
      data.nodeInfos,
      data.data && data.data.nodeInfo,
      data.data && data.data.nodeInfos,
      data.data && data.data.nodeInfoList,
      data.data && data.data.inputs,
      data.result && data.result.nodeInfoList,
      data.result && data.result.inputs
    ];
    const legacyCandidates = legacySources.map((value, index) => {
      const list = toInputListFromUnknown(value);
      return {
        path: `legacyCandidate[${index}]`,
        list,
        inputLikeCount: list.filter(isLikelyInputRecord).length,
        nodeBindingCount: getNodeBindingCount(list)
      };
    }).filter((item) => Array.isArray(item.list) && item.list.length > 0);
    const candidateList = dedupeCandidates([...legacyCandidates, ...collectInputCandidates(data, 0, "root", [])]);
    const selected = candidateList[0] || { path: "", list: [] };
    const rawInputs = Array.isArray(selected.list) ? selected.list : [];
    const primaryInputs = rawInputs.map((item, index) => ({ raw: item, input: normalizeInput(item, index) })).filter((item) => item && item.input && item.input.key).filter((item) => !isGhostSchemaInput(item.raw, item.input)).map((item) => item.input);
    const altInputs = candidateList.filter((item) => item && item.path && item.path !== selected.path).slice(0, 3).flatMap(
      (candidate) => (candidate.list || []).map((item, index) => ({ raw: item, input: normalizeInput(item, index) })).filter((item) => item && item.input && item.input.key).filter((item) => !isGhostSchemaInput(item.raw, item.input)).map((item) => item.input)
    );
    const curlDemoText = findCurlDemoText(data);
    const curlNodeInfoList = extractNodeInfoListFromText(curlDemoText);
    const curlInputs = curlNodeInfoList.map((item, index) => normalizeInput(item, index)).filter((item) => item.key);
    const inputs = mergeInputsWithFallback(primaryInputs, [...altInputs, ...curlInputs]);
    return {
      payload: {
        name: resolveBestAppName(data),
        description: String(data.description || data.desc || data.summary || "").trim(),
        inputs
      },
      debug: {
        candidates: candidateList.map((item) => ({ path: item.path, count: item.list.length, inputLikeCount: item.inputLikeCount || 0 })),
        selectedPath: selected.path || "",
        selectedRawCount: rawInputs.length,
        selectedRawPreview: rawInputs.slice(0, 5).map(sanitizeDebugRawEntry),
        curlFound: Boolean(curlDemoText),
        curlNodeInfoCount: curlNodeInfoList.length
      }
    };
  }
  function pickBestParsedPayload(candidates) {
    let best = null;
    (candidates || []).forEach((source) => {
      const parsed = extractAppInfoPayload(source);
      const payload = parsed && parsed.payload ? parsed.payload : { name: "未命名应用", description: "", inputs: [] };
      const inputs = Array.isArray(payload.inputs) ? payload.inputs : [];
      const score = inputs.length;
      const rawCount = Number(parsed && parsed.debug && parsed.debug.selectedRawCount) || 0;
      const nameScore = payload && payload.name && payload.name !== "未命名应用" ? 1 : 0;
      if (!best || score > best.score || score === best.score && nameScore > best.nameScore || score === best.score && nameScore === best.nameScore && rawCount > best.rawCount) {
        best = { source, parsed, payload, score, rawCount, nameScore };
      }
    });
    return best;
  }
  function buildFallbackUrls(endpoint, normalizedId) {
    const urls = [];
    const seen = /* @__PURE__ */ new Set();
    const push = (url) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    };
    push(`${API_BASE_URL}${endpoint}/${encodeURIComponent(normalizedId)}`);
    push(buildParseUrl(endpoint, { webappId: normalizedId }));
    push(buildParseUrl(endpoint, { webAppId: normalizedId }));
    push(buildParseUrl(endpoint, { appId: normalizedId }));
    push(buildParseUrl(endpoint, { id: normalizedId }));
    return urls;
  }
  function buildDebugRecord(endpoint, appId, result, best) {
    const payload = best && best.payload ? best.payload : { inputs: [] };
    const source = best && best.source ? best.source : null;
    const debug = best && best.parsed && best.parsed.debug ? best.parsed.debug : {};
    return {
      endpoint,
      appId,
      topLevelKeys: Object.keys(result || {}),
      dataKeys: source && typeof source === "object" ? Object.keys(source) : [],
      selectedCandidatePath: debug.selectedPath || "",
      selectedRawCount: debug.selectedRawCount || 0,
      firstRawEntries: debug.selectedRawPreview || [],
      normalizedInputs: (payload.inputs || []).map((item) => ({
        key: item.key,
        type: inferInputType(item.type || item.fieldType),
        label: item.label || item.name || item.key
      })),
      curl: {
        found: Boolean(debug.curlFound),
        nodeInfoCount: debug.curlNodeInfoCount || 0
      },
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function resolveMessage(result, fallback) {
    return String(result && (result.message || result.msg || result.error) || fallback);
  }
  async function parseRunningHubApp(args = []) {
    const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
    const apiKey = String(payload.apiKey || "").trim();
    const preferredName = String(payload.preferredName || "").trim();
    const normalizedId = normalizeAppId2(payload.appId);
    if (!normalizedId) throw new Error("请先输入有效的应用 ID 或 URL");
    if (!apiKey) throw new Error("请先在设置页保存 RunningHub API Key");
    persistParseDebug({
      endpoint: PARSE_ENDPOINT,
      appId: normalizedId,
      phase: "request_start",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    const reasons = [];
    let lastDebugRecord = null;
    const tryHandleResult = (endpoint, result) => {
      const candidates = collectSourceCandidatesFromValue(result, 0, [], /* @__PURE__ */ new Set());
      const best = pickBestParsedPayload(candidates);
      if (!best) return null;
      const nextPayload = {
        ...best.payload,
        appId: normalizedId,
        name: preferredName || best.payload.name || "未命名应用"
      };
      lastDebugRecord = buildDebugRecord(endpoint, normalizedId, result, best);
      if (Array.isArray(nextPayload.inputs) && nextPayload.inputs.length > 0) {
        persistParseDebug(lastDebugRecord);
        return nextPayload;
      }
      return null;
    };
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    };
    const getVariants = [
      { apiKey, webappId: normalizedId },
      { apiKey, webAppId: normalizedId },
      { apiKey, appId: normalizedId },
      { apikey: apiKey, webappId: normalizedId }
    ];
    for (const query of getVariants) {
      try {
        const { ok, status, result } = await fetchJson(buildParseUrl(PARSE_ENDPOINT, query), { method: "GET", headers });
        const parsed = tryHandleResult(PARSE_ENDPOINT, result);
        if (parsed) {
          return { ok: true, appId: normalizedId, name: parsed.name, description: parsed.description || "", inputs: parsed.inputs, source: "remote-parse" };
        }
        reasons.push(`apiCallDemo(GET): ${resolveMessage(result, `HTTP ${status}`)}`);
        if (ok && result && (result.code === 0 || result.success === true)) {
          const retry = tryHandleResult(PARSE_ENDPOINT, result);
          if (retry) {
            return { ok: true, appId: normalizedId, name: retry.name, description: retry.description || "", inputs: retry.inputs, source: "remote-parse" };
          }
        }
      } catch (error) {
        reasons.push(`apiCallDemo(GET): ${error.message}`);
      }
    }
    const postVariants = [
      { apiKey, webappId: normalizedId },
      { apiKey, webAppId: normalizedId },
      { apiKey, appId: normalizedId }
    ];
    for (const body of postVariants) {
      try {
        const { status, result } = await fetchJson(`${API_BASE_URL}${PARSE_ENDPOINT}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        });
        const parsed = tryHandleResult(PARSE_ENDPOINT, result);
        if (parsed) {
          return { ok: true, appId: normalizedId, name: parsed.name, description: parsed.description || "", inputs: parsed.inputs, source: "remote-parse" };
        }
        reasons.push(`apiCallDemo(POST): ${resolveMessage(result, `HTTP ${status}`)}`);
      } catch (error) {
        reasons.push(`apiCallDemo(POST): ${error.message}`);
      }
    }
    for (const endpoint of PARSE_FALLBACKS) {
      for (const url of buildFallbackUrls(endpoint, normalizedId)) {
        try {
          const { ok, status, result } = await fetchJson(url, { method: "GET", headers });
          const parsed = tryHandleResult(endpoint, result);
          if (parsed) {
            return { ok: true, appId: normalizedId, name: parsed.name, description: parsed.description || "", inputs: parsed.inputs, source: "remote-parse" };
          }
          reasons.push(`${endpoint}: ${resolveMessage(result, `HTTP ${status}`)}`);
          if (ok && result && (result.code === 0 || result.success === true)) {
            const retry = tryHandleResult(endpoint, result);
            if (retry) {
              return { ok: true, appId: normalizedId, name: retry.name, description: retry.description || "", inputs: retry.inputs, source: "remote-parse" };
            }
          }
        } catch (error) {
          reasons.push(`${endpoint}: ${error.message}`);
        }
      }
    }
    const message = reasons[0] || "自动解析失败：未识别到可用输入参数";
    persistParseDebug({
      ...lastDebugRecord || {},
      endpoint: PARSE_ENDPOINT,
      appId: normalizedId,
      phase: "request_failed",
      message,
      reasons,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    throw createParseError(message, { appId: normalizedId, endpoint: PARSE_ENDPOINT, reasons });
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
      console.log("[PixelRunner/Host] bridge request", message.method, message.id || "");
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
        case "runninghub.parseApp":
          result = await parseRunningHubApp(message.args);
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
      console.log("[PixelRunner/Host] bridge success", message.method, {
        id: message.id || "",
        hasResult: result !== null && result !== void 0
      });
      webviewEl.postMessage(createBridgeResponse(message, result, null));
    } catch (error) {
      console.error("[PixelRunner/Host] bridge error", message.method, error);
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
