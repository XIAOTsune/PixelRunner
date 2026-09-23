function clamp(value, min, max) {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : 0));
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function lerp(a, b, amount) {
  return Number(a) + (Number(b) - Number(a)) * clamp(amount, 0, 1);
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((Number(value) - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function getBlendMatchToneCurveDelta(value, curve) {
  if (!curve || !Array.isArray(curve.source) || !Array.isArray(curve.deltas)) return null;
  const y = clamp(value, 0, 255);
  const s10 = clamp(curve.source[0], 0, 255);
  const s50 = Math.max(s10 + 1, clamp(curve.source[1], 0, 255));
  const s90 = Math.max(s50 + 1, clamp(curve.source[2], 0, 255));
  const d10 = Number(curve.deltas[0]) || 0;
  const d50 = Number(curve.deltas[1]) || 0;
  const d90 = Number(curve.deltas[2]) || 0;
  const shadowDelta = Number(curve.shadowDelta) || d10;
  const highlightDelta = Number(curve.highlightDelta) || d90;
  if (y <= s10) return lerp(shadowDelta, d10, smoothstep(0, Math.max(1, s10), y));
  if (y <= s50) return lerp(d10, d50, (y - s10) / Math.max(1, s50 - s10));
  if (y <= s90) return lerp(d50, d90, (y - s50) / Math.max(1, s90 - s50));
  return lerp(d90, highlightDelta, smoothstep(s90, 255, y));
}

export function summarizeBlendMatchToneCurve(curve) {
  if (!curve || !Array.isArray(curve.deltas) || !curve.deltas.length) return 0;
  return curve.deltas.reduce((sum, value) => sum + Math.abs(Number(value) || 0), 0) / curve.deltas.length;
}

function yuvToRgb(y, u, v) {
  const r = y + v;
  const b = y + u;
  const g = (y - 0.299 * r - 0.114 * b) / 0.587;
  return [r, g, b];
}

function applySaturation(r, g, b, factor) {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [
    y + (r - y) * factor,
    y + (g - y) * factor,
    y + (b - y) * factor
  ];
}

export function applyBlendMatchColorToRgb(r, g, b, options = {}) {
  const profile = options.profile || null;
  const corrections = options.corrections || {};
  const config = options.config || {};
  let nextR = Number(r) || 0;
  let nextG = Number(g) || 0;
  let nextB = Number(b) || 0;
  if (profile) {
    const y0 = 0.299 * nextR + 0.587 * nextG + 0.114 * nextB;
    const u0 = nextB - y0;
    const v0 = nextR - y0;
    const maxChannel = Math.max(nextR, nextG, nextB);
    const minChannel = Math.min(nextR, nextG, nextB);
    const saturation = maxChannel <= 0 ? 0 : (maxChannel - minChannel) / maxChannel;
    const shadowWeight = 1 - smoothstep(42, 118, y0);
    const highlightWeight = smoothstep(172, 238, y0);
    const midWeight = Math.max(0, 1 - Math.max(shadowWeight, highlightWeight));
    let toneDelta =
      (Number(profile.shadowDelta) || 0) * shadowWeight +
      (Number(profile.midDelta) || 0) * midWeight +
      (Number(profile.highlightDelta) || 0) * highlightWeight;
    const curveDelta = getBlendMatchToneCurveDelta(y0, profile.toneCurve);
    if (Number.isFinite(curveDelta)) {
      toneDelta = lerp(toneDelta, curveDelta, clamp(profile.toneCurve && profile.toneCurve.mix || 0.62, 0, 1));
    }
    if (y0 > 218 && toneDelta > 0) toneDelta *= 0.35;
    if (y0 < 32 && toneDelta < 0) toneDelta *= 0.35;
    const y = y0 + toneDelta;
    const chromaProtect = 0.52 + midWeight * 0.48;
    const neutralWeight = (1 - smoothstep(0.06, 0.32, saturation)) * (0.36 + midWeight * 0.64);
    const chromaScale = Number(profile.chromaScale) || 1;
    const u = u0 * (1 + (chromaScale - 1) * chromaProtect) +
      (Number(profile.uDelta) || 0) * chromaProtect +
      (Number(profile.neutralUDelta) || 0) * neutralWeight;
    const v = v0 * (1 + (chromaScale - 1) * chromaProtect) +
      (Number(profile.vDelta) || 0) * chromaProtect +
      (Number(profile.neutralVDelta) || 0) * neutralWeight;
    [nextR, nextG, nextB] = yuvToRgb(y, u, v);
    [nextR, nextG, nextB] = applySaturation(
      nextR,
      nextG,
      nextB,
      1 + ((Number(profile.saturationFactor) || 1) - 1) * chromaProtect
    );
  } else {
    const total = clamp((Number(config.totalStrength) || 0) / 100, 0, 1);
    const brightness = (Number(corrections.brightness) || 0) * (0.72 + total * 0.28);
    const contrast = clamp(corrections.contrast, -254, 254);
    const saturation = Number(corrections.saturation) || 0;
    const balance = corrections.colorBalance || {};
    const colorScale = 0.85 + total * 0.15;
    nextR += brightness + (Number(balance.cyanRed) || 0) * colorScale;
    nextG += brightness + (Number(balance.magentaGreen) || 0) * colorScale;
    nextB += brightness + (Number(balance.yellowBlue) || 0) * colorScale;
    const contrastFactor = (259 * (contrast + 255)) / Math.max(1, 255 * (259 - contrast));
    nextR = contrastFactor * (nextR - 128) + 128;
    nextG = contrastFactor * (nextG - 128) + 128;
    nextB = contrastFactor * (nextB - 128) + 128;
    [nextR, nextG, nextB] = applySaturation(nextR, nextG, nextB, clamp(1 + saturation / 100, 0.45, 1.75));
  }
  return [clampByte(nextR), clampByte(nextG), clampByte(nextB)];
}

export function applyBlendMatchColorToRgba(sourceSample, options = {}) {
  if (!sourceSample || !sourceSample.data) throw new Error("BlendMatch color pipeline is missing source pixels.");
  const sourceData = sourceSample.data;
  const out = new Uint8Array(sourceData.length);
  const forceOpaque = options.forceOpaque === true;
  for (let index = 0; index < sourceData.length; index += 4) {
    const alpha = sourceData[index + 3];
    if (alpha <= 0) {
      out[index] = 0;
      out[index + 1] = 0;
      out[index + 2] = 0;
      out[index + 3] = 0;
      continue;
    }
    const corrected = applyBlendMatchColorToRgb(sourceData[index], sourceData[index + 1], sourceData[index + 2], options);
    out[index] = corrected[0];
    out[index + 1] = corrected[1];
    out[index + 2] = corrected[2];
    out[index + 3] = forceOpaque ? 255 : alpha;
  }
  return {
    width: Math.max(1, Number(sourceSample.width) || 1),
    height: Math.max(1, Number(sourceSample.height) || 1),
    scaleX: sourceSample.scaleX,
    scaleY: sourceSample.scaleY,
    data: out
  };
}
