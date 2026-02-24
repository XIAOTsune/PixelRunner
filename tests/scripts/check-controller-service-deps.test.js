const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  detectControllerServiceViolations,
  formatViolation
} = require("../../scripts/check-controller-service-deps");

function withTempControllers(files, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pixelrunner-controller-check-"));
  try {
    Object.entries(files).forEach(([relative, content]) => {
      const absolute = path.join(root, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, content, "utf8");
    });
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("detectControllerServiceViolations passes when controllers depend on application and gateways", () => {
  withTempControllers(
    {
      "settings-controller.js": "const { createSettingsGateway } = require('../infrastructure/gateways/settings-gateway');",
      "workspace/workspace-inputs.js": "const a = require('../../application/services/workspace-input-state');"
    },
    (controllersDir) => {
      const violations = detectControllerServiceViolations({ controllersDir });
      assert.deepEqual(violations, []);
    }
  );
});

test("detectControllerServiceViolations reports require/import from services", () => {
  withTempControllers(
    {
      "workspace-controller.js": "const store = require('../services/store');\nconst ps = require('../services/ps.js');",
      "tools-controller.js": "import ps from '../services/ps.js';"
    },
    (controllersDir) => {
      const violations = detectControllerServiceViolations({ controllersDir });
      assert.equal(violations.length, 3);
      const ruleIds = violations.map((item) => item.ruleId).sort();
      assert.deepEqual(ruleIds, ["import-services", "require-services", "require-services"]);
      assert.equal(
        violations.filter((item) => /services\/ps\.js/.test(item.text)).length,
        2
      );
    }
  );
});

test("formatViolation returns relative file path and line", () => {
  const formatted = formatViolation(
    {
      file: path.join("C:", "tmp", "controllers", "workspace-controller.js"),
      line: 12,
      ruleId: "require-services",
      text: "const store = require('../services/store');"
    },
    path.join("C:", "tmp")
  );
  assert.equal(
    formatted,
    "- controllers/workspace-controller.js:12 [require-services] const store = require('../services/store');"
  );
});
