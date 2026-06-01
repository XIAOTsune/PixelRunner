(function initBlendMatchWebglPreviewModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  const VERTEX_SHADER = `#version 300 es
    layout(location = 0) in vec2 aPosition;
    out vec2 vUv;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const MASK_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uSource;
    uniform sampler2D uReference;
    in vec2 vUv;
    out vec4 outColor;
    void main() {
      vec3 source = texture(uSource, vUv).rgb;
      vec3 reference = texture(uReference, vUv).rgb;
      float diff = (abs(source.r - reference.r) + abs(source.g - reference.g) + abs(source.b - reference.b)) / 3.0;
      outColor = vec4(clamp((diff - 0.03137255) / 0.16470588, 0.0, 1.0), 0.0, 0.0, 1.0);
    }
  `;

  const BLUR_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uSource;
    uniform vec2 uTexel;
    uniform vec2 uDirection;
    uniform int uRadius;
    in vec2 vUv;
    out vec4 outColor;
    void main() {
      float sum = 0.0;
      float count = 0.0;
      for (int i = -18; i <= 18; i++) {
        if (abs(i) <= uRadius) {
          sum += texture(uSource, vUv + uDirection * vec2(float(i)) * uTexel).r;
          count += 1.0;
        }
      }
      outColor = vec4(sum / max(count, 1.0), 0.0, 0.0, 1.0);
    }
  `;

  const CORRECT_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uSource;
    uniform sampler2D uReference;
    uniform sampler2D uMask;
    uniform vec2 uTexel;
    uniform float uBrightness;
    uniform float uContrast;
    uniform float uSaturation;
    uniform vec3 uColorBalance;
    uniform float uFeatherMix;
    in vec2 vUv;
    out vec4 outColor;

    float clamp01(float value) {
      return clamp(value, 0.0, 1.0);
    }

    vec3 applyCorrection(vec3 color) {
      color += (vec3(uBrightness) + uColorBalance) / 255.0;
      float contrast = clamp(uContrast, -254.0, 254.0);
      float contrastFactor = (259.0 * (contrast + 255.0)) / max(1.0, 255.0 * (259.0 - contrast));
      color = contrastFactor * (color * 255.0 - 128.0) + 128.0;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      float saturationFactor = 1.0 + uSaturation / 100.0;
      return vec3(
        clamp01((luma + (color.r - luma) * saturationFactor) / 255.0),
        clamp01((luma + (color.g - luma) * saturationFactor) / 255.0),
        clamp01((luma + (color.b - luma) * saturationFactor) / 255.0)
      );
    }

    void main() {
      vec3 source = texture(uSource, vUv).rgb;
      vec3 reference = texture(uReference, vUv).rgb;
      float alpha = texture(uMask, vUv).r;
      vec3 corrected = applyCorrection(source);
      vec3 color = mix(reference, corrected, alpha * uFeatherMix);
      outColor = vec4(color, 1.0);
    }
  `;

  const DISPLAY_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uSource;
    uniform sampler2D uAfter;
    uniform sampler2D uMask;
    uniform sampler2D uBlur;
    uniform vec2 uTexel;
    uniform float uSplit;
    in vec2 vUv;
    out vec4 outColor;

    void main() {
      vec3 source = texture(uSource, vUv).rgb;
      vec3 after = texture(uAfter, vUv).rgb;
      vec3 color = mix(source, after, step(uSplit, vUv.x));

      float blurValue = texture(uBlur, vUv).r;
      if (blurValue > 0.08 && blurValue < 0.92) {
        float feather = min(0.34, 0.08 + sin(blurValue * 3.14159265) * 0.22);
        color = mix(color, vec3(80.0 / 255.0, 226.0 / 255.0, 140.0 / 255.0), feather);
      }

      float mask = texture(uMask, vUv).r;
      float left = texture(uMask, vUv + vec2(-uTexel.x, 0.0)).r;
      float right = texture(uMask, vUv + vec2(uTexel.x, 0.0)).r;
      float top = texture(uMask, vUv + vec2(0.0, -uTexel.y)).r;
      float bottom = texture(uMask, vUv + vec2(0.0, uTexel.y)).r;
      if (mask > 0.18 && (left <= 0.18 || right <= 0.18 || top <= 0.18 || bottom <= 0.18)) {
        color = vec3(80.0 / 255.0, 232.0 / 255.0, 232.0 / 255.0);
      }

      outColor = vec4(color, 1.0);
    }
  `;

  const FULLSCREEN_TRIANGLE = new Float32Array([
    -1, -1,
     3, -1,
    -1,  3
  ]);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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

  function createTexture(gl, width, height) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return texture;
  }

  function createTarget(gl, width, height) {
    const texture = createTexture(gl, width, height);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("WebGL2 framebuffer is incomplete");
    }
    return { width, height, texture, framebuffer };
  }

  function destroyTarget(gl, target) {
    if (!target) return;
    if (target.texture) gl.deleteTexture(target.texture);
    if (target.framebuffer) gl.deleteFramebuffer(target.framebuffer);
  }

  function queryLocations(gl, program, names) {
    const out = {};
    names.forEach((name) => {
      out[name] = gl.getUniformLocation(program, name);
    });
    return out;
  }

  function uploadImageTexture(gl, texture, image) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  class BlendMatchWebglPreviewRenderer {
    constructor() {
      this.canvas = document.createElement("canvas");
      this.canvas.width = 1;
      this.canvas.height = 1;
      this.gl = modules.glowGpuCapabilities && typeof modules.glowGpuCapabilities.getWebgl2Context === "function"
        ? modules.glowGpuCapabilities.getWebgl2Context(this.canvas)
        : null;
      if (!this.gl) {
        throw new Error("WebGL2 is unavailable");
      }
      this.gl.disable(this.gl.DEPTH_TEST);
      this.gl.disable(this.gl.CULL_FACE);
      this.gl.disable(this.gl.BLEND);
      this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, false);
      this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.gl.clearColor(0, 0, 0, 1);
      this.gl.viewport(0, 0, 1, 1);
      this.programs = {
        mask: createProgram(this.gl, MASK_SHADER),
        blur: createProgram(this.gl, BLUR_SHADER),
        correct: createProgram(this.gl, CORRECT_SHADER),
        display: createProgram(this.gl, DISPLAY_SHADER)
      };
      this.locations = {
        mask: queryLocations(this.gl, this.programs.mask, ["uSource", "uReference"]),
        blur: queryLocations(this.gl, this.programs.blur, ["uSource", "uTexel", "uDirection", "uRadius"]),
        correct: queryLocations(this.gl, this.programs.correct, ["uSource", "uReference", "uMask", "uTexel", "uBrightness", "uContrast", "uSaturation", "uColorBalance", "uFeatherMix"]),
        display: queryLocations(this.gl, this.programs.display, ["uSource", "uAfter", "uMask", "uBlur", "uTexel", "uSplit"])
      };
      this.vertexBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, this.gl.STATIC_DRAW);
      this.vao = this.gl.createVertexArray();
      this.gl.bindVertexArray(this.vao);
      this.gl.enableVertexAttribArray(0);
      this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
      this.gl.bindVertexArray(null);

      this.sourceTexture = null;
      this.referenceTexture = null;
      this.maskTarget = null;
      this.blurTargetA = null;
      this.blurTargetB = null;
      this.afterTarget = null;
      this.size = { width: 0, height: 0 };
      this.cacheKey = "";
      this.textureKey = "";
      this.pipelineDirty = true;
      this.lastRenderSummary = null;
    }

    ensureSize(width, height) {
      const safeWidth = Math.max(1, Math.floor(Number(width) || 1));
      const safeHeight = Math.max(1, Math.floor(Number(height) || 1));
      if (this.size.width === safeWidth && this.size.height === safeHeight) return;
      this.size = { width: safeWidth, height: safeHeight };
      this.canvas.width = safeWidth;
      this.canvas.height = safeHeight;
      this.gl.viewport(0, 0, safeWidth, safeHeight);
      destroyTarget(this.gl, this.maskTarget);
      destroyTarget(this.gl, this.blurTargetA);
      destroyTarget(this.gl, this.blurTargetB);
      destroyTarget(this.gl, this.afterTarget);
      this.maskTarget = createTarget(this.gl, safeWidth, safeHeight);
      this.blurTargetA = createTarget(this.gl, safeWidth, safeHeight);
      this.blurTargetB = createTarget(this.gl, safeWidth, safeHeight);
      this.afterTarget = createTarget(this.gl, safeWidth, safeHeight);
      this.pipelineDirty = true;
    }

    uploadImages(sourceImage, referenceImage) {
      if (!this.sourceTexture) {
        this.sourceTexture = this.gl.createTexture();
      }
      if (!this.referenceTexture) {
        this.referenceTexture = this.gl.createTexture();
      }
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
      uploadImageTexture(this.gl, this.sourceTexture, sourceImage);

      this.gl.bindTexture(this.gl.TEXTURE_2D, this.referenceTexture);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
      uploadImageTexture(this.gl, this.referenceTexture, referenceImage);
    }

    applyUniforms(programKey, bindings) {
      const gl = this.gl;
      gl.useProgram(this.programs[programKey]);
      const locations = this.locations[programKey];
      if (bindings.uSourceTexture !== undefined) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, bindings.uSourceTexture);
      }
      if (bindings.uReferenceTexture !== undefined) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, bindings.uReferenceTexture);
      }
      if (bindings.uMaskTexture !== undefined) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, bindings.uMaskTexture);
      }
      if (bindings.uBlurTexture !== undefined) {
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, bindings.uBlurTexture);
      }
      if (bindings.uAfterTexture !== undefined) {
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, bindings.uAfterTexture);
      }
      if (locations.uSource) gl.uniform1i(locations.uSource, 0);
      if (locations.uReference) gl.uniform1i(locations.uReference, 1);
      if (locations.uMask) gl.uniform1i(locations.uMask, 2);
      if (locations.uBlur) gl.uniform1i(locations.uBlur, 3);
      if (locations.uAfter) gl.uniform1i(locations.uAfter, 4);
      if (locations.uTexel && bindings.texel) gl.uniform2f(locations.uTexel, bindings.texel[0], bindings.texel[1]);
      if (locations.uDirection && bindings.direction) gl.uniform2f(locations.uDirection, bindings.direction[0], bindings.direction[1]);
      if (locations.uRadius) gl.uniform1i(locations.uRadius, Math.max(1, Math.min(18, Math.round(bindings.radius || 1))));
      if (locations.uBrightness) gl.uniform1f(locations.uBrightness, Number(bindings.brightness) || 0);
      if (locations.uContrast) gl.uniform1f(locations.uContrast, Number(bindings.contrast) || 0);
      if (locations.uSaturation) gl.uniform1f(locations.uSaturation, Number(bindings.saturation) || 0);
      if (locations.uColorBalance) {
        const balance = bindings.colorBalance || [0, 0, 0];
        gl.uniform3f(locations.uColorBalance, Number(balance[0]) || 0, Number(balance[1]) || 0, Number(balance[2]) || 0);
      }
      if (locations.uFeatherMix) gl.uniform1f(locations.uFeatherMix, clamp(Number(bindings.featherMix) || 1, 0, 1));
      if (locations.uSplit) gl.uniform1f(locations.uSplit, clamp(Number(bindings.split) || 0.5, 0.0, 1.0));
    }

    renderMask() {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.maskTarget.framebuffer);
      this.gl.viewport(0, 0, this.size.width, this.size.height);
      this.gl.useProgram(this.programs.mask);
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
      this.gl.activeTexture(this.gl.TEXTURE1);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.referenceTexture);
      this.gl.uniform1i(this.locations.mask.uSource, 0);
      this.gl.uniform1i(this.locations.mask.uReference, 1);
      this.gl.bindVertexArray(this.vao);
      this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
      this.gl.bindVertexArray(null);
    }

    renderBlur(radius) {
      const safeRadius = Math.max(1, Math.min(18, Math.round(Number(radius) || 1)));
      const texelX = 1 / Math.max(1, this.size.width);
      const texelY = 1 / Math.max(1, this.size.height);
      const gl = this.gl;
      const locations = this.locations.blur;

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurTargetA.framebuffer);
      gl.viewport(0, 0, this.size.width, this.size.height);
      gl.useProgram(this.programs.blur);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTarget.texture);
      gl.uniform1i(locations.uSource, 0);
      gl.uniform2f(locations.uTexel, texelX, texelY);
      gl.uniform2f(locations.uDirection, 1.0, 0.0);
      gl.uniform1i(locations.uRadius, safeRadius);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurTargetB.framebuffer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.blurTargetA.texture);
      gl.uniform1i(locations.uSource, 0);
      gl.uniform2f(locations.uDirection, 0.0, 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }

    renderAfter(bindings) {
      const gl = this.gl;
      const locations = this.locations.correct;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.afterTarget.framebuffer);
      gl.viewport(0, 0, this.size.width, this.size.height);
      gl.useProgram(this.programs.correct);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.referenceTexture);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.blurTargetB.texture);
      gl.uniform1i(locations.uSource, 0);
      gl.uniform1i(locations.uReference, 1);
      gl.uniform1i(locations.uMask, 2);
      gl.uniform2f(locations.uTexel, 1 / Math.max(1, this.size.width), 1 / Math.max(1, this.size.height));
      gl.uniform1f(locations.uBrightness, Number(bindings.brightness) || 0);
      gl.uniform1f(locations.uContrast, Number(bindings.contrast) || 0);
      gl.uniform1f(locations.uSaturation, Number(bindings.saturation) || 0);
      const balance = bindings.colorBalance || [0, 0, 0];
      gl.uniform3f(locations.uColorBalance, Number(balance[0]) || 0, Number(balance[1]) || 0, Number(balance[2]) || 0);
      gl.uniform1f(locations.uFeatherMix, clamp(Number(bindings.featherMix) || 1, 0, 1));
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }

    renderDisplay(split) {
      const gl = this.gl;
      const locations = this.locations.display;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.size.width, this.size.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.programs.display);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.afterTarget.texture);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTarget.texture);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.blurTargetB.texture);
      gl.uniform1i(locations.uSource, 0);
      gl.uniform1i(locations.uAfter, 1);
      gl.uniform1i(locations.uMask, 2);
      gl.uniform1i(locations.uBlur, 3);
      gl.uniform2f(locations.uTexel, 1 / Math.max(1, this.size.width), 1 / Math.max(1, this.size.height));
      gl.uniform1f(locations.uSplit, clamp(Number(split) || 0.5, 0, 1));
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }

    configure(config = {}) {
      const width = Math.max(1, Math.floor(Number(config.width) || 1));
      const height = Math.max(1, Math.floor(Number(config.height) || 1));
      const sourceImage = config.sourceImage || null;
      const referenceImage = config.referenceImage || null;
      if (!sourceImage || !referenceImage) {
        throw new Error("BlendMatch WebGL preview is missing images");
      }
      this.ensureSize(width, height);
      const textureKey = [
        String(sourceImage.src || sourceImage.currentSrc || ""),
        String(referenceImage.src || referenceImage.currentSrc || "")
      ].join("|");
      const nextKey = [
        width,
        height,
        textureKey,
        Number(config.brightness) || 0,
        Number(config.contrast) || 0,
        Number(config.saturation) || 0,
        ...(Array.isArray(config.colorBalance) ? config.colorBalance : [0, 0, 0]),
        Number(config.featherRadius) || 0
      ].join("|");
      if (this.textureKey !== textureKey) {
        this.uploadImages(sourceImage, referenceImage);
        this.textureKey = textureKey;
      }
      this.pipelineDirty = this.pipelineDirty || this.cacheKey !== nextKey;
      this.cacheKey = nextKey;
      this.pendingConfig = {
        brightness: Number(config.brightness) || 0,
        contrast: Number(config.contrast) || 0,
        saturation: Number(config.saturation) || 0,
        colorBalance: Array.isArray(config.colorBalance) ? config.colorBalance.slice(0, 3) : [0, 0, 0],
        featherMix: Number(config.featherMix) || 1,
        featherRadius: Number(config.featherRadius) || 1
      };
      this.pendingSplit = clamp(Number(config.split) || 0.5, 0, 1);
    }

    render() {
      if (!this.sourceTexture || !this.referenceTexture) {
        throw new Error("BlendMatch WebGL preview is not configured");
      }
      if (this.pipelineDirty) {
        this.renderMask();
        this.renderBlur(this.pendingConfig.featherRadius);
        this.renderAfter(this.pendingConfig);
        this.pipelineDirty = false;
      }
      this.renderDisplay(this.pendingSplit);
      this.lastRenderSummary = {
        backend: "webgl2",
        width: this.size.width,
        height: this.size.height
      };
      return this.lastRenderSummary;
    }

    presentTo(targetCanvas) {
      if (!targetCanvas || typeof targetCanvas.getContext !== "function") return;
      const ctx = targetCanvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D is unavailable for BlendMatch preview presentation");
      ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      ctx.drawImage(this.canvas, 0, 0, targetCanvas.width, targetCanvas.height);
    }

    dispose() {
      const gl = this.gl;
      destroyTarget(gl, this.maskTarget);
      destroyTarget(gl, this.blurTargetA);
      destroyTarget(gl, this.blurTargetB);
      destroyTarget(gl, this.afterTarget);
      this.maskTarget = null;
      this.blurTargetA = null;
      this.blurTargetB = null;
      this.afterTarget = null;
      if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
      if (this.referenceTexture) gl.deleteTexture(this.referenceTexture);
      if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
      if (this.vao) gl.deleteVertexArray(this.vao);
      Object.values(this.programs).forEach((program) => gl.deleteProgram(program));
      this.sourceTexture = null;
      this.referenceTexture = null;
    }
  }

  modules.blendMatchWebglPreview = {
    createRenderer() {
      return new BlendMatchWebglPreviewRenderer();
    }
  };
})(window);
