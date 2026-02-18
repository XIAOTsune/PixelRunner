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
  const donationModal = document.getElementById("donationModal");
  const donationModalClose = document.getElementById("donationModalClose");
  const wxImg = document.getElementById("donationWxImg");
  const zfbImg = document.getElementById("donationZfbImg");
  if (!btnDonate || !donationModal || !donationModalClose) return;

  const closeModal = () => {
    donationModal.classList.remove("active");
    refreshModalOpenState();
  };
  const openModal = () => {
    donationModal.classList.add("active");
    refreshModalOpenState();
    ensureDonationImages(wxImg, "vx.png");
    ensureDonationImages(zfbImg, "zfb.png");
  };

  btnDonate.addEventListener("click", openModal);
  donationModalClose.addEventListener("click", closeModal);
  donationModal.addEventListener("click", (event) => {
    if (event.target === donationModal) closeModal();
  });
}

function refreshModalOpenState() {
  const isOpen = Boolean(document.querySelector(".modal-overlay.active"));
  document.body.classList.toggle("modal-open", isOpen);
}

async function ensureDonationImages(imgEl, fileName) {
  if (!imgEl || imgEl.dataset.loaded === "true") return;
  const currentSrc = imgEl.getAttribute("src") || "";
  if (currentSrc.startsWith("plugin-file://")) {
    imgEl.dataset.loaded = "true";
    return;
  }
  try {
    const { storage } = require("uxp");
    const fs = storage && storage.localFileSystem;
    if (!fs || typeof fs.getPluginFolder !== "function") return;
    const pluginFolder = await fs.getPluginFolder();
    const iconsFolder = await pluginFolder.getEntry("icons");
    const imgEntry = await iconsFolder.getEntry(fileName);
    const sessionUrl = await fs.createSessionToken(imgEntry);
    if (sessionUrl) {
      imgEl.src = sessionUrl;
      imgEl.dataset.loaded = "true";
    }
  } catch (error) {
    console.warn("Failed to load donation image", fileName, error);
  }
}
