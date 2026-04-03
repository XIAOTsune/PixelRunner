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

export async function placeResultIntoPhotoshop(args = []) {
  const payload = args && args[0] && typeof args[0] === "object" ? args[0] : {};
  const url = String(payload.url || "").trim();
  if (!url) {
    throw new Error("Result URL is missing");
  }

  const photoshopService = getPhotoshopService();
  if (typeof photoshopService.placeImageFromUrl !== "function") {
    throw new Error("Photoshop host service is unavailable");
  }

  return photoshopService.placeImageFromUrl(payload);
}
