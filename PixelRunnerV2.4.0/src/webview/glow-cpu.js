(function initGlowCpuCompatModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  async function createGlowPng(sourceDataUrl, config = {}) {
    if (!modules.glowPreviewEngine || typeof modules.glowPreviewEngine.createPreview !== "function") {
      throw new Error("Glow preview engine is unavailable");
    }
    const result = await modules.glowPreviewEngine.createPreview(sourceDataUrl, config);
    return {
      dataUrl: result.previewDataUrl,
      previewDataUrl: result.previewDataUrl,
      glowLayerDataUrl: result.glowLayerDataUrl,
      baseDataUrl: result.baseDataUrl,
      sourceMaskDataUrl: result.sourceMaskDataUrl,
      protectMaskDataUrl: result.protectMaskDataUrl,
      debugDataUrls: result.debugDataUrls,
      timings: result.timings,
      width: result.width,
      height: result.height,
      elapsedMs: result.timings ? result.timings.totalMs : 0,
      layerMode: "webview-preview-only"
    };
  }

  modules.glowCpu = {
    createGlowPng
  };
})(window);
