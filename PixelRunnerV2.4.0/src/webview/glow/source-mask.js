(function initGlowSourceMaskModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function createLayer(width, height) {
    return {
      width,
      height,
      r: new Float32Array(width * height),
      g: new Float32Array(width * height),
      b: new Float32Array(width * height)
    };
  }

  function blurFloatHorizontal(src, width, height, radius) {
    const out = new Float32Array(src.length);
    const size = radius * 2 + 1;
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      for (let x = -radius; x <= radius; x += 1) {
        sum += src[row + clamp(x, 0, width - 1)];
      }
      for (let x = 0; x < width; x += 1) {
        out[row + x] = sum / size;
        const removeX = clamp(x - radius, 0, width - 1);
        const addX = clamp(x + radius + 1, 0, width - 1);
        sum += src[row + addX] - src[row + removeX];
      }
    }
    return out;
  }

  function blurFloat(src, width, height, radius) {
    const r = Math.max(1, Math.floor(radius));
    const horizontal = blurFloatHorizontal(src, width, height, r);
    const out = new Float32Array(src.length);
    const size = r * 2 + 1;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = -r; y <= r; y += 1) {
        sum += horizontal[clamp(y, 0, height - 1) * width + x];
      }
      for (let y = 0; y < height; y += 1) {
        out[y * width + x] = sum / size;
        const removeY = clamp(y - r, 0, height - 1);
        const addY = clamp(y + r + 1, 0, height - 1);
        sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
      }
    }
    return out;
  }

  function rgbToHsv(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta > 0.0001) {
      if (max === r) h = ((g - b) / delta) % 6;
      else if (max === g) h = (b - r) / delta + 2;
      else h = (r - g) / delta + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : delta / max, v: max };
  }

  function createMaskImageData(mask, width, height, tint = null) {
    const out = new ImageData(width, height);
    const tr = tint ? tint[0] : 255;
    const tg = tint ? tint[1] : 255;
    const tb = tint ? tint[2] : 255;
    for (let pixel = 0, index = 0; pixel < mask.length; pixel += 1, index += 4) {
      const value = clamp(mask[pixel], 0, 1);
      out.data[index] = Math.round(tr * value);
      out.data[index + 1] = Math.round(tg * value);
      out.data[index + 2] = Math.round(tb * value);
      out.data[index + 3] = 255;
    }
    return out;
  }

  function buildSourceMask(imageData, params, options = {}) {
    const { width, height, data } = imageData;
    const total = width * height;
    const luma = new Float32Array(total);
    const maxChannelMap = new Float32Array(total);
    const saturationMap = new Float32Array(total);

    for (let index = 0, pixel = 0; pixel < total; pixel += 1, index += 4) {
      const r = data[index] / 255;
      const g = data[index + 1] / 255;
      const b = data[index + 2] / 255;
      const maxChannel = Math.max(r, g, b);
      const minChannel = Math.min(r, g, b);
      luma[pixel] = r * 0.2126 + g * 0.7152 + b * 0.0722;
      maxChannelMap[pixel] = maxChannel;
      saturationMap[pixel] = maxChannel <= 0 ? 0 : (maxChannel - minChannel) / maxChannel;
    }

    const localMean = blurFloat(luma, width, height, params.source.localRadius);
    const localContrast = new Float32Array(total);
    const lumaMask = new Float32Array(total);
    const contrastMask = new Float32Array(total);
    const whiteFlatMask = new Float32Array(total);
    const skinLikeMask = new Float32Array(total);
    const darkProtect = new Float32Array(total);
    const protectMask = new Float32Array(total);
    const sourceMask = new Float32Array(total);
    const sourceLayer = createLayer(width, height);

    for (let index = 0, pixel = 0; pixel < total; pixel += 1, index += 4) {
      const r = data[index] / 255;
      const g = data[index + 1] / 255;
      const b = data[index + 2] / 255;
      const lum = luma[pixel];
      const sat = saturationMap[pixel];
      const contrast = Math.max(0, lum - localMean[pixel]);
      const specular = Math.max(0, maxChannelMap[pixel] - localMean[pixel]);
      const hsv = rgbToHsv(r, g, b);

      const lumaScore = smoothstep(params.source.thresholdLow, params.source.thresholdHigh, lum);
      const contrastScore = smoothstep(params.source.contrastLow, params.source.contrastHigh, contrast);
      const specularScore = smoothstep(params.source.specularLow, params.source.specularHigh, specular);
      const highLightness = smoothstep(0.72, 0.94, lum);
      const lowContrast = 1 - smoothstep(0.012, 0.075, contrast);
      const lowSat = 1 - smoothstep(0.12, 0.36, sat);
      const whiteFlat = highLightness * lowContrast * lowSat;
      const skinHue = hsv.h >= 5 && hsv.h <= 52 ? 1 : 0;
      const skinColor =
        skinHue *
        smoothstep(0.16, 0.36, sat) *
        (1 - smoothstep(0.78, 0.96, sat)) *
        smoothstep(0.38, 0.74, lum) *
        (1 - smoothstep(0.9, 1.0, lum));
      const dark = 1 - smoothstep(0.08, 0.28, lum);
      const protection = clamp(
        whiteFlat * params.source.whiteProtect +
          skinColor * params.source.skinProtect +
          dark * params.source.darkProtect,
        0,
        1
      );
      const reflectiveBoost = clamp(0.55 + contrastScore * 0.6 + specularScore * 0.48 + sat * 0.18, 0, 1.35);
      const edgeSource = Math.max(contrastScore * 0.34, specularScore * 0.42) * smoothstep(0.48, 0.86, lum);
      const mask = clamp(Math.max(lumaScore, edgeSource) * reflectiveBoost * (1 - protection * 0.76), 0, 1);
      const colorGain = Math.pow(mask, 0.86);

      localContrast[pixel] = contrast;
      lumaMask[pixel] = lumaScore;
      contrastMask[pixel] = Math.max(contrastScore, specularScore * 0.72);
      whiteFlatMask[pixel] = whiteFlat;
      skinLikeMask[pixel] = skinColor;
      darkProtect[pixel] = dark;
      protectMask[pixel] = protection;
      sourceMask[pixel] = mask;
      sourceLayer.r[pixel] = r * colorGain;
      sourceLayer.g[pixel] = g * colorGain;
      sourceLayer.b[pixel] = b * colorGain;
    }

    return {
      width,
      height,
      sourceLayer,
      masks: {
        luma,
        localContrast,
        lumaMask,
        contrastMask,
        whiteFlatMask,
        skinLikeMask,
        darkProtect,
        protectMask,
        sourceMask
      },
      debugImages: options.includeDebug === false
        ? null
        : {
            luma: createMaskImageData(lumaMask, width, height),
            contrast: createMaskImageData(contrastMask, width, height),
            whiteFlat: createMaskImageData(whiteFlatMask, width, height),
            skinLike: createMaskImageData(skinLikeMask, width, height, [255, 188, 126]),
            darkProtect: createMaskImageData(darkProtect, width, height, [120, 172, 255]),
            sourceMask: createMaskImageData(sourceMask, width, height, [255, 244, 190]),
            protectMask: createMaskImageData(protectMask, width, height, [142, 207, 255])
          }
    };
  }

  modules.glowSourceMask = {
    buildSourceMask,
    createMaskImageData
  };
})(window);
