const { app, core, action } = require("photoshop");
const { storage } = require("uxp");

const fs = storage.localFileSystem;
const formats = storage.formats;
const PASTE_STRATEGY_CHOICES = ["normal", "smart", "smartEnhanced"];
const LEGACY_PASTE_STRATEGY_MAP = {
  stretch: "normal",
  contain: "normal",
  cover: "normal",
  alphaTrim: "smart",
  edgeAuto: "smart"
};
const IMAGE_DECODE_TIMEOUT_MS = 2500;
const CONTENT_ANALYSIS_TIMEOUT_MS = 5000;
const SMART_ANALYSIS_TIMEOUT_MS = 6000;
const SMART_MAX_EDGE = 1024;
const SMART_OVERFLOW_THRESHOLD = 0.12; // 允许选区外溢出占比
const SMART_SCORE_THRESHOLD = 0.5;
const SMART_ENHANCED_SCORE_THRESHOLD = 0.42;
const SMART_ENHANCED_OVERFLOW_THRESHOLD = 0.18;
const SMART_ENHANCED_MAX_ROTATE_DEG = 35;
const SMART_ENHANCED_RESIDUAL_SCALE_LIMIT = 0.08;
const SMART_ENHANCED_RESIDUAL_SHIFT_WEIGHT = 0.55;
const SMART_SCALE_MIN = 0.2;
const SMART_SCALE_MAX = 6;

function createAbortError(message = "用户中止") {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function isAbortError(error) {
  if (!error) return false;
  if (error.name === "AbortError") return true;
  if (error.code === "RUN_CANCELLED") return true;
  return String(error.message || "").includes("中止");
}

function isTimeoutError(error) {
  return Boolean(error && error.name === "TimeoutError");
}

function withTimeout(promise, timeoutMs, label = "operation") {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return promise;

  let timerId = null;
  return new Promise((resolve, reject) => {
    timerId = setTimeout(() => {
      const err = new Error(`${label} timeout after ${Math.round(ms)}ms`);
      err.name = "TimeoutError";
      reject(err);
    }, ms);

    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => {
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
      });
  });
}

function ensureActiveDocument() {
  const doc = app.activeDocument;
  if (!doc) {
    throw new Error("请先在 Photoshop 中打开或激活一个文档。");
  }
  return doc;
}

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

function normalizePasteStrategy(value) {
  const marker = String(value || "").trim();
  if (!marker) return "normal";
  const legacy = LEGACY_PASTE_STRATEGY_MAP[marker];
  const normalized = legacy || marker;
  return PASTE_STRATEGY_CHOICES.includes(normalized) ? normalized : "normal";
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function lerpNumber(a, b, t) {
  const x = Number.isFinite(a) ? a : 0;
  const y = Number.isFinite(b) ? b : x;
  const k = clampNumber(Number(t), 0, 1);
  return x + (y - x) * k;
}

function wrapAngleDegrees(angle) {
  if (!Number.isFinite(angle)) return 0;
  let v = angle % 360;
  if (v > 180) v -= 360;
  if (v <= -180) v += 360;
  return v;
}

function detectImageMime(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 12) return "application/octet-stream";
  const bytes = new Uint8Array(arrayBuffer);
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return "application/octet-stream";
}

async function loadImageFromArrayBuffer(arrayBuffer, options = {}) {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength === 0) {
    throw new Error("image buffer is empty");
  }
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("URL.createObjectURL is unavailable");
  }
  if (typeof Image === "undefined") {
    throw new Error("Image is unavailable");
  }

  const signal = options.signal || null;
  const timeoutMs = Number(options.timeoutMs);
  const timeoutLabel = String(options.timeoutLabel || "image decode");
  const blob = new Blob([arrayBuffer], { type: detectImageMime(arrayBuffer) });
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    let settled = false;
    let timeoutId = null;

    const onAbort = () => {
      finishReject(createAbortError("用户中止"));
    };

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", onAbort);
      }
      img.onload = null;
      img.onerror = null;
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    };

    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    if (signal && signal.aborted) {
      finishReject(createAbortError("用户中止"));
      return;
    }

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        const err = new Error(`${timeoutLabel} timeout after ${Math.round(timeoutMs)}ms`);
        err.name = "TimeoutError";
        finishReject(err);
      }, timeoutMs);
    }

    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    img.onload = () => finishResolve(img);
    img.onerror = () => finishReject(new Error("image decode failed"));
    img.src = url;
  });
}

async function decodeImagePixels(arrayBuffer, options = {}) {
  const signal = options.signal || null;
  if (signal && signal.aborted) throw createAbortError("用户中止");
  if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
  const image = await loadImageFromArrayBuffer(arrayBuffer, {
    signal,
    timeoutMs: options.imageDecodeTimeoutMs,
    timeoutLabel: "image decode"
  });
  if (signal && signal.aborted) throw createAbortError("用户中止");
  const sourceWidth = Number(image && (image.naturalWidth || image.width) || 0);
  const sourceHeight = Number(image && (image.naturalHeight || image.height) || 0);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const longEdge = Math.max(sourceWidth, sourceHeight);
  const safeMaxEdge = Number(options.maxEdge);
  const scale = Number.isFinite(safeMaxEdge) && safeMaxEdge > 0 && longEdge > safeMaxEdge
    ? safeMaxEdge / longEdge
    : 1;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, width, height);

  let imageData = null;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch (_) {
    return null;
  }

  return {
    width,
    height,
    sourceWidth,
    sourceHeight,
    scaleX: sourceWidth / width,
    scaleY: sourceHeight / height,
    data: imageData.data
  };
}

function clampContentBox(box, width, height) {
  if (!box) return null;
  const left = Math.max(0, Math.min(width - 1, Math.floor(toPixelNumber(box.left, 0))));
  const top = Math.max(0, Math.min(height - 1, Math.floor(toPixelNumber(box.top, 0))));
  const right = Math.max(left + 1, Math.min(width, Math.ceil(toPixelNumber(box.right, width))));
  const bottom = Math.max(top + 1, Math.min(height, Math.ceil(toPixelNumber(box.bottom, height))));
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

function isNearlyFullContentBox(box, width, height, tolerance = 1) {
  if (!box) return false;
  return (
    Math.abs(box.left) <= tolerance &&
    Math.abs(box.top) <= tolerance &&
    Math.abs(width - box.right) <= tolerance &&
    Math.abs(height - box.bottom) <= tolerance
  );
}

function detectAlphaContentBox(decoded, alphaThreshold = 8) {
  if (!decoded || !decoded.data) return null;
  const { data, width, height } = decoded;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    let idx = y * width * 4 + 3;
    for (let x = 0; x < width; x += 1) {
      if (data[idx] > alphaThreshold) {
        if (x < left) left = x;
        if (y < top) top = y;
        if (x > right) right = x;
        if (y > bottom) bottom = y;
      }
      idx += 4;
    }
  }
  if (right < left || bottom < top) return null;
  const box = clampContentBox({ left, top, right: right + 1, bottom: bottom + 1 }, width, height);
  if (!box) return null;
  if (isNearlyFullContentBox(box, width, height, 1)) return null;
  return box;
}

