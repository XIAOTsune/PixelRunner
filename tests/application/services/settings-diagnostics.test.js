const test = require("node:test");
const assert = require("node:assert/strict");
const {
  toPrettyJson,
  summarizeDiagnosticReport,
  summarizeParseDebugReport,
  loadStoredJsonReport
} = require("../../../src/application/services/settings-diagnostics");

test("toPrettyJson returns empty string for circular object", () => {
  const value = {};
  value.self = value;
  assert.equal(toPrettyJson(value), "");
});

test("summarizeDiagnosticReport returns fallback for invalid report", () => {
  assert.equal(summarizeDiagnosticReport(null), "诊断报告不可用。");
});

test("summarizeDiagnosticReport includes key sections", () => {
  const text = summarizeDiagnosticReport({
    runId: "run-1",
    generatedAt: "2026-02-24T10:00:00Z",
    stage: "manual-settings",
    dom: { missingCount: 2 },
    dataHealth: { apps: { count: 5, emptyIdCount: 1 } },
    persisted: { jsonPath: "a.json", textPath: "a.txt" },
    recommendations: ["check dom", "reset cache"]
  });
  assert.match(text, /Run ID: run-1/);
  assert.match(text, /DOM missing ids: 2/);
  assert.match(text, /1\. check dom/);
  assert.match(text, /Raw JSON:/);
});

test("summarizeParseDebugReport includes candidate and normalized sections", () => {
  const text = summarizeParseDebugReport({
    generatedAt: "2026-02-24T10:00:00Z",
    endpoint: "/api/v1",
    appId: "app-1",
    topLevelKeys: ["data"],
    dataKeys: ["result"],
    resultKeys: ["inputs"],
    selectedCandidatePath: "data.result.inputs",
    selectedRawCount: 3,
    candidateInputArrays: [{ path: "data.result.inputs", count: 3, inputLikeCount: 2 }],
    firstRawEntries: [{ id: "x" }],
    normalizedInputs: [{ key: "prompt" }],
    curl: { method: "GET" }
  });
  assert.match(text, /Endpoint: \/api\/v1/);
  assert.match(text, /Candidate arrays:/);
  assert.match(text, /data\.result\.inputs \| count=3, inputLike=2/);
  assert.match(text, /Normalized inputs:/);
});

test("loadStoredJsonReport reads and parses report json", () => {
  const storageLike = {
    getItem(key) {
      if (key !== "k") return null;
      return "{\"ok\":true}";
    }
  };
  assert.deepEqual(loadStoredJsonReport(storageLike, "k"), { ok: true });
});

test("loadStoredJsonReport returns null for invalid json or unsupported storage", () => {
  const storageLike = {
    getItem() {
      return "{bad}";
    }
  };
  assert.equal(loadStoredJsonReport(storageLike, "k"), null);
  assert.equal(loadStoredJsonReport(null, "k"), null);
  assert.equal(loadStoredJsonReport({ getItem: null }, "k"), null);
  assert.equal(loadStoredJsonReport(storageLike, ""), null);
});
