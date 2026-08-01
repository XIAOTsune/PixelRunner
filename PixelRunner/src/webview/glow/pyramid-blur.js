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

  function resolveMipWeights(weights, count, lastMipMix = 1) {
    const out = [];
    const fallback = weights.length ? Math.max(0, Number(weights[weights.length - 1]) || 0) : 0.2;
    const finalMix = Math.max(0, Math.min(1, Number(lastMipMix) || 0));
    let total = 0;
    for (let index = 0; index < count; index += 1) {
      const value = Math.max(0, Number(weights[index]) || fallback) * (index === count - 1 ? finalMix : 1);
      out.push(value);
      total += value;
    }
    if (total <= 0.0001) return out.map(() => 1);
    const energyScale = Math.min(1.35, Math.max(0.75, total));
    const effectiveCount = Math.max(1, count - 1 + finalMix);
    const normalize = effectiveCount * energyScale / total;
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

  function hash01(x, y, salt = 0) {
    const seed = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
    return seed - Math.floor(seed);
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function getOpticalEnergyThreshold(sourceLayer, optics, visibility, maxEnergy, activeMean) {
    const sourceGate = clamp01(optics.sourceGate);
    const densityGate = clamp01(optics.densityGate);
    const open = Math.pow(clamp01(visibility), 0.82);
    const relativeGate = maxEnergy * Math.max(sourceGate, densityGate * 0.72);
    const meanGate = activeMean * (0.72 + (1 - open) * 1.45 + densityGate * 1.4);
    return Math.min(maxEnergy * 0.985, Math.max(0.0006, relativeGate, meanGate));
  }

  function isLocalMaximum(sourceLayer, x, y, energy, radius) {
    const width = sourceLayer.width;
    const height = sourceLayer.height;
    const x0 = Math.max(0, x - radius);
    const x1 = Math.min(width - 1, x + radius);
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let yy = y0; yy <= y1; yy += 1) {
      for (let xx = x0; xx <= x1; xx += 1) {
        if (xx === x && yy === y) continue;
        const neighbor = getPixelEnergy(sourceLayer, yy * width + xx);
        if (neighbor > energy * 1.002) return false;
      }
    }
    return true;
  }

  function collectOpticalCandidates(sourceLayer, optics, visibility, maxEnergy, activeMean) {
    const width = sourceLayer.width;
    const height = sourceLayer.height;
    const gate = getOpticalEnergyThreshold(sourceLayer, optics, visibility, maxEnergy, activeMean);
    const sourceSoftness = Math.max(0.006, Math.min(0.24, Number(optics.sourceGateSoftness) || 0.08));
    const softness = Math.max(0.0025, Math.min(0.22, sourceSoftness * Math.max(0.24, maxEnergy)));
    const localRadius = Math.max(1, Math.min(3, Math.round(Math.min(width, height) / 900) + 1));
    const candidates = [];
    const longEdge = Math.max(width, height);
    const tileSize = Math.max(5, Math.min(18, Math.round(longEdge / 240)));

    for (let tileY = 0; tileY < height; tileY += tileSize) {
      for (let tileX = 0; tileX < width; tileX += tileSize) {
        const xStart = tileX;
        const yStart = tileY;
        const xEnd = Math.min(width, tileX + tileSize);
        const yEnd = Math.min(height, tileY + tileSize);
        let best = null;
        for (let y = yStart; y < yEnd; y += 1) {
          for (let x = xStart; x < xEnd; x += 1) {
            const index = y * width + x;
            const energy = getPixelEnergy(sourceLayer, index);
            const gateValue = smoothstep(gate, gate + softness, energy);
            if (gateValue <= 0.0001) continue;
            const blueNoise = hash01(x, y, 91);
            const score = energy * (0.88 + gateValue * 0.18) * (0.94 + blueNoise * 0.12);
            if (!best || score > best.score) {
              best = { x, y, index, energy, gate: gateValue, score };
            }
          }
        }
        if (best && isLocalMaximum(sourceLayer, best.x, best.y, best.energy, localRadius)) {
          candidates.push(best);
        }
      }
    }

    if (candidates.length < 12) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          const energy = getPixelEnergy(sourceLayer, index);
          const gateValue = smoothstep(gate, gate + softness, energy);
          if (gateValue <= 0.0001) continue;
          if (!isLocalMaximum(sourceLayer, x, y, energy, localRadius)) continue;
          const blueNoise = hash01(x, y, 91);
          const score = energy * (0.88 + gateValue * 0.18) * (0.94 + blueNoise * 0.12);
          candidates.push({ x, y, index, energy, gate: gateValue, score });
        }
      }
    }

    if (!candidates.length) {
      const stride = Math.max(1, Math.round(Math.min(width, height) / 180));
      for (let y = 0; y < height; y += stride) {
        for (let x = 0; x < width; x += stride) {
          const index = y * width + x;
          const energy = getPixelEnergy(sourceLayer, index);
          const gateValue = smoothstep(gate * 0.82, gate + softness * 1.4, energy);
          if (gateValue <= 0.0001) continue;
          candidates.push({
            x,
            y,
            index,
            energy,
            gate: gateValue,
            score: energy * (0.9 + hash01(x, y, 103) * 0.1)
          });
        }
      }
    }

    candidates.sort((left, right) => right.score - left.score);
    return { candidates, gate, softness };
  }

  function selectOpticalCandidates(sourceLayer, optics, visibility, maxEnergy, activeMean) {
    const width = sourceLayer.width;
    const height = sourceLayer.height;
    const { candidates } = collectOpticalCandidates(sourceLayer, optics, visibility, maxEnergy, activeMean);
    if (!candidates.length) return [];

    const longEdge = Math.max(width, height);
    const scale = longEdge / 1200;
    const targetCount = Math.max(
      1,
      Math.min(
        candidates.length,
        Math.round((Number(optics.candidateCount) || 120) * Math.max(0.34, scale * scale))
      )
    );
    let radius = Math.max(3, Number(optics.suppressionRadius) || 18) * Math.max(0.42, Math.sqrt(scale));
    const minRadius = Math.max(2, radius * 0.35);
    let selected = [];

    for (let attempt = 0; attempt < 4 && selected.length < targetCount; attempt += 1) {
      selected = [];
      const cellSize = Math.max(2, radius);
      const gridWidth = Math.max(1, Math.ceil(width / cellSize));
      const gridHeight = Math.max(1, Math.ceil(height / cellSize));
      const occupied = new Int32Array(gridWidth * gridHeight);
      occupied.fill(-1);
      const radiusSq = radius * radius;

      for (let index = 0; index < candidates.length && selected.length < targetCount; index += 1) {
        const candidate = candidates[index];
        const cellX = Math.max(0, Math.min(gridWidth - 1, Math.floor(candidate.x / cellSize)));
        const cellY = Math.max(0, Math.min(gridHeight - 1, Math.floor(candidate.y / cellSize)));
        let blocked = false;
        for (let yy = Math.max(0, cellY - 2); yy <= Math.min(gridHeight - 1, cellY + 2) && !blocked; yy += 1) {
          for (let xx = Math.max(0, cellX - 2); xx <= Math.min(gridWidth - 1, cellX + 2); xx += 1) {
            const selectedIndex = occupied[yy * gridWidth + xx];
            if (selectedIndex < 0) continue;
            const picked = selected[selectedIndex];
            const dx = candidate.x - picked.x;
            const dy = candidate.y - picked.y;
            if (dx * dx + dy * dy < radiusSq) {
              blocked = true;
              break;
            }
          }
        }
        if (blocked) continue;
        occupied[cellY * gridWidth + cellX] = selected.length;
        selected.push(candidate);
      }

      radius = Math.max(minRadius, radius * 0.72);
    }

    return selected.length ? selected : candidates.slice(0, targetCount);
  }

  function splatOpticalCandidate(out, sourceLayer, candidate, radius, gain) {
    const width = out.width;
    const height = out.height;
    const x0 = Math.max(0, Math.floor(candidate.x - radius));
    const x1 = Math.min(width - 1, Math.ceil(candidate.x + radius));
    const y0 = Math.max(0, Math.floor(candidate.y - radius));
    const y1 = Math.min(height - 1, Math.ceil(candidate.y + radius));
    const radiusSq = Math.max(0.0001, radius * radius);
    const sourceR = sourceLayer.r[candidate.index] || 0;
    const sourceG = sourceLayer.g[candidate.index] || 0;
    const sourceB = sourceLayer.b[candidate.index] || 0;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x - candidate.x;
        const dy = y - candidate.y;
        const normalized = (dx * dx + dy * dy) / radiusSq;
        if (normalized > 1) continue;
        const falloff = Math.pow(1 - normalized, 2.2);
        const weight = falloff * gain * (0.72 + candidate.gate * 0.28);
        const index = y * width + x;
        out.r[index] += sourceR * weight;
        out.g[index] += sourceG * weight;
        out.b[index] += sourceB * weight;
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

  function sampleSourceGate(sourceLayer, x, y, gate, softness) {
    if (!sourceLayer) return 1;
    const energy = Math.max(
      sampleBilinear(sourceLayer, x, y, sourceLayer.r),
      sampleBilinear(sourceLayer, x, y, sourceLayer.g),
      sampleBilinear(sourceLayer, x, y, sourceLayer.b)
    );
    return smoothstep(gate, gate + softness, energy);
  }

  function addGatedDirectionalSample(layer, sourceLayer, x, y, dx, dy, distance, weight, gate, softness, spread, accum) {
    const px = -dy;
    const py = dx;
    const taps = [
      [0, 1],
      [-spread, 0.36],
      [spread, 0.36]
    ];
    let totalWeight = 0;
    for (let tapIndex = 0; tapIndex < taps.length; tapIndex += 1) {
      const offset = taps[tapIndex][0];
      const tapWeight = taps[tapIndex][1];
      for (let side = -1; side <= 1; side += 2) {
        const sx = x + dx * distance * side + px * offset;
        const sy = y + dy * distance * side + py * offset;
        const gateValue = sampleSourceGate(sourceLayer, sx, sy, gate, softness);
        const shapedGate = gateValue * (0.16 + gateValue * 0.84);
        const localWeight = weight * tapWeight * shapedGate;
        if (localWeight <= 0.000001) continue;
        const sample = sampleLayerRgb(layer, sx, sy);
        accum[0] += sample[0] * localWeight;
        accum[1] += sample[1] * localWeight;
        accum[2] += sample[2] * localWeight;
        totalWeight += localWeight;
      }
    }
    return totalWeight;
  }

  function buildOpticalSourceLayer(sourceLayer, params) {
    const mode = getOpticalMode(params);
    if (!isOpticalMode(mode) || !sourceLayer) return { layer: sourceLayer, activeRatio: 1 };
    const optics = params && params.blur && params.blur.optics || {};
    const visibility = Math.max(0, Math.min(1, Number(optics.visibility) || 0));
    const out = createLayer(sourceLayer.width, sourceLayer.height);
    if (visibility <= 0.0001) return { layer: out, activeRatio: 0 };

    let maxEnergy = 0;
    let activeSum = 0;
    let activeCount = 0;
    for (let index = 0; index < sourceLayer.r.length; index += 1) {
      const energy = getPixelEnergy(sourceLayer, index);
      if (energy > maxEnergy) maxEnergy = energy;
      if (energy > 0.0001) {
        activeSum += energy;
        activeCount += 1;
      }
    }
    if (maxEnergy <= 0.0001) return { layer: out, activeRatio: 0 };

    const activeMean = activeCount > 0 ? activeSum / activeCount : 0;
    const selected = selectOpticalCandidates(sourceLayer, optics, visibility, maxEnergy, activeMean);
    const longEdge = Math.max(sourceLayer.width, sourceLayer.height);
    const baseSplatRadius = Math.max(
      mode === "anamorphic" ? 1.6 : 1.35,
      Math.min(mode === "anamorphic" ? 5.2 : 4.6, longEdge / (mode === "anamorphic" ? 520 : 620))
    );
    const candidateBlend = Math.max(0, Math.min(0.42, Number(optics.candidateBlend) || 0.22));
    for (let index = 0; index < selected.length; index += 1) {
      const candidate = selected[index];
      const localGain = Math.pow(Math.max(0, candidate.gate), 0.72) * (0.74 + Math.min(1, candidate.energy / Math.max(0.0001, maxEnergy)) * 0.26);
      const radius = baseSplatRadius * (0.82 + hash01(candidate.x, candidate.y, 131) * 0.36);
      splatOpticalCandidate(out, sourceLayer, candidate, radius, localGain);

      if (candidateBlend > 0) {
        const indexAtCandidate = candidate.index;
        out.r[indexAtCandidate] += sourceLayer.r[indexAtCandidate] * candidateBlend * localGain;
        out.g[indexAtCandidate] += sourceLayer.g[indexAtCandidate] * candidateBlend * localGain;
        out.b[indexAtCandidate] += sourceLayer.b[indexAtCandidate] * candidateBlend * localGain;
      }
    }

    const softened = kawaseBlurLayer(out, mode === "anamorphic" ? 1.35 : 1.15);
    const softMix = Math.max(0, Math.min(0.48, 0.12 + (Number(optics.softSourceMix) || 0) * 3.4));
    for (let index = 0; index < out.r.length; index += 1) {
      out.r[index] = out.r[index] * (1 - softMix) + softened.r[index] * softMix;
      out.g[index] = out.g[index] * (1 - softMix) + softened.g[index] * softMix;
      out.b[index] = out.b[index] * (1 - softMix) + softened.b[index] * softMix;
    }
    return { layer: out, activeRatio: selected.length / Math.max(1, out.r.length), candidateCount: selected.length };
  }

  function buildOpticalEmitterLayer(sourceLayer, params) {
    const mode = getOpticalMode(params);
    if (!isOpticalMode(mode)) return { layer: sourceLayer, emitters: [], activeRatio: 1 };
    const opticalSource = buildOpticalSourceLayer(sourceLayer, params);
    return { layer: opticalSource.layer, emitters: [], activeRatio: opticalSource.activeRatio };
  }

  function applyOpticalShape(layer, sourceLayer, params) {
    const optics = params && params.blur && params.blur.optics || {};
    const mode = getOpticalMode(params);
    const strength = Math.max(0, Number(optics.strength) || 0);
    const length = Math.max(0, Number(optics.length) || 0);
    const visibility = Math.max(0, Math.min(1, Number(optics.visibility) || 0));
    if (!isOpticalMode(mode) || strength <= 0.0001 || length <= 0.5 || visibility <= 0.0001) {
      return layer;
    }

    const out = createLayer(layer.width, layer.height);
    const maxDistance = Math.max(1, Math.min(Math.max(layer.width, layer.height) * 0.46, length));
    const sharpness = Math.max(0.75, Number(optics.sharpness) || (mode === "anamorphic" ? 2.1 : 1.7));
    const coreMix = Math.max(0.08, Math.min(0.82, Number(optics.coreMix) || 0.35));
    const sourceCoreMix = Math.max(0, Math.min(0.42, Number(optics.softSourceMix) || 0.05));
    const verticalTightness = Math.max(0.18, Math.min(1, Number(optics.verticalTightness) || 0.55));
    const starCount = Math.max(4, Math.min(12, Math.round(Number(optics.starCount) || 6)));
    const rotation = (Number(optics.rotation) || 0) * Math.PI / 180;
    const sourceGate = Math.max(0, Math.min(1, Number(optics.sourceGate) || 0));
    const sourceSoftness = Math.max(0.01, Math.min(0.24, Number(optics.sourceGateSoftness) || (0.13 + (1 - visibility) * 0.08)));
    const baseVeil = Math.max(0, Math.min(0.28, Number(optics.baseVeil) || 0));
    const normalization = Math.max(0.22, Math.min(1.35, Number(optics.normalization) || 0.7));
    const stepSize = mode === "anamorphic" ? 7.2 : 8.4;
    const maxSteps = mode === "anamorphic" ? 42 : 30;
    const minSteps = mode === "anamorphic" ? 18 : 14;
    const steps = Math.max(minSteps, Math.min(maxSteps, Math.ceil(maxDistance / stepSize)));
    const spread = mode === "anamorphic"
      ? Math.max(0.65, Math.min(2.4, 0.86 + maxDistance / 210))
      : Math.max(0.55, Math.min(2.0, 0.68 + maxDistance / 260));

    for (let y = 0; y < layer.height; y += 1) {
      for (let x = 0; x < layer.width; x += 1) {
        const index = y * layer.width + x;
        const sourceEnergy = sourceLayer
          ? Math.max(sourceLayer.r[index] || 0, sourceLayer.g[index] || 0, sourceLayer.b[index] || 0)
          : Math.max(layer.r[index] || 0, layer.g[index] || 0, layer.b[index] || 0);
        const localGate = Math.pow(Math.max(0, Math.min(1, Math.max(sourceEnergy, sampleSourceGate(sourceLayer, x, y, sourceGate, sourceSoftness)) * 1.25)), 0.68);
        const sourceMix = sourceCoreMix * (0.45 + localGate * 0.55);
        const accum = [
          layer.r[index] * coreMix + (sourceLayer ? sourceLayer.r[index] * sourceMix : 0),
          layer.g[index] * coreMix + (sourceLayer ? sourceLayer.g[index] * sourceMix : 0),
          layer.b[index] * coreMix + (sourceLayer ? sourceLayer.b[index] * sourceMix : 0)
        ];
        let totalWeight = coreMix + sourceMix;

        for (let step = 1; step <= steps; step += 1) {
          const t = step / steps;
          const distance = t * maxDistance;
          const shoulder = Math.exp(-t * (mode === "anamorphic" ? 2.36 : 2.02));
          const tail = Math.pow(Math.max(0, 1 - t), mode === "anamorphic" ? 2.18 + sharpness * 0.18 : 1.72 + sharpness * 0.22);
          const ridge = mode === "anamorphic" ? 0.58 + 0.42 * Math.exp(-t * 9.4) : 0.62 + 0.38 * Math.exp(-t * 8.2);
          const nearFade = smoothstep(0, mode === "anamorphic" ? 0.032 : 0.04, t);
          const falloff = (shoulder * 0.58 + tail * 0.42) * ridge * nearFade * (mode === "anamorphic" ? 0.34 : 0.27);
          if (falloff <= 0.000001) continue;

          if (mode === "anamorphic") {
            totalWeight += addGatedDirectionalSample(layer, sourceLayer, x, y, 1, 0, distance, falloff, sourceGate, sourceSoftness, spread, accum);
            totalWeight += addGatedDirectionalSample(layer, sourceLayer, x, y, 0, 1, distance * 0.055, falloff * 0.018 * verticalTightness, sourceGate, sourceSoftness, spread * 0.75, accum);
          } else {
            for (let ray = 0; ray < starCount; ray += 1) {
              const rayJitter = (hash01(ray, starCount, 23) - 0.5) * 0.026;
              const angle = rotation + Math.PI * 2 * ray / starCount + rayJitter;
              const axisWeight = (ray === 0 || (starCount % 2 === 0 && ray === starCount / 2))
                ? 1
                : (0.34 + 0.28 * Math.abs(Math.cos(angle)));
              const rayScale = 0.82 + hash01(ray, starCount, 41) * 0.2;
              totalWeight += addGatedDirectionalSample(
                layer,
                sourceLayer,
                x,
                y,
                Math.cos(angle),
                Math.sin(angle),
                distance * rayScale,
                falloff * axisWeight,
                sourceGate,
                sourceSoftness,
                spread,
                accum
              );
            }
          }
        }

        const shapedR = accum[0] / Math.max(0.0001, totalWeight * normalization);
        const shapedG = accum[1] / Math.max(0.0001, totalWeight * normalization);
        const shapedB = accum[2] / Math.max(0.0001, totalWeight * normalization);
        const mix = Math.max(0, Math.min(0.82, strength * (0.3 + localGate * 0.48)));
        const sparkle = mode === "starburst" ? 1 + localGate * strength * 0.08 : 1;
        const aura = mode === "anamorphic" ? 0.16 : 0.2;
        out.r[index] = layer.r[index] * (baseVeil + aura * strength) + shapedR * mix * sparkle;
        out.g[index] = layer.g[index] * (baseVeil + aura * strength) + shapedG * mix * sparkle;
        out.b[index] = layer.b[index] * (baseVeil + aura * strength) + shapedB * mix * sparkle;
      }
    }
    return out;
  }

  function buildMultiScaleGlow(sourceLayer, params) {
    const mode = getOpticalMode(params);
    const opticalSource = isOpticalMode(mode) ? buildOpticalSourceLayer(sourceLayer, params) : null;
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

    const effectiveWeights = resolveMipWeights(
      weights,
      levels.length,
      levels.length === mipCount ? params.blur.lastMipMix : 1
    );
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
      ? applyOpticalShape(out, opticalSource.layer, params)
      : applyOpticalShape(out, blurSource, params);
    return { glowLayer, levels: { mips: levels, activeRatio: opticalSource ? opticalSource.activeRatio : 1 } };
  }

  modules.glowPyramidBlur = {
    createLayer,
    buildOpticalSourceLayer,
    buildOpticalEmitterLayer,
    buildMultiScaleGlow
  };
})(window);
