const textInputPolicy = require("../../domain/policies/text-input-policy");
const { createInputPolicy } = require("../../domain/policies/input-policy");
const { createInputRenderer } = require("./input-renderer");
const { createWorkspaceInputStateService } = require("../../application/services/workspace-input-state");

function createWorkspaceInputs(deps) {
  const {
    state,
    dom,
    byId,
    ps,
    log,
    inputSchema,
    escapeHtml,
    isPromptLikeInput,
    isEmptyValue,
    updateCurrentAppMeta,
    updateRunButtonUI,
    openTemplatePicker
  } = deps;

  const LARGE_PROMPT_WARNING_CHARS = textInputPolicy.LARGE_PROMPT_WARNING_CHARS;
  const inputPolicy = createInputPolicy({ inputSchema, isPromptLikeInput });
  const warnedPromptKeys = new Set();
  const inputState = createWorkspaceInputStateService({ state });

  function getTextLength(value) {
    return textInputPolicy.getTextLength(value);
  }

  function warnLargePromptLength(key, value) {
    const length = getTextLength(value);
    if (length < LARGE_PROMPT_WARNING_CHARS) {
      warnedPromptKeys.delete(key);
      return;
    }
    if (warnedPromptKeys.has(key)) return;
    warnedPromptKeys.add(key);
    log(`Prompt length reached ${length} chars. Keep under 4000 to avoid RunningHub rejection.`, "warn");
  }

  function revokePreviewUrl(value) {
    if (!value || typeof value !== "object") return;
    const url = String(value.previewUrl || "");
    if (!url.startsWith("blob:")) return;
    try {
      URL.revokeObjectURL(url);
    } catch (_) {}
  }

  function createPreviewUrlFromBuffer(arrayBuffer) {
    try {
      const blob = new Blob([arrayBuffer], { type: "image/png" });
      return URL.createObjectURL(blob);
    } catch (_) {
      try {
        let binary = "";
        const bytes = new Uint8Array(arrayBuffer);
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.byteLength; i += chunkSize) {
          const chunk = bytes.subarray(i, i + chunkSize);
          binary += String.fromCharCode(...chunk);
        }
        return `data:image/png;base64,${btoa(binary)}`;
      } catch (_) {
        return "";
      }
    }
  }

  const inputRenderer = createInputRenderer({
    state,
    ps,
    log,
    escapeHtml,
    inputPolicy,
    isEmptyValue,
    openTemplatePicker,
    onPromptLargeValue: warnLargePromptLength,
    setInputValueByKey: inputState.setInputValueByKey,
    deleteInputValueByKey: inputState.deleteInputValueByKey,
    getInputValueByKey: inputState.getInputValueByKey,
    clearImageInputByKey: inputState.clearImageInputByKey,
    applyCapturedImageByKey: inputState.applyCapturedImageByKey,
    revokePreviewUrl,
    createPreviewUrlFromBuffer
  });

  function getInputOptions(input) {
    return inputPolicy.getInputOptions(input);
  }

  function getInputOptionEntries(input) {
    return inputPolicy.getInputOptionEntries(input);
  }

  function resolveUiInputType(input) {
    return inputPolicy.resolveUiInputType(input || {});
  }

  function renderDynamicInputs(appItem) {
    warnedPromptKeys.clear();
    inputState.resetRuntimeValues({ revokePreviewUrl });
    state.currentApp = appItem || null;

    const container = dom.dynamicInputContainer || byId("dynamicInputContainer");
    const imgContainer = dom.imageInputContainer || byId("imageInputContainer");

    updateCurrentAppMeta();

    if (container) {
      container.innerHTML = "";
      container.style.display = "block";
      container.style.visibility = "visible";
      container.style.opacity = "1";
    }
    if (imgContainer) {
      imgContainer.innerHTML = "";
      imgContainer.style.display = "none";
    }

    if (!appItem) {
      if (container) container.innerHTML = `<div class="empty-state">璇风偣鍑讳笂鏂光€滃垏鎹⑩€濋€夋嫨搴旂敤</div>`;
      updateRunButtonUI();
      return;
    }

    const inputs = Array.isArray(appItem.inputs) ? appItem.inputs : [];
    const { imageInputs, otherInputs } = inputPolicy.splitImageAndOtherInputs(inputs);
    log(`render inputs: image=${imageInputs.length}, other=${otherInputs.length}`, "info");

    if (imageInputs.length > 0 && imgContainer) {
      imgContainer.style.display = "block";
      imageInputs.forEach((input, idx) => {
        const field = inputRenderer.createInputField(input, idx);
        imgContainer.appendChild(field);
      });
    }

    if (otherInputs.length > 0 && container) {
      const grid = document.createElement("div");
      grid.className = "input-grid";
      inputRenderer.applyInputGridLayout(grid);
      let renderedCount = 0;

      otherInputs.forEach((input, idx) => {
        const fieldKey = String((input && input.key) || `param_${idx}`);
        try {
          const field = inputRenderer.createInputField(input, idx);
          const isLongText = inputPolicy.isLongTextInput(input);
          const isPrompt = inputPolicy.isPromptLikeField(input);
          if (isLongText || isPrompt) {
            field.classList.add("full-width");
            field.style.gridColumn = "span 2";
          }
          grid.appendChild(field);
          renderedCount += 1;
        } catch (error) {
          console.error("[Workspace] render input failed", input, error);
          const fieldName =
            input && (input.label || input.name || input.key)
              ? input.label || input.name || input.key
              : "unknown";
          log(`render input failed: ${fieldName} | ${error && error.message ? error.message : error}`, "warn");
          try {
            grid.appendChild(inputRenderer.createFallbackInputField(input, idx));
            renderedCount += 1;
            log(`render field fallback: ${fieldKey}`, "warn");
          } catch (fallbackError) {
            console.error("[Workspace] render fallback input failed", input, fallbackError);
          }
        }
      });

      if (renderedCount > 0) {
        container.appendChild(grid);
        log(`rendered non-image inputs: ${renderedCount}`, "info");
      } else {
        const fallbackCount = inputRenderer.renderFallbackInputs(otherInputs, container);
        if (fallbackCount > 0) {
          log(`rendered fallback inputs: ${fallbackCount}`, "warn");
        } else {
          container.innerHTML = `<div class="empty-state" style="padding:10px; font-size:12px;">鍙傛暟娓叉煋澶辫触锛岃閲嶆柊瑙ｆ瀽搴旂敤鍚庨噸璇?/div>`;
        }
      }
    } else if (imageInputs.length === 0 && container) {
      container.innerHTML = `<div class="empty-state" style="padding:10px; font-size:12px;">璇ュ簲鐢ㄦ病鏈夊彲閰嶇疆鍙傛暟锛岃鐩存帴杩愯</div>`;
    }

    updateRunButtonUI();
  }

  function resolveTargetBounds() {
    if (!state.currentApp) return null;
    const inputs = Array.isArray(state.currentApp.inputs) ? state.currentApp.inputs : [];
    const { imageInputs } = inputPolicy.splitImageAndOtherInputs(inputs);
    const firstImage = imageInputs[0];
    if (firstImage) {
      const key = String(firstImage.key || "").trim();
      const firstBounds = inputState.getImageBoundsByKey(key);
      if (key && firstBounds) return firstBounds;
    }
    for (const input of imageInputs) {
      const key = String(input.key || "").trim();
      if (!key) continue;
      const bounds = inputState.getImageBoundsByKey(key);
      if (bounds) return bounds;
    }
    return null;
  }

  function resolveSourceImageBuffer() {
    if (!state.currentApp) return null;
    const inputs = Array.isArray(state.currentApp.inputs) ? state.currentApp.inputs : [];
    const { imageInputs } = inputPolicy.splitImageAndOtherInputs(inputs);

    const firstImage = imageInputs[0];
    if (firstImage) {
      const key = String(firstImage.key || "").trim();
      const buffer = inputState.pickImageArrayBufferByKey(key);
      if (buffer) return buffer;
    }

    for (const input of imageInputs) {
      const key = String(input.key || "").trim();
      if (!key) continue;
      const buffer = inputState.pickImageArrayBufferByKey(key);
      if (buffer) return buffer;
    }
    return null;
  }

  return {
    revokePreviewUrl,
    createPreviewUrlFromBuffer,
    getInputOptions,
    getInputOptionEntries,
    resolveUiInputType,
    createInputField: inputRenderer.createInputField,
    createFallbackInputField: inputRenderer.createFallbackInputField,
    renderDynamicInputs,
    resolveTargetBounds,
    resolveSourceImageBuffer
  };
}

module.exports = { createWorkspaceInputs };
