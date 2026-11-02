export const MAX_IMAGE_SPLIT_TILES = 100;

export function normalizeTileLayout(columns, rows) {
  const safeColumns = Math.max(1, Math.min(20, Math.floor(Number(columns) || 1)));
  const safeRows = Math.max(1, Math.min(20, Math.floor(Number(rows) || 1)));
  if (safeColumns * safeRows > MAX_IMAGE_SPLIT_TILES) {
    throw new Error(`最多可导出 ${MAX_IMAGE_SPLIT_TILES} 个切片`);
  }
  return { columns: safeColumns, rows: safeRows };
}

export function buildTileBounds(imageWidth, imageHeight, columns, rows) {
  const width = Math.floor(Number(imageWidth));
  const height = Math.floor(Number(imageHeight));
  const layout = normalizeTileLayout(columns, rows);
  if (!(width > 0 && height > 0)) throw new Error("图片尺寸无效");
  if (layout.columns > width || layout.rows > height) throw new Error("列数和行数不能大于图片的像素尺寸");
  const tiles = [];
  for (let row = 0; row < layout.rows; row += 1) {
    const top = Math.floor(row * height / layout.rows);
    const bottom = Math.floor((row + 1) * height / layout.rows);
    for (let column = 0; column < layout.columns; column += 1) {
      const left = Math.floor(column * width / layout.columns);
      const right = Math.floor((column + 1) * width / layout.columns);
      tiles.push({
        index: tiles.length + 1,
        column,
        row,
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
      });
    }
  }
  return tiles;
}

export function sanitizeImageBaseName(value) {
  const cleaned = String(value || "image")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  return cleaned || "image";
}

export function buildTileFilenames(baseName, count, extension) {
  const safeBase = sanitizeImageBaseName(baseName);
  const safeExtension = String(extension || "jpg").toLowerCase() === "png" ? "png" : "jpg";
  const padding = Math.max(3, String(Math.max(1, Number(count) || 1)).length);
  return Array.from({ length: Math.max(0, Math.floor(Number(count) || 0)) }, (_, index) =>
    `${safeBase}-${String(index + 1).padStart(padding, "0")}.${safeExtension}`
  );
}
