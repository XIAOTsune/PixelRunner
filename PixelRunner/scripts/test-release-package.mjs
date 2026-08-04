import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RELEASE_PRODUCT_NAME,
  getReleasePackageNames
} from "./package-test.mjs";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const appHtml = await readFile(new URL("../app.html", import.meta.url), "utf8");
const hostMain = await readFile(new URL("../src/host/main.js", import.meta.url), "utf8");

assert.equal(RELEASE_PRODUCT_NAME, "像素起子");
assert.equal(manifest.id, "com.tsune.pixelrunner");
assert.equal(manifest.name, RELEASE_PRODUCT_NAME);
assert.equal(manifest.entrypoints[0].label.default, RELEASE_PRODUCT_NAME);
assert.equal(manifest.version, "2.8.2");
assert.equal(packageJson.name, "pixelrunner-uxp");
assert.equal(packageJson.version, manifest.version);
assert.deepEqual(getReleasePackageNames(manifest.version), {
  packageDirName: "像素起子V2.8.2",
  packageZipName: "像素起子V2.8.2.zip"
});
for (const source of [indexHtml, appHtml, hostMain]) {
  assert.doesNotMatch(source, /像素起子（小T修图助手）/);
}
assert.match(indexHtml, /<title>像素起子<\/title>/);
assert.match(appHtml, /<title>像素起子<\/title>/);
assert.match(hostMain, /像素起子 WebView/);

console.log("Release naming and package contract checks passed.");
