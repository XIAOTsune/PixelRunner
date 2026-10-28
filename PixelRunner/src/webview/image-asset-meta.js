export function formatImageAssetMeta(asset) {
  const originalWidth = Number(asset.originalWidth || asset.width) || 0;
  const originalHeight = Number(asset.originalHeight || asset.height) || 0;
  const uploadWidth = Number(asset.uploadWidth || asset.width) || 0;
  const uploadHeight = Number(asset.uploadHeight || asset.height) || 0;
  const resized = originalWidth !== uploadWidth || originalHeight !== uploadHeight;
  const qualityMax = Number(asset.uploadQualityMax) || 0;
  return [
    resized ? `原图 ${originalWidth}x${originalHeight} → 上传 ${uploadWidth}x${uploadHeight}` : `${uploadWidth}x${uploadHeight}`,
    asset.uploadBytes ? `${(asset.uploadBytes / (1024 * 1024)).toFixed(2)}MB` : "",
    asset.uploadQuality ? `Q${asset.uploadQuality}${qualityMax ? `/${qualityMax}` : ""}` : ""
  ].filter(Boolean).join(" · ");
}
