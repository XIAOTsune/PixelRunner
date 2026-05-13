(function initGlowPreviewEngineModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const GLOW_ALGORITHM_VERSION = "engine-bloom-core-balance-v5";

  function createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(width));
    canvas.height = Math.max(1, Math.floor(height));
    return canvas;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to load glow source image"));
      image.src = src;
    });
  }

  function getImageDataFromImage(image, maxDimension = 0) {
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    const limit = Math.max(0, Number(maxDimension) || 0);
    const scale = limit > 0 ? Math.min(1, limit / Math.max(naturalWidth, naturalHeight)) : 1;
    const canvas = createCanvas(Math.round(naturalWidth * scale), Math.round(naturalHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D is unavailable for Glow Lab");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return {
      width: canvas.width,
      height: canvas.height,
      imageData: ctx.getImageData(0, 0, canvas.width, canvas.height)
    };
  }

  function imageDataToDataUrl(imageData, type = "image/png", quality = 0.9) {
    const canvas = createCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is unavailable for Glow Lab output");
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL(type, quality);
  }

  function buildScreenPreview(baseImageData, glowLayerImageData) {
    const width = baseImageData && baseImageData.width;
    const height = baseImageData && baseImageData.height;
    if (!width || !height || !glowLayerImageData || glowLayerImageData.width !== width || glowLayerImageData.height !== height) {
      return baseImageData;
    }
    const out = new ImageData(width, height);
    const base = baseImageData.data;
    const glow = glowLayerImageData.data;
    const data = out.data;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = (glow[i + 3] || 0) / 255;
      const glowR = glow[i] / 255 * alpha;
      const glowG = glow[i + 1] / 255 * alpha;
      const glowB = glow[i + 2] / 255 * alpha;
      const baseR = base[i] / 255;
      const baseG = base[i + 1] / 255;
      const baseB = base[i + 2] / 255;
      data[i] = Math.round((1 - (1 - baseR) * (1 - glowR)) * 255);
      data[i + 1] = Math.round((1 - (1 - baseG) * (1 - glowG)) * 255);
      data[i + 2] = Math.round((1 - (1 - baseB) * (1 - glowB)) * 255);
      data[i + 3] = base[i + 3];
    }
    return out;
  }

  let sourceImageCache = {
    sourceDataUrl: "",
    image: null,
    sources: new Map()
  };

  async function getSourceFromDataUrl(sourceDataUrl, maxDimension = 0) {
    const dimensionKey = String(Math.max(0, Math.round(Number(maxDimension) || 0)));
    if (sourceImageCache.sourceDataUrl === sourceDataUrl && sourceImageCache.sources.has(dimensionKey)) {
      return sourceImageCache.sources.get(dimensionKey);
    }
    const image = sourceImageCache.sourceDataUrl === sourceDataUrl && sourceImageCache.image
      ? sourceImageCache.image
      : await loadImage(sourceDataUrl);
    if (sourceImageCache.sourceDataUrl !== sourceDataUrl) {
      sourceImageCache = { sourceDataUrl, image, sources: new Map() };
    }
    const source = getImageDataFromImage(image, maxDimension);
    sourceImageCache.sources.set(dimensionKey, source);
    return source;
  }

  function getSourceCacheKey(params, width, height) {
    const source = params.source;
    return [
      GLOW_ALGORITHM_VERSION,
      width,
      height,
      params.style,
      params.threshold,
      params.brightnessBias,
      source.thresholdLow,
      source.thresholdHigh,
      source.thresholdKnee,
      source.localRadius,
      source.contrastLow,
      source.contrastHigh,
      source.specularLow,
      source.specularHigh,
      source.lowEnergyCutoff,
      source.chromaBoost,
      source.whiteProtect,
      source.skinProtect,
      source.darkProtect
    ].join("|");
  }

  function getBlurCacheKey(params, sourceKey) {
    const blur = params.blur;
    return [
      GLOW_ALGORITHM_VERSION,
      sourceKey,
      params.radius,
      blur.mipCount,
      blur.pyramidWeight,
      ...(Array.isArray(blur.mipWeights) ? blur.mipWeights : [])
    ].join("|");
  }

  let previewCache = {
    sourceDataUrl: "",
    sourceKey: "",
    blurKey: "",
    sourceResult: null,
    blurResult: null,
    sourceBackend: "cpu",
    blurBackend: "cpu"
  };

  function resetPreviewCache(sourceDataUrl) {
    previewCache = {
      sourceDataUrl,
      sourceKey: "",
      blurKey: "",
      sourceResult: null,
      blurResult: null,
      sourceBackend: "cpu",
      blurBackend: "cpu"
    };
  }

  async function createPreview(sourceDataUrl, config = {}, options = {}) {
    if (!sourceDataUrl) throw new Error("Glow source image is missing");
    const jobId = Number(options.jobId) || 0;
    const startedAt = performance.now();
    const includeGlowLayer = options.includeGlowLayer !== false;
    const requestRawImageData = options.returnImageData === true;
    const gpuOnly = options.gpuOnly === true;
    const previewTargetCanvas = options.previewTargetCanvas || null;
    const source = await getSourceFromDataUrl(sourceDataUrl, options.processMaxDimension);
    const params = modules.glowPresets.normalizeGlowParams(config);
    const allowCache = options.cache !== false && options.includeDebug === false && config.useGpu !== false;
    if (previewCache.sourceDataUrl !== sourceDataUrl) {
      resetPreviewCache(sourceDataUrl);
    }

    const includeDebug = options.includeDebug !== false;
    const sourceKey = getSourceCacheKey(params, source.width, source.height);
    const sourceStartedAt = performance.now();
    let sourceResult;
    let sourceBackend = "cpu";
    if (allowCache && previewCache.sourceKey === sourceKey && previewCache.sourceResult) {
      sourceResult = previewCache.sourceResult;
      sourceBackend = `${previewCache.sourceBackend}-cached`;
    } else {
      try {
        if (
          !includeDebug &&
          config.useGpu !== false &&
          modules.glowWebglSourceMask &&
          modules.glowGpuCapabilities &&
          modules.glowGpuCapabilities.canUseWebgl2(source.width, source.height)
        ) {
          sourceResult = modules.glowWebglSourceMask.buildSourceMask(source.imageData, params);
          sourceBackend = sourceResult.backend || "webgl2";
        }
      } catch (error) {
        let recovered = false;
        if (modules.glowWebglSourceMask && typeof modules.glowWebglSourceMask.reset === "function") {
          try {
            modules.glowWebglSourceMask.reset();
            if (
              !includeDebug &&
              config.useGpu !== false &&
              modules.glowGpuCapabilities &&
              modules.glowGpuCapabilities.canUseWebgl2(source.width, source.height)
            ) {
              sourceResult = modules.glowWebglSourceMask.buildSourceMask(source.imageData, params);
              sourceBackend = `${sourceResult.backend || "webgl2"}-recovered`;
              recovered = true;
            }
          } catch (_) {}
        }
        if (!recovered) {
          if (gpuOnly) throw error;
          console.warn("[PixelRunner] WebGL2 glow source mask failed, falling back to CPU:", error);
          sourceResult = null;
          sourceBackend = "cpu-fallback";
        }
      }
      if (!sourceResult) {
        sourceResult = modules.glowSourceMask.buildSourceMask(source.imageData, params, { includeDebug });
      }
      if (allowCache) {
        previewCache.sourceKey = sourceKey;
        previewCache.sourceResult = sourceResult;
        previewCache.sourceBackend = sourceBackend;
        previewCache.blurKey = "";
        previewCache.blurResult = null;
      }
    }
    const sourceMs = performance.now() - sourceStartedAt;

    const blurKey = getBlurCacheKey(params, sourceKey);
    const blurStartedAt = performance.now();
    let blurResult;
    let blurBackend = "cpu";
    if (allowCache && previewCache.blurKey === blurKey && previewCache.blurResult) {
      blurResult = previewCache.blurResult;
      blurBackend = `${previewCache.blurBackend}-cached`;
    } else {
      try {
        if (
          config.useGpu !== false &&
          modules.glowWebglPyramidBlur &&
          modules.glowGpuCapabilities &&
          modules.glowGpuCapabilities.canUseWebgl2(source.width, source.height)
        ) {
          blurResult = modules.glowWebglPyramidBlur.buildMultiScaleGlow(sourceResult.sourceLayer, params);
          blurBackend = blurResult.backend || "webgl2";
        }
      } catch (error) {
        let recovered = false;
        if (modules.glowWebglPyramidBlur && typeof modules.glowWebglPyramidBlur.reset === "function") {
          try {
            modules.glowWebglPyramidBlur.reset();
            if (
              config.useGpu !== false &&
              modules.glowGpuCapabilities &&
              modules.glowGpuCapabilities.canUseWebgl2(source.width, source.height)
            ) {
              blurResult = modules.glowWebglPyramidBlur.buildMultiScaleGlow(sourceResult.sourceLayer, params);
              blurBackend = `${blurResult.backend || "webgl2"}-recovered`;
              recovered = true;
            }
          } catch (_) {}
        }
        if (!recovered) {
          if (gpuOnly) throw error;
          console.warn("[PixelRunner] WebGL2 glow blur failed, falling back to CPU:", error);
          blurResult = null;
          blurBackend = "cpu-fallback";
        }
      }
      if (!blurResult) {
        blurResult = modules.glowPyramidBlur.buildMultiScaleGlow(sourceResult.sourceLayer, params);
      }
      if (allowCache) {
        previewCache.blurKey = blurKey;
        previewCache.blurResult = blurResult;
        previewCache.blurBackend = blurBackend;
      }
    }
    const blurMs = performance.now() - blurStartedAt;

    const compositeStartedAt = performance.now();
    let previewImageData;
    let glowLayerImageData;
    let previewRenderedOnGpu = false;
    let compositeBackend = "cpu";
    try {
      if (
        config.useGpu !== false &&
        modules.glowWebglCompositor &&
        modules.glowGpuCapabilities &&
        modules.glowGpuCapabilities.canUseWebgl2(source.width, source.height)
      ) {
        const compositeResult = modules.glowWebglCompositor.compose(
          source.imageData,
          blurResult.glowLayer,
          sourceResult.masks,
          params,
          { includeGlowLayer, previewCanvas: previewTargetCanvas }
        );
        previewImageData = compositeResult.previewImageData;
        glowLayerImageData = compositeResult.glowLayerImageData;
        previewRenderedOnGpu = !!compositeResult.previewRenderedOnGpu;
        compositeBackend = compositeResult.backend || "webgl2";
      }
    } catch (error) {
      let recovered = false;
      if (modules.glowWebglCompositor && typeof modules.glowWebglCompositor.reset === "function") {
        try {
          modules.glowWebglCompositor.reset();
          if (
            config.useGpu !== false &&
            modules.glowGpuCapabilities &&
            modules.glowGpuCapabilities.canUseWebgl2(source.width, source.height)
          ) {
            const compositeResult = modules.glowWebglCompositor.compose(
              source.imageData,
              blurResult.glowLayer,
              sourceResult.masks,
              params,
              { includeGlowLayer, previewCanvas: previewTargetCanvas }
            );
            previewImageData = compositeResult.previewImageData;
            glowLayerImageData = compositeResult.glowLayerImageData;
            previewRenderedOnGpu = !!compositeResult.previewRenderedOnGpu;
            compositeBackend = `${compositeResult.backend || "webgl2"}-recovered`;
            recovered = true;
          }
        } catch (_) {}
      }
      if (!recovered) {
        if (gpuOnly) throw error;
        console.warn("[PixelRunner] WebGL2 glow compositor failed, falling back to CPU:", error);
        previewImageData = null;
        glowLayerImageData = null;
        compositeBackend = "cpu-fallback";
      }
    }
    if ((!previewImageData && !previewRenderedOnGpu) || (includeGlowLayer && !glowLayerImageData)) {
      previewImageData = modules.glowCompositor.composeProtected(
        source.imageData,
        blurResult.glowLayer,
        sourceResult.masks,
        params
      );
      if (includeGlowLayer) {
        glowLayerImageData = modules.glowCompositor.renderGlowLayer(
          blurResult.glowLayer,
          sourceResult.masks,
          params
        );
      }
    }
    const compositeMs = performance.now() - compositeStartedAt;

    const finalSimImageData = includeGlowLayer && glowLayerImageData
      ? buildScreenPreview(source.imageData, glowLayerImageData)
      : (previewImageData || null);
    const previewDataUrl = requestRawImageData || !previewImageData ? "" : imageDataToDataUrl(previewImageData, "image/png", 0.92);
    const finalSimDataUrl = requestRawImageData || !finalSimImageData ? "" : imageDataToDataUrl(finalSimImageData, "image/png", 0.92);

    return {
      ok: true,
      jobId,
      width: source.width,
      height: source.height,
      baseDataUrl: sourceDataUrl,
      previewDataUrl,
      finalSimDataUrl,
      previewImageData: requestRawImageData ? previewImageData : null,
      finalSimImageData: requestRawImageData ? finalSimImageData : null,
      previewRenderedOnGpu,
      glowLayerDataUrl: glowLayerImageData ? imageDataToDataUrl(glowLayerImageData, "image/png", 0.92) : "",
      sourceMaskDataUrl: sourceResult.debugImages ? imageDataToDataUrl(sourceResult.debugImages.sourceMask) : "",
      protectMaskDataUrl: sourceResult.debugImages ? imageDataToDataUrl(sourceResult.debugImages.protectMask) : "",
      debugDataUrls: sourceResult.debugImages
        ? {
            luma: imageDataToDataUrl(sourceResult.debugImages.luma),
            contrast: imageDataToDataUrl(sourceResult.debugImages.contrast),
            whiteFlat: imageDataToDataUrl(sourceResult.debugImages.whiteFlat),
            skinLike: imageDataToDataUrl(sourceResult.debugImages.skinLike),
            darkProtect: imageDataToDataUrl(sourceResult.debugImages.darkProtect)
          }
        : {},
      timings: {
        sourceMs: Math.round(sourceMs),
        blurMs: Math.round(blurMs),
        compositeMs: Math.round(compositeMs),
        totalMs: Math.round(performance.now() - startedAt),
        sourceBackend,
        blurBackend,
        compositeBackend
      },
      params
    };
  }

  modules.glowPreviewEngine = {
    createPreview,
    getCacheInfo() {
      return {
        hasSourceImage: !!sourceImageCache.source,
        hasSourceResult: !!previewCache.sourceResult,
        hasBlurResult: !!previewCache.blurResult,
        sourceBackend: previewCache.sourceBackend,
        blurBackend: previewCache.blurBackend
      };
    },
    clearCache() {
      sourceImageCache = { sourceDataUrl: "", image: null, sources: new Map() };
      resetPreviewCache("");
    }
  };
})(window);
