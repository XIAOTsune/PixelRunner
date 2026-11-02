import {
  buildTileBounds,
  buildTileFilenames,
  normalizeTileLayout,
  sanitizeImageBaseName
} from "./image-splitter-core.js";

(function initImageSplitterModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  function bindActions() {
    const runtime = modules.runtime;
    const modal = runtime.getById("imageSplitModal");
    const previewCanvas = runtime.getById("imageSplitPreviewCanvas");
    const previewEmpty = runtime.getById("imageSplitPreviewEmpty");
    const sourceButtons = Array.from(document.querySelectorAll("[data-image-split-source]"));
    const loadSourceButton = runtime.getById("btnImageSplitLoadSource");
    const localFileInput = runtime.getById("imageSplitFileInput");
    const sourceStatus = runtime.getById("imageSplitSourceStatus");
    const presetInput = runtime.getById("imageSplitPresetInput");
    const columnsInput = runtime.getById("imageSplitColumnsInput");
    const rowsInput = runtime.getById("imageSplitRowsInput");
    const columnsField = runtime.getById("imageSplitColumnsField");
    const rowsField = runtime.getById("imageSplitRowsField");
    const baseNameInput = runtime.getById("imageSplitBaseNameInput");
    const formatInput = runtime.getById("imageSplitFormatInput");
    const folderButton = runtime.getById("btnImageSplitChooseFolder");
    const folderStatus = runtime.getById("imageSplitFolderStatus");
    const exportButton = runtime.getById("btnImageSplitExport");
    const exportStatus = runtime.getById("imageSplitExportStatus");
    const layoutMeta = runtime.getById("imageSplitLayoutMeta");
    const closeButtons = [runtime.getById("imageSplitModalClose")].filter(Boolean);
    const openButton = runtime.getById("btnOpenImageSplitter");

    if (!modal || !previewCanvas) return;

    let imageSource = null;
    let imageName = "";
    let imageWidth = 0;
    let imageHeight = 0;
    let selectedSource = "local";
    let folderToken = "";
    let selectedFilenames = [];
    let exportBusy = false;

    const setModalOpen = (open) => {
      if (!open && exportBusy) return;
      if (open) {
        modal.classList.remove("is-closing");
        modal.classList.add("is-open");
        document.body.classList.add("modal-open");
      } else {
        modal.classList.remove("is-open");
        modal.classList.add("is-closing");
        window.setTimeout(() => {
          modal.classList.remove("is-closing");
          document.body.classList.toggle("modal-open", Boolean(document.querySelector(".overlay-modal.is-open")));
        }, 180);
        void resetFolder();
      }
    };

    const setStatus = (message, type = "info") => {
      if (!exportStatus) return;
      exportStatus.textContent = String(message || "");
      exportStatus.dataset.status = type;
    };

    const getLayout = () => {
      const raw = String(presetInput && presetInput.value || "2x2");
      if (raw !== "custom") {
        const [columns, rows] = raw.split("x").map(Number);
        return normalizeTileLayout(columns, rows);
      }
      return normalizeTileLayout(columnsInput && columnsInput.value, rowsInput && rowsInput.value);
    };

    const getTilePlan = () => {
      if (!imageSource) throw new Error("请先载入图片");
      const layout = getLayout();
      const bounds = buildTileBounds(imageWidth, imageHeight, layout.columns, layout.rows);
      const extension = String(formatInput && formatInput.value || "jpg") === "png" ? "png" : "jpg";
      const filenames = buildTileFilenames(baseNameInput && baseNameInput.value || imageName, bounds.length, extension);
      return { layout, bounds, filenames, extension };
    };

    const updateLayoutMeta = () => {
      if (!layoutMeta) return;
      let validLayout = false;
      try {
        const { layout, bounds } = getTilePlan();
        layoutMeta.textContent = `${imageWidth} × ${imageHeight} px · ${layout.columns} 列 × ${layout.rows} 行 · ${bounds.length} 张`;
        validLayout = true;
      } catch (error) {
        layoutMeta.textContent = imageSource ? error.message : "等待载入图片";
      }
      if (exportButton) exportButton.disabled = exportBusy || !imageSource || !folderToken || !validLayout;
    };

    const drawPreview = () => {
      const canvas = previewCanvas;
      const context = canvas.getContext("2d");
      if (!context) return;
      if (!imageSource) {
        canvas.width = 1;
        canvas.height = 1;
        canvas.classList.add("is-hidden");
        if (previewEmpty) previewEmpty.classList.remove("is-hidden");
        updateLayoutMeta();
        return;
      }
      const scale = Math.min(1, 1200 / Math.max(imageWidth, imageHeight));
      canvas.width = Math.max(1, Math.round(imageWidth * scale));
      canvas.height = Math.max(1, Math.round(imageHeight * scale));
      canvas.classList.remove("is-hidden");
      if (previewEmpty) previewEmpty.classList.add("is-hidden");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(imageSource, 0, 0, canvas.width, canvas.height);
      try {
        const { layout } = getLayout();
        context.save();
        context.strokeStyle = "rgba(255, 255, 255, 0.92)";
        context.lineWidth = Math.max(1, canvas.width / imageWidth);
        context.shadowColor = "rgba(0, 0, 0, 0.7)";
        context.shadowBlur = 2;
        for (let column = 1; column < layout.columns; column += 1) {
          const x = Math.floor(column * imageWidth / layout.columns) * scale;
          context.beginPath();
          context.moveTo(x, 0);
          context.lineTo(x, canvas.height);
          context.stroke();
        }
        for (let row = 1; row < layout.rows; row += 1) {
          const y = Math.floor(row * imageHeight / layout.rows) * scale;
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(canvas.width, y);
          context.stroke();
        }
        context.restore();
      } catch (_) {}
      updateLayoutMeta();
    };

    const resetFolder = async (message = "尚未选择导出文件夹") => {
      const token = folderToken;
      folderToken = "";
      selectedFilenames = [];
      if (folderStatus) folderStatus.textContent = message;
      if (folderButton) folderButton.textContent = "选择导出文件夹";
      updateLayoutMeta();
      if (token) await runtime.releaseImageTileExportFolder(token);
    };

    const releaseFolder = async () => {
      if (!folderToken) return;
      const token = folderToken;
      folderToken = "";
      selectedFilenames = [];
      await runtime.releaseImageTileExportFolder(token);
      updateLayoutMeta();
    };

    const assignImage = (source, name) => {
      if (imageSource && typeof imageSource.close === "function") imageSource.close();
      imageSource = source;
      imageName = String(name || "image").replace(/\.[^.]+$/, "") || "image";
      imageWidth = Math.floor(Number(source && (source.width || source.naturalWidth)) || 0);
      imageHeight = Math.floor(Number(source && (source.height || source.naturalHeight)) || 0);
      if (baseNameInput) baseNameInput.value = sanitizeImageBaseName(imageName);
      if (sourceStatus) sourceStatus.textContent = `${name || "图片"} · ${imageWidth} × ${imageHeight} px`;
      void resetFolder();
      drawPreview();
      setStatus("图片已载入", "success");
    };

    const decodeImage = async (blob) => {
      if (typeof global.createImageBitmap === "function") return global.createImageBitmap(blob);
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("无法读取所选图片"));
        reader.readAsDataURL(blob);
      });
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("无法解析所选图片，请选择 JPG、PNG 或 WebP 文件"));
        image.src = dataUrl;
      });
    };

    const decodeDataUrl = (dataUrl) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Photoshop 返回的图片无法解码"));
      image.src = String(dataUrl || "");
    });

    const loadLocalFile = async (file) => {
      if (!file) return;
      try {
        const bitmap = await decodeImage(file);
        assignImage(bitmap, file.name || "本地图片");
      } catch (error) {
        setStatus(`载入失败：${error.message}`, "error");
      }
    };

    const loadLocalSource = async () => {
      if (!runtime.isPluginRuntime()) {
        if (localFileInput) localFileInput.click();
        return;
      }
      loadSourceButton.disabled = true;
      setStatus("正在读取本地图片…", "info");
      try {
        const result = await runtime.openImageFile();
        if (!result || result.outcome === "cancelled") return;
        const dataUrl = String(result.dataUrl || "");
        if (!dataUrl) throw new Error("宿主未返回图片内容");
        assignImage(await decodeDataUrl(dataUrl), result.name || "本地图片");
      } catch (error) {
        if (error && error.name !== "AbortError") setStatus(`载入失败：${error.message}`, "error");
      } finally {
        loadSourceButton.disabled = false;
      }
    };

    const loadCurrentDocument = async () => {
      if (!runtime.isPluginRuntime()) {
        setStatus("当前文档来源需要在 Photoshop 插件中使用", "error");
        return;
      }
      loadSourceButton.disabled = true;
      setStatus("正在读取 Photoshop 文档…", "info");
      try {
        const info = await runtime.callHost("photoshop.getActiveDocumentInfo", [], { timeoutMs: 30000 });
        if (!info || !info.hasActiveDocument || !(Number(info.documentId) > 0)) throw new Error("没有打开的 Photoshop 文档");
        const capture = await runtime.callHost("photoshop.captureImageSplitSource", [{ expectedDocumentId: Number(info.documentId) }], { timeoutMs: 600000 });
        const dataUrl = String(capture && capture.dataUrl || "");
        if (!dataUrl) throw new Error("Photoshop 未返回完整尺寸图像");
        const image = await decodeDataUrl(dataUrl);
        assignImage(image, `${info.title || "Photoshop 文档"}.png`);
        setStatus("已读取当前文档；原文档保持不变", "success");
      } catch (error) {
        setStatus(`读取失败：${error.message}`, "error");
      } finally {
        loadSourceButton.disabled = false;
      }
    };

    const chooseExportFolder = async () => {
      let plan;
      let pickerPromise;
      try {
        plan = getTilePlan();
        pickerPromise = runtime.chooseImageTileExportFolder(plan.filenames);
        if (folderButton) folderButton.disabled = true;
        const result = await pickerPromise;
        if (!result || result.outcome === "cancelled") return;
        const nextFolderToken = String(result.folderToken || "");
        const nextFilenames = Array.isArray(result.filenames) ? result.filenames : plan.filenames;
        if (!nextFolderToken || nextFilenames.length !== plan.filenames.length) throw new Error("未能建立导出文件夹会话");
        if (!modal.classList.contains("is-open")) {
          await runtime.releaseImageTileExportFolder(nextFolderToken);
          return;
        }
        const currentPlan = getTilePlan();
        if (currentPlan.filenames.join("\n") !== plan.filenames.join("\n")) {
          await runtime.releaseImageTileExportFolder(nextFolderToken);
          setStatus("切分设置已变化，请重新选择导出文件夹", "warn");
          return;
        }
        const previousFolderToken = folderToken;
        folderToken = nextFolderToken;
        selectedFilenames = nextFilenames;
        if (previousFolderToken) await runtime.releaseImageTileExportFolder(previousFolderToken);
        if (folderStatus) folderStatus.textContent = String(result.folderName || "导出文件夹已选择");
        if (folderButton) folderButton.textContent = "更换文件夹";
        setStatus("导出文件夹已就绪", "success");
        updateLayoutMeta();
      } catch (error) {
        setStatus(error && error.name === "AbortError" ? "已取消选择文件夹" : `选择文件夹失败：${error.message}`, "error");
      } finally {
        if (folderButton) folderButton.disabled = false;
      }
    };

    const exportTiles = async () => {
      let plan;
      try {
        plan = getTilePlan();
        if (!folderToken || selectedFilenames.length !== plan.filenames.length) throw new Error("请先选择导出文件夹");
      } catch (error) {
        setStatus(error.message, "error");
        return;
      }
      exportBusy = true;
      updateLayoutMeta();
      [
        ...sourceButtons,
        loadSourceButton,
        localFileInput,
        presetInput,
        columnsInput,
        rowsInput,
        baseNameInput,
        formatInput,
        folderButton,
        ...closeButtons
      ].filter(Boolean).forEach((control) => { control.disabled = true; });
      setStatus(`正在导出 0/${plan.bounds.length}`, "info");
      const canvas = document.createElement("canvas");
      const mimeType = plan.extension === "png" ? "image/png" : "image/jpeg";
      let written = 0;
      try {
        for (let index = 0; index < plan.bounds.length; index += 1) {
          const tile = plan.bounds[index];
          canvas.width = tile.width;
          canvas.height = tile.height;
          let context = null;
          try { context = canvas.getContext("2d", { colorSpace: "srgb" }); } catch (_) {}
          if (!context) context = canvas.getContext("2d");
          if (!context) throw new Error("无法创建切片画布");
          if (plan.extension === "jpg") {
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, tile.width, tile.height);
          }
          context.drawImage(imageSource, tile.left, tile.top, tile.width, tile.height, 0, 0, tile.width, tile.height);
          const encoded = canvas.toDataURL(mimeType, plan.extension === "jpg" ? 0.94 : undefined);
          const base64 = encoded.slice(encoded.indexOf(",") + 1);
          if (!base64) throw new Error(`第 ${index + 1} 张切片编码失败`);
          await runtime.writeImageTile(folderToken, selectedFilenames[index], base64);
          written += 1;
          setStatus(`正在导出 ${written}/${plan.bounds.length}`, "info");
          canvas.width = 1;
          canvas.height = 1;
        }
        await releaseFolder();
        if (folderStatus) folderStatus.textContent = `${folderStatus.textContent} · 已写入 ${written} 个文件`;
        setStatus(`已导出 ${written} 个切片，顺序为从左到右、从上到下`, "success");
      } catch (error) {
        await resetFolder("导出中断，请重新选择文件夹");
        setStatus(`导出失败（已完成 ${written}/${plan.bounds.length}）：${error.message}`, "error");
      } finally {
        canvas.width = 1;
        canvas.height = 1;
        exportBusy = false;
        [
          ...sourceButtons,
          loadSourceButton,
          localFileInput,
          presetInput,
          columnsInput,
          rowsInput,
          baseNameInput,
          formatInput,
          folderButton,
          ...closeButtons
        ].filter(Boolean).forEach((control) => { control.disabled = false; });
        if (selectedSource === "document" && !runtime.isPluginRuntime()) {
          const documentSourceButton = sourceButtons.find((button) => button.getAttribute("data-image-split-source") === "document");
          if (documentSourceButton) documentSourceButton.disabled = true;
          if (loadSourceButton) loadSourceButton.disabled = true;
        }
        updateLayoutMeta();
      }
    };

    const invalidateExportFolder = () => {
      if (folderToken) void resetFolder("设置已变化，请重新选择导出文件夹");
      drawPreview();
    };

    if (openButton) openButton.addEventListener("click", () => {
      setModalOpen(true);
      drawPreview();
    });
    closeButtons.forEach((button) => button.addEventListener("click", () => setModalOpen(false)));
    document.addEventListener("click", (event) => {
      if (event.target && event.target.closest("#imageSplitBackdrop")) setModalOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal.classList.contains("is-open") && !exportBusy) setModalOpen(false);
    });

    sourceButtons.forEach((button) => button.addEventListener("click", () => {
      selectedSource = String(button.getAttribute("data-image-split-source") || "local");
      sourceButtons.forEach((item) => item.classList.toggle("active", item === button));
      if (loadSourceButton) {
        loadSourceButton.textContent = selectedSource === "document" ? "读取当前文档" : "选择本地图片";
        loadSourceButton.disabled = selectedSource === "document" && !runtime.isPluginRuntime();
      }
      setStatus(selectedSource === "document" && !runtime.isPluginRuntime() ? "当前文档来源需要在 Photoshop 插件中使用" : "", "info");
    }));
    if (loadSourceButton) loadSourceButton.addEventListener("click", () => {
      if (selectedSource === "document") void loadCurrentDocument();
      else void loadLocalSource();
    });
    if (localFileInput) localFileInput.addEventListener("change", () => {
      void loadLocalFile(localFileInput.files && localFileInput.files[0]);
      localFileInput.value = "";
    });

    if (presetInput) presetInput.addEventListener("change", () => {
      const custom = presetInput.value === "custom";
      if (columnsField) columnsField.classList.toggle("is-hidden", !custom);
      if (rowsField) rowsField.classList.toggle("is-hidden", !custom);
      if (!custom) {
        const [columns, rows] = presetInput.value.split("x");
        if (columnsInput) columnsInput.value = columns;
        if (rowsInput) rowsInput.value = rows;
      }
      invalidateExportFolder();
    });
    [columnsInput, rowsInput, baseNameInput, formatInput].filter(Boolean).forEach((input) => {
      input.addEventListener("input", invalidateExportFolder);
      input.addEventListener("change", invalidateExportFolder);
    });
    if (folderButton) folderButton.addEventListener("click", () => void chooseExportFolder());
    if (exportButton) exportButton.addEventListener("click", () => void exportTiles());

    sourceButtons.forEach((button) => {
      if (button.getAttribute("data-image-split-source") === "document" && !runtime.isPluginRuntime()) button.disabled = true;
    });
    drawPreview();
  }

  modules.imageSplitter = { bindActions };
})(window);
