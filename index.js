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
  const donationDialog = document.getElementById("donationDialog");
  const donationDialogClose = document.getElementById("donationDialogClose");
  const donationBody = donationDialog ? donationDialog.querySelector(".donation-dialog-body") : null;
  const donationStatusHint = document.getElementById("donationStatusHint");
  if (!btnDonate || !donationDialog || !donationDialogClose) return;
  if (!donationBody) {
    console.warn("Donation dialog body is missing");
    return;
  }

  const zfbImage = ensureDonationImageNode({
    body: donationBody,
    imageId: "donationZfbImage",
    labelText: "支付宝赞助"
  });
  const wxImage = ensureDonationImageNode({
    body: donationBody,
    imageId: "donationWxImage",
    labelText: "微信赞助"
  });
  const imageStates = {
    wx: "pending",
    zfb: "pending"
  };

  const setDonationStatus = (text, state = "info") => {
    if (!donationStatusHint) return;
    donationStatusHint.textContent = String(text || "");
    donationStatusHint.classList.remove("is-failed", "is-ok");
    if (state === "failed") donationStatusHint.classList.add("is-failed");
    if (state === "ok") donationStatusHint.classList.add("is-ok");
  };

  const refreshDonationStatus = () => {
    const values = Object.values(imageStates);
    const loadedCount = values.filter((item) => item === "loaded").length;
    const failedCount = values.filter((item) => item === "failed").length;
    if (loadedCount === 2) {
      setDonationStatus("二维码已加载，可点击尝试打开链接。", "ok");
      return;
    }
    if (loadedCount >= 1 && failedCount >= 1) {
      setDonationStatus("部分二维码加载失败，建议直接扫码当前可见二维码。", "failed");
      return;
    }
    if (failedCount === 2) {
      setDonationStatus("二维码加载失败，请检查 icons 资源路径。", "failed");
      return;
    }
    setDonationStatus("正在加载二维码...", "info");
  };

  const closeDialog = () => {
    donationDialog.close();
    refreshModalOpenState();
  };
  const openDialog = () => {
    donationDialog.showModal();
    refreshModalOpenState();
  };

  btnDonate.addEventListener("click", openDialog);
  donationDialogClose.addEventListener("click", closeDialog);
  donationDialog.addEventListener("close", refreshModalOpenState);
  loadDonationImageWithFallback(zfbImage, DONATION_IMAGE_SOURCES.zfb, "支付宝二维码", (status) => {
    imageStates.zfb = status;
    refreshDonationStatus();
  });
  loadDonationImageWithFallback(wxImage, DONATION_IMAGE_SOURCES.wx, "微信二维码", (status) => {
    imageStates.wx = status;
    refreshDonationStatus();
  });
  bindDonationImageEvents(zfbImage, DONATION_ZFB_TEXT, "支付宝二维码");
  bindDonationImageEvents(wxImage, DONATION_WX_TEXT, "微信二维码");
  refreshDonationStatus();
}

function refreshModalOpenState() {
  const overlayOpen = Boolean(document.querySelector(".modal-overlay.active"));
  const dialogOpen = Boolean(document.querySelector("dialog[open]"));
  document.body.classList.toggle("modal-open", overlayOpen || dialogOpen);
}

const DONATION_ZFB_TEXT = "https://qr.alipay.com/fkx12142r0sdwj4kizujk2f";
const DONATION_WX_TEXT = "wxp://f2f0xp-V9KpvqacwxxGZ3zXDCGI_z11NO-xT2ukCb4JHZyI";
const DONATION_IMAGE_SOURCES = {
  zfb: ["icons/zfb.png", "./icons/zfb.png"],
  wx: ["icons/vx.png", "./icons/vx.png"]
};

function ensureDonationGrid(body) {
  if (!body) return null;
  let grid = body.querySelector(".donation-grid");
  if (grid) return grid;
  grid = document.createElement("div");
  grid.className = "donation-grid";
  body.appendChild(grid);
  return grid;
}

function ensureDonationImageNode({ body, imageId, labelText }) {
  const existing = document.getElementById(imageId);
  if (existing && String(existing.tagName || "").toLowerCase() === "img") {
    return existing;
  }
  const grid = ensureDonationGrid(body);
  if (!grid) return null;

  const card = document.createElement("div");
  card.className = "donation-card";

  const imageEl = document.createElement("img");
  imageEl.id = imageId;
  imageEl.alt = `${labelText}二维码`;

  const labelEl = document.createElement("div");
  labelEl.className = "donation-label";
  labelEl.textContent = labelText;

  card.appendChild(imageEl);
  card.appendChild(labelEl);
  grid.appendChild(card);
  return imageEl;
}

function loadDonationImageWithFallback(imageEl, sources, label, onStateChange) {
  if (!imageEl) return;
  const candidates = Array.isArray(sources)
    ? sources.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (candidates.length === 0) return;

  const currentSrcAttr = String(imageEl.getAttribute("src") || "").trim();
  const initialIndex = currentSrcAttr ? Math.max(0, candidates.indexOf(currentSrcAttr)) : 0;
  imageEl.dataset.srcIndex = String(initialIndex);
  imageEl.src = candidates[initialIndex];
  imageEl.addEventListener("load", () => {
    const card = imageEl.closest(".donation-card");
    if (card) card.classList.remove("is-broken");
    if (typeof onStateChange === "function") onStateChange("loaded");
  });

  imageEl.addEventListener("error", () => {
    const currentIndex = Number(imageEl.dataset.srcIndex || "0");
    const nextIndex = currentIndex + 1;
    if (nextIndex < candidates.length) {
      imageEl.dataset.srcIndex = String(nextIndex);
      imageEl.src = candidates[nextIndex];
      return;
    }

    const card = imageEl.closest(".donation-card");
    if (card) {
      card.classList.add("is-broken");
      const labelEl = card.querySelector(".donation-label");
      if (labelEl && !String(labelEl.textContent || "").includes("加载失败")) {
        labelEl.textContent = `${String(labelEl.textContent || "").trim()}（加载失败）`;
      }
    }
    const marker = imageEl.getAttribute("src") || "(empty)";
    console.warn(`${label} failed to load: ${marker}`);
    if (typeof onStateChange === "function") onStateChange("failed");
  });
}

function openDonationLink(url, label) {
  try {
    const { shell } = require("uxp");
    if (shell && typeof shell.openExternal === "function") {
      shell.openExternal(url);
      return;
    }
  } catch (error) {
    console.warn(`Failed to open ${label}:`, error);
  }
}

function bindDonationImageEvents(imageEl, url, label) {
  if (!imageEl) {
    console.warn(`${label} node is missing`);
    return;
  }
  imageEl.addEventListener("click", () => openDonationLink(url, label));
}
