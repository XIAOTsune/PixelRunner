const { API } = require("../config");
const { normalizeAppId, inferInputType } = require("../utils");
const { parseJsonFromEscapedText } = require("./runninghub-parser/json-utils");
const { collectSourceCandidates } = require("./runninghub-parser/source-candidate-strategy");
const { createParseAppFailedError } = require("./runninghub-parser/parse-error-strategy");
const {
  normalizeInput,
  isGhostSchemaInput,
  mergeInputsWithFallback
} = require("./runninghub-parser/input-normalize-strategy");

const PARSE_DEBUG_STORAGE_KEY = "rh_last_parse_debug";

function extractNodeInfoListFromCurl(curlText) {
  if (typeof curlText !== "string" || !curlText.trim()) return [];
  const raw = curlText.trim();
  const patterns = [
    /--data-raw\s+'([\s\S]*?)'(?:\s|$)/i,
    /--data\s+'([\s\S]*?)'(?:\s|$)/i,
    /--data-raw\s+"([\s\S]*?)"(?:\s|$)/i,
    /--data\s+"([\s\S]*?)"(?:\s|$)/i
  ];

  let bodyRaw = "";
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      bodyRaw = match[1];
      break;
    }
  }
  if (!bodyRaw) {
    const bodyMatch = raw.match(/\{[\s\S]*\}/);
    bodyRaw = bodyMatch ? bodyMatch[0] : "";
  }
  if (!bodyRaw) return [];

  const direct = parseJsonFromEscapedText(bodyRaw);
  if (direct && Array.isArray(direct.nodeInfoList)) return direct.nodeInfoList;

  const fragment = bodyRaw.match(/"nodeInfoList"\s*:\s*(\[[\s\S]*?\])\s*(?:,|\})/);
  if (fragment && fragment[1]) {
    const list = parseJsonFromEscapedText(fragment[1]);
    if (Array.isArray(list)) return list;
  }
  return [];
}

function extractNodeInfoListFromText(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) return [];
  const fromCurl = extractNodeInfoListFromCurl(rawText);
  if (fromCurl.length > 0) return fromCurl;

  const jsonCandidate = parseJsonFromEscapedText(rawText);
  if (jsonCandidate && Array.isArray(jsonCandidate.nodeInfoList)) return jsonCandidate.nodeInfoList;

  const fragment = rawText.match(/"nodeInfoList"\s*:\s*(\[[\s\S]*?\])\s*(?:,|\})/);
  if (fragment && fragment[1]) {
    const list = parseJsonFromEscapedText(fragment[1]);
    if (Array.isArray(list)) return list;
  }
  return [];
}

function findCurlDemoText(data, depth = 0) {
  if (!data || typeof data !== "object" || depth > 8) return "";
  const keys = ["curl", "curlCmd", "curlCommand", "apiCallDemo", "requestDemo", "requestExample", "demo", "example", "doc", "docs", "apiDoc", "apiDocs"];
  for (const key of keys) {
    if (typeof data[key] === "string" && data[key].trim()) return data[key];
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findCurlDemoText(item, depth + 1);
      if (found) return found;
    }
    return "";
  }

  for (const value of Object.values(data)) {
    if (!value || typeof value !== "object") continue;
    const found = findCurlDemoText(value, depth + 1);
    if (found) return found;
  }
  return "";
}

function isLikelyInputRecord(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  if (String(item.key || item.paramKey || "").trim()) return true;
  if (String(item.fieldName || "").trim()) return true;
  if (String(item.nodeId || item.nodeID || "").trim() && String(item.fieldName || "").trim()) return true;
  if (item.fieldData !== undefined && (item.fieldName || item.key || item.paramKey)) return true;
  if ((item.default !== undefined || item.fieldValue !== undefined) && (item.name || item.label || item.fieldName || item.key)) return true;
  const marker = String(item.type || item.fieldType || item.inputType || item.widget || item.valueType || "").trim();
  return Boolean(marker);
}

