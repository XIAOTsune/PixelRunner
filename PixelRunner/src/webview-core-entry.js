// This entry is loaded before app.bundle.js. It contains product-specific
// implementations that can be release-hardened without transforming UXP glue.
import "./webview/glow/presets.js";
import "./webview/glow/source-mask.js";
import "./webview/glow/pyramid-blur.js";
import "./webview/glow/gpu/capabilities.js";
import "./webview/glow/gpu/webgl-source-mask.js";
import "./webview/glow/gpu/webgl-pyramid-blur.js";
import "./webview/glow/gpu/webgl-compositor.js";
import "./webview/glow/compositor.js";
import "./webview/glow/preview-engine.js";
import "./webview/glow-cpu.js";
import "./webview/blend-match/gpu/webgl-blend-preview.js";
import "./webview/blend-match/gpu/webgl-alignment.js";
import "./webview/space-fx.js";
import "./webview/blend-match.js";
import "./webview/local-upscale.js";
import "./webview/workspace.js";
import "./webview/generative-fill.js";
import "./webview/ai-optimize.js";
