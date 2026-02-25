const { createWorkspaceGateway } = require("../infrastructure/gateways/workspace-gateway");
const { byId, rebindEvent } = require("../shared/dom-utils");

let workspaceGateway = createWorkspaceGateway();
let ps = workspaceGateway.photoshop;

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

async function onGaussianBlurClick() {
  try {
    await ps.runGaussianBlur();
    console.log("[Tools] Gaussian Blur triggered");
  } catch (error) {
    console.error("[Tools] Failed to run Gaussian Blur", error);
  }
}

async function onSharpenClick() {
  try {
    await ps.runSharpen();
    console.log("[Tools] Sharpen triggered");
  } catch (error) {
    console.error("[Tools] Failed to run Sharpen", error);
  }
}

async function onHighPassClick() {
  try {
    await ps.runHighPass();
    console.log("[Tools] High Pass triggered");
  } catch (error) {
    console.error("[Tools] Failed to run High Pass", error);
  }
}

async function onContentAwareFillClick() {
  try {
    await ps.runContentAwareFill();
    console.log("[Tools] Content-Aware Fill triggered");
  } catch (error) {
    console.error("[Tools] Failed to run Content-Aware Fill", error);
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
const onGaussianBlurClickWrapped = wrapToolClick(onGaussianBlurClick);
const onSharpenClickWrapped = wrapToolClick(onSharpenClick);
const onHighPassClickWrapped = wrapToolClick(onHighPassClick);
const onContentAwareFillClickWrapped = wrapToolClick(onContentAwareFillClick);

function resolveToolsGateway(options = {}) {
  if (options && options.gateway && typeof options.gateway === "object") {
    return options.gateway;
  }
  return createWorkspaceGateway();
}

function initToolsController(options = {}) {
  workspaceGateway = resolveToolsGateway(options);
  ps = workspaceGateway.photoshop;

  const btnNeutralGray = byId("btnNeutralGray");
  const btnObserver = byId("btnObserver");
  const btnStamp = byId("btnStamp");
  const btnGaussianBlur = byId("btnGaussianBlur");
  const btnSharpen = byId("btnSharpen");
  const btnHighPass = byId("btnHighPass");
  const btnContentAwareFill = byId("btnContentAwareFill");

  rebindEvent(btnNeutralGray, "click", onNeutralGrayClickWrapped);
  rebindEvent(btnObserver, "click", onObserverClickWrapped);
  rebindEvent(btnStamp, "click", onStampClickWrapped);
  rebindEvent(btnGaussianBlur, "click", onGaussianBlurClickWrapped);
  rebindEvent(btnSharpen, "click", onSharpenClickWrapped);
  rebindEvent(btnHighPass, "click", onHighPassClickWrapped);
  rebindEvent(btnContentAwareFill, "click", onContentAwareFillClickWrapped);

  rebindEvent(btnNeutralGray, "keydown", preventSpaceTrigger);
  rebindEvent(btnObserver, "keydown", preventSpaceTrigger);
  rebindEvent(btnStamp, "keydown", preventSpaceTrigger);
  rebindEvent(btnGaussianBlur, "keydown", preventSpaceTrigger);
  rebindEvent(btnSharpen, "keydown", preventSpaceTrigger);
  rebindEvent(btnHighPass, "keydown", preventSpaceTrigger);
  rebindEvent(btnContentAwareFill, "keydown", preventSpaceTrigger);

  rebindEvent(btnNeutralGray, "keyup", preventSpaceTrigger);
  rebindEvent(btnObserver, "keyup", preventSpaceTrigger);
  rebindEvent(btnStamp, "keyup", preventSpaceTrigger);
  rebindEvent(btnGaussianBlur, "keyup", preventSpaceTrigger);
  rebindEvent(btnSharpen, "keyup", preventSpaceTrigger);
  rebindEvent(btnHighPass, "keyup", preventSpaceTrigger);
  rebindEvent(btnContentAwareFill, "keyup", preventSpaceTrigger);

  rebindEvent(btnNeutralGray, "keypress", preventSpaceTrigger);
  rebindEvent(btnObserver, "keypress", preventSpaceTrigger);
  rebindEvent(btnStamp, "keypress", preventSpaceTrigger);
  rebindEvent(btnGaussianBlur, "keypress", preventSpaceTrigger);
  rebindEvent(btnSharpen, "keypress", preventSpaceTrigger);
  rebindEvent(btnHighPass, "keypress", preventSpaceTrigger);
  rebindEvent(btnContentAwareFill, "keypress", preventSpaceTrigger);

  return workspaceGateway;
}

module.exports = { initToolsController };
