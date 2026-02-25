const manifest = require("../../manifest.json");
const { API } = require("../config");
const store = require("../services/store");
const runninghub = require("../services/runninghub");
const ps = require("../services/ps.js");

const DIAGNOSTIC_STORAGE_KEY = "rh_env_diagnostic_latest";
const REQUIRED_PS_EXPORTS = [
  "captureSelection",
  "placeImage",
  "createNeutralGrayLayer",
  "createObserverLayer",
  "stampVisibleLayers",
  "runGaussianBlur",
  "runSharpen",
  "runHighPass",
  "runContentAwareFill"
];

function nowIso() {
  return new Date().toISOString();
}

function safeError(error) {
  if (!error) return "unknown-error";
  if (typeof error === "string") return error;
  return String(error.message || error);
}

function safeJson(value, fallback = "") {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return fallback;
  }
}

function hasFn(obj, key) {
  return Boolean(obj && typeof obj[key] === "function");
}

function checkModuleExports(name, mod, requiredFns) {
  const missing = requiredFns.filter((fn) => !hasFn(mod, fn));
  return {
    module: name,
    ok: missing.length === 0,
    missing
  };
}

function checkDuplicateIds(items) {
  const counts = Object.create(null);
  (Array.isArray(items) ? items : []).forEach((item) => {
    const id = String((item && item.id) || "").trim();
    if (!id) return;
    counts[id] = (counts[id] || 0) + 1;
  });

  return Object.entries(counts)
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }));
}

function buildRequiredDomIds() {
  return [
    "tabWorkspace",
    "tabTools",
    "tabSettings",
    "viewWorkspace",
    "viewTools",
    "viewSettings",
    "btnRun",
    "btnOpenAppPicker",
    "btnRefreshWorkspaceApps",
    "appPickerModal",
    "appPickerList",
    "apiKeyInput",
    "btnSaveApiKey",
    "btnTestApiKey",
    "appIdInput",
    "btnParseApp",
    "savedAppsList",
    "templateTitleInput",
    "btnSaveTemplate",
    "savedTemplatesList"
  ];
}

function inspectDom() {
  const requiredIds = buildRequiredDomIds();
  const missingIds = requiredIds.filter((id) => !document.getElementById(id));

  const elementProto = typeof Element !== "undefined" ? Element.prototype : null;
  const supportsClosest = Boolean(elementProto && typeof elementProto.closest === "function");

  const probe = document.createElement("div");
  probe.setAttribute("data-probe", "1");
  const supportsDataset = Boolean(probe.dataset && probe.dataset.probe === "1");

  return {
    requiredCount: requiredIds.length,
    missingCount: missingIds.length,
    missingIds,
    supportsClosest,
    supportsDataset
  };
}

function inspectRuntime() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const timezone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
    } catch (_) {
      return "unknown";
    }
  })();

  return {
    timestamp: nowIso(),
    userAgent: String(nav.userAgent || ""),
    platform: String(nav.platform || ""),
    language: String(nav.language || ""),
    timezone,
    online: typeof nav.onLine === "boolean" ? nav.onLine : null,
    hasFetch: typeof fetch === "function",
    hasAbortController: typeof AbortController === "function",
    hasCustomEvent: typeof CustomEvent === "function",
    hasLocalStorage: typeof localStorage !== "undefined"
  };
}

function inspectHost() {
  let photoshopInfo = { ok: false, error: "not-checked" };
  let uxpInfo = { ok: false, error: "not-checked" };

  try {
    const photoshop = require("photoshop");
    const app = photoshop && photoshop.app;
    photoshopInfo = {
      ok: true,
      name: String((app && app.name) || "unknown"),
      version: String((app && app.version) || "unknown"),
      locale: String((app && app.locale) || "unknown")
    };
  } catch (error) {
    photoshopInfo = { ok: false, error: safeError(error) };
  }

  try {
    const uxp = require("uxp");
    const versions = (uxp && uxp.versions) || {};
    uxpInfo = {
      ok: true,
      versions: {
        uxp: String(versions.uxp || "unknown"),
        plugin: String(versions.plugin || "unknown"),
        chrome: String(versions.chrome || "unknown")
      }
    };
  } catch (error) {
    uxpInfo = { ok: false, error: safeError(error) };
  }

  return { photoshopInfo, uxpInfo };
}

