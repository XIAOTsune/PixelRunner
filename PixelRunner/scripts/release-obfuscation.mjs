import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { obfuscate } = require("javascript-obfuscator");

const BUNDLE_SEEDS = {
  "webview-core": 186431927
};

const RESERVED_RUNTIME_NAMES = [
  "^PixelRunnerModules$",
  "^PixelRunnerHost$",
  "^PixelRunnerWebviewBundle$",
  "^PixelRunnerCoreBundle$",
  "^PixelRunnerHostBundle$",
  "^require$",
  "^module$",
  "^exports$"
];

function getBundleSeed(bundleKind) {
  const seed = BUNDLE_SEEDS[bundleKind];
  if (!seed) throw new Error(`Unknown release bundle kind: ${bundleKind}`);
  return seed;
}

function getReleaseObfuscationOptions(bundleKind) {
  return {
    compact: true,
    // Keep release hardening static. Control-flow and string-array transforms
    // add per-call work to image-processing paths without making code secret.
    controlFlowFlattening: false,
    controlFlowFlatteningThreshold: 0,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: "hexadecimal",
    inputFileName: `pixelrunner-${bundleKind}.bundle.js`,
    numbersToExpressions: false,
    renameGlobals: false,
    renameProperties: false,
    reservedNames: RESERVED_RUNTIME_NAMES,
    selfDefending: false,
    simplify: true,
    sourceMap: false,
    splitStrings: false,
    stringArray: false,
    stringArrayCallsTransform: false,
    stringArrayIndexShift: false,
    stringArrayRotate: false,
    stringArrayShuffle: false,
    stringArrayThreshold: 0,
    stringArrayWrappersChainedCalls: false,
    stringArrayWrappersCount: 1,
    stringArrayWrappersParametersMaxCount: 2,
    stringArrayWrappersType: "function",
    target: "browser-no-eval",
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    seed: getBundleSeed(bundleKind)
  };
}

export async function obfuscateReleaseBundle(bundlePath, bundleKind) {
  const source = await readFile(bundlePath, "utf8");
  const result = obfuscate(source, getReleaseObfuscationOptions(bundleKind));
  await writeFile(bundlePath, result.getObfuscatedCode(), "utf8");
}
