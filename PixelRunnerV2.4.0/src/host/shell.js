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

function createFileUrlFromPath(nativePath) {
  const rawPath = String(nativePath || "").trim();
  if (!rawPath) return "";

  const normalized = rawPath.replace(/\\/g, "/");
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return encodeURI(`file:///${normalized}`);
  }
  if (normalized.startsWith("//")) {
    return encodeURI(`file:${normalized}`);
  }
  if (normalized.startsWith("/")) {
    return encodeURI(`file://${normalized}`);
  }
  return "";
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
            const path = String(tutorialEntry.nativePath);
            return { ok: true, path, url: createFileUrlFromPath(path) };
          }
        }
      } catch (_) {
        // Fallback to nativePath join below.
      }
    }

    if (pluginFolder.nativePath) {
      const basePath = String(pluginFolder.nativePath || "").replace(/[\\/]+$/, "");
      const path = `${basePath}\\${TUTORIAL_RELATIVE_PATH.join("\\")}`;
      return { ok: true, path, url: createFileUrlFromPath(path) };
    }
  } catch (_) {
    return { ok: false, path: "", url: "" };
  }

  return { ok: false, path: "", url: "" };
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
  if (!isShellSuccess(result)) {
    const fileUrl = createFileUrlFromPath(targetPath);
    if (fileUrl && typeof shell.openExternal === "function") {
      const fallbackResult = await shell.openExternal(fileUrl, String(developerText || ""));
      return {
        ok: isShellSuccess(fallbackResult),
        result: fallbackResult == null ? "" : String(fallbackResult),
        path: targetPath,
        url: fileUrl,
        via: "openExternal"
      };
    }
  }
  return {
    ok: isShellSuccess(result),
    result: result == null ? "" : String(result),
    path: targetPath,
    url: createFileUrlFromPath(targetPath),
    via: "openPath"
  };
}