function toInputListFromUnknown(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const values = Object.values(value);
  if (!values.length) return [];
  const inputLike = values.filter(isLikelyInputRecord);
  if (inputLike.length === 0) return [];
  if (inputLike.length === values.length || inputLike.length >= 1) return inputLike;
  return [];
}

function collectInputCandidates(source, depth = 0, path = "root", out = []) {
  if (!source || depth > 8) return out;
  if (Array.isArray(source)) {
    const inputLikeCount = source.filter(isLikelyInputRecord).length;
    if (source.length > 0 && inputLikeCount > 0) {
      out.push({ path, list: source, inputLikeCount, nodeBindingCount: getNodeBindingCount(source) });
    }
    source.forEach((item, idx) => collectInputCandidates(item, depth + 1, `${path}[${idx}]`, out));
    return out;
  }
  if (typeof source !== "object") return out;

  const objectList = toInputListFromUnknown(source);
  if (objectList.length > 0) {
    out.push({
      path,
      list: objectList,
      inputLikeCount: objectList.filter(isLikelyInputRecord).length,
      nodeBindingCount: getNodeBindingCount(objectList)
    });
  }

  for (const [key, value] of Object.entries(source)) {
    collectInputCandidates(value, depth + 1, `${path}.${key}`, out);
  }
  return out;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const deduped = [];
  for (const item of candidates || []) {
    if (!item || !Array.isArray(item.list) || item.list.length === 0) continue;
    const marker = `${item.path}|${item.list.length}|${item.inputLikeCount || 0}`;
    if (seen.has(marker)) continue;
    seen.add(marker);
    deduped.push(item);
  }
  return deduped.sort((a, b) => {
    if ((b.nodeBindingCount || 0) !== (a.nodeBindingCount || 0)) {
      return (b.nodeBindingCount || 0) - (a.nodeBindingCount || 0);
    }
    if ((b.inputLikeCount || 0) !== (a.inputLikeCount || 0)) return (b.inputLikeCount || 0) - (a.inputLikeCount || 0);
    return b.list.length - a.list.length;
  });
}

function getNodeBindingCount(list) {
  if (!Array.isArray(list)) return 0;
  let count = 0;
  list.forEach((item) => {
    if (!item || typeof item !== "object") return;
    if (String(item.nodeId || item.nodeID || "").trim() && String(item.fieldName || item.field || "").trim()) count += 1;
  });
  return count;
}

function sanitizeDebugRawEntry(raw) {
  if (!raw || typeof raw !== "object") return raw;
  return {
    key: raw.key || raw.paramKey || "",
    name: raw.name || raw.label || raw.title || "",
    nodeId: raw.nodeId || raw.nodeID || "",
    fieldName: raw.fieldName || "",
    type: raw.type || raw.fieldType || raw.inputType || raw.widget || raw.valueType || "",
    required: raw.required,
    default: raw.default ?? raw.fieldValue,
    hasFieldData: raw.fieldData !== undefined,
    optionsCount: Array.isArray(raw.options) ? raw.options.length : undefined
  };
}

