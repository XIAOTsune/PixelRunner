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

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function mixLists(a, b, t) {
    const out = [];
    const count = Math.max(a.length, b.length);
    for (let index = 0; index < count; index += 1) {
      out.push(lerp(Number(a[index]) || 0, Number(b[index]) || 0, t));
    }
    return out;
  }

  function normalizeWeights(weights, scale = 1) {
    const positive = weights.map((weight) => Math.max(0, Number(weight) || 0));
    const total = positive.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0.0001) return positive;
    return positive.map((weight) => weight / total * scale);
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
    const strengthDrive = Math.pow(strengthRatio, 0.58);
    // Radius should mostly move energy outward into halo instead of boosting local white.
    const spreadEnergyCompensation = 1 - spreadRatio * 0.12 - spreadAir * 0.04;
    const radiusEnergyDamping = 1 / (1 + lensArea * 1.55);
    // Physical mapping: strength=0 should produce zero emitted glow energy.
    const strengthEnergyBoost = strengthDrive * 6.2;
    // Chromatic slider should become visible earlier (especially in 12~45 range).
    const chromaticRatio = Math.pow(chromatic / 100, 0.88);
    const diffusionT = Math.max(0, Math.min(1, spreadRatio));
    const nearMipWeights = [0.5, 0.28, 0.13, 0.06, 0.022, 0.006, 0.002];
    const midMipWeights = [0.26, 0.25, 0.21, 0.14, 0.08, 0.04, 0.02];
    // Keep a near-field core floor even at maximum diffusion; far mips add veil instead of replacing bloom.
    const farMipWeights = [0.13, 0.16, 0.18, 0.19, 0.16, 0.115, 0.065];
    const mipShape = diffusionT < 0.52
      ? mixLists(nearMipWeights, midMipWeights, diffusionT / 0.52)
      : mixLists(midMipWeights, farMipWeights, (diffusionT - 0.52) / 0.48);
    const styleEnergy = style === "none" ? 0 : clamp(
      0.98 + preset.smallWeight * 0.16 + preset.mediumWeight * 0.14 + preset.largeWeight * 0.12,
      0,
      1.42,
      1.16
    );
    const diffusionEnergyCompensation = 1 + diffusionT * 0.12;
    const normalizedMipWeights = normalizeWeights(mipShape, styleEnergy * diffusionEnergyCompensation);

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
        thresholdLow: clamp(0.5 + thresholdRatio * 0.28 + preset.thresholdBias - exposureRatio * 0.016, 0.32, 0.92, 0.64),
        thresholdHigh: clamp(0.68 + thresholdRatio * 0.22 + preset.thresholdBias - exposureRatio * 0.02, 0.46, 0.98, 0.8),
        thresholdKnee: clamp(
          preset.knee * (1.02 - thresholdRatio * 0.28) + legacyRadiusRatio * 0.052 + spreadRatio * 0.035 + exposureRatio * 0.042,
          0.1,
          0.32,
          0.2
        ),
        localRadius: Math.max(3, Math.round(4 + legacyRadiusRatio * 10)),
        sourceFeatherRadius: Math.max(1, Math.min(2, Math.round(1 + legacyRadiusRatio * 0.7))),
        haloMaskRadius: Math.max(4, Math.min(8, Math.round(4 + legacyRadiusRatio * 3 + wideRadiusRatio * 1.5))),
        contrastLow: clamp(0.024 - exposureRatio * 0.009, 0.013, 0.038, 0.024),
        contrastHigh: clamp(0.092 - thresholdRatio * 0.04 - exposureRatio * 0.022, 0.028, 0.11, 0.068),
        specularLow: 0.06,
        specularHigh: 0.28,
        lowEnergyCutoff: 0.046,
        chromaBoost: clamp(preset.chromaBoost + saturation / 100 * 0.22 + Math.max(0, exposureRatio) * 0.03, 0, 0.62, preset.chromaBoost),
        whiteProtect: preset.whiteProtect,
        skinProtect: preset.skinProtect,
        darkProtect: preset.darkProtect
      },
      blur: {
        mipCount: Math.max(2, Math.min(7, Math.round(2.7 + legacyRadiusRatio * 3.1 + wideRadiusRatio * 1.35))),
        mipWeights: normalizedMipWeights,
        pyramidWeight: clamp(0.7 + diffusionT * 0.09 + preset.scatter * 0.03, 0.66, 0.88, 0.76),
        smallWeight: preset.smallWeight,
        mediumWeight: preset.mediumWeight,
        largeWeight: preset.largeWeight,
        passes: 1
      },
      composite: {
        intensity: clamp(strengthEnergyBoost * (0.86 + radiusEnergyDamping * 0.48) * (1 - diffusionT * 0.03), 0, 6.4, 1),
        // Favor screen-like appearance; reduce additive/linear-dodge feel.
        softAddMix: clamp(0.08 + spreadAir * 0.06 + preset.softAddMix * 0.08, 0.06, 0.24, 0.12),
        warmth: preset.warmth,
        saturation: clamp(1.16 + saturation / 100 * 0.46 + preset.chromaBoost * 0.22, 0.72, 1.62, 1),
        highlightProtect: clamp(0.72 + thresholdRatio * 0.24 + spreadAir * 0.03 + strengthRatio * 0.08, 0.64, 0.97, 0.82),
        shadowProtect: preset.darkProtect,
        colorProtect: clamp(0.18 + strengthRatio * 0.07 - spreadRatio * 0.015, 0.14, 0.34, 0.24),
        // Keep highlights energetic; too much shoulder makes strength feel gray instead of brighter.
        shoulder: clamp(0.38 + strengthRatio * 0.055 + spreadAir * 0.02 + Math.max(0, exposureRatio) * 0.012, 0.32, 0.58, 0.46),
        colorShift: colorShift / 100,
        colorTint,
        colorAmount: colorAmount / 100,
        chromatic: chromaticRatio,
        // Split glow into core vs halo at composite stage (strength-gated).
        coreSuppression: clamp(0.18 + strengthDrive * 0.34 + thresholdRatio * 0.08 + diffusionT * 0.05, 0.14, 0.72, 0.38),
        haloBoost: clamp((0.98 + diffusionT * 0.22 + wideRadiusRatio * 0.08) * Math.pow(strengthRatio, 0.54), 0, 1.78, 0),
        haloMix: clamp((0.18 + diffusionT * 0.32) * Math.pow(strengthRatio, 0.56), 0, 0.66, 0)
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
