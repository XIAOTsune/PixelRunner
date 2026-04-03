(function initPixelRunnerHostPhotoshop(global) {
  async function ensureDeps() {
    if (typeof require !== "function") {
      throw new Error("Photoshop host dependencies are unavailable");
    }

    const photoshop = require("photoshop");
    const uxp = require("uxp");
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

  function toNumberValue(value) {
    if (value == null) return null;
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "object") {
      const nested = value._value ?? value.value;
      const result = Number(nested);
      return Number.isFinite(result) ? result : null;
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
      resolution: toNumberValue(doc.resolution)
    };
  }

  async function getActiveDocumentInfo() {
    const { photoshop } = await ensureDeps();
    return getDocumentInfo(photoshop.app && photoshop.app.activeDocument);
  }

  function buildDataUrl(mimeType, base64) {
    return `data:${mimeType};base64,${base64}`;
  }

  async function captureDocumentPreview(options = {}) {
    const { photoshop } = await ensureDeps();
    const app = photoshop.app;
    const imaging = photoshop.imaging;
    const doc = app && app.activeDocument;
    if (!doc) {
      throw new Error("No active Photoshop document");
    }

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
        targetSize: {
          width: targetWidth,
          height: targetHeight
        },
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
        // Ignore imaging cleanup failures.
      }
    }
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

  async function getActiveLayerOrThrow() {
    const { app, document } = await ensureActiveDocument();
    const activeLayers = document.activeLayers;
    if (!activeLayers || !activeLayers.length) {
      throw new Error("No active Photoshop layer");
    }

    return {
      app,
      document,
      layer: activeLayers[0]
    };
  }

  async function runToolAction(payload = {}) {
    const { photoshop, app, document } = await ensureActiveDocument();
    const core = photoshop.core;
    const action = photoshop.action;
    const constants = photoshop.constants || {};
    const actionName = String(payload.action || "").trim();

    if (!actionName) {
      throw new Error("Tool action is missing");
    }

    return core.executeAsModal(async () => {
      switch (actionName) {
        case "observerLayer": {
          // Inference from Adobe's batchPlay descriptor model plus LayerKind.BLACKANDWHITE:
          // create a Black & White adjustment layer through an adjustmentLayer "make" command.
          const result = await action.batchPlay([{
            _obj: "make",
            _target: [{ _ref: "adjustmentLayer" }],
            using: {
              _obj: "adjustmentLayer",
              name: String(payload.layerName || "黑白观察层"),
              type: {
                _obj: "blackAndWhite"
              }
            }
          }], {});

          const activeLayer = app.activeDocument && app.activeDocument.activeLayers && app.activeDocument.activeLayers[0];
          return {
            ok: true,
            action: actionName,
            result,
            document: getDocumentInfo(app.activeDocument),
            layerName: String((activeLayer && activeLayer.name) || payload.layerName || "黑白观察层"),
            message: "已创建黑白观察层"
          };
        }
        case "neutralGrayLayer": {
          const layer = await document.createLayer({
            name: "中性灰图层",
            blendMode: constants.BlendMode ? constants.BlendMode.SOFTLIGHT : undefined,
            fillNeutral: true,
            opacity: 100
          });

          return {
            ok: true,
            action: actionName,
            document: getDocumentInfo(app.activeDocument),
            layerName: String((layer && layer.name) || "中性灰图层"),
            message: "已创建中性灰图层"
          };
        }
        case "gaussianBlur": {
          const { layer } = await getActiveLayerOrThrow();
          const radius = Math.max(0.1, Math.min(250, Number(payload.radius) || 4));
          await layer.applyGaussianBlur(radius);
          return {
            ok: true,
            action: actionName,
            radius,
            document: getDocumentInfo(app.activeDocument),
            layerName: String(layer.name || ""),
            message: `已应用高斯模糊 (${radius}px)`
          };
        }
        case "sharpen": {
          const { layer } = await getActiveLayerOrThrow();
          await layer.applySharpen();
          return {
            ok: true,
            action: actionName,
            document: getDocumentInfo(app.activeDocument),
            layerName: String(layer.name || ""),
            message: "已执行锐化"
          };
        }
        case "highPass": {
          const { layer } = await getActiveLayerOrThrow();
          const radius = Math.max(0.1, Math.min(250, Number(payload.radius) || 2));
          await layer.applyHighPass(radius);
          return {
            ok: true,
            action: actionName,
            radius,
            document: getDocumentInfo(app.activeDocument),
            layerName: String(layer.name || ""),
            message: `已应用高反差保留 (${radius}px)`
          };
        }
        case "stampVisible": {
          const saveOptions = constants.SaveOptions || {};
          const tempDoc = await document.duplicate("PixelRunner Stamp Temp", true);
          try {
            const tempLayer = tempDoc && tempDoc.activeLayers && tempDoc.activeLayers[0];
            if (!tempLayer) {
              throw new Error("Stamp visible temp layer is unavailable");
            }

            const duplicatedLayer = await tempLayer.duplicate(document);
            if (duplicatedLayer) {
              try {
                duplicatedLayer.name = String(payload.layerName || "盖印图层");
              } catch (_) {
                // Ignore rename failures after duplicate.
              }
            }

            app.activeDocument = document;
            return {
              ok: true,
              action: actionName,
              document: getDocumentInfo(document),
              layerName: String((duplicatedLayer && duplicatedLayer.name) || payload.layerName || "盖印图层"),
              message: "已生成盖印图层"
            };
          } finally {
            try {
              await tempDoc.close(saveOptions.DONOTSAVECHANGES);
            } catch (_) {
              // Ignore temp doc cleanup failures.
            }
            try {
              app.activeDocument = document;
            } catch (_) {
              // Ignore active document restore failures.
            }
          }
        }
        default:
          throw new Error(`Unsupported tool action: ${actionName}`);
      }
    }, {
      commandName: `PixelRunner Tool: ${actionName}`
    });
  }

  async function placeImageFromUrl(payload) {
    const options = payload && typeof payload === "object" ? payload : {};
    const url = String(options.url || "").trim();
    if (!url) {
      throw new Error("Result URL is missing");
    }

    const { photoshop, storage } = await ensureDeps();
    const app = photoshop.app;
    const core = photoshop.core;
    const action = photoshop.action;

    if (!app || !app.activeDocument) {
      throw new Error("No active Photoshop document");
    }

    const currentDocument = app.activeDocument;
    const currentInfo = getDocumentInfo(currentDocument);
    const expectedDocumentId = Number(options.sourceDocumentId);
    const requireSameDocument = options.requireSameDocument !== false;
    if (
      requireSameDocument &&
      Number.isFinite(expectedDocumentId) &&
      expectedDocumentId > 0 &&
      Number(currentInfo.documentId) !== expectedDocumentId
    ) {
      throw new Error(
        `Active document changed. Expected #${expectedDocumentId}, current is #${currentInfo.documentId}.`
      );
    }

    const buffer = await fetchBinary(url);
    const fs = storage.localFileSystem;
    const formats = storage.formats;
    const tempFolder = await fs.getTemporaryFolder();
    const tempFile = await tempFolder.createFile("pixelrunner-result.png", { overwrite: true });
    await tempFile.write(buffer, { format: formats.binary });
    const sessionToken = await fs.createSessionToken(tempFile);

    await core.executeAsModal(async () => {
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
    }, { commandName: "Place PixelRunner Result" });

    const layerName = await renameActiveLayer(options.layerName);
    const latestInfo = getDocumentInfo(app.activeDocument);

    return {
      ok: true,
      placed: true,
      documentId: Number(latestInfo.documentId) || 0,
      layerName: layerName || null,
      document: latestInfo
    };
  }

  global.PixelRunnerHost = global.PixelRunnerHost || {};
  global.PixelRunnerHost.photoshop = {
    getActiveDocumentInfo,
    captureDocumentPreview,
    runToolAction,
    placeImageFromUrl
  };
})(window);
