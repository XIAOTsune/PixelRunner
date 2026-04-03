function byId(id) {
  if (typeof document === "undefined" || typeof document.getElementById !== "function") return null;
  return document.getElementById(id);
}

function encodeDataId(id) {
  return encodeURIComponent(String(id || ""));
}

function decodeDataId(encodedId) {
  if (!encodedId) return "";
  try {
    return decodeURIComponent(encodedId);
  } catch (_) {
    return String(encodedId || "");
  }
}

function getRenderedElementCount(node) {
  if (!node) return 0;
  if (typeof node.childElementCount === "number") return node.childElementCount;
  if (node.children && typeof node.children.length === "number") return node.children.length;
  if (node.childNodes && typeof node.childNodes.length === "number") {
    let count = 0;
    for (let i = 0; i < node.childNodes.length; i += 1) {
      const child = node.childNodes[i];
      if (child && child.nodeType === 1) count += 1;
    }
    return count;
  }
  return 0;
}

function findClosestByClass(startNode, className) {
  let node = startNode;
  while (node && node !== document) {
    if (node.classList && node.classList.contains(className)) return node;
    node = node.parentNode;
  }
  return null;
}

function findClosestButtonWithAction(startNode) {
  let node = startNode;
  while (node && node !== document) {
    const isButton = node.tagName && String(node.tagName).toLowerCase() === "button";
    if (isButton && node.dataset && node.dataset.action) return node;
    node = node.parentNode;
  }
  return null;
}

function rebindEvent(target, eventName, handler) {
  if (!target || typeof target.addEventListener !== "function") return;
  target.removeEventListener(eventName, handler);
  target.addEventListener(eventName, handler);
}

module.exports = {
  byId,
  encodeDataId,
  decodeDataId,
  getRenderedElementCount,
  findClosestByClass,
  findClosestButtonWithAction,
  rebindEvent
};
