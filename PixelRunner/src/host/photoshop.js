import {
  captureDocumentForLocalUpscale,
  captureDocumentPreview,
  deleteSelectionSnapshot,
  getActiveDocumentInfo,
  openImageFromUrl,
  placeImageFromUrl,
  runToolAction
} from "./photoshop/service.js";

(function initPixelRunnerHostPhotoshop(global) {
  global.PixelRunnerHost = global.PixelRunnerHost || {};
  global.PixelRunnerHost.photoshop = {
    getActiveDocumentInfo,
    captureDocumentForLocalUpscale,
    captureDocumentPreview,
    deleteSelectionSnapshot,
    runToolAction,
    placeImageFromUrl,
    openImageFromUrl
  };
})(window);
