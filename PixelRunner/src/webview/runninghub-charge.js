const CHARGE_RECHECK_DELAYS_MS = [2000, 5000, 15000, 30000, 60000, 120000];

export async function recheckRunningHubTaskCharge(runtime, { apiKey, taskId, region }, isPending, { manual = false } = {}) {
  let lastResult = null;
  const delays = manual ? [0] : CHARGE_RECHECK_DELAYS_MS;
  for (const [index, delay] of delays.entries()) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
    if (!isPending()) return null;

    try {
      const result = await runtime.callHost(
        "runninghub.fetchTaskCharge",
        [{ apiKey, taskId, region }],
        { timeoutMs: 20000 }
      );
      if (result?.taskId !== taskId) continue;
      if (result.chargeDisplay) return isPending() ? result : null;
      lastResult = result;
    } catch (_) {
      lastResult = { taskId, chargeState: "unavailable" };
    }
    if (index >= 2 && lastResult?.chargeState !== "waiting") break;
  }
  return isPending() ? lastResult : null;
}

export function getRunningHubChargeStatusLabel(chargeState) {
  if (chargeState === "unreported") return "平台未返回扣费";
  if (chargeState === "unavailable") return "扣费查询失败";
  if (chargeState === "waiting") return "等待并发任务结算";
  return "扣费 待确认";
}
