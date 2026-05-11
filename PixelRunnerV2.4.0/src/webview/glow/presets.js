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
    const spreadRatio = Math.pow(radiusRatio, 0.92);
    const spreadAir = Math.pow(radiusRatio, 1.15);
    // Lens-scatter proxy: halo footprint follows area growth (~r^2 trend in normalized domain).
    const lensArea = Math.pow(radiusRatio, 2);
    // Strength should react earlier in low-mid range while still leaving headroom.
    const strengthDrive = Math.pow(strengthRatio, 0.88);
    // Radius should mostly move energy outward into halo instead of boosting local white.
    const spreadEnergyCompensation = 1 - spreadRatio * 0.12 - spreadAir * 0.04;
    const radiusEnergyDamping = 1 / (1 + lensArea * 1.55);
    // Physical mapping: strength=0 should produce zero emitted glow energy.
    const strengthEnergyBoost = strengthDrive * 3.35;
    // Chromatic slider should become visible earlier (especially in 12~45 range).
    const chromaticRatio = Math.pow(chromatic / 100, 0.88);

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
        thresholdLow: clamp(0.38 + thresholdRatio * 0.36 + preset.thresholdBias - exposureRatio * 0.016, 0.2, 0.9, 0.64),
        thresholdHigh: clamp(0.58 + thresholdRatio * 0.3 + preset.thresholdBias - exposureRatio * 0.02, 0.34, 0.97, 0.8),
        thresholdKnee: clamp(
          preset.knee * (1.06 - thresholdRatio * 0.44) + legacyRadiusRatio * 0.032 + exposureRatio * 0.042,
          0.07,
          0.32,
          0.2
        ),
        localRadius: Math.max(3, Math.round(4 + legacyRadiusRatio * 10)),
        contrastLow: clamp(0.024 - exposureRatio * 0.009, 0.013, 0.038, 0.024),
        contrastHigh: clamp(0.092 - thresholdRatio * 0.04 - exposureRatio * 0.022, 0.028, 0.11, 0.068),
        specularLow: 0.06,
        specularHigh: 0.28,
        chromaBoost: clamp(preset.chromaBoost + saturation / 100 * 0.22 + Math.max(0, exposureRatio) * 0.03, 0, 0.62, preset.chromaBoost),
        whiteProtect: preset.whiteProtect,
        skinProtect: preset.skinProtect,
        darkProtect: preset.darkProtect
      },
      blur: {
        mipCount: Math.max(2, Math.min(7, Math.round(2.7 + legacyRadiusRatio * 3.1 + wideRadiusRatio * 1.35))),
        mipWeights: [
          // Radius grows: reduce near-core weights; push more energy to far halo levels.
          preset.smallWeight * (0.74 - spreadRatio * 0.52 - lensArea * 0.08),
          preset.mediumWeight * (0.88 + spreadRatio * 0.05 - lensArea * 0.04),
          preset.largeWeight * (0.8 + spreadRatio * preset.scatter * 0.62 + lensArea * 0.22 + wideRadiusRatio * 0.18),
          preset.largeWeight * (0.62 + spreadRatio * preset.scatter * 0.7 + lensArea * 0.34 + wideRadiusRatio * 0.34),
          preset.largeWeight * (0.46 + spreadRatio * preset.scatter * 0.62 + lensArea * 0.48 + wideRadiusRatio * 0.48),
          preset.largeWeight * (0.3 + spreadRatio * preset.scatter * 0.52 + lensArea * 0.62 + wideRadiusRatio * 0.62),
          preset.largeWeight * (0.18 + spreadRatio * 0.24 + lensArea * 0.7 + wideRadiusRatio * 0.68)
        ],
        pyramidWeight: clamp(0.9 + spreadRatio * 0.24 + lensArea * 0.58 + wideRadiusRatio * 0.2 + preset.scatter * 0.06, 0.86, 1.98, 1),
        smallWeight: preset.smallWeight,
        mediumWeight: preset.mediumWeight,
        largeWeight: preset.largeWeight * (0.78 + spreadRatio * preset.scatter * 0.86 + lensArea * 0.74 + wideRadiusRatio * 0.46),
        passes: 1
      },
      composite: {
        intensity: clamp(strengthEnergyBoost * spreadEnergyCompensation * (0.78 + radiusEnergyDamping * 0.52), 0, 3.2, 1),
        // Favor screen-like appearance; reduce additive/linear-dodge feel.
        softAddMix: clamp(0.08 + spreadAir * 0.06 + preset.softAddMix * 0.08, 0.06, 0.24, 0.12),
        warmth: preset.warmth,
        saturation: clamp(1.16 + saturation / 100 * 0.46 + preset.chromaBoost * 0.22, 0.72, 1.62, 1),
        highlightProtect: clamp(0.72 + thresholdRatio * 0.24 + spreadAir * 0.03 + strengthRatio * 0.08, 0.64, 0.97, 0.82),
        shadowProtect: preset.darkProtect,
        colorProtect: clamp(0.25 + strengthRatio * 0.13 - spreadRatio * 0.02, 0.22, 0.46, 0.31),
        // Increase shoulder with strength to avoid dead-white cores.
        shoulder: clamp(0.5 + strengthRatio * 0.12 + spreadAir * 0.03 + Math.max(0, exposureRatio) * 0.018, 0.42, 0.74, 0.56),
        colorShift: colorShift / 100,
        colorTint,
        colorAmount: colorAmount / 100,
        chromatic: chromaticRatio,
        // Split glow into core vs halo at composite stage (strength-gated).
        coreSuppression: clamp(0.2 + strengthDrive * 0.5 + thresholdRatio * 0.14, 0.16, 0.92, 0.44),
        haloBoost: clamp((0.56 + spreadAir * 0.62 + lensArea * 0.4 + wideRadiusRatio * 0.22) * Math.pow(strengthRatio, 0.74) * (0.7 + radiusEnergyDamping * 0.5), 0, 2.05, 0),
        haloMix: clamp((0.24 + spreadAir * 0.46 + lensArea * 0.38) * Math.pow(strengthRatio, 0.56), 0, 0.9, 0)
      },
      sourceTone: {
        // Exposure is mostly source-side activity shaping (not output intensity).
        exposure: clamp(exposureRatio * 0.18, -0.18, 0.18, 0),
        gamma: clamp(1 - exposureRatio * 0.16, 0.82, 1.18, 1)
      }
    };
  }

  modules.glowPresets = {
    clamp,
    normalizeGlowParams
  };
})(window);
