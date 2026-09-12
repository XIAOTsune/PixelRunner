(function initPostFxWebglRenderer(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  const VERTEX_SHADER = `#version 300 es
    in vec2 aPosition;
    out vec2 vUv;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uSource;
    uniform vec2 uResolution;
    uniform vec2 uOrigin;
    uniform float uAmount;
    uniform float uExposure;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uWarmth;
    uniform float uShadowLift;
    uniform float uHighlightRollOff;
    uniform float uHalation;
    uniform float uHalationThreshold;
    uniform float uHalationRadius;
    uniform float uGrain;
    uniform float uGrainSize;
    uniform float uGrainColor;
    uniform float uVignette;
    uniform float uVignetteMidpoint;
    uniform float uVignetteFeather;
    uniform float uDispersion;
    uniform float uDispersionRadius;
    uniform float uDispersionHighlightsOnly;
    uniform float uSeed;
    uniform float uEffectType;
    uniform float uEffectEnabled;
    uniform float uEffectAmount;
    uniform float uCrtStrength;
    uniform float uCrtPixelGrid;
    uniform float uCrtScanlines;
    uniform float uCrtCurvature;
    uniform float uCrtConvergence;
    uniform float uPixelBlockSize;
    uniform float uPixelLevels;
    uniform float uPixelDither;
    uniform float uPixelEdgePreserve;
    uniform vec2 uWindDirection;
    uniform float uWindLength;
    uniform float uWindBreakup;
    uniform float uWindEdgeProtect;
    uniform float uShatterFragmentSize;
    uniform float uShatterScatter;
    uniform vec2 uShatterDirection;
    uniform float uShatterCracks;
    uniform float uFilmFinish;
    in vec2 vUv;
    out vec4 outColor;

    float saturate(float value) { return clamp(value, 0.0, 1.0); }

    float srgbToLinear(float value) {
      float v = saturate(value);
      return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4);
    }

    vec3 srgbToLinear(vec3 color) {
      return vec3(srgbToLinear(color.r), srgbToLinear(color.g), srgbToLinear(color.b));
    }

    float linearToSrgb(float value) {
      float v = max(0.0, value);
      return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055;
    }

    vec3 linearToSrgb(vec3 color) {
      return vec3(linearToSrgb(color.r), linearToSrgb(color.g), linearToSrgb(color.b));
    }

    float hashNoise(vec2 point, float seed) {
      uvec2 pixel = uvec2(ivec2(floor(point)));
      uint seedValue = uint(max(0.0, floor(seed)));
      uint value = (pixel.x ^ (pixel.y * 374761393u) ^ (seedValue * 1442695041u)) * 668265263u;
      value = (value ^ (value >> 13u)) * 1274126177u;
      value ^= value >> 16u;
      return float(value) / 4294967295.0;
    }

    float grainNoise(vec2 pixel, float grainSize, float seed) {
      float radius = max(1.0, floor(grainSize + 0.5));
      float fine = (
        hashNoise(pixel, seed + 3.0) +
        hashNoise(pixel + vec2(5.0, -7.0), seed + 31.0) +
        hashNoise(pixel + vec2(-9.0, 4.0), seed + 67.0)
      ) / 3.0;
      float soft = (
        hashNoise(pixel + vec2(radius, 0.0), seed + 11.0) +
        hashNoise(pixel + vec2(-radius, 0.0), seed + 23.0) +
        hashNoise(pixel + vec2(0.0, radius), seed + 37.0) +
        hashNoise(pixel + vec2(0.0, -radius), seed + 53.0)
      ) / 4.0;
      float broadRadius = radius * 2.0 + 1.0;
      float broad = (
        hashNoise(pixel + vec2(broadRadius, broadRadius), seed + 79.0) +
        hashNoise(pixel + vec2(-broadRadius, broadRadius), seed + 97.0) +
        hashNoise(pixel + vec2(broadRadius, -broadRadius), seed + 113.0) +
        hashNoise(pixel + vec2(-broadRadius, -broadRadius), seed + 131.0)
      ) / 4.0;
      return fine * 0.46 + soft * 0.36 + broad * 0.18;
    }

    float valueNoise(vec2 point, float seed) {
      vec2 cell = floor(point);
      vec2 local = smoothstep(vec2(0.0), vec2(1.0), fract(point));
      float top = mix(hashNoise(cell, seed), hashNoise(cell + vec2(1.0, 0.0), seed), local.x);
      float bottom = mix(hashNoise(cell + vec2(0.0, 1.0), seed), hashNoise(cell + vec2(1.0, 1.0), seed), local.x);
      return mix(top, bottom, local.y);
    }

    float luminance(vec3 color) {
      return dot(color, vec3(0.2126, 0.7152, 0.0722));
    }

    vec3 applyCrt(vec2 uv, vec3 base) {
      float strength = clamp(uEffectAmount * uCrtStrength / 10000.0, 0.0, 1.0);
      float curvature = uCrtCurvature / 100.0 * 0.12;
      vec2 centered = uv * 2.0 - 1.0;
      float aspect = uResolution.x / max(1.0, uResolution.y);
      vec2 aspectCentered = vec2(centered.x * aspect, centered.y);
      float radiusSquared = min(1.0, dot(aspectCentered, aspectCentered) / (aspect * aspect + 1.0));
      // Keep the outermost sample on the source edge. The previous unbounded
      // warp clipped the corners and made CRT output look zoomed and shifted.
      float curve = (1.0 + curvature * radiusSquared) / (1.0 + curvature);
      vec2 warped = clamp(vec2(0.5) + centered * curve * 0.5, vec2(0.0), vec2(1.0));
      vec2 radial = (warped - vec2(0.5)) * 2.0;
      vec2 convergence = radial * (uCrtConvergence / 100.0) * 0.008;
      vec3 color = vec3(
        texture(uSource, clamp(warped - convergence, vec2(0.0), vec2(1.0))).r,
        texture(uSource, warped).g,
        texture(uSource, clamp(warped + convergence, vec2(0.0), vec2(1.0))).b
      );
      float luma = luminance(color);
      float scanPhase = 0.5 + 0.5 * cos((gl_FragCoord.y + 0.5) * 3.14159265);
      float scan = 1.0 - uCrtScanlines / 100.0 * (0.035 + luma * 0.13) * scanPhase;
      float grillePhase = mod(floor(gl_FragCoord.x) + mod(floor(gl_FragCoord.y), 2.0), 3.0);
      float grid = uCrtPixelGrid / 100.0 * 0.038;
      float redMask = grid * (grillePhase < 0.5 ? 1.15 : -0.32);
      float greenMask = grid * (grillePhase > 0.5 && grillePhase < 1.5 ? 1.05 : -0.24);
      float blueMask = grid * (grillePhase > 1.5 ? 1.15 : -0.32);
      float edge = smoothstep(0.56, 0.98, sqrt(radiusSquared));
      float vignette = 1.0 - edge * (0.08 + strength * 0.22);
      color *= scan * vignette;
      color *= vec3(1.0 + redMask, 1.0 + greenMask, 1.0 + blueMask);
      return mix(base, color, strength);
    }

    vec3 applyPixelate(vec2 uv, vec3 base) {
      float amount = clamp(uEffectAmount / 100.0, 0.0, 1.0);
      vec2 pixels = max(uResolution, vec2(1.0));
      float block = max(2.0, uPixelBlockSize);
      vec2 blockCell = floor((uv * pixels) / block);
      vec2 cell = (blockCell * block + floor((block - 1.0) * 0.5) + 0.5) / pixels;
      vec3 color = texture(uSource, clamp(cell, vec2(0.0), vec2(1.0))).rgb;
      float levels = max(2.0, uPixelLevels);
      float bayer = mod(blockCell.x, 4.0) + mod(blockCell.y, 4.0) * 4.0;
      float threshold = (bayer / 16.0 - 0.5) * (uPixelDither / 100.0) / levels;
      color = clamp(floor((color + threshold) * (levels - 1.0) + 0.5) / (levels - 1.0), 0.0, 1.0);
      vec2 texel = 1.0 / pixels;
      float edge = abs(luminance(texture(uSource, clamp(uv + vec2(texel.x, 0.0), vec2(0.0), vec2(1.0))).rgb) - luminance(texture(uSource, clamp(uv - vec2(texel.x, 0.0), vec2(0.0), vec2(1.0))).rgb));
      edge += abs(luminance(texture(uSource, clamp(uv + vec2(0.0, texel.y), vec2(0.0), vec2(1.0))).rgb) - luminance(texture(uSource, clamp(uv - vec2(0.0, texel.y), vec2(0.0), vec2(1.0))).rgb));
      float preserve = clamp(uPixelEdgePreserve / 100.0 * smoothstep(0.035, 0.24, edge), 0.0, 1.0);
      return mix(base, color, amount * (1.0 - preserve));
    }

    vec3 applyWind(vec2 uv, vec3 base) {
      float amount = clamp(uEffectAmount / 100.0, 0.0, 1.0);
      float lengthPx = uWindLength / 100.0 * max(uResolution.x, uResolution.y) * 0.14;
      float edgeDistance = min(1.0, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)) * 2.0);
      float edgeGate = mix(1.0, 0.35 + 0.65 * smoothstep(0.02, 0.34, edgeDistance), uWindEdgeProtect / 100.0);
      vec3 sum = vec3(0.0);
      float weights = 0.0;
      float noiseScale = max(3.0, lengthPx * 0.22);
      for (int tap = 0; tap < 9; tap++) {
        float t = float(tap) / 8.0;
        float jitteredT = clamp(t + (valueNoise(vec2(t * 2.0, 0.0), 9137.0) - 0.5) * 0.18, 0.0, 1.0);
        vec2 sampleUv = uv - uWindDirection * (lengthPx * jitteredT) / max(uResolution, vec2(1.0));
        vec3 color = texture(uSource, clamp(sampleUv, vec2(0.0), vec2(1.0))).rgb;
        vec2 samplePixel = sampleUv * max(uResolution, vec2(1.0));
        float continuity = mix(1.0, smoothstep(0.18, 0.82, valueNoise(samplePixel / noiseScale, uSeed + 9173.0)), uWindBreakup / 100.0);
        float inside = step(0.0, sampleUv.x) * step(sampleUv.x, 1.0) * step(0.0, sampleUv.y) * step(sampleUv.y, 1.0);
        float weight = (0.14 + 0.86 * pow(1.0 - jitteredT, 1.55)) * continuity * inside;
        sum += color * weight;
        weights += weight;
      }
      return mix(base, sum / max(0.0001, weights), amount * edgeGate);
    }

    vec3 applyShatter(vec2 uv, vec3 base) {
      float amount = clamp(uEffectAmount / 100.0, 0.0, 1.0);
      float size = max(8.0, uShatterFragmentSize);
      vec2 pixel = uv * max(uResolution, vec2(1.0));
      vec2 baseCell = floor(pixel / size);
      vec2 localGrid = fract(pixel / size);
      vec2 originCell = baseCell + vec2(localGrid.x < 0.5 ? -1.0 : 0.0, localGrid.y < 0.5 ? -1.0 : 0.0);
      float nearestDistance = 1e20;
      float secondDistance = 1e20;
      vec2 nearestCell = baseCell;
      vec2 nearestSite = vec2(0.0);
      for (int oy = 0; oy < 2; oy++) {
        for (int ox = 0; ox < 2; ox++) {
          vec2 candidateCell = originCell + vec2(float(ox), float(oy));
          vec2 jitter = vec2(
            hashNoise(candidateCell, uSeed + 73.0),
            hashNoise(candidateCell, uSeed + 89.0)
          ) - vec2(0.5);
          vec2 candidateSite = (candidateCell + vec2(0.5) + jitter * 0.62) * size;
          float distance = dot(pixel - candidateSite, pixel - candidateSite);
          if (distance < nearestDistance) {
            secondDistance = nearestDistance;
            nearestDistance = distance;
            nearestCell = candidateCell;
            nearestSite = candidateSite;
          } else if (distance < secondDistance) {
            secondDistance = distance;
          }
        }
      }
      vec2 local = pixel - nearestSite;
      float angle = (hashNoise(nearestCell, uSeed + 101.0) - 0.5) * 0.45 * amount;
      float c = cos(angle);
      float s = sin(angle);
      vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
      float fragmentScatter = uShatterScatter / 100.0 * size * 0.92 * (0.22 + hashNoise(nearestCell, uSeed + 149.0) * 0.78) * amount;
      float crossScatter = uShatterScatter / 100.0 * size * 0.92 * (hashNoise(nearestCell, uSeed + 191.0) - 0.5) * 0.34 * amount;
      vec2 perpendicular = vec2(-uShatterDirection.y, uShatterDirection.x);
      vec2 samplePixel = nearestSite + rotated - uShatterDirection * fragmentScatter - perpendicular * crossScatter;
      vec3 fragment = texture(uSource, clamp(samplePixel / max(uResolution, vec2(1.0)), vec2(0.0), vec2(1.0))).rgb;
      float boundaryGap = max(0.0, sqrt(secondDistance) - sqrt(nearestDistance));
      float crack = smoothstep(0.0, size * (0.008 + uShatterCracks / 100.0 * 0.052), boundaryGap);
      float crackEdge = 1.0 - crack;
      float aberration = crackEdge * uShatterCracks / 100.0 * 0.05;
      float shaded = 1.0 - crackEdge * uShatterCracks / 100.0 * 0.72;
      fragment += vec3(aberration, 0.0, aberration * 1.25);
      fragment *= shaded;
      return mix(base, clamp(fragment, 0.0, 1.0), amount);
    }

    vec3 sampleDispersion(vec2 uv, vec3 center) {
      float radius = max(uResolution.x, uResolution.y);
      float shift = 0.024 * (uDispersion / 100.0) * pow(uDispersionRadius / 100.0, 0.72) * radius;
      vec2 radial = (uv - vec2(0.5)) * vec2(uResolution.x / max(1.0, uResolution.y), 1.0);
      float distance = min(1.0, length(radial) * 1.4143);
      float highlightMix = uDispersionHighlightsOnly > 0.5
        ? smoothstep(0.24, 0.78, luminance(center))
        : 1.0;
      float edgeInfluence = 0.18 + 0.82 * smoothstep(0.04, 0.94, distance);
      vec2 offset = radial * edgeInfluence * shift / vec2(max(1.0, uResolution.x), max(1.0, uResolution.y));
      float amount = highlightMix * step(0.01, shift);
      float red = texture(uSource, clamp(uv - offset * amount, 0.0, 1.0)).r;
      float blue = texture(uSource, clamp(uv + offset * amount, 0.0, 1.0)).b;
      return vec3(red, center.g, blue);
    }

    vec3 sampleHalation(vec2 uv, float threshold, float radiusPx) {
      vec2 texel = 1.0 / max(uResolution, vec2(1.0));
      vec3 sum = vec3(0.0);
      float weightSum = 0.0;
      for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
          vec2 offset = vec2(float(x), float(y)) * texel * radiusPx * 0.5;
          vec3 color = texture(uSource, clamp(uv + offset, 0.0, 1.0)).rgb;
          float bright = smoothstep(threshold - 0.1, threshold + 0.12, luminance(color));
          float distance = float(x * x + y * y);
          float weight = exp(-distance * 0.42);
          sum += color * bright * weight;
          weightSum += weight;
        }
      }
      return sum / max(weightSum, 0.0001);
    }

    void main() {
      vec4 sourceSample = texture(uSource, vUv);
      vec3 source = sourceSample.rgb;
      vec3 effectColor = source;
      if (uEffectType > 0.5 && uEffectType < 1.5) effectColor = applyCrt(vUv, source);
      else if (uEffectType >= 1.5 && uEffectType < 2.5) effectColor = applyPixelate(vUv, source);
      else if (uEffectType >= 2.5 && uEffectType < 3.5) effectColor = applyWind(vUv, source);
      else if (uEffectType >= 3.5) effectColor = applyShatter(vUv, source);
      float filmEnabled = ((uEffectType < 0.5 && uEffectEnabled > 0.5 && uEffectAmount > 0.001) || (uEffectType >= 0.5 && uFilmFinish > 0.5)) ? 1.0 : 0.0;
      source = effectColor;
      vec3 dispersed = filmEnabled > 0.5 ? sampleDispersion(vUv, source) : source;
      vec3 linear = srgbToLinear(dispersed);
      float exposure = pow(2.0, uExposure / 100.0);
      linear *= exposure;
      float luma = luminance(linear);
      float shadowMask = 1.0 - smoothstep(0.08, 0.58, luma);
      float highlightMask = smoothstep(0.56, 1.0, luma);
      float lift = (uShadowLift / 100.0) * shadowMask * 0.12;
      linear += vec3(lift);
      float roll = uHighlightRollOff / 100.0;
      if (roll > 0.0) {
        linear = 0.58 + (linear - 0.58) / (1.0 + roll * max(linear - 0.58, 0.0) * 3.2);
      }
      float toneLuma = luminance(linear);
      float saturation = 1.0 + uSaturation / 100.0;
      linear = vec3(toneLuma) + (linear - vec3(toneLuma)) * saturation;
      float warmth = uWarmth / 100.0;
      linear.r += warmth * 0.035 * (0.35 + highlightMask * 0.65);
      linear.b -= warmth * 0.026 * (0.35 + highlightMask * 0.65);
      vec3 graded = linearToSrgb(linear);
      float contrast = 1.0 + uContrast / 100.0 * 0.72;
      graded = (graded - vec3(0.5)) * contrast + vec3(0.5);
      vec3 outputColor = filmEnabled > 0.5 ? mix(source, graded, uAmount / 100.0) : source;

      if (filmEnabled > 0.5 && uHalation > 0.0) {
        float threshold = uHalationThreshold / 100.0;
        float radiusPx = max(1.0, uHalationRadius * min(uResolution.x, uResolution.y) / 1200.0);
        vec3 halo = sampleHalation(vUv, threshold, radiusPx);
        float haloMask = smoothstep(threshold - 0.1, threshold + 0.12, luminance(source));
        float strength = uHalation / 100.0 * uAmount / 100.0 * 0.34 * haloMask;
        outputColor += halo * vec3(1.1, 0.3, 0.08) * strength;
      }

      float grainStrength = filmEnabled * uGrain / 100.0 * uAmount / 100.0 * 0.13;
      if (grainStrength > 0.0) {
        vec2 fragmentPoint = vec2(gl_FragCoord.x - 0.5, uResolution.y - gl_FragCoord.y - 0.5) + uOrigin;
        float mono = grainNoise(floor(fragmentPoint), uGrainSize, uSeed) - 0.5;
        float chroma = grainNoise(floor(fragmentPoint) + vec2(17.0, -11.0), uGrainSize, uSeed + 97.0) - 0.5;
        float grainLuma = luminance(outputColor);
        float shadowWeight = 1.0 - smoothstep(0.10, 0.52, grainLuma);
        float highlightWeight = smoothstep(0.58, 0.92, grainLuma);
        float toneWeight = clamp(0.92 + shadowWeight * 0.24 - highlightWeight * 0.58, 0.26, 1.18);
        mono *= grainStrength * toneWeight;
        chroma *= grainStrength * toneWeight * (uGrainColor / 100.0) * 0.16;
        outputColor += vec3(
          mono + chroma * 0.55,
          mono - chroma * 0.20,
          mono - chroma * 0.45
        );
      }

      float nx = (vUv.x - 0.5) * 2.0;
      float ny = (vUv.y - 0.5) * 2.0;
      float distance = min(1.0, length(vec2(nx, ny)) / 1.4143);
      float vignetteMask = smoothstep(uVignetteMidpoint / 100.0, min(1.0, uVignetteMidpoint / 100.0 + uVignetteFeather / 100.0), distance);
      outputColor *= 1.0 - (filmEnabled * uVignette / 100.0 * uAmount / 100.0 * 0.72) * vignetteMask;
      outColor = vec4(clamp(outputColor, 0.0, 1.0), sourceSample.a);
    }
  `;

  const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "WebGL2 shader 编译失败";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "WebGL2 shader 链接失败";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  class PostFxWebglRenderer {
    constructor() {
      this.canvas = null;
      this.gl = null;
      this.program = null;
      this.texture = null;
      this.buffer = null;
      this.locations = null;
      this.failed = null;
    }

    ensureContext() {
      if (this.gl) return this.gl;
      if (this.failed) throw this.failed;
      try {
        this.canvas = document.createElement("canvas");
        this.canvas.width = 1;
        this.canvas.height = 1;
        this.gl = this.canvas.getContext("webgl2", {
          alpha: true,
          antialias: false,
          depth: false,
          stencil: false,
          premultipliedAlpha: false,
          preserveDrawingBuffer: true
        });
        if (!this.gl) throw new Error("WebGL2 context unavailable");
        const gl = this.gl;
        this.program = createProgram(gl);
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW);
        this.locations = {};
        [
          "uSource", "uResolution", "uOrigin", "uAmount", "uExposure", "uContrast", "uSaturation", "uWarmth",
          "uShadowLift", "uHighlightRollOff", "uHalation", "uHalationThreshold", "uHalationRadius", "uGrain",
          "uGrainSize", "uGrainColor", "uVignette", "uVignetteMidpoint", "uVignetteFeather", "uDispersion",
          "uDispersionRadius", "uDispersionHighlightsOnly", "uSeed", "uEffectType", "uEffectEnabled", "uEffectAmount",
          "uCrtStrength", "uCrtPixelGrid", "uCrtScanlines", "uCrtCurvature", "uCrtConvergence",
          "uPixelBlockSize", "uPixelLevels", "uPixelDither", "uPixelEdgePreserve", "uWindDirection",
          "uWindLength", "uWindBreakup", "uWindEdgeProtect", "uShatterFragmentSize", "uShatterScatter",
          "uShatterDirection", "uShatterCracks", "uFilmFinish"
        ].forEach((name) => { this.locations[name] = gl.getUniformLocation(this.program, name); });
        return gl;
      } catch (error) {
        this.failed = error;
        throw error;
      }
    }

    canRender(width, height) {
      try {
        const gl = this.ensureContext();
        const report = modules.glowGpuCapabilities && modules.glowGpuCapabilities.getReport
          ? modules.glowGpuCapabilities.getReport()
          : null;
        const maxTextureSize = Number(report && report.maxTextureSize) || Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
        return Boolean(maxTextureSize > 0 && width > 0 && height > 0 && width <= maxTextureSize && height <= maxTextureSize);
      } catch (_) {
        return false;
      }
    }

    renderImage(image, params, options = {}) {
      const width = Math.max(1, Math.round(Number(image && (image.naturalWidth || image.width)) || 0));
      const height = Math.max(1, Math.round(Number(image && (image.naturalHeight || image.height)) || 0));
      if (!this.canRender(width, height)) throw new Error("当前 WebGL2 设备无法处理该图像尺寸");
      const gl = this.ensureContext();
      const canvas = this.canvas;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      const position = gl.getAttribLocation(this.program, "aPosition");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const p = params || {};
      const set1 = (name, value) => gl.uniform1f(this.locations[name], Number(value) || 0);
      const set2 = (name, x, y) => gl.uniform2f(this.locations[name], Number(x) || 0, Number(y) || 0);
      gl.uniform1i(this.locations.uSource, 0);
      set2("uResolution", width, height);
      set2("uOrigin", Number(options.originX) || 0, Number(options.originY) || 0);
      [
        "amount", "exposure", "contrast", "saturation", "warmth", "shadowLift", "highlightRollOff", "halation",
        "halationThreshold", "halationRadius", "grain", "grainSize", "grainColor", "vignette", "vignetteMidpoint",
        "vignetteFeather", "dispersion", "dispersionRadius"
      ].forEach((key) => set1(`u${key[0].toUpperCase()}${key.slice(1)}`, key === "amount" && String(p.effectType || "film") === "film"
        ? (Number(p.amount) || 0) * (Number(p.effectAmount) || 0) / 100
        : p[key]));
      set1("uSeed", Math.abs(Math.round(Number(p.seed) || 0)) % 16777216);
      set1("uDispersionHighlightsOnly", p.dispersionHighlightsOnly === true ? 1 : 0);
      const effectIndex = { film: 0, crt: 1, pixelate: 2, wind: 3, shatter: 4 }[String(p.effectType || "film")] ?? 0;
      const radians = Number(p.windDirection || 0) * Math.PI / 180;
      const shatterRadians = Number(p.shatterDirection || 0) * Math.PI / 180;
      set1("uEffectType", effectIndex);
      set1("uEffectEnabled", p.effectEnabled === false ? 0 : 1);
      set1("uEffectAmount", p.effectEnabled === false ? 0 : (Number(p.effectAmount) || 0));
      ["crtStrength", "crtPixelGrid", "crtScanlines", "crtCurvature", "crtConvergence", "pixelBlockSize", "pixelLevels", "pixelDither", "pixelEdgePreserve", "windLength", "windBreakup", "windEdgeProtect", "shatterFragmentSize", "shatterScatter", "shatterCracks"]
        .forEach((key) => set1(`u${key[0].toUpperCase()}${key.slice(1)}`, p[key]));
      set2("uWindDirection", Math.cos(radians), Math.sin(radians));
      set2("uShatterDirection", Math.cos(shatterRadians), Math.sin(shatterRadians));
      set1("uFilmFinish", p.filmFinish === true ? 1 : 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.flush();
      return {
        dataUrl: options.returnDataUrl === false ? "" : canvas.toDataURL("image/png"),
        canvas,
        width,
        height,
        backend: "webgl2"
      };
    }

    reset() {
      if (this.gl && this.program) this.gl.deleteProgram(this.program);
      if (this.gl && this.texture) this.gl.deleteTexture(this.texture);
      if (this.gl && this.buffer) this.gl.deleteBuffer(this.buffer);
      this.canvas = null;
      this.gl = null;
      this.program = null;
      this.texture = null;
      this.buffer = null;
      this.locations = null;
      this.failed = null;
    }
  }

  let renderer = null;
  modules.postFxWebglRenderer = {
    getRenderer() {
      if (!renderer) renderer = new PostFxWebglRenderer();
      return renderer;
    },
    canRender(width, height) {
      return this.getRenderer().canRender(width, height);
    },
    renderImage(image, params, options) {
      return this.getRenderer().renderImage(image, params, options);
    },
    reset() {
      if (renderer) renderer.reset();
      renderer = null;
    }
  };
})(window);