function detectEdgeContentBox(decoded) {
  if (!decoded || !decoded.data) return null;
  const { data, width, height } = decoded;
  if (width < 4 || height < 4) return null;

  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3] / 255;
      gray[y * width + x] = (0.299 * r + 0.587 * g + 0.114 * b) * a;
    }
  }

  let sumMag = 0;
  let maxMag = 0;
  let sampleCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const gx =
        -gray[p - width - 1] - 2 * gray[p - 1] - gray[p + width - 1] +
        gray[p - width + 1] + 2 * gray[p + 1] + gray[p + width + 1];
      const gy =
        -gray[p - width - 1] - 2 * gray[p - width] - gray[p - width + 1] +
        gray[p + width - 1] + 2 * gray[p + width] + gray[p + width + 1];
      const mag = Math.abs(gx) + Math.abs(gy);
      sumMag += mag;
      if (mag > maxMag) maxMag = mag;
      sampleCount += 1;
    }
  }
  if (sampleCount <= 0 || maxMag <= 0) return null;

  const meanMag = sumMag / sampleCount;
  const threshold = Math.max(meanMag * 2.2, maxMag * 0.22);
  const thresholdHigh = Math.max(meanMag * 3.0, maxMag * 0.32);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let strongCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const gx =
        -gray[p - width - 1] - 2 * gray[p - 1] - gray[p + width - 1] +
        gray[p - width + 1] + 2 * gray[p + 1] + gray[p + width + 1];
      const gy =
        -gray[p - width - 1] - 2 * gray[p - width] - gray[p - width + 1] +
        gray[p + width - 1] + 2 * gray[p + width] + gray[p + width + 1];
      const mag = Math.abs(gx) + Math.abs(gy);
      if (mag < threshold && mag < thresholdHigh) continue;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
      strongCount += 1;
    }
  }
  if (strongCount < Math.max(24, sampleCount * 0.0015)) return null;
  const box = clampContentBox({ left, top, right: right + 1, bottom: bottom + 1 }, width, height);
  if (!box) return null;

  const areaRatio = ((box.right - box.left) * (box.bottom - box.top)) / (width * height);
  if (areaRatio <= 0.01 || areaRatio >= 0.95) return null;

  const marginX = Math.max(1, Math.round(width * 0.015));
  const marginY = Math.max(1, Math.round(height * 0.015));
  return clampContentBox(
    {
      left: box.left - marginX,
      top: box.top - marginY,
      right: box.right + marginX,
      bottom: box.bottom + marginY
    },
    width,
    height
  );
}

function detectBorderContrastContentBox(decoded) {
  if (!decoded || !decoded.data) return null;
  const { data, width, height } = decoded;
  if (width < 4 || height < 4) return null;

  let borderR = 0;
  let borderG = 0;
  let borderB = 0;
  let borderCount = 0;
  const consumeBorderPixel = (x, y) => {
    const idx = (y * width + x) * 4;
    const a = data[idx + 3];
    if (a <= 6) return;
    borderR += data[idx];
    borderG += data[idx + 1];
    borderB += data[idx + 2];
    borderCount += 1;
  };

  for (let x = 0; x < width; x += 1) {
    consumeBorderPixel(x, 0);
    consumeBorderPixel(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    consumeBorderPixel(0, y);
    consumeBorderPixel(width - 1, y);
  }
  if (borderCount <= 0) return null;

  const meanR = borderR / borderCount;
  const meanG = borderG / borderCount;
  const meanB = borderB / borderCount;
  const deltaSamples = [];
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let hitCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const a = data[idx + 3];
      if (a <= 6) continue;
      const delta =
        Math.abs(data[idx] - meanR) +
        Math.abs(data[idx + 1] - meanG) +
        Math.abs(data[idx + 2] - meanB);
      deltaSamples.push(delta);
    }
  }

  if (deltaSamples.length === 0) return null;
  deltaSamples.sort((a, b) => a - b);
  const quantile = (q) => {
    const pos = (deltaSamples.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (deltaSamples[base + 1] !== undefined) {
      return deltaSamples[base] + rest * (deltaSamples[base + 1] - deltaSamples[base]);
    }
    return deltaSamples[base];
  };
  const delta50 = quantile(0.5);
  const delta90 = quantile(0.9);
  const delta95 = quantile(0.95);
  const threshold = Math.max(54, delta50 * 1.6, delta90 * 0.9, delta95 * 0.8);

  left = width;
  top = height;
  right = -1;
  bottom = -1;
  hitCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const a = data[idx + 3];
      if (a <= 6) continue;
      const delta =
        Math.abs(data[idx] - meanR) +
        Math.abs(data[idx + 1] - meanG) +
        Math.abs(data[idx + 2] - meanB);
      if (delta < threshold) continue;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
      hitCount += 1;
    }
  }
  if (hitCount < Math.max(32, width * height * 0.002)) return null;
  const box = clampContentBox({ left, top, right: right + 1, bottom: bottom + 1 }, width, height);
  if (!box) return null;
  const areaRatio = ((box.right - box.left) * (box.bottom - box.top)) / (width * height);
  if (areaRatio <= 0.01 || areaRatio >= 0.95) return null;
  return box;
}

function detectGradientContentBox(decoded) {
  if (!decoded || !decoded.data) return null;
  const { data, width, height } = decoded;
  if (width < 6 || height < 6) return null;

  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3] / 255;
      gray[y * width + x] = (0.299 * r + 0.587 * g + 0.114 * b) * a;
    }
  }

  const blur = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const sum =
        gray[p - width - 1] + gray[p - width] + gray[p - width + 1] +
        gray[p - 1] + gray[p] + gray[p + 1] +
        gray[p + width - 1] + gray[p + width] + gray[p + width + 1];
      blur[p] = sum / 9;
    }
  }
  for (let x = 0; x < width; x += 1) {
    blur[x] = gray[x];
    blur[(height - 1) * width + x] = gray[(height - 1) * width + x];
  }
  for (let y = 0; y < height; y += 1) {
    blur[y * width] = gray[y * width];
    blur[y * width + (width - 1)] = gray[y * width + (width - 1)];
  }

  let sumMag = 0;
  let maxMag = 0;
  let sampleCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const gx =
        -blur[p - width - 1] - 2 * blur[p - 1] - blur[p + width - 1] +
        blur[p - width + 1] + 2 * blur[p + 1] + blur[p + width + 1];
      const gy =
        -blur[p - width - 1] - 2 * blur[p - width] - blur[p - width + 1] +
        blur[p + width - 1] + 2 * blur[p + width] + blur[p + width + 1];
      const mag = Math.abs(gx) + Math.abs(gy);
      sumMag += mag;
      if (mag > maxMag) maxMag = mag;
      sampleCount += 1;
    }
  }
  if (sampleCount <= 0 || maxMag <= 0) return null;

  const meanMag = sumMag / sampleCount;
  const thresholdLow = Math.max(meanMag * 1.8, maxMag * 0.2);
  const thresholdHigh = Math.max(meanMag * 2.8, maxMag * 0.32);
  const threshold = Math.min(thresholdHigh, Math.max(thresholdLow, meanMag * 2.2));
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let strongCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const gx =
        -blur[p - width - 1] - 2 * blur[p - 1] - blur[p + width - 1] +
        blur[p - width + 1] + 2 * blur[p + 1] + blur[p + width + 1];
      const gy =
        -blur[p - width - 1] - 2 * blur[p - width] - blur[p - width + 1] +
        blur[p + width - 1] + 2 * blur[p + width] + blur[p + width + 1];
      const mag = Math.abs(gx) + Math.abs(gy);
      if (mag < threshold) continue;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
      strongCount += 1;
    }
  }

  const minStrong = Math.max(36, Math.round(sampleCount * 0.002));
  if (strongCount < minStrong) return null;
  const box = clampContentBox({ left, top, right: right + 1, bottom: bottom + 1 }, width, height);
  if (!box) return null;
  if (isNearlyFullContentBox(box, width, height, 1)) return null;
  const areaRatio = ((box.right - box.left) * (box.bottom - box.top)) / (width * height);
  if (areaRatio <= 0.02 || areaRatio >= 0.9) return null;

  const marginX = Math.max(1, Math.round(width * 0.01));
  const marginY = Math.max(1, Math.round(height * 0.01));
  return clampContentBox(
    {
      left: box.left - marginX,
      top: box.top - marginY,
      right: box.right + marginX,
      bottom: box.bottom + marginY
    },
    width,
    height
  );
}

