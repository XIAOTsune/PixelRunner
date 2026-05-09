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
      vec3 color = vec3(0.0);
      float total = 0.0;
      for (int y = -1; y <= 2; y++) {
        float wy = (y == 0 || y == 1) ? 3.0 : 1.0;
        for (int x = -1; x <= 2; x++) {
          float wx = (x == 0 || x == 1) ? 3.0 : 1.0;
          float weight = wx * wy;
          color += texture(uSource, vUv + vec2(float(x), float(y)) * uTexel).rgb * weight;
          total += weight;
        }
      }
      outColor = vec4(color / max(total, 0.0001), 1.0);
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

  const UPSAMPLE_ADD_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uBase;
    uniform sampler2D uAdd;
    uniform float uWeight;
    in vec2 vUv;
    out vec4 outColor;
    void main() {
      outColor = vec4(texture(uBase, vUv).rgb + texture(uAdd, vUv).rgb * uWeight, 1.0);
    }
  `;

  const FINAL_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uCombined;
    uniform sampler2D uLevel0;
    uniform sampler2D uLevel1;
    uniform sampler2D uLevel2;
    uniform sampler2D uLevel3;
    uniform sampler2D uLevel4;
    uniform sampler2D uLevel5;
    uniform sampler2D uLevel6;
    uniform int uLevelCount;
    uniform float uPyramidWeight;
    uniform float uWeights[7];
    in vec2 vUv;
    out vec4 outColor;
    void main() {
      vec3 color = texture(uCombined, vUv).rgb * uPyramidWeight;
      if (uLevelCount > 0) color += texture(uLevel0, vUv).rgb * uWeights[0];
      if (uLevelCount > 1) color += texture(uLevel1, vUv).rgb * uWeights[1];
      if (uLevelCount > 2) color += texture(uLevel2, vUv).rgb * uWeights[2];
      if (uLevelCount > 3) color += texture(uLevel3, vUv).rgb * uWeights[3];
      if (uLevelCount > 4) color += texture(uLevel4, vUv).rgb * uWeights[4];
      if (uLevelCount > 5) color += texture(uLevel5, vUv).rgb * uWeights[5];
      if (uLevelCount > 6) color += texture(uLevel6, vUv).rgb * uWeights[6];
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

  function createTexture(gl, width, height, data = null) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
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

  function rgba8ToLayer(data, width, height) {
    const out = createLayer(width, height);
    for (let pixel = 0, index = 0; pixel < out.r.length; pixel += 1, index += 4) {
      out.r[pixel] = data[index] / 255;
      out.g[pixel] = data[index + 1] / 255;
      out.b[pixel] = data[index + 2] / 255;
    }
    return out;
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
        upsampleAdd: createProgram(this.gl, UPSAMPLE_ADD_SHADER),
        final: createProgram(this.gl, FINAL_SHADER)
      };
      this.vertexBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, this.gl.STATIC_DRAW);
      this.framebuffer = this.gl.createFramebuffer();
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
      const target = createTarget(gl, Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)));
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
      const target = createTarget(gl, sourceTarget.width, sourceTarget.height);
      if (this.allocatedTargets) this.allocatedTargets.push(target);
      const program = this.programs.kawase;
      this.bindProgram(program);
      this.bindTexture(program, "uSource", sourceTarget.texture, 0);
      gl.uniform2f(gl.getUniformLocation(program, "uTexel"), 1 / sourceTarget.width, 1 / sourceTarget.height);
      gl.uniform1f(gl.getUniformLocation(program, "uOffset"), offset);
      this.renderTo(target, program);
      return target;
    }

    upsampleAdd(baseTarget, addTarget, weight) {
      const gl = this.gl;
      const target = createTarget(gl, addTarget.width, addTarget.height);
      if (this.allocatedTargets) this.allocatedTargets.push(target);
      const program = this.programs.upsampleAdd;
      this.bindProgram(program);
      this.bindTexture(program, "uBase", baseTarget.texture, 0);
      this.bindTexture(program, "uAdd", addTarget.texture, 1);
      gl.uniform1f(gl.getUniformLocation(program, "uWeight"), weight);
      this.renderTo(target, program);
      return target;
    }

    finalComposite(combined, levels, weights, pyramidWeight, width, height) {
      const gl = this.gl;
      const target = createTarget(gl, width, height);
      if (this.allocatedTargets) this.allocatedTargets.push(target);
      const program = this.programs.final;
      this.bindProgram(program);
      this.bindTexture(program, "uCombined", combined.texture, 0);
      for (let index = 0; index < 7; index += 1) {
        const level = levels[index] || levels[levels.length - 1] || combined;
        this.bindTexture(program, `uLevel${index}`, level.texture, index + 1);
      }
      gl.uniform1i(gl.getUniformLocation(program, "uLevelCount"), Math.min(7, levels.length));
      gl.uniform1f(gl.getUniformLocation(program, "uPyramidWeight"), pyramidWeight);
      gl.uniform1fv(gl.getUniformLocation(program, "uWeights"), new Float32Array(weights.slice(0, 7)));
      this.renderTo(target, program);
      return target;
    }

    buildMultiScaleGlow(sourceLayer, params) {
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

      const currentTexture = createTexture(gl, width, height, sourceLayerToRgba8(sourceLayer));
      try {
        let current = { width, height, texture: currentTexture, framebuffer: null };
        const levels = [];

        for (let index = 0; index < mipCount; index += 1) {
          if (current.width <= 1 && current.height <= 1) break;
          const downsampled = this.downsample(current.texture, current.width, current.height);
          current = this.kawase(downsampled, 1);
          levels.push(current);
        }

        let combined = levels.length ? levels[levels.length - 1] : current;
        for (let index = levels.length - 2; index >= 0; index -= 1) {
          const added = this.upsampleAdd(combined, levels[index], weights[index] || weights[weights.length - 1] || 0.25);
          combined = this.kawase(added, 0.75);
        }

        const finalTarget = this.finalComposite(
          combined,
          levels,
          weights,
          params.blur.pyramidWeight || 1,
          width,
          height
        );
        const pixels = new Uint8Array(width * height * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, finalTarget.framebuffer);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        return {
          glowLayer: rgba8ToLayer(pixels, width, height),
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

  modules.glowWebglPyramidBlur = {
    buildMultiScaleGlow
  };
})(window);
