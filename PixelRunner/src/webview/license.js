import {
  ACTIVATION_STORAGE_KEY,
  INSTALLATION_ID_STORAGE_KEY,
  LICENSE_FEATURES,
  deriveDeviceCode,
  generateInstallationId,
  isFeatureUnlocked,
  isValidInstallationId,
  verifyActivationCode
} from "../shared/license-core.js";
import { LICENSE_PUBLIC_KEYS } from "../shared/license-public-keys.js";

(function initLicenseModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const state = {
    installationId: "",
    deviceCode: "",
    activationCode: "",
    verification: { active: false, reason: "NOT_ACTIVATED", license: null },
    storageError: "",
    removeConfirmationPending: false,
    removeConfirmationTimer: 0,
    bound: false
  };

  function getById(id) {
    return modules.runtime.getById(id);
  }

  function getStatusLabel() {
    if (state.storageError) return "授权无效";
    if (state.verification.active) return "已激活（此设备）";
    return state.activationCode ? "授权无效" : "未激活";
  }

  function getStatusType() {
    if (state.storageError) return "warn";
    if (state.verification.active) return "success";
    return state.activationCode ? "warn" : "info";
  }

  function getFeatureLabel(feature) {
    return LICENSE_FEATURES[feature] || "该功能";
  }

  function setLicenseMessage(message, type = "info") {
    modules.runtime.setSummaryStatus(getById("licenseStatusSummary"), message, type);
  }

  function render() {
    const statusLabel = getStatusLabel();
    const statusType = getStatusType();
    const badge = getById("licenseStatusBadge");
    const deviceCodeInput = getById("licenseDeviceCode");
    const details = getById("licenseActiveDetails");
    const detailsText = getById("licenseActiveDetailsText");
    if (badge) {
      badge.textContent = statusLabel;
      badge.dataset.status = statusType;
    }
    if (deviceCodeInput) deviceCodeInput.value = state.deviceCode;
    if (details) details.hidden = !state.verification.active;
    if (detailsText && state.verification.active) {
      const license = state.verification.license;
      const features = Object.keys(LICENSE_FEATURES)
        .filter((feature) => isFeatureUnlocked(state.verification, feature))
        .map(getFeatureLabel)
        .join("、");
      detailsText.textContent = `许可证编号：${license.licenseId}\n永久授权：是\n此设备：${state.deviceCode}\n已解锁功能：${features}`;
    }
    document.querySelectorAll("[data-license-feature]").forEach((button) => {
      const feature = String(button.getAttribute("data-license-feature") || "");
      const unlocked = isFeatureUnlocked(state.verification, feature);
      button.classList.toggle("is-license-locked", !unlocked);
      button.setAttribute("aria-disabled", unlocked ? "false" : "true");
      button.dataset.licenseState = unlocked ? "unlocked" : "locked";
    });
    document.querySelectorAll("[data-license-status-for]").forEach((chip) => {
      const feature = String(chip.getAttribute("data-license-status-for") || "");
      const unlocked = isFeatureUnlocked(state.verification, feature);
      chip.textContent = unlocked ? "已解锁" : "已锁定";
      chip.dataset.status = unlocked ? "success" : "warn";
    });
  }

  const HOST_STORAGE_OPTIONS = Object.freeze({ requireHost: true });

  async function readLicenseStorage(key) {
    return modules.runtime.storageGetItem(key, HOST_STORAGE_OPTIONS);
  }

  async function writeLicenseStorage(key, value) {
    const expectedValue = String(value == null ? "" : value);
    await modules.runtime.storageSetItem(key, expectedValue, HOST_STORAGE_OPTIONS);
    const actualValue = String(await readLicenseStorage(key) || "");
    if (actualValue !== expectedValue) throw new Error("授权存储回读校验失败");
  }

  function showStorageError(error) {
    state.storageError = String(error && error.message || "Host 授权存储不可用");
    state.activationCode = "";
    state.verification = { active: false, reason: "STORAGE_UNAVAILABLE", license: null };
    render();
    setLicenseMessage("无法访问授权存储。请关闭并重新打开 Photoshop 后重试激活。", "warn");
  }

  async function initialize() {
    try {
      state.storageError = "";
      const storedInstallationId = String(await readLicenseStorage(INSTALLATION_ID_STORAGE_KEY) || "").trim();
      state.installationId = isValidInstallationId(storedInstallationId)
        ? storedInstallationId
        : generateInstallationId();
      if (state.installationId !== storedInstallationId) {
        await writeLicenseStorage(INSTALLATION_ID_STORAGE_KEY, state.installationId);
      }
      state.deviceCode = deriveDeviceCode(state.installationId);
      state.activationCode = String(await readLicenseStorage(ACTIVATION_STORAGE_KEY) || "").trim();
      state.verification = state.activationCode
        ? verifyActivationCode(state.activationCode, { deviceCode: state.deviceCode, keyring: LICENSE_PUBLIC_KEYS })
        : { active: false, reason: "NOT_ACTIVATED", license: null };
      render();
      if (!state.verification.active && state.activationCode) {
        setLicenseMessage("授权无法在此设备上验证。请复制当前设备代码后联系开发者重新签发。", "warn");
      } else if (!state.verification.active) {
        setLicenseMessage("此设备尚未激活。", "info");
      } else {
        setLicenseMessage("此设备已激活，授权功能可用。", "success");
      }
      return state.verification;
    } catch (error) {
      showStorageError(error);
      return state.verification;
    }
  }

  function closeFeaturePrompt() {
    if (modules.workspace && typeof modules.workspace.setModalOpen === "function") {
      modules.workspace.setModalOpen("licenseFeatureModal", false);
    }
  }

  function openLicenseSettings() {
    closeFeaturePrompt();
    if (modules.ui && typeof modules.ui.setActiveView === "function") modules.ui.setActiveView("tabSettings");
    const section = getById("licenseSettingsDetails");
    if (section) {
      section.open = true;
      section.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  function openFeaturePrompt(feature) {
    const label = getFeatureLabel(feature);
    const title = getById("licenseFeatureTitle");
    const hint = getById("licenseFeatureHint");
    if (title) title.textContent = `${label}需要授权`;
    if (hint) {
      hint.textContent = state.storageError
        ? "无法访问授权存储。请关闭并重新打开 Photoshop 后重试。"
        : "请前往授权与设备，复制设备代码后联系开发者激活。";
    }
    if (modules.workspace && typeof modules.workspace.setModalOpen === "function") {
      modules.workspace.setModalOpen("licenseFeatureModal", true);
    }
  }

  function requireFeature(feature) {
    if (isFeatureUnlocked(state.verification, feature)) return true;
    openFeaturePrompt(feature);
    return false;
  }

  async function copyDeviceCode() {
    const input = getById("licenseDeviceCode");
    const value = state.deviceCode;
    try {
      if (global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.writeText === "function") {
        await global.navigator.clipboard.writeText(value);
      } else if (input) {
        input.focus();
        input.select();
        if (!document.execCommand("copy")) throw new Error("copy unavailable");
      } else {
        throw new Error("device code unavailable");
      }
      setLicenseMessage("设备代码已复制。", "success");
    } catch (_) {
      setLicenseMessage("无法自动复制，请手动选择并复制设备代码。", "warn");
    }
  }

  function getActivationErrorMessage(reason) {
    if (reason === "DEVICE_MISMATCH") return "该激活码不属于此设备。请复制当前设备代码后联系开发者重新签发。";
    if (reason === "PRODUCT_MISMATCH") return "该激活码不适用于 PixelRunner。请复制当前设备代码后联系开发者。";
    if (reason === "KEY_UNKNOWN") return "该激活码使用了不受支持的签发密钥。请联系开发者获取新的激活码。";
    return "激活码无效或不完整。请复制当前设备代码后联系开发者。";
  }

  async function activate() {
    const input = getById("licenseActivationCode");
    const candidate = String(input && input.value || "").trim();
    if (!candidate) {
      setLicenseMessage("请输入激活码，或复制设备代码后联系开发者。", "warn");
      return false;
    }
    const verification = verifyActivationCode(candidate, { deviceCode: state.deviceCode, keyring: LICENSE_PUBLIC_KEYS });
    if (!verification.active) {
      setLicenseMessage(getActivationErrorMessage(verification.reason), "warn");
      return false;
    }
    try {
      await writeLicenseStorage(ACTIVATION_STORAGE_KEY, verification.license.activationCode);
    } catch (error) {
      showStorageError(error);
      return false;
    }
    state.storageError = "";
    state.activationCode = verification.license.activationCode;
    state.verification = verification;
    if (input) input.value = "";
    render();
    setLicenseMessage("激活成功：此设备已解锁许可证中的功能。", "success");
    return true;
  }

  function resetRemovalConfirmation() {
    state.removeConfirmationPending = false;
    if (state.removeConfirmationTimer) global.clearTimeout(state.removeConfirmationTimer);
    state.removeConfirmationTimer = 0;
    const removeButton = getById("btnRemoveLicense");
    if (removeButton) removeButton.textContent = "移除本机授权";
  }

  async function removeLicense() {
    const removeButton = getById("btnRemoveLicense");
    if (!state.removeConfirmationPending) {
      state.removeConfirmationPending = true;
      if (removeButton) removeButton.textContent = "再次点击确认移除";
      setLicenseMessage("再次点击“确认移除”后，仅移除此设备保存的授权。", "warn");
      state.removeConfirmationTimer = global.setTimeout(resetRemovalConfirmation, 8000);
      return;
    }
    try {
      await writeLicenseStorage(ACTIVATION_STORAGE_KEY, "");
    } catch (error) {
      resetRemovalConfirmation();
      showStorageError(error);
      return;
    }
    state.storageError = "";
    state.activationCode = "";
    state.verification = { active: false, reason: "NOT_ACTIVATED", license: null };
    resetRemovalConfirmation();
    render();
    setLicenseMessage("已移除本机授权。需要恢复时，请使用为当前设备代码重新签发的激活码。", "info");
  }

  function bindActions() {
    if (state.bound) return;
    state.bound = true;
    const copyButton = getById("btnCopyLicenseDeviceCode");
    const activateButton = getById("btnActivateLicense");
    const removeButton = getById("btnRemoveLicense");
    const promptClose = getById("licenseFeatureModalClose");
    const promptSettings = getById("btnOpenLicenseSettings");
    if (copyButton) copyButton.addEventListener("click", () => void copyDeviceCode());
    if (activateButton) activateButton.addEventListener("click", () => void activate());
    if (removeButton) removeButton.addEventListener("click", () => void removeLicense());
    if (promptClose) promptClose.addEventListener("click", closeFeaturePrompt);
    if (promptSettings) promptSettings.addEventListener("click", openLicenseSettings);
    document.addEventListener("click", (event) => {
      if (event.target && event.target.closest("#licenseFeatureBackdrop")) closeFeaturePrompt();
    });
    // Capture phase prevents the original tool button handler from beginning a
    // preview or model startup before the compact authorization prompt opens.
    document.addEventListener("click", (event) => {
      const button = event.target && event.target.closest("[data-license-feature]");
      if (!button || isFeatureUnlocked(state.verification, button.getAttribute("data-license-feature"))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openFeaturePrompt(button.getAttribute("data-license-feature"));
    }, true);
  }

  modules.license = {
    state,
    initialize,
    bindActions,
    requireFeature,
    openFeaturePrompt,
    openLicenseSettings,
    isFeatureUnlocked: (feature) => isFeatureUnlocked(state.verification, feature)
  };
})(window);
