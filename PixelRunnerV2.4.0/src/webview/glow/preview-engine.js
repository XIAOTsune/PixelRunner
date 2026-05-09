(function initGlowPreviewEngineModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

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

  function getImageDataFromImage(image) {
    const canvas = createCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
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

  async function createPreview(sourceDataUrl, config = {}, options = {}) {
    if (!sourceDataUrl) throw new Error("Glow source image is missing");
    const jobId = Number(options.jobId) || 0;
    const startedAt = performance.now();
    const image = await loadImage(sourceDataUrl);
    const source = getImageDataFromImage(image);
    const params = modules.glowPresets.normalizeGlowParams(config);

    const sourceStartedAt = performance.now();
    const includeDebug = options.includeDebug !== false;
    const sourceResult = modules.glowSourceMask.buildSourceMask(source.imageData, params, { includeDebug });
    const sourceMs = performance.now() - sourceStartedAt;

    const blurStartedAt = performance.now();
    const blurResult = modules.glowPyramidBlur.buildMultiScaleGlow(sourceResult.sourceLayer, params);
    const blurMs = performance.now() - blurStartedAt;

    const compositeStartedAt = performance.now();
    const previewImageData = modules.glowCompositor.composeProtected(
      source.imageData,
      blurResult.glowLayer,
      sourceResult.masks,
      params
    );
    const compositeMs = performance.now() - compositeStartedAt;

    return {
      ok: true,
      jobId,
      width: source.width,
      height: source.height,
      baseDataUrl: sourceDataUrl,
      previewDataUrl: imageDataToDataUrl(previewImageData, "image/jpeg", 0.9),
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
        totalMs: Math.round(performance.now() - startedAt)
      },
      params
    };
  }

  modules.glowPreviewEngine = {
    createPreview
  };
})(window);
