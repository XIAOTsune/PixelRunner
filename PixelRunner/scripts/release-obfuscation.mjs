import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { obfuscate } = require("javascript-obfuscator");

const BUNDLE_SEEDS = {
  webview: 186431927,
  host: 593018447
};

const RESERVED_RUNTIME_NAMES = [
  "^PixelRunnerModules$",
  "^PixelRunnerHost$",
  "^PixelRunnerWebviewBundle$",
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
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.6,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: "hexadecimal",
    inputFileName: `pixelrunner-${bundleKind}.bundle.js`,
    numbersToExpressions: true,
    renameGlobals: false,
    renameProperties: false,
    reservedNames: RESERVED_RUNTIME_NAMES,
    selfDefending: false,
    simplify: true,
    sourceMap: false,
    splitStrings: true,
    splitStringsChunkLength: 8,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayCallsTransformThreshold: 0.8,
    stringArrayEncoding: ["rc4"],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayThreshold: 0.85,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersCount: 3,
    stringArrayWrappersParametersMaxCount: 4,
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
