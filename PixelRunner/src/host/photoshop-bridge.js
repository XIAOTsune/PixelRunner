function getPhotoshopService() {
  const photoshopService =
    typeof window !== "undefined" &&
    window.PixelRunnerHost &&
    window.PixelRunnerHost.photoshop;

  if (!photoshopService) {
    throw new Error("Photoshop host service is unavailable");
  }

  return photoshopService;
}

const GENERATIVE_FILL_COLOR_CORRECTION_CONFIG = Object.freeze({
  mode: "natural",
  totalStrength: 64,
  luminanceStrength: 70,
  colorStrength: 68,
  saturationStrength: 0,
  contrastStrength: 0,
  featherRadius: 0,
  createBackupLayer: true,
  pixelPipelineEnabled: true,
  alignmentEnabled: false,
  alignmentScaleEnabled: false,
  localAlignmentEnabled: false,
  colorCorrectionOnly: true
});

export async function getPhotoshopDocumentInfo() {
  const photoshopService = getPhotoshopService();
  if (typeof photoshopService.getActiveDocumentInfo !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }

  return photoshopService.getActiveDocumentInfo();
}

export async function capturePhotoshopDocumentPreview(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const photoshopService = getPhotoshopService();
  if (typeof photoshopService.captureDocumentPreview !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }

  return photoshopService.captureDocumentPreview(payload);
}

export async function capturePhotoshopPostFxPreview(args = []) {
  return capturePhotoshopDocumentPreview(args);
}

export async function capturePhotoshopPostFxSource(args = []) {
  return capturePhotoshopDocumentPreview(args);
}

export async function runPhotoshopToolAction(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const photoshopService = getPhotoshopService();
  if (typeof photoshopService.runToolAction !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }

  return photoshopService.runToolAction(payload);
}

export async function placeResultIntoPhotoshop(args = [], runtime = {}) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const url = String(payload.url || "").trim();
  const dataUrl = String(payload.dataUrl || "").trim();
  const base64 = String(payload.base64 || "").trim();
  const filePath = String(payload.filePath || "").trim();
  if (!url && !dataUrl && !base64 && !filePath) {
    throw new Error("Result image is missing");
  }

  const photoshopService = getPhotoshopService();
  if (typeof photoshopService.placeImageFromUrl !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }

  return photoshopService.placeImageFromUrl(payload, runtime);
}

export async function cacheResultForPhotoshop(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const url = String(payload.url || "").trim();
  if (!url) throw new Error("Result image URL is missing");

  const photoshopService = getPhotoshopService();
  if (typeof photoshopService.placeImageFromUrl !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }

  return photoshopService.placeImageFromUrl({
    ...payload,
    dataUrl: "",
    base64: "",
    filePath: "",
    cacheOnly: true
  });
}

export async function placeResultAndBlendIntoPhotoshop(args = [], runtime = {}) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const blendMatch = payload.blendMatch && typeof payload.blendMatch === "object"
    ? payload.blendMatch
    : null;
  const placementStartedAt = Date.now();
  console.log("[PixelRunner/Host] auto placement stage start placeResult");
  const placement = await placeResultIntoPhotoshop(args, runtime);
  console.log(`[PixelRunner/Host] auto placement stage success placeResult durationMs=${Date.now() - placementStartedAt}`);
  const layerId = Number(placement && placement.layerId) || 0;
  if (!blendMatch || !layerId) return placement;

  const photoshopService = getPhotoshopService();
  const fusionStartedAt = Date.now();
  console.log(`[PixelRunner/Host] auto placement stage start blendMatch layerId=${layerId}`);
  try {
    const runFusion = () => photoshopService.runToolAction({
      ...blendMatch,
      action: "blendMatch",
      layerId
    });
    const fusion = runtime && typeof runtime.enqueuePhotoshopOperation === "function"
      ? await runtime.enqueuePhotoshopOperation(runFusion, { stage: "blendMatch" })
      : await runFusion();
    console.log(`[PixelRunner/Host] auto placement stage success blendMatch layerId=${layerId} durationMs=${Date.now() - fusionStartedAt}`);
    return {
      ...placement,
      blendMatchFusion: fusion
    };
  } catch (error) {
    console.error(
      `[PixelRunner/Host] auto placement stage failure blendMatch layerId=${layerId} durationMs=${Date.now() - fusionStartedAt} error=${String(error && error.message ? error.message : error || "自动融合失败")}`
    );
    return {
      ...placement,
      blendMatchFusion: {
        ok: false,
        error: String(error && error.message ? error.message : error || "自动融合失败")
      }
    };
  }
}

export async function placeResultWithGenerativeFillColorCorrection(args = [], runtime = {}) {
  const placement = await placeResultIntoPhotoshop(args, runtime);
  const layerId = Number(placement && placement.layerId) || 0;
  if (!layerId) return placement;

  const photoshopService = getPhotoshopService();
  const correctionStartedAt = Date.now();
  console.log(`[PixelRunner/Host] generative fill color correction start layerId=${layerId}`);
  try {
    const runCorrection = () => photoshopService.runToolAction({
      ...GENERATIVE_FILL_COLOR_CORRECTION_CONFIG,
      action: "blendMatch",
      layerId
    });
    const correction = runtime && typeof runtime.enqueuePhotoshopOperation === "function"
      ? await runtime.enqueuePhotoshopOperation(runCorrection, { stage: "blendMatch" })
      : await runCorrection();
    console.log(`[PixelRunner/Host] generative fill color correction success layerId=${layerId} durationMs=${Date.now() - correctionStartedAt}`);
    return {
      ...placement,
      blendMatchFusion: correction
    };
  } catch (error) {
    console.error(
      `[PixelRunner/Host] generative fill color correction failure layerId=${layerId} durationMs=${Date.now() - correctionStartedAt} error=${String(error && error.message ? error.message : error || "创成式填充校色失败")}`
    );
    return {
      ...placement,
      blendMatchFusion: {
        ok: false,
        error: String(error && error.message ? error.message : error || "创成式填充校色失败")
      }
    };
  }
}

export async function deletePhotoshopSelectionSnapshot(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const photoshopService = getPhotoshopService();
  if (typeof photoshopService.deleteSelectionSnapshot !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }
  return photoshopService.deleteSelectionSnapshot(payload);
}
