const ps = require("../services/ps");
const { byId, rebindEvent } = require("../shared/dom-utils");

async function onNeutralGrayClick() {
  try {
    await ps.createNeutralGrayLayer();
    console.log("[Tools] Neutral gray layer created");
  } catch (error) {
    console.error("[Tools] Failed to create neutral gray layer", error);
  }
}

async function onObserverClick() {
  try {
    await ps.createObserverLayer();
  } catch (error) {
    console.error("[Tools] Failed to create observer layer", error);
  }
}

async function onStampClick() {
  try {
    await ps.stampVisibleLayers();
  } catch (error) {
    console.error("[Tools] Failed to stamp visible layers", error);
  }
}

function preventSpaceTrigger(event) {
  if (!event) return;
  const key = event.code || event.key || "";
  if (key === "Space" || key === " " || key === "Spacebar") {
    event.preventDefault();
    event.stopPropagation();
  }
}

function wrapToolClick(handler) {
  return async function onToolClick(event) {
    const target = event && event.currentTarget;
    if (target && typeof target.blur === "function") {
      target.blur();
    }
    await handler();
  };
}

const onNeutralGrayClickWrapped = wrapToolClick(onNeutralGrayClick);
const onObserverClickWrapped = wrapToolClick(onObserverClick);
const onStampClickWrapped = wrapToolClick(onStampClick);

function initToolsController() {
  const btnNeutralGray = byId("btnNeutralGray");
  const btnObserver = byId("btnObserver");
  const btnStamp = byId("btnStamp");

  rebindEvent(btnNeutralGray, "click", onNeutralGrayClickWrapped);
  rebindEvent(btnObserver, "click", onObserverClickWrapped);
  rebindEvent(btnStamp, "click", onStampClickWrapped);

  rebindEvent(btnNeutralGray, "keydown", preventSpaceTrigger);
  rebindEvent(btnObserver, "keydown", preventSpaceTrigger);
  rebindEvent(btnStamp, "keydown", preventSpaceTrigger);

  rebindEvent(btnNeutralGray, "keyup", preventSpaceTrigger);
  rebindEvent(btnObserver, "keyup", preventSpaceTrigger);
  rebindEvent(btnStamp, "keyup", preventSpaceTrigger);

  rebindEvent(btnNeutralGray, "keypress", preventSpaceTrigger);
  rebindEvent(btnObserver, "keypress", preventSpaceTrigger);
  rebindEvent(btnStamp, "keypress", preventSpaceTrigger);
}

module.exports = { initToolsController };
