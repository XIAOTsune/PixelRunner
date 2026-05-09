import { ensureDeps, fetchBinary } from "./deps.js";
import {
  activateDocument,
  buildDataUrl,
  ensureActiveDocument,
  getDocumentInfo,
  normalizeBounds,
  renameActiveLayer
} from "./document.js";
import { runToolActionByName } from "./tool-actions.js";

const DEFAULT_UPLOAD_TARGET_BYTES = 9_000_000;
const DEFAULT_UPLOAD_HARD_LIMIT_BYTES = 10_000_000;
const DEFAULT_UPLOAD_QUALITY_STEPS = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

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

function getAspectRatio(width, height) {
  const w = Number(width);
  const h = Number(height);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : 0;
}

function isFullDocumentBounds(bounds, docInfo) {
  if (!bounds || !docInfo) return false;
  const width = Math.max(1, Number(docInfo.width) || 1);
  const height = Math.max(1, Number(docInfo.height) || 1);
  return (
    Math.abs(Number(bounds.left) - 0) < 0.01 &&
    Math.abs(Number(bounds.top) - 0) < 0.01 &&
    Math.abs(Number(bounds.right) - width) < 0.01 &&
    Math.abs(Number(bounds.bottom) - height) < 0.01
  );
}

function dimensionsNearlyMatch(widthA, heightA, widthB, heightB, tolerance = 2) {
  return Math.abs(Number(widthA) - Number(widthB)) <= tolerance && Math.abs(Number(heightA) - Number(heightB)) <= tolerance;
}