function detectBinaryConnectivityBox(decoded) {
  if (!decoded || !decoded.data) return null;
  const { data, width, height } = decoded;
  if (width < 4 || height < 4) return null;

  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3] / 255;
      gray[y * width + x] = Math.round((0.299 * r + 0.587 * g + 0.114 * b) * a);
    }
  }

  const samples = Array.from(gray);
  samples.sort((a, b) => a - b);
  const quantile = (q) => {
    const pos = (samples.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (samples[base + 1] !== undefined) {
      return samples[base] + rest * (samples[base + 1] - samples[base]);
    }
    return samples[base];
  };
  const thLow = quantile(0.55);
  const thHigh = quantile(0.8);
  const threshold = Math.min(220, Math.max(32, (thLow + thHigh) * 0.5));

  const visited = new Uint8Array(width * height);
  const queueX = new Int32Array(width * height);
  const queueY = new Int32Array(width * height);
  const components = [];

  const enqueue = (x, y, headTail) => {
    queueX[headTail.tail] = x;
    queueY[headTail.tail] = y;
    headTail.tail += 1;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (visited[idx]) continue;
      visited[idx] = 1;
      if (gray[idx] < threshold) continue;

      const headTail = { head: 0, tail: 0 };
      enqueue(x, y, headTail);
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let count = 0;

      while (headTail.head < headTail.tail) {
        const cx = queueX[headTail.head];
        const cy = queueY[headTail.head];
        headTail.head += 1;
        count += 1;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);

        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1]
        ];
        for (let i = 0; i < neighbors.length; i += 1) {
          const nx = neighbors[i][0];
          const ny = neighbors[i][1];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (visited[nIdx]) continue;
          visited[nIdx] = 1;
          if (gray[nIdx] < threshold) continue;
          enqueue(nx, ny, headTail);
        }
      }

      components.push({
        left: minX,
        top: minY,
        right: maxX + 1,
        bottom: maxY + 1,
        area: count
      });
    }
  }

  if (components.length === 0) return null;

  const sorted = components.sort((a, b) => b.area - a.area);
  const top = sorted.slice(0, 3);
  const totalArea = width * height;
  let best = null;
  for (const comp of top) {
    const areaRatio = comp.area / totalArea;
    if (areaRatio < 0.005 || areaRatio > 0.8) continue;
    const box = clampContentBox(comp, width, height);
    if (!box) continue;
    if (isNearlyFullContentBox(box, width, height, 1)) continue;
    best = box;
    break;
  }
  return best;
}

function pickSmartContentBox(decoded) {
  const candidates = [];
  const gradientBox = detectGradientContentBox(decoded);
  if (gradientBox) candidates.push({ box: gradientBox, method: "gradient" });
  const edgeBox = detectEdgeContentBox(decoded);
  if (edgeBox) candidates.push({ box: edgeBox, method: "edge" });
  const contrastBox = detectBorderContrastContentBox(decoded);
  if (contrastBox) candidates.push({ box: contrastBox, method: "contrast" });
  const binaryBox = detectBinaryConnectivityBox(decoded);
  if (binaryBox) candidates.push({ box: binaryBox, method: "binary" });

  if (candidates.length === 0) return { box: null, method: "none" };

  const totalArea = decoded.sourceWidth * decoded.sourceHeight;
  const scored = candidates
    .map((c) => {
      const size = getBoundsSize(c.box);
      const area = size.width * size.height;
      const areaRatio = area / Math.max(1, totalArea);
      const center = getBoundsCenter(c.box);
      const cxNorm = Math.abs(center.x / Math.max(1, decoded.sourceWidth) - 0.5);
      const cyNorm = Math.abs(center.y / Math.max(1, decoded.sourceHeight) - 0.5);
      const centerPenalty = Math.max(cxNorm, cyNorm);
      const areaPenalty = areaRatio < 0.01 || areaRatio > 0.9 ? 1 : 0;
      const score = Math.max(0, 1 - centerPenalty * 1.2 - areaPenalty);
      return { ...c, score, areaRatio };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0];
}

function mapScaledBoxToSource(box, decoded) {
  if (!box || !decoded) return null;
  const left = Math.max(0, Math.floor(box.left * decoded.scaleX));
  const top = Math.max(0, Math.floor(box.top * decoded.scaleY));
  const right = Math.min(decoded.sourceWidth, Math.ceil(box.right * decoded.scaleX));
  const bottom = Math.min(decoded.sourceHeight, Math.ceil(box.bottom * decoded.scaleY));
  return clampContentBox({ left, top, right, bottom }, decoded.sourceWidth, decoded.sourceHeight);
}

function buildGrayPlane(decoded) {
  if (!decoded || !decoded.data) return null;
  const { data, width, height } = decoded;
  const gray = new Float32Array(width * height);
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const idx = p * 4;
      const a = data[idx + 3];
      alpha[p] = a;
      gray[p] = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) * (a / 255);
    }
  }
  return { gray, alpha, width, height };
}

function analyzeContentMoments(decoded, box) {
  if (!decoded || !box) return null;
  const plane = buildGrayPlane(decoded);
  if (!plane) return null;
  const { width, height, gray, alpha } = plane;

  const clamped = clampContentBox(box, width, height);
  if (!clamped) return null;
  const left = Math.max(1, Math.floor(clamped.left));
  const top = Math.max(1, Math.floor(clamped.top));
  const right = Math.min(width - 2, Math.ceil(clamped.right) - 1);
  const bottom = Math.min(height - 2, Math.ceil(clamped.bottom) - 1);
  if (right <= left || bottom <= top) return null;

  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  const boxArea = boxWidth * boxHeight;
  const mags = new Float32Array(boxArea);

  let magSum = 0;
  let magMax = 0;
  let magCount = 0;
  let graySum = 0;
  let graySqSum = 0;
  let alphaCount = 0;
  let idxMag = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const p = y * width + x;
      const a = alpha[p];
      let mag = 0;
      if (a > 6) {
        const gx = gray[p + 1] - gray[p - 1];
        const gy = gray[p + width] - gray[p - width];
        mag = Math.abs(gx) + Math.abs(gy);
        magSum += mag;
        if (mag > magMax) magMax = mag;
        magCount += 1;
        graySum += gray[p];
        graySqSum += gray[p] * gray[p];
        alphaCount += 1;
      }
      mags[idxMag] = mag;
      idxMag += 1;
    }
  }
  if (magCount <= 0) return null;

  const meanMag = magSum / magCount;
  const threshold = Math.max(meanMag * 2.1, magMax * 0.22, 6);
  const meanGray = graySum / Math.max(1, alphaCount);
  const varGray = Math.max(0, graySqSum / Math.max(1, alphaCount) - meanGray * meanGray);
  const stdGray = Math.sqrt(varGray);
  const contrastThreshold = Math.max(8, stdGray * 0.85);

  let selected = 0;
  let weightSum = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;

  idxMag = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const p = y * width + x;
      if (alpha[p] <= 6) {
        idxMag += 1;
        continue;
      }
      let w = mags[idxMag];
      if (w < threshold) {
        const contrast = Math.abs(gray[p] - meanGray);
        if (contrast < contrastThreshold) {
          idxMag += 1;
          continue;
        }
        w = contrast + 4;
      }
      idxMag += 1;
      selected += 1;
      weightSum += w;
      sumX += x * w;
      sumY += y * w;
      sumXX += x * x * w;
      sumYY += y * y * w;
      sumXY += x * y * w;
    }
  }

  const minSelected = Math.max(24, Math.round(boxArea * 0.004));
  if (selected < minSelected || weightSum <= 0) return null;

  const centerX = sumX / weightSum;
  const centerY = sumY / weightSum;
  const varX = Math.max(1e-6, sumXX / weightSum - centerX * centerX);
  const varY = Math.max(1e-6, sumYY / weightSum - centerY * centerY);
  const covXY = sumXY / weightSum - centerX * centerY;
  const trace = varX + varY;
  const det = varX * varY - covXY * covXY;
  const root = Math.sqrt(Math.max(0, trace * trace * 0.25 - det));
  const eig1 = Math.max(1e-6, trace * 0.5 + root);
  const eig2 = Math.max(1e-6, trace * 0.5 - root);
  const angleRad = 0.5 * Math.atan2(2 * covXY, varX - varY);

  const coverage = selected / Math.max(1, boxArea);
  const pointScore = Math.min(1, selected / Math.max(56, boxArea * 0.06));
  const coverageScore = clampNumber(coverage * 12, 0, 1);
  const contrastScore = clampNumber(magMax / 220, 0, 1);
  const confidence = clampNumber(0.15 + 0.4 * pointScore + 0.3 * coverageScore + 0.15 * contrastScore, 0, 1);

  return {
    center: { x: centerX, y: centerY },
    boxCenter: getBoundsCenter(clamped),
    spreadX: Math.sqrt(varX) * 2,
    spreadY: Math.sqrt(varY) * 2,
    spreadMajor: Math.sqrt(eig1) * 2,
    spreadMinor: Math.sqrt(eig2) * 2,
    angleRad,
    angleDeg: angleRad * (180 / Math.PI),
    selected,
    confidence
  };
}

