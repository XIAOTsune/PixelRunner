import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedPresets = ["classic", "aurora", "graphite", "rose", "studio", "minimal", "mist", "focus"];

globalThis.window = {};
await import("../src/webview/state.js");

const { THEME_PRESET_NAMES, normalizeTheme } = window.PixelRunnerModules.state;
assert.deepEqual([...THEME_PRESET_NAMES], expectedPresets, "theme normalization exposes every supported preset");

for (const preset of expectedPresets) {
  assert.equal(normalizeTheme({ preset }).preset, preset, `${preset} survives theme normalization`);
}

assert.deepEqual(
  normalizeTheme({ preset: "custom", basePreset: "focus", customImage: "data:image/png;base64,AA==" }),
  {
    preset: "custom",
    basePreset: "focus",
    customImage: "data:image/png;base64,AA==",
    customImageName: "",
    glass: true
  },
  "custom backgrounds preserve a new base preset"
);
assert.equal(normalizeTheme({ preset: "unknown" }).preset, "classic", "unknown presets fall back safely");

const [html, settingsSource, css] = await Promise.all([
  readFile(path.join(rootDir, "app.html"), "utf8"),
  readFile(path.join(rootDir, "src", "webview", "settings.js"), "utf8"),
  readFile(path.join(rootDir, "app.css"), "utf8")
]);

const htmlPresets = [...html.matchAll(/data-theme-preset="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(htmlPresets, expectedPresets, "settings UI lists every theme exactly once and in the intended order");

const registryStart = settingsSource.indexOf("const THEME_PRESETS = {");
const registryEnd = settingsSource.indexOf("const CUSTOM_THEME_SKIN_SELECTORS", registryStart);
assert.ok(registryStart >= 0 && registryEnd > registryStart, "theme token registry is discoverable");
const presetRegistry = settingsSource.slice(registryStart, registryEnd);
const registeredPresets = [...presetRegistry.matchAll(/^    ([a-z][a-z0-9-]*): \{/gm)].map((match) => match[1]);
assert.deepEqual(registeredPresets, expectedPresets, "theme token registry matches state and UI presets");

for (const token of [
  "--app-background",
  "--control-radius",
  "--field-radius",
  "--workspace-card-radius",
  "--layout-gap"
]) {
  assert.match(css, new RegExp(`var\\(${token.replace("--", "--")}\\)`), `${token} is consumed by the stylesheet`);
}

console.log("Theme preset checks passed.");
