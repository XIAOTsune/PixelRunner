const { normalizeAppId } = require("../../utils");

function parseTaskId(result) {
  if (!result || typeof result !== "object") return "";
  return (
    (result.data && (result.data.taskId || result.data.id)) ||
    result.taskId ||
    result.id ||
    ""
  );
}

function buildAiAppRunBodyCandidates(apiKey, appId, nodeInfoList) {
  const normalizedId = normalizeAppId(appId);
  return [
    { apiKey, webappId: normalizedId, nodeInfoList },
    { apiKey, webAppId: normalizedId, nodeInfoList },
    { apiKey, appId: normalizedId, nodeInfoList }
  ];
}

function buildLegacyCreateTaskBody(apiKey, appId, nodeParams) {
  return {
    apiKey,
    workflowId: normalizeAppId(appId),
    nodeParams
  };
}

function getTaskCreationOutcome(response, result) {
  const taskId = parseTaskId(result);
  const success = Boolean(
    response &&
      response.ok &&
      result &&
      (result.code === 0 || result.success === true) &&
      taskId
  );
  return { success, taskId };
}

function getBodyVariantMarker(body) {
  if (!body || typeof body !== "object") return "";
  return Object.keys(body).join(",");
}

module.exports = {
  parseTaskId,
  buildAiAppRunBodyCandidates,
  buildLegacyCreateTaskBody,
  getTaskCreationOutcome,
  getBodyVariantMarker
};
