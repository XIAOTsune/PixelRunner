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
        const a = sy * layer.width + sx;
        const b = sy * layer.width + Math.min(layer.width - 1, sx + 1);
        const c = Math.min(layer.height - 1, sy + 1) * layer.width + sx;
        const d = Math.min(layer.height - 1, sy + 1) * layer.width + Math.min(layer.width - 1, sx + 1);
        const target = y * nextWidth + x;
        out.r[target] = (layer.r[a] + layer.r[b] + layer.r[c] + layer.r[d]) * 0.25;
        out.g[target] = (layer.g[a] + layer.g[b] + layer.g[c] + layer.g[d]) * 0.25;
        out.b[target] = (layer.b[a] + layer.b[b] + layer.b[c] + layer.b[d]) * 0.25;
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
      const sy = Math.min(source.height - 1, Math.floor((y + 0.5) * yScale));
      for (let x = 0; x < target.width; x += 1) {
        const sx = Math.min(source.width - 1, Math.floor((x + 0.5) * xScale));
        const sourceIndex = sy * source.width + sx;
        const targetIndex = y * target.width + x;
        target.r[targetIndex] += source.r[sourceIndex] * weight;
        target.g[targetIndex] += source.g[sourceIndex] * weight;
        target.b[targetIndex] += source.b[sourceIndex] * weight;
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
