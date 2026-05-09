(function initGlowPresetsModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  function clamp(value, min, max, fallback = min) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function normalizeStyle(style) {
    const key = String(style || "").trim().toLowerCase();
    if (key === "none") return "none";
    if (key === "whitesoft" || key === "soft") return "whiteSoft";
    if (key === "shine" || key === "dreamy") return "shine";
    return "darkSoft";
  }

  const STYLE_PRESETS = {
    none: {
      thresholdBias: 0,
      whiteProtect: 1,
      skinProtect: 1,
      darkProtect: 1,
      knee: 0.18,
      chromaBoost: 0,
      smallWeight: 0,
      mediumWeight: 0,
      largeWeight: 0,
      softAddMix: 0,
      warmth: 0,
      scatter: 0
    },
    darkSoft: {
      thresholdBias: 0.02,
      whiteProtect: 0.86,
      skinProtect: 0.78,
      darkProtect: 0.42,
      knee: 0.24,
      chromaBoost: 0.28,
      smallWeight: 0.42,
      mediumWeight: 0.88,
      largeWeight: 0.48,
      softAddMix: 0.42,
      warmth: 0.035,
      scatter: 0.88
    },
    whiteSoft: {
      thresholdBias: -0.02,
      whiteProtect: 0.92,
      skinProtect: 0.86,
      darkProtect: 0.46,
      knee: 0.28,
      chromaBoost: 0.2,
      smallWeight: 0.32,
      mediumWeight: 0.94,
      largeWeight: 0.56,
      softAddMix: 0.52,
      warmth: 0.025,
      scatter: 1
    },
    shine: {
      thresholdBias: -0.06,
      whiteProtect: 0.78,
      skinProtect: 0.74,
      darkProtect: 0.5,
      knee: 0.32,
      chromaBoost: 0.36,
      smallWeight: 0.3,
      mediumWeight: 0.9,
      largeWeight: 0.72,
      softAddMix: 0.64,
      warmth: 0.06,
      scatter: 1.18
    }
  };

  function normalizeGlowParams(config = {}) {
    const style = normalizeStyle(config.style);
    const preset = STYLE_PRESETS[style];
    const strength = style === "none" ? 0 : clamp(config.strength, 0, 100, 47);
    const radius = clamp(config.radius, 1, 120, 81);
    const threshold = clamp(config.threshold, 0, 100, 81);
    const saturation = clamp(config.saturation, -100, 100, 81);
    const brightnessBias = clamp(config.brightnessBias, -50, 50, 0);
    const radiusRatio = radius / 120;
    const thresholdRatio = threshold / 100;
    const brightnessLift = brightnessBias / 50;

    return {
      style,
      strength,
      radius,
      threshold,
      saturation,
      brightnessBias,
      source: {
        thresholdLow: clamp(0.36 + thresholdRatio * 0.32 + preset.thresholdBias - brightnessLift * 0.065, 0.2, 0.86, 0.62),
        thresholdHigh: clamp(0.55 + thresholdRatio * 0.29 + preset.thresholdBias - brightnessLift * 0.085, 0.32, 0.96, 0.78),
        thresholdKnee: clamp(preset.knee * (1.08 - thresholdRatio * 0.38) + radiusRatio * 0.04, 0.08, 0.34, 0.2),
        localRadius: Math.max(3, Math.round(4 + radiusRatio * 10)),
        contrastLow: 0.025,
        contrastHigh: clamp(0.095 - thresholdRatio * 0.035, 0.038, 0.11, 0.07),
        specularLow: 0.06,
        specularHigh: 0.28,
        chromaBoost: clamp(preset.chromaBoost + saturation / 100 * 0.22, 0, 0.62, preset.chromaBoost),
        whiteProtect: preset.whiteProtect,
        skinProtect: preset.skinProtect,
        darkProtect: preset.darkProtect
      },
      blur: {
        smallRadius: Math.max(1, Math.round(1.5 + radiusRatio * 4)),
        mediumRadius: Math.max(2, Math.round(5 + radiusRatio * 14)),
        largeRadius: Math.max(3, Math.round(7 + radiusRatio * 24)),
        smallWeight: preset.smallWeight,
        mediumWeight: preset.mediumWeight,
        largeWeight: preset.largeWeight * (0.7 + radiusRatio * preset.scatter),
        passes: radius > 72 ? 2 : 1
      },
      composite: {
        intensity: (strength / 100) * 2.35,
        softAddMix: preset.softAddMix,
        warmth: preset.warmth,
        saturation: clamp(1.16 + saturation / 100 * 0.46 + preset.chromaBoost * 0.22, 0.72, 1.62, 1),
        highlightProtect: clamp(0.58 + thresholdRatio * 0.22, 0.48, 0.86, 0.68),
        shadowProtect: preset.darkProtect,
        colorProtect: 0.18,
        shoulder: clamp(0.64 - strength / 100 * 0.18, 0.42, 0.72, 0.58)
      }
    };
  }

  modules.glowPresets = {
    clamp,
    normalizeGlowParams
  };
})(window);
