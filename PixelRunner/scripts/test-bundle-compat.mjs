import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTransferPackageText } from "../src/webview/bundle-compat.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

async function readBundle(filePath) {
  return readFile(filePath, "utf8");
}

function assertV2Bundle(text) {
  const transfer = parseTransferPackageText(text);
  assert.equal(transfer.kind, "bundle");
  assert.equal(transfer.apps.length, 1);
  assert.equal(transfer.apps[0].region, "cn");
  assert.equal(transfer.templateCategories.length, 1);
  assert.equal(transfer.templates.length, 1);
  assert.equal(transfer.quickEntries.length, 1);
  assert.equal(transfer.quickEntries[0].appRef.savedAppId, transfer.apps[0].id);
}

function assertMixedBundleFallback() {
  const transfer = parseTransferPackageText(JSON.stringify({
    schema: "pixelrunner.bundle",
    version: 3,
    appsByRegion: {
      cn: [{ id: "cn-app", appId: "100", name: "国内应用" }],
      global: [{ id: "global-app", appId: "100", name: "国际应用" }]
    },
    apps: [
      { id: "legacy-cn-app", appId: "100", name: "国内应用" },
      { id: "legacy-only", appId: "200", name: "仅旧数组存在的应用" }
    ],
    templates: []
  }));

  assert.deepEqual(
    transfer.apps.map((app) => [app.id, app.region]),
    [
      ["cn-app", "cn"],
      ["global-app", "global"],
      ["legacy-only", "cn"]
    ]
  );
}

function assertV2AppAliasesArePreserved() {
  const transfer = parseTransferPackageText(JSON.stringify({
    schema: "pixelrunner.bundle",
    version: 2,
    apps: [
      { id: "alias-a", appId: "300", name: "应用别名 A" },
      { id: "alias-b", appId: "300", name: "应用别名 B" }
    ],
    templates: []
  }));
  assert.deepEqual(transfer.apps.map((app) => app.id), ["alias-a", "alias-b"]);
}

function assertTemplateOnlyImport() {
  const transfer = parseTransferPackageText(JSON.stringify({
    templates: [{ id: "template-only", title: "模板", content: "内容" }]
  }));
  assert.equal(transfer.kind, "templates");
  assert.equal(transfer.apps.length, 0);
  assert.equal(transfer.templates.length, 1);
}

async function assertExternalReference(filePath) {
  const text = await readBundle(filePath);
  const raw = JSON.parse(text);
  const transfer = parseTransferPackageText(text);
  assert.equal(transfer.kind, "bundle");
  assert.equal(transfer.apps.length, raw.apps.length);
  assert.equal(transfer.templateCategories.length, raw.templateCategories.length);
  assert.equal(transfer.templates.length, raw.templates.length);
  assert.equal(transfer.quickEntries.length, raw.quickEntries.length);
  assert.ok(transfer.apps.every((app) => app.region === "cn"));
  console.log(
    `Reference bundle passed: ${transfer.apps.length} apps, ${transfer.templateCategories.length} categories, ${transfer.templates.length} templates, ${transfer.quickEntries.length} quick entries.`
  );
}

const fixturePath = path.join(rootDir, "tests", "fixtures", "pixelrunner-bundle-v2.json");
assertV2Bundle(await readBundle(fixturePath));
assertMixedBundleFallback();
assertV2AppAliasesArePreserved();
assertTemplateOnlyImport();

if (process.argv[2]) await assertExternalReference(path.resolve(process.argv[2]));
console.log("Bundle compatibility tests passed.");
