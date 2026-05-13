(function initGlowSourceMaskModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function softThresholdMask(value, threshold, knee) {
    const safeKnee = Math.max(0.0001, knee);
    const soft = clamp(value - threshold + safeKnee, 0, safeKnee * 2);
    const curved = (soft * soft) / (safeKnee * 4);
    return clamp(Math.max(curved, value - threshold) / Math.max(value, 0.0001), 0, 1);
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
    const rightEdgeOffset = width - 1;
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const x = offset < 0 ? 0 : (offset < width ? offset : rightEdgeOffset);
        sum += src[row + x];
      }
      for (let x = 0; x < width; x += 1) {
        out[row + x] = sum / size;
        const removeX = x > radius ? x - radius : 0;
        const addCandidate = x + radius + 1;
        const addX = addCandidate < width ? addCandidate : rightEdgeOffset;
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
      for (let offset = -r; offset <= r; offset += 1) {
        const y = offset < 0 ? 0 : (offset < height ? offset : height - 1);
        sum += horizontal[y * width + x];
      }
      for (let y = 0; y < height; y += 1) {
        out[y * width + x] = sum / size;
        const removeY = y > r ? y - r : 0;
        const addCandidate = y + r + 1;
        const addY = addCandidate < height ? addCandidate : height - 1;
        sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
      }
    }
    return out;
  }

  function isSkinHueFast(r, g, b, max, min) {
    const delta = max - min;
    if (delta <= 0.0001 || max !== r) return false;
    const hue = ((g - b) / delta) * 60;
    return hue >= 5 && hue <= 52;
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
    const minChannelMap = new Float32Array(total);
    const saturationMap = new Float32Array(total);

    for (let index = 0, pixel = 0; pixel < total; pixel += 1, index += 4) {
      const r = data[index] * (1 / 255);
      const g = data[index + 1] * (1 / 255);
      const b = data[index + 2] * (1 / 255);
      const maxChannel = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const minChannel = r < g ? (r < b ? r : b) : (g < b ? g : b);
      luma[pixel] = r * 0.2126 + g * 0.7152 + b * 0.0722;
      maxChannelMap[pixel] = maxChannel;
      minChannelMap[pixel] = minChannel;
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
    const rawSourceR = new Float32Array(total);
    const rawSourceG = new Float32Array(total);
    const rawSourceB = new Float32Array(total);
    const sourceLayer = createLayer(width, height);
    const sourceParams = params.source;
    const inv255 = 1 / 255;
    const thresholdLow = sourceParams.thresholdLow;
    const thresholdHigh = sourceParams.thresholdHigh;
    const thresholdKnee = sourceParams.thresholdKnee;
    const whiteProtect = sourceParams.whiteProtect;
    const skinProtect = sourceParams.skinProtect;
    const chromaBoostAmount = sourceParams.chromaBoost;

    for (let index = 0, pixel = 0; pixel < total; pixel += 1, index += 4) {
      const r = data[index] * inv255;
      const g = data[index + 1] * inv255;
      const b = data[index + 2] * inv255;
      const lum = luma[pixel];
      const sat = saturationMap[pixel];
      const maxChannel = maxChannelMap[pixel];
      const contrast = Math.max(0, lum - localMean[pixel]);
      const specular = Math.max(0, maxChannel - localMean[pixel]);
      const brightness = Math.max(lum * 0.82 + maxChannel * 0.18, maxChannel * 0.88);

      const lumaScore =
        softThresholdMask(brightness, thresholdLow, thresholdKnee) *
        smoothstep(thresholdLow - thresholdKnee * 0.92, thresholdHigh, brightness);
      const contrastScore = smoothstep(sourceParams.contrastLow, sourceParams.contrastHigh, contrast);
      const specularScore = smoothstep(sourceParams.specularLow, sourceParams.specularHigh, specular);
      const highLightness = smoothstep(0.7, 0.95, lum);
      const veryHighLightness = smoothstep(0.84, 0.985, lum);
      const lowContrast = 1 - smoothstep(0.01, 0.068, contrast);
      const lowSat = 1 - smoothstep(0.12, 0.36, sat);
      const whiteFlat = highLightness * lowContrast * lowSat * (0.72 + veryHighLightness * 0.5);
      const skinHue = isSkinHueFast(r, g, b, maxChannel, minChannelMap[pixel]) ? 1 : 0;
      const skinColor =
        skinHue *
        smoothstep(0.16, 0.36, sat) *
        (1 - smoothstep(0.78, 0.96, sat)) *
        smoothstep(0.38, 0.74, lum) *
        (1 - smoothstep(0.9, 1.0, lum));
      const dark = 1 - smoothstep(0.08, 0.28, lum);
      const protectionBase = clamp(
        whiteFlat * whiteProtect +
          skinColor * skinProtect * 0.55,
        0,
        1
      );
      const nearClip = smoothstep(0.92, 1.0, maxChannel);
      const protection = clamp(protectionBase + nearClip * (0.12 + (1 - sat) * 0.1), 0, 1);
      const chromaSource = smoothstep(0.08, 0.46, sat) * smoothstep(0.44, 0.84, brightness);
      const detailBoost = smoothstep(0.022, 0.12, contrast);
      const reflectiveBoost = clamp(0.48 + contrastScore * 0.44 + specularScore * 0.48 + chromaSource * 0.18 + detailBoost * 0.16, 0, 1.28);
      const edgeSource = Math.max(contrastScore * 0.2, specularScore * 0.4) * smoothstep(0.42, 0.9, brightness);
      const combinedSource = lumaScore * 0.82 + edgeSource * 0.38 + specularScore * 0.12;
      const mask = clamp(combinedSource * reflectiveBoost * (1 - protection * 0.82), 0, 1);
      const chromaBoost = chromaBoostAmount * smoothstep(0.06, 0.58, sat) * (0.62 + contrastScore * 0.26 + specularScore * 0.18);
      const saturationGain = 1 + chromaBoost;
      const sourceR = clamp(lum + (r - lum) * saturationGain, 0, 1);
      const sourceG = clamp(lum + (g - lum) * saturationGain, 0, 1);
      const sourceB = clamp(lum + (b - lum) * saturationGain, 0, 1);

      localContrast[pixel] = contrast;
      lumaMask[pixel] = lumaScore;
      contrastMask[pixel] = Math.max(contrastScore, specularScore * 0.72);
      whiteFlatMask[pixel] = whiteFlat;
      skinLikeMask[pixel] = skinColor;
      darkProtect[pixel] = dark;
      protectMask[pixel] = protection;
      sourceMask[pixel] = mask;
      rawSourceR[pixel] = sourceR;
      rawSourceG[pixel] = sourceG;
      rawSourceB[pixel] = sourceB;
    }

    const sourceFeatherRadius = Math.max(1, Math.floor(Number(sourceParams.sourceFeatherRadius) || 1));
    const featheredSourceMask = blurFloat(sourceMask, width, height, sourceFeatherRadius);
    const haloMaskRadius = Math.max(sourceFeatherRadius + 1, Math.floor(Number(sourceParams.haloMaskRadius) || 8));
    const haloMask = blurFloat(sourceMask, width, height, haloMaskRadius);
    for (let pixel = 0; pixel < total; pixel += 1) {
      const softMask = clamp(sourceMask[pixel] * 0.78 + featheredSourceMask[pixel] * 0.22, 0, 1);
      const colorGain = Math.pow(softMask, 0.78);
      sourceLayer.r[pixel] = rawSourceR[pixel] * colorGain;
      sourceLayer.g[pixel] = rawSourceG[pixel] * colorGain;
      sourceLayer.b[pixel] = rawSourceB[pixel] * colorGain;
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
        sourceMask,
        haloMask
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
