import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.join(rootDir, "local-ai", "runtime");
const runtimeExecutable = path.join(runtimeDir, "python.exe");
const runtimeManifest = JSON.parse(await readFile(path.join(rootDir, "local-ai", "runtime.json"), "utf8"));
const serviceTest = path.join(rootDir, "local-ai", "test_server.py");

assert.equal(process.platform, "win32", "the bundled local AI runtime is Windows-only");
assert.equal(runtimeManifest.runtime, "CPython");
assert.equal(runtimeManifest.distribution, "embeddable");
assert.match(runtimeManifest.version, /^3\.12\.\d+$/);
assert.match(runtimeManifest.archiveSha256, /^[A-F0-9]{64}$/);

for (const name of ["python.exe", "pythonw.exe", "python312.dll", "python312.zip", "python312._pth", "LICENSE.txt"]) {
  await access(path.join(runtimeDir, name));
}
assert.ok((await stat(runtimeExecutable)).size > 0, "bundled Python executable is nonempty");

const testEnvironment = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
const version = await execFileAsync(runtimeExecutable, ["--version"], {
  cwd: rootDir,
  env: testEnvironment,
  windowsHide: true
});
assert.match(`${version.stdout}\n${version.stderr}`, /^Python 3\.12\.10/m);

const service = await execFileAsync(runtimeExecutable, [serviceTest], {
  cwd: rootDir,
  env: testEnvironment,
  windowsHide: true
});
assert.match(`${service.stdout}\n${service.stderr}`, /Ran 10 tests/);
assert.match(`${service.stdout}\n${service.stderr}`, /OK/);

console.log("Bundled Local AI runtime tests passed.");