function arrayBufferToBase64(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function concatUint8Arrays(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

async function inflatePngData(idatBytes) {
  if (!idatBytes || !idatBytes.length || typeof DecompressionStream !== "function") return null;
  const stream = new Blob([idatBytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function deflatePngData(bytes) {
  if (!bytes || !bytes.length || typeof CompressionStream !== "function") return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function paethPredictor(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function unfilterPngScanlines(inflated, width, height, bytesPerPixel, bytesPerLine) {
  const stride = bytesPerLine + 1;
  if (!inflated || inflated.length < stride * height) return null;
  const out = new Uint8Array(bytesPerLine * height);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * stride];
    const srcOffset = y * stride + 1;
    const rowOffset = y * bytesPerLine;
    const prevRowOffset = rowOffset - bytesPerLine;

    for (let x = 0; x < bytesPerLine; x += 1) {
      const raw = inflated[srcOffset + x];
      const left = x >= bytesPerPixel ? out[rowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[prevRowOffset + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[prevRowOffset + x - bytesPerPixel] : 0;
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paethPredictor(left, up, upLeft);
      else if (filter !== 0) return null;
      out[rowOffset + x] = value & 0xff;
    }
  }

  return out;
}

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    c = PNG_CRC_TABLE[(c ^ bytes[index]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function asciiBytes(value) {
  return Uint8Array.from(String(value).split("").map((char) => char.charCodeAt(0)));
}

function uint32Bytes(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0);
  return out;
}

function buildPngChunk(type, data = new Uint8Array()) {
  const typeBytes = asciiBytes(type);
  const crcInput = concatUint8Arrays([typeBytes, data]);
  return concatUint8Arrays([uint32Bytes(data.length), typeBytes, data, uint32Bytes(crc32(crcInput))]);
}

function buildPngRgbaBuffer(width, height, compressedScanlines) {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width >>> 0);
  view.setUint32(4, height >>> 0);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return concatUint8Arrays([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    buildPngChunk("IHDR", ihdr),
    buildPngChunk("IDAT", compressedScanlines),
    buildPngChunk("IEND")
  ]).buffer;
}

async function buildBoundsAnchoredPng(buffer, pngMeta) {
  if (
    !pngMeta ||
    pngMeta.colorType !== 6 ||
    pngMeta.bitDepth !== 8 ||
    pngMeta.interlaceMethod !== 0 ||
    !pngMeta.idatParts ||
    !pngMeta.idatParts.length
  ) {
    return null;
  }
  const bytesPerPixel = 4;
  const bytesPerLine = pngMeta.width * bytesPerPixel;
  const inflated = await inflatePngData(concatUint8Arrays(pngMeta.idatParts));
  const rawPixels = unfilterPngScanlines(inflated, pngMeta.width, pngMeta.height, bytesPerPixel, bytesPerLine);
  if (!rawPixels) return null;

  const anchors = [
    [0, 0],
    [pngMeta.width - 1, 0],
    [0, pngMeta.height - 1],
    [pngMeta.width - 1, pngMeta.height - 1]
  ];
  anchors.forEach(([x, y]) => {
    const offset = y * bytesPerLine + x * bytesPerPixel;
    if (rawPixels[offset + 3] === 0) {
      rawPixels[offset] = 0;
      rawPixels[offset + 1] = 0;
      rawPixels[offset + 2] = 0;
      rawPixels[offset + 3] = 1;
    }
  });

  const scanlines = new Uint8Array((bytesPerLine + 1) * pngMeta.height);
  for (let y = 0; y < pngMeta.height; y += 1) {
    const rowOffset = y * (bytesPerLine + 1);
    scanlines[rowOffset] = 0;
    scanlines.set(rawPixels.subarray(y * bytesPerLine, (y + 1) * bytesPerLine), rowOffset + 1);
  }
  const compressed = await deflatePngData(scanlines);
  if (!compressed) return null;
  return buildPngRgbaBuffer(pngMeta.width, pngMeta.height, compressed);
}

function getPngAlphaAt(rawPixels, x, y, info) {
  const offset = y * info.bytesPerLine + x * info.bytesPerPixel;
  if (info.colorType === 6) return rawPixels[offset + 3];
  if (info.colorType === 4) return rawPixels[offset + 1];
  if (info.colorType === 3) {
    const index = rawPixels[offset];
    return info.transparencyTable && index < info.transparencyTable.length ? info.transparencyTable[index] : 255;
  }
  if (info.colorType === 0 && info.transparentGray !== null) {
    return rawPixels[offset] === info.transparentGray ? 0 : 255;
  }
  if (info.colorType === 2 && info.transparentRgb) {
    return rawPixels[offset] === info.transparentRgb.r &&
      rawPixels[offset + 1] === info.transparentRgb.g &&
      rawPixels[offset + 2] === info.transparentRgb.b
      ? 0
      : 255;
  }
  return 255;
}

async function readPngAlphaBounds(buffer, pngMeta) {
  if (!pngMeta || pngMeta.interlaceMethod !== 0 || pngMeta.bitDepth !== 8 || !pngMeta.idatParts.length) return null;
  const channelsByColorType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const bytesPerPixel = channelsByColorType[pngMeta.colorType];
  if (!bytesPerPixel) return null;

  const inflated = await inflatePngData(concatUint8Arrays(pngMeta.idatParts));
  const bytesPerLine = pngMeta.width * bytesPerPixel;
  const rawPixels = unfilterPngScanlines(inflated, pngMeta.width, pngMeta.height, bytesPerPixel, bytesPerLine);
  if (!rawPixels) return null;

  const info = {
    bytesPerPixel,
    bytesPerLine,
    colorType: pngMeta.colorType,
    transparencyTable: pngMeta.transparencyTable,
    transparentGray: pngMeta.transparentGray,
    transparentRgb: pngMeta.transparentRgb
  };
  let left = pngMeta.width;
  let top = pngMeta.height;
  let right = 0;
  let bottom = 0;

  for (let y = 0; y < pngMeta.height; y += 1) {
    for (let x = 0; x < pngMeta.width; x += 1) {
      if (getPngAlphaAt(rawPixels, x, y, info) <= 0) continue;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x + 1 > right) right = x + 1;
      if (y + 1 > bottom) bottom = y + 1;
    }
  }

  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

async function parsePngInfo(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 33) return null;
  const bytes = new Uint8Array(buffer);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, index) => bytes[index] === value)) return null;

  const view = new DataView(buffer);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const interlaceMethod = bytes[28];
  let hasTransparency = colorType === 4 || colorType === 6;
  const idatParts = [];
  let transparencyTable = null;
  let transparentGray = null;
  let transparentRgb = null;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const type = String.fromCharCode(bytes[typeOffset], bytes[typeOffset + 1], bytes[typeOffset + 2], bytes[typeOffset + 3]);
    if (type === "IDAT") {
      idatParts.push(bytes.slice(dataOffset, dataOffset + length));
    } else if (type === "tRNS") {
      hasTransparency = true;
      if (colorType === 3) {
        transparencyTable = bytes.slice(dataOffset, dataOffset + length);
      } else if (colorType === 0 && length >= 2) {
        transparentGray = bytes[dataOffset + 1];
      } else if (colorType === 2 && length >= 6) {
        transparentRgb = {
          r: bytes[dataOffset + 1],
          g: bytes[dataOffset + 3],
          b: bytes[dataOffset + 5]
        };
      }
    }
    offset += 12 + length;
    if (type === "IEND" || offset > bytes.length) break;
  }

  const pngInfo = {
    isPng: true,
    width: Math.max(1, Number(width) || 1),
    height: Math.max(1, Number(height) || 1),
    bitDepth,
    colorType,
    interlaceMethod,
    hasTransparency,
    alphaBounds: null,
    boundsAnchored: false,
    _meta: {
      width: Math.max(1, Number(width) || 1),
      height: Math.max(1, Number(height) || 1),
      bitDepth,
      colorType,
      interlaceMethod,
      idatParts,
      transparencyTable,
      transparentGray,
      transparentRgb
    }
  };

  if (hasTransparency) {
    try {
      pngInfo.alphaBounds = await readPngAlphaBounds(buffer, {
        width: pngInfo.width,
        height: pngInfo.height,
        bitDepth,
        colorType,
        interlaceMethod,
        idatParts,
        transparencyTable,
        transparentGray,
        transparentRgb
      });
    } catch (_) {
      pngInfo.alphaBounds = null;
    }
  }

  return pngInfo;
}

function sanitizePngInfo(pngInfo) {
  if (!pngInfo) return null;
  const { _meta, ...safeInfo } = pngInfo;
  return safeInfo;
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

function toPixelNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value && typeof value === "object") {
    const nested = value._value ?? value.value;
    const parsed = Number(nested);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTransformPoint(point) {
  if (Array.isArray(point) && point.length >= 2) {
    const x = toPixelNumber(point[0]);
    const y = toPixelNumber(point[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  if (point && typeof point === "object") {
    const x = toPixelNumber(point.x ?? point.horizontal ?? point.left);
    const y = toPixelNumber(point.y ?? point.vertical ?? point.top);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  return null;
}

function parseTransformBounds(transform) {
  if (!transform) return null;
  let points = [];
  if (Array.isArray(transform)) {
    if (transform.length >= 8 && transform.every((item) => toPixelNumber(item) !== null)) {
      points = [
        { x: toPixelNumber(transform[0]), y: toPixelNumber(transform[1]) },
        { x: toPixelNumber(transform[2]), y: toPixelNumber(transform[3]) },
        { x: toPixelNumber(transform[4]), y: toPixelNumber(transform[5]) },
        { x: toPixelNumber(transform[6]), y: toPixelNumber(transform[7]) }
      ];
    } else {
      points = transform.map(parseTransformPoint).filter(Boolean);
    }
  } else if (typeof transform === "object") {
    points = [
      transform.topLeft,
      transform.topRight,
      transform.bottomRight,
      transform.bottomLeft,
      transform.quadTopLeft,
      transform.quadTopRight,
      transform.quadBottomRight,
      transform.quadBottomLeft
    ].map(parseTransformPoint).filter(Boolean);
  }
  if (points.length < 2) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

async function getActivePlacedLayerTransformBounds(action) {
  if (!action || typeof action.batchPlay !== "function") return null;
  try {
    const result = await action.batchPlay([{
      _obj: "get",
      _target: [
        { _property: "smartObjectMore" },
        { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }
      ],
      _options: { dialogOptions: "dontDisplay" }
    }], {});
    const smartObjectMore = result && result[0] && result[0].smartObjectMore;
    return parseTransformBounds(smartObjectMore && (smartObjectMore.transform || smartObjectMore.nonAffineTransform));
  } catch (_) {
    return null;
  }
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
  } catch (_) {}
}

async function resizeDocumentToLongEdge(action, docRef, maxEdge) {
  const limitedEdge = Math.max(256, Math.min(4096, Math.floor(Number(maxEdge) || 0)));
  if (!limitedEdge) return;

  const { width, height } = getDocumentPixelSize(docRef);
  const currentLongEdge = Math.max(width, height);
  if (currentLongEdge <= limitedEdge) return;

  const scale = limitedEdge / currentLongEdge;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  if (typeof docRef.resizeImage === "function") {
    await docRef.resizeImage(targetWidth, targetHeight);
    return;
  }

  await action.batchPlay([{
    _obj: "imageSize",
    _target: [{ _ref: "document", _id: Number(docRef.id) }],
    width: { _unit: "pixelsUnit", _value: targetWidth },
    height: { _unit: "pixelsUnit", _value: targetHeight },
    constrainProportions: true,
    interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "automaticInterpolation" }
  }], {});
}

function getDocumentPixelSize(docRef) {
  return {
    width: Math.max(1, Number(docRef && docRef.width && (docRef.width._value ?? docRef.width.value ?? docRef.width)) || 1),
    height: Math.max(1, Number(docRef && docRef.height && (docRef.height._value ?? docRef.height.value ?? docRef.height)) || 1)
  };
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
    const arrayBuffer = rawBuffer instanceof ArrayBuffer
      ? rawBuffer
      : ArrayBuffer.isView(rawBuffer)
        ? rawBuffer.buffer.slice(rawBuffer.byteOffset, rawBuffer.byteOffset + rawBuffer.byteLength)
        : new Uint8Array(rawBuffer || []).buffer;
    return {
      arrayBuffer,
      bytes: Math.max(0, Number(arrayBuffer && arrayBuffer.byteLength) || 0),
      mimeType: "image/jpeg"
    };
  } finally {
    await deleteFileQuietly(tempFile);
  }
}

async function exportCompressedJpegCandidate(storage, action, docRef, qualitySteps, targetBytes, hardLimitBytes) {
  let acceptedResult = null;
  let lastAttempt = null;
  const attempts = [];

  for (const quality of qualitySteps) {
    const exported = await exportDocumentAsJpeg(storage, action, docRef, quality, "pixelrunner-upload");
    const dimensions = getDocumentPixelSize(docRef);
    const attempt = {
      quality: Math.max(1, Math.min(12, Math.floor(Number(quality) || 8))),
      bytes: exported.bytes,
      width: dimensions.width,
      height: dimensions.height
    };
    attempts.push(attempt);
    lastAttempt = { ...exported, quality: attempt.quality, width: attempt.width, height: attempt.height };
    if (exported.bytes <= targetBytes) {
      acceptedResult = {
        ...exported,
        quality: attempt.quality,
        width: attempt.width,
        height: attempt.height
      };
      break;
    }
  }

  if (!acceptedResult && lastAttempt && lastAttempt.bytes <= hardLimitBytes) {
    acceptedResult = lastAttempt;
  }

  return { acceptedResult, attempts };
}

async function buildCompressedUploadAsset(doc, docInfo, selectionBounds, compressionOptions = {}, modalDeps = null) {
  const deps = modalDeps && typeof modalDeps === "object" ? modalDeps : await ensureDeps();
  const action = deps.photoshop.action;
  const storage = deps.storage;
  const cropBounds = clampBoundsToDocument(selectionBounds, docInfo);
  const maxDimension = Math.max(256, Math.min(4096, Math.floor(Number(compressionOptions.maxDimension) || 1536)));
  const targetBytes = Math.max(1, Math.floor(Number(compressionOptions.targetBytes) || DEFAULT_UPLOAD_TARGET_BYTES));
  const hardLimitBytes = Math.max(targetBytes, Math.floor(Number(compressionOptions.hardLimitBytes) || DEFAULT_UPLOAD_HARD_LIMIT_BYTES));
  const qualitySteps = Array.isArray(compressionOptions.qualitySteps) && compressionOptions.qualitySteps.length
    ? compressionOptions.qualitySteps
    : DEFAULT_UPLOAD_QUALITY_STEPS;

  let uploadResult = null;
  let attempts = [];

  let tempDoc = null;
  try {
    tempDoc = await doc.duplicate("pixelrunner_upload_capture");
    try {
      await tempDoc.flatten();
    } catch (_) {}

    const isSelectionCapture =
      selectionBounds &&
      (cropBounds.left > 0 ||
        cropBounds.top > 0 ||
        cropBounds.right < Math.max(1, Number(docInfo.width) || 1) ||
        cropBounds.bottom < Math.max(1, Number(docInfo.height) || 1));

    if (isSelectionCapture && typeof tempDoc.crop === "function") {
      await tempDoc.crop(cropBounds);
    }

    const originalCandidate = await exportCompressedJpegCandidate(
      storage,
      action,
      tempDoc,
      qualitySteps,
      targetBytes,
      hardLimitBytes
    );
    attempts = originalCandidate.attempts;
    uploadResult = originalCandidate.acceptedResult;

    if (!uploadResult) {
      await resizeDocumentToLongEdge(action, tempDoc, maxDimension);
      const resizedCandidate = await exportCompressedJpegCandidate(
        storage,
        action,
        tempDoc,
        qualitySteps,
        targetBytes,
        hardLimitBytes
      );
      attempts = attempts.concat(resizedCandidate.attempts);
      uploadResult = resizedCandidate.acceptedResult;
    }

    if (uploadResult) {
      uploadResult = {
        ...uploadResult,
        attempts,
        targetBytes,
        hardLimitBytes
      };
    }

    if (!uploadResult) {
      const error = new Error("图片压缩后仍超过上传限制");
      error.attempts = attempts;
      error.targetBytes = targetBytes;
      error.hardLimitBytes = hardLimitBytes;
      throw error;
    }
  } finally {
    await closeDocumentWithoutSaving(action, tempDoc);
  }

  if (!uploadResult || !(uploadResult.arrayBuffer instanceof ArrayBuffer)) {
    throw new Error("Failed to build upload asset");
  }

  const base64 = arrayBufferToBase64(uploadResult.arrayBuffer);
  const asset = {
    mimeType: uploadResult.mimeType,
    base64,
    dataUrl: buildDataUrl(uploadResult.mimeType, base64),
    bytes: uploadResult.bytes,
    width: uploadResult.width,
    height: uploadResult.height,
    quality: uploadResult.quality,
    targetBytes: uploadResult.targetBytes,
    hardLimitBytes: uploadResult.hardLimitBytes,
    attempts: uploadResult.attempts || []
  };
  console.log("[PixelRunner/Photoshop] buildCompressedUploadAsset:success", {
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    quality: asset.quality,
    targetBytes: asset.targetBytes,
    hardLimitBytes: asset.hardLimitBytes,
    hasBase64: Boolean(asset.base64)
  });
  return asset;
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

async function setActiveLayerStyle(action, options = {}) {
  const opacity = Number(options.opacity);
  const blendMode = String(options.blendMode || "").trim();
  const descriptor = {
    _obj: "set",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    to: { _obj: "layer" }
  };

  if (Number.isFinite(opacity)) {
    descriptor.to.opacity = { _unit: "percentUnit", _value: Math.min(100, Math.max(0, opacity)) };
  }
  if (blendMode) {
    descriptor.to.mode = { _enum: "blendMode", _value: blendMode };
  }
  if (!descriptor.to.opacity && !descriptor.to.mode) return;
  await action.batchPlay([descriptor], {});
}

async function alignPlacedLayerToBounds(doc, action, targetBounds, options = {}) {
  const layer = doc && doc.activeLayers && doc.activeLayers[0];
  const transformBounds = options.preferTransformBounds ? await getActivePlacedLayerTransformBounds(action) : null;
  const bounds = transformBounds || parseLayerBounds(layer && layer.bounds);
  if (!layer || !bounds || !targetBounds) return;

  const currentSize = getBoundsSize(bounds);
  const targetSize = getBoundsSize(targetBounds);
  const imageSize = options.imageSize || null;
  const alphaBounds = imageSize && imageSize.alphaBounds ? imageSize.alphaBounds : null;
  const canUseTransparentCanvas =
    options.mode === "transparent-png-canvas" &&
    imageSize &&
    Number(imageSize.width) > 0 &&
    Number(imageSize.height) > 0 &&
    alphaBounds &&
    Number(alphaBounds.width) > 0 &&
    Number(alphaBounds.height) > 0;
  const currentAspect = getAspectRatio(currentSize.width, currentSize.height);
  const canvasAspect = getAspectRatio(imageSize && imageSize.width, imageSize && imageSize.height);
  const alphaAspect = getAspectRatio(alphaBounds && alphaBounds.width, alphaBounds && alphaBounds.height);
  const currentLooksLikeFullCanvas =
    canUseTransparentCanvas &&
    canvasAspect > 0 &&
    Math.abs(currentAspect - canvasAspect) <= Math.abs(currentAspect - alphaAspect);
  const useTransparentCanvas = canUseTransparentCanvas && !currentLooksLikeFullCanvas;

  if (useTransparentCanvas) {
    const canvasScale = Math.min(targetSize.width / Number(imageSize.width), targetSize.height / Number(imageSize.height));
    if (Number.isFinite(canvasScale) && canvasScale > 0) {
      const desiredVisibleWidth = Number(alphaBounds.width) * canvasScale;
      const desiredVisibleHeight = Number(alphaBounds.height) * canvasScale;
      const scaleX = desiredVisibleWidth / currentSize.width;
      const scaleY = desiredVisibleHeight / currentSize.height;
      const scale = Math.min(scaleX, scaleY);
      if (Number.isFinite(scale) && scale > 0 && Math.abs(scale - 1) > 0.001) {
        await transformLayerScale(action, layer.id, scale * 100, scale * 100);
      }

      const nextLayer = doc && doc.activeLayers && doc.activeLayers[0];
      const nextTransformBounds = options.preferTransformBounds ? await getActivePlacedLayerTransformBounds(action) : null;
      const nextBounds = nextTransformBounds || parseLayerBounds(nextLayer && nextLayer.bounds);
      if (!nextLayer || !nextBounds) return;

      const fittedCanvasWidth = Number(imageSize.width) * canvasScale;
      const fittedCanvasHeight = Number(imageSize.height) * canvasScale;
      const canvasLeft = Number(targetBounds.left) + (targetSize.width - fittedCanvasWidth) / 2;
      const canvasTop = Number(targetBounds.top) + (targetSize.height - fittedCanvasHeight) / 2;
      const desiredVisibleCenter = {
        x: canvasLeft + (Number(alphaBounds.left) + Number(alphaBounds.width) / 2) * canvasScale,
        y: canvasTop + (Number(alphaBounds.top) + Number(alphaBounds.height) / 2) * canvasScale
      };
      const currentCenter = getBoundsCenter(nextBounds);
      const dx = desiredVisibleCenter.x - currentCenter.x;
      const dy = desiredVisibleCenter.y - currentCenter.y;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        await transformLayerOffset(action, nextLayer.id, dx, dy);
      }

      if (options.applyMask) {
        await createSelectionFromBounds(doc, targetBounds);
        await applyLayerMaskFromSelection(action);
      }
    }
    return;
  }

  const desiredSize =
    options.mode === "original" && options.imageSize && Number(options.imageSize.width) > 0 && Number(options.imageSize.height) > 0
      ? {
          width: Math.min(targetSize.width, Number(options.imageSize.width)),
          height: Math.min(targetSize.height, Number(options.imageSize.height))
        }
      : targetSize;
  const scaleX = desiredSize.width / currentSize.width;
  const scaleY = desiredSize.height / currentSize.height;
  const useStretch = String(options.mode || "").trim().toLowerCase() === "stretch";
  const uniformScale = options.mode === "cover"
    ? Math.max(scaleX, scaleY)
    : Math.min(scaleX, scaleY);

  if (useStretch) {
    if (
      Number.isFinite(scaleX) &&
      Number.isFinite(scaleY) &&
      scaleX > 0 &&
      scaleY > 0 &&
      (Math.abs(scaleX - 1) > 0.0001 || Math.abs(scaleY - 1) > 0.0001)
    ) {
      await transformLayerScale(action, layer.id, scaleX * 100, scaleY * 100);
    }
  } else if (Number.isFinite(uniformScale) && uniformScale > 0 && Math.abs(uniformScale - 1) > 0.001) {
    await transformLayerScale(action, layer.id, uniformScale * 100, uniformScale * 100);
  }

  const nextLayer = doc && doc.activeLayers && doc.activeLayers[0];
  const nextTransformBounds = options.preferTransformBounds ? await getActivePlacedLayerTransformBounds(action) : null;
  const nextBounds = nextTransformBounds || parseLayerBounds(nextLayer && nextLayer.bounds);
  if (!nextLayer || !nextBounds) return;

  const currentCenter = getBoundsCenter(nextBounds);
  const targetCenter =
    options.mode === "original"
      ? {
          x: Number(targetBounds.left) + getBoundsSize(nextBounds).width / 2,
          y: Number(targetBounds.top) + getBoundsSize(nextBounds).height / 2
        }
      : getBoundsCenter(targetBounds);
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

export async function getActiveDocumentInfo() {
  const { photoshop } = await ensureDeps();
  return getDocumentInfo(photoshop.app && photoshop.app.activeDocument);
}

export async function captureDocumentPreview(options = {}) {
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
        uploadWidth: uploadAsset.width,
        uploadHeight: uploadAsset.height,
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
        uploadWidth: result.uploadWidth,
        uploadHeight: result.uploadHeight,
        uploadQuality: result.uploadQuality
      });
      return result;
    } finally {
      try {
        pixels && pixels.imageData && typeof pixels.imageData.dispose === "function" && pixels.imageData.dispose();
      } catch (_) {}
    }
  }, { commandName: "PixelRunner Capture Preview" });
}

export async function runToolAction(payload = {}) {
  const context = await ensureActiveDocument();
  return runToolActionByName(payload, context);
}

export async function placeImageFromUrl(payload) {
  const options = payload && typeof payload === "object" ? payload : {};
  const url = String(options.url || "").trim();
  if (!url) throw new Error("Result URL is missing");

  const { photoshop, storage } = await ensureDeps();
  const app = photoshop.app;
  const core = photoshop.core;
  const action = photoshop.action;

  if (!app || !app.activeDocument) throw new Error("No active Photoshop document");

  const buffer = await fetchBinary(url);
  const pngInfo = await parsePngInfo(buffer);
  const preserveCanvasBounds = options.preserveCanvasBounds === true;
  const anchorTransparentCanvas = options.anchorTransparentCanvas === true;
  const pngAlphaBounds = pngInfo && pngInfo.alphaBounds ? pngInfo.alphaBounds : null;
  const pngAlphaUsesPartialCanvas = Boolean(
    pngInfo &&
    pngAlphaBounds &&
    !dimensionsNearlyMatch(
      Number(pngAlphaBounds.width),
      Number(pngAlphaBounds.height),
      Number(pngInfo.width),
      Number(pngInfo.height)
    )
  );
  let placementBuffer = buffer;
  if (pngInfo && pngInfo.hasTransparency && pngAlphaUsesPartialCanvas && (!preserveCanvasBounds || anchorTransparentCanvas)) {
    try {
      const anchoredBuffer = await buildBoundsAnchoredPng(buffer, pngInfo._meta);
      if (anchoredBuffer instanceof ArrayBuffer && anchoredBuffer.byteLength > 0) {
        placementBuffer = anchoredBuffer;
        pngInfo.boundsAnchored = true;
      }
    } catch (_) {
      pngInfo.boundsAnchored = false;
    }
  }
  const fs = storage.localFileSystem;
  const formats = storage.formats;
  const tempFolder = await fs.getTemporaryFolder();
  const tempFile = await tempFolder.createFile("pixelrunner-result.png", { overwrite: true });
  await tempFile.write(placementBuffer, { format: formats.binary });
  const sessionToken = await fs.createSessionToken(tempFile);
  const targetDocumentId = Number(options.targetDocumentId || options.sourceDocumentId);
  const targetBounds = normalizeBounds(options.targetBounds);
  const normalizedMode = String(options.fitMode || "contain").trim().toLowerCase();
  let placementMode =
    normalizedMode === "cover"
      ? "cover"
      : normalizedMode === "stretch"
        ? "stretch"
        : normalizedMode === "original" || normalizedMode === "pixel-perfect"
          ? "original"
          : "contain";

  await core.executeAsModal(async () => {
    const activeTargetDocument = await activateDocument(app, action, targetDocumentId);
    const targetDocInfo = getDocumentInfo(activeTargetDocument || app.activeDocument);
    const documentBounds = targetDocInfo && targetDocInfo.hasActiveDocument
      ? {
          left: 0,
          top: 0,
          right: Math.max(1, Number(targetDocInfo.width) || 1),
          bottom: Math.max(1, Number(targetDocInfo.height) || 1)
        }
      : null;
    let effectiveTargetBounds = targetBounds;
    const isTransparentPngResult = Boolean(pngInfo && pngInfo.hasTransparency);
    if (isTransparentPngResult && pngInfo && documentBounds && targetBounds) {
      const targetSize = getBoundsSize(targetBounds);
      const docSize = getBoundsSize(documentBounds);
      if (dimensionsNearlyMatch(pngInfo.width, pngInfo.height, docSize.width, docSize.height)) {
        effectiveTargetBounds = documentBounds;
      } else if (dimensionsNearlyMatch(pngInfo.width, pngInfo.height, targetSize.width, targetSize.height)) {
        effectiveTargetBounds = targetBounds;
      }
    }
    const isFullBoundsTarget = isFullDocumentBounds(effectiveTargetBounds, targetDocInfo);
    const applyMask = options.applyMask !== false && !isFullBoundsTarget;
    if (preserveCanvasBounds) {
      placementMode = normalizedMode === "stretch"
        ? "stretch"
        : normalizedMode === "cover"
          ? "cover"
          : normalizedMode === "original" || normalizedMode === "pixel-perfect"
            ? "original"
            : "contain";
    } else if (isTransparentPngResult && pngInfo && pngInfo.boundsAnchored && pngAlphaUsesPartialCanvas) {
      placementMode = "original";
    } else if (isTransparentPngResult && pngInfo && pngInfo.alphaBounds) {
      placementMode = "transparent-png-canvas";
    } else if (isTransparentPngResult && isFullBoundsTarget && normalizedMode === "stretch") {
      placementMode = "original";
    }
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

    if (effectiveTargetBounds) {
      await alignPlacedLayerToBounds(activeTargetDocument || app.activeDocument, action, effectiveTargetBounds, {
        mode: placementMode,
        imageSize: pngInfo,
        applyMask,
        preferTransformBounds: isTransparentPngResult && !preserveCanvasBounds
      });
    }
    await setActiveLayerStyle(action, {
      opacity: options.opacity,
      blendMode: options.blendMode
    });
  }, { commandName: "Place PixelRunner Result" });

  const layerName = await renameActiveLayer(options.layerName);
  const latestInfo = getDocumentInfo(app.activeDocument);
  return {
    ok: true,
    placed: true,
    documentId: Number(latestInfo.documentId) || 0,
    layerName: layerName || null,
    document: latestInfo,
    targetBounds,
    placementMode,
    resultImage: sanitizePngInfo(pngInfo)
  };
}
