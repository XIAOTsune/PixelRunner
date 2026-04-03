const { app, core, action } = require("photoshop");
const { storage } = require("uxp");
const {
  createAbortError,
  isAbortError,
  isTimeoutError,
  normalizePasteStrategy
} = require("./shared");
const {
  IMAGE_DECODE_TIMEOUT_MS,
  CONTENT_ANALYSIS_TIMEOUT_MS,
  SMART_ANALYSIS_TIMEOUT_MS,
  SMART_SCORE_THRESHOLD,
  SMART_ENHANCED_SCORE_THRESHOLD,
  buildContentReference,
  buildCropBounds,
  computeSmartAlignment,
  computeSmartEnhancedAlignment,
  alignActiveLayerToBounds
} = require("./alignment");

const fs = storage.localFileSystem;
const formats = storage.formats;

function normalizePlacementTarget(value) {
  if (!value || typeof value !== "object") return null;
  const documentId = Number(value.documentId);
  if (!Number.isFinite(documentId) || documentId <= 0) return null;
  return {
    documentId: Math.floor(documentId),
    sourceInputKey: String(value.sourceInputKey || ""),
    capturedAt: Number(value.capturedAt) || 0
  };
}

function listOpenDocuments() {
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

function findOpenDocumentById(documentId) {
  const targetId = Number(documentId);
  if (!Number.isFinite(targetId) || targetId <= 0) return null;
  const docs = listOpenDocuments();
  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i];
    if (!doc || typeof doc !== "object") continue;
    if (Number(doc.id) === targetId) return doc;
  }
  return null;
}

function formatPlacementTargetMeta(placementTarget) {
  if (!placementTarget) return "";
  const key = String(placementTarget.sourceInputKey || "").trim();
  const capturedAt = Number(placementTarget.capturedAt) || 0;
  const keyPart = key ? `, sourceInputKey=${key}` : "";
  const tsPart = capturedAt > 0 ? `, capturedAt=${capturedAt}` : "";
  return `${keyPart}${tsPart}`;
}

async function activatePlacementTargetDocument(placementTarget) {
  const target = findOpenDocumentById(placementTarget.documentId);
  const targetMeta = formatPlacementTargetMeta(placementTarget);
  if (!target) {
    throw new Error(`placement target document unavailable: ${placementTarget.documentId}${targetMeta}`);
  }

  if (app.activeDocument && Number(app.activeDocument.id) === placementTarget.documentId) {
    return target;
  }

  if (typeof target.activate === "function") {
    await target.activate();
  }
  if (app.activeDocument && Number(app.activeDocument.id) === placementTarget.documentId) {
    return target;
  }

  try {
    app.activeDocument = target;
  } catch (_) {}
  if (app.activeDocument && Number(app.activeDocument.id) === placementTarget.documentId) {
    return target;
  }

  await action.batchPlay([{
    _obj: "select",
    _target: [{ _ref: "document", _id: placementTarget.documentId }]
  }], {});
  if (app.activeDocument && Number(app.activeDocument.id) === placementTarget.documentId) {
    return target;
  }

  throw new Error(`failed to activate placement target document: ${placementTarget.documentId}${targetMeta}`);
}

