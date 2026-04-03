const DEFAULT_SOURCE_KEYS = [
  "data",
  "result",
  "payload",
  "content",
  "body",
  "value",
  "appInfo",
  "webappInfo",
  "workflow",
  "nodeInfoList",
  "inputs",
  "params"
];

function buildSourceCandidateMarker(candidate) {
  if (Array.isArray(candidate)) {
    const first = candidate[0];
    const firstShape =
      first && typeof first === "object"
        ? Object.keys(first)
            .sort()
            .slice(0, 6)
            .join(",")
        : typeof first;
    return `arr:${candidate.length}:${firstShape}`;
  }
  return `obj:${Object.keys(candidate || {})
    .sort()
    .slice(0, 12)
    .join(",")}`;
}

function pushSourceCandidate(bucket, seenMarkers, candidate) {
  if (!candidate || (typeof candidate !== "object" && !Array.isArray(candidate))) return;
  const marker = buildSourceCandidateMarker(candidate);
  if (seenMarkers.has(marker)) return;
  seenMarkers.add(marker);
  bucket.push(candidate);
}

function collectSourceCandidatesFromValue(value, options = {}, depth = 0, bucket = [], seenMarkers = new Set()) {
  const maxDepth = Number.isFinite(Number(options.maxDepth)) ? Number(options.maxDepth) : 6;
  if (depth > maxDepth || value === null || value === undefined) return bucket;

  const parseJsonFromEscapedText =
    typeof options.parseJsonFromEscapedText === "function" ? options.parseJsonFromEscapedText : null;

  if (typeof value === "string") {
    if (!parseJsonFromEscapedText) return bucket;
    const parsed = parseJsonFromEscapedText(value);
    if (parsed !== undefined) {
      collectSourceCandidatesFromValue(parsed, options, depth + 1, bucket, seenMarkers);
    }
    return bucket;
  }

  if (Array.isArray(value)) {
    pushSourceCandidate(bucket, seenMarkers, value);
    value.slice(0, 20).forEach((item) => collectSourceCandidatesFromValue(item, options, depth + 1, bucket, seenMarkers));
    return bucket;
  }

  if (typeof value !== "object") return bucket;
  pushSourceCandidate(bucket, seenMarkers, value);

  const sourceKeys = Array.isArray(options.sourceKeys) && options.sourceKeys.length > 0 ? options.sourceKeys : DEFAULT_SOURCE_KEYS;
  sourceKeys.forEach((key) => {
    if (value[key] !== undefined) collectSourceCandidatesFromValue(value[key], options, depth + 1, bucket, seenMarkers);
  });

  return bucket;
}

function collectSourceCandidates(result, options = {}) {
  const bucket = [];
  const seenMarkers = new Set();
  collectSourceCandidatesFromValue(result, options, 0, bucket, seenMarkers);
  if (result && typeof result === "object") {
    pushSourceCandidate(bucket, seenMarkers, result);
    if (result.data !== undefined) collectSourceCandidatesFromValue(result.data, options, 0, bucket, seenMarkers);
    if (result.result !== undefined) collectSourceCandidatesFromValue(result.result, options, 0, bucket, seenMarkers);
  }
  return bucket;
}

module.exports = {
  DEFAULT_SOURCE_KEYS,
  pushSourceCandidate,
  collectSourceCandidatesFromValue,
  collectSourceCandidates
};
