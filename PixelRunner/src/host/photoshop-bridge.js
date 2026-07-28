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

export async function capturePhotoshopDocumentForLocalUpscale(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const photoshopService = getPhotoshopService();
  if (typeof photoshopService.captureDocumentForLocalUpscale !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }

  return photoshopService.captureDocumentForLocalUpscale(payload);
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

export async function openLocalUpscaleResultInPhotoshop(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const photoshopService = getPhotoshopService();
  if (typeof photoshopService.openImageFromUrl !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }

  return photoshopService.openImageFromUrl(payload);
}

export function buildLocalUpscalePlacementPayload(payload = {}) {
  const targetWidth = Math.max(1, Math.round(Number(payload.targetWidth) || 0));
  const targetHeight = Math.max(1, Math.round(Number(payload.targetHeight) || 0));
  const targetBounds = payload.targetBounds && typeof payload.targetBounds === "object"
    ? payload.targetBounds
    : { left: 0, top: 0, right: targetWidth, bottom: targetHeight };
  const selectionSnapshotChannelName = String(payload.selectionSnapshotChannelName || "").trim();
  const captureMode = String(payload.captureMode || "full").trim();
  return {
    filePath: String(payload.filePath || "").trim(),
    taskId: payload.taskId,
    targetDocumentId: Number(payload.targetDocumentId) || 0,
    targetBounds,
    fitMode: "stretch",
    preserveCanvasBounds: true,
    applyMask: Boolean(selectionSnapshotChannelName),
    requirePlacementMask: Boolean(selectionSnapshotChannelName),
    selectionSnapshotChannelName,
    selectionMaskFeather: selectionSnapshotChannelName ? 24 : 0,
    restoreActiveLayerId: Math.max(0, Number(payload.restoreActiveLayerId) || 0),
    cleanupLocalSource: true,
    layerName: captureMode === "selection" ? "超分 x4（选区）" : "超分 x4"
  };
}

export async function placeLocalUpscaleResultIntoPhotoshop(args = [], runtime = {}) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const filePath = String(payload.filePath || "").trim();
  const targetDocumentId = Number(payload.targetDocumentId) || 0;
  const targetWidth = Math.max(1, Math.round(Number(payload.targetWidth) || 0));
  const targetHeight = Math.max(1, Math.round(Number(payload.targetHeight) || 0));
  if (!filePath || !targetDocumentId || !targetWidth || !targetHeight) {
    throw new Error("本地超分回贴缺少结果文件或目标文档信息");
  }

  const photoshopService = getPhotoshopService();
  if (typeof photoshopService.placeImageFromUrl !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }

  const selectionSnapshotChannelName = String(payload.selectionSnapshotChannelName || "").trim();
  const placementPayload = buildLocalUpscalePlacementPayload(payload);
  try {
    return await photoshopService.placeImageFromUrl(placementPayload, runtime);
  } catch (error) {
    if (selectionSnapshotChannelName && typeof photoshopService.deleteSelectionSnapshot === "function") {
      try {
        await photoshopService.deleteSelectionSnapshot({
          targetDocumentId,
          selectionSnapshotChannelName
        });
      } catch (_) {}
    }
    throw error;
  }
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
