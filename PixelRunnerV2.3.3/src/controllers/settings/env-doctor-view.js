function setEnvDoctorOutput(outputEl, text) {
  if (!outputEl) return;
  outputEl.value = String(text || "");
  outputEl.scrollTop = 0;
}

function appendEnvDoctorOutput(outputEl, line, options = {}) {
  if (!outputEl) return;
  const current = String(outputEl.value || "");
  const now = options.now instanceof Date ? options.now : new Date();
  const ts = now.toLocaleTimeString();
  outputEl.value = `${current}${current ? "\n" : ""}[${ts}] ${line}`;
  outputEl.scrollTop = outputEl.scrollHeight;
}

module.exports = {
  setEnvDoctorOutput,
  appendEnvDoctorOutput
};
