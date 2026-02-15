function extractOutputUrl(payload) {
  if (!payload) return "";

  if (typeof payload === "string") {
    return /^https?:\/\//i.test(payload) ? payload : "";
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const url = extractOutputUrl(item);
      if (url) return url;
    }
    return "";
  }

  if (typeof payload === "object") {
    const keys = ["fileUrl", "url", "downloadUrl", "download_url", "imageUrl", "resultUrl"];
    for (const key of keys) {
      const v = payload[key];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
    }

    const nestedKeys = ["outputs", "data", "result", "list", "items", "nodeOutputs"];
    for (const key of nestedKeys) {
      const url = extractOutputUrl(payload[key]);
      if (url) return url;
    }
  }

  return "";
}

function extractTaskStatus(payload) {
  if (!payload || typeof payload !== "object") return "";
  const status = payload.status || payload.state || payload.taskStatus || "";
  return String(status).toUpperCase();
}

function isPendingStatus(status) {
  return ["PENDING", "RUNNING", "PROCESSING", "QUEUED", "QUEUE", "WAITING", "IN_PROGRESS"].includes(status);
}

function isFailedStatus(status) {
  return ["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(status);
}

function isPendingMessage(message) {
  const text = String(message || "").toLowerCase();
  return /(processing|pending|running|queue|wait|\u8fd0\u884c\u4e2d|\u6392\u961f|\u5904\u7406\u4e2d)/i.test(text);
}

module.exports = {
  extractOutputUrl,
  extractTaskStatus,
  isPendingStatus,
  isFailedStatus,
  isPendingMessage
};
