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

function initToolsController() {
  const btnNeutralGray = byId("btnNeutralGray");
  const btnObserver = byId("btnObserver");
  const btnStamp = byId("btnStamp");

  rebindEvent(btnNeutralGray, "click", onNeutralGrayClick);
  rebindEvent(btnObserver, "click", onObserverClick);
  rebindEvent(btnStamp, "click", onStampClick);
}

module.exports = { initToolsController };
