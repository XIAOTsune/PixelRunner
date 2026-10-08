(function initGlowCrossStarModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const PI2 = Math.PI * 2;

  function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
  function smoothstep(a, b, value) {
    const t = clamp01((value - a) / Math.max(0.0001, b - a));
    return t * t * (3 - 2 * t);
  }
  function srgbToLinear(value) {
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }
  function layer(width, height) {
    return { width, height, r: new Float32Array(width * height), g: new Float32Array(width * height), b: new Float32Array(width * height) };
  }
  function integral(values, width, height) {
    const out = new Float64Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y += 1) {
      let row = 0;
      for (let x = 0; x < width; x += 1) {
        row += values[y * width + x];
        out[(y + 1) * (width + 1) + x + 1] = out[y * (width + 1) + x + 1] + row;
      }
    }
    return out;
  }
  function mean(integralMap, width, height, x, y, radius) {
    const stride = width + 1;
    const left = Math.max(0, x - radius); const right = Math.min(width - 1, x + radius);
    const top = Math.max(0, y - radius); const bottom = Math.min(height - 1, y + radius);
    const sum = integralMap[(bottom + 1) * stride + right + 1] - integralMap[top * stride + right + 1]
      - integralMap[(bottom + 1) * stride + left] + integralMap[top * stride + left];
    return sum / Math.max(1, (right - left + 1) * (bottom - top + 1));
  }
  function write(layerTarget, x, y, color, amount) {
    if (!(amount > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const x0 = Math.floor(x); const y0 = Math.floor(y); const tx = x - x0; const ty = y - y0;
    for (let oy = 0; oy <= 1; oy += 1) {
      const py = y0 + oy; if (py < 0 || py >= layerTarget.height) continue;
      const wy = oy ? ty : 1 - ty;
      for (let ox = 0; ox <= 1; ox += 1) {
        const px = x0 + ox; if (px < 0 || px >= layerTarget.width) continue;
        const weight = amount * wy * (ox ? tx : 1 - tx); if (!(weight > 0)) continue;
        const index = py * layerTarget.width + px;
        layerTarget.r[index] += color[0] * weight; layerTarget.g[index] += color[1] * weight; layerTarget.b[index] += color[2] * weight;
      }
    }
  }
  function splat(target, source, radius, amount) {
    const color = [source.r, source.g, source.b];
    const radiusSq = Math.max(0.25, radius * radius);
    for (let y = Math.floor(source.y - radius); y <= Math.ceil(source.y + radius); y += 1) {
      if (y < 0 || y >= target.height) continue;
      for (let x = Math.floor(source.x - radius); x <= Math.ceil(source.x + radius); x += 1) {
        if (x < 0 || x >= target.width) continue;
        const d = ((x - source.x) ** 2 + (y - source.y) ** 2) / radiusSq;
        if (d > 1) continue;
        const w = Math.pow(1 - d, 2.2) * amount; const index = y * target.width + x;
        target.r[index] += color[0] * w; target.g[index] += color[1] * w; target.b[index] += color[2] * w;
      }
    }
  }
  function createImageMask(values, width, height, tint = [255, 255, 255]) {
    const out = new ImageData(width, height);
    for (let i = 0; i < values.length; i += 1) {
      const value = Math.round(clamp01(values[i]) * 255); const p = i * 4;
      out.data[p] = Math.round(tint[0] * value / 255); out.data[p + 1] = Math.round(tint[1] * value / 255); out.data[p + 2] = Math.round(tint[2] * value / 255); out.data[p + 3] = 255;
    }
    return out;
  }

  function analyze(imageData, sourceParams = {}, options = {}) {
    const { width, height, data } = imageData; const total = width * height;
    const luma = new Float32Array(total); const localContrast = new Float32Array(total); const sourceMask = new Float32Array(total);
    const protectMask = new Float32Array(total); const whiteFlatMask = new Float32Array(total); const skinLikeMask = new Float32Array(total); const darkProtect = new Float32Array(total); const contrastMask = new Float32Array(total);
    const sourceLayer = layer(width, height);
    const maxMap = new Float32Array(total); const minMap = new Float32Array(total); const satMap = new Float32Array(total);
    let maxLuma = 0;
    for (let p = 0, i = 0; p < total; p += 1, i += 4) {
      const r = srgbToLinear(data[i] / 255); const g = srgbToLinear(data[i + 1] / 255); const b = srgbToLinear(data[i + 2] / 255);
      const max = Math.max(r, g, b); const min = Math.min(r, g, b); const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
      luma[p] = lum; maxMap[p] = max; minMap[p] = min; satMap[p] = max > 0 ? (max - min) / max : 0; maxLuma = Math.max(maxLuma, lum);
    }
    const localMap = integral(luma, width, height);
    const requestedRadius = Number(sourceParams.localRadius);
    const radius = Math.max(1, Math.min(8, Math.round(requestedRadius > 0 && requestedRadius < 1
      ? Math.max(width, height) * requestedRadius
      : (requestedRadius || Math.min(width, height) / 180))));
    const candidate = new Uint8Array(total); const debugMask = new Uint8Array(total);
    const high = Math.max(0.45, Number(sourceParams.thresholdHigh) || 0.7); const contrastGate = Math.max(0.008, Number(sourceParams.contrastLow) || 0.018);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const p = y * width + x; const local = mean(localMap, width, height, x, y, radius); const contrast = Math.max(0, luma[p] - local); localContrast[p] = contrast;
      const sat = satMap[p]; const white = smoothstep(0.78, 0.97, luma[p]) * (1 - smoothstep(0.02, 0.14, contrast)) * (1 - smoothstep(0.12, 0.38, sat));
      const skin = sat > 0.16 && sat < 0.7 && luma[p] > 0.3 && luma[p] < 0.92 && maxMap[p] === srgbToLinear(data[p * 4] / 255);
      const dark = 1 - smoothstep(0.12, 0.34, luma[p]); whiteFlatMask[p] = white; skinLikeMask[p] = skin ? 1 : 0; darkProtect[p] = dark;
      const gate = smoothstep(high - 0.1, Math.min(0.99, high + 0.12), maxMap[p]);
      const qualityGate = gate * smoothstep(contrastGate, contrastGate * 4.5, contrast) * (1 - white * 0.96) * (1 - (skin ? 0.42 : 0)) * (1 - dark * 0.9);
      sourceMask[p] = qualityGate; contrastMask[p] = smoothstep(contrastGate, contrastGate * 4, contrast); protectMask[p] = 1 - qualityGate;
      if (qualityGate > 0.055 && white < 0.35) { candidate[p] = 1; debugMask[p] = 255; }
      const r = srgbToLinear(data[p * 4] / 255); const g = srgbToLinear(data[p * 4 + 1] / 255); const b = srgbToLinear(data[p * 4 + 2] / 255);
      sourceLayer.r[p] = r * qualityGate; sourceLayer.g[p] = g * qualityGate; sourceLayer.b[p] = b * qualityGate;
    }
    const visited = new Uint8Array(total); const queue = new Int32Array(total); const sources = [];
    for (let start = 0; start < total; start += 1) {
      if (!candidate[start] || visited[start]) continue; let head = 0; let tail = 0; queue[tail++] = start; visited[start] = 1; const pixels = [];
      let sx = 0; let sy = 0; let sw = 0; let sr = 0; let sg = 0; let sb = 0; let peak = 0; let peakIndex = start; let minX = width; let minY = height; let maxX = 0; let maxY = 0; let perimeter = 0;
      while (head < tail) {
        const p = queue[head++]; pixels.push(p); const x = p % width; const y = Math.floor(p / width); const w = Math.max(0.0001, sourceMask[p] * (0.4 + 0.6 * maxMap[p]));
        sw += w; sx += x * w; sy += y * w; sr += srgbToLinear(data[p * 4] / 255) * w; sg += srgbToLinear(data[p * 4 + 1] / 255) * w; sb += srgbToLinear(data[p * 4 + 2] / 255) * w;
        if (luma[p] > peak) { peak = luma[p]; peakIndex = p; } minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) { if (!ox && !oy) continue; const nx = x + ox; const ny = y + oy; if (nx < 0 || nx >= width || ny < 0 || ny >= height) { perimeter += 1; continue; } const q = ny * width + nx; if (!candidate[q]) perimeter += 1; else if (!visited[q]) { visited[q] = 1; queue[tail++] = q; } }
      }
      const boxArea = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1)); const compactness = Math.min(1, 4 * Math.PI * pixels.length / Math.max(1, perimeter * perimeter)); const density = pixels.length / boxArea;
      const quality = clamp01(Math.pow(peak / Math.max(0.001, maxLuma), 0.72) * (0.46 + 0.54 * Math.sqrt(Math.max(0, compactness * density))) * (pixels.length > boxArea * 0.78 ? 0.35 : 1));
      if (quality < 0.035 || (pixels.length > 8 && density < 0.15)) continue;
      const sourceR = sr / sw; const sourceG = sg / sw; const sourceB = sb / sw;
      sources.push({ x: sx / sw, y: sy / sw, peakX: peakIndex % width, peakY: Math.floor(peakIndex / width), peakIndex, area: pixels.length, diameter: Math.max(1, Math.sqrt(pixels.length / Math.PI) * 2), radius: Math.max(0.5, Math.sqrt(pixels.length / Math.PI)), brightness: peak, quality, compactness, density, bounds: { minX, minY, maxX, maxY }, r: sourceR, g: sourceG, b: sourceB, sourceR, sourceG, sourceB });
    }
    sources.sort((a, b) => b.quality - a.quality || b.brightness - a.brightness || a.peakIndex - b.peakIndex);
    const merged = [];
    for (const source of sources) {
      const sameCore = merged.find((item) => (source.x - item.x) ** 2 + (source.y - item.y) ** 2 <= 9 && source.brightness / Math.max(0.001, item.brightness) > 0.72);
      if (!sameCore) merged.push(source);
      else if (source.quality > sameCore.quality) Object.assign(sameCore, source);
    }
    sourceLayer.starAnalysis = { width, height, sources: merged, debugMask, maxLuma, luma, localContrast };
    return { width, height, sourceLayer, starSources: merged, masks: { luma, localContrast, lumaMask: luma, contrastMask, whiteFlatMask, skinLikeMask, darkProtect, protectMask, sourceMask }, debugImages: options.includeDebug === false ? null : { luma: createImageMask(luma, width, height), contrast: createImageMask(contrastMask, width, height), whiteFlat: createImageMask(whiteFlatMask, width, height), skinLike: createImageMask(skinLikeMask, width, height, [255, 188, 126]), darkProtect: createImageMask(darkProtect, width, height, [120, 172, 255]), sourceMask: createImageMask(sourceMask, width, height, [255, 244, 190]), protectMask: createImageMask(protectMask, width, height, [142, 207, 255]) } };
  }

  const SHAPES = {
    crisp: [0.0266241299, 0.0473317865, 0.62, 0.78, 1, 1, 0, 0],
    natural: [0.0461538462, 0.0769230769, 0.56, 0.68, 1 / 3, 0.35, 0.22, 0.3],
    dreamy: [0.054098758, 0.0915517442, 0.5, 0.62, 0.016 / 0.052, 0.028 / 0.088, 0.28, 0.36]
  };
  function lengthScale(value) { const t = clamp01((Number(value) - 1) / 99); const pivot = 51 / 99; return t <= pivot ? 0.25 + 0.53 * t / pivot : 0.78 + 2.82 * Math.pow((t - pivot) / (1 - pivot), 1.32); }
  function selectSources(analysis, optics) {
    if (!analysis) return { layer: layer(1, 1), starSources: [], activeRatio: 0 };
    const range = clamp01((Number(optics.starRange ?? optics.visibility * 100) - 1) / 99); const minQuality = 0.96 - 0.935 * Math.pow(range, 0.65);
    const selected = analysis.sources.filter((source) => source.quality >= minQuality).slice(0, Math.max(1, Math.round(analysis.sources.length * (0.015 + 0.985 * Math.pow(range, 0.65)))));
    return { ...analysis, starSources: selected };
  }
  function buildGeometry(analysis, optics = {}) {
    const selected = selectSources(analysis, optics); const width = analysis.width; const height = analysis.height; const out = layer(width, height); const shape = SHAPES[optics.starShape] || SHAPES.natural; const scale = lengthScale(optics.length); const edge = Math.max(width, height); const angle = (Number(optics.rotation) || 0) * Math.PI / 180; const c = Math.cos(angle); const s = Math.sin(angle); const visible = clamp01(optics.visibility); const soft = clamp01((Number(optics.starSoftGlow) || 0) / 100); const sources = selected.starSources || [];
    for (const source of sources) {
      const energy = Math.pow(clamp01(source.quality), 0.72) * (0.72 + 0.28 * clamp01(source.brightness / Math.max(0.001, analysis.maxLuma))) * visible; const color = [source.r, source.g, source.b]; splat(out, source, Math.max(1.1, source.radius * 0.7), energy * 0.9);
      const emit = (ax, ay, length, weight, primary, halo) => {
        const rayLength = Math.max(1, edge * length * scale);
        const coreLength = Math.max(1, rayLength * primary);
        const extent = Math.max(1, rayLength * (halo > 0 ? 2 : 1.65));
        const steps = Math.ceil(extent);
        for (let side = -1; side <= 1; side += 2) {
          for (let step = 1; step <= steps; step += 1) {
            const d = extent * step / steps;
            const core = Math.exp(-3 * d / coreLength);
            const haloAmount = halo * soft * Math.exp(-3 * d / rayLength);
            const amount = energy * weight * (core + haloAmount);
            write(out, source.x + (ax * c - ay * s) * d * side, source.y + (ax * s + ay * c) * d * side, color, amount);
          }
        }
      };
      emit(1, 0, shape[0], shape[2], shape[4], shape[6]); emit(0, 1, shape[1], shape[3], shape[5], shape[7]);
    }
    return { glowLayer: out, starSources: sources, levels: { mips: [], activeRatio: sources.length / Math.max(1, width * height) }, geometry: { lengthScale: scale, shape: optics.starShape || "natural" } };
  }
  modules.glowCrossStar = { analyze, selectSources, buildGeometry };
})(window);
