const textInputPolicy = require("../../domain/policies/text-input-policy");
const { captureImageInput } = require("../../application/usecases/capture-image-input");

function createInputRenderer(deps = {}) {
  const {
    state,
    ps,
    log,
    escapeHtml,
    inputPolicy,
    isEmptyValue,
    openTemplatePicker,
    onPromptLargeValue,
    setInputValueByKey,
    getInputValueByKey,
    clearImageInputByKey,
    applyCapturedImageByKey,
    revokePreviewUrl,
    createPreviewUrlFromBuffer
  } = deps;

  if (!state || typeof state !== "object") {
    throw new Error("createInputRenderer requires state");
  }
  if (!inputPolicy || typeof inputPolicy !== "object") {
    throw new Error("createInputRenderer requires inputPolicy");
  }
  if (typeof setInputValueByKey !== "function") {
    throw new Error("createInputRenderer requires setInputValueByKey");
  }
  if (typeof clearImageInputByKey !== "function") {
    throw new Error("createInputRenderer requires clearImageInputByKey");
  }
  if (typeof applyCapturedImageByKey !== "function") {
    throw new Error("createInputRenderer requires applyCapturedImageByKey");
  }

  const LARGE_PROMPT_WARNING_CHARS = textInputPolicy.LARGE_PROMPT_WARNING_CHARS;
  const TEXT_INPUT_HARD_MAX_CHARS = textInputPolicy.TEXT_INPUT_HARD_MAX_CHARS;

  function getTextLength(value) {
    return textInputPolicy.getTextLength(value);
  }

  function getTailPreview(value, maxChars = 20) {
    return textInputPolicy.getTailPreview(value, maxChars);
  }

  function enforceLongTextCapacity(inputEl) {
    textInputPolicy.enforceLongTextCapacity(inputEl, TEXT_INPUT_HARD_MAX_CHARS);
  }

  function insertTextAtCursor(inputEl, rawText) {
    textInputPolicy.insertTextAtCursor(inputEl, rawText);
  }

  function notifyPromptValueChange(key, value, updatePromptLengthHint) {
    if (typeof onPromptLargeValue === "function") {
      onPromptLargeValue(key, value);
    }
    if (typeof updatePromptLengthHint === "function") {
      updatePromptLengthHint(value);
    }
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
    const type = inputPolicy.resolveUiInputType(input || {});
    const labelText = input.label || input.name || key;
    const labelHint =
      input.labelConfidence !== undefined && input.labelConfidence < 0.5
        ? `${labelText} (${input.fieldName || key})`
        : labelText;
    const isUiRequired =
      type === "image"
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
        clearImageInputByKey(key, { revokePreviewUrl });
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
        const result = await captureImageInput({
          ps,
          log,
          previousValue: typeof getInputValueByKey === "function" ? getInputValueByKey(key) : state.inputValues[key],
          revokePreviewUrl,
          createPreviewUrlFromBuffer
        });
        if (!result || !result.ok || !result.value) {
          if (result && result.reason === "error") {
            console.error(result.message || "capture image failed");
          }
          statusText.textContent = "获取失败";
          return;
        }

        applyCapturedImageByKey(key, result);
        previewImg.src = result.value.previewUrl || "";
        previewImg.classList.add("has-image");
        statusText.textContent = "已捕获，点击重新获取";
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

    const promptLike = inputPolicy.isPromptLikeField(input);
    let inputEl;
    let promptLengthHintEl = null;
    let updatePromptLengthHint = null;

    const fieldTypeHint = String(input.fieldType || input.type || "").toLowerCase();
    if (type === "select" || /select|enum|list/.test(fieldTypeHint)) {
      const optionEntries = inputPolicy.getInputOptionEntries(input);
      if (optionEntries.length <= 1 && !promptLike) {
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

      if (optionEntries.length > 1) {
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
      }
    }

    if (!inputEl && type === "boolean") {
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
    }

    if (!inputEl) {
      const isLongText = promptLike || inputPolicy.isLongTextInput(input);
      if (isLongText) {
        inputEl = document.createElement("textarea");
        inputEl.rows = promptLike ? 6 : 2;
        inputEl.placeholder = promptLike ? "输入提示词或选择模板..." : String(input.default || "");
        inputEl.wrap = "soft";
        enforceLongTextCapacity(inputEl);
        inputEl.style.paddingRight = "14px";
        inputEl.style.overflowX = "hidden";
        if (promptLike) {
          inputEl.classList.add("prompt-input-textarea");
          inputEl.style.fontFamily = `"Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif`;
          inputEl.style.minHeight = "120px";
          inputEl.style.maxHeight = "260px";
          inputEl.style.overflowY = "auto";
          promptLengthHintEl = document.createElement("div");
          promptLengthHintEl.className = "prompt-length-hint";
          updatePromptLengthHint = (nextValue) => {
            const length = getTextLength(nextValue);
            const tailPreview = getTailPreview(nextValue, 20);
            promptLengthHintEl.textContent = `长度 ${length} 字符 | 末尾预览 ${tailPreview}`;
            promptLengthHintEl.classList.toggle("is-warning", length >= LARGE_PROMPT_WARNING_CHARS);
          };
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
                notifyPromptValueChange(key, templateContent, updatePromptLengthHint);
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
        if (promptLike) {
          notifyPromptValueChange(key, inputEl.value, updatePromptLengthHint);
        }
      }
      inputEl.addEventListener("input", (event) => {
        const nextValue = event.target.value;
        const numeric = Number(nextValue);
        const storedValue = type === "number" && Number.isFinite(numeric) ? numeric : nextValue;
        setInputValueByKey(key, storedValue);
        if (promptLike) {
          notifyPromptValueChange(key, nextValue, updatePromptLengthHint);
        }
      });
      if (promptLike && typeof inputEl.addEventListener === "function") {
        inputEl.addEventListener("paste", (event) => {
          const clipboardText =
            event &&
            event.clipboardData &&
            typeof event.clipboardData.getData === "function"
              ? event.clipboardData.getData("text/plain")
              : "";
          if (!clipboardText) return;
          event.preventDefault();
          insertTextAtCursor(inputEl, clipboardText);
          const nextValue = String(inputEl.value || "");
          setInputValueByKey(key, nextValue);
          notifyPromptValueChange(key, nextValue, updatePromptLengthHint);
        });
      }
    }

    wrapper.appendChild(headerRow);
    wrapper.appendChild(inputEl);
    if (promptLengthHintEl) wrapper.appendChild(promptLengthHintEl);
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
    setInputValueByKey(key, inputEl.value);
    inputEl.addEventListener("input", (event) => {
      setInputValueByKey(key, event.target.value);
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
    setInputValueByKey(key, inputEl.value);
    inputEl.addEventListener("input", (event) => {
      setInputValueByKey(key, event.target.value);
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

  return {
    applyInputGridLayout,
    createInputField,
    createFallbackInputField,
    createMinimalFallbackField,
    renderFallbackInputs
  };
}

module.exports = {
  createInputRenderer
};
