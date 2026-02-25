const { RUNNINGHUB_ERROR_CODES } = require('./runninghub-error-codes');

function toMessage(result, fallback = "请求失败") {
  if (!result || typeof result !== "object") return fallback;
  return String(result.msg || result.message || fallback);
}

async function parseJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    return text ? { message: text } : null;
  }
  return response.json().catch(() => null);
}

function makeRunCancelledError(message = "用户取消运行") {
  const err = new Error(message);
  err.code = RUNNINGHUB_ERROR_CODES.RUN_CANCELLED;
  return err;
}

function throwIfCancelled(options = {}) {
  if (typeof options.shouldCancel === "function" && options.shouldCancel()) {
    throw makeRunCancelledError();
  }
  if (options.signal && options.signal.aborted) {
    throw makeRunCancelledError("用户中止");
  }
}

module.exports = {
  toMessage,
  parseJsonResponse,
  makeRunCancelledError,
  throwIfCancelled
};