async function placeImage(arrayBuffer, options = {}) {
  const log = options.log || (() => {});
  const signal = options.signal || null;
  const targetBoundsRaw = options.targetBounds || null;
  const pasteStrategy = normalizePasteStrategy(options.pasteStrategy);
  const sourceBuffer = options.sourceBuffer || null;
  const placementTarget = normalizePlacementTarget(options.placementTarget);
  let contentReference = { mode: "cover", sourceSize: null, sourceRefBox: null };
  let smartTransform = null;
  const useSmart = pasteStrategy === "smart" || pasteStrategy === "smartEnhanced";
  const useSmartEnhanced = pasteStrategy === "smartEnhanced";
  if (options.placementTarget && !placementTarget) {
    log("placementTarget ignored: invalid documentId", "warn");
  }
  if (targetBoundsRaw) {
    log("buildContentReference start", "info");
    try {
      if (!useSmart) {
        contentReference = await buildContentReference(arrayBuffer, pasteStrategy, {
          log,
          signal,
          analysisTimeoutMs: CONTENT_ANALYSIS_TIMEOUT_MS,
          imageDecodeTimeoutMs: IMAGE_DECODE_TIMEOUT_MS
        });
      }
    } finally {
      log("buildContentReference end", "info");
    }
  }

  if (signal && signal.aborted) throw createAbortError("鐢ㄦ埛涓");
  if (targetBoundsRaw) {
    if (useSmart) {
      log(`Paste strategy in effect: ${useSmartEnhanced ? "smartEnhanced" : "smart"}`, "info");
    } else {
      const marker = contentReference.sourceRefBox ? `${contentReference.mode}+content-box` : contentReference.mode;
      log(`Paste strategy in effect: ${pasteStrategy} -> ${marker}`, "info");
    }
  }

  await core.executeAsModal(async () => {
    if (signal && signal.aborted) throw createAbortError("鐢ㄦ埛涓");
    if (placementTarget) {
      try {
        await activatePlacementTargetDocument(placementTarget);
        log(`placement target activated: documentId=${placementTarget.documentId}`, "info");
      } catch (error) {
        const message = error && error.message ? error.message : String(error || "unknown error");
        log(`placement target activation failed, fallback to active document: ${message}`, "error");
      }
    }
    const doc = app.activeDocument;
    if (!doc) throw new Error("placeImage requires an active document");
    const tempFolder = await fs.getTemporaryFolder();
    const tempFile = await tempFolder.createFile("result.png", { overwrite: true });
    await tempFile.write(arrayBuffer, { format: formats.binary });
    const sessionToken = await fs.createSessionToken(tempFile);

    log("placeEvent start", "info");
    try {
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
    } finally {
      log("placeEvent end", "info");
    }

    if (!targetBoundsRaw) return;
    if (signal && signal.aborted) throw createAbortError("鐢ㄦ埛涓");

    const targetBounds = buildCropBounds(targetBoundsRaw, doc);
    if (useSmart) {
      const computeLabel = useSmartEnhanced ? "computeSmartEnhancedAlignment" : "computeSmartAlignment";
      const alignLabel = useSmartEnhanced ? "smart enhanced" : "smart";
      log(`${computeLabel} start`, "info");
      try {
        if (sourceBuffer instanceof ArrayBuffer) {
          smartTransform = useSmartEnhanced
            ? await computeSmartEnhancedAlignment(sourceBuffer, arrayBuffer, {
              log,
              signal,
              analysisTimeoutMs: SMART_ANALYSIS_TIMEOUT_MS,
              imageDecodeTimeoutMs: IMAGE_DECODE_TIMEOUT_MS
            })
            : await computeSmartAlignment(sourceBuffer, arrayBuffer, {
            log,
            signal,
            analysisTimeoutMs: SMART_ANALYSIS_TIMEOUT_MS,
            imageDecodeTimeoutMs: IMAGE_DECODE_TIMEOUT_MS
          });
        } else {
          log(`${alignLabel} alignment skipped: source buffer missing`, "warn");
        }
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (isTimeoutError(error)) {
          log(`${alignLabel} alignment timeout, fallback to normal: ${error.message || error}`, "warn");
        } else {
          log(`${alignLabel} alignment failed, fallback to normal: ${error.message || error}`, "warn");
        }
        smartTransform = null;
      } finally {
        log(`${computeLabel} end`, "info");
      }

      if (smartTransform && smartTransform.score !== undefined) {
        const score = Number(smartTransform.score);
        const center = smartTransform.metrics && smartTransform.metrics.centerOffset;
        const ratioDiff = smartTransform.metrics && smartTransform.metrics.ratioDiff;
        const iou = smartTransform.metrics && smartTransform.metrics.iou;
        const baseScore = smartTransform.metrics && Number(smartTransform.metrics.baseScore);
        const candidateScore = smartTransform.metrics && Number(smartTransform.metrics.candidateScore);
        const sourceCandidateRank = smartTransform.metrics && Number(smartTransform.metrics.sourceCandidateRank);
        const outputCandidateRank = smartTransform.metrics && Number(smartTransform.metrics.outputCandidateRank);
        const sourceMethod = smartTransform.sourceMethod || "-";
        const outputMethod = smartTransform.outputMethod || "-";
        const angle = smartTransform.metrics && Number(smartTransform.metrics.angle);
        const enhancedConfidence = smartTransform.metrics && Number(smartTransform.metrics.enhancedConfidence);
        const residualLimit = smartTransform.metrics && Number(smartTransform.metrics.residualLimit);
        log(
          `${alignLabel} score: ${Number.isFinite(score) ? score.toFixed(3) : "n/a"}, base=${Number.isFinite(baseScore) ? baseScore.toFixed(3) : "-"}, candidate=${Number.isFinite(candidateScore) ? candidateScore.toFixed(3) : "-"}, center=(${center ? center.dx.toFixed(1) : "-"},${center ? center.dy.toFixed(1) : "-"}), ratioDiff=${Number.isFinite(ratioDiff) ? ratioDiff.toFixed(3) : "-"}, iou=${Number.isFinite(iou) ? iou.toFixed(3) : "-"}, angle=${Number.isFinite(angle) ? angle.toFixed(2) : "-"}, conf=${Number.isFinite(enhancedConfidence) ? enhancedConfidence.toFixed(3) : "-"}, residualLimit=${Number.isFinite(residualLimit) ? residualLimit.toFixed(3) : "-"}, rank=(${Number.isFinite(sourceCandidateRank) ? sourceCandidateRank : "-"}/${Number.isFinite(outputCandidateRank) ? outputCandidateRank : "-"}), method=(${sourceMethod}/${outputMethod})`,
          "info"
        );
      }

      const score = smartTransform && Number(smartTransform.score);
      const scoreThreshold = useSmartEnhanced ? SMART_ENHANCED_SCORE_THRESHOLD : SMART_SCORE_THRESHOLD;
      if (!smartTransform || !Number.isFinite(score) || score < scoreThreshold) {
        const reason = smartTransform && smartTransform.reason ? smartTransform.reason : "score-threshold";
        log(
          `${alignLabel} fallback to normal: ${reason}, score=${Number.isFinite(score) ? score.toFixed(3) : "n/a"}, threshold=${scoreThreshold.toFixed(3)}`,
          "warn"
        );
        smartTransform = null;
      }
    }
    log("alignActiveLayerToBounds start", "info");
    try {
      await alignActiveLayerToBounds(targetBounds, {
        mode: contentReference.mode || "cover",
        sourceSize: contentReference.sourceSize || null,
        sourceRefBox: contentReference.sourceRefBox || null,
        smartTransform,
        useMask: Boolean(smartTransform),
        outputSize: smartTransform && smartTransform.outputSize ? smartTransform.outputSize : null,
        sourceBounds: smartTransform && smartTransform.sourceBox ? smartTransform.sourceBox : null,
        targetBounds,
        log
      });
    } catch (e) {
      log(`缁撴灉鍥惧榻愬け璐ワ紝宸蹭繚鐣欓粯璁や綅缃? ${e.message}`, "warn");
    } finally {
      log("alignActiveLayerToBounds end", "info");
    }
  }, { commandName: "Place AI Result" });
}

/**
 * 鍒涘缓涓€х伆鍥惧眰锛堢敤浜庡姞娣卞噺娣★級
 * 閫昏緫锛氭柊寤哄浘灞?-> 濉厖50%鐏?-> 妯″紡璁句负鏌斿厜
 */
module.exports = {
  placeImage
};
