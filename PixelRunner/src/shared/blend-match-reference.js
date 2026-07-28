function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function luma(data, index) {
  return 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
}

function alpha(data, index) {
  return clamp(data[index + 3] / 255, 0, 1);
}

function buildGradient(sample) {
  const { width, height, data } = sample;
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const magnitude = new Float32Array(width * height);
  const at = (x, y) => {
    const safeX = clamp(x, 0, width - 1);
    const safeY = clamp(y, 0, height - 1);
    const index = (safeY * width + safeX) * 4;
    return alpha(data, index) <= 0.02 ? 0 : luma(data, index);
  };
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      gx[index] = -at(x - 1, y - 1) + at(x + 1, y - 1) - 2 * at(x - 1, y) + 2 * at(x + 1, y) - at(x - 1, y + 1) + at(x + 1, y + 1);
      gy[index] = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      magnitude[index] = Math.hypot(gx[index], gy[index]);
    }
  }
  return { gx, gy, magnitude };
}

function estimateStructuralTone(source, reference, sourceGradient, referenceGradient) {
  let sourceSum = 0;
  let referenceSum = 0;
  const sourceRgb = [0, 0, 0];
  const referenceRgb = [0, 0, 0];
  let weight = 0;
  for (let pixel = 0; pixel < source.width * source.height; pixel += 1) {
    const index = pixel * 4;
    const sourceAlpha = alpha(source.data, index);
    const referenceAlpha = alpha(reference.data, index);
    const sourceEdge = sourceGradient.magnitude[pixel];
    const referenceEdge = referenceGradient.magnitude[pixel];
    const edgeAgreement = Math.min(sourceEdge, referenceEdge) / Math.max(1, Math.max(sourceEdge, referenceEdge));
    const currentWeight = sourceAlpha * referenceAlpha * (0.04 + edgeAgreement * 0.96);
    sourceSum += luma(source.data, index) * currentWeight;
    referenceSum += luma(reference.data, index) * currentWeight;
    for (let channel = 0; channel < 3; channel += 1) {
      sourceRgb[channel] += source.data[index + channel] * currentWeight;
      referenceRgb[channel] += reference.data[index + channel] * currentWeight;
    }
    weight += currentWeight;
  }
  const sourceMean = sourceSum / Math.max(1, weight);
  const referenceMean = referenceSum / Math.max(1, weight);
  const gain = clamp(referenceMean / Math.max(1, sourceMean), 0.72, 1.34);
  const offsets = sourceRgb.map((value, channel) => {
    const sourceChannelMean = value / Math.max(1, weight);
    const referenceChannelMean = referenceRgb[channel] / Math.max(1, weight);
    return clamp(referenceChannelMean - sourceChannelMean * gain, -36, 36);
  });
  return { gain, offsets, weight };
}

function softenMask(mask, width, height) {
  const out = new Float32Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = clamp(x + offsetX, 0, width - 1);
          const sampleY = clamp(y + offsetY, 0, height - 1);
          sum += mask[sampleY * width + sampleX];
          count += 1;
        }
      }
      out[y * width + x] = clamp(sum / count, 0, 1);
    }
  }
  return out;
}

