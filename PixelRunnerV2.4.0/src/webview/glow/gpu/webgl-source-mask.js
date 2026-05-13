(function initGlowWebglSourceMaskModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  const VERTEX_SHADER = `#version 300 es
    in vec2 aPosition;
    out vec2 vUv;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const METRICS_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uImage;
    in vec2 vUv;
    out vec4 outColor;
    float srgbToLinear(float value) {
      return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4);
    }
    vec3 srgbToLinear(vec3 color) {
      return vec3(srgbToLinear(color.r), srgbToLinear(color.g), srgbToLinear(color.b));
    }
    void main() {
      vec3 c = srgbToLinear(texture(uImage, vUv).rgb);
      float maxChannel = max(max(c.r, c.g), c.b);
      float minChannel = min(min(c.r, c.g), c.b);
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float sat = maxChannel <= 0.0 ? 0.0 : (maxChannel - minChannel) / maxChannel;
      outColor = vec4(luma, maxChannel, minChannel, sat);
    }
  `;

  const BLUR_H_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uMetrics;
    uniform vec2 uTexel;
    uniform int uRadius;
    in vec2 vUv;
    out vec4 outColor;
    void main() {
      float sum = 0.0;
      for (int i = -24; i <= 24; i++) {
        if (abs(i) <= uRadius) {
          sum += texture(uMetrics, vUv + vec2(float(i), 0.0) * uTexel).r;
        }
      }
      float size = float(uRadius * 2 + 1);
      outColor = vec4(sum / max(size, 1.0), 0.0, 0.0, 1.0);
    }
  `;

  const BLUR_V_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uHorizontal;
    uniform vec2 uTexel;
    uniform int uRadius;
    in vec2 vUv;
    out vec4 outColor;
    void main() {
      float sum = 0.0;
      for (int i = -24; i <= 24; i++) {
        if (abs(i) <= uRadius) {
          sum += texture(uHorizontal, vUv + vec2(0.0, float(i)) * uTexel).r;
        }
      }
      float size = float(uRadius * 2 + 1);
      outColor = vec4(sum / max(size, 1.0), 0.0, 0.0, 1.0);
    }
  `;

  const SOURCE_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uImage;
    uniform sampler2D uMetrics;
    uniform sampler2D uLocalMean;
    uniform float uThresholdLow;
    uniform float uThresholdHigh;
    uniform float uThresholdKnee;
    uniform float uContrastLow;
    uniform float uContrastHigh;
    uniform float uSpecularLow;
    uniform float uSpecularHigh;
    uniform float uWhiteProtect;
    uniform float uSkinProtect;
    uniform float uDarkProtect;
    uniform float uChromaBoost;
    uniform float uLowEnergyCutoff;
    in vec2 vUv;
    layout(location = 0) out vec4 outSource;
    layout(location = 1) out vec4 outMasks;

    float saturate(float v) {
      return clamp(v, 0.0, 1.0);
    }

    float smooth01(float edge0, float edge1, float value) {
      float t = saturate((value - edge0) / max(0.0001, edge1 - edge0));
      return t * t * (3.0 - 2.0 * t);
    }

    float softThresholdMask(float value, float threshold, float knee) {
      float safeKnee = max(0.0001, knee);
      float soft = clamp(value - threshold + safeKnee, 0.0, safeKnee * 2.0);
      float curved = (soft * soft) / (safeKnee * 4.0);
      return saturate(max(curved, value - threshold) / max(value, 0.0001));
    }

    float srgbToLinear(float value) {
      return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4);
    }

    vec3 srgbToLinear(vec3 color) {
      return vec3(srgbToLinear(color.r), srgbToLinear(color.g), srgbToLinear(color.b));
    }

    float isSkinHueFast(vec3 c, float maxChannel, float minChannel) {
      float delta = maxChannel - minChannel;
      if (delta <= 0.0001 || maxChannel != c.r) return 0.0;
      float hue = ((c.g - c.b) / delta) * 60.0;
      return (hue >= 5.0 && hue <= 52.0) ? 1.0 : 0.0;
    }

    void main() {
      vec3 cSrgb = texture(uImage, vUv).rgb;
      vec3 c = srgbToLinear(cSrgb);
      vec4 metrics = texture(uMetrics, vUv);
      float lum = metrics.r;
      float maxChannel = metrics.g;
      float minChannel = metrics.b;
      float sat = metrics.a;
      float localMean = texture(uLocalMean, vUv).r;
      float contrast = max(0.0, lum - localMean);
      float specular = max(0.0, maxChannel - localMean);
      float brightness = max(lum * 0.45 + maxChannel * 0.55, maxChannel * 0.86);

      float thresholdGate = softThresholdMask(brightness, uThresholdHigh, uThresholdKnee);
      float secondaryThresholdGate = smooth01(uThresholdLow, uThresholdHigh + uThresholdKnee * 0.5, brightness);
      float brightPass = thresholdGate;
      float contrastScore = smooth01(uContrastLow, uContrastHigh, contrast);
      float specularScore = smooth01(uSpecularLow, uSpecularHigh, specular);
      float brightEnergy = pow(saturate(brightPass), 1.16);
      float specularPass =
        pow(specularScore, 1.16) *
        secondaryThresholdGate *
        smooth01(0.055, 0.22, specular);
      float rimPass = contrastScore * thresholdGate * smooth01(0.82, 0.98, brightness);
      float highLightness = smooth01(0.7, 0.95, lum);
      float veryHighLightness = smooth01(0.84, 0.985, lum);
      float clothContrast = 1.0 - smooth01(0.028, 0.16, contrast);
      float lowContrast = 1.0 - smooth01(0.01, 0.11, contrast);
      float lowSat = 1.0 - smooth01(0.12, 0.36, sat);
      float whiteFlat = highLightness * clothContrast * lowSat * (0.9 + veryHighLightness * 0.58);
      float srgbMax = max(max(cSrgb.r, cSrgb.g), cSrgb.b);
      float srgbMin = min(min(cSrgb.r, cSrgb.g), cSrgb.b);
      float skinHue = isSkinHueFast(cSrgb, srgbMax, srgbMin);
      float skinColor =
        skinHue *
        smooth01(0.16, 0.36, sat) *
        (1.0 - smooth01(0.78, 0.96, sat)) *
        smooth01(0.38, 0.74, lum) *
        (1.0 - smooth01(0.9, 1.0, lum));
      float dark = 1.0 - smooth01(0.18, 0.42, brightness);
      float midtoneReject = 1.0 - smooth01(0.48, 0.72, brightness);
      float protectionBase = saturate(
        whiteFlat * uWhiteProtect +
        skinColor * uSkinProtect * 0.9 +
        dark * uDarkProtect +
        midtoneReject * 0.62
      );
      float nearClip = smooth01(0.975, 1.0, maxChannel);
      float clippingDetail = saturate(
        smooth01(0.12, 0.34, specular) * 0.72 +
        contrastScore * thresholdGate * 0.18 +
        sat * 0.1
      );
      float nearClipException = nearClip * clippingDetail * thresholdGate;
      float protection = saturate(protectionBase * (1.0 - nearClipException * 0.42));
      float colorReflection = smooth01(0.1, 0.48, sat) * smooth01(0.52, 0.92, brightness);
      float emissionEnergy = brightEnergy * (1.2 + colorReflection * 0.18) + specularPass * 0.48 + rimPass * 0.028;
      float neutralClothReject = whiteFlat * (1.0 - specularScore * 0.42) * (1.0 - nearClipException * 0.35) * (1.0 - colorReflection * 0.32);
      emissionEnergy *= 1.0 - protection * 0.86;
      emissionEnergy *= 1.0 - neutralClothReject * 0.82;
      emissionEnergy *= smooth01(uLowEnergyCutoff * 0.62, uLowEnergyCutoff * 2.6, emissionEnergy);
      emissionEnergy = saturate(pow(emissionEnergy, 1.04) * 1.18);
      float neutralHighlight = brightPass * (1.0 - sat) * smooth01(0.82, 1.0, maxChannel);
      float warmColorHint = smooth01(0.018, 0.16, max(abs(c.r - c.g), abs(c.g - c.b)));
      float chromaKeep = clamp(0.28 + sat * 0.88 + warmColorHint * 0.24 + colorReflection * 0.16 + uChromaBoost * 0.25 - neutralHighlight * 0.1, 0.14, 0.95);
      vec3 emissionColor = mix(vec3(brightness), c, chromaKeep);
      outSource = vec4(emissionColor * emissionEnergy, 1.0);
      outMasks = vec4(lum, protection, dark, emissionEnergy);
    }
  `;

  const FULLSCREEN_TRIANGLE = new Float32Array([
    -1, -1,
     3, -1,
    -1,  3
  ]);

  function createLayer(width, height) {
    return {
      width,
      height,
      r: new Float32Array(width * height),
      g: new Float32Array(width * height),
      b: new Float32Array(width * height)
    };
  }

  function blurFloatHorizontal(src, width, height, radius) {
    const out = new Float32Array(src.length);
    const size = radius * 2 + 1;
    const rightEdgeOffset = width - 1;
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const x = offset < 0 ? 0 : (offset < width ? offset : rightEdgeOffset);
        sum += src[row + x];
      }
      for (let x = 0; x < width; x += 1) {
        out[row + x] = sum / size;
        const removeX = x > radius ? x - radius : 0;
        const addCandidate = x + radius + 1;
        const addX = addCandidate < width ? addCandidate : rightEdgeOffset;
        sum += src[row + addX] - src[row + removeX];
      }
    }
    return out;
  }

  function blurFloat(src, width, height, radius) {
    const r = Math.max(1, Math.floor(radius));
    const horizontal = blurFloatHorizontal(src, width, height, r);
    const out = new Float32Array(src.length);
    const size = r * 2 + 1;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -r; offset <= r; offset += 1) {
        const y = offset < 0 ? 0 : (offset < height ? offset : height - 1);
        sum += horizontal[y * width + x];
      }
      for (let y = 0; y < height; y += 1) {
        out[y * width + x] = sum / size;
        const removeY = y > r ? y - r : 0;
        const addCandidate = y + r + 1;
        const addY = addCandidate < height ? addCandidate : height - 1;
        sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
      }
    }
    return out;
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Unknown shader compile error";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl, fragmentSource) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Unknown program link error";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function createTexture(gl, width, height, data = null, format = null) {
    const textureFormat = format || {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE
    };
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, textureFormat.internalFormat, width, height, 0, textureFormat.format, textureFormat.type, data);
    return texture;
  }

  function createTarget(gl, width, height, attachmentCount = 1, formats = null) {
    const framebuffer = gl.createFramebuffer();
    const textures = [];
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    for (let index = 0; index < attachmentCount; index += 1) {
      const texture = createTexture(gl, width, height, null, Array.isArray(formats) ? formats[index] : formats);
      textures.push(texture);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + index, gl.TEXTURE_2D, texture, 0);
    }
    gl.drawBuffers(textures.map((_, index) => gl.COLOR_ATTACHMENT0 + index));
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("WebGL2 source mask framebuffer is incomplete");
    }
    return { width, height, framebuffer, textures };
  }

  function imageDataToRgba8(imageData) {
    return new Uint8Array(imageData.data.buffer.slice(0));
  }

  class WebglSourceMaskBackend {
    constructor() {
      this.canvas = document.createElement("canvas");
      this.gl = modules.glowGpuCapabilities.getWebgl2Context(this.canvas);
      if (!this.gl) throw new Error("WebGL2 is unavailable");
      this.programs = {
        metrics: createProgram(this.gl, METRICS_SHADER),
        blurH: createProgram(this.gl, BLUR_H_SHADER),
        blurV: createProgram(this.gl, BLUR_V_SHADER),
        source: createProgram(this.gl, SOURCE_SHADER)
      };
      this.floatTargets = !!(
        this.gl.getExtension("EXT_color_buffer_float") &&
        this.gl.getExtension("OES_texture_float_linear")
      );
      this.targetFormat = this.floatTargets
        ? {
            internalFormat: this.gl.RGBA32F,
            format: this.gl.RGBA,
            type: this.gl.FLOAT
          }
        : null;
      this.vertexBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, this.gl.STATIC_DRAW);
    }

    bindProgram(program) {
      const gl = this.gl;
      gl.useProgram(program);
      const positionLocation = gl.getAttribLocation(program, "aPosition");
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    }

    bindTexture(program, name, texture, unit) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
    }

    renderTo(target, program) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    renderSingleTexture(program, sourceTexture, sourceUniform, width, height, configure = null) {
      const gl = this.gl;
      const target = createTarget(gl, width, height, 1, this.targetFormat);
      this.bindProgram(program);
      this.bindTexture(program, sourceUniform, sourceTexture, 0);
      if (configure) configure(program);
      this.renderTo(target, program);
      return target;
    }

    buildSourceMask(imageData, params) {
      const gl = this.gl;
      const { width, height } = imageData;
      const sourceParams = params.source;
      if (!this.floatTargets) {
        throw new Error("WebGL2 glow source mask requires float render targets");
      }
      const radius = Math.max(1, Math.min(24, Math.floor(sourceParams.localRadius)));
      this.canvas.width = width;
      this.canvas.height = height;
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);

      const imageTexture = createTexture(gl, width, height, imageDataToRgba8(imageData));
      const targets = [];
      try {
        const metricsTarget = this.renderSingleTexture(this.programs.metrics, imageTexture, "uImage", width, height);
        targets.push(metricsTarget);

        const horizontalTarget = this.renderSingleTexture(
          this.programs.blurH,
          metricsTarget.textures[0],
          "uMetrics",
          width,
          height,
          (program) => {
            gl.uniform2f(gl.getUniformLocation(program, "uTexel"), 1 / width, 1 / height);
            gl.uniform1i(gl.getUniformLocation(program, "uRadius"), radius);
          }
        );
        targets.push(horizontalTarget);

        const localMeanTarget = this.renderSingleTexture(
          this.programs.blurV,
          horizontalTarget.textures[0],
          "uHorizontal",
          width,
          height,
          (program) => {
            gl.uniform2f(gl.getUniformLocation(program, "uTexel"), 1 / width, 1 / height);
            gl.uniform1i(gl.getUniformLocation(program, "uRadius"), radius);
          }
        );
        targets.push(localMeanTarget);

        const sourceTarget = createTarget(gl, width, height, 2, [this.targetFormat, this.targetFormat]);
        targets.push(sourceTarget);
        const program = this.programs.source;
        this.bindProgram(program);
        this.bindTexture(program, "uImage", imageTexture, 0);
        this.bindTexture(program, "uMetrics", metricsTarget.textures[0], 1);
        this.bindTexture(program, "uLocalMean", localMeanTarget.textures[0], 2);
        gl.uniform1f(gl.getUniformLocation(program, "uThresholdLow"), sourceParams.thresholdLow);
        gl.uniform1f(gl.getUniformLocation(program, "uThresholdHigh"), sourceParams.thresholdHigh);
        gl.uniform1f(gl.getUniformLocation(program, "uThresholdKnee"), sourceParams.thresholdKnee);
        gl.uniform1f(gl.getUniformLocation(program, "uContrastLow"), sourceParams.contrastLow);
        gl.uniform1f(gl.getUniformLocation(program, "uContrastHigh"), sourceParams.contrastHigh);
        gl.uniform1f(gl.getUniformLocation(program, "uSpecularLow"), sourceParams.specularLow);
        gl.uniform1f(gl.getUniformLocation(program, "uSpecularHigh"), sourceParams.specularHigh);
        gl.uniform1f(gl.getUniformLocation(program, "uWhiteProtect"), sourceParams.whiteProtect);
        gl.uniform1f(gl.getUniformLocation(program, "uSkinProtect"), sourceParams.skinProtect);
        gl.uniform1f(gl.getUniformLocation(program, "uDarkProtect"), sourceParams.darkProtect);
        gl.uniform1f(gl.getUniformLocation(program, "uChromaBoost"), sourceParams.chromaBoost);
        gl.uniform1f(gl.getUniformLocation(program, "uLowEnergyCutoff"), sourceParams.lowEnergyCutoff || 0.046);
        this.renderTo(sourceTarget, program);

        const sourcePixels = new Float32Array(width * height * 4);
        const maskPixels = new Float32Array(width * height * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, sourceTarget.framebuffer);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, sourcePixels);
        gl.readBuffer(gl.COLOR_ATTACHMENT1);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, maskPixels);

        const total = width * height;
        const sourceLayer = createLayer(width, height);
        const luma = new Float32Array(total);
        const localContrast = new Float32Array(total);
        const lumaMask = new Float32Array(total);
        const contrastMask = new Float32Array(total);
        const whiteFlatMask = new Float32Array(total);
        const skinLikeMask = new Float32Array(total);
        const darkProtect = new Float32Array(total);
        const protectMask = new Float32Array(total);
        const sourceMask = new Float32Array(total);
        for (let pixel = 0, index = 0; pixel < total; pixel += 1, index += 4) {
          sourceLayer.r[pixel] = Math.max(0, sourcePixels[index]);
          sourceLayer.g[pixel] = Math.max(0, sourcePixels[index + 1]);
          sourceLayer.b[pixel] = Math.max(0, sourcePixels[index + 2]);
          luma[pixel] = Math.min(1, Math.max(0, maskPixels[index]));
          protectMask[pixel] = Math.min(1, Math.max(0, maskPixels[index + 1]));
          darkProtect[pixel] = Math.min(1, Math.max(0, maskPixels[index + 2]));
          sourceMask[pixel] = Math.min(1, Math.max(0, maskPixels[index + 3]));
        }
        const sourceFeatherRadius = Math.max(1, Math.floor(Number(sourceParams.sourceFeatherRadius) || 1));
        const haloMaskRadius = Math.max(sourceFeatherRadius + 1, Math.floor(Number(sourceParams.haloMaskRadius) || 8));
        const featheredSourceMask = blurFloat(sourceMask, width, height, sourceFeatherRadius);
        const haloMask = blurFloat(featheredSourceMask, width, height, haloMaskRadius);

        return {
          width,
          height,
          sourceLayer,
          masks: {
            luma,
            localContrast,
            lumaMask,
            contrastMask,
            whiteFlatMask,
            skinLikeMask,
            darkProtect,
            protectMask,
            sourceMask: featheredSourceMask,
            haloMask
          },
          debugImages: null,
          backend: "webgl2"
        };
      } finally {
        gl.deleteTexture(imageTexture);
        for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
          const target = targets[targetIndex];
          for (let textureIndex = 0; textureIndex < target.textures.length; textureIndex += 1) {
            gl.deleteTexture(target.textures[textureIndex]);
          }
          gl.deleteFramebuffer(target.framebuffer);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    }
  }

  let backend = null;

  function getBackend() {
    if (!modules.glowGpuCapabilities || !modules.glowGpuCapabilities.canUseWebgl2()) {
      throw new Error("WebGL2 source mask backend is unavailable");
    }
    if (!backend) backend = new WebglSourceMaskBackend();
    return backend;
  }

  function buildSourceMask(imageData, params) {
    if (!imageData || !imageData.width || !imageData.height) {
      throw new Error("Glow source image is invalid");
    }
    if (!modules.glowGpuCapabilities.canUseWebgl2(imageData.width, imageData.height)) {
      throw new Error("Image exceeds WebGL2 texture limits");
    }
    return getBackend().buildSourceMask(imageData, params);
  }

  function reset() {
    backend = null;
  }

  modules.glowWebglSourceMask = {
    buildSourceMask,
    reset
  };
})(window);
