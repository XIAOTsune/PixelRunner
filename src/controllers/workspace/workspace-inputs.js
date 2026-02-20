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
  const LARGE_PROMPT_WARNING_CHARS = 4000;
  const warnedPromptKeys = new Set();

  function getTextLength(value) {
    return Array.from(String(value == null ? "" : value)).length;
  }

  function warnLargePromptLength(key, value) {
    const length = getTextLength(value);
    if (length < LARGE_PROMPT_WARNING_CHARS) {
      warnedPromptKeys.delete(key);
      return;
    }
    if (warnedPromptKeys.has(key)) return;
    warnedPromptKeys.add(key);
    log(
      `提示词长度已达到 ${length} 字符。建议控制在 4000 字符内，避免 RunningHub 侧拒绝。`,
      "warn"
    );
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

  function getInputOptions(input) {
    return inputSchema.getInputOptions(input);
  }

  function getInputOptionEntries(input) {
    if (inputSchema && typeof inputSchema.getInputOptionEntries === "function") {
      return inputSchema.getInputOptionEntries(input);
    }
    const options = getInputOptions(input);
    return (Array.isArray(options) ? options : []).map((value) => ({ value, label: String(value) }));
  }

  function resolveUiInputType(input) {
    return inputSchema.resolveInputType(input || {});
  }

  function setInputValueByKey(key, value) {
    state.inputValues[key] = value;
    state.inputValues[key.split(":").pop()] = value;
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
    const labelHint = input.labelConfidence !== undefined && input.labelConfidence < 0.5
      ? `${labelText} (${input.fieldName || key})`
      : labelText;
    const isUiRequired = type === "image"
      ? Boolean(input && input.required && input.requiredExplicit === true)
      : Boolean(input && input.required);

    if (type === "image") {
      const container = document.createElement("div");
      container.style.marginBottom = "12px";
      container.className = "full-width";

      const labelEl = document.createElement("div");
      labelEl.className = "dynamic-input-label";
      labelEl.innerHTML = `${escapeHtml(labelHint)} ${isUiRequired ? '<span style="color:#ff6b6b">*</span>' : ""}`;

      const wrapper = document.createElement("div");
      wrapper.className = "image-input-wrapper";
      wrapper.innerHTML = `
        <img class="image-preview" />
        <div class="image-input-overlay-content">
          <div class="image-input-icon">📷</div>
          <div class="image-input-text">点击从 PS 选区获取</div>
        </div>
      `;

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.textContent = "清除";
      clearBtn.className = "image-input-clear-btn";
      clearBtn.style.position = "absolute";
      clearBtn.style.top = "8px";
      clearBtn.style.right = "8px";
      clearBtn.style.zIndex = "3";
      clearBtn.style.padding = "2px 6px";
      clearBtn.style.fontSize = "10px";
      clearBtn.style.borderRadius = "2px";
      clearBtn.style.border = "1px solid #555";
      clearBtn.style.background = "rgba(0,0,0,0.5)";
      clearBtn.style.color = "#ddd";
      clearBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const statusText = wrapper.querySelector(".image-input-text");
        const previewImg = wrapper.querySelector(".image-preview");
        revokePreviewUrl(state.inputValues[key]);
        delete state.inputValues[key];
        delete state.imageBounds[key];
        if (previewImg) {
          previewImg.src = "";
          previewImg.classList.remove("has-image");
        }
        if (statusText) statusText.textContent = "点击从 PS 选区获取";
      });
      wrapper.appendChild(clearBtn);

      wrapper.addEventListener("click", async () => {
        const statusText = wrapper.querySelector(".image-input-text");
        const previewImg = wrapper.querySelector(".image-preview");
        if (!statusText || !previewImg) return;

        statusText.textContent = "正在获取图像中...";
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
    wrapper.dataset.inputKey = key;

    const headerRow = document.createElement("div");
    headerRow.className = "input-label-row";

    const labelEl = document.createElement("span");
    labelEl.className = "dynamic-input-label";
    labelEl.innerHTML = escapeHtml(labelHint);
    headerRow.appendChild(labelEl);

    const typeHint = String(input.type || input.fieldType || "").toLowerCase();
    const promptLike =
      isPromptLikeInput(input) ||
      (type === "text" && (key.toLowerCase().includes("prompt") || String(labelText).includes("提示"))) ||
      /prompt|text|string/.test(typeHint);
    let inputEl;

    const fieldTypeHint = String(input.fieldType || input.type || "").toLowerCase();
    if (type === "select" || /select|enum|list/.test(fieldTypeHint)) {
      const optionEntries = getInputOptionEntries(input);
      if (optionEntries.length <= 1) {
        inputEl = document.createElement("input");
        inputEl.type = "text";
        inputEl.placeholder = String(input.default || "");
        inputEl.value = String(input.default || "");
        const defaultNumeric = input.default !== undefined && input.default !== null ? Number(input.default) : NaN;
        if (Number.isFinite(defaultNumeric)) {
          setInputValueByKey(key, defaultNumeric);
        } else {
          setInputValueByKey(key, inputEl.value);
        }
        inputEl.addEventListener("input", (event) => {
          const nextValue = event.target.value;
          const numeric = Number(nextValue);
          const storedValue = type === "number" && Number.isFinite(numeric) ? numeric : nextValue;
          setInputValueByKey(key, storedValue);
        });
        wrapper.appendChild(headerRow);
        wrapper.appendChild(inputEl);
        return wrapper;
      }

      inputEl = document.createElement("select");
      const optionValueMap = new Map();
      optionEntries.forEach((entry) => {
        const rawValue = entry && Object.prototype.hasOwnProperty.call(entry, "value") ? entry.value : "";
        const rawLabel = entry && Object.prototype.hasOwnProperty.call(entry, "label") ? entry.label : rawValue;
        const domValue = String(rawValue);
        const option = document.createElement("option");
        option.value = domValue;
        option.textContent = String(rawLabel || rawValue || "");
        inputEl.appendChild(option);
        if (!optionValueMap.has(domValue)) {
          optionValueMap.set(domValue, rawValue);
        }
      });

      const firstOption = optionEntries[0];
      const rawDefaultValue = !isEmptyValue(input.default) ? input.default : firstOption && firstOption.value;
      const defaultDomValue = String(rawDefaultValue == null ? "" : rawDefaultValue);
      const selectedDomValue = optionValueMap.has(defaultDomValue)
        ? defaultDomValue
        : String(firstOption && firstOption.value != null ? firstOption.value : "");
      inputEl.value = selectedDomValue;
      const typedDefaultValue = optionValueMap.has(selectedDomValue) ? optionValueMap.get(selectedDomValue) : selectedDomValue;
      setInputValueByKey(key, typedDefaultValue);

      inputEl.addEventListener("change", (event) => {
        const selectedValue = event.target.value;
        const typedValue = optionValueMap.has(selectedValue) ? optionValueMap.get(selectedValue) : selectedValue;
        setInputValueByKey(key, typedValue);
      });
    } else if (type === "boolean") {
      inputEl = document.createElement("select");
      inputEl.innerHTML = `<option value="true">是 (True)</option><option value="false">否 (False)</option>`;
      const defaultMarker = String(input.default == null ? "" : input.default).trim().toLowerCase();
      inputEl.value = defaultMarker === "true" || defaultMarker === "1" || defaultMarker === "yes" ? "true" : "false";
      const boolValue = inputEl.value === "true";
      setInputValueByKey(key, boolValue);
      inputEl.addEventListener("change", (event) => {
        const nextValue = event.target.value === "true";
        setInputValueByKey(key, nextValue);
      });
    } else {
      const isLongText = promptLike || (type === "text" && getInputOptions(input).length === 0);
      if (isLongText) {
        inputEl = document.createElement("textarea");
        inputEl.rows = promptLike ? 6 : 2;
        inputEl.placeholder = promptLike ? "输入提示词或选择模板..." : String(input.default || "");
        inputEl.wrap = "soft";
        inputEl.style.paddingRight = "14px";
        inputEl.style.overflowX = "hidden";
        if (promptLike) {
          inputEl.classList.add("prompt-input-textarea");
          inputEl.style.fontFamily = `"Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif`;
          inputEl.style.minHeight = "120px";
          inputEl.style.maxHeight = "260px";
          inputEl.style.overflowY = "auto";
        }
        wrapper.classList.add("full-width");

        if (promptLike) {
          const btnTemplate = document.createElement("button");
          btnTemplate.className = "template-btn";
          btnTemplate.type = "button";
          btnTemplate.textContent = "预设";
          btnTemplate.addEventListener("click", () => {
            openTemplatePicker({
              mode: "multiple",
              maxSelection: 5,
              onApply: (result) => {
                const templateContent = String(
                  result && Object.prototype.hasOwnProperty.call(result, "content") ? result.content : ""
                );
                if (!templateContent.trim()) return;
                inputEl.value = templateContent;
                setInputValueByKey(key, templateContent);
                if (promptLike) warnLargePromptLength(key, templateContent);
                inputEl.style.borderColor = "#4caf50";
                setTimeout(() => {
                  inputEl.style.borderColor = "";
                }, 300);
              }
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

      const initialTextValue = String(input.default || "");
      inputEl.value = initialTextValue;
      if (type === "number") {
        const numericDefault = Number(input.default);
        const storedValue = Number.isFinite(numericDefault) ? numericDefault : 0;
        setInputValueByKey(key, storedValue);
      } else {
        setInputValueByKey(key, inputEl.value);
        if (promptLike) warnLargePromptLength(key, inputEl.value);
      }
      inputEl.addEventListener("input", (event) => {
        const nextValue = event.target.value;
        const numeric = Number(nextValue);
        const storedValue = type === "number" && Number.isFinite(numeric) ? numeric : nextValue;
        setInputValueByKey(key, storedValue);
        if (promptLike) warnLargePromptLength(key, nextValue);
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
    warnedPromptKeys.clear();
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
    const imageInputs = inputs.filter((input) => resolveUiInputType(input) === "image");
    const firstImage = imageInputs[0];
    if (firstImage) {
      const key = String(firstImage.key || "").trim();
      if (key && state.imageBounds[key]) return state.imageBounds[key];
    }
    for (const input of imageInputs) {
      const key = String(input.key || "").trim();
      if (!key) continue;
      if (state.imageBounds[key]) return state.imageBounds[key];
    }
    return null;
  }

  function resolveSourceImageBuffer() {
    if (!state.currentApp) return null;
    const inputs = Array.isArray(state.currentApp.inputs) ? state.currentApp.inputs : [];
    const imageInputs = inputs.filter((input) => resolveUiInputType(input) === "image");
    const firstImage = imageInputs[0];
    const pickBuffer = (key) => {
      const value = key ? state.inputValues[key] : null;
      if (value && value.arrayBuffer instanceof ArrayBuffer) return value.arrayBuffer;
      if (value && ArrayBuffer.isView(value.arrayBuffer)) {
        const view = value.arrayBuffer;
        return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
      }
      return null;
    };

    if (firstImage) {
      const key = String(firstImage.key || "").trim();
      const buffer = pickBuffer(key);
      if (buffer) return buffer;
    }

    for (const input of imageInputs) {
      const key = String(input.key || "").trim();
      if (!key) continue;
      const buffer = pickBuffer(key);
      if (buffer) return buffer;
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
    resolveTargetBounds,
    resolveSourceImageBuffer
  };
}

module.exports = { createWorkspaceInputs };
