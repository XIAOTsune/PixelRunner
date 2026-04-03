import { ensureDeps } from "./deps.js";

export function toNumberValue(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") {
    const nested = value._value ?? value.value;
    const result = Number(nested);
    return Number.isFinite(result) ? result : null;
  }
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function getDocumentInfo(doc) {
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

export function buildDataUrl(mimeType, base64) {
  return `data:${mimeType};base64,${base64}`;
}

export function ensureSelectionExists(doc) {
  try {
    const bounds = doc && doc.selection && doc.selection.bounds;
    return Boolean(bounds);
  } catch (_) {
    return false;
  }
}

export function normalizeBounds(rawBounds) {
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

export function getSelectionBounds(doc) {
  try {
    return normalizeBounds(doc && doc.selection && doc.selection.bounds);
  } catch (_) {
    return null;
  }
}

export function listOpenDocuments(app) {
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

export function findOpenDocumentById(app, documentId) {
  const targetId = Number(documentId);
  if (!Number.isFinite(targetId) || targetId <= 0) return null;
  return listOpenDocuments(app).find((doc) => Number(doc && doc.id) === targetId) || null;
}

export async function activateDocument(app, action, documentId) {
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
    } catch (_) {}
  }

  if (app.activeDocument && Number(app.activeDocument.id) === targetId) {
    return app.activeDocument;
  }

  try {
    app.activeDocument = target;
  } catch (_) {}

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

export async function renameActiveLayer(layerName) {
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

export async function ensureActiveDocument() {
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
