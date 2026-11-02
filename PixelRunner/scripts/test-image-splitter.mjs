import assert from "node:assert/strict";
import {
  buildTileBounds,
  buildTileFilenames,
  normalizeTileLayout,
  sanitizeImageBaseName
} from "../src/webview/image-splitter-core.js";

assert.deepEqual(normalizeTileLayout(2, 2), { columns: 2, rows: 2 });
assert.throws(() => normalizeTileLayout(11, 10), /最多可导出/);
assert.throws(() => buildTileBounds(2, 3, 3, 1), /不能大于图片/);

const tiles = buildTileBounds(7, 5, 3, 2);
assert.deepEqual(tiles.map(({ index, column, row }) => [index, column, row]), [
  [1, 0, 0], [2, 1, 0], [3, 2, 0],
  [4, 0, 1], [5, 1, 1], [6, 2, 1]
]);
assert.deepEqual(tiles.slice(0, 3).map(({ left, right }) => [left, right]), [[0, 2], [2, 4], [4, 7]]);
assert.deepEqual(tiles.map(({ width, height }) => [width, height]), [
  [2, 2], [2, 2], [3, 2],
  [2, 3], [2, 3], [3, 3]
]);
assert.equal(tiles.reduce((total, tile) => total + tile.width * tile.height, 0), 35, "tile bounds should cover the source with no gaps or overlap");
assert.deepEqual(buildTileBounds(6, 9, 1, 3).map(({ left, top, right, bottom }) => [left, top, right, bottom]), [
  [0, 0, 6, 3], [0, 3, 6, 6], [0, 6, 6, 9]
]);
assert.deepEqual(buildTileFilenames("my/photo", 4, "jpg"), [
  "my-photo-001.jpg", "my-photo-002.jpg", "my-photo-003.jpg", "my-photo-004.jpg"
]);
assert.deepEqual(buildTileFilenames("cover", 2, "png"), ["cover-001.png", "cover-002.png"]);
assert.equal(sanitizeImageBaseName("  image.  "), "image");

console.log("Image splitter tests passed.");
