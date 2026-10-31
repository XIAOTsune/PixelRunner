const TARGET_BYTES = 9_000_000;
const HARD_LIMIT_BYTES = 10_000_000;
const QUALITY_STEPS = [100, 95, 90, 85, 80, 70, 60, 50, 40, 30, 20, 10];

export function encodeLocalImageAsJpeg(image, settings = {}, createCanvas = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}) {
  const originalWidth = Number(image.naturalWidth || image.width);
  const originalHeight = Number(image.naturalHeight || image.height);
  if (!(originalWidth > 0 && originalHeight > 0) || !Number.isFinite(originalWidth + originalHeight)) {
    throw new Error("本地图片尺寸无效，请重新选择图片。");
  }
  const maxDimension = Math.max(256, Math.min(4096, Math.floor(Number(settings.maxDimension) || 1536)));
  const targetBytes = Math.max(1, Math.floor(Number(settings.targetBytes) || TARGET_BYTES));
  const hardLimitBytes = Math.max(targetBytes, Math.floor(Number(settings.hardLimitBytes) || HARD_LIMIT_BYTES));
  const attempts = [];
  // Capture settings describe the preview, not an unconditional upload resize.
  const scales = [1];
  if (Math.max(originalWidth, originalHeight) > maxDimension) {
    scales.push(maxDimension / Math.max(originalWidth, originalHeight));
  }
  const canvas = createCanvas(originalWidth, originalHeight);
  try {
    for (const scale of scales) {
      const width = Math.max(1, Math.round(originalWidth * scale));
      const height = Math.max(1, Math.round(originalHeight * scale));
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

      let lastAttempt = null;
      for (const quality of QUALITY_STEPS) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality / 100);
        const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
        if (!match) throw new Error("本地图片 JPEG 编码失败，请缩小图片或重启插件后重试。");
        const base64 = match[1];
        const bytes = Math.max(0, Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0));
        attempts.push({ width, height, quality, bytes });
        lastAttempt = { width, height, originalWidth, originalHeight, quality, qualityMax: 100, dataUrl, base64, bytes, targetBytes, hardLimitBytes, attempts };
        if (bytes <= targetBytes) return lastAttempt;
      }
      if (lastAttempt && lastAttempt.bytes <= hardLimitBytes) return lastAttempt;
    }
    throw new Error("本地图片压缩后仍超过上传限制，请选择更小的图片。");
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
