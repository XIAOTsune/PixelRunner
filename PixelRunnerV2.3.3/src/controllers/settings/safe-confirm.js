const DEFAULT_UNSUPPORTED_CONFIRM_MESSAGE = "当前环境不支持确认弹窗，已阻止本次删除。";

function normalizeErrorMessage(error) {
  if (!error) return "unknown";
  if (error.message) return String(error.message);
  return String(error);
}

function safeConfirm(message, options = {}) {
  const confirmImpl =
    typeof options.confirmImpl === "function"
      ? options.confirmImpl
      : typeof confirm === "function"
        ? confirm
        : null;
  const alertImpl =
    typeof options.alertImpl === "function"
      ? options.alertImpl
      : typeof alert === "function"
        ? alert
        : null;
  const log = typeof options.log === "function" ? options.log : () => {};
  const unsupportedMessage = String(
    options.unsupportedMessage || DEFAULT_UNSUPPORTED_CONFIRM_MESSAGE
  );

  if (confirmImpl) {
    try {
      return Boolean(confirmImpl(message));
    } catch (error) {
      log(`confirm not available: ${normalizeErrorMessage(error)}`);
    }
  } else {
    log("confirm not available in current environment");
  }

  if (alertImpl) {
    try {
      alertImpl(unsupportedMessage);
    } catch (error) {
      log(`alert not available: ${normalizeErrorMessage(error)}`);
    }
  }
  return false;
}

module.exports = {
  DEFAULT_UNSUPPORTED_CONFIRM_MESSAGE,
  safeConfirm
};
