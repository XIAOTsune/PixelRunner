import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function assertOutsideRepository(filePath) {
  const relative = path.relative(rootDir, filePath);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("拒绝将私钥写入项目目录。请使用仓库外的绝对路径。");
  }
}

async function main() {
  const requestedPath = readArg("--private-key-file");
  if (!requestedPath || !path.isAbsolute(requestedPath)) {
    throw new Error("必须提供仓库外的绝对路径：--private-key-file <absolute-path>");
  }
  const privateKeyPath = path.resolve(requestedPath);
  assertOutsideRepository(privateKeyPath);

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  await mkdir(path.dirname(privateKeyPath), { recursive: true });
  await writeFile(privateKeyPath, privateKey.export({ format: "pem", type: "pkcs8" }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  const publicJwk = publicKey.export({ format: "jwk" });

  // Deliberately print only public material. The private PEM is never logged.
  console.log(JSON.stringify({
    keyIdHint: "pr-YYYY-MM",
    publicKeyBase64Url: publicJwk.x,
    privateKeyFile: privateKeyPath
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
