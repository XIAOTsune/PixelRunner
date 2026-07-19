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
  if (!url && !dataUrl && !base64) {
    throw new Error("Result image is missing");
  }

  const photoshopService = getPhotoshopService();
  if (typeof photoshopService.placeImageFromUrl !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }

  return photoshopService.placeImageFromUrl(payload, runtime);
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

export async function deletePhotoshopSelectionSnapshot(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const photoshopService = getPhotoshopService();
  if (typeof photoshopService.deleteSelectionSnapshot !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }
  return photoshopService.deleteSelectionSnapshot(payload);
}