function mapMomentToSource(moment, decoded) {
  if (!moment || !decoded) return null;
  return {
    center: {
      x: moment.center.x * decoded.scaleX,
      y: moment.center.y * decoded.scaleY
    },
    boxCenter: {
      x: moment.boxCenter.x * decoded.scaleX,
      y: moment.boxCenter.y * decoded.scaleY
    },
    spreadX: moment.spreadX * decoded.scaleX,
    spreadY: moment.spreadY * decoded.scaleY,
    spreadMajor: moment.spreadMajor * Math.max(decoded.scaleX, decoded.scaleY),
    spreadMinor: moment.spreadMinor * Math.min(decoded.scaleX, decoded.scaleY),
    angleRad: moment.angleRad,
    angleDeg: moment.angleDeg,
    selected: moment.selected,
    confidence: moment.confidence
  };
}

function buildSmartEnhancedTransform(sourceBox, outputBox, sourceMoment, outputMoment, baseScore) {
  if (!sourceBox || !outputBox) return null;
  const sSize = getBoundsSize(sourceBox);
  const oSize = getBoundsSize(outputBox);
  const sxBox = sSize.width / oSize.width;
  const syBox = sSize.height / oSize.height;
  if (!Number.isFinite(sxBox) || !Number.isFinite(syBox) || sxBox <= 0 || syBox <= 0) return null;

  const sourceCenter = getBoundsCenter(sourceBox);
  const outputCenter = getBoundsCenter(outputBox);
  const sourceAnchor = sourceMoment && sourceMoment.center ? sourceMoment.center : sourceCenter;
  const outputAnchor = outputMoment && outputMoment.center ? outputMoment.center : outputCenter;
  const confidence = Math.min(
    sourceMoment && Number.isFinite(sourceMoment.confidence) ? sourceMoment.confidence : 0,
    outputMoment && Number.isFinite(outputMoment.confidence) ? outputMoment.confidence : 0
  );

  let sx = sxBox;
  let sy = syBox;
  if (
    sourceMoment &&
    outputMoment &&
    Number.isFinite(sourceMoment.spreadX) &&
    Number.isFinite(sourceMoment.spreadY) &&
    Number.isFinite(outputMoment.spreadX) &&
    Number.isFinite(outputMoment.spreadY) &&
    sourceMoment.spreadX > 0 &&
    sourceMoment.spreadY > 0 &&
    outputMoment.spreadX > 0 &&
    outputMoment.spreadY > 0
  ) {
    const sxMoment = sourceMoment.spreadX / outputMoment.spreadX;
    const syMoment = sourceMoment.spreadY / outputMoment.spreadY;
    const blend = clampNumber(confidence * 0.55, 0, 0.55);
    if (Number.isFinite(sxMoment) && sxMoment > 0) sx = lerpNumber(sxBox, sxMoment, blend);
    if (Number.isFinite(syMoment) && syMoment > 0) sy = lerpNumber(syBox, syMoment, blend);
  }
  sx = clampNumber(sx, SMART_SCALE_MIN, SMART_SCALE_MAX);
  sy = clampNumber(sy, SMART_SCALE_MIN, SMART_SCALE_MAX);

  let angle = 0;
  if (
    sourceMoment &&
    outputMoment &&
    Number.isFinite(sourceMoment.angleDeg) &&
    Number.isFinite(outputMoment.angleDeg)
  ) {
    const rawAngle = wrapAngleDegrees(sourceMoment.angleDeg - outputMoment.angleDeg);
    const damping = clampNumber(confidence * 0.9 + 0.15, 0.2, 0.9);
    const severePenalty = Math.abs(rawAngle) > 75 ? 0.35 : 1;
    angle = clampNumber(
      rawAngle * damping * severePenalty,
      -SMART_ENHANCED_MAX_ROTATE_DEG,
      SMART_ENHANCED_MAX_ROTATE_DEG
    );
  }

  let residualScaleX = 1;
  let residualScaleY = 1;
  if (
    sourceMoment &&
    outputMoment &&
    Number.isFinite(sourceMoment.spreadMajor) &&
    Number.isFinite(sourceMoment.spreadMinor) &&
    Number.isFinite(outputMoment.spreadMajor) &&
    Number.isFinite(outputMoment.spreadMinor) &&
    sourceMoment.spreadMajor > 0 &&
    sourceMoment.spreadMinor > 0 &&
    outputMoment.spreadMajor > 0 &&
    outputMoment.spreadMinor > 0
  ) {
    const majorRatio = sourceMoment.spreadMajor / outputMoment.spreadMajor;
    const minorRatio = sourceMoment.spreadMinor / outputMoment.spreadMinor;
    const blend = clampNumber(confidence * 0.35, 0, 0.35);
    const relX = majorRatio / Math.max(1e-6, sx);
    const relY = minorRatio / Math.max(1e-6, sy);
    residualScaleX = clampNumber(
      lerpNumber(1, relX, blend),
      1 - SMART_ENHANCED_RESIDUAL_SCALE_LIMIT,
      1 + SMART_ENHANCED_RESIDUAL_SCALE_LIMIT
    );
    residualScaleY = clampNumber(
      lerpNumber(1, relY, blend),
      1 - SMART_ENHANCED_RESIDUAL_SCALE_LIMIT,
      1 + SMART_ENHANCED_RESIDUAL_SCALE_LIMIT
    );
  }

  const sourceBias = {
    x: sourceAnchor.x - sourceCenter.x,
    y: sourceAnchor.y - sourceCenter.y
  };
  const outputBias = {
    x: outputAnchor.x - outputCenter.x,
    y: outputAnchor.y - outputCenter.y
  };
  const residualDx = clampNumber(
    (sourceBias.x - outputBias.x * sx) * SMART_ENHANCED_RESIDUAL_SHIFT_WEIGHT * Math.max(0.2, confidence),
    -oSize.width * 0.2,
    oSize.width * 0.2
  );
  const residualDy = clampNumber(
    (sourceBias.y - outputBias.y * sy) * SMART_ENHANCED_RESIDUAL_SHIFT_WEIGHT * Math.max(0.2, confidence),
    -oSize.height * 0.2,
    oSize.height * 0.2
  );

  const anglePenalty = Math.min(1, Math.abs(angle) / 50);
  const residualPenalty = Math.min(1, Math.abs(residualScaleX - 1) + Math.abs(residualScaleY - 1));
  const score = clampNumber(
    baseScore * (0.75 + confidence * 0.15) +
    confidence * 0.22 -
    anglePenalty * 0.05 -
    residualPenalty * 0.03,
    0,
    1
  );

  return {
    sx,
    sy,
    angle,
    dx: sourceAnchor.x - outputAnchor.x,
    dy: sourceAnchor.y - outputAnchor.y,
    sourceAnchor,
    outputAnchor,
    residual: {
      scaleX: residualScaleX,
      scaleY: residualScaleY,
      dx: residualDx,
      dy: residualDy
    },
    confidence,
    score
  };
}

