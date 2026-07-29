import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function isInside(parent, candidate) {
  if (path.parse(parent).root.toLowerCase() !== path.parse(candidate).root.toLowerCase()) return false;
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

const privateKeyFile = readOption("--private-key-file");
const outputFile = readOption("--out") || path.join(rootDir, "像素起子激活码生成器.html");
const allowEmbeddedPrivateKey = process.argv.includes("--allow-embedded-private-key");

if (!privateKeyFile) {
  throw new Error("缺少 --private-key-file <仓库外的 Ed25519 PKCS#8 PEM 路径>");
}

const resolvedPrivateKeyFile = path.resolve(privateKeyFile);
const resolvedOutputFile = path.resolve(outputFile);
if (isInside(rootDir, resolvedPrivateKeyFile)) {
  throw new Error("签发私钥必须保存在仓库外部");
}
if (isInside(rootDir, resolvedOutputFile) && !allowEmbeddedPrivateKey) {
  throw new Error("拒绝将私钥嵌入项目文件。仅限个人离线工具时，显式传入 --allow-embedded-private-key。");
}

const pem = await fs.readFile(resolvedPrivateKeyFile, "utf8");
const bundle = await build({
  bundle: true,
  charset: "utf8",
  define: {
    __PIXELRUNNER_ISSUER_PRIVATE_PEM_BASE64__: JSON.stringify(Buffer.from(pem, "utf8").toString("base64"))
  },
  entryPoints: [path.join(rootDir, "src", "license-issuer-private-entry.js")],
  format: "iife",
  legalComments: "none",
  minify: true,
  sourcemap: false,
  target: ["es2020"],
  write: false
});
const template = await fs.readFile(path.join(rootDir, "src", "license-issuer-private-template.html"), "utf8");
const script = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = template.replace("__PIXELRUNNER_ISSUER_BUNDLE__", () => script);

await fs.mkdir(path.dirname(resolvedOutputFile), { recursive: true });
await fs.writeFile(resolvedOutputFile, html, "utf8");
console.log(`Personal offline license issuer built: ${resolvedOutputFile}`);
