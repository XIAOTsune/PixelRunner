const TUTORIAL_RELATIVE_PATH = ["pages", "runninghub-guide.html"];

function getUxpModule() {
  if (typeof require !== "function") {
    throw new Error("UXP shell module is unavailable");
  }
  return require("uxp");
}

function isShellSuccess(result) {
  return result === "" || result === true || result == null;
}

export async function resolveTutorialPath() {
  try {
    const { storage } = getUxpModule();
    const localFileSystem = storage && storage.localFileSystem;
    if (!localFileSystem || typeof localFileSystem.getPluginFolder !== "function") {
      return { ok: false, path: "" };
    }

    const pluginFolder = await localFileSystem.getPluginFolder();
    if (!pluginFolder) return { ok: false, path: "" };

    if (typeof pluginFolder.getEntry === "function") {
      try {
        const pagesFolder = await pluginFolder.getEntry(TUTORIAL_RELATIVE_PATH[0]);
        if (pagesFolder && typeof pagesFolder.getEntry === "function") {
          const tutorialEntry = await pagesFolder.getEntry(TUTORIAL_RELATIVE_PATH[1]);
          if (tutorialEntry && tutorialEntry.nativePath) {
            return { ok: true, path: String(tutorialEntry.nativePath) };
          }
        }
      } catch (_) {
        // Fallback to nativePath join below.
      }
    }

    if (pluginFolder.nativePath) {
      const basePath = String(pluginFolder.nativePath || "").replace(/[\\/]+$/, "");
      return { ok: true, path: `${basePath}\\${TUTORIAL_RELATIVE_PATH.join("\\")}` };
    }
  } catch (_) {
    return { ok: false, path: "" };
  }

  return { ok: false, path: "" };
}

export async function openExternalUrl(args = []) {
  const [url, developerText] = Array.isArray(args) ? args : [];
  const targetUrl = String(url || "").trim();
  if (!targetUrl) throw new Error("Missing url");

  const { shell } = getUxpModule();
  if (!shell || typeof shell.openExternal !== "function") {
    throw new Error("UXP shell.openExternal is unavailable");
  }

  const result = await shell.openExternal(targetUrl, String(developerText || ""));
  return {
    ok: isShellSuccess(result),
    result: result == null ? "" : String(result),
    url: targetUrl
  };
}

export async function openLocalPath(args = []) {
  const [nativePath, developerText] = Array.isArray(args) ? args : [];
  const targetPath = String(nativePath || "").trim();
  if (!targetPath) throw new Error("Missing path");

  const { shell } = getUxpModule();
  if (!shell || typeof shell.openPath !== "function") {
    throw new Error("UXP shell.openPath is unavailable");
  }

  const result = await shell.openPath(targetPath, String(developerText || ""));
  return {
    ok: isShellSuccess(result),
    result: result == null ? "" : String(result),
    path: targetPath
  };
}
