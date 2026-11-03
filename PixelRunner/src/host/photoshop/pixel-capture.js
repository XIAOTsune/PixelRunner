import { ensureDeps } from "./deps.js";
import { findOpenDocumentById, listOpenDocuments, normalizeDocumentMode, STANDARD_PIXEL_COLOR_PROFILE, STANDARD_PIXEL_COLOR_SPACE } from "./document.js";

export function buildPixelCaptureOptions(options = {}) {
  return {
    ...options,
    colorSpace: STANDARD_PIXEL_COLOR_SPACE,
    colorProfile: STANDARD_PIXEL_COLOR_PROFILE,
    componentSize: 8
  };
}

function isStandardSrgbProfile(profile) {
  const normalized = String(profile || "")
    .trim()
    .replace(/^(?:working\s+rgb|工作中的\s*rgb)\s*[-\u2013\u2014:：]\s*/i, "")
    .trim();
  return normalized.toLowerCase() === STANDARD_PIXEL_COLOR_PROFILE.toLowerCase();
}

export function getPixelDataInfo(imageData) {
  const data = imageData && imageData.data;
  const typedSize = data instanceof Float32Array || data instanceof Float64Array ? 32
    : data instanceof Uint16Array || data instanceof Int16Array ? 16
      : data instanceof Uint8Array || data instanceof Uint8ClampedArray ? 8 : null;
  return {
    colorSpace: String(imageData && imageData.colorSpace || "").trim(),
    colorProfile: String(imageData && imageData.colorProfile || "").trim(),
    componentSize: Number(imageData && (imageData.componentSize ?? imageData.bitsPerComponent ?? imageData.bitsPerChannel)) || typedSize
  };
}

export async function getSrgb8Pixels(imaging, options = {}, compatibilityFallback = null) {
  if (!imaging || typeof imaging.getPixels !== "function") throw new Error("Photoshop Imaging API 不可用");
  const requested = buildPixelCaptureOptions(options);
  const attempts = [requested, { ...requested }];
  delete attempts[1].componentSize;
  const errors = [];
  for (const attempt of attempts) {
    let result;
    try {
      result = await imaging.getPixels(attempt);
    } catch (error) {
      errors.push(error);
      continue;
    }
    const facts = getPixelDataInfo(result && result.imageData);
    console.info("[PixelRunner/Photoshop] getPixels color result", JSON.stringify({ requested: attempt, returned: facts }));
    if (facts.colorSpace.toUpperCase() !== "RGB") {
      try { result.imageData && result.imageData.dispose && result.imageData.dispose(); } catch (_) {}
      errors.push(new Error(`Photoshop 返回 ${facts.colorSpace || "未知颜色空间"} 数据，编码器要求 RGB`));
      continue;
    }
    if (!isStandardSrgbProfile(facts.colorProfile)) {
      try { result.imageData && result.imageData.dispose && result.imageData.dispose(); } catch (_) {}
      errors.push(new Error(`Photoshop 返回配置文件「${facts.colorProfile || "未指定（使用文档配置文件）"}」，预期 ${STANDARD_PIXEL_COLOR_PROFILE}`));
      continue;
    }
    if (facts.componentSize !== 8) {
      try { result.imageData && result.imageData.dispose && result.imageData.dispose(); } catch (_) {}
      errors.push(new Error(`Photoshop 返回 ${facts.componentSize || "未知位深"} 数据；当前编码路径要求明确的 8 位`));
      continue;
    }
    return result;
  }
  if (typeof compatibilityFallback === "function") {
    try {
      const result = await compatibilityFallback(requested);
      const facts = getPixelDataInfo(result && result.imageData);
      console.info("[PixelRunner/Photoshop] temporary-copy getPixels color result", JSON.stringify({ requested, returned: facts }));
      if (facts.colorSpace.toUpperCase() === "RGB" && isStandardSrgbProfile(facts.colorProfile) && facts.componentSize === 8) {
        return result;
      }
      try { result && result.imageData && result.imageData.dispose && result.imageData.dispose(); } catch (_) {}
      errors.push(new Error(`临时副本返回了 ${facts.colorSpace || "未知颜色空间"}/${facts.colorProfile || "无配置文件"}/${facts.componentSize || "未知位深"}，预期 RGB/sRGB/8 位`));
    } catch (error) {
      errors.push(error);
    }
  }
  const details = errors.map((error, index) => `尝试${index + 1}: ${String(error && error.message || error)}`).join("；");
  const error = new Error(`Photoshop 无法将当前文档转换为 RGB/sRGB/8 位像素。请确认该文档模式受当前 Photoshop Imaging API 支持。${details}`);
  error.causes = errors;
  throw error;
}

