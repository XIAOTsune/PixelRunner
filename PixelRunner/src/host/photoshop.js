import {
  captureDocumentPreview,
  getActiveDocumentInfo,
  placeImageFromUrl,
  runToolAction
} from "./photoshop/service.js";

(function initPixelRunnerHostPhotoshop(global) {
  global.PixelRunnerHost = global.PixelRunnerHost || {};
  global.PixelRunnerHost.photoshop = {
    getActiveDocumentInfo,
    captureDocumentPreview,
    runToolAction,
    placeImageFromUrl
  };
})(window);
