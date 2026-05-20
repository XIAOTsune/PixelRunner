export function assertBatchPlaySucceeded(result, label) {
  const first = Array.isArray(result) ? result[0] : null;
  if (first && first._obj === "error" && Number(first.result) !== 0) {
    throw new Error(first.message || `${label} failed`);
  }
}

const TOOL_MENU_KEYWORDS = {
  gaussianBlur: ["gaussian blur"],
  smartSharpen: ["smart sharpen"],
  highPass: ["high pass"],
  selectAndMask: ["select and mask", "选择并遮住", "选择并遮罩"],
  contentAwareFill: ["content-aware fill", "content aware fill", "内容识别填充", "内容感知填充"]
};

const TOOL_MENU_SCAN_RANGE = { start: 900, end: 5000 };
let toolMenuIdsCache = null;
let toolMenuIdsPromise = null;

function normalizeMenuTitle(title) {
  return String(title || "")
    .replace(/\u2026/g, "...")
    .trim()
    .toLowerCase();
}

async function scanToolMenuIds(core) {
  const ids = {};
  if (!core || typeof core.getMenuCommandTitle !== "function") return ids;

  const keys = Object.keys(TOOL_MENU_KEYWORDS);
  for (let commandID = TOOL_MENU_SCAN_RANGE.start; commandID <= TOOL_MENU_SCAN_RANGE.end; commandID += 1) {
    let title = "";
    try {
      title = await core.getMenuCommandTitle({ commandID });
    } catch (_) {
      continue;
    }

    const normalized = normalizeMenuTitle(title);
    if (!normalized) continue;

    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (ids[key]) continue;
      const patterns = TOOL_MENU_KEYWORDS[key];
      for (let j = 0; j < patterns.length; j += 1) {
        if (normalized.includes(patterns[j])) {
          ids[key] = commandID;
          break;
        }
      }
    }

    if (keys.every((key) => Boolean(ids[key]))) break;
  }

  return ids;
}

async function scanMenuIdByKey(core, menuKey, range = TOOL_MENU_SCAN_RANGE) {
  if (!core || typeof core.getMenuCommandTitle !== "function") return 0;
  const patterns = TOOL_MENU_KEYWORDS[menuKey];
  if (!Array.isArray(patterns) || patterns.length === 0) return 0;

  const start = Number(range && range.start) || TOOL_MENU_SCAN_RANGE.start;
  const end = Number(range && range.end) || TOOL_MENU_SCAN_RANGE.end;
  for (let commandID = start; commandID <= end; commandID += 1) {
    let title = "";
    try {
      title = await core.getMenuCommandTitle({ commandID });
    } catch (_) {
      continue;
    }

    const normalized = normalizeMenuTitle(title);
    if (!normalized) continue;

    for (let i = 0; i < patterns.length; i += 1) {
      if (normalized.includes(patterns[i])) {
        return commandID;
      }
    }
  }

  return 0;
}

async function getToolMenuIds(core) {
  if (toolMenuIdsCache) return toolMenuIdsCache;
  if (!toolMenuIdsPromise) {
    toolMenuIdsPromise = scanToolMenuIds(core)
      .then((ids) => {
        toolMenuIdsCache = ids;
        return ids;
      })
      .finally(() => {
        toolMenuIdsPromise = null;
      });
  }
  return toolMenuIdsPromise;
}

export async function runMenuCommandByKey(core, menuKey, label) {
  if (!core || typeof core.performMenuCommand !== "function") {
    throw new Error("Current Photoshop host does not support menu commands.");
  }

  const ids = await getToolMenuIds(core);
  let commandID = ids[menuKey];
  if (!commandID && menuKey === "selectAndMask") {
    const deepScanId = await scanMenuIdByKey(core, menuKey, { start: 5001, end: 12000 });
    if (deepScanId) {
      commandID = deepScanId;
      toolMenuIdsCache = {
        ...(toolMenuIdsCache || {}),
        [menuKey]: deepScanId
      };
    }
  }

  if (!commandID) {
    throw new Error(`${label}: menu command not found.`);
  }

  if (typeof core.getMenuCommandState === "function") {
    try {
      const enabled = await core.getMenuCommandState({ commandID });
      if (enabled === false) {
        throw new Error(`${label}: menu command is currently disabled.`);
      }
    } catch (error) {
      const msg = String((error && error.message) || "").toLowerCase();
      if (msg.includes("disabled")) throw error;
    }
  }

  const ok = await core.performMenuCommand({ commandID });
  if (ok === false) {
    throw new Error(`${label}: menu command failed.`);
  }
}

export async function runSingleCommand(action, descriptor, label, dialogOptions = "dontDisplay") {
  const command = {
    ...descriptor,
    _options: {
      ...(descriptor._options || {}),
      dialogOptions
    }
  };

  const result = await action.batchPlay([command], {});
  assertBatchPlaySucceeded(result, label);
  return result;
}

export async function runSingleCommandWithDialog(action, descriptor, label) {
  return runSingleCommand(action, descriptor, label, "display");
}

export async function runDialogCommandWithFallback(core, action, options) {
  const { label, menuKey, descriptor, commandName } = options || {};
  let menuError = null;

  try {
    await runMenuCommandByKey(core, menuKey, label);
    return;
  } catch (error) {
    menuError = error;
  }

  try {
    await core.executeAsModal(async () => {
      await runSingleCommandWithDialog(action, descriptor, label);
    }, { commandName, interactive: true });
    return;
  } catch (batchError) {
    const menuMsg = menuError && menuError.message ? menuError.message : String(menuError || "");
    const batchMsg = batchError && batchError.message ? batchError.message : String(batchError || "");
    throw new Error(`${label} failed. Menu: ${menuMsg}; BatchPlay: ${batchMsg}`);
  }
}
