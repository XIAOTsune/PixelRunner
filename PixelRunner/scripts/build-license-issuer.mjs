import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");

await build({
  bundle: true,
  charset: "utf8",
  entryPoints: [path.join(rootDir, "src", "license-issuer-entry.js")],
  format: "iife",
  legalComments: "none",
  minify: true,
  outfile: path.join(rootDir, "license-issuer.bundle.js"),
  sourcemap: false,
  target: ["es2020"]
});

console.log("Offline license issuer bundle built successfully.");