function computeAlignmentScore(sourceBox, outputBox) {
  if (!sourceBox || !outputBox) return { score: 0, metrics: null };
  const sSize = getBoundsSize(sourceBox);
  const oSize = getBoundsSize(outputBox);
  const sCenter = getBoundsCenter(sourceBox);
  const oCenter = getBoundsCenter(outputBox);
  const dx = Math.abs(sCenter.x - oCenter.x);
  const dy = Math.abs(sCenter.y - oCenter.y);
  const normDx = dx / Math.max(1, sSize.width);
  const normDy = dy / Math.max(1, sSize.height);

  const sRatio = sSize.width / sSize.height;
  const oRatio = oSize.width / oSize.height;
  const ratioDiff = Math.abs(Math.log((sRatio || 1) / (oRatio || 1)));

  const interLeft = Math.max(sourceBox.left, outputBox.left);
  const interTop = Math.max(sourceBox.top, outputBox.top);
  const interRight = Math.min(sourceBox.right, outputBox.right);
  const interBottom = Math.min(sourceBox.bottom, outputBox.bottom);
  const interW = Math.max(0, interRight - interLeft);
  const interH = Math.max(0, interBottom - interTop);
  const interArea = interW * interH;
  const sArea = sSize.width * sSize.height;
  const oArea = oSize.width * oSize.height;
  const union = Math.max(1, sArea + oArea - interArea);
  const iou = interArea / union;

  const centerScore = 1 - Math.min(1, Math.sqrt(normDx * normDx + normDy * normDy));
  const ratioScore = Math.max(0, 1 - Math.min(1, ratioDiff));
  const iouScore = Math.min(1, iou);
  const score = Math.max(0, Math.min(1, 0.45 * centerScore + 0.25 * ratioScore + 0.3 * iouScore));

  return {
    score,
    metrics: {
      centerOffset: { dx, dy, normDx, normDy },
      ratioDiff,
      iou
    }
  };
}

function computeOverflowRatio(bounds, targetBounds) {
  if (!bounds || !targetBounds) return 0;
  const width = Math.max(0, bounds.right - bounds.left);
  const height = Math.max(0, bounds.bottom - bounds.top);
  const area = width * height;
  if (area <= 0) return 0;

  const interLeft = Math.max(bounds.left, targetBounds.left);
  const interTop = Math.max(bounds.top, targetBounds.top);
  const interRight = Math.min(bounds.right, targetBounds.right);
  const interBottom = Math.min(bounds.bottom, targetBounds.bottom);
  const interW = Math.max(0, interRight - interLeft);
  const interH = Math.max(0, interBottom - interTop);
  const interArea = interW * interH;
  const overflowArea = Math.max(0, area - interArea);
  return overflowArea / area;
}

async function computeSmartAlignment(sourceBuffer, outputBuffer, options = {}) {
  const signal = options.signal || null;
  if (signal && signal.aborted) throw createAbortError("用户中止");
  const log = options.log || (() => {});

  const decode = async (buffer, label) => {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) return null;
    const decoded = await decodeImagePixels(buffer, {
      maxEdge: SMART_MAX_EDGE,
      signal,
      imageDecodeTimeoutMs: options.imageDecodeTimeoutMs
    });
    if (!decoded) {
      log(`smart alignment decode failed: ${label}`, "warn");
    }
    return decoded;
  };

  const compute = async () => {
    const sourceDecoded = await decode(sourceBuffer, "source");
    const outputDecoded = await decode(outputBuffer, "output");
    if (!sourceDecoded || !outputDecoded) return null;

    const sourcePick = pickSmartContentBox(sourceDecoded);
    const outputPick = pickSmartContentBox(outputDecoded);
    const sourceBox = mapScaledBoxToSource(sourcePick.box, sourceDecoded);
    const outputBox = mapScaledBoxToSource(outputPick.box, outputDecoded);
    if (!sourceBox || !outputBox) {
      return {
        reason: "content-box-not-found",
        sourceMethod: sourcePick.method,
        outputMethod: outputPick.method
      };
    }

    const sSize = getBoundsSize(sourceBox);
    const oSize = getBoundsSize(outputBox);
    if (sSize.width <= 0 || sSize.height <= 0 || oSize.width <= 0 || oSize.height <= 0) {
      return { reason: "invalid-box-size" };
    }

    const { score, metrics } = computeAlignmentScore(sourceBox, outputBox);
    const sx = sSize.width / oSize.width;
    const sy = sSize.height / oSize.height;
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) {
      return { reason: "invalid-scale" };
    }

    const sCenter = getBoundsCenter(sourceBox);
    const oCenter = getBoundsCenter(outputBox);
    const dx = sCenter.x - oCenter.x;
    const dy = sCenter.y - oCenter.y;

    return {
      sx,
      sy,
      dx,
      dy,
      score,
      metrics,
      sourceBox,
      outputBox,
      outputSize: { width: outputDecoded.sourceWidth, height: outputDecoded.sourceHeight },
      sourceSize: { width: sourceDecoded.sourceWidth, height: sourceDecoded.sourceHeight },
      sourceMethod: sourcePick.method,
      outputMethod: outputPick.method
    };
  };

  const timeoutMs = Number(options.analysisTimeoutMs);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return withTimeout(compute(), timeoutMs, "smart alignment");
  }
  return compute();
}

async function computeSmartEnhancedAlignment(sourceBuffer, outputBuffer, options = {}) {
  const signal = options.signal || null;
  if (signal && signal.aborted) throw createAbortError("用户中止");
  const log = options.log || (() => {});

  const decode = async (buffer, label) => {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) return null;
    const decoded = await decodeImagePixels(buffer, {
      maxEdge: SMART_MAX_EDGE,
      signal,
      imageDecodeTimeoutMs: options.imageDecodeTimeoutMs
    });
    if (!decoded) {
      log(`smart enhanced decode failed: ${label}`, "warn");
    }
    return decoded;
  };

  const compute = async () => {
    const sourceDecoded = await decode(sourceBuffer, "source");
    const outputDecoded = await decode(outputBuffer, "output");
    if (!sourceDecoded || !outputDecoded) return null;

    const sourcePick = pickSmartContentBox(sourceDecoded);
    const outputPick = pickSmartContentBox(outputDecoded);
    const sourceBox = mapScaledBoxToSource(sourcePick.box, sourceDecoded);
    const outputBox = mapScaledBoxToSource(outputPick.box, outputDecoded);
    if (!sourceBox || !outputBox) {
      return {
        reason: "content-box-not-found",
        sourceMethod: sourcePick.method,
        outputMethod: outputPick.method
      };
    }

    const sourceMomentDecoded = analyzeContentMoments(sourceDecoded, sourcePick.box || sourceBox);
    const outputMomentDecoded = analyzeContentMoments(outputDecoded, outputPick.box || outputBox);
    const sourceMoment = mapMomentToSource(sourceMomentDecoded, sourceDecoded);
    const outputMoment = mapMomentToSource(outputMomentDecoded, outputDecoded);

    const { score: baseScore, metrics } = computeAlignmentScore(sourceBox, outputBox);
    const enhanced = buildSmartEnhancedTransform(sourceBox, outputBox, sourceMoment, outputMoment, baseScore);
    if (!enhanced) {
      return {
        reason: "enhanced-transform-invalid",
        sourceMethod: sourcePick.method,
        outputMethod: outputPick.method
      };
    }

    return {
      ...enhanced,
      strategy: "smartEnhanced",
      model: "enhanced-affine-lite",
      score: enhanced.score,
      metrics: {
        ...(metrics || {}),
        enhancedConfidence: enhanced.confidence,
        angle: enhanced.angle,
        residualScaleX: enhanced.residual ? enhanced.residual.scaleX : null,
        residualScaleY: enhanced.residual ? enhanced.residual.scaleY : null
      },
      sourceBox,
      outputBox,
      sourceMoment,
      outputMoment,
      outputSize: { width: outputDecoded.sourceWidth, height: outputDecoded.sourceHeight },
      sourceSize: { width: sourceDecoded.sourceWidth, height: sourceDecoded.sourceHeight },
      sourceMethod: sourcePick.method,
      outputMethod: outputPick.method
    };
  };

  const timeoutMs = Number(options.analysisTimeoutMs);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return withTimeout(compute(), timeoutMs, "smart enhanced alignment");
  }
  return compute();
}

async function buildContentReference(arrayBuffer, strategy, options = {}) {
  const normalizedStrategy = normalizePasteStrategy(strategy);
  const mode = normalizedStrategy === "normal" ? "cover" : "cover";
  return { mode, sourceSize: null, sourceRefBox: null };
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

function formatBoundsForLog(bounds) {
  if (!bounds) return "null";
  const left = Number(bounds.left);
  const top = Number(bounds.top);
  const right = Number(bounds.right);
  const bottom = Number(bounds.bottom);
  const toFixed = (value) => (Number.isFinite(value) ? value.toFixed(2) : "NaN");
  return `(${toFixed(left)}, ${toFixed(top)}, ${toFixed(right)}, ${toFixed(bottom)})`;
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

async function transformLayerRotate(layerId, angleDeg) {
  await action.batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _id: layerId }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    angle: { _unit: "angleUnit", _value: angleDeg }
  }], {});
}

