function toPrettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return "";
  }
}

function summarizeDiagnosticReport(report) {
  if (!report || typeof report !== "object") return "诊断报告不可用。";
  const lines = [];
  lines.push(`Run ID: ${report.runId || "-"}`);
  lines.push(`Time: ${report.generatedAt || "-"}`);
  lines.push(`Stage: ${report.stage || "-"}`);
  lines.push("");
  lines.push(`DOM missing ids: ${(report.dom && report.dom.missingCount) || 0}`);
  lines.push(`Apps: ${(report.dataHealth && report.dataHealth.apps && report.dataHealth.apps.count) || 0}`);
  lines.push(`Empty app ids: ${(report.dataHealth && report.dataHealth.apps && report.dataHealth.apps.emptyIdCount) || 0}`);
  lines.push("");

  const persisted = report.persisted || {};
  lines.push(`Report JSON: ${persisted.jsonPath || "未写入文件"}`);
  lines.push(`Report TXT: ${persisted.textPath || "未写入文件"}`);
  if (persisted.error) lines.push(`Persist warning: ${persisted.error}`);
  lines.push("");

  lines.push("Recommendations:");
  const recommendations = Array.isArray(report.recommendations) ? report.recommendations : [];
  if (!recommendations.length) {
    lines.push("1. (none)");
  } else {
    recommendations.forEach((item, idx) => lines.push(`${idx + 1}. ${item}`));
  }

  lines.push("");
  lines.push("Raw JSON:");
  lines.push(toPrettyJson(report));
  return lines.join("\n");
}

function summarizeParseDebugReport(debug) {
  if (!debug || typeof debug !== "object") return "Parse debug is not available.";
  const lines = [];
  lines.push(`Time: ${debug.generatedAt || "-"}`);
  lines.push(`Endpoint: ${debug.endpoint || "-"}`);
  lines.push(`App ID: ${debug.appId || "-"}`);
  lines.push("");
  lines.push(`Top-level keys: ${Array.isArray(debug.topLevelKeys) ? debug.topLevelKeys.join(", ") : "-"}`);
  lines.push(`Data keys: ${Array.isArray(debug.dataKeys) ? debug.dataKeys.join(", ") : "-"}`);
  lines.push(`Result keys: ${Array.isArray(debug.resultKeys) ? debug.resultKeys.join(", ") : "-"}`);
  lines.push("");
  lines.push(`Selected candidate: ${debug.selectedCandidatePath || "-"}`);
  lines.push(`Selected raw count: ${Number(debug.selectedRawCount) || 0}`);
  lines.push("");
  lines.push("Candidate arrays:");
  const candidates = Array.isArray(debug.candidateInputArrays) ? debug.candidateInputArrays : [];
  if (candidates.length === 0) {
    lines.push("1. (none)");
  } else {
    candidates.slice(0, 20).forEach((item, idx) => {
      lines.push(`${idx + 1}. ${item.path || "-"} | count=${Number(item.count) || 0}, inputLike=${Number(item.inputLikeCount) || 0}`);
    });
  }
  lines.push("");
  lines.push("First raw entries:");
  lines.push(toPrettyJson(Array.isArray(debug.firstRawEntries) ? debug.firstRawEntries : []));
  lines.push("");
  lines.push("Normalized inputs:");
  lines.push(toPrettyJson(Array.isArray(debug.normalizedInputs) ? debug.normalizedInputs : []));
  lines.push("");
  lines.push("Curl:");
  lines.push(toPrettyJson(debug.curl || {}));
  return lines.join("\n");
}

function loadStoredJsonReport(storageLike, storageKey) {
  if (!storageLike || typeof storageLike.getItem !== "function") return null;
  if (!storageKey) return null;
  try {
    const raw = storageLike.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  toPrettyJson,
  summarizeDiagnosticReport,
  summarizeParseDebugReport,
  loadStoredJsonReport
};
