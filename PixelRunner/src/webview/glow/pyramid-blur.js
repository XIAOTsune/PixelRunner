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

  function isOpticalMode(mode) {
    return mode === "starburst" || mode === "anamorphic";
  }

  function getOpticalMode(params) {
    const optics = params && params.blur && params.blur.optics;
    const mode = String(optics && optics.mode || "soft");
    return isOpticalMode(mode) ? mode : "soft";
  }

  function getPixelEnergy(layer, index) {
    return Math.max(layer.r[index] || 0, layer.g[index] || 0, layer.b[index] || 0);
  }

  function smoothstep(edge0, edge1, value) {
    const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(0.0001, edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function isLocalPeak(energy, width, height, x, y, index, radius, anisotropicY) {
    const center = energy[index];
    const yRadius = anisotropicY ? Math.max(1, Math.round(radius * 0.55)) : radius;
    for (let yy = Math.max(0, y - yRadius); yy <= Math.min(height - 1, y + yRadius); yy += 1) {
      for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 1) {
        const neighbor = yy * width + xx;
        if (neighbor !== index && energy[neighbor] > center * 1.015) return false;
      }
    }
    return true;
  }

  function getEmitterCount(mode, visibility) {
    const v = Math.max(0, Math.min(1, Number(visibility) || 0));
    if (v <= 0.0001) return 0;
    const maxCount = mode === "anamorphic" ? 54 : 28;
    const curved = Math.pow(v, mode === "anamorphic" ? 1.18 : 1.35);
    return Math.max(1, Math.round(1 + curved * (maxCount - 1)));
  }

  function getSuppressionDistance(mode, length, visibility) {
    const v = Math.max(0, Math.min(1, Number(visibility) || 0));
    const base = mode === "anamorphic" ? 7 : 10;
    const scale = mode === "anamorphic" ? 0.07 : 0.105;
    return Math.max(base, Math.min(mode === "anamorphic" ? 32 : 42, length * scale * (1.12 - v * 0.34)));
  }

  function selectOpticalEmitters(sourceLayer, params) {
    const mode = getOpticalMode(params);
    if (!isOpticalMode(mode) || !sourceLayer) return [];
    const optics = params && params.blur && params.blur.optics || {};
    const visibility = Math.max(0, Math.min(1, Number(optics.visibility) || 0));
    const maxEmitters = getEmitterCount(mode, visibility);
    if (maxEmitters <= 0) return [];

    const width = sourceLayer.width;
    const height = sourceLayer.height;
    const total = width * height;
    const thresholdRatio = Math.max(0, Math.min(1, Number(params && params.threshold) / 100 || 0));
    const length = Math.max(1, Number(optics.length) || 1);
    const energy = new Float32Array(total);
    let maxEnergy = 0;
    let energySum = 0;
    let activeCount = 0;

    for (let index = 0; index < total; index += 1) {
      const value = getPixelEnergy(sourceLayer, index);
      energy[index] = value;
      if (value > maxEnergy) maxEnergy = value;
      if (value > 0.0001) {
        energySum += value;
        activeCount += 1;
      }
    }
    if (maxEnergy <= 0.0001) return [];

    const activeMean = activeCount > 0 ? energySum / activeCount : 0;
    const adaptiveGate = maxEnergy * (mode === "anamorphic"
      ? 0.12 + thresholdRatio * 0.52
      : 0.16 + thresholdRatio * 0.58);
    const meanGate = activeMean * (mode === "anamorphic"
      ? 0.32 + thresholdRatio * 1.42
      : 0.38 + thresholdRatio * 1.62);
    const floorGate = mode === "anamorphic"
      ? 0.006 + thresholdRatio * 0.045
      : 0.008 + thresholdRatio * 0.056;
    const gate = Math.min(maxEnergy * (0.94 - thresholdRatio * 0.02), Math.max(floorGate, adaptiveGate, meanGate));
    const peakRadius = thresholdRatio > 0.66 ? 2 : 1;
    const candidates = [];

    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        const index = row + x;
        const value = energy[index];
        if (value < gate) continue;
        if (!isLocalPeak(energy, width, height, x, y, index, peakRadius, mode === "anamorphic")) continue;
        const colorSum = sourceLayer.r[index] + sourceLayer.g[index] + sourceLayer.b[index];
        const score = value * 0.82 + colorSum * 0.06 + smoothstep(gate, maxEnergy, value) * 0.12;
        candidates.push({
          x,
          y,
          r: sourceLayer.r[index],
          g: sourceLayer.g[index],
          b: sourceLayer.b[index],
          energy: value,
          score
        });
      }
    }
    if (!candidates.length) return [];

    candidates.sort((left, right) => right.score - left.score);
    const minDistance = getSuppressionDistance(mode, length, visibility);
    const minDistanceSq = minDistance * minDistance;
    const kept = [];
    for (let index = 0; index < candidates.length && kept.length < maxEmitters; index += 1) {
      const candidate = candidates[index];
      let blocked = false;
      for (let keptIndex = 0; keptIndex < kept.length; keptIndex += 1) {
        const item = kept[keptIndex];
        const dx = candidate.x - item.x;
        const dy = candidate.y - item.y;
        const distanceSq = mode === "anamorphic"
          ? dx * dx * 0.18 + dy * dy * 1.9
          : dx * dx + dy * dy;
        if (distanceSq < minDistanceSq) {
          blocked = true;
          break;
        }
      }
      if (!blocked) kept.push(candidate);
    }
    return kept;
  }

  function splatDisc(target, emitter, radius, gain) {
    const safeRadius = Math.max(0.75, radius);
    const sigma = Math.max(0.45, safeRadius * 0.48);
    const radiusCeil = Math.ceil(safeRadius * 2.1);
    for (let yy = Math.max(0, Math.floor(emitter.y - radiusCeil)); yy <= Math.min(target.height - 1, Math.ceil(emitter.y + radiusCeil)); yy += 1) {
      for (let xx = Math.max(0, Math.floor(emitter.x - radiusCeil)); xx <= Math.min(target.width - 1, Math.ceil(emitter.x + radiusCeil)); xx += 1) {
        const dx = xx - emitter.x;
        const dy = yy - emitter.y;
        const weight = Math.exp(-(dx * dx + dy * dy) / Math.max(0.0001, 2 * sigma * sigma)) * gain;
        const index = yy * target.width + xx;
        target.r[index] += emitter.r * weight;
        target.g[index] += emitter.g * weight;
        target.b[index] += emitter.b * weight;
      }
    }
  }

  function buildOpticalEmitterLayer(sourceLayer, params) {
    const mode = getOpticalMode(params);
    if (!isOpticalMode(mode)) return { layer: sourceLayer, emitters: [] };
    const optics = params && params.blur && params.blur.optics || {};
    const emitters = selectOpticalEmitters(sourceLayer, params);
    const out = createLayer(sourceLayer.width, sourceLayer.height);
    const length = Math.max(1, Number(optics.length) || 1);
    const thresholdRatio = Math.max(0, Math.min(1, Number(params && params.threshold) / 100 || 0));
    const radius = mode === "anamorphic"
      ? Math.max(1.25, Math.min(3.8, 1.6 + length / 210 + (1 - thresholdRatio) * 0.45))
      : Math.max(1.35, Math.min(4.2, 1.7 + length / 170 + (1 - thresholdRatio) * 0.38));
    const gain = mode === "anamorphic" ? 1.14 : 1.04;
    for (let index = 0; index < emitters.length; index += 1) {
      splatDisc(out, emitters[index], radius, gain);
    }
    const softened = emitters.length ? kawaseBlurLayer(out, mode === "anamorphic" ? 1.35 : 1.15) : out;
    return { layer: softened, emitters };
  }

  function addLinePoint(target, x, y, emitter, weight, width) {
    const safeWidth = Math.max(0.55, width);
    const radius = Math.ceil(safeWidth * 1.7);
    const sigma = Math.max(0.35, safeWidth * 0.62);
    for (let yy = Math.max(0, Math.floor(y - radius)); yy <= Math.min(target.height - 1, Math.ceil(y + radius)); yy += 1) {
      for (let xx = Math.max(0, Math.floor(x - radius)); xx <= Math.min(target.width - 1, Math.ceil(x + radius)); xx += 1) {
        const dx = xx - x;
        const dy = yy - y;
        const disc = Math.exp(-(dx * dx + dy * dy) / Math.max(0.0001, 2 * sigma * sigma));
        const amount = weight * disc;
        const index = yy * target.width + xx;
        target.r[index] += emitter.r * amount;
        target.g[index] += emitter.g * amount;
        target.b[index] += emitter.b * amount;
      }
    }
  }

  function renderOpticalShapeFromEmitters(baseLayer, opticalSource, emitters, params) {
    const optics = params && params.blur && params.blur.optics || {};
    const mode = getOpticalMode(params);
    const strength = Math.max(0, Number(optics.strength) || 0);
    const length = Math.max(0, Number(optics.length) || 0);
    if (!isOpticalMode(mode) || strength <= 0.0001 || length <= 0.5 || !emitters.length) {
      return baseLayer;
    }

    const out = createLayer(baseLayer.width, baseLayer.height);
    const maxDistance = Math.max(1, Math.min(Math.max(baseLayer.width, baseLayer.height) * 0.46, length));
    const sharpness = Math.max(0.8, Number(optics.sharpness) || (mode === "anamorphic" ? 2.0 : 1.6));
    const starCount = Math.max(4, Math.min(12, Math.round(Number(optics.starCount) || 6)));
    const rotation = (Number(optics.rotation) || 0) * Math.PI / 180;
    const coreMix = Math.max(0, Math.min(1, Number(optics.coreMix) || 0.55));
    const baseVeil = Math.max(0, Math.min(1, Number(optics.baseVeil) || 0));
    const lineStep = mode === "anamorphic" ? 1.55 : 1.25;
    const steps = Math.max(8, Math.min(240, Math.ceil(maxDistance / lineStep)));
    const lineWidth = mode === "anamorphic"
      ? Math.max(0.75, Math.min(2.4, 0.85 + maxDistance / 260))
      : Math.max(0.65, Math.min(2.2, 0.78 + maxDistance / 220));
    const energyGain = strength * (mode === "anamorphic" ? 0.135 : 0.105);

    if (baseVeil > 0) {
      addLayer(out, baseLayer, baseVeil);
    }

    for (let index = 0; index < emitters.length; index += 1) {
      const emitter = emitters[index];
      const sourceBoost = 0.82 + Math.min(1.4, emitter.energy * 1.6);
      const coreRadius = mode === "anamorphic" ? lineWidth * 1.25 : lineWidth * 1.45;
      splatDisc(out, emitter, coreRadius, coreMix * energyGain * sourceBoost * 2.2);

      if (mode === "starburst") {
        for (let ray = 0; ray < starCount; ray += 1) {
          const angle = rotation + Math.PI * 2 * ray / starCount;
          const dx = Math.cos(angle);
          const dy = Math.sin(angle);
          const axisWeight = ray === 0 ? 1 : (0.54 + 0.22 * Math.abs(Math.cos(angle)));
          for (let step = 1; step <= steps; step += 1) {
            const t = step / steps;
            const distance = t * maxDistance * (0.9 + axisWeight * 0.1);
            const taper = Math.pow(Math.max(0, 1 - t * 0.9), sharpness);
            const nearFade = smoothstep(0, 0.06, t);
            const weight = taper * nearFade * axisWeight * energyGain * sourceBoost / Math.max(1, starCount * 0.42);
            if (weight <= 0.000004) continue;
            addLinePoint(out, emitter.x + dx * distance, emitter.y + dy * distance, emitter, weight, lineWidth * (1 - t * 0.28));
          }
        }
      } else {
        const verticalTightness = Math.max(0.25, Math.min(1, Number(optics.verticalTightness) || 0.36));
        for (let step = 1; step <= steps; step += 1) {
          const t = step / steps;
          const distance = t * maxDistance;
          const taper = Math.pow(Math.max(0, 1 - t * 0.88), sharpness);
          const nearFade = smoothstep(0, 0.045, t);
          const weight = taper * nearFade * energyGain * sourceBoost * 0.92;
          if (weight <= 0.000004) continue;
          const width = lineWidth * (1.15 - t * 0.34) * verticalTightness;
          addLinePoint(out, emitter.x + distance, emitter.y, emitter, weight, width);
          addLinePoint(out, emitter.x - distance, emitter.y, emitter, weight, width);
        }
      }
    }

    if (opticalSource && coreMix > 0) {
      addLayer(out, opticalSource, coreMix * energyGain * 0.72);
    }
    return out;
  }

  function applyOpticalShape(layer, sourceLayer, params) {
    const mode = getOpticalMode(params);
    if (!isOpticalMode(mode)) return layer;
    const opticalSource = buildOpticalEmitterLayer(sourceLayer, params);
    return renderOpticalShapeFromEmitters(layer, opticalSource.layer, opticalSource.emitters, params);
  }

  function buildMultiScaleGlow(sourceLayer, params) {
    const mode = getOpticalMode(params);
    const opticalSource = isOpticalMode(mode) ? buildOpticalEmitterLayer(sourceLayer, params) : null;
    const blurSource = opticalSource ? opticalSource.layer : sourceLayer;
    const radiusRatio = Math.max(0, Math.min(1, Number(params.radius) / 240 || 0));
    const mipCount = Math.max(2, Math.min(7, Math.floor(Number(params.blur.mipCount) || Math.round(3 + radiusRatio * 4))));
    const weights = Array.isArray(params.blur.mipWeights) && params.blur.mipWeights.length
      ? params.blur.mipWeights
      : [0.52, 0.86, 0.72, 0.46, 0.28, 0.16, 0.1];
    const levels = [];
    let current = blurSource;

    for (let index = 0; index < mipCount; index += 1) {
      if (current.width <= 1 && current.height <= 1) break;
      current = downsampleLayer(current);
      levels.push(current);
    }

    const effectiveWeights = resolveMipWeights(weights, levels.length);
    let combined = levels.length
      ? scaleLayer(levels[levels.length - 1], effectiveWeights[levels.length - 1])
      : blurSource;
    for (let index = levels.length - 2; index >= 0; index -= 1) {
      const upsampled = upsampleLayer(combined, levels[index].width, levels[index].height);
      addLayer(upsampled, levels[index], effectiveWeights[index]);
      combined = upsampled;
    }

    const out = createLayer(blurSource.width, blurSource.height);
    if (levels.length) {
      addUpsampled(out, combined, params.blur.pyramidWeight || 1);
    }
    const glowLayer = opticalSource
      ? renderOpticalShapeFromEmitters(out, opticalSource.layer, opticalSource.emitters, params)
      : applyOpticalShape(out, blurSource, params);
    return { glowLayer, levels: { mips: levels, emitters: opticalSource ? opticalSource.emitters.length : 0 } };
  }

  modules.glowPyramidBlur = {
    createLayer,
    buildOpticalEmitterLayer,
    buildMultiScaleGlow
  };
})(window);
