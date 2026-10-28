export function encodeLocalImageAsJpeg(image, settings, createCanvas = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}) {
  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, settings.maxDimension / Math.max(originalWidth, originalHeight));
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const canvas = createCanvas(width, height);
  canvas.width = width;
  canvas.height = height;

  let context = null;
  try {
    context = canvas.getContext("2d", { colorSpace: "srgb" });
  } catch (_error) {
    // Older UXP canvas implementations may not accept color-space options.
  }
  if (!context) context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建本地图片处理画布，请重启插件后重试。");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const quality = settings.quality / 100;
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : "";
  const bytes = Math.max(0, Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0));

  return { width, height, originalWidth, originalHeight, quality: settings.quality, dataUrl, base64, bytes };
}
