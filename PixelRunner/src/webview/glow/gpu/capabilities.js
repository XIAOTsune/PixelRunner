(function initGlowGpuCapabilitiesModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  let cachedReport = null;

  function createProbeCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return canvas;
  }

  function getWebgl2Context(canvas) {
    if (!canvas || typeof canvas.getContext !== "function") return null;
    try {
      return canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false
      });
    } catch (_) {
      return null;
    }
  }

  function inspectWebgl2() {
    const canvas = createProbeCanvas();
    const gl = getWebgl2Context(canvas);
    if (!gl) {
      return {
        webgl2: false,
        reason: "webgl2-context-unavailable"
      };
    }

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "";
    const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : "";

    return {
      webgl2: true,
      renderer: String(renderer || gl.getParameter(gl.RENDERER) || ""),
      vendor: String(vendor || gl.getParameter(gl.VENDOR) || ""),
      maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0,
      maxTextureImageUnits: Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)) || 0,
      colorBufferFloat: !!gl.getExtension("EXT_color_buffer_float"),
      textureFloatLinear: !!gl.getExtension("OES_texture_float_linear")
    };
  }

  function getReport({ refresh = false } = {}) {
    if (!cachedReport || refresh) cachedReport = inspectWebgl2();
    return cachedReport;
  }

  function canUseWebgl2(width = 1, height = 1) {
    const report = getReport();
    const maxTextureSize = Number(report.maxTextureSize) || 0;
    return !!(
      report.webgl2 &&
      maxTextureSize > 0 &&
      Number(width) > 0 &&
      Number(height) > 0 &&
      Number(width) <= maxTextureSize &&
      Number(height) <= maxTextureSize
    );
  }

  modules.glowGpuCapabilities = {
    getReport,
    canUseWebgl2,
    getWebgl2Context
  };
})(window);