export function computeSharedContentReference(source, reference) {
  if (!source || !reference || source.width !== reference.width || source.height !== reference.height) {
    throw new Error("reference-size-mismatch");
  }
  const { width, height } = source;
  const sourceGradient = buildGradient(source);
  const referenceGradient = buildGradient(reference);
  const tone = estimateStructuralTone(source, reference, sourceGradient, referenceGradient);
  const changed = new Float32Array(width * height);
  const residualCue = new Float32Array(width * height);
  const shared = new Float32Array(width * height);
  let alphaMismatchCount = 0;
  let structuralMismatchCount = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 4;
    const sourceAlpha = alpha(source.data, index);
    const referenceAlpha = alpha(reference.data, index);
    const alphaMismatch = Math.abs(sourceAlpha - referenceAlpha) > 0.12;
    const sourceEdge = sourceGradient.magnitude[pixel];
    const referenceEdge = referenceGradient.magnitude[pixel];
    const edge = Math.max(sourceEdge, referenceEdge);
    const edgeAgreement = Math.min(sourceEdge, referenceEdge) / Math.max(1, edge);
    const direction = (sourceGradient.gx[pixel] * referenceGradient.gx[pixel] + sourceGradient.gy[pixel] * referenceGradient.gy[pixel]) / Math.max(1, sourceEdge * referenceEdge);
    const normalizedSource = [0, 1, 2].map((channel) => clamp(source.data[index + channel] * tone.gain + tone.offsets[channel], 0, 255));
    const referenceRgb = [reference.data[index], reference.data[index + 1], reference.data[index + 2]];
    const sourceValue = 0.2126 * normalizedSource[0] + 0.7152 * normalizedSource[1] + 0.0722 * normalizedSource[2];
    const residual = Math.abs(sourceValue - luma(reference.data, index));
    const sourceOpponent = [normalizedSource[0] - normalizedSource[1], normalizedSource[2] - normalizedSource[1]];
    const referenceOpponent = [referenceRgb[0] - referenceRgb[1], referenceRgb[2] - referenceRgb[1]];
    const chromaResidual = Math.hypot(sourceOpponent[0] - referenceOpponent[0], sourceOpponent[1] - referenceOpponent[1]);
    const structuralMismatch = edge > 12 && (edgeAgreement < 0.38 || direction < 0.12);
    const lumaCue = clamp((residual - 12) / 34, 0, 1);
    const colorCue = clamp((chromaResidual - 16) / 52, 0, 1) * 0.86;
    residualCue[pixel] = Math.max(lumaCue, colorCue);
    changed[pixel] = residualCue[pixel] * (structuralMismatch || alphaMismatch ? 1 : 0);
    if (alphaMismatch) alphaMismatchCount += 1;
    if (structuralMismatch) structuralMismatchCount += 1;
  }
  // Multi-scale geodesic growth fills smooth interiors of inserted/replaced
  // objects, but it can only travel through a persistent normalized residual.
  for (const step of [1, 2, 4, 8, 16, 32, 64]) {
    const next = new Float32Array(changed);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        if (residualCue[pixel] < 0.22 || changed[pixel] >= 0.92) continue;
        let support = 0;
        let samples = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (!offsetX && !offsetY) continue;
            const sampleX = x + offsetX * step;
            const sampleY = y + offsetY * step;
            if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) continue;
            support += changed[sampleY * width + sampleX];
            samples += 1;
          }
        }
        const neighbourhood = support / Math.max(1, samples);
        if (neighbourhood > 0.035) next[pixel] = Math.max(changed[pixel], residualCue[pixel] * clamp(neighbourhood * 3.2, 0, 1));
      }
    }
    changed.set(next);
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      let neighbourhoodChanges = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = clamp(x + offsetX, 0, width - 1);
          const sampleY = clamp(y + offsetY, 0, height - 1);
          neighbourhoodChanges += changed[sampleY * width + sampleX] > 0.5 ? 1 : 0;
        }
      }
      const index = pixel * 4;
      const persistentChange = neighbourhoodChanges >= 2 ? clamp(changed[pixel] * 1.5, 0, 1) : 0;
      shared[pixel] = alpha(source.data, index) * alpha(reference.data, index) * (1 - persistentChange);
    }
  }
  const softMask = softenMask(softenMask(shared, width, height), width, height);
  const effectiveWeight = softMask.reduce((sum, value) => sum + value, 0);
  const sharedRatio = effectiveWeight / Math.max(1, softMask.length);
  return {
    width,
    height,
    mask: softMask,
    tone,
    sharedRatio,
    excludedRatio: 1 - sharedRatio,
    effectiveWeight,
    exclusionReasons: [
      alphaMismatchCount > 0 ? "alpha-mismatch" : "",
      structuralMismatchCount > 0 ? "structural-mismatch" : ""
    ].filter(Boolean)
  };
}

export function estimateTranslationReference(source, reference, maxOffset = 8) {
  const sourceGradient = buildGradient(source);
  const referenceGradient = buildGradient(reference);
  const limit = Math.max(0, Math.floor(maxOffset));
  let best = { dx: 0, dy: 0, score: -1, sampleCount: 0 };
  let secondScore = -1;
  for (let dy = -limit; dy <= limit; dy += 1) {
    for (let dx = -limit; dx <= limit; dx += 1) {
      let sum = 0;
      let count = 0;
      for (let y = 1; y < source.height - 1; y += 1) {
        const sourceY = y + dy;
        if (sourceY < 1 || sourceY >= source.height - 1) continue;
        for (let x = 1; x < source.width - 1; x += 1) {
          const sourceX = x + dx;
          if (sourceX < 1 || sourceX >= source.width - 1) continue;
          const sourceIndex = sourceY * source.width + sourceX;
          const referenceIndex = y * reference.width + x;
          const sourceValue = sourceGradient.magnitude[sourceIndex];
          const referenceValue = referenceGradient.magnitude[referenceIndex];
          if (sourceValue < 8 && referenceValue < 8) continue;
          sum += Math.min(sourceValue, referenceValue) / Math.max(1, Math.max(sourceValue, referenceValue));
          count += 1;
        }
      }
      const score = count ? sum / count : -1;
      if (score > best.score) {
        secondScore = best.score;
        best = { dx, dy, score, sampleCount: count };
      } else if (score > secondScore) {
        secondScore = score;
      }
    }
  }
  return { ...best, secondScore, scoreGap: best.score - secondScore, confidence: clamp((best.score - Math.max(0, secondScore)) * 5 + best.score - 0.3, 0, 1) };
}