function normalizeNameKey(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isMeaningfulAppName(name) {
  const text = String(name || "").trim();
  if (!text) return false;
  const marker = text.toLowerCase();
  if (marker === "unknown app" || marker === "unknown" || marker === "unnamed app" || marker === "app") return false;
  return true;
}

function scoreAppNameCandidate(name, key, depth) {
  const text = String(name || "").trim();
  if (!isMeaningfulAppName(text)) return 0;
  const keyWeight = {
    webappname: 50,
    appname: 46,
    workflowname: 44,
    displayname: 42,
    title: 38,
    name: 34
  };
  const normalizedKey = normalizeNameKey(key);
  const base = keyWeight[normalizedKey] || 20;
  const lengthScore = Math.min(12, text.length);
  const depthPenalty = Math.max(0, Number(depth) || 0);
  return base + lengthScore - depthPenalty;
}

function pushAppNameCandidate(bucket, seen, value, key, depth) {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  if (!isMeaningfulAppName(text)) return;
  const marker = text.toLowerCase();
  if (seen.has(marker)) return;
  seen.add(marker);
  bucket.push({
    value: text,
    key: normalizeNameKey(key),
    depth: Number(depth) || 0,
    score: scoreAppNameCandidate(text, key, depth)
  });
}

function collectAppNameCandidatesFromValue(value, depth = 0, bucket = [], seen = new Set(), parentKey = "") {
  if (depth > 8 || value === undefined || value === null) return bucket;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const normalizedParent = normalizeNameKey(parentKey);
    if (normalizedParent === "name" || normalizedParent === "title" || normalizedParent === "appname" || normalizedParent === "webappname" || normalizedParent === "workflowname" || normalizedParent === "displayname") {
      pushAppNameCandidate(bucket, seen, value, normalizedParent, depth);
    }
    if (typeof value === "string") {
      const parsed = parseJsonFromEscapedText(value);
      if (parsed !== undefined) {
        collectAppNameCandidatesFromValue(parsed, depth + 1, bucket, seen, "");
      }
    }
    return bucket;
  }

  if (Array.isArray(value)) {
    value.slice(0, 30).forEach((item) => collectAppNameCandidatesFromValue(item, depth + 1, bucket, seen, parentKey));
    return bucket;
  }

  if (typeof value !== "object") return bucket;

  const directKeys = ["webappName", "appName", "workflowName", "displayName", "title", "name"];
  for (const key of directKeys) {
    if (value[key] !== undefined) pushAppNameCandidate(bucket, seen, value[key], key, depth);
  }

  for (const [key, child] of Object.entries(value)) {
    collectAppNameCandidatesFromValue(child, depth + 1, bucket, seen, key);
  }
  return bucket;
}

function resolveBestAppName(data, fallback = "Unknown App") {
  if (!data || typeof data !== "object") return fallback;
  const candidates = collectAppNameCandidatesFromValue(data, 0, [], new Set(), "");
  if (!Array.isArray(candidates) || candidates.length === 0) return fallback;
  candidates.sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return (a.depth || 0) - (b.depth || 0);
  });
  const best = candidates[0];
  return best && best.value ? best.value : fallback;
}

