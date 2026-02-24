const fs = require("fs");
const path = require("path");

const DEFAULT_CONTROLLERS_DIR = path.resolve(__dirname, "..", "src", "controllers");
const FORBIDDEN_PATTERNS = Object.freeze([
  {
    id: "require-services",
    pattern: /\brequire\s*\(\s*['"](?:\.\.\/)+services\//,
    message: "Controller cannot require ../services/* directly."
  },
  {
    id: "import-services",
    pattern: /\bfrom\s+['"](?:\.\.\/)+services\//,
    message: "Controller cannot import ../services/* directly."
  }
]);

function listJsFiles(dirPath) {
  const out = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.forEach((entry) => {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        return;
      }
      if (entry.isFile() && entry.name.endsWith(".js")) {
        out.push(absolute);
      }
    });
  }
  return out.sort();
}

function detectControllerServiceViolations(options = {}) {
  const controllersDir = path.resolve(options.controllersDir || DEFAULT_CONTROLLERS_DIR);
  const patterns = Array.isArray(options.patterns) && options.patterns.length > 0 ? options.patterns : FORBIDDEN_PATTERNS;

  if (!fs.existsSync(controllersDir)) {
    throw new Error(`Controllers directory not found: ${controllersDir}`);
  }

  const files = listJsFiles(controllersDir);
  const violations = [];
  files.forEach((filePath) => {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const normalized = line.replace(/\\/g, "/");
      patterns.forEach((rule) => {
        if (!rule || !(rule.pattern instanceof RegExp)) return;
        if (!rule.pattern.test(normalized)) return;
        violations.push({
          file: filePath,
          line: index + 1,
          text: line.trim(),
          ruleId: String(rule.id || ""),
          message: String(rule.message || "Forbidden controller dependency.")
        });
      });
    });
  });
  return violations;
}

function formatViolation(violation, cwd = process.cwd()) {
  const relativeFile = path.relative(cwd, violation.file).replace(/\\/g, "/");
  return `- ${relativeFile}:${violation.line} [${violation.ruleId}] ${violation.text}`;
}

function runCli() {
  const violations = detectControllerServiceViolations();
  if (violations.length === 0) {
    console.log("Controller dependency check passed: no direct services import.");
    return 0;
  }

  console.error("Controller dependency check failed:");
  violations.forEach((item) => {
    console.error(formatViolation(item));
  });
  return 1;
}

if (require.main === module) {
  process.exitCode = runCli();
}

module.exports = {
  DEFAULT_CONTROLLERS_DIR,
  FORBIDDEN_PATTERNS,
  listJsFiles,
  detectControllerServiceViolations,
  formatViolation,
  runCli
};