function inspectDataHealth() {
  let apps = [];
  let templates = [];

  try {
    apps = store.getAiApps();
  } catch (_) {
    apps = [];
  }

  try {
    templates = store.getPromptTemplates();
  } catch (_) {
    templates = [];
  }

  return {
    apps: {
      count: Array.isArray(apps) ? apps.length : 0,
      duplicateIds: checkDuplicateIds(apps),
      emptyIdCount: (Array.isArray(apps) ? apps : []).filter((x) => !String((x && x.id) || "").trim()).length
    },
    templates: {
      count: Array.isArray(templates) ? templates.length : 0,
      duplicateIds: checkDuplicateIds(templates),
      emptyIdCount: (Array.isArray(templates) ? templates : []).filter((x) => !String((x && x.id) || "").trim()).length
    }
  };
}

async function pingUrl(url, timeoutMs = 4000) {
  const startedAt = Date.now();
  const supportsAbort = typeof AbortController === "function";
  const controller = supportsAbort ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch (_) {}
      }, timeoutMs)
    : null;

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller ? controller.signal : undefined,
      cache: "no-store"
    });

    return {
      ok: true,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      url
    };
  } catch (error) {
    return {
      ok: false,
      error: safeError(error),
      elapsedMs: Date.now() - startedAt,
      url
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function inspectNetwork() {
  const tests = [
    await pingUrl(`${API.BASE_URL}/`, 5000),
    await pingUrl(`${API.BASE_URL}${API.ENDPOINTS.PARSE_APP}?apiKey=diagnostic&webappId=1`, 5000)
  ];

  return {
    baseUrl: API.BASE_URL,
    tests
  };
}

function buildRecommendations(report) {
  const tips = [];
  const dom = report.dom;
  const dataHealth = report.dataHealth;

  if (!dom.supportsClosest) {
    tips.push("Use parent-node traversal helpers instead of Element.closest in event delegation.");
  }
  if (dom.missingCount > 0) {
    tips.push("Validate required DOM IDs at startup and fail fast when IDs are missing.");
  }
  if (dataHealth.apps.emptyIdCount > 0) {
    tips.push("Always persist AI apps with non-empty id fields; delete actions should rely on stable app.id.");
  }
  if (dataHealth.apps.duplicateIds.length > 0) {
    tips.push("Keep app.id unique in storage and mark duplicates in UI for debugging visibility.");
  }
  if (!report.modules.every((item) => item.ok)) {
    tips.push("Add module contract checks in CI to ensure required exports stay intact.");
  }
  if (report.network.tests.some((test) => !test.ok)) {
    tips.push("Add retry/backoff and clear network error reporting for startup connectivity checks.");
  }

  if (tips.length === 0) {
    tips.push("Environment checks passed. Keep this diagnostic script as a startup gate for future releases.");
  }

  return tips;
}

function buildTextReport(report) {
  const lines = [];
  lines.push("PixelRunner Environment Diagnostic Report");
  lines.push(`Run ID: ${report.runId}`);
  lines.push(`Generated At: ${report.generatedAt}`);
  lines.push(`Stage: ${report.stage}`);
  lines.push("");
  lines.push("Host");
  lines.push(`- Photoshop: ${safeJson(report.host.photoshopInfo)}`);
  lines.push(`- UXP: ${safeJson(report.host.uxpInfo)}`);
  lines.push("");
  lines.push("DOM");
  lines.push(`- Missing IDs: ${report.dom.missingCount}`);
  if (report.dom.missingCount > 0) {
    lines.push(`- Missing List: ${report.dom.missingIds.join(", ")}`);
  }
  lines.push(`- supportsClosest: ${report.dom.supportsClosest}`);
  lines.push(`- supportsDataset: ${report.dom.supportsDataset}`);
  lines.push("");
  lines.push("Data Health");
  lines.push(`- Apps: ${report.dataHealth.apps.count}, empty ids: ${report.dataHealth.apps.emptyIdCount}`);
  lines.push(`- App duplicate IDs: ${safeJson(report.dataHealth.apps.duplicateIds, "[]")}`);
  lines.push(`- Templates: ${report.dataHealth.templates.count}, empty ids: ${report.dataHealth.templates.emptyIdCount}`);
  lines.push("");
  lines.push("Module Contracts");
  report.modules.forEach((item) => {
    lines.push(`- ${item.module}: ${item.ok ? "ok" : `missing(${item.missing.join(",")})`}`);
  });
  lines.push("");
  lines.push("Network");
  report.network.tests.forEach((test, idx) => {
    const result = test.ok ? `ok status=${test.status}` : `fail error=${test.error}`;
    lines.push(`- test#${idx + 1}: ${result}, elapsed=${test.elapsedMs}ms, url=${test.url}`);
  });
  lines.push("");
  lines.push("Recommendations");
  report.recommendations.forEach((tip, idx) => {
    lines.push(`${idx + 1}. ${tip}`);
  });

  if (report.initError) {
    lines.push("");
    lines.push(`Init Error: ${report.initError}`);
  }

  return lines.join("\n");
}

async function persistReport(report, textReport) {
  const out = {
    savedToLocalStorage: false,
    jsonPath: "",
    textPath: "",
    error: ""
  };

  try {
    localStorage.setItem(DIAGNOSTIC_STORAGE_KEY, safeJson(report, "{}"));
    out.savedToLocalStorage = true;
  } catch (_) {}

  try {
    const { storage } = require("uxp");
    const fs = storage && storage.localFileSystem;
    if (!fs || typeof fs.getDataFolder !== "function") {
      return out;
    }

    const dataFolder = await fs.getDataFolder();
    const jsonFileName = `pixelrunner_diag_${report.runId}.json`;
    const textFileName = `pixelrunner_diag_${report.runId}.txt`;
    const latestJsonFileName = "pixelrunner_diag_latest.json";
    const latestTextFileName = "pixelrunner_diag_latest.txt";

    const jsonFile = await dataFolder.createFile(jsonFileName, { overwrite: true });
    await jsonFile.write(safeJson(report, "{}"));

    const textFile = await dataFolder.createFile(textFileName, { overwrite: true });
    await textFile.write(textReport);

    const latestJsonFile = await dataFolder.createFile(latestJsonFileName, { overwrite: true });
    await latestJsonFile.write(safeJson(report, "{}"));

    const latestTextFile = await dataFolder.createFile(latestTextFileName, { overwrite: true });
    await latestTextFile.write(textReport);

    out.jsonPath = jsonFile.nativePath || jsonFile.name || jsonFileName;
    out.textPath = textFile.nativePath || textFile.name || textFileName;
  } catch (error) {
    out.error = safeError(error);
  }

  return out;
}

function printConsoleSummary(report) {
  console.log("[Diag] ------------------------------");
  console.log(`[Diag] Run ID: ${report.runId}`);
  console.log(`[Diag] Stage: ${report.stage}`);
  console.log(`[Diag] Host: PS=${report.host.photoshopInfo.version || "unknown"}, UXP=${(report.host.uxpInfo.versions && report.host.uxpInfo.versions.uxp) || "unknown"}`);
  console.log(`[Diag] DOM missing IDs: ${report.dom.missingCount}`);
  console.log(`[Diag] App count: ${report.dataHealth.apps.count}, empty app IDs: ${report.dataHealth.apps.emptyIdCount}`);
  console.log(`[Diag] Network tests: ${report.network.tests.map((x) => (x.ok ? `ok:${x.status}` : "fail")).join(", ")}`);
  console.log("[Diag] Recommendations:");
  report.recommendations.forEach((tip, idx) => {
    console.log(`[Diag]   ${idx + 1}. ${tip}`);
  });
  console.log("[Diag] ------------------------------");
}

async function runPsEnvironmentDoctor(options = {}) {
  const runId = String(Date.now());
  const stage = String(options.stage || "startup");

  const report = {
    runId,
    generatedAt: nowIso(),
    stage,
    plugin: {
      id: manifest.id || "",
      name: manifest.name || "",
      version: manifest.version || "",
      host: manifest.host || {},
      requiredPermissions: manifest.requiredPermissions || {}
    },
    runtime: inspectRuntime(),
    host: inspectHost(),
    dom: inspectDom(),
    modules: [
      checkModuleExports("store", store, [
        "getApiKey",
        "saveApiKey",
        "getSettings",
        "saveSettings",
        "getAiApps",
        "addAiApp",
        "deleteAiApp",
        "getPromptTemplates",
        "addPromptTemplate",
        "deletePromptTemplate"
      ]),
      checkModuleExports("runninghub", runninghub, [
        "fetchAppInfo",
        "runAppTask",
        "pollTaskOutput",
        "downloadResultBinary",
        "testApiKey",
        "fetchAccountStatus"
      ]),
      checkModuleExports("ps", ps, [
        ...REQUIRED_PS_EXPORTS
      ])
    ],
    dataHealth: inspectDataHealth(),
    network: await inspectNetwork(),
    initError: options.initError ? safeError(options.initError) : ""
  };

  report.recommendations = buildRecommendations(report);

  const textReport = buildTextReport(report);
  report.persisted = await persistReport(report, textReport);

  printConsoleSummary(report);
  if (report.persisted.jsonPath || report.persisted.textPath) {
    console.log(`[Diag] Report files: json=${report.persisted.jsonPath}, txt=${report.persisted.textPath}`);
  }
  if (report.persisted.error) {
    console.warn(`[Diag] Persist warning: ${report.persisted.error}`);
  }

  return report;
}

module.exports = {
  runPsEnvironmentDoctor,
  DIAGNOSTIC_STORAGE_KEY,
  REQUIRED_PS_EXPORTS
};
