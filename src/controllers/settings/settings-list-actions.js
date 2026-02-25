function getActionButton(event, container) {
  const target = event && event.target;
  const button = target && typeof target.closest === "function" ? target.closest("button[data-action]") : null;
  if (!button) return null;
  if (!container || typeof container.contains !== "function") return null;
  if (!container.contains(button)) return null;
  return button;
}

function decodeId(decodeDataId, value) {
  const fn = typeof decodeDataId === "function" ? decodeDataId : (v) => String(v || "");
  return fn(String(value || "").trim());
}

function resolveSavedItemId(button, options = {}) {
  const findClosestByClass =
    typeof options.findClosestByClass === "function" ? options.findClosestByClass : () => null;
  const decodeDataId = options.decodeDataId;
  const row = findClosestByClass(button, "saved-item");
  const idFromButton = decodeId(decodeDataId, button && button.dataset ? button.dataset.id : "");
  const idFromRow = row && row.dataset ? decodeId(decodeDataId, row.dataset.id || "") : "";
  return idFromButton || idFromRow || "";
}

function resolveSavedAppsListAction(event, options = {}) {
  const button = getActionButton(event, options.container);
  if (!button) return { kind: "none", id: "" };

  const action = String((button.dataset && button.dataset.action) || "");
  if (action === "edit-app") {
    return {
      kind: "edit-app",
      id: resolveSavedItemId(button, options)
    };
  }
  if (action === "delete-app") {
    return {
      kind: "delete-app",
      id: resolveSavedItemId(button, options)
    };
  }
  return {
    kind: "none",
    id: ""
  };
}

function resolveSavedTemplatesListAction(event, options = {}) {
  const button = getActionButton(event, options.container);
  if (!button) return { kind: "none", id: "" };

  const action = String((button.dataset && button.dataset.action) || "");
  if (action === "edit-template") {
    return {
      kind: "edit-template",
      id: decodeId(options.decodeDataId, button.dataset ? button.dataset.id : "")
    };
  }
  if (action === "delete-template") {
    return {
      kind: "delete-template",
      id: decodeId(options.decodeDataId, button.dataset ? button.dataset.id : "")
    };
  }
  return {
    kind: "none",
    id: ""
  };
}

module.exports = {
  getActionButton,
  resolveSavedItemId,
  resolveSavedAppsListAction,
  resolveSavedTemplatesListAction
};
