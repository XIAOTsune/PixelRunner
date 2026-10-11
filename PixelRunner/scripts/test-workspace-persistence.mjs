import assert from "node:assert/strict";
import fs from "node:fs";

const read = (name) => fs.readFileSync(new URL(`../src/webview/${name}`, import.meta.url), "utf8");
const main = read("main.js");
const templates = read("templates.js");
const runtime = read("runtime.js");
const state = read("state.js");

assert.match(main, /await modules\.apps\.refreshWorkspaceApps\(\{ quiet: true \}\);[\s\S]*await modules\.quickEntries\.initializeQuickEntries\(\);[\s\S]*await modules\.templates\.refreshTemplates/);
assert.doesNotMatch(main, /Promise\.all\(\[[\s\S]*initializeBuiltinBundle/);
assert.match(main, /!hasData && backup/);
assert.match(main, /!hasData && !marker/);
assert.match(templates, /WORKSPACE_INIT/);
assert.match(templates, /hasStoredWorkspace/);
assert.match(templates, /backupWorkspaceFromState\(\)/);
assert.match(runtime, /schema: "pixelrunner\.workspace-backup"/);
assert.match(runtime, /version: 1/);
assert.match(state, /WORKSPACE_BACKUP/);
console.log("Workspace persistence lifecycle checks passed.");