function extractAppInfoPayload(data) {
  const parsedString = typeof data === "string" ? parseJsonFromEscapedText(data) : undefined;
  if (parsedString && typeof parsedString === "object") return extractAppInfoPayload(parsedString);

  if (Array.isArray(data)) {
    if (data.some(isLikelyInputRecord)) {
      return extractAppInfoPayload({ nodeInfoList: data });
    }
    return {
      payload: { name: "Unknown App", description: "", inputs: [] },
      debug: { candidates: [], selectedPath: "", selectedRawCount: 0, selectedRawPreview: [], curlFound: false, curlNodeInfoCount: 0 }
    };
  }

  if (!data || typeof data !== "object") {
    return {
      payload: { name: "Unknown App", description: "", inputs: [] },
      debug: { candidates: [], selectedPath: "", selectedRawCount: 0, selectedRawPreview: [], curlFound: false, curlNodeInfoCount: 0 }
    };
  }

  const legacySources = [
    data.nodeInfoList,
    data.inputs,
    data.params,
    data.inputParams,
    data.nodeList,
    data.workflow && data.workflow.inputs,
    data.workflow && data.workflow.nodeInfoList,
    data.appInfo && data.appInfo.nodeInfoList,
    data.webappInfo && data.webappInfo.nodeInfoList,
    data.webappInfo && data.webappInfo.nodeList,
    data.workflow && data.workflow.nodeList,
    data.workflow && data.workflow.nodes,
    data.nodeInfo,
    data.nodeInfos,
    data.data && data.data.nodeInfo,
    data.data && data.data.nodeInfos,
    data.data && data.data.nodeInfoList,
    data.data && data.data.inputs,
    data.result && data.result.nodeInfoList,
    data.result && data.result.inputs
  ];

  const legacyCandidates = legacySources
    .map((value, idx) => {
      const list = toInputListFromUnknown(value);
      return {
        path: `legacyCandidate[${idx}]`,
        list,
        inputLikeCount: list.filter(isLikelyInputRecord).length,
        nodeBindingCount: getNodeBindingCount(list)
      };
    })
    .filter((item) => Array.isArray(item.list) && item.list.length > 0);

  const deepCandidates = collectInputCandidates(data, 0, "root", []);
  const candidateList = dedupeCandidates([...legacyCandidates, ...deepCandidates]);
  const selected = candidateList[0] || { path: "", list: [] };
  const rawInputs = Array.isArray(selected.list) ? selected.list : [];

  const primaryInputs = rawInputs
    .map((item, idx) => ({ raw: item, input: normalizeInput(item, idx) }))
    .filter((item) => item && item.input && item.input.key)
    .filter((item) => !isGhostSchemaInput(item.raw, item.input))
    .map((item) => item.input);

  const altCandidates = candidateList.filter((item) => item && item.path && item.path !== selected.path).slice(0, 3);
  const altInputs = altCandidates
    .flatMap((candidate) => {
      const list = Array.isArray(candidate.list) ? candidate.list : [];
      return list
        .map((item, idx) => ({ raw: item, input: normalizeInput(item, idx) }))
        .filter((item) => item && item.input && item.input.key)
        .filter((item) => !isGhostSchemaInput(item.raw, item.input))
        .map((item) => item.input);
    })
    .filter(Boolean);

  const curlDemoText = findCurlDemoText(data);
  const curlNodeInfoList = extractNodeInfoListFromText(curlDemoText);
  const curlInputs = curlNodeInfoList
    .map((item, idx) => normalizeInput(item, idx))
    .filter((item) => item.key);
  const fallbackInputs = [...altInputs, ...curlInputs];
  const inputs = mergeInputsWithFallback(primaryInputs, fallbackInputs);

  return {
    payload: {
      name: resolveBestAppName(data, "Unknown App"),
      description: data.description || data.desc || data.summary || "",
      inputs
    },
    debug: {
      candidates: candidateList.map((item) => ({ path: item.path, count: item.list.length, inputLikeCount: item.inputLikeCount || 0 })),
      selectedPath: selected.path || "",
      selectedRawCount: rawInputs.length,
      selectedRawPreview: rawInputs.slice(0, 5).map(sanitizeDebugRawEntry),
      labelDecisionPreview: inputs.slice(0, 6).map((item) => ({
        key: item.key,
        label: item.label,
        labelSource: item.labelSource,
        labelConfidence: item.labelConfidence,
        fieldName: item.fieldName
      })),
      curlFound: Boolean(curlDemoText),
      curlNodeInfoCount: Array.isArray(curlNodeInfoList) ? curlNodeInfoList.length : 0
    }
  };
}

function persistParseDebug(debugPayload) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PARSE_DEBUG_STORAGE_KEY, JSON.stringify(debugPayload));
  } catch (_) {}
}

function buildParseDebugRecord(endpoint, appId, result, source, parseDebug, payload) {
  return {
    endpoint,
    appId,
    topLevelKeys: Object.keys(result || {}),
    dataKeys: source && typeof source === "object" ? Object.keys(source) : [],
    resultKeys: result && result.result && typeof result.result === "object" ? Object.keys(result.result) : [],
    candidateInputArrays: parseDebug.candidates || [],
    selectedCandidatePath: parseDebug.selectedPath || "",
    selectedRawCount: parseDebug.selectedRawCount || 0,
    firstRawEntries: parseDebug.selectedRawPreview || [],
    normalizedInputs: (payload.inputs || []).map((item) => ({
      key: item.key,
      type: inferInputType(item.type || item.fieldType),
      label: item.label || item.name || item.key
    })),
    curl: {
      found: Boolean(parseDebug.curlFound),
      nodeInfoCount: parseDebug.curlNodeInfoCount || 0
    },
    generatedAt: new Date().toISOString()
  };
}

