const activeWindows = new Map();
const MAX_WINDOWS = 24;

function amount(value) {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 1000) : null;
}

function estimate(window, after) {
  if (window.ambiguous || !window.before || after?.currentTaskCounts !== 0 ||
      window.before.currency !== after.currency) return;

  const tasks = Array.from(window.tasks.values());
  for (const task of tasks) delete task.estimate;
  const missing = tasks.filter((task) => task.chargePending);
  if (missing.length !== 1) return;

  const charge = {};
  for (const [balanceKey, chargeKey] of [["points", "pointsCharge"], ["balance", "balanceCharge"]]) {
    const beforeValue = amount(window.before[balanceKey]);
    const afterValue = amount(after[balanceKey]);
    if (beforeValue === null || afterValue === null) continue;
    const known = tasks.reduce((total, task) => {
      return total + (task.chargePending ? 0 : amount(task[chargeKey]) ?? 0);
    }, 0);
    const remaining = beforeValue - afterValue - known;
    if (remaining < 0) return;
    if (remaining > 0) charge[chargeKey] = remaining / 1000;
  }
  if (charge.pointsCharge && charge.balanceCharge) return;
  if (charge.pointsCharge || charge.balanceCharge) missing[0].estimate = charge;
}

export async function beginRunningHubBalanceWindow(region, apiKey, readAccount) {
  let window = activeWindows.get(region);
  if (!window) {
    window = {
      apiKey,
      before: null,
      submissions: 0,
      tasks: new Map(),
      ambiguous: false,
      ready: null,
      closing: null,
      readAccount
    };
    const current = window;
    current.ready = readAccount().then((account) => {
      if (account?.currentTaskCounts === 0) current.before = account;
    }).catch(() => {});
    activeWindows.set(region, current);
  }
  if (window.closing) {
    await window.closing;
    return beginRunningHubBalanceWindow(region, apiKey, readAccount);
  }
  if (window.apiKey !== apiKey) window.ambiguous = true;
  window.submissions += 1;
  await window.ready;
  if (!window.before) {
    if (activeWindows.get(region) === window) activeWindows.delete(region);
    return () => {};
  }
  return (taskId) => {
    window.submissions -= 1;
    if (taskId) {
      window.tasks.set(taskId, { apiKey, complete: false });
    } else {
      window.ambiguous = true;
    }
    void closeWindow(region, window);
  };
}

const closedWindows = [];

export async function settleRunningHubBalanceWindow(region, apiKey, taskId, settlement) {
  const active = activeWindows.get(region);
  const window = active?.tasks.get(taskId)?.apiKey === apiKey ? active :
    closedWindows.find((item) => item.region === region && item.tasks.get(taskId)?.apiKey === apiKey);
  const task = window?.tasks.get(taskId);
  if (!task || (task.chargeDisplay && !settlement.chargeDisplay)) return;
  Object.assign(task, settlement, { complete: true });
  if (!settlement.chargePending && !settlement.chargeDisplay) window.ambiguous = true;
  if (window.after) {
    estimate(window, window.after);
    return;
  }
  if (window.closing) return;
  await closeWindow(region, window);
}

async function closeWindow(region, window) {
  if (window.submissions || Array.from(window.tasks.values()).some((entry) => !entry.complete)) return;
  if (!window.before || window.ambiguous || !Array.from(window.tasks.values()).some((entry) => entry.chargePending)) {
    activeWindows.delete(region);
    return;
  }
  window.closing = window.readAccount().then((after) => {
    if (after?.currentTaskCounts === 0) {
      window.after = after;
      window.region = region;
      estimate(window, after);
      closedWindows.push(window);
      if (closedWindows.length > MAX_WINDOWS) closedWindows.shift();
    }
  }).catch(() => {}).finally(() => {
    activeWindows.delete(region);
    delete window.readAccount;
  });
  await window.closing;
}

export function getRunningHubBalanceEstimate(region, apiKey, taskId) {
  for (const window of closedWindows) {
    const task = window.region === region && window.tasks.get(taskId);
    if (task?.apiKey === apiKey) return task.estimate || null;
  }
  return null;
}

export function isRunningHubBalanceWindowOpen(region, apiKey, taskId) {
  const window = activeWindows.get(region);
  return Boolean(window?.before && !window.ambiguous && window.tasks.get(taskId)?.apiKey === apiKey);
}
