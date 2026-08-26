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
      uint value = pixel.x * 374761393u;
      value ^= pixel.y * 668265263u;
      value ^= seedValue * 2246822519u;
      value = (value ^ (value >> 13u)) * 1274126177u;
      value ^= value >> 16u;
      return float(value & 16777215u) / 16777215.0;
    }

    float grainNoise(vec2 pixel, float grainSize, float seed) {
      float radius = max(1.0, floor(grainSize + 0.5));
      float center = hashNoise(pixel, seed);
      float cardinal = (
        hashNoise(pixel + vec2(radius, 0.0), seed + 11.0) +
        hashNoise(pixel + vec2(-radius, 0.0), seed + 23.0) +
        hashNoise(pixel + vec2(0.0, radius), seed + 37.0) +
        hashNoise(pixel + vec2(0.0, -radius), seed + 53.0)
      ) * 0.055;
      float diagonal = (
        hashNoise(pixel + vec2(radius, radius), seed + 67.0) +
        hashNoise(pixel + vec2(-radius, radius), seed + 79.0) +
        hashNoise(pixel + vec2(radius, -radius), seed + 97.0) +
        hashNoise(pixel + vec2(-radius, -radius), seed + 113.0)
      ) * 0.03;
      return center * 0.66 + cardinal + diagonal;
    }

    float luminance(vec3 color) {
      return dot(color, vec3(0.2126, 0.7152, 0.0722));
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
      vec3 dispersed = sampleDispersion(vUv, source);
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
      vec3 outputColor = mix(source, graded, uAmount / 100.0);

      if (uHalation > 0.0) {
        float threshold = uHalationThreshold / 100.0;
        float radiusPx = max(1.0, uHalationRadius * min(uResolution.x, uResolution.y) / 1200.0);
        vec3 halo = sampleHalation(vUv, threshold, radiusPx);
        float haloMask = smoothstep(threshold - 0.1, threshold + 0.12, luminance(source));
        float strength = uHalation / 100.0 * uAmount / 100.0 * 0.34 * haloMask;
        outputColor += halo * vec3(1.1, 0.3, 0.08) * strength;
      }

      float grainStrength = uGrain / 100.0 * uAmount / 100.0 * 0.16;
      if (grainStrength > 0.0) {
        vec2 fragmentPoint = vec2(gl_FragCoord.x - 0.5, uResolution.y - gl_FragCoord.y - 0.5) + uOrigin;
        float mono = grainNoise(floor(fragmentPoint), uGrainSize, uSeed) - 0.5;
        float chroma = grainNoise(floor(fragmentPoint) + vec2(17.0, -11.0), uGrainSize, uSeed + 97.0) - 0.5;
        float grainLuma = luminance(outputColor);
        float shadowWeight = 1.0 - smoothstep(0.08, 0.56, grainLuma);
        float highlightWeight = smoothstep(0.60, 0.94, grainLuma);
        float toneWeight = clamp(0.88 + shadowWeight * 0.48 - highlightWeight * 0.52, 0.30, 1.36);
        mono *= grainStrength * toneWeight;
        chroma *= grainStrength * toneWeight;
        float colorMix = uGrainColor / 100.0;
        outputColor += vec3(
          mono * (1.0 - colorMix) + (mono + chroma) * colorMix * 0.45,
          mono * (1.0 - colorMix) + mono * colorMix * 0.25,
          mono * (1.0 - colorMix) + (mono - chroma) * colorMix * 0.45
        );
      }

      float nx = (vUv.x - 0.5) * 2.0;
      float ny = (vUv.y - 0.5) * 2.0;
      float distance = min(1.0, length(vec2(nx, ny)) / 1.4143);
      float vignetteMask = smoothstep(uVignetteMidpoint / 100.0, min(1.0, uVignetteMidpoint / 100.0 + uVignetteFeather / 100.0), distance);
      outputColor *= 1.0 - (uVignette / 100.0 * uAmount / 100.0 * 0.72) * vignetteMask;
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
          "uDispersionRadius", "uDispersionHighlightsOnly", "uSeed"
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
      ].forEach((key) => set1(`u${key[0].toUpperCase()}${key.slice(1)}`, p[key]));
      set1("uSeed", Math.abs(Math.round(Number(p.seed) || 0)) % 16777216);
      set1("uDispersionHighlightsOnly", p.dispersionHighlightsOnly === true ? 1 : 0);
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
