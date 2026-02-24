const { RUNNINGHUB_ERROR_CODES } = require("../runninghub-error-codes");

function createParseAppFailedError(message, options = {}) {
  const {
    appId,
    endpoint,
    reasons
  } = options && typeof options === "object" ? options : {};
  const reasonList = Array.isArray(reasons) ? reasons.filter(Boolean).map((item) => String(item)) : [];
  const error = new Error(String(message || "Parse app failed"));
  error.code = RUNNINGHUB_ERROR_CODES.PARSE_APP_FAILED;
  error.appId = String(appId || "");
  error.endpoint = String(endpoint || "");
  error.reasons = reasonList;
  error.retryable = true;
  return error;
}

module.exports = {
  createParseAppFailedError
};