function pickBestParsedPayload(candidates) {
  let best = null;
  for (const source of candidates || []) {
    const parsed = extractAppInfoPayload(source);
    const payload = parsed && parsed.payload ? parsed.payload : { name: "Unknown App", description: "", inputs: [] };
    const inputs = Array.isArray(payload.inputs) ? payload.inputs : [];
    const score = inputs.length;
    const rawCount = Number(parsed && parsed.debug && parsed.debug.selectedRawCount) || 0;
    const nameScore = isMeaningfulAppName(payload && payload.name) ? 1 : 0;

    if (!best) {
      best = { source, parsed, payload, score, rawCount, nameScore };
      continue;
    }
    if (score > best.score) {
      best = { source, parsed, payload, score, rawCount, nameScore };
      continue;
    }
    if (score === best.score && nameScore > best.nameScore) {
      best = { source, parsed, payload, score, rawCount, nameScore };
      continue;
    }
    if (score === best.score && nameScore === best.nameScore && rawCount > best.rawCount) {
      best = { source, parsed, payload, score, rawCount, nameScore };
    }
  }
  return best;
}

function hasUsablePayload(result) {
  const candidates = collectSourceCandidates(result, { parseJsonFromEscapedText });
  const best = pickBestParsedPayload(candidates);
  return Boolean(best && Array.isArray(best.payload && best.payload.inputs) && best.payload.inputs.length > 0);
}

function buildParseUrl(pathname, queryParams) {
  const url = new URL(`${API.BASE_URL}${pathname}`);
  Object.entries(queryParams || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, value);
  });
  return url.toString();
}

function buildFallbackUrls(endpoint, normalizedId) {
  const urls = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  push(`${API.BASE_URL}${endpoint}/${encodeURIComponent(normalizedId)}`);
  push(buildParseUrl(endpoint, { webappId: normalizedId }));
  push(buildParseUrl(endpoint, { webAppId: normalizedId }));
  push(buildParseUrl(endpoint, { appId: normalizedId }));
  push(buildParseUrl(endpoint, { id: normalizedId }));
  return urls;
}