function mapImagePointToLayer(point, imageSize, layerBounds) {
  if (!point || !imageSize || !layerBounds) return null;
  const width = Number(imageSize.width);
  const height = Number(imageSize.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const layerSize = getBoundsSize(layerBounds);
  const layerScaleX = layerSize.width / width;
  const layerScaleY = layerSize.height / height;
  return {
    x: layerBounds.left + point.x * layerScaleX,
    y: layerBounds.top + point.y * layerScaleY
  };
}

function transformPointByScaleRotate(point, center, scaleX, scaleY, angleDeg) {
  if (!point || !center) return null;
  const sx = Number.isFinite(scaleX) ? scaleX : 1;
  const sy = Number.isFinite(scaleY) ? scaleY : 1;
  const rad = Number.isFinite(angleDeg) ? angleDeg * (Math.PI / 180) : 0;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const vx = (point.x - center.x) * sx;
  const vy = (point.y - center.y) * sy;
  return {
    x: center.x + (vx * cos - vy * sin),
    y: center.y + (vx * sin + vy * cos)
  };
}

function mapSourceBoxToLayerBounds(sourceBox, sourceSize, layerBounds) {
  if (!sourceBox || !sourceSize || !layerBounds) return layerBounds;
  const sourceWidth = Number(sourceSize.width);
  const sourceHeight = Number(sourceSize.height);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return layerBounds;
  }
  const layerSize = getBoundsSize(layerBounds);
  const scaleX = layerSize.width / sourceWidth;
  const scaleY = layerSize.height / sourceHeight;
  const mapped = {
    left: layerBounds.left + sourceBox.left * scaleX,
    top: layerBounds.top + sourceBox.top * scaleY,
    right: layerBounds.left + sourceBox.right * scaleX,
    bottom: layerBounds.top + sourceBox.bottom * scaleY
  };
  return parseLayerBounds(mapped) || layerBounds;
}

function resolveReferenceBounds(layerBounds, options = {}) {
  const sourceRefBox = options.sourceRefBox || null;
  const sourceSize = options.sourceSize || null;
  if (!sourceRefBox || !sourceSize) return layerBounds;
  return mapSourceBoxToLayerBounds(sourceRefBox, sourceSize, layerBounds);
}

function resolveScaleFactorsByMode(mode, currentBounds, targetBounds) {
  const cSize = getBoundsSize(currentBounds);
  const tSize = getBoundsSize(targetBounds);
  const ratioX = tSize.width / cSize.width;
  const ratioY = tSize.height / cSize.height;

  if (!Number.isFinite(ratioX) || !Number.isFinite(ratioY) || ratioX <= 0 || ratioY <= 0) {
    return { scaleX: 1, scaleY: 1 };
  }

  if (mode === "contain") {
    const s = Math.min(ratioX, ratioY);
    return { scaleX: s, scaleY: s };
  }
  if (mode === "cover") {
    const s = Math.max(ratioX, ratioY);
    return { scaleX: s, scaleY: s };
  }
  return { scaleX: ratioX, scaleY: ratioY };
}

async function createSelectionFromBounds(bounds, doc) {
  if (!bounds || !doc) return;
  const left = toPixelNumber(bounds.left, 0);
  const top = toPixelNumber(bounds.top, 0);
  const right = toPixelNumber(bounds.right, 0);
  const bottom = toPixelNumber(bounds.bottom, 0);
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) return;
  const region = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom]
  ];
  try {
    await doc.selection.select(region);
  } catch (_) {}
}

async function applyLayerMaskFromSelection() {
  await action.batchPlay([{
    _obj: "make",
    new: { _class: "channel" },
    at: { _ref: "channel", _enum: "channel", _value: "mask" },
    using: { _enum: "userMaskEnabled", _value: "revealSelection" }
  }], {});
}

