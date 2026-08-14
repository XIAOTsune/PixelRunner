(function initRatioOffsetCorrectionModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  function getInputMarker(input) {
    return String(`${input && input.key || ""} ${input && input.label || ""} ${input && input.name || ""} ${input && input.fieldName || ""}`)
      .trim()
      .toLowerCase();
  }

  function isImageInput(input) {
    const type = String(input && (input.type || input.fieldType) || "").trim().toLowerCase();
    return type === "image" || type === "file";
  }

  function isMaskInput(input) {
    return /(mask|蒙版|遮罩|填充区域|inpaint)/i.test(getInputMarker(input));
  }

  function isCoordinateInput(input) {
    return /(mask|蒙版|遮罩|填充区域|inpaint|control|控制图|姿态|深度|法线|线稿|边缘|pose|depth|normal|canny|edge|lineart|scribble|sketch|segmentation|openpose)/i.test(getInputMarker(input));
  }

  function isPrimaryInput(input) {
    const role = String(input && input.role || "").trim().toLowerCase();
    return role === "primary" || /(主图|主输入|原图|底图|主体图|main|primary|source|base)/i.test(getInputMarker(input));
  }

  function hasImageValue(value) {
    if (typeof value === "string") return Boolean(value.trim());
    if (!value || typeof value !== "object") return false;
    return Boolean(String(value.dataUrl || value.uploadDataUrl || value.base64 || value.uploadBase64 || value.url || "").trim());
  }

  function inferImageInputs(payload) {
    const inputs = payload && payload.inputs && typeof payload.inputs === "object" ? payload.inputs : {};
    return Object.keys(inputs)
      .filter((key) => hasImageValue(inputs[key]))
      .map((key) => ({ key, label: key, name: key, type: "image" }));
  }

  function getImageInputs(payload) {
    const schemaInputs = Array.isArray(payload && payload.app && payload.app.inputs) ? payload.app.inputs.filter(isImageInput) : [];
    const byKey = new Map();
    [...schemaInputs, ...inferImageInputs(payload)].forEach((input) => {
      const key = String(input && input.key || "").trim();
      if (key && !byKey.has(key)) byKey.set(key, input);
    });
    return Array.from(byKey.values());
  }

  function resolvePrimaryImageInput(payload) {
    const values = payload && payload.inputs && typeof payload.inputs === "object" ? payload.inputs : {};
    const available = getImageInputs(payload).filter((input) => hasImageValue(values[String(input.key || "")]));
    return available.find(isPrimaryInput) || available.find((input) => !isCoordinateInput(input)) || available[0] || null;
  }

  function computeSquareTransform(width, height) {
    const originalWidth = Math.max(1, Math.round(Number(width) || 0));
    const originalHeight = Math.max(1, Math.round(Number(height) || 0));
    const squareSize = Math.max(originalWidth, originalHeight);
    const offsetX = Math.floor((squareSize - originalWidth) / 2);
    const offsetY = Math.floor((squareSize - originalHeight) / 2);
    return {
      originalWidth,
      originalHeight,
      squareSize,
      offsetX,
      offsetY,
      retainedAreaRatio: (originalWidth * originalHeight) / (squareSize * squareSize)
    };
  }

  function parseDataUrl(dataUrl) {
    const match = String(dataUrl || "").trim().match(/^data:([^;,]+)?;base64,(.+)$/i);
    return match ? { mimeType: String(match[1] || "image/png"), base64: String(match[2] || "") } : null;
  }

  function getImageSource(value) {
    if (typeof value === "string") return { src: value.trim(), mimeType: parseDataUrl(value)?.mimeType || "image/png" };
    const source = value && typeof value === "object" ? value : {};
    const dataUrl = String(source.dataUrl || source.uploadDataUrl || "").trim();
    if (dataUrl) return { src: dataUrl, mimeType: parseDataUrl(dataUrl)?.mimeType || String(source.mimeType || source.uploadMimeType || "image/png") };
    const base64 = String(source.base64 || source.uploadBase64 || "").trim();
    const mimeType = String(source.mimeType || source.uploadMimeType || "image/png").trim() || "image/png";
    if (base64) return { src: `data:${mimeType};base64,${base64}`, mimeType };
    const url = String(source.url || "").trim();
    return { src: url, mimeType };
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("比例偏移修正无法读取主图，请重新从 Photoshop 捕获后再运行"));
      image.src = source;
    });
  }

  function estimateBase64Bytes(base64) {
    const text = String(base64 || "").replace(/\s+/g, "");
    if (!text) return null;
    const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor(text.length * 0.75) - padding);
  }

  function drawEdgeExtendedSquare(context, image, plan) {
    const sourceWidth = Math.max(1, Number(image.naturalWidth || image.width) || plan.originalWidth);
    const sourceHeight = Math.max(1, Number(image.naturalHeight || image.height) || plan.originalHeight);
    const rightPadding = plan.squareSize - plan.offsetX - plan.originalWidth;
    const bottomPadding = plan.squareSize - plan.offsetY - plan.originalHeight;

    if (plan.offsetY > 0) {
      context.drawImage(image, 0, 0, sourceWidth, 1, plan.offsetX, 0, plan.originalWidth, plan.offsetY);
    }
    if (bottomPadding > 0) {
      context.drawImage(image, 0, sourceHeight - 1, sourceWidth, 1, plan.offsetX, plan.offsetY + plan.originalHeight, plan.originalWidth, bottomPadding);
    }
    if (plan.offsetX > 0) {
      context.drawImage(image, 0, 0, 1, sourceHeight, 0, plan.offsetY, plan.offsetX, plan.originalHeight);
    }
    if (rightPadding > 0) {
      context.drawImage(image, sourceWidth - 1, 0, 1, sourceHeight, plan.offsetX + plan.originalWidth, plan.offsetY, rightPadding, plan.originalHeight);
    }
    context.drawImage(image, 0, 0, sourceWidth, sourceHeight, plan.offsetX, plan.offsetY, plan.originalWidth, plan.originalHeight);
  }

  async function padImageToSquare(value, options = {}) {
    const source = getImageSource(value);
    if (!source.src) throw new Error("比例偏移修正没有找到可处理的主图数据");
    const image = await loadImage(source.src);
    const naturalWidth = Math.max(1, Math.round(Number(image.naturalWidth || image.width) || 0));
    const naturalHeight = Math.max(1, Math.round(Number(image.naturalHeight || image.height) || 0));
    const suppliedPlan = options.plan && typeof options.plan === "object" ? options.plan : null;
    const plan = suppliedPlan
      ? computeSquareTransform(suppliedPlan.originalWidth, suppliedPlan.originalHeight)
      : computeSquareTransform(naturalWidth, naturalHeight);
    const sameGeometry = naturalWidth === plan.squareSize && naturalHeight === plan.squareSize && plan.offsetX === 0 && plan.offsetY === 0;
    if (sameGeometry) return { value, transform: plan };

    const canvas = document.createElement("canvas");
    canvas.width = plan.squareSize;
    canvas.height = plan.squareSize;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("比例偏移修正无法创建图像画布");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (options.mode === "mask") {
      context.fillStyle = "#000000";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, naturalWidth, naturalHeight, plan.offsetX, plan.offsetY, plan.originalWidth, plan.originalHeight);
    } else {
      drawEdgeExtendedSquare(context, image, plan);
    }

    const sourceMimeType = String(source.mimeType || "image/png").toLowerCase();
    const mimeType = options.mode === "mask" || !sourceMimeType.includes("jpeg") && !sourceMimeType.includes("jpg")
      ? "image/png"
      : "image/jpeg";
    let dataUrl = "";
    try {
      dataUrl = canvas.toDataURL(mimeType, 0.92);
    } catch (_) {
      throw new Error("比例偏移修正无法导出补边图像；请重新从 Photoshop 捕获主图后再运行");
    }
    const parsed = parseDataUrl(dataUrl);
    if (!parsed || !parsed.base64) throw new Error("比例偏移修正生成方形图像失败");
    const nextValue = typeof value === "object" && value ? { ...value } : {};
    return {
      value: {
        ...nextValue,
        dataUrl,
        base64: parsed.base64,
        mimeType: parsed.mimeType,
        url: "",
        width: plan.squareSize,
        height: plan.squareSize,
        bytes: estimateBase64Bytes(parsed.base64)
      },
      transform: plan
    };
  }

  function isAspectRatioInput(input) {
    const marker = getInputMarker(input);
    if (/(resolution|分辨率|清晰度)/i.test(marker)) return false;
    return /(aspect\s*ratio|aspectratio|ratio|比例|画幅|宽高比)/i.test(marker);
  }

  function isSquareMarker(value) {
    const marker = String(value == null ? "" : value).trim().toLowerCase().replace(/\s+/g, "");
    if (!marker) return false;
    if (/^(1[:/x×]1|square|正方形)$/.test(marker)) return true;
    const dimensions = marker.match(/^(\d+)[x×](\d+)$/);
    return Boolean(dimensions && Number(dimensions[1]) === Number(dimensions[2]));
  }

  function getSquareOptionValue(option) {
    if (option == null) return "";
    if (typeof option === "string" || typeof option === "number") return isSquareMarker(option) ? String(option) : "";
    if (typeof option !== "object") return "";
    const value = option.value ?? option.id ?? option.key ?? option.name ?? option.label;
    return [option.value, option.id, option.key, option.name, option.label].some(isSquareMarker) ? String(value == null ? "" : value) : "";
  }

  function resolveSquareRatioUpdate(payload) {
    const inputs = payload && payload.inputs && typeof payload.inputs === "object" ? payload.inputs : {};
    const provider = String(payload && payload.provider || "").trim().toLowerCase();
    if (provider === "grs" || provider === "gemini") {
      const model = String(inputs.model || payload && payload.config && payload.config.selectedModel || "").trim();
      const capabilities = modules.state && typeof modules.state.getThirdPartyModelCapabilities === "function"
        ? modules.state.getThirdPartyModelCapabilities(model, provider)
        : null;
      const squareValue = Array.isArray(capabilities && capabilities.aspectRatios)
        ? capabilities.aspectRatios.map(getSquareOptionValue).find(Boolean) || ""
        : "";
      return squareValue ? { key: "aspectRatio", value: squareValue, detected: true } : null;
    }

    const schemaInputs = Array.isArray(payload && payload.app && payload.app.inputs) ? payload.app.inputs : [];
    const ratioInput = schemaInputs.find(isAspectRatioInput);
    if (!ratioInput) return null;
    const options = Array.isArray(ratioInput.options) ? ratioInput.options : [];
    const squareValue = options.map(getSquareOptionValue).find(Boolean) || (options.length === 0 ? "1:1" : "");
    return squareValue ? { key: String(ratioInput.key || ""), value: squareValue, detected: true } : { key: String(ratioInput.key || ""), value: "", detected: true };
  }

  async function prepareRunPayload(payload, sourceDocument, options = {}) {
    const enabled = options.enabled === true || payload && payload.settings && payload.settings.ratioOffsetCorrectionEnabled === true;
    if (!enabled) return { payload, sourceDocument, applied: false, reason: "disabled" };
    const primaryInput = resolvePrimaryImageInput(payload);
    if (!primaryInput) return { payload, sourceDocument, applied: false, reason: "missing-primary-image" };

    const transformImage = typeof options.transformImage === "function" ? options.transformImage : padImageToSquare;
    const primaryKey = String(primaryInput.key || "");
    const nextInputs = { ...(payload.inputs || {}) };
    const primaryResult = await transformImage(nextInputs[primaryKey], { mode: "edge", input: primaryInput });
    if (!primaryResult || !primaryResult.value || !primaryResult.transform) {
      throw new Error("比例偏移修正没有生成有效的方形主图");
    }
    nextInputs[primaryKey] = primaryResult.value;

    const imageInputs = getImageInputs(payload);
    const transformedInputKeys = [primaryKey];
    for (const input of imageInputs) {
      const key = String(input && input.key || "");
      if (!key || key === primaryKey || !hasImageValue(nextInputs[key])) continue;
      const isGenerativeFillMask = Boolean(payload.generativeFill) && key === "referenceImage";
      if (!isGenerativeFillMask && !isCoordinateInput(input)) continue;
      const linkedResult = await transformImage(nextInputs[key], {
        mode: isGenerativeFillMask || isMaskInput(input) ? "mask" : "edge",
        input,
        plan: primaryResult.transform
      });
      if (!linkedResult || !linkedResult.value) throw new Error(`比例偏移修正无法处理坐标关联图像：${input.label || input.name || key}`);
      nextInputs[key] = linkedResult.value;
      transformedInputKeys.push(key);
    }

    const ratioUpdate = resolveSquareRatioUpdate({ ...payload, inputs: nextInputs });
    if (ratioUpdate && ratioUpdate.key && ratioUpdate.value) nextInputs[ratioUpdate.key] = ratioUpdate.value;
    const transform = primaryResult.transform;
    const metadata = {
      enabled: true,
      mode: "forced-square",
      primaryInputKey: primaryKey,
      transformedInputKeys,
      originalWidth: transform.originalWidth,
      originalHeight: transform.originalHeight,
      squareSize: transform.squareSize,
      offsetX: transform.offsetX,
      offsetY: transform.offsetY,
      retainedAreaRatio: transform.retainedAreaRatio,
      forcedAspectRatioKey: ratioUpdate && ratioUpdate.key || "",
      forcedAspectRatioValue: ratioUpdate && ratioUpdate.value || "",
      ratioFieldDetected: Boolean(ratioUpdate && ratioUpdate.detected)
    };
    const nextPayload = { ...payload, inputs: nextInputs, ratioOffsetCorrection: metadata };
    const nextSourceDocument = sourceDocument && typeof sourceDocument === "object"
      ? { ...sourceDocument, ratioOffsetCorrection: metadata }
      : sourceDocument;
    return { payload: nextPayload, sourceDocument: nextSourceDocument, metadata, applied: true, reason: "applied" };
  }

  modules.ratioOffsetCorrection = {
    computeSquareTransform,
    isSquareMarker,
    resolveSquareRatioUpdate,
    resolvePrimaryImageInput,
    padImageToSquare,
    prepareRunPayload
  };
})(window);