// Only call this on a disposable document copy, never the user document.
export async function prepareTemporaryRgb8Document(tempDoc, action) {
  const mode = normalizeDocumentMode(tempDoc.mode);
  const toRgb = async () => action.batchPlay([{
    _obj: "convertMode",
    _target: [{ _ref: "document", _id: Number(tempDoc.id) }],
    _to: { _class: "RGBColor" },
    merge: true,
    _options: { dialogOptions: "dontDisplay" }
  }], {});
  if (mode !== "RGB") {
    if (["BITMAP", "DUOTONE", "MULTICHANNEL"].includes(mode)) {
      await action.batchPlay([{
        _obj: "convertMode",
        _target: [{ _ref: "document", _id: Number(tempDoc.id) }],
        _to: { _class: "grayscaleMode" },
        merge: true,
        _options: { dialogOptions: "dontDisplay" }
      }], {});
    }
    await toRgb();
  }
  const bits = String(tempDoc.bitsPerChannel && (tempDoc.bitsPerChannel._value ?? tempDoc.bitsPerChannel.value ?? tempDoc.bitsPerChannel) || "").toUpperCase();
  if (!bits.includes("8") && !bits.includes("EIGHT")) {
    await action.batchPlay([{
      _obj: "convertMode",
      _target: [{ _ref: "document", _id: Number(tempDoc.id) }],
      depth: 8,
      merge: true,
      _options: { dialogOptions: "dontDisplay" }
    }], {});
  }
  // getPixels applies the requested sRGB profile during capture. Keeping the
  // duplicate's profile untouched avoids triggering profile-policy dialogs.
}

export async function capturePixelsFromTemporaryRgbCopy(imaging, options) {
  const deps = await ensureDeps();
  const { app, action } = deps.photoshop;
  const documentId = Number(options && (options.documentID ?? options.documentId)) || 0;
  const sourceDoc = findOpenDocumentById(app, documentId);
  if (!sourceDoc) throw new Error(`无法创建颜色兼容副本：文档 #${documentId} 已不可用`);
  const originalActiveId = Number(app.activeDocument && app.activeDocument.id) || 0;
  let tempDoc = null;
  try {
    tempDoc = await sourceDoc.duplicate(`PixelRunner Color Capture ${Date.now()}`);
    try { if (typeof tempDoc.flatten === "function") await tempDoc.flatten(); } catch (_) {}
    await prepareTemporaryRgb8Document(tempDoc, action);
    return await imaging.getPixels({ ...options, documentID: Number(tempDoc.id) });
  } catch (error) {
    throw new Error(`临时副本 RGB/8 位兼容转换失败（原模式 ${normalizeDocumentMode(sourceDoc.mode) || "未知"}）：${String(error && error.message || error)}`);
  } finally {
    if (tempDoc) {
      try {
        if (typeof tempDoc.closeWithoutSaving === "function") await tempDoc.closeWithoutSaving();
        else await action.batchPlay([{
          _obj: "close",
          _target: [{ _ref: "document", _id: Number(tempDoc.id) }],
          saving: { _enum: "yesNo", _value: "no" },
          _options: { dialogOptions: "dontDisplay" }
        }], {});
      } catch (error) {
        console.error("[PixelRunner/Photoshop] failed to close color capture copy", error);
      }
    }
    const activeStillOpen = listOpenDocuments(app).some((doc) => Number(doc && doc.id) === originalActiveId);
    if (originalActiveId > 0 && activeStillOpen) {
      const original = findOpenDocumentById(app, originalActiveId);
      try {
        if (original && typeof original.activate === "function") await original.activate();
        else if (original) app.activeDocument = original;
      } catch (error) {
        console.error("[PixelRunner/Photoshop] failed to restore active document after color capture", error);
      }
    }
  }
}

export function normalizeFloatComponentToByte(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  // Photoshop is asked to convert to sRGB/8-bit before capture. Float data here
  // is only accepted in the normalized SDR range; HDR requires Photoshop tone mapping.
  if (numeric < 0 || numeric > 1) throw new Error("检测到超出 [0,1] 的 HDR 浮点像素；需由 Photoshop 转换/色调映射后再捕获");
  return Math.round(numeric * 255);
}

export function selectConsistentPngColorChunks(chunks = []) {
  const byType = new Map();
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    const type = String(chunk && chunk.type || "");
    if (["iCCP", "sRGB", "gAMA", "cHRM", "sBIT", "cICP", "mDCv", "cLLi"].includes(type) && !byType.has(type)) byType.set(type, chunk);
  }
  if (byType.has("iCCP")) return [byType.get("iCCP"), ...(byType.has("sBIT") ? [byType.get("sBIT")] : [])];
  if (byType.has("sRGB")) return [byType.get("sRGB"), ...(byType.has("sBIT") ? [byType.get("sBIT")] : [])];
  if (byType.has("cICP")) return [byType.get("cICP"), ...(byType.has("mDCv") ? [byType.get("mDCv")] : []), ...(byType.has("cLLi") ? [byType.get("cLLi")] : [])];
  return ["cHRM", "gAMA", "sBIT"].filter((type) => byType.has(type)).map((type) => byType.get(type));
}