async function alignActiveLayerToBounds(targetBounds, options = {}) {
  const doc = app.activeDocument;
  const layer = doc && doc.activeLayers && doc.activeLayers[0];
  if (!layer) return;
  const log = options.log || (() => {});

  const mode = options.mode || "cover";
  const smartTransform = options.smartTransform || null;
  const useMask = options.useMask === true;
  const outputSize = options.outputSize || null;
  const maskBounds = options.targetBounds || null;
  const sourceBounds = options.sourceBounds || null;
  const layerId = layer.id;
  const currentBounds0 = parseLayerBounds(layer.bounds);
  if (!currentBounds0) return;

  if (
    smartTransform &&
    smartTransform.strategy === "smartEnhanced" &&
    smartTransform.outputBox &&
    outputSize &&
    maskBounds
  ) {
    const outputW = Number(outputSize.width);
    const outputH = Number(outputSize.height);
    if (Number.isFinite(outputW) && Number.isFinite(outputH) && outputW > 0 && outputH > 0) {
      const enhancedScaleX = clampNumber(Number(smartTransform.sx), SMART_SCALE_MIN, SMART_SCALE_MAX);
      const enhancedScaleY = clampNumber(Number(smartTransform.sy), SMART_SCALE_MIN, SMART_SCALE_MAX);
      let enhancedAngle = clampNumber(
        Number(smartTransform.angle || 0),
        -SMART_ENHANCED_MAX_ROTATE_DEG,
        SMART_ENHANCED_MAX_ROTATE_DEG
      );
      const sourceAnchor =
        smartTransform.sourceAnchor ||
        (sourceBounds ? getBoundsCenter(sourceBounds) : null);
      const outputAnchor =
        smartTransform.outputAnchor ||
        getBoundsCenter(smartTransform.outputBox);

      const layerSize = getBoundsSize(currentBounds0);
      const layerScaleX0 = layerSize.width / outputW;
      const layerScaleY0 = layerSize.height / outputH;
      const mappedBox0 = {
        left: currentBounds0.left + smartTransform.outputBox.left * layerScaleX0,
        top: currentBounds0.top + smartTransform.outputBox.top * layerScaleY0,
        right: currentBounds0.left + smartTransform.outputBox.right * layerScaleX0,
        bottom: currentBounds0.top + smartTransform.outputBox.bottom * layerScaleY0
      };
      const layerCenter0 = getBoundsCenter(currentBounds0);
      const scaledBoxApprox = {
        left: layerCenter0.x + (mappedBox0.left - layerCenter0.x) * enhancedScaleX,
        top: layerCenter0.y + (mappedBox0.top - layerCenter0.y) * enhancedScaleY,
        right: layerCenter0.x + (mappedBox0.right - layerCenter0.x) * enhancedScaleX,
        bottom: layerCenter0.y + (mappedBox0.bottom - layerCenter0.y) * enhancedScaleY
      };
      const rotationInflation = 1 + Math.min(0.25, Math.abs(enhancedAngle) / 120);
      const inflatedApprox = {
        left: layerCenter0.x + (scaledBoxApprox.left - layerCenter0.x) * rotationInflation,
        top: layerCenter0.y + (scaledBoxApprox.top - layerCenter0.y) * rotationInflation,
        right: layerCenter0.x + (scaledBoxApprox.right - layerCenter0.x) * rotationInflation,
        bottom: layerCenter0.y + (scaledBoxApprox.bottom - layerCenter0.y) * rotationInflation
      };
      const overflowRatio = computeOverflowRatio(inflatedApprox, maskBounds);
      if (Number.isFinite(overflowRatio) && overflowRatio > SMART_ENHANCED_OVERFLOW_THRESHOLD) {
        log(
          `smart enhanced overflow=${overflowRatio.toFixed(3)} > ${SMART_ENHANCED_OVERFLOW_THRESHOLD}, fallback`,
          "warn"
        );
        return;
      }

      log(
        `align geometry before: mode=smartEnhanced, layer=${formatBoundsForLog(currentBounds0)}, target=${formatBoundsForLog(maskBounds)}`,
        "info"
      );
      log(
        `align enhanced factors: sx=${enhancedScaleX.toFixed(4)}, sy=${enhancedScaleY.toFixed(4)}, angle=${enhancedAngle.toFixed(2)}`,
        "info"
      );

      if (
        Math.abs(enhancedScaleX * 100 - 100) > 0.2 ||
        Math.abs(enhancedScaleY * 100 - 100) > 0.2
      ) {
        await transformLayerScale(layerId, enhancedScaleX * 100, enhancedScaleY * 100);
      }

      if (Math.abs(enhancedAngle) > 0.2) {
        try {
          await transformLayerRotate(layerId, enhancedAngle);
        } catch (error) {
          log(`smart enhanced rotate skipped: ${error.message || error}`, "warn");
          enhancedAngle = 0;
        }
      }

      const mappedAnchor0 = mapImagePointToLayer(outputAnchor, { width: outputW, height: outputH }, currentBounds0);
      let anchorAfterGlobal = mappedAnchor0;
      if (mappedAnchor0) {
        anchorAfterGlobal = transformPointByScaleRotate(
          mappedAnchor0,
          layerCenter0,
          enhancedScaleX,
          enhancedScaleY,
          enhancedAngle
        );
      }

      if (sourceAnchor && anchorAfterGlobal) {
        const desiredAnchor = {
          x: maskBounds.left + sourceAnchor.x,
          y: maskBounds.top + sourceAnchor.y
        };
        const dx = desiredAnchor.x - anchorAfterGlobal.x;
        const dy = desiredAnchor.y - anchorAfterGlobal.y;
        log(`align enhanced offset: dx=${dx.toFixed(2)}, dy=${dy.toFixed(2)}`, "info");
        if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
          await transformLayerOffset(layerId, dx, dy);
        }
      }

      const residual = smartTransform.residual || null;
      if (residual) {
        const residualScaleX = clampNumber(
          Number(residual.scaleX),
          1 - SMART_ENHANCED_RESIDUAL_SCALE_LIMIT,
          1 + SMART_ENHANCED_RESIDUAL_SCALE_LIMIT
        );
        const residualScaleY = clampNumber(
          Number(residual.scaleY),
          1 - SMART_ENHANCED_RESIDUAL_SCALE_LIMIT,
          1 + SMART_ENHANCED_RESIDUAL_SCALE_LIMIT
        );
        if (
          Number.isFinite(residualScaleX) &&
          Number.isFinite(residualScaleY) &&
          (Math.abs(residualScaleX * 100 - 100) > 0.2 || Math.abs(residualScaleY * 100 - 100) > 0.2)
        ) {
          await transformLayerScale(layerId, residualScaleX * 100, residualScaleY * 100);
        }

        const layerAfterResidualScale = doc.activeLayers && doc.activeLayers[0];
        const currentAfterResidualScale = parseLayerBounds(layerAfterResidualScale && layerAfterResidualScale.bounds);
        if (currentAfterResidualScale) {
          const currentSize = getBoundsSize(currentAfterResidualScale);
          const pixelScaleX = currentSize.width / outputW;
          const pixelScaleY = currentSize.height / outputH;
          const maxShiftX = Math.max(18, (maskBounds.right - maskBounds.left) * 0.18);
          const maxShiftY = Math.max(18, (maskBounds.bottom - maskBounds.top) * 0.18);
          const residualDx = clampNumber(Number(residual.dx) * pixelScaleX, -maxShiftX, maxShiftX);
          const residualDy = clampNumber(Number(residual.dy) * pixelScaleY, -maxShiftY, maxShiftY);
          if (
            Number.isFinite(residualDx) &&
            Number.isFinite(residualDy) &&
            (Math.abs(residualDx) > 0.2 || Math.abs(residualDy) > 0.2)
          ) {
            log(`align enhanced residual: dx=${residualDx.toFixed(2)}, dy=${residualDy.toFixed(2)}`, "info");
            await transformLayerOffset(layerId, residualDx, residualDy);
          }
        }
      }

      if (useMask) {
        try {
          await createSelectionFromBounds(maskBounds, doc);
          await applyLayerMaskFromSelection();
        } catch (error) {
          log(`apply mask failed: ${error.message || error}`, "warn");
        }
      }

      const layerAfterEnhanced = doc.activeLayers && doc.activeLayers[0];
      const currentBoundsEnhanced = parseLayerBounds(layerAfterEnhanced && layerAfterEnhanced.bounds);
      if (currentBoundsEnhanced) {
        log(`align geometry after: layer=${formatBoundsForLog(currentBoundsEnhanced)}`, "info");
      }
      return;
    }
  }

  if (smartTransform && smartTransform.outputBox && outputSize && sourceBounds) {
    const outputW = Number(outputSize.width);
    const outputH = Number(outputSize.height);
    if (Number.isFinite(outputW) && Number.isFinite(outputH) && outputW > 0 && outputH > 0) {
      const sCenter = getBoundsCenter(sourceBounds);
      const sSize = getBoundsSize(sourceBounds);
      const oSize = getBoundsSize(smartTransform.outputBox);
      const scaleX = sSize.width / oSize.width;
      const scaleY = sSize.height / oSize.height;

      const layerSize = getBoundsSize(currentBounds0);
      const layerScaleX = layerSize.width / outputW;
      const layerScaleY = layerSize.height / outputH;
      const scaledBox = {
        left: currentBounds0.left + (smartTransform.outputBox.left * layerScaleX),
        top: currentBounds0.top + (smartTransform.outputBox.top * layerScaleY),
        right: currentBounds0.left + (smartTransform.outputBox.right * layerScaleX),
        bottom: currentBounds0.top + (smartTransform.outputBox.bottom * layerScaleY)
      };

      if (maskBounds) {
        const overflowRatio = computeOverflowRatio(scaledBox, maskBounds);
        if (Number.isFinite(overflowRatio) && overflowRatio > SMART_OVERFLOW_THRESHOLD) {
          log(`smart overflow=${overflowRatio.toFixed(3)} > ${SMART_OVERFLOW_THRESHOLD}, fallback`, "warn");
          return;
        }
      }

      const scaleXPercent = scaleX * 100;
      const scaleYPercent = scaleY * 100;
      log(
        `align geometry before: mode=smart, layer=${formatBoundsForLog(currentBounds0)}, target=${formatBoundsForLog(maskBounds)}`,
        "info"
      );
      log(`align scale factors: sx=${scaleX.toFixed(4)}, sy=${scaleY.toFixed(4)}`, "info");

      if (
        Number.isFinite(scaleXPercent) &&
        Number.isFinite(scaleYPercent) &&
        (Math.abs(scaleXPercent - 100) > 0.2 || Math.abs(scaleYPercent - 100) > 0.2)
      ) {
        await transformLayerScale(layerId, scaleXPercent, scaleYPercent);
      }

      const layerAfterScale = doc.activeLayers && doc.activeLayers[0];
      const currentBounds1 = parseLayerBounds(layerAfterScale && layerAfterScale.bounds);
      if (!currentBounds1) return;

      const referenceBounds = {
        left: currentBounds1.left + (scaledBox.left - currentBounds0.left) * scaleX,
        top: currentBounds1.top + (scaledBox.top - currentBounds0.top) * scaleY,
        right: currentBounds1.left + (scaledBox.right - currentBounds0.left) * scaleX,
        bottom: currentBounds1.top + (scaledBox.bottom - currentBounds0.top) * scaleY
      };
      const refCenter = getBoundsCenter(referenceBounds);
      const dx = sCenter.x - refCenter.x;
      const dy = sCenter.y - refCenter.y;
      log(`align offset: dx=${dx.toFixed(2)}, dy=${dy.toFixed(2)}`, "info");
      if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
        await transformLayerOffset(layerId, dx, dy);
      }

      if (useMask) {
        try {
          await createSelectionFromBounds(maskBounds, doc);
          await applyLayerMaskFromSelection();
        } catch (error) {
          log(`apply mask failed: ${error.message || error}`, "warn");
        }
      }

      const layerAfterOffset = doc.activeLayers && doc.activeLayers[0];
      const currentBounds2 = parseLayerBounds(layerAfterOffset && layerAfterOffset.bounds);
      if (currentBounds2) {
        log(`align geometry after: layer=${formatBoundsForLog(currentBounds2)}`, "info");
      }
      return;
    }
  }

  const referenceBounds0 = resolveReferenceBounds(currentBounds0, options);
  const factors = resolveScaleFactorsByMode(mode, referenceBounds0, targetBounds);
  const scaleXPercent = factors.scaleX * 100;
  const scaleYPercent = factors.scaleY * 100;
  log(
    `align geometry before: mode=${mode}, layer=${formatBoundsForLog(currentBounds0)}, ref=${formatBoundsForLog(referenceBounds0)}, target=${formatBoundsForLog(targetBounds)}`,
    "info"
  );
  log(`align scale factors: sx=${factors.scaleX.toFixed(4)}, sy=${factors.scaleY.toFixed(4)}`, "info");

  if (
    Number.isFinite(scaleXPercent) &&
    Number.isFinite(scaleYPercent) &&
    (Math.abs(scaleXPercent - 100) > 0.2 || Math.abs(scaleYPercent - 100) > 0.2)
  ) {
    await transformLayerScale(layerId, scaleXPercent, scaleYPercent);
  }

  const layerAfterScale = doc.activeLayers && doc.activeLayers[0];
  const currentBounds1 = parseLayerBounds(layerAfterScale && layerAfterScale.bounds);
  if (!currentBounds1) return;

  const referenceBounds1 = resolveReferenceBounds(currentBounds1, options);
  const cCenter = getBoundsCenter(referenceBounds1);
  const tCenter = getBoundsCenter(targetBounds);
  const dx = tCenter.x - cCenter.x;
  const dy = tCenter.y - cCenter.y;
  log(`align offset: dx=${dx.toFixed(2)}, dy=${dy.toFixed(2)}`, "info");

  if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
    await transformLayerOffset(layerId, dx, dy);
  }

  const layerAfterOffset = doc.activeLayers && doc.activeLayers[0];
  const currentBounds2 = parseLayerBounds(layerAfterOffset && layerAfterOffset.bounds);
  if (currentBounds2) {
    const referenceBounds2 = resolveReferenceBounds(currentBounds2, options);
    log(
      `align geometry after: layer=${formatBoundsForLog(currentBounds2)}, ref=${formatBoundsForLog(referenceBounds2)}`,
      "info"
    );
  }
}

