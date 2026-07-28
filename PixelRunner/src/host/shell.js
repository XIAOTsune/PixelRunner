const TUTORIAL_RELATIVE_PATH = ["pages", "runninghub-guide.html"];
const LOCAL_UPSCALE_LAUNCHERS = Object.freeze({
  win32: ["local-ai", "start-local-ai.vbs"],
  darwin: ["local-ai", "macos", "PixelRunner Local AI.app"]
});

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

function joinNativePath(basePath, segments = []) {
  const normalizedBase = String(basePath || "").trim().replace(/[\\/]+$/, "");
  if (!normalizedBase) return "";
  const cleanSegments = (Array.isArray(segments) ? segments : [])
    .map((segment) => String(segment || "").trim().replace(/^[\\/]+|[\\/]+$/g, ""))
    .filter(Boolean);
  if (!cleanSegments.length) return normalizedBase;

  const separator = normalizedBase.includes("\\") && !normalizedBase.includes("/") ? "\\" : "/";
  return `${normalizedBase}${separator}${cleanSegments.join(separator)}`;
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
            return { ok: true, path, url: "" };
          }
        }
      } catch (_) {
        // Fallback to nativePath join below.
      }
    }

    if (pluginFolder.nativePath) {
      const path = joinNativePath(pluginFolder.nativePath, TUTORIAL_RELATIVE_PATH);
      return { ok: true, path, url: "" };
    }
  } catch (_) {
    return { ok: false, path: "", url: "" };
  }

  return { ok: false, path: "", url: "" };
}

function getHostPlatform() {
  try {
    const os = typeof require === "function" ? require("os") : null;
    if (os && typeof os.platform === "function") {
      const platform = String(os.platform() || "").toLowerCase();
      if (platform) return platform;
    }
  } catch (_) {
    // UXP hosts without the Node-style os module fall back to their user agent.
  }
  const userAgent = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
  return /macintosh|mac os x/i.test(userAgent) ? "darwin" : "win32";
}

function getLocalUpscaleLauncherRelativePath() {
  const platform = getHostPlatform();
  return {
    platform,
    path: LOCAL_UPSCALE_LAUNCHERS[platform] || LOCAL_UPSCALE_LAUNCHERS.win32
  };
}

export async function resolveLocalUpscaleLauncherPath() {
  const launcherInfo = getLocalUpscaleLauncherRelativePath();
  const launcherPath = launcherInfo.path;
  try {
    const { storage } = getUxpModule();
    const localFileSystem = storage && storage.localFileSystem;
    if (!localFileSystem || typeof localFileSystem.getPluginFolder !== "function") {
      return { ok: false, path: "", url: "", platform: launcherInfo.platform };
    }

    const pluginFolder = await localFileSystem.getPluginFolder();
    if (!pluginFolder) return { ok: false, path: "", url: "", platform: launcherInfo.platform };

    if (typeof pluginFolder.getEntry === "function") {
      try {
        let launcherEntry = pluginFolder;
        for (const segment of launcherPath) {
          if (!launcherEntry || typeof launcherEntry.getEntry !== "function") throw new Error("launcher entry unavailable");
          launcherEntry = await launcherEntry.getEntry(segment);
        }
        if (launcherEntry && launcherEntry.nativePath) {
          return { ok: true, path: String(launcherEntry.nativePath), url: "", platform: launcherInfo.platform };
        }
        return { ok: false, path: "", url: "", platform: launcherInfo.platform };
      } catch (_) {
        return { ok: false, path: "", url: "", platform: launcherInfo.platform };
      }
    }

    if (pluginFolder.nativePath) {
      const path = joinNativePath(pluginFolder.nativePath, launcherPath);
      return { ok: true, path, url: "", platform: launcherInfo.platform };
    }
  } catch (_) {
    return { ok: false, path: "", url: "", platform: launcherInfo.platform };
  }

  return { ok: false, path: "", url: "", platform: launcherInfo.platform };
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

export async function startLocalUpscaleEngine(args = []) {
  const [developerText] = Array.isArray(args) ? args : [];
  const launcher = await resolveLocalUpscaleLauncherPath();
  if (!launcher.ok || !launcher.path) {
    if (launcher.platform === "darwin") {
      throw new Error("未找到 macOS 本地超分 companion app；当前安装包不含 Apple Silicon 引擎。");
    }
    throw new Error("未找到 PixelRunner Local AI 启动脚本");
  }

  return openLocalPath([
    launcher.path,
    String(developerText || "PixelRunner 需要启动随插件附带的本地超分引擎。")
  ]);
}
