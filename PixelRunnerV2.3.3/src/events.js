const APP_EVENTS = {
  APPS_CHANGED: "pixelrunner:apps-changed",
  TEMPLATES_CHANGED: "pixelrunner:templates-changed",
  SETTINGS_CHANGED: "pixelrunner:settings-changed"
};

function createCustomEvent(name, detail) {
  if (typeof CustomEvent === "function") {
    return new CustomEvent(name, { detail });
  }
  const event = document.createEvent("CustomEvent");
  event.initCustomEvent(name, false, false, detail);
  return event;
}

function emitAppEvent(name, detail = {}) {
  if (typeof document === "undefined" || !document.dispatchEvent) return;
  document.dispatchEvent(createCustomEvent(name, detail));
}

module.exports = {
  APP_EVENTS,
  emitAppEvent
};
