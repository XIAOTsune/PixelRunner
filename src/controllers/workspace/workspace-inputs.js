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
    getRenderedElementCount,
    updateCurrentAppMeta,
    updateRunButtonUI,
    openTemplatePicker
  } = deps;

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

  function getInputOptions(input) {
    return inputSchema.getInputOptions(input);
  }

  function resolveUiInputType(input) {
    return inputSchema.resolveInputType(input || {});
  }

  function applyInputGridLayout(grid) {
    if (!grid) return;
    const supportsGrid =
      typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("display", "grid");
    if (!supportsGrid) {
      grid.style.display = "flex";
      grid.style.flexDirection = "column";
      grid.style.gap = "8px";
    }
  }

  function createInputField(input, idx) {
    const key = String(input.key || `param_${idx}`);
    const type = resolveUiInputType(input);
    const labelText = input.label || input.name || key;

    if (type === "image") {
      const container = document.createElement("div");
      container.style.marginBottom = "12px";
      container.className = "full-width";

      const labelEl = document.createElement("div");
      labelEl.className = "dynamic-input-label";
      labelEl.innerHTML = `${escapeHtml(labelText)} ${input.required ? '<span style="color:#ff6b6b">*</span>' : ""}`;

      const wrapper = document.createElement("div");
      wrapper.className = "image-input-wrapper";
      wrapper.innerHTML = `
        <img class="image-preview" />
        <div class="image-input-overlay-content">
          <div class="image-input-icon">📷</div>
          <div class="image-input-text">点击从 PS 选区获取</div>
        </div>
      `;

      wrapper.addEventListener("click", async () => {
        const statusText = wrapper.querySelector(".image-input-text");
        const previewImg = wrapper.querySelector(".image-preview");
        if (!statusText || !previewImg) return;

        statusText.textContent = "获取中...";
        try {
          const capture = await ps.captureSelection({ log });
          if (!capture || !capture.arrayBuffer) {
            statusText.textContent = "获取失败";
            return;
          }

          revokePreviewUrl(state.inputValues[key]);
          const previewUrl = createPreviewUrlFromBuffer(capture.arrayBuffer);
          state.inputValues[key] = { arrayBuffer: capture.arrayBuffer, previewUrl };
          if (capture.selectionBounds) state.imageBounds[key] = capture.selectionBounds;

          previewImg.src = previewUrl;
          previewImg.classList.add("has-image");
          statusText.textContent = "已捕获，点击重新获取";
        } catch (error) {
          console.error(error);
          statusText.textContent = "获取失败";
        }
      });

      container.appendChild(labelEl);
      container.appendChild(wrapper);
      return container;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "dynamic-input-field";

    const headerRow = document.createElement("div");
    headerRow.className = "input-label-row";

    const labelEl = document.createElement("span");
    labelEl.className = "dynamic-input-label";
    labelEl.innerHTML = escapeHtml(labelText);
    headerRow.appendChild(labelEl);

    const promptLike = isPromptLikeInput(input) || (type === "text" && (key.toLowerCase().includes("prompt") || String(labelText).includes("提示")));
    let inputEl;

    if (type === "select") {
      const options = getInputOptions(input);
      if (options.length === 0) {
        inputEl = document.createElement("input");
        inputEl.type = "text";
        inputEl.placeholder = String(input.default || "");
        inputEl.value = String(input.default || "");
        state.inputValues[key] = inputEl.value;
        inputEl.addEventListener("input", (event) => {
          state.inputValues[key] = event.target.value;
        });
        wrapper.appendChild(headerRow);
        wrapper.appendChild(inputEl);
        return wrapper;
      }

      inputEl = document.createElement("select");
      options.forEach((opt) => {
        const option = document.createElement("option");
        option.value = opt;
        option.textContent = opt;
        inputEl.appendChild(option);
      });

      const defaultValue = input.default || options[0] || "";
      if (!isEmptyValue(defaultValue)) {
        inputEl.value = defaultValue;
        state.inputValues[key] = defaultValue;
      }
      inputEl.addEventListener("change", (event) => {
        state.inputValues[key] = event.target.value;
      });
    } else if (type === "boolean") {
      inputEl = document.createElement("select");
      inputEl.innerHTML = `<option value="true">是 (True)</option><option value="false">否 (False)</option>`;
      inputEl.value = String(input.default) === "true" ? "true" : "false";
      state.inputValues[key] = inputEl.value === "true";
      inputEl.addEventListener("change", (event) => {
        state.inputValues[key] = event.target.value === "true";
      });
    } else {
      const isLongText = promptLike || (type === "text" && getInputOptions(input).length === 0);
      if (isLongText) {
        inputEl = document.createElement("textarea");
        inputEl.rows = promptLike ? 3 : 1;
        inputEl.placeholder = promptLike ? "输入提示词或选择模板..." : String(input.default || "");
        wrapper.classList.add("full-width");

        if (promptLike) {
          const btnTemplate = document.createElement("button");
          btnTemplate.className = "template-btn";
          btnTemplate.type = "button";
          btnTemplate.textContent = "预设";
          btnTemplate.addEventListener("click", () => {
            openTemplatePicker((content) => {
              inputEl.value = content;
              state.inputValues[key] = content;
              inputEl.style.borderColor = "#4caf50";
              setTimeout(() => {
                inputEl.style.borderColor = "";
              }, 300);
            });
          });
          headerRow.appendChild(btnTemplate);
        }
      } else {
        inputEl = document.createElement("input");
        inputEl.type = type === "number" ? "number" : "text";
        inputEl.placeholder = String(input.default || "");
        if (type === "number") {
          if (Number.isFinite(input.min)) inputEl.min = String(input.min);
          if (Number.isFinite(input.max)) inputEl.max = String(input.max);
          if (Number.isFinite(input.step)) inputEl.step = String(input.step);
        }
      }

      inputEl.value = String(input.default || "");
      state.inputValues[key] = inputEl.value;
      inputEl.addEventListener("input", (event) => {
        state.inputValues[key] = event.target.value;
      });
    }

    wrapper.appendChild(headerRow);
    wrapper.appendChild(inputEl);
    return wrapper;
  }

  function createFallbackInputField(input, idx) {
    const key = String((input && input.key) || `param_${idx}`);
    const labelText = (input && (input.label || input.name || key)) || key;

    const wrapper = document.createElement("div");
    wrapper.className = "dynamic-input-field";

    const headerRow = document.createElement("div");
    headerRow.className = "input-label-row";

    const labelEl = document.createElement("span");
    labelEl.className = "dynamic-input-label";
    labelEl.innerHTML = `${escapeHtml(labelText)} <span style="opacity:.6;">(fallback)</span>`;
    headerRow.appendChild(labelEl);

    const inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.placeholder = "";
    inputEl.value = String((input && input.default) || "");
    state.inputValues[key] = inputEl.value;
    inputEl.addEventListener("input", (event) => {
      state.inputValues[key] = event.target.value;
    });

    wrapper.appendChild(headerRow);
    wrapper.appendChild(inputEl);
    return wrapper;
  }

  function createMinimalFallbackField(input, idx) {
    const key = String((input && input.key) || `param_${idx}`);
    const labelText = (input && (input.label || input.name || key)) || key;

    const wrapper = document.createElement("div");
    wrapper.className = "dynamic-input-field";

    const labelEl = document.createElement("div");
    labelEl.className = "dynamic-input-label";
    labelEl.textContent = String(labelText || "参数");

    const inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.value = String((input && input.default) || "");
    state.inputValues[key] = inputEl.value;
    inputEl.addEventListener("input", (event) => {
      state.inputValues[key] = event.target.value;
    });

    wrapper.appendChild(labelEl);
    wrapper.appendChild(inputEl);
    return wrapper;
  }

  function renderFallbackInputs(inputs, container) {
    if (!container) return 0;
    const fallbackList = document.createElement("div");
    fallbackList.className = "input-grid";
    fallbackList.style.display = "flex";
    fallbackList.style.flexDirection = "column";
    fallbackList.style.gap = "8px";
    let fallbackCount = 0;

    inputs.forEach((input, idx) => {
      try {
        fallbackList.appendChild(createFallbackInputField(input, idx));
        fallbackCount += 1;
      } catch (error) {
        console.error("[Workspace] render minimal fallback failed", input, error);
        try {
          fallbackList.appendChild(createMinimalFallbackField(input, idx));
          fallbackCount += 1;
        } catch (finalError) {
          console.error("[Workspace] render minimal fallback hard failed", input, finalError);
        }
      }
    });

    container.appendChild(fallbackList);
    return fallbackCount;
  }

  function renderDynamicInputs(appItem) {
    Object.values(state.inputValues || {}).forEach(revokePreviewUrl);
    state.currentApp = appItem || null;
    state.inputValues = {};
    state.imageBounds = {};

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
      if (container) container.innerHTML = `<div class="empty-state">请点击上方“切换”选择应用</div>`;
      updateRunButtonUI();
      return;
    }

    const inputs = Array.isArray(appItem.inputs) ? appItem.inputs : [];
    const imageInputs = inputs.filter((input) => resolveUiInputType(input) === "image");
    const otherInputs = inputs.filter((input) => resolveUiInputType(input) !== "image");
    log(`render inputs: image=${imageInputs.length}, other=${otherInputs.length}`, "info");

    if (imageInputs.length > 0 && imgContainer) {
      imgContainer.style.display = "block";
      imageInputs.forEach((input, idx) => {
        const field = createInputField(input, idx);
        imgContainer.appendChild(field);
      });
    }

    if (otherInputs.length > 0 && container) {
      const grid = document.createElement("div");
      grid.className = "input-grid";
      applyInputGridLayout(grid);
      let renderedCount = 0;

      otherInputs.forEach((input, idx) => {
        const fieldKey = String((input && input.key) || `param_${idx}`);
        try {
          const field = createInputField(input, idx);
          const inputType = resolveUiInputType(input);
          const isLongText = inputType === "text" && getInputOptions(input).length === 0;
          let isPrompt = false;
          try {
            isPrompt = isPromptLikeInput(input);
          } catch (_) {
            isPrompt = false;
          }
          if (isLongText || isPrompt) {
            field.classList.add("full-width");
            field.style.gridColumn = "span 2";
          }
          grid.appendChild(field);
          renderedCount += 1;
        } catch (error) {
          console.error("[Workspace] render input failed", input, error);
          const fieldName = input && (input.label || input.name || input.key) ? input.label || input.name || input.key : "unknown";
          log(`render input failed: ${fieldName} | ${error && error.message ? error.message : error}`, "warn");
          try {
            grid.appendChild(createFallbackInputField(input, idx));
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
        const fallbackCount = renderFallbackInputs(otherInputs, container);
        if (fallbackCount > 0) {
          log(`rendered fallback inputs: ${fallbackCount}`, "warn");
        } else {
          container.innerHTML = `<div class="empty-state" style="padding:10px; font-size:12px;">参数渲染失败，请重新解析应用后重试</div>`;
        }
      }
    } else if (imageInputs.length === 0 && container) {
      container.innerHTML = `<div class="empty-state" style="padding:10px; font-size:12px;">该应用没有可配置参数，请直接运行</div>`;
    }

    updateRunButtonUI();
  }

  function resolveTargetBounds() {
    if (!state.currentApp) return null;
    const inputs = Array.isArray(state.currentApp.inputs) ? state.currentApp.inputs : [];
    for (const input of inputs) {
      if (resolveUiInputType(input) !== "image") continue;
      const key = String(input.key || "").trim();
      if (!key) continue;
      if (isEmptyValue(state.inputValues[key])) continue;
      if (state.imageBounds[key]) return state.imageBounds[key];
    }
    return null;
  }

  return {
    revokePreviewUrl,
    createPreviewUrlFromBuffer,
    getInputOptions,
    resolveUiInputType,
    createInputField,
    createFallbackInputField,
    renderDynamicInputs,
    resolveTargetBounds
  };
}

module.exports = { createWorkspaceInputs };
