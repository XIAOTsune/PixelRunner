function resolveAliasKey(key) {
  const marker = String(key || "").trim();
  if (!marker) return "";
  const alias = marker.split(":").pop();
  return alias && alias !== marker ? alias : "";
}

function setValueOnMap(map, key, value) {
  if (!map || typeof map !== "object") return;
  const marker = String(key || "").trim();
  if (!marker) return;
  map[marker] = value;
  const alias = resolveAliasKey(marker);
  if (alias) map[alias] = value;
}

function deleteValueOnMap(map, key) {
  if (!map || typeof map !== "object") return;
  const marker = String(key || "").trim();
  if (!marker) return;
  delete map[marker];
  const alias = resolveAliasKey(marker);
  if (alias) delete map[alias];
}

function getValueFromMap(map, key) {
  if (!map || typeof map !== "object") return undefined;
  const marker = String(key || "").trim();
  if (!marker) return undefined;
  if (Object.prototype.hasOwnProperty.call(map, marker)) return map[marker];
  const alias = resolveAliasKey(marker);
  if (alias && Object.prototype.hasOwnProperty.call(map, alias)) return map[alias];
  return undefined;
}

function createWorkspaceInputStateService(deps = {}) {
  const state = deps.state;
  if (!state || typeof state !== "object") {
    throw new Error("createWorkspaceInputStateService requires state");
  }

  if (!state.inputValues || typeof state.inputValues !== "object") state.inputValues = {};
  if (!state.imageBounds || typeof state.imageBounds !== "object") state.imageBounds = {};

  function setInputValueByKey(key, value) {
    setValueOnMap(state.inputValues, key, value);
  }

  function deleteInputValueByKey(key) {
    deleteValueOnMap(state.inputValues, key);
  }

  function getInputValueByKey(key) {
    return getValueFromMap(state.inputValues, key);
  }

  function setImageBoundsByKey(key, bounds) {
    if (!bounds || typeof bounds !== "object") return;
    setValueOnMap(state.imageBounds, key, bounds);
  }

  function getImageBoundsByKey(key) {
    return getValueFromMap(state.imageBounds, key);
  }

  function clearImageInputByKey(key, options = {}) {
    const revokePreviewUrl =
      options && typeof options.revokePreviewUrl === "function"
        ? options.revokePreviewUrl
        : () => {};
    const previousValue = getInputValueByKey(key);
    revokePreviewUrl(previousValue);
    deleteValueOnMap(state.inputValues, key);
    deleteValueOnMap(state.imageBounds, key);
  }

  function applyCapturedImageByKey(key, result) {
    if (!result || !result.value) return false;
    setInputValueByKey(key, result.value);
    if (result.selectionBounds) {
      setImageBoundsByKey(key, result.selectionBounds);
    }
    return true;
  }

  function resetRuntimeValues(options = {}) {
    const revokePreviewUrl =
      options && typeof options.revokePreviewUrl === "function"
        ? options.revokePreviewUrl
        : () => {};
    const values = state.inputValues && typeof state.inputValues === "object" ? state.inputValues : {};
    Object.keys(values).forEach((key) => {
      revokePreviewUrl(values[key]);
    });
    state.inputValues = {};
    state.imageBounds = {};
  }

  function pickImageArrayBufferByKey(key) {
    const value = getInputValueByKey(key);
    if (value && value.arrayBuffer instanceof ArrayBuffer) return value.arrayBuffer;
    if (value && ArrayBuffer.isView(value.arrayBuffer)) {
      const view = value.arrayBuffer;
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
    return null;
  }

  return {
    setInputValueByKey,
    deleteInputValueByKey,
    getInputValueByKey,
    setImageBoundsByKey,
    getImageBoundsByKey,
    clearImageInputByKey,
    applyCapturedImageByKey,
    resetRuntimeValues,
    pickImageArrayBufferByKey
  };
}

module.exports = {
  createWorkspaceInputStateService
};
