// Run in this plugin's WebView console in UXP Developer Tools, after Reload.
// Does not submit a task, access credentials, or print any WSS URL.
(async () => {
  const modules = window.PixelRunnerModules;
  if (!modules?.runtime?.isPluginRuntime()) throw new Error("请在 Photoshop 插件 WebView 调试控制台运行。");
  const capabilities = await modules.runtime.callHost("runninghub.progressCapabilities", []);
  const tasks = (modules.state?.state?.runningTasks || []).filter(task =>
    !["grs", "gemini"].includes(task.provider) &&
    ["running", "remote-running", "queued", "tracking"].includes(task.status)
  ).map(task => ({ taskId: String(task.remoteTaskId || task.taskId), region: task.region || "cn" }));
  const progress = tasks.length ? await modules.runtime.callHost("runninghub.readProgress", [tasks]) : [];
  // Deliberately project again: this is safe to copy into a diagnostic report.
  const report = {
    runtime: capabilities.runtime,
    hostWebSocketSupported: capabilities.webSocketSupported === true,
    transport: capabilities.transport,
    finalStateAuthority: capabilities.finalStateAuthority,
    activeTasks: progress.map(item => ({
      region: item.region,
      phase: item.phase,
      channel: item.channel,
      hasStepProgress: !!item.step
    })),
    handshakeVerified: progress.some(item => item.channel === "connected"),
    note: "WebSocket API 可用不代表 WSS 已连接；仅 connected 证明当前任务握手成功。"
  };
  console.log("[RunningHub compatibility]", report);
  return report;
})();
