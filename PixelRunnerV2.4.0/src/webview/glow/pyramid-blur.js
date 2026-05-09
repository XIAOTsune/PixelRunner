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
    for (let y = 0; y < nextHeight; y += 1) {
      for (let x = 0; x < nextWidth; x += 1) {
        const sx = x * 2;
        const sy = y * 2;
        const target = y * nextWidth + x;
        let r = 0;
        let g = 0;
        let b = 0;
        let weightTotal = 0;
        for (let oy = -1; oy <= 2; oy += 1) {
          const yy = Math.min(layer.height - 1, Math.max(0, sy + oy));
          const wy = oy === 0 || oy === 1 ? 3 : 1;
          for (let ox = -1; ox <= 2; ox += 1) {
            const xx = Math.min(layer.width - 1, Math.max(0, sx + ox));
            const wx = ox === 0 || ox === 1 ? 3 : 1;
            const weight = wx * wy;
            const source = yy * layer.width + xx;
            r += layer.r[source] * weight;
            g += layer.g[source] * weight;
            b += layer.b[source] * weight;
            weightTotal += weight;
          }
        }
        out.r[target] = r / weightTotal;
        out.g[target] = g / weightTotal;
        out.b[target] = b / weightTotal;
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
    for (let y = 0; y < height; y += 1) {
      const sy = (y + 0.5) * yScale - 0.5;
      for (let x = 0; x < width; x += 1) {
        const sx = (x + 0.5) * xScale - 0.5;
        const target = y * width + x;
        out.r[target] = sampleBilinear(source, sx, sy, source.r);
        out.g[target] = sampleBilinear(source, sx, sy, source.g);
        out.b[target] = sampleBilinear(source, sx, sy, source.b);
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

  function buildMultiScaleGlow(sourceLayer, params) {
    const radiusRatio = Math.max(0, Math.min(1, Number(params.radius) / 120 || 0));
    const mipCount = Math.max(2, Math.min(6, Math.floor(Number(params.blur.mipCount) || Math.round(3 + radiusRatio * 3))));
    const weights = Array.isArray(params.blur.mipWeights) && params.blur.mipWeights.length
      ? params.blur.mipWeights
      : [0.52, 0.86, 0.72, 0.46, 0.28, 0.16];
    const levels = [];
    let current = sourceLayer;

    for (let index = 0; index < mipCount; index += 1) {
      if (current.width <= 1 && current.height <= 1) break;
      current = kawaseBlurLayer(downsampleLayer(current), 1);
      levels.push(current);
    }

    let combined = levels.length ? levels[levels.length - 1] : sourceLayer;
    for (let index = levels.length - 2; index >= 0; index -= 1) {
      const upsampled = upsampleLayer(combined, levels[index].width, levels[index].height);
      addLayer(upsampled, levels[index], weights[index] || weights[weights.length - 1] || 0.25);
      combined = kawaseBlurLayer(upsampled, 0.75);
    }

    const out = createLayer(sourceLayer.width, sourceLayer.height);
    if (levels.length) {
      addUpsampled(out, combined, params.blur.pyramidWeight || 1);
      for (let index = 0; index < levels.length; index += 1) {
        addUpsampled(out, levels[index], weights[index] || weights[weights.length - 1] || 0.2);
      }
    }
    return { glowLayer: out, levels: { mips: levels } };
  }

  modules.glowPyramidBlur = {
    createLayer,
    buildMultiScaleGlow
  };
})(window);
