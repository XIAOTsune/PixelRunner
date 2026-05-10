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

  function hexToRgb01(hex, fallback = "#ffd27a") {
    const value = /^#[0-9a-fA-F]{6}$/.test(String(hex || "")) ? String(hex) : fallback;
    return [
      parseInt(value.slice(1, 3), 16) / 255,
      parseInt(value.slice(3, 5), 16) / 255,
      parseInt(value.slice(5, 7), 16) / 255
    ];
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
      thresholdBias: 0.04,
      whiteProtect: 0.86,
      skinProtect: 0.78,
      darkProtect: 0.42,
      knee: 0.2,
      chromaBoost: 0.28,
      smallWeight: 0.44,
      mediumWeight: 0.86,
      largeWeight: 0.46,
      softAddMix: 0.36,
      warmth: 0.035,
      scatter: 0.9
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
      thresholdBias: -0.03,
      whiteProtect: 0.84,
      skinProtect: 0.74,
      darkProtect: 0.5,
      knee: 0.26,
      chromaBoost: 0.36,
      smallWeight: 0.36,
      mediumWeight: 0.9,
      largeWeight: 0.6,
      softAddMix: 0.5,
      warmth: 0.045,
      scatter: 1.04
    }
  };

  function normalizeGlowParams(config = {}) {
    const style = normalizeStyle(config.style);
    const preset = STYLE_PRESETS[style];
    const strength = style === "none" ? 0 : clamp(config.strength, 0, 100, 47);
    const radius = clamp(config.radius, 1, 500, 81);
    const threshold = clamp(config.threshold, 0, 100, 81);
    const saturation = clamp(config.saturation, -100, 100, 81);
    const brightnessBias = clamp(config.brightnessBias, -100, 100, 0);
    const colorShift = clamp(config.colorShift, -100, 100, 0);
    const colorEnabled = !!config.colorEnabled;
    const colorAmount = colorEnabled ? clamp(config.colorAmount, 0, 100, 0) : 0;
    const colorTint = hexToRgb01(config.colorHex);
    const chromatic = config.chromaticEnabled === false ? 0 : clamp(config.chromatic, 0, 100, 0);
    const radiusRatio = radius / 500;
    const legacyRadiusRatio = Math.min(1, radius / 250);
    const wideRadiusRatio = Math.max(0, (radius - 250) / 250);
    const thresholdRatio = 1 - threshold / 100;
    const brightnessLift = brightnessBias / 100;

    return {
      style,
      strength,
      radius,
      threshold,
      saturation,
      brightnessBias,
      colorShift,
      colorEnabled,
      colorAmount,
      colorTint,
      chromatic,
      source: {
        thresholdLow: clamp(0.36 + thresholdRatio * 0.32 + preset.thresholdBias - brightnessLift * 0.065, 0.2, 0.86, 0.62),
        thresholdHigh: clamp(0.55 + thresholdRatio * 0.29 + preset.thresholdBias - brightnessLift * 0.085, 0.32, 0.96, 0.78),
        thresholdKnee: clamp(preset.knee * (1.08 - thresholdRatio * 0.38) + legacyRadiusRatio * 0.04, 0.08, 0.34, 0.2),
        localRadius: Math.max(3, Math.round(4 + legacyRadiusRatio * 10)),
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
        mipCount: Math.max(2, Math.min(7, Math.round(2.9 + legacyRadiusRatio * 3.25 + wideRadiusRatio * 1.15))),
        mipWeights: [
          preset.smallWeight * 0.64,
          preset.mediumWeight * 0.98,
          preset.largeWeight * (0.84 + legacyRadiusRatio * preset.scatter * 0.46),
          preset.largeWeight * (0.6 + legacyRadiusRatio * preset.scatter * 0.4 + wideRadiusRatio * 0.28),
          preset.largeWeight * (0.42 + legacyRadiusRatio * preset.scatter * 0.3 + wideRadiusRatio * 0.38),
          preset.largeWeight * (0.28 + legacyRadiusRatio * preset.scatter * 0.22 + wideRadiusRatio * 0.46),
          preset.largeWeight * (0.17 + wideRadiusRatio * 0.42)
        ],
        pyramidWeight: clamp(0.78 + legacyRadiusRatio * 0.56 + wideRadiusRatio * 0.48 + preset.scatter * 0.12, 0.78, 2, 1),
        smallWeight: preset.smallWeight,
        mediumWeight: preset.mediumWeight,
        largeWeight: preset.largeWeight * (0.78 + legacyRadiusRatio * preset.scatter * 1.08 + wideRadiusRatio * 0.5),
        passes: 1
      },
      composite: {
        intensity: (strength / 100) * 2.05,
        softAddMix: preset.softAddMix,
        warmth: preset.warmth,
        saturation: clamp(1.16 + saturation / 100 * 0.46 + preset.chromaBoost * 0.22, 0.72, 1.62, 1),
        highlightProtect: clamp(0.66 + thresholdRatio * 0.22, 0.56, 0.92, 0.76),
        shadowProtect: preset.darkProtect,
        colorProtect: clamp(0.26 + strength / 100 * 0.1, 0.26, 0.42, 0.3),
        shoulder: clamp(0.72 - strength / 100 * 0.2, 0.5, 0.8, 0.64),
        colorShift: colorShift / 100,
        colorTint,
        colorAmount: colorAmount / 100,
        chromatic: chromatic / 100
      }
    };
  }

  modules.glowPresets = {
    clamp,
    normalizeGlowParams
  };
})(window);
