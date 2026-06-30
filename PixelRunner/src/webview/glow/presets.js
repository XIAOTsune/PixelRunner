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
    if (key === "starburst" || key === "star" || key === "sparkle") return "starburst";
    if (key === "anamorphic" || key === "wide" || key === "streak" || key === "widescreen") return "anamorphic";
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
    },
    starburst: {
      thresholdBias: 0.04,
      whiteProtect: 0.96,
      skinProtect: 0.9,
      darkProtect: 0.72,
      knee: 0.06,
      chromaBoost: 0.18,
      smallWeight: 0.16,
      mediumWeight: 0.055,
      largeWeight: 0.012,
      softAddMix: 0.08,
      warmth: 0.018,
      scatter: 0.18
    },
    anamorphic: {
      thresholdBias: 0.035,
      whiteProtect: 0.94,
      skinProtect: 0.88,
      darkProtect: 0.7,
      knee: 0.07,
      chromaBoost: 0.16,
      smallWeight: 0.12,
      mediumWeight: 0.05,
      largeWeight: 0.014,
      softAddMix: 0.06,
      warmth: 0.012,
      scatter: 0.16
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
    const starLength = clamp(config.starLength, 10, 220, 58);
    const starCount = Math.round(clamp(config.starCount, 4, 12, 6));
    const starRotation = clamp(config.starRotation, -90, 90, 0);
    const starVisible = clamp(config.starVisible, 0, 100, 68);
    const streakLength = clamp(config.streakLength, 16, 300, 86);
    const streakVisible = clamp(config.streakVisible, 0, 100, 62);
    const strengthRatio = strength / 100;
    const radiusRatio = radius / 500;
    const legacyRadiusRatio = Math.min(1, radius / 250);
    const wideRadiusRatio = Math.max(0, (radius - 250) / 250);
    const thresholdRatio = threshold / 100;
    const exposureRatio = brightnessBias / 100;
    const opticalStyle = style === "starburst" || style === "anamorphic";
    const triggerThreshold = thresholdRatio;
    const triggerOpen = 1 - triggerThreshold;
    const opticalVisibility = style === "starburst" ? starVisible / 100 : (style === "anamorphic" ? streakVisible / 100 : 1);
    const opticalDensityOpen = Math.pow(opticalVisibility, style === "anamorphic" ? 0.78 : 0.84);
    const opticalDensitySelectivity = 1 - opticalDensityOpen;
    const opticalVisibilityShaped = Math.pow(opticalVisibility, style === "anamorphic" ? 1.08 : 1.12);
    const opticalCandidateCount = opticalStyle
      ? Math.round(
          style === "starburst"
            ? (8 + opticalVisibilityShaped * 180)
            : (10 + opticalVisibilityShaped * 220)
        )
      : 0;
    const opticalSuppressionRadius = opticalStyle
      ? clamp(
          style === "starburst"
            ? 46 - opticalVisibilityShaped * 32
            : 36 - opticalVisibilityShaped * 24,
          style === "starburst" ? 10 : 8,
          style === "starburst" ? 50 : 40,
          style === "starburst" ? 22 : 18
        )
      : 0;
    const triggerHigh = clamp(
      style === "starburst"
        ? 0.34 + triggerThreshold * 0.56 + preset.thresholdBias
        : (style === "anamorphic"
          ? 0.3 + triggerThreshold * 0.54 + preset.thresholdBias
          : 0),
      0.24,
      0.96,
      0.58
    );
    const triggerKnee = clamp(
      style === "starburst"
        ? 0.035 + triggerOpen * 0.085 + Math.max(0, exposureRatio) * 0.012
        : (style === "anamorphic"
          ? 0.04 + triggerOpen * 0.095 + Math.max(0, exposureRatio) * 0.014
          : 0),
      0.025,
      0.14,
      0.06
    );
    // Legacy bloom modes keep the existing inverse selectivity curve.
    const thresholdSelectivity = 1 - thresholdRatio;
    const thresholdFineSelectivity = Math.pow(thresholdSelectivity, 1.35);
    const thresholdPrecision = 1 - Math.pow(thresholdRatio, 1.78);
    const thresholdOpen = thresholdRatio;
    const thresholdKneeOpen = Math.pow(thresholdRatio, 1.22);
    const spreadRatio = Math.pow(radiusRatio, 0.92);
    const spreadAir = Math.pow(radiusRatio, 1.15);
    // Lens-scatter proxy: halo footprint follows area growth (~r^2 trend in normalized domain).
    const lensArea = Math.pow(radiusRatio, 2);
    // Strength should add optical energy without turning the extracted source into a white matte.
    const strengthDrive = Math.pow(strengthRatio, 1.22);
    // Radius should mostly move energy outward into halo instead of boosting local white.
    const spreadEnergyCompensation = 1 - spreadRatio * 0.12 - spreadAir * 0.04;
    const radiusEnergyDamping = 1 / (1 + lensArea * 1.55);
    // Physical mapping: strength=0 should produce zero emitted glow energy.
    const strengthEnergyBoost = strengthDrive * 12.2;
    // Chromatic slider should become visible earlier (especially in 12~45 range).
    const chromaticRatio = Math.pow(chromatic / 100, 0.88);
    const diffusionT = Math.max(0, Math.min(1, spreadRatio));
    const nearMipWeights = [0.68, 0.34, 0.14, 0.052, 0.018, 0.005, 0.002];
    const midMipWeights = [0.36, 0.32, 0.24, 0.16, 0.082, 0.035, 0.014];
    // Keep a near-field core floor even at maximum diffusion; far mips add veil instead of replacing bloom.
    const farMipWeights = [0.2, 0.23, 0.24, 0.22, 0.16, 0.09, 0.045];
    const bloomMipShape = diffusionT < 0.52
      ? mixLists(nearMipWeights, midMipWeights, diffusionT / 0.52)
      : mixLists(midMipWeights, farMipWeights, (diffusionT - 0.52) / 0.48);
    const starMipWeights = [0.2, 0.07, 0.022, 0.006, 0.001, 0, 0];
    const anamorphicMipWeights = [0.17, 0.065, 0.026, 0.008, 0.0015, 0, 0];
    const mipShape = opticalStyle
      ? (style === "starburst" ? starMipWeights : anamorphicMipWeights)
      : bloomMipShape;
    const styleEnergy = style === "none" ? 0 : clamp(
      0.98 + preset.smallWeight * 0.16 + preset.mediumWeight * 0.14 + preset.largeWeight * 0.12,
      0,
      1.42,
      1.16
    );
    const diffusionEnergyCompensation = opticalStyle ? 0.22 : 1 + diffusionT * 0.12;
    const normalizedMipWeights = normalizeWeights(mipShape, styleEnergy * diffusionEnergyCompensation);
    const sourceParams = opticalStyle
      ? {
          thresholdLow: clamp(triggerHigh - triggerKnee * (style === "starburst" ? 1.15 : 1.35), 0.18, 0.94, 0.42),
          thresholdHigh: triggerHigh,
          thresholdKnee: triggerKnee,
          localRadius: Math.max(2, Math.round(style === "starburst" ? 3 + triggerOpen * 4 : 4 + triggerOpen * 5)),
          sourceFeatherRadius: Math.max(1, Math.min(3, Math.round(style === "starburst" ? 1 + triggerOpen * 1.4 : 1 + triggerOpen * 1.7))),
          haloMaskRadius: Math.max(4, Math.min(10, Math.round(style === "starburst" ? 4 + triggerOpen * 4 : 5 + triggerOpen * 5))),
          contrastLow: clamp(0.016 - exposureRatio * 0.006, 0.01, 0.03, 0.018),
          contrastHigh: clamp((style === "starburst" ? 0.05 : 0.044) + triggerThreshold * 0.09 - exposureRatio * 0.012, 0.032, 0.15, 0.062),
          specularLow: clamp((style === "starburst" ? 0.045 : 0.038) + triggerThreshold * 0.04, 0.03, 0.105, 0.052),
          specularHigh: clamp((style === "starburst" ? 0.18 : 0.16) + triggerThreshold * 0.2, 0.13, 0.44, 0.24),
          lowEnergyCutoff: clamp(
            (style === "starburst" ? 0.034 : 0.03) +
              triggerThreshold * 0.058 +
              opticalDensitySelectivity * (style === "starburst" ? 0.012 : 0.009),
            0.024,
            0.12,
            0.04
          ),
          chromaBoost: clamp(preset.chromaBoost + saturation / 100 * 0.12 + Math.max(0, exposureRatio) * 0.018, 0, 0.48, preset.chromaBoost),
          whiteProtect: preset.whiteProtect,
          skinProtect: preset.skinProtect,
          darkProtect: preset.darkProtect,
          triggerMode: style === "starburst" ? 1 : 2
        }
      : {
          // thresholdHigh is the soft-knee center; thresholdLow is only the lower support for specular/rim gates.
          thresholdLow: clamp(
            0.16 + thresholdPrecision * 0.8 + preset.thresholdBias * 0.35 - exposureRatio * 0.02 -
              (0.034 + thresholdOpen * 0.12 + spreadRatio * 0.018) * (0.35 + thresholdRatio * 0.3),
            0.08,
            0.965,
            0.42
          ),
          thresholdHigh: clamp(0.16 + thresholdPrecision * 0.81 + preset.thresholdBias * 0.35 - exposureRatio * 0.024, 0.12, 0.985, 0.58),
          thresholdKnee: clamp(
            0.022 + thresholdKneeOpen * 0.12 + legacyRadiusRatio * 0.01 + spreadRatio * 0.014 + Math.max(0, exposureRatio) * 0.018,
            0.025,
            0.17,
            0.08
          ),
          localRadius: Math.max(3, Math.round(4 + legacyRadiusRatio * 10)),
          sourceFeatherRadius: Math.max(1, Math.min(2, Math.round(1 + legacyRadiusRatio * 0.7))),
          haloMaskRadius: Math.max(10, Math.min(20, Math.round(10 + legacyRadiusRatio * 7 + wideRadiusRatio * 3))),
          contrastLow: clamp(0.024 - exposureRatio * 0.009, 0.013, 0.038, 0.024),
          contrastHigh: clamp(0.052 + thresholdFineSelectivity * 0.078 - exposureRatio * 0.018, 0.032, 0.15, 0.068),
          specularLow: clamp(0.06 + thresholdFineSelectivity * 0.05, 0.06, 0.12, 0.06),
          specularHigh: clamp(0.28 + thresholdFineSelectivity * 0.16, 0.28, 0.48, 0.28),
          lowEnergyCutoff: clamp(0.038 + thresholdFineSelectivity * 0.032, 0.038, 0.078, 0.038),
          chromaBoost: clamp(preset.chromaBoost + saturation / 100 * 0.24 + Math.max(0, exposureRatio) * 0.03, 0, 0.68, preset.chromaBoost),
          whiteProtect: preset.whiteProtect,
          skinProtect: preset.skinProtect,
          darkProtect: preset.darkProtect,
          triggerMode: 0
        };

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
      source: sourceParams,
      blur: {
        mipCount: opticalStyle
          ? Math.max(2, Math.min(4, Math.round(style === "starburst" ? 2.4 + triggerOpen * 1.1 : 2.8 + triggerOpen * 1.2)))
          : Math.max(2, Math.min(7, Math.round(2.7 + legacyRadiusRatio * 3.1 + wideRadiusRatio * 1.35))),
        mipWeights: normalizedMipWeights,
        pyramidWeight: opticalStyle
          ? clamp(style === "starburst" ? 0.24 + strengthRatio * 0.1 : 0.22 + strengthRatio * 0.095, 0.14, 0.42, 0.24)
          : clamp(0.82 + diffusionT * 0.14 + preset.scatter * 0.045, 0.76, 1.08, 0.86),
        smallWeight: preset.smallWeight,
        mediumWeight: preset.mediumWeight,
        largeWeight: preset.largeWeight,
        passes: 1,
        optics: {
          mode: style === "starburst" ? "starburst" : (style === "anamorphic" ? "anamorphic" : "soft"),
          strength: style === "starburst"
            ? clamp((0.28 + strengthRatio * 0.72 + triggerOpen * 0.08) * (0.9 + Math.pow(starLength / 220, 0.7) * 0.2), 0, 1.25, 0.68)
            : (style === "anamorphic"
              ? clamp((0.3 + strengthRatio * 0.76 + triggerOpen * 0.075) * (0.95 + Math.pow(streakLength / 300, 0.72) * 0.22), 0, 1.32, 0.72)
              : 0),
          length: style === "starburst"
            ? clamp(starLength * (0.92 + strengthRatio * 0.16), 8, 260, 58)
            : (style === "anamorphic"
              ? clamp(streakLength * (0.96 + strengthRatio * 0.2), 14, 360, 86)
              : 0),
          sharpness: style === "starburst" ? 1.82 : (style === "anamorphic" ? 2.32 : 1),
          coreMix: style === "starburst" ? 0.32 : (style === "anamorphic" ? 0.26 : 1),
          verticalTightness: style === "anamorphic" ? 0.48 : 1,
          diagonalMix: style === "starburst" ? 0.58 : 0,
          starCount,
          rotation: style === "starburst" ? starRotation : 0,
          visibility: opticalVisibility,
          candidateCount: opticalCandidateCount,
          suppressionRadius: opticalSuppressionRadius,
          candidateSoftness: style === "starburst"
            ? clamp(0.2 + opticalDensityOpen * 0.18 + triggerOpen * 0.04, 0.18, 0.44, 0.28)
            : clamp(0.18 + opticalDensityOpen * 0.16 + triggerOpen * 0.035, 0.16, 0.38, 0.24),
          candidateBlend: style === "starburst"
            ? clamp(0.18 + opticalDensityOpen * 0.12, 0.14, 0.34, 0.22)
            : clamp(0.16 + opticalDensityOpen * 0.1, 0.12, 0.3, 0.2),
          sourceGate: style === "starburst"
            ? clamp(0.012 + triggerThreshold * 0.08 + opticalDensitySelectivity * 0.038, 0.008, 0.18, 0.036)
            : (style === "anamorphic"
              ? clamp(0.01 + triggerThreshold * 0.07 + opticalDensitySelectivity * 0.03, 0.006, 0.16, 0.034)
              : 0),
          sourceGateSoftness: style === "starburst"
            ? clamp(0.15 - opticalDensityOpen * 0.07 + triggerOpen * 0.028, 0.045, 0.19, 0.1)
            : (style === "anamorphic"
              ? clamp(0.13 - opticalDensityOpen * 0.06 + triggerOpen * 0.024, 0.038, 0.17, 0.09)
              : 0.08),
          densityGate: style === "starburst"
            ? clamp(0.04 + triggerThreshold * 0.1 + opticalDensitySelectivity * 0.12, 0.02, 0.32, 0.12)
            : (style === "anamorphic"
              ? clamp(0.032 + triggerThreshold * 0.085 + opticalDensitySelectivity * 0.1, 0.016, 0.28, 0.1)
              : 0),
          softSourceMix: style === "starburst"
            ? clamp(0.052 + opticalDensityOpen * 0.025, 0.04, 0.09, 0.055)
            : (style === "anamorphic" ? clamp(0.044 + opticalDensityOpen * 0.02, 0.034, 0.074, 0.045) : 0),
          baseVeil: style === "starburst" ? 0.018 : (style === "anamorphic" ? 0.016 : 1),
          normalization: style === "starburst"
            ? clamp(0.58 + opticalDensitySelectivity * 0.12, 0.54, 0.78, 0.62)
            : (style === "anamorphic" ? clamp(0.56 + opticalDensitySelectivity * 0.1, 0.52, 0.72, 0.58) : 1),
          uiLength: style === "anamorphic" ? streakLength : starLength
        }
      },
      composite: {
        intensity: opticalStyle
          ? clamp(strengthDrive * (style === "starburst" ? 9.2 : 10.4) * (0.7 + triggerOpen * 0.16), 0, 28, 1)
          : clamp(strengthEnergyBoost * (1.08 + radiusEnergyDamping * 0.52) * (1 + diffusionT * 0.12), 0, 38, 1),
        // Favor screen-like appearance; reduce additive/linear-dodge feel.
        softAddMix: opticalStyle ? clamp(0.025 + preset.softAddMix * 0.08, 0.02, 0.055, 0.03) : clamp(0.08 + spreadAir * 0.06 + preset.softAddMix * 0.08, 0.06, 0.24, 0.12),
        warmth: preset.warmth,
        saturation: opticalStyle ? clamp(1.08 + saturation / 100 * 0.34 + preset.chromaBoost * 0.18, 0.72, 1.62, 1) : clamp(1.22 + saturation / 100 * 0.56 + preset.chromaBoost * 0.3, 0.72, 1.9, 1),
        highlightProtect: opticalStyle ? clamp(0.68 + triggerThreshold * 0.08 + strengthRatio * 0.04, 0.62, 0.88, 0.72) : clamp(0.58 + thresholdSelectivity * 0.14 + spreadAir * 0.02 + strengthRatio * 0.05, 0.52, 0.86, 0.72),
        shadowProtect: preset.darkProtect,
        colorProtect: opticalStyle ? clamp(0.2 + strengthRatio * 0.08, 0.18, 0.36, 0.26) : clamp(0.24 + strengthRatio * 0.1 + spreadRatio * 0.025, 0.22, 0.48, 0.3),
        // Keep highlights energetic; too much shoulder makes strength feel gray instead of brighter.
        shoulder: opticalStyle ? clamp(0.13 + strengthRatio * 0.018, 0.1, 0.2, 0.14) : clamp(0.16 + strengthRatio * 0.028 + spreadAir * 0.012 + Math.max(0, exposureRatio) * 0.004, 0.12, 0.28, 0.18),
        colorShift: colorShift / 100,
        colorTint,
        colorAmount: colorAmount / 100,
        chromatic: chromaticRatio,
        // Split glow into core vs halo at composite stage (strength-gated).
        coreSuppression: opticalStyle ? clamp(0.18 + strengthDrive * 0.16, 0.12, 0.42, 0.22) : clamp(0.34 + strengthDrive * 0.28 + thresholdSelectivity * 0.08 + diffusionT * 0.02, 0.28, 0.78, 0.46),
        coreCeiling: opticalStyle ? clamp(0.18 + Math.pow(strengthRatio, 0.72) * 0.24, 0.14, 0.5, 0.28) : clamp(0.22 + Math.pow(strengthRatio, 0.72) * 0.38 + diffusionT * 0.08, 0.18, 0.72, 0.42),
        haloBoost: opticalStyle ? clamp(0.26 + strengthRatio * 0.28, 0, 0.62, 0.32) : clamp((1.35 + diffusionT * 0.78 + wideRadiusRatio * 0.24) * Math.pow(strengthRatio, 1.12), 0, 3.4, 0),
        haloMix: opticalStyle ? clamp(0.025 + strengthRatio * 0.055, 0, 0.12, 0.045) : clamp((0.18 + diffusionT * 0.56) * Math.pow(strengthRatio, 1.18), 0, 0.82, 0),
        energyFloor: opticalStyle ? 0.0018 + triggerThreshold * 0.003 : 0,
        energyFloorSoftness: opticalStyle ? 0.016 : 0.001
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