async function fetchAppInfoCore(params = {}) {
  const { appId, apiKey, options = {}, helpers = {} } = params;
  const { fetchImpl, parseJsonResponse, toMessage } = helpers;
  const safeFetch = typeof fetchImpl === "function" ? fetchImpl : fetch;
  const safeParseJsonResponse =
    typeof parseJsonResponse === "function"
      ? parseJsonResponse
      : async (response) => response.json().catch(() => null);
  const safeToMessage = typeof toMessage === "function" ? toMessage : ((result, fallback = "\u8bf7\u6c42\u5931\u8d25") => fallback);

  const log = options.log || (() => {});
  const normalizedId = normalizeAppId(appId);
  const reasons = [];
  let lastParseSnapshot = null;

  persistParseDebug({
    endpoint: API.ENDPOINTS.PARSE_APP,
    appId: normalizedId,
    phase: "request_start",
    generatedAt: new Date().toISOString()
  });

  const tryHandleResult = (endpoint, result) => {
    const candidates = collectSourceCandidates(result, { parseJsonFromEscapedText });
    const best = pickBestParsedPayload(candidates);
    if (!best) return null;

    const payload = best.payload || { name: "Unknown App", description: "", inputs: [] };
    const globalName = resolveBestAppName(result, "");
    if (!isMeaningfulAppName(payload.name) && isMeaningfulAppName(globalName)) {
      payload.name = globalName;
    }
    lastParseSnapshot = buildParseDebugRecord(
      endpoint,
      normalizedId,
      result,
      best.source,
      best.parsed && best.parsed.debug ? best.parsed.debug : {},
      payload
    );
    if (Array.isArray(payload.inputs) && payload.inputs.length > 0) {
      persistParseDebug(lastParseSnapshot);
      return payload;
    }
    return null;
  };

  const parseGetVariants = [
    { apiKey, webappId: normalizedId },
    { apiKey, webAppId: normalizedId },
    { apiKey, appId: normalizedId },
    { apikey: apiKey, webappId: normalizedId }
  ];
  for (const query of parseGetVariants) {
    try {
      log(`\u89e3\u6790\u5e94\u7528: ${API.ENDPOINTS.PARSE_APP}`, "info");
      const response = await safeFetch(buildParseUrl(API.ENDPOINTS.PARSE_APP, query), {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
      });
      const result = await safeParseJsonResponse(response);
      const payload = tryHandleResult(API.ENDPOINTS.PARSE_APP, result);
      if (payload) return payload;

      if (response.ok && (result && (result.code === 0 || result.success === true || hasUsablePayload(result)))) {
        const retryPayload = tryHandleResult(API.ENDPOINTS.PARSE_APP, result);
        if (retryPayload) return retryPayload;
      }
      reasons.push(`apiCallDemo(GET): ${safeToMessage(result, `HTTP ${response.status}`)}`);
    } catch (error) {
      reasons.push(`apiCallDemo(GET): ${error.message}`);
    }
  }

  const parsePostVariants = [
    { apiKey, webappId: normalizedId },
    { apiKey, webAppId: normalizedId },
    { apiKey, appId: normalizedId }
  ];
  for (const body of parsePostVariants) {
    try {
      const response = await safeFetch(`${API.BASE_URL}${API.ENDPOINTS.PARSE_APP}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await safeParseJsonResponse(response);
      const payload = tryHandleResult(API.ENDPOINTS.PARSE_APP, result);
      if (payload) return payload;
      reasons.push(`apiCallDemo(POST): ${safeToMessage(result, `HTTP ${response.status}`)}`);
    } catch (error) {
      reasons.push(`apiCallDemo(POST): ${error.message}`);
    }
  }

  for (const endpoint of API.PARSE_FALLBACKS) {
    const urls = buildFallbackUrls(endpoint, normalizedId);
    for (const url of urls) {
      try {
        log(`\u89e3\u6790\u5e94\u7528\u56de\u9000: ${endpoint}`, "info");
        const response = await safeFetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
        });
        const result = await safeParseJsonResponse(response);
        const payload = tryHandleResult(endpoint, result);
        if (payload) return payload;
        if (response.ok && (result && (result.code === 0 || result.success === true || hasUsablePayload(result)))) {
          const retryPayload = tryHandleResult(endpoint, result);
          if (retryPayload) return retryPayload;
        }
        reasons.push(`${endpoint}: ${safeToMessage(result, `HTTP ${response.status}`)}`);
      } catch (error) {
        reasons.push(`${endpoint}: ${error.message}`);
      }
    }
  }

  const message = reasons[0] || "\u81ea\u52a8\u89e3\u6790\u5931\u8d25\uff1a\u672a\u8bc6\u522b\u5230\u53ef\u7528\u8f93\u5165\u53c2\u6570";
  if (lastParseSnapshot) {
    persistParseDebug({
      ...lastParseSnapshot,
      phase: "request_failed",
      message,
      generatedAt: new Date().toISOString()
    });
  } else {
    persistParseDebug({
      endpoint: API.ENDPOINTS.PARSE_APP,
      appId: normalizedId,
      phase: "request_failed",
      message,
      generatedAt: new Date().toISOString()
    });
  }
  throw createParseAppFailedError(message, {
    appId: normalizedId,
    endpoint: API.ENDPOINTS.PARSE_APP,
    reasons
  });
}

module.exports = {
  fetchAppInfoCore
};

