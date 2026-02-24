const UPLOAD_MAX_EDGE_CHOICES = [0, 1024, 2048, 4096];
const UPLOAD_MAX_EDGE_RETRY_CHAIN = [1024, 2048, 4096, 0];

function normalizeUploadMaxEdge(rawValue) {
  const num = Number(rawValue);
  if (!Number.isFinite(num)) return 0;
  return UPLOAD_MAX_EDGE_CHOICES.includes(num) ? num : 0;
}

function getUploadMaxEdgeLabel(rawValue) {
  const normalized = normalizeUploadMaxEdge(rawValue);
  return normalized > 0 ? `${normalized}px` : "unlimited";
}

function buildUploadMaxEdgeCandidates(rawValue) {
  const normalized = normalizeUploadMaxEdge(rawValue);
  if (normalized <= 0) return [0];
  const index = UPLOAD_MAX_EDGE_RETRY_CHAIN.indexOf(normalized);
  if (index < 0) return [0];
  return UPLOAD_MAX_EDGE_RETRY_CHAIN.slice(index);
}

function shouldRetryWithNextUploadEdge(error) {
  if (!error) return true;
  if (error.code === "RUN_CANCELLED") return false;
  if (error.localValidation) return false;

  const message = String(error.message || error || "").toLowerCase();
  if (!message) return true;
  const nonRetryMarkers = [
    "missing required parameter",
    "invalid number parameter",
    "invalid boolean parameter",
    "image input is invalid",
    "no parameters to submit",
    "param apikey is required",
    "param api key is required",
    "api key is required"
  ];
  return !nonRetryMarkers.some((marker) => message.includes(marker));
}

module.exports = {
  normalizeUploadMaxEdge,
  getUploadMaxEdgeLabel,
  buildUploadMaxEdgeCandidates,
  shouldRetryWithNextUploadEdge
};
