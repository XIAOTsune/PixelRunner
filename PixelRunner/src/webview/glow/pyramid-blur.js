(function initGlowPyramidBlurModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  function createLayer(width, height) {
    return {
      width,
      height,
      r: new Float32Array(width * height),
      g: new Float32Array(width * height),
      b: new Float32Array(width * height)
    };
  }

  function downsampleLayer(layer) {
    const nextWidth = Math.max(1, Math.floor(layer.width / 2));
    const nextHeight = Math.max(1, Math.floor(layer.height / 2));
    const out = createLayer(nextWidth, nextHeight);
    const offsets = [
      [-2, -2, 0.03125], [0, -2, 0.0625], [2, -2, 0.03125],
      [-2, 0, 0.0625], [0, 0, 0.125], [2, 0, 0.0625],
      [-2, 2, 0.03125], [0, 2, 0.0625], [2, 2, 0.03125],
      [-1, -1, 0.125], [1, -1, 0.125], [-1, 1, 0.125], [1, 1, 0.125]
    ];
    for (let y = 0; y < nextHeight; y += 1) {
      for (let x = 0; x < nextWidth; x += 1) {
        const sx = (x + 0.5) * 2 - 0.5;
        const sy = (y + 0.5) * 2 - 0.5;
        const target = y * nextWidth + x;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let index = 0; index < offsets.length; index += 1) {
          const tap = offsets[index];
          const weight = tap[2];
          r += sampleBilinear(layer, sx + tap[0], sy + tap[1], layer.r) * weight;
          g += sampleBilinear(layer, sx + tap[0], sy + tap[1], layer.g) * weight;
          b += sampleBilinear(layer, sx + tap[0], sy + tap[1], layer.b) * weight;
        }
        out.r[target] = r;
        out.g[target] = g;
        out.b[target] = b;
      }
    }
    return out;
  }

  function sampleBilinear(layer, x, y, channel) {
    const sx = Math.min(layer.width - 1, Math.max(0, x));
    const sy = Math.min(layer.height - 1, Math.max(0, y));
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(layer.width - 1, x0 + 1);
    const y1 = Math.min(layer.height - 1, y0 + 1);
    const tx = sx - x0;
    const ty = sy - y0;
    const a = y0 * layer.width + x0;
    const b = y0 * layer.width + x1;
    const c = y1 * layer.width + x0;
    const d = y1 * layer.width + x1;
    const wa = (1 - tx) * (1 - ty);
    const wb = tx * (1 - ty);
    const wc = (1 - tx) * ty;
    const wd = tx * ty;
    return channel[a] * wa + channel[b] * wb + channel[c] * wc + channel[d] * wd;
  }

  function kawaseBlurLayer(layer, offset = 1) {
    const out = createLayer(layer.width, layer.height);
    const taps = [
      [-offset, -offset, 1],
      [offset, -offset, 1],
      [-offset, offset, 1],
      [offset, offset, 1],
      [0, 0, 2]
    ];
    const weightTotal = 6;
    for (let y = 0; y < layer.height; y += 1) {
      for (let x = 0; x < layer.width; x += 1) {
        const target = y * layer.width + x;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let index = 0; index < taps.length; index += 1) {
          const tap = taps[index];
          const sx = x + tap[0];
          const sy = y + tap[1];
          const weight = tap[2];
          r += sampleBilinear(layer, sx, sy, layer.r) * weight;
          g += sampleBilinear(layer, sx, sy, layer.g) * weight;
          b += sampleBilinear(layer, sx, sy, layer.b) * weight;
        }
        out.r[target] = r / weightTotal;
        out.g[target] = g / weightTotal;
        out.b[target] = b / weightTotal;
      }
    }
    return out;
  }

  function upsampleLayer(source, width, height) {
    const out = createLayer(width, height);
    const xScale = source.width / width;
    const yScale = source.height / height;
    const taps = [
      [-1, -1, 1], [0, -1, 2], [1, -1, 1],
      [-1, 0, 2], [0, 0, 4], [1, 0, 2],
      [-1, 1, 1], [0, 1, 2], [1, 1, 1]
    ];
    for (let y = 0; y < height; y += 1) {
      const sy = (y + 0.5) * yScale - 0.5;
      for (let x = 0; x < width; x += 1) {
        const sx = (x + 0.5) * xScale - 0.5;
        const target = y * width + x;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let index = 0; index < taps.length; index += 1) {
          const tap = taps[index];
          r += sampleBilinear(source, sx + tap[0], sy + tap[1], source.r) * tap[2];
          g += sampleBilinear(source, sx + tap[0], sy + tap[1], source.g) * tap[2];
          b += sampleBilinear(source, sx + tap[0], sy + tap[1], source.b) * tap[2];
        }
        out.r[target] = r * 0.0625;
        out.g[target] = g * 0.0625;
        out.b[target] = b * 0.0625;
      }
    }
    return out;
  }

  function addLayer(target, source, weight) {
    const count = Math.min(target.r.length, source.r.length);
    for (let index = 0; index < count; index += 1) {
      target.r[index] += source.r[index] * weight;
      target.g[index] += source.g[index] * weight;
      target.b[index] += source.b[index] * weight;
    }
  }

  function scaleLayer(source, weight) {
    const out = createLayer(source.width, source.height);
    for (let index = 0; index < source.r.length; index += 1) {
      out.r[index] = source.r[index] * weight;
      out.g[index] = source.g[index] * weight;
      out.b[index] = source.b[index] * weight;
    }
    return out;
  }

  function resolveMipWeights(weights, count) {
    const out = [];
    const fallback = weights.length ? Math.max(0, Number(weights[weights.length - 1]) || 0) : 0.2;
    let total = 0;
    for (let index = 0; index < count; index += 1) {
      const value = Math.max(0, Number(weights[index]) || fallback);
      out.push(value);
      total += value;
    }
    if (total <= 0.0001) return out.map(() => 1);
    const energyScale = Math.min(1.35, Math.max(0.75, total));
    const normalize = count * energyScale / total;
    return out.map((value) => value * normalize);
  }

  function addUpsampled(target, source, weight) {
    const xScale = source.width / target.width;
    const yScale = source.height / target.height;
    for (let y = 0; y < target.height; y += 1) {
      const sy = Math.min(source.height - 1, Math.max(0, (y + 0.5) * yScale - 0.5));
      const y0 = Math.floor(sy);
      const y1 = Math.min(source.height - 1, y0 + 1);
      const ty = sy - y0;
      for (let x = 0; x < target.width; x += 1) {
        const sx = Math.min(source.width - 1, Math.max(0, (x + 0.5) * xScale - 0.5));
        const x0 = Math.floor(sx);
        const x1 = Math.min(source.width - 1, x0 + 1);
        const tx = sx - x0;
        const a = y0 * source.width + x0;
        const b = y0 * source.width + x1;
        const c = y1 * source.width + x0;
        const d = y1 * source.width + x1;
        const targetIndex = y * target.width + x;
        const wa = (1 - tx) * (1 - ty);
        const wb = tx * (1 - ty);
        const wc = (1 - tx) * ty;
        const wd = tx * ty;
        target.r[targetIndex] += (source.r[a] * wa + source.r[b] * wb + source.r[c] * wc + source.r[d] * wd) * weight;
        target.g[targetIndex] += (source.g[a] * wa + source.g[b] * wb + source.g[c] * wc + source.g[d] * wd) * weight;
        target.b[targetIndex] += (source.b[a] * wa + source.b[b] * wb + source.b[c] * wc + source.b[d] * wd) * weight;
      }
    }
  }

  function sampleLayerRgb(layer, x, y) {
    return [
      sampleBilinear(layer, x, y, layer.r),
      sampleBilinear(layer, x, y, layer.g),
      sampleBilinear(layer, x, y, layer.b)
    ];
  }

  function smoothstep(edge0, edge1, value) {
    const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(0.0001, edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function sampleSourceGate(sourceLayer, x, y, gate, softness) {
    if (!sourceLayer) return 1;
    const r = sampleBilinear(sourceLayer, x, y, sourceLayer.r);
    const g = sampleBilinear(sourceLayer, x, y, sourceLayer.g);
    const b = sampleBilinear(sourceLayer, x, y, sourceLayer.b);
    return smoothstep(gate, gate + softness, Math.max(r, g, b));
  }

  function addGatedDirectionalSample(layer, sourceLayer, x, y, dx, dy, distance, weight, gate, softness, softSourceMix, accum) {
    const ax = x + dx * distance;
    const ay = y + dy * distance;
    const bx = x - dx * distance;
    const by = y - dy * distance;
    const gateA = sampleSourceGate(sourceLayer, ax, ay, gate, softness);
    const gateB = sampleSourceGate(sourceLayer, bx, by, gate, softness);
    const pairGate = Math.max(gateA, gateB);
    const pairWeight = weight * pairGate;
    if (pairWeight <= 0.000001) return 0;
    const sourceA = sampleLayerRgb(sourceLayer || layer, ax, ay);
    const sourceB = sampleLayerRgb(sourceLayer || layer, bx, by);
    const softA = softSourceMix > 0 ? sampleLayerRgb(layer, ax, ay) : sourceA;
    const softB = softSourceMix > 0 ? sampleLayerRgb(layer, bx, by) : sourceB;
    const mixA = gateA * (0.5 + gateA * 0.5);
    const mixB = gateB * (0.5 + gateB * 0.5);
    const a0 = sourceA[0] * (1 - softSourceMix) + softA[0] * softSourceMix;
    const a1 = sourceA[1] * (1 - softSourceMix) + softA[1] * softSourceMix;
    const a2 = sourceA[2] * (1 - softSourceMix) + softA[2] * softSourceMix;
    const b0 = sourceB[0] * (1 - softSourceMix) + softB[0] * softSourceMix;
    const b1 = sourceB[1] * (1 - softSourceMix) + softB[1] * softSourceMix;
    const b2 = sourceB[2] * (1 - softSourceMix) + softB[2] * softSourceMix;
    accum[0] += (a0 * mixA + b0 * mixB) * pairWeight;
    accum[1] += (a1 * mixA + b1 * mixB) * pairWeight;
    accum[2] += (a2 * mixA + b2 * mixB) * pairWeight;
    return pairWeight * 2;
  }

  function applyOpticalShape(layer, sourceLayer, params) {
    const optics = params && params.blur && params.blur.optics;
    const mode = String(optics && optics.mode || "soft");
    const strength = Math.max(0, Number(optics && optics.strength) || 0);
    const length = Math.max(0, Number(optics && optics.length) || 0);
    if (strength <= 0.0001 || length <= 0.5 || (mode !== "starburst" && mode !== "anamorphic")) {
      return layer;
    }

    const out = createLayer(layer.width, layer.height);
    const steps = mode === "anamorphic" ? 28 : 24;
    const sharpness = Math.max(0.7, Number(optics.sharpness) || 1.6);
    const coreMix = Math.max(0.35, Math.min(1, Number(optics.coreMix) || 0.8));
    const verticalTightness = Math.max(0.25, Math.min(1, Number(optics.verticalTightness) || 1));
    const starCount = Math.max(4, Math.min(12, Math.round(Number(optics.starCount) || 6)));
    const rotation = (Number(optics.rotation) || 0) * Math.PI / 180;
    const visibility = Math.max(0, Math.min(1, Number(optics.visibility) || 1));
    const sourceGate = Math.max(0, Math.min(1, Number(optics.sourceGate) || 0));
    const sourceSoftness = mode === "anamorphic"
      ? 0.12 + (0.04 - 0.12) * visibility
      : 0.1 + (0.032 - 0.1) * visibility;
    const softSourceMix = Math.max(0, Math.min(0.35, Number(optics.softSourceMix) || 0));
    const baseVeil = Math.max(0, Math.min(1, Number(optics.baseVeil) || 0));
    const normalization = Math.max(0.18, Math.min(1.4, Number(optics.normalization) || 0.65));
    const maxDistance = Math.max(1, Math.min(Math.max(layer.width, layer.height) * 0.45, length));

    for (let y = 0; y < layer.height; y += 1) {
      for (let x = 0; x < layer.width; x += 1) {
        const index = y * layer.width + x;
        const sourceEnergy = sourceLayer
          ? Math.max(sourceLayer.r[index] || 0, sourceLayer.g[index] || 0, sourceLayer.b[index] || 0)
          : Math.max(layer.r[index] || 0, layer.g[index] || 0, layer.b[index] || 0);
        const localGate = Math.pow(Math.max(0, Math.min(1, sourceEnergy * 1.35)), 0.62);
        const sourceR = sourceLayer ? sourceLayer.r[index] || 0 : layer.r[index] || 0;
        const sourceG = sourceLayer ? sourceLayer.g[index] || 0 : layer.g[index] || 0;
        const sourceB = sourceLayer ? sourceLayer.b[index] || 0 : layer.b[index] || 0;
        const accum = [
          (sourceR * (1 - softSourceMix) + layer.r[index] * softSourceMix) * coreMix,
          (sourceG * (1 - softSourceMix) + layer.g[index] * softSourceMix) * coreMix,
          (sourceB * (1 - softSourceMix) + layer.b[index] * softSourceMix) * coreMix
        ];
        let totalWeight = coreMix;

        for (let step = 1; step <= steps; step += 1) {
          const t = step / steps;
          const distance = t * maxDistance;
          const falloff = Math.pow(1 - t * 0.82, sharpness) * (mode === "anamorphic" ? 0.48 : 0.36);
          if (falloff <= 0.0001) continue;
          if (mode === "starburst") {
            for (let ray = 0; ray < starCount; ray += 1) {
              const angle = rotation + Math.PI * 2 * ray / starCount;
              const axisWeight = ray === 0 ? 1 : (0.48 + 0.2 * Math.abs(Math.cos(angle)));
              totalWeight += addGatedDirectionalSample(
                layer,
                sourceLayer,
                x,
                y,
                Math.cos(angle),
                Math.sin(angle),
                distance * (0.86 + 0.14 * axisWeight),
                falloff * axisWeight,
                sourceGate,
                sourceSoftness,
                softSourceMix,
                accum
              );
            }
          } else {
            totalWeight += addGatedDirectionalSample(layer, sourceLayer, x, y, 1, 0, distance, falloff, sourceGate, sourceSoftness, softSourceMix, accum);
            totalWeight += addGatedDirectionalSample(layer, sourceLayer, x, y, 0, 1, distance * 0.08, falloff * 0.035 * verticalTightness, sourceGate, sourceSoftness, softSourceMix, accum);
          }
        }

        const shapedR = accum[0] / Math.max(0.0001, totalWeight * normalization);
        const shapedG = accum[1] / Math.max(0.0001, totalWeight * normalization);
        const shapedB = accum[2] / Math.max(0.0001, totalWeight * normalization);
        const mix = Math.max(0, Math.min(0.96, strength * (0.5 + localGate * 0.5)));
        const sparkle = mode === "starburst" ? 1 + localGate * strength * 0.18 : 1;
        out.r[index] = layer.r[index] * baseVeil + shapedR * mix * sparkle;
        out.g[index] = layer.g[index] * baseVeil + shapedG * mix * sparkle;
        out.b[index] = layer.b[index] * baseVeil + shapedB * mix * sparkle;
      }
    }
    return out;
  }

  function buildMultiScaleGlow(sourceLayer, params) {
    const radiusRatio = Math.max(0, Math.min(1, Number(params.radius) / 240 || 0));
    const mipCount = Math.max(2, Math.min(7, Math.floor(Number(params.blur.mipCount) || Math.round(3 + radiusRatio * 4))));
    const weights = Array.isArray(params.blur.mipWeights) && params.blur.mipWeights.length
      ? params.blur.mipWeights
      : [0.52, 0.86, 0.72, 0.46, 0.28, 0.16, 0.1];
    const levels = [];
    let current = sourceLayer;

    for (let index = 0; index < mipCount; index += 1) {
      if (current.width <= 1 && current.height <= 1) break;
      current = downsampleLayer(current);
      levels.push(current);
    }

    const effectiveWeights = resolveMipWeights(weights, levels.length);
    let combined = levels.length
      ? scaleLayer(levels[levels.length - 1], effectiveWeights[levels.length - 1])
      : sourceLayer;
    for (let index = levels.length - 2; index >= 0; index -= 1) {
      const upsampled = upsampleLayer(combined, levels[index].width, levels[index].height);
      addLayer(upsampled, levels[index], effectiveWeights[index]);
      combined = upsampled;
    }

    const out = createLayer(sourceLayer.width, sourceLayer.height);
    if (levels.length) {
      addUpsampled(out, combined, params.blur.pyramidWeight || 1);
    }
    return { glowLayer: applyOpticalShape(out, sourceLayer, params), levels: { mips: levels } };
  }

  modules.glowPyramidBlur = {
    createLayer,
    buildMultiScaleGlow
  };
})(window);