async function placeImage(arrayBuffer, options = {}) {
  const log = options.log || (() => {});
  const signal = options.signal || null;
  const targetBoundsRaw = options.targetBounds || null;
  const pasteStrategy = normalizePasteStrategy(options.pasteStrategy);
  const sourceBuffer = options.sourceBuffer || null;
  let contentReference = { mode: "cover", sourceSize: null, sourceRefBox: null };
  let smartTransform = null;
  const useSmart = pasteStrategy === "smart" || pasteStrategy === "smartEnhanced";
  const useSmartEnhanced = pasteStrategy === "smartEnhanced";
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

  if (signal && signal.aborted) throw createAbortError("用户中止");
  if (targetBoundsRaw) {
    if (useSmart) {
      log(`Paste strategy in effect: ${useSmartEnhanced ? "smartEnhanced" : "smart"}`, "info");
    } else {
      const marker = contentReference.sourceRefBox ? `${contentReference.mode}+content-box` : contentReference.mode;
      log(`Paste strategy in effect: ${pasteStrategy} -> ${marker}`, "info");
    }
  }

  await core.executeAsModal(async () => {
    if (signal && signal.aborted) throw createAbortError("用户中止");
    const doc = app.activeDocument;
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
    if (signal && signal.aborted) throw createAbortError("用户中止");

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
        const sourceMethod = smartTransform.sourceMethod || "-";
        const outputMethod = smartTransform.outputMethod || "-";
        const angle = smartTransform.metrics && Number(smartTransform.metrics.angle);
        const enhancedConfidence = smartTransform.metrics && Number(smartTransform.metrics.enhancedConfidence);
        log(
          `${alignLabel} score: ${Number.isFinite(score) ? score.toFixed(3) : "n/a"}, center=(${center ? center.dx.toFixed(1) : "-"},${center ? center.dy.toFixed(1) : "-"}), ratioDiff=${Number.isFinite(ratioDiff) ? ratioDiff.toFixed(3) : "-"}, iou=${Number.isFinite(iou) ? iou.toFixed(3) : "-"}, angle=${Number.isFinite(angle) ? angle.toFixed(2) : "-"}, conf=${Number.isFinite(enhancedConfidence) ? enhancedConfidence.toFixed(3) : "-"}, method=(${sourceMethod}/${outputMethod})`,
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
      log(`结果图对齐失败，已保留默认位置: ${e.message}`, "warn");
    } finally {
      log("alignActiveLayerToBounds end", "info");
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
    const msg = first.message || `${label} failed`;
    throw new Error(msg);
  }
}

const TOOL_MENU_KEYWORDS = {
  gaussianBlur: ["gaussian blur", "高斯模糊"],
  smartSharpen: ["smart sharpen", "智能锐化"],
  highPass: ["high pass", "高反差保留"],
  contentAwareFill: ["content-aware fill", "内容识别填充"]
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
    throw new Error("当前 Photoshop 不支持菜单命令调用。");
  }

  const ids = await getToolMenuIds();
  const commandID = ids[menuKey];
  if (!commandID) {
    throw new Error(`${label} 菜单命令未找到。`);
  }

  if (typeof core.getMenuCommandState === "function") {
    try {
      const enabled = await core.getMenuCommandState({ commandID });
      if (enabled === false) {
        throw new Error(`${label} 当前不可用，请检查图层或选区状态。`);
      }
    } catch (error) {
      const msg = String((error && error.message) || "");
      if (msg.includes("不可用")) throw error;
    }
  }

  const ok = await core.performMenuCommand({ commandID });
  if (ok === false) {
    throw new Error(`${label} 菜单命令执行失败。`);
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
    throw new Error(`${label} 执行失败。菜单方式: ${menuMsg}; BatchPlay方式: ${batchMsg}`);
  }
}

/**
 * 调用 Photoshop 自带的高斯模糊滤镜（弹出原生对话框，可自调半径）
 */
async function runGaussianBlur() {
  ensureActiveDocument();
  await runDialogCommandWithFallback({
    label: "高斯模糊",
    menuKey: "gaussianBlur",
    descriptor: {
      _obj: "gaussianBlur",
      radius: { _unit: "pixelsUnit", _value: 5 }
    },
    commandName: "高斯模糊"
  });
}

/**
 * 调用 Photoshop 自带锐化（弹出可调参数对话框）
 */
async function runSharpen() {
  ensureActiveDocument();
  await runDialogCommandWithFallback({
    label: "智能锐化",
    menuKey: "smartSharpen",
    descriptor: { _obj: "smartSharpen" },
    commandName: "锐化（Smart Sharpen）"
  });
}

/**
 * 调用 Photoshop 高反差保留滤镜（弹出原生对话框，可调半径）
 */
async function runHighPass() {
  ensureActiveDocument();
  await runDialogCommandWithFallback({
    label: "高反差保留",
    menuKey: "highPass",
    descriptor: {
      _obj: "highPass",
      radius: { _unit: "pixelsUnit", _value: 2 }
    },
    commandName: "高反差保留"
  });
}

/**
 * 调用 Photoshop 内容识别填充（显示填充参数窗口），依赖当前选区
 */
async function runContentAwareFill() {
  const doc = ensureActiveDocument();
  if (!ensureSelectionExists(doc)) {
    throw new Error("请先建立选区，再运行智能识别填充。");
  }
  await runDialogCommandWithFallback({
    label: "内容识别填充",
    menuKey: "contentAwareFill",
    descriptor: { _obj: "contentAwareFill" },
    commandName: "智能识别填充"
  });
}

// 记得在 module.exports 里导出这些新函数
module.exports = {
  captureSelection,
  placeImage,
  createNeutralGrayLayer, // 新增
  createObserverLayer,    // 新增
  stampVisibleLayers,     // 新增
  runGaussianBlur,
  runSharpen,
  runHighPass,
  runContentAwareFill
};
