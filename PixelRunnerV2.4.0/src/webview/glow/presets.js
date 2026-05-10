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
      whiteProtect: 0.94,
      skinProtect: 0.88,
      darkProtect: 0.62,
      knee: 0.17,
      chromaBoost: 0.14,
      smallWeight: 0.52,
      mediumWeight: 0.84,
      largeWeight: 0.34,
      softAddMix: 0.32,
      warmth: 0.008,
      scatter: 0.72
    },
    whiteSoft: {
      thresholdBias: -0.02,
      whiteProtect: 0.9,
      skinProtect: 0.84,
      darkProtect: 0.5,
      knee: 0.26,
      chromaBoost: 0.2,
      smallWeight: 0.3,
      mediumWeight: 0.9,
      largeWeight: 0.62,
      softAddMix: 0.58,
      warmth: 0.03,
      scatter: 1.08
    },
    shine: {
      thresholdBias: -0.03,
      whiteProtect: 0.8,
      skinProtect: 0.72,
      darkProtect: 0.44,
      knee: 0.22,
      chromaBoost: 0.34,
      smallWeight: 0.34,
      mediumWeight: 0.86,
      largeWeight: 0.68,
      softAddMix: 0.44,
      warmth: 0.05,
      scatter: 1.18
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
    const strengthRatio = strength / 100;
    const radiusRatio = radius / 500;
    const legacyRadiusRatio = Math.min(1, radius / 250);
    const wideRadiusRatio = Math.max(0, (radius - 250) / 250);
    const thresholdRatio = 1 - threshold / 100;
    const exposureRatio = brightnessBias / 100;
    const spreadRatio = Math.pow(radiusRatio, 0.9);
    const spreadAir = Math.pow(radiusRatio, 1.15);
    // Keep "radius" as spatial spread instead of accidental brightness gain.
    const spreadEnergyCompensation = 1 - spreadRatio * 0.24 - spreadAir * 0.08;
    // Make "strength" primarily control luminous energy.
    const strengthEnergyBoost = 0.58 + Math.pow(strengthRatio, 1.08) * 1.72;

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
        // Decouple from threshold: threshold sets the center; exposure mainly tunes source activity.
        thresholdLow: clamp(0.36 + thresholdRatio * 0.32 + preset.thresholdBias - exposureRatio * 0.022, 0.2, 0.86, 0.62),
        thresholdHigh: clamp(0.55 + thresholdRatio * 0.29 + preset.thresholdBias - exposureRatio * 0.028, 0.32, 0.96, 0.78),
        thresholdKnee: clamp(
          preset.knee * (1.08 - thresholdRatio * 0.38) + legacyRadiusRatio * 0.04 + exposureRatio * 0.055,
          0.08,
          0.36,
          0.2
        ),
        localRadius: Math.max(3, Math.round(4 + legacyRadiusRatio * 10)),
        contrastLow: clamp(0.025 - exposureRatio * 0.008, 0.015, 0.04, 0.025),
        contrastHigh: clamp(0.095 - thresholdRatio * 0.035 - exposureRatio * 0.02, 0.03, 0.11, 0.07),
        specularLow: 0.06,
        specularHigh: 0.28,
        chromaBoost: clamp(preset.chromaBoost + saturation / 100 * 0.22 + Math.max(0, exposureRatio) * 0.03, 0, 0.62, preset.chromaBoost),
        whiteProtect: preset.whiteProtect,
        skinProtect: preset.skinProtect,
        darkProtect: preset.darkProtect
      },
      blur: {
        mipCount: Math.max(2, Math.min(7, Math.round(2.9 + legacyRadiusRatio * 3.25 + wideRadiusRatio * 1.15))),
        mipWeights: [
          preset.smallWeight * (0.82 - spreadRatio * 0.34),
          preset.mediumWeight * (0.94 + spreadRatio * 0.12),
          preset.largeWeight * (0.72 + spreadRatio * preset.scatter * 0.58 + wideRadiusRatio * 0.16),
          preset.largeWeight * (0.48 + spreadRatio * preset.scatter * 0.56 + wideRadiusRatio * 0.3),
          preset.largeWeight * (0.32 + spreadRatio * preset.scatter * 0.46 + wideRadiusRatio * 0.44),
          preset.largeWeight * (0.2 + spreadRatio * preset.scatter * 0.36 + wideRadiusRatio * 0.52),
          preset.largeWeight * (0.1 + spreadRatio * 0.14 + wideRadiusRatio * 0.48)
        ],
        pyramidWeight: clamp(0.86 + spreadRatio * 0.34 + wideRadiusRatio * 0.22 + preset.scatter * 0.08, 0.82, 1.68, 1),
        smallWeight: preset.smallWeight,
        mediumWeight: preset.mediumWeight,
        largeWeight: preset.largeWeight * (0.68 + spreadRatio * preset.scatter * 0.86 + wideRadiusRatio * 0.4),
        passes: 1
      },
      composite: {
        intensity: clamp(strengthEnergyBoost * spreadEnergyCompensation, 0, 2.35, 1),
        softAddMix: clamp(preset.softAddMix + spreadAir * 0.18 - strengthRatio * 0.08, 0.24, 0.74, preset.softAddMix),
        warmth: preset.warmth,
        saturation: clamp(1.16 + saturation / 100 * 0.46 + preset.chromaBoost * 0.22, 0.72, 1.62, 1),
        highlightProtect: clamp(0.66 + thresholdRatio * 0.22 + spreadAir * 0.05, 0.58, 0.94, 0.76),
        shadowProtect: preset.darkProtect,
        colorProtect: clamp(0.24 + strengthRatio * 0.16 - spreadRatio * 0.04, 0.22, 0.46, 0.3),
        shoulder: clamp(0.74 - strengthRatio * 0.22 + spreadAir * 0.07 + Math.max(0, exposureRatio) * 0.03, 0.48, 0.82, 0.64),
        colorShift: colorShift / 100,
        colorTint,
        colorAmount: colorAmount / 100,
        chromatic: chromatic / 100
      },
      sourceTone: {
        // Exposure is mostly source-side activity shaping (not output intensity).
        exposure: clamp(exposureRatio * 0.12, -0.12, 0.12, 0),
        gamma: clamp(1 - exposureRatio * 0.12, 0.86, 1.14, 1)
      }
    };
  }

  modules.glowPresets = {
    clamp,
    normalizeGlowParams
  };
})(window);
