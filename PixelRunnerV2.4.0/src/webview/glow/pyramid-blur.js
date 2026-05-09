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

  function blurChannelHorizontal(src, width, height, radius) {
    const out = new Float32Array(src.length);
    const size = radius * 2 + 1;
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      for (let x = -radius; x <= radius; x += 1) {
        sum += src[row + Math.min(width - 1, Math.max(0, x))];
      }
      for (let x = 0; x < width; x += 1) {
        out[row + x] = sum / size;
        const removeX = Math.max(0, x - radius);
        const addX = Math.min(width - 1, x + radius + 1);
        sum += src[row + addX] - src[row + removeX];
      }
    }
    return out;
  }

  function blurChannelVertical(src, width, height, radius) {
    const out = new Float32Array(src.length);
    const size = radius * 2 + 1;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = -radius; y <= radius; y += 1) {
        sum += src[Math.min(height - 1, Math.max(0, y)) * width + x];
      }
      for (let y = 0; y < height; y += 1) {
        out[y * width + x] = sum / size;
        const removeY = Math.max(0, y - radius);
        const addY = Math.min(height - 1, y + radius + 1);
        sum += src[addY * width + x] - src[removeY * width + x];
      }
    }
    return out;
  }

  function boxBlurLayer(layer, radius, passes = 1) {
    const blurRadius = Math.max(1, Math.floor(radius));
    let r = layer.r;
    let g = layer.g;
    let b = layer.b;
    for (let pass = 0; pass < passes; pass += 1) {
      r = blurChannelVertical(blurChannelHorizontal(r, layer.width, layer.height, blurRadius), layer.width, layer.height, blurRadius);
      g = blurChannelVertical(blurChannelHorizontal(g, layer.width, layer.height, blurRadius), layer.width, layer.height, blurRadius);
      b = blurChannelVertical(blurChannelHorizontal(b, layer.width, layer.height, blurRadius), layer.width, layer.height, blurRadius);
    }
    return { width: layer.width, height: layer.height, r, g, b };
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
    const level1 = downsampleLayer(sourceLayer);
    const level2 = downsampleLayer(level1);
    const level3 = downsampleLayer(level2);
    const small = boxBlurLayer(sourceLayer, params.blur.smallRadius, 1);
    const medium = boxBlurLayer(level1, params.blur.mediumRadius, params.blur.passes);
    const large = boxBlurLayer(level2.width > 1 && level2.height > 1 ? level2 : level3, params.blur.largeRadius, 2);
    const out = createLayer(sourceLayer.width, sourceLayer.height);
    addUpsampled(out, small, params.blur.smallWeight);
    addUpsampled(out, medium, params.blur.mediumWeight);
    addUpsampled(out, large, params.blur.largeWeight);
    return { glowLayer: out, levels: { small, medium, large } };
  }

  modules.glowPyramidBlur = {
    createLayer,
    buildMultiScaleGlow
  };
})(window);
