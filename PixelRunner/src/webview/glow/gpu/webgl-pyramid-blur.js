(function initGlowWebglPyramidBlurModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  const VERTEX_SHADER = `#version 300 es
    in vec2 aPosition;
    out vec2 vUv;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const DOWNSAMPLE_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uSource;
    uniform vec2 uTexel;
    in vec2 vUv;
    out vec4 outColor;
    void main() {
      vec3 color = texture(uSource, vUv + vec2(-2.0, -2.0) * uTexel).rgb * 0.03125;
      color += texture(uSource, vUv + vec2( 0.0, -2.0) * uTexel).rgb * 0.0625;
      color += texture(uSource, vUv + vec2( 2.0, -2.0) * uTexel).rgb * 0.03125;
      color += texture(uSource, vUv + vec2(-2.0,  0.0) * uTexel).rgb * 0.0625;
      color += texture(uSource, vUv).rgb * 0.125;
      color += texture(uSource, vUv + vec2( 2.0,  0.0) * uTexel).rgb * 0.0625;
      color += texture(uSource, vUv + vec2(-2.0,  2.0) * uTexel).rgb * 0.03125;
      color += texture(uSource, vUv + vec2( 0.0,  2.0) * uTexel).rgb * 0.0625;
      color += texture(uSource, vUv + vec2( 2.0,  2.0) * uTexel).rgb * 0.03125;
      color += texture(uSource, vUv + vec2(-1.0, -1.0) * uTexel).rgb * 0.125;
      color += texture(uSource, vUv + vec2( 1.0, -1.0) * uTexel).rgb * 0.125;
      color += texture(uSource, vUv + vec2(-1.0,  1.0) * uTexel).rgb * 0.125;
      color += texture(uSource, vUv + vec2( 1.0,  1.0) * uTexel).rgb * 0.125;
      outColor = vec4(color, 1.0);
    }
  `;

  const KAWASE_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uSource;
    uniform vec2 uTexel;
    uniform float uOffset;
    in vec2 vUv;
    out vec4 outColor;
    void main() {
      vec2 offset = uTexel * uOffset;
      vec3 color =
        texture(uSource, vUv + vec2(-offset.x, -offset.y)).rgb +
        texture(uSource, vUv + vec2( offset.x, -offset.y)).rgb +
        texture(uSource, vUv + vec2(-offset.x,  offset.y)).rgb +
        texture(uSource, vUv + vec2( offset.x,  offset.y)).rgb +
        texture(uSource, vUv).rgb * 2.0;
      outColor = vec4(color / 6.0, 1.0);
    }
  `;

  const SCALE_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uSource;
    uniform float uWeight;
    in vec2 vUv;
    out vec4 outColor;
    void main() {
      outColor = vec4(texture(uSource, vUv).rgb * uWeight, 1.0);
    }
  `;

  const UPSAMPLE_ADD_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uBase;
    uniform sampler2D uAdd;
    uniform vec2 uBaseTexel;
    uniform float uWeight;
    in vec2 vUv;
    out vec4 outColor;
    void main() {
      vec3 base = texture(uBase, vUv + vec2(-1.0, -1.0) * uBaseTexel).rgb;
      base += texture(uBase, vUv + vec2( 0.0, -1.0) * uBaseTexel).rgb * 2.0;
      base += texture(uBase, vUv + vec2( 1.0, -1.0) * uBaseTexel).rgb;
      base += texture(uBase, vUv + vec2(-1.0,  0.0) * uBaseTexel).rgb * 2.0;
      base += texture(uBase, vUv).rgb * 4.0;
      base += texture(uBase, vUv + vec2( 1.0,  0.0) * uBaseTexel).rgb * 2.0;
      base += texture(uBase, vUv + vec2(-1.0,  1.0) * uBaseTexel).rgb;
      base += texture(uBase, vUv + vec2( 0.0,  1.0) * uBaseTexel).rgb * 2.0;
      base += texture(uBase, vUv + vec2( 1.0,  1.0) * uBaseTexel).rgb;
      outColor = vec4(base * 0.0625 + texture(uAdd, vUv).rgb * uWeight, 1.0);
    }
  `;

  const FINAL_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uCombined;
    uniform sampler2D uSource;
    uniform float uPyramidWeight;
    uniform float uOpticsMode;
    uniform float uOpticsStrength;
    uniform float uOpticsLength;
    uniform float uOpticsSharpness;
    uniform float uOpticsCoreMix;
    uniform float uOpticsDiagonalMix;
    uniform float uOpticsVerticalTightness;
    uniform float uOpticsStarCount;
    uniform float uOpticsRotation;
    uniform vec2 uTexel;
    in vec2 vUv;
    out vec4 outColor;

    mat2 rotation2d(float angle) {
      float s = sin(angle);
      float c = cos(angle);
      return mat2(c, -s, s, c);
    }

    vec3 samplePair(vec2 direction, float distance, float weight) {
      vec2 offset = direction * distance * uTexel;
      return (texture(uCombined, vUv + offset).rgb + texture(uCombined, vUv - offset).rgb) * weight;
    }

    vec3 opticalShape(vec3 base) {
      if (uOpticsStrength <= 0.0001 || uOpticsLength <= 0.5 || uOpticsMode < 0.5) return base;
      float sourceEnergy = max(max(texture(uSource, vUv).r, texture(uSource, vUv).g), texture(uSource, vUv).b);
      float localGate = pow(clamp(sourceEnergy * 1.35, 0.0, 1.0), 0.62);
      vec3 accum = base * uOpticsCoreMix;
      float totalWeight = uOpticsCoreMix;
      float steps = uOpticsMode > 1.5 ? 15.0 : 11.0;
      mat2 rot = rotation2d(radians(uOpticsRotation));

      for (int i = 1; i <= 15; i += 1) {
        float stepIndex = float(i);
        if (stepIndex > steps) break;
        float t = stepIndex / steps;
        float distance = t * uOpticsLength;
        float falloff = pow(max(0.0, 1.0 - t * 0.86), uOpticsSharpness) * (uOpticsMode > 1.5 ? 0.74 : 0.58);
        if (falloff <= 0.0001) continue;

        if (uOpticsMode > 1.5) {
          accum += samplePair(rot * vec2(1.0, 0.0), distance, falloff);
          totalWeight += falloff * 2.0;
          accum += samplePair(rot * vec2(0.0, 1.0), distance * 0.12, falloff * 0.08 * uOpticsVerticalTightness);
          totalWeight += falloff * 0.16 * uOpticsVerticalTightness;
        } else {
          float rays = clamp(floor(uOpticsStarCount + 0.5), 4.0, 12.0);
          for (int ray = 0; ray < 12; ray += 1) {
            float rayIndex = float(ray);
            if (rayIndex >= rays) break;
            float angle = 6.28318530718 * rayIndex / rays;
            vec2 direction = rot * vec2(cos(angle), sin(angle));
            float axisWeight = ray == 0 ? 1.0 : mix(0.48, 0.68, abs(cos(angle)));
            accum += samplePair(direction, distance * mix(0.86, 1.0, axisWeight), falloff * axisWeight);
            totalWeight += falloff * axisWeight * 2.0;
          }
        }
      }

      vec3 shaped = accum / max(0.0001, totalWeight);
      float mixAmount = clamp(uOpticsStrength * (0.45 + localGate * 0.55), 0.0, 0.92);
      float sparkle = uOpticsMode < 1.5 ? 1.0 + localGate * uOpticsStrength * 0.22 : 1.0;
      return mix(base, shaped * sparkle, mixAmount);
    }

    void main() {
      vec3 color = opticalShape(texture(uCombined, vUv).rgb) * uPyramidWeight;
      outColor = vec4(color, 1.0);
    }
  `;

  const FULLSCREEN_TRIANGLE = new Float32Array([
    -1, -1,
     3, -1,
    -1,  3
  ]);

  function clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }

  function createLayer(width, height) {
    return {
      width,
      height,
      r: new Float32Array(width * height),
      g: new Float32Array(width * height),
      b: new Float32Array(width * height)
    };
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

  function createTarget(gl, width, height, format = null) {
    const texture = createTexture(gl, width, height, null, format);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("WebGL2 framebuffer is incomplete");
    }
    return { width, height, texture, framebuffer };
  }

  function sourceLayerToRgba8(layer) {
    const count = layer.width * layer.height;
    const data = new Uint8Array(count * 4);
    for (let pixel = 0, index = 0; pixel < count; pixel += 1, index += 4) {
      data[index] = Math.round(clamp01(layer.r[pixel]) * 255);
      data[index + 1] = Math.round(clamp01(layer.g[pixel]) * 255);
      data[index + 2] = Math.round(clamp01(layer.b[pixel]) * 255);
      data[index + 3] = 255;
    }
    return data;
  }

  function sourceLayerToFloat32(layer) {
    const count = layer.width * layer.height;
    const data = new Float32Array(count * 4);
    for (let pixel = 0, index = 0; pixel < count; pixel += 1, index += 4) {
      data[index] = Math.max(0, layer.r[pixel]);
      data[index + 1] = Math.max(0, layer.g[pixel]);
      data[index + 2] = Math.max(0, layer.b[pixel]);
      data[index + 3] = 1;
    }
    return data;
  }

  function rgba8ToLayer(data, width, height) {
    const out = createLayer(width, height);
    for (let pixel = 0, index = 0; pixel < out.r.length; pixel += 1, index += 4) {
      out.r[pixel] = data[index] / 255;
      out.g[pixel] = data[index + 1] / 255;
      out.b[pixel] = data[index + 2] / 255;
    }
    return out;
  }

  function rgbaFloatToLayer(data, width, height) {
    const out = createLayer(width, height);
    for (let pixel = 0, index = 0; pixel < out.r.length; pixel += 1, index += 4) {
      out.r[pixel] = Math.max(0, data[index]);
      out.g[pixel] = Math.max(0, data[index + 1]);
      out.b[pixel] = Math.max(0, data[index + 2]);
    }
    return out;
  }

  function resolveMipWeights(weights, count) {
    const out = [];
    const fallback = weights.length ? Math.max(0, Number(weights[weights.length - 1]) || 0) : 0.2;
    let total = 0;
    for (let index = 0; index < count; index += 1) {
      const value = Math.max(0, Number(weights[index]) || fallback);
      out.push(value);
      total += value;
    }
    if (total <= 0.0001) return out.map(() => 1);
    const energyScale = Math.min(1.35, Math.max(0.75, total));
    const normalize = count * energyScale / total;
    return out.map((value) => value * normalize);
  }

  class WebglPyramidBlurBackend {
    constructor() {
      this.canvas = document.createElement("canvas");
      this.gl = modules.glowGpuCapabilities.getWebgl2Context(this.canvas);
      if (!this.gl) throw new Error("WebGL2 is unavailable");
      this.allocatedTargets = null;
      this.programs = {
        downsample: createProgram(this.gl, DOWNSAMPLE_SHADER),
        kawase: createProgram(this.gl, KAWASE_SHADER),
        scale: createProgram(this.gl, SCALE_SHADER),
        upsampleAdd: createProgram(this.gl, UPSAMPLE_ADD_SHADER),
        final: createProgram(this.gl, FINAL_SHADER)
      };
      this.vertexBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, this.gl.STATIC_DRAW);
      this.framebuffer = this.gl.createFramebuffer();
      this.floatTargets = !!(
        this.gl.getExtension("EXT_color_buffer_float") &&
        this.gl.getExtension("OES_texture_float_linear")
      );
      this.targetFormat = this.floatTargets
        ? {
            internalFormat: this.gl.RGBA16F,
            format: this.gl.RGBA,
            type: this.gl.HALF_FLOAT
          }
        : null;
      this.sourceFloatFormat = this.floatTargets
        ? {
            internalFormat: this.gl.RGBA32F,
            format: this.gl.RGBA,
            type: this.gl.FLOAT
          }
        : null;
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

    downsample(source, width, height) {
      const gl = this.gl;
      const target = createTarget(gl, Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)), this.targetFormat);
      if (this.allocatedTargets) this.allocatedTargets.push(target);
      const program = this.programs.downsample;
      this.bindProgram(program);
      this.bindTexture(program, "uSource", source, 0);
      gl.uniform2f(gl.getUniformLocation(program, "uTexel"), 1 / width, 1 / height);
      this.renderTo(target, program);
      return target;
    }

    kawase(sourceTarget, offset) {
      const gl = this.gl;
      const target = createTarget(gl, sourceTarget.width, sourceTarget.height, this.targetFormat);
      if (this.allocatedTargets) this.allocatedTargets.push(target);
      const program = this.programs.kawase;
      this.bindProgram(program);
      this.bindTexture(program, "uSource", sourceTarget.texture, 0);
      gl.uniform2f(gl.getUniformLocation(program, "uTexel"), 1 / sourceTarget.width, 1 / sourceTarget.height);
      gl.uniform1f(gl.getUniformLocation(program, "uOffset"), offset);
      this.renderTo(target, program);
      return target;
    }

    scale(sourceTarget, weight) {
      const gl = this.gl;
      const target = createTarget(gl, sourceTarget.width, sourceTarget.height, this.targetFormat);
      if (this.allocatedTargets) this.allocatedTargets.push(target);
      const program = this.programs.scale;
      this.bindProgram(program);
      this.bindTexture(program, "uSource", sourceTarget.texture, 0);
      gl.uniform1f(gl.getUniformLocation(program, "uWeight"), weight);
      this.renderTo(target, program);
      return target;
    }

    upsampleAdd(baseTarget, addTarget, weight) {
      const gl = this.gl;
      const target = createTarget(gl, addTarget.width, addTarget.height, this.targetFormat);
      if (this.allocatedTargets) this.allocatedTargets.push(target);
      const program = this.programs.upsampleAdd;
      this.bindProgram(program);
      this.bindTexture(program, "uBase", baseTarget.texture, 0);
      this.bindTexture(program, "uAdd", addTarget.texture, 1);
      gl.uniform2f(gl.getUniformLocation(program, "uBaseTexel"), 1 / baseTarget.width, 1 / baseTarget.height);
      gl.uniform1f(gl.getUniformLocation(program, "uWeight"), weight);
      this.renderTo(target, program);
      return target;
    }

    finalComposite(combined, sourceTexture, params, width, height) {
      const gl = this.gl;
      const target = createTarget(gl, width, height, this.targetFormat);
      if (this.allocatedTargets) this.allocatedTargets.push(target);
      const program = this.programs.final;
      const optics = params && params.blur && params.blur.optics ? params.blur.optics : {};
      const mode = String(optics.mode || "soft");
      const opticsMode = mode === "starburst" ? 1 : (mode === "anamorphic" ? 2 : 0);
      this.bindProgram(program);
      this.bindTexture(program, "uCombined", combined.texture, 0);
      this.bindTexture(program, "uSource", sourceTexture, 1);
      gl.uniform1f(gl.getUniformLocation(program, "uPyramidWeight"), Number(params && params.blur && params.blur.pyramidWeight) || 1);
      gl.uniform1f(gl.getUniformLocation(program, "uOpticsMode"), opticsMode);
      gl.uniform1f(gl.getUniformLocation(program, "uOpticsStrength"), Math.max(0, Number(optics.strength) || 0));
      gl.uniform1f(gl.getUniformLocation(program, "uOpticsLength"), Math.max(0, Number(optics.length) || 0));
      gl.uniform1f(gl.getUniformLocation(program, "uOpticsSharpness"), Math.max(0.7, Number(optics.sharpness) || 1.6));
      gl.uniform1f(gl.getUniformLocation(program, "uOpticsCoreMix"), Math.max(0.35, Math.min(1, Number(optics.coreMix) || 0.8)));
      gl.uniform1f(gl.getUniformLocation(program, "uOpticsDiagonalMix"), Math.max(0, Math.min(1, Number(optics.diagonalMix) || 0)));
      gl.uniform1f(gl.getUniformLocation(program, "uOpticsVerticalTightness"), Math.max(0.25, Math.min(1, Number(optics.verticalTightness) || 1)));
      gl.uniform1f(gl.getUniformLocation(program, "uOpticsStarCount"), Math.max(4, Math.min(12, Number(optics.starCount) || 6)));
      gl.uniform1f(gl.getUniformLocation(program, "uOpticsRotation"), Math.max(-180, Math.min(180, Number(optics.rotation) || 0)));
      gl.uniform2f(gl.getUniformLocation(program, "uTexel"), 1 / Math.max(1, width), 1 / Math.max(1, height));
      this.renderTo(target, program);
      return target;
    }

    buildMultiScaleGlow(sourceLayer, params) {
      if (!this.floatTargets) {
        throw new Error("WebGL2 glow blur requires float render targets");
      }
      const width = sourceLayer.width;
      const height = sourceLayer.height;
      const radiusRatio = Math.max(0, Math.min(1, Number(params.radius) / 240 || 0));
      const mipCount = Math.max(2, Math.min(7, Math.floor(Number(params.blur.mipCount) || Math.round(3 + radiusRatio * 4))));
      const weights = Array.isArray(params.blur.mipWeights) && params.blur.mipWeights.length
        ? params.blur.mipWeights.slice(0, 7)
        : [0.52, 0.86, 0.72, 0.46, 0.28, 0.16, 0.1];
      while (weights.length < 7) weights.push(weights[weights.length - 1] || 0.2);

      const gl = this.gl;
      this.canvas.width = width;
      this.canvas.height = height;
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);
      this.allocatedTargets = [];

      const currentTexture = this.floatTargets
        ? createTexture(gl, width, height, sourceLayerToFloat32(sourceLayer), this.sourceFloatFormat)
        : createTexture(gl, width, height, sourceLayerToRgba8(sourceLayer));
      try {
        let current = { width, height, texture: currentTexture, framebuffer: null };
        const levels = [];

        for (let index = 0; index < mipCount; index += 1) {
          if (current.width <= 1 && current.height <= 1) break;
          current = this.downsample(current.texture, current.width, current.height);
          levels.push(current);
        }

        const effectiveWeights = resolveMipWeights(weights, levels.length);
        let combined = levels.length
          ? this.scale(levels[levels.length - 1], effectiveWeights[levels.length - 1])
          : current;
        for (let index = levels.length - 2; index >= 0; index -= 1) {
          combined = this.upsampleAdd(combined, levels[index], effectiveWeights[index]);
        }

        const finalTarget = this.finalComposite(
          combined,
          currentTexture,
          params,
          width,
          height
        );
        gl.bindFramebuffer(gl.FRAMEBUFFER, finalTarget.framebuffer);
        let glowLayer;
        if (this.floatTargets) {
          const pixels = new Float32Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
          glowLayer = rgbaFloatToLayer(pixels, width, height);
        } else {
          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          glowLayer = rgba8ToLayer(pixels, width, height);
        }

        return {
          glowLayer,
          levels: { mips: levels.map((level) => ({ width: level.width, height: level.height })) },
          backend: "webgl2"
        };
      } finally {
        gl.deleteTexture(currentTexture);
        const targets = this.allocatedTargets || [];
        for (let index = 0; index < targets.length; index += 1) {
          gl.deleteTexture(targets[index].texture);
          gl.deleteFramebuffer(targets[index].framebuffer);
        }
        this.allocatedTargets = null;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    }
  }

  let backend = null;

  function getBackend() {
    if (!modules.glowGpuCapabilities || !modules.glowGpuCapabilities.canUseWebgl2()) {
      throw new Error("WebGL2 glow backend is unavailable");
    }
    if (!backend) backend = new WebglPyramidBlurBackend();
    return backend;
  }

  function buildMultiScaleGlow(sourceLayer, params) {
    if (!sourceLayer || !sourceLayer.width || !sourceLayer.height) {
      throw new Error("Glow source layer is invalid");
    }
    if (!modules.glowGpuCapabilities.canUseWebgl2(sourceLayer.width, sourceLayer.height)) {
      throw new Error("Image exceeds WebGL2 texture limits");
    }
    return getBackend().buildMultiScaleGlow(sourceLayer, params);
  }

  function reset() {
    backend = null;
  }

  modules.glowWebglPyramidBlur = {
    buildMultiScaleGlow,
    reset
  };
})(window);
