const { initWorkspaceController } = require("./src/controllers/workspace-controller");
const { initSettingsController } = require("./src/controllers/settings-controller");
const { initToolsController } = require("./src/controllers/tools-controller");
const { runPsEnvironmentDoctor } = require("./src/diagnostics/ps-env-doctor");

document.addEventListener("DOMContentLoaded", () => {
  console.log("Plugin Loaded. Initializing Controllers...");

  let initError = null;
  try {
    initWorkspaceController();
    initSettingsController();
    initToolsController();
    setupTabs();
    setupDonationModal();
  } catch (error) {
    initError = error;
    console.error("Initialization Failed:", error);
  }

  runPsEnvironmentDoctor({ stage: "startup", initError })
    .then((report) => {
      console.log(`[Diag] Startup report generated: ${report.runId}`);
      if (report && report.persisted) {
        const { jsonPath, textPath } = report.persisted;
        if (jsonPath || textPath) {
          console.log(`[Diag] Report paths => json: ${jsonPath || "n/a"}, txt: ${textPath || "n/a"}`);
        }
      }
    })
    .catch((error) => {
      console.error("[Diag] Failed to run startup diagnostics:", error);
    });
});

let qrLib = null;
try {
  qrLib = require("./src/libs/qrcode-generator.js");
  if (qrLib && typeof window !== "undefined" && typeof window.qrcode !== "function") {
    window.qrcode = qrLib;
  }
} catch (error) {
  console.warn("Failed to load qrcode library", error);
}

function setupTabs() {
  const tabs = {
    tabWorkspace: "viewWorkspace",
    tabTools: "viewTools",
    tabSettings: "viewSettings"
  };

  Object.keys(tabs).forEach((tabId) => {
    const btn = document.getElementById(tabId);
    if (!btn) return;

    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((el) => el.classList.remove("active"));

      btn.classList.add("active");
      const viewId = tabs[tabId];
      const view = document.getElementById(viewId);
      if (view) view.classList.add("active");
    });
  });
}

function setupDonationModal() {
  const btnDonate = document.getElementById("btnDonate");
  const donationDialog = document.getElementById("donationDialog");
  const donationDialogClose = document.getElementById("donationDialogClose");
  const zfbCanvas = document.getElementById("donationZfbCanvas");
  const wxCanvas = document.getElementById("donationWxCanvas");
  if (!btnDonate || !donationDialog || !donationDialogClose) return;

  const closeDialog = () => {
    donationDialog.close();
    refreshModalOpenState();
  };
  const openDialog = () => {
    renderDonationQr(zfbCanvas, DONATION_ZFB_TEXT);
    renderDonationQr(wxCanvas, DONATION_WX_TEXT);
    donationDialog.showModal();
    refreshModalOpenState();
  };

  btnDonate.addEventListener("click", openDialog);
  donationDialogClose.addEventListener("click", closeDialog);
  donationDialog.addEventListener("close", refreshModalOpenState);
  if (zfbCanvas) {
    zfbCanvas.addEventListener("click", () => {
      try {
        const { shell } = require("uxp");
        if (shell && shell.openExternal) {
          shell.openExternal(DONATION_ZFB_TEXT);
        }
      } catch (error) {
        console.warn("Failed to open donation link", error);
      }
    });
  }
}

function refreshModalOpenState() {
  const overlayOpen = Boolean(document.querySelector(".modal-overlay.active"));
  const dialogOpen = Boolean(document.querySelector("dialog[open]"));
  document.body.classList.toggle("modal-open", overlayOpen || dialogOpen);
}

const DONATION_ZFB_TEXT = "https://qr.alipay.com/fkx12142r0sdwj4kizujk2f";
const DONATION_WX_TEXT = "wxp://f2f0xp-V9KpvqacwxxGZ3zXDCGI_z11NO-xT2ukCb4JHZyI";

function renderDonationQr(canvas, text) {
  if (!canvas) return;
  const qrFactory = typeof qrcode === "function" ? qrcode : qrLib;
  if (typeof qrFactory !== "function") {
    console.warn("qrcode generator is unavailable");
    return;
  }
  canvas.style.display = "block";
  const qr = qrFactory(0, "M");
  qr.addData(text);
  qr.make();
  const size = Math.min(canvas.width || 220, canvas.height || 220);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  const count = qr.getModuleCount();
  const cellSize = Math.floor(size / count);
  const offset = Math.floor((size - cellSize * count) / 2);
  ctx.fillStyle = "#000000";
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (!qr.isDark(r, c)) continue;
      ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize, cellSize);
    }
  }
}
