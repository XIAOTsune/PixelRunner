(function initBlendMatchWebglAlignmentModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  const VERTEX_SHADER = `#version 300 es
    layout(location = 0) in vec2 aPosition;
    out vec2 vUv;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const LUMA_SOBEL_SHADER = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D uImage;
    uniform ivec2 uSize;
    in vec2 vUv;
    out vec4 outColor;

    float lumaAt(ivec2 pixel) {
      ivec2 safePixel = clamp(pixel, ivec2(0), uSize - ivec2(1));
      vec4 color = texelFetch(uImage, safePixel, 0);
      float alpha = color.a;
      return alpha <= 0.02 ? 0.0 : dot(color.rgb, vec3(0.2126, 0.7152, 0.0722)) * 255.0 * alpha;
    }

    void main() {
      ivec2 pixel = ivec2(gl_FragCoord.xy);
      if (pixel.x <= 0 || pixel.y <= 0 || pixel.x >= uSize.x - 1 || pixel.y >= uSize.y - 1) {
        outColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      float tl = lumaAt(pixel + ivec2(-1, -1));
      float tc = lumaAt(pixel + ivec2( 0, -1));
      float tr = lumaAt(pixel + ivec2( 1, -1));
      float ml = lumaAt(pixel + ivec2(-1,  0));
      float mr = lumaAt(pixel + ivec2( 1,  0));
      float bl = lumaAt(pixel + ivec2(-1,  1));
      float bc = lumaAt(pixel + ivec2( 0,  1));
      float br = lumaAt(pixel + ivec2( 1,  1));
      float gx = -tl + tr - 2.0 * ml + 2.0 * mr - bl + br;
      float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
      outColor = vec4(length(vec2(gx, gy)), gx, gy, 1.0);
    }
  `;

  const SCORE_SHADER = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D uSourceGrad;
    uniform sampler2D uReferenceGrad;
    uniform sampler2D uCandidates;
    uniform vec2 uSize;
    uniform ivec2 uTiles;
    uniform float uStride;
    in vec2 vUv;
    out vec4 outColor;

    const int TILE = 16;

    vec4 sourceGradAt(vec2 pixel) {
      ivec2 safePixel = clamp(ivec2(floor(pixel + 0.5)), ivec2(0), ivec2(uSize) - ivec2(1));
      return texelFetch(uSourceGrad, safePixel, 0);
    }

    vec4 referenceGradAt(vec2 pixel) {
      ivec2 safePixel = clamp(ivec2(floor(pixel + 0.5)), ivec2(0), ivec2(uSize) - ivec2(1));
      return texelFetch(uReferenceGrad, safePixel, 0);
    }

    void main() {
      ivec2 pixel = ivec2(gl_FragCoord.xy);
      vec4 candidate = texelFetch(uCandidates, ivec2(pixel.x, 0), 0);
      vec2 offset = candidate.xy;
      float scale = candidate.z;
      int tileIndex = pixel.y;
      ivec2 tile = ivec2(tileIndex % uTiles.x, tileIndex / uTiles.x);
      float stepValue = max(1.0, uStride);
      vec2 center = uSize * 0.5;
      float sumA = 0.0;
      float sumB = 0.0;
      float sumAA = 0.0;
      float sumBB = 0.0;
      float sumAB = 0.0;
      float count = 0.0;

      for (int localY = 0; localY < TILE; localY++) {
        float y = 1.0 + (float(tile.y * TILE + localY) * stepValue);
        if (y >= uSize.y - 1.0) continue;
        for (int localX = 0; localX < TILE; localX++) {
          float x = 1.0 + (float(tile.x * TILE + localX) * stepValue);
          if (x >= uSize.x - 1.0) continue;
          vec2 local = vec2(x, y) - center;
          vec2 sourcePixel = center + local / max(0.0001, scale) + offset;
          if (sourcePixel.x < 1.0 || sourcePixel.x >= uSize.x - 1.0 || sourcePixel.y < 1.0 || sourcePixel.y >= uSize.y - 1.0) continue;
          float a = sourceGradAt(sourcePixel).r;
          float b = referenceGradAt(vec2(x, y)).r;
          if (a < 8.0 && b < 8.0) continue;
          sumA += a;
          sumB += b;
          sumAA += a * a;
          sumBB += b * b;
          sumAB += a * b;
          count += 1.0;
        }
      }

      outColor = vec4(sumA, sumB, sumAA, sumBB);
    }
  `;

  const SCORE_SUM_SHADER = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D uSourceGrad;
    uniform sampler2D uReferenceGrad;
    uniform sampler2D uCandidates;
    uniform vec2 uSize;
    uniform ivec2 uTiles;
    uniform float uStride;
    in vec2 vUv;
    out vec4 outColor;

    const int TILE = 16;

    vec4 sourceGradAt(vec2 pixel) {
      ivec2 safePixel = clamp(ivec2(floor(pixel + 0.5)), ivec2(0), ivec2(uSize) - ivec2(1));
      return texelFetch(uSourceGrad, safePixel, 0);
    }

    vec4 referenceGradAt(vec2 pixel) {
      ivec2 safePixel = clamp(ivec2(floor(pixel + 0.5)), ivec2(0), ivec2(uSize) - ivec2(1));
      return texelFetch(uReferenceGrad, safePixel, 0);
    }

    void main() {
      ivec2 pixel = ivec2(gl_FragCoord.xy);
      vec4 candidate = texelFetch(uCandidates, ivec2(pixel.x, 0), 0);
      vec2 offset = candidate.xy;
      float scale = candidate.z;
      int tileIndex = pixel.y;
      ivec2 tile = ivec2(tileIndex % uTiles.x, tileIndex / uTiles.x);
      float stepValue = max(1.0, uStride);
      vec2 center = uSize * 0.5;
      float sumAB = 0.0;
      float directionSum = 0.0;
      float overlapSum = 0.0;
      float count = 0.0;

      for (int localY = 0; localY < TILE; localY++) {
        float y = 1.0 + (float(tile.y * TILE + localY) * stepValue);
        if (y >= uSize.y - 1.0) continue;
        for (int localX = 0; localX < TILE; localX++) {
          float x = 1.0 + (float(tile.x * TILE + localX) * stepValue);
          if (x >= uSize.x - 1.0) continue;
          vec2 local = vec2(x, y) - center;
          vec2 sourcePixel = center + local / max(0.0001, scale) + offset;
          if (sourcePixel.x < 1.0 || sourcePixel.x >= uSize.x - 1.0 || sourcePixel.y < 1.0 || sourcePixel.y >= uSize.y - 1.0) continue;
          vec4 sourceGrad = sourceGradAt(sourcePixel);
          vec4 referenceGrad = referenceGradAt(vec2(x, y));
          float a = sourceGrad.r;
          float b = referenceGrad.r;
          if (a < 8.0 && b < 8.0) continue;
          sumAB += a * b;
          float denom = max(0.001, a * b);
          float cosValue = ((sourceGrad.g * referenceGrad.g) + (sourceGrad.b * referenceGrad.b)) / denom;
          directionSum += clamp(cosValue, -1.0, 1.0);
          overlapSum += min(a, b) / max(1.0, max(a, b));
          count += 1.0;
        }
      }

      outColor = vec4(sumAB, count, directionSum, overlapSum);
    }
  `;

  const FULLSCREEN_TRIANGLE = new Float32Array([
    -1, -1,
     3, -1,
    -1,  3
  ]);

  function nowMs() {
    return typeof performance !== "undefined" && performance && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  function roundMs(value) {
    return Number((Number(value) || 0).toFixed(1));
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

  function queryLocations(gl, program, names) {
    const out = {};
    names.forEach((name) => {
      out[name] = gl.getUniformLocation(program, name);
    });
    return out;
  }

  function createRgba8Texture(gl, width, height, data = null) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return texture;
  }

  function createFloatTexture(gl, width, height, data = null) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
    return texture;
  }

  function createFloatTarget(gl, width, height, internalFormat = gl.RGBA32F, format = gl.RGBA) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, gl.FLOAT, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error("WebGL2 float framebuffer is incomplete");
    }
    return { width, height, texture, framebuffer, internalFormat, format };
  }

  function destroyTarget(gl, target) {
    if (!target) return;
    if (target.texture) gl.deleteTexture(target.texture);
    if (target.framebuffer) gl.deleteFramebuffer(target.framebuffer);
  }

  function buildScaleCandidates(maxScalePercent, enabled) {
    if (!enabled || !(maxScalePercent > 0)) return [1];
    const maxScale = Math.max(0, Math.min(4, Number(maxScalePercent) || 0));
    const out = [1];
    const unit = maxScale <= 1.25 ? 0.25 : 0.5;
    for (let step = unit; step <= maxScale + 0.001; step += unit) {
      out.push(1 - step / 100, 1 + step / 100);
    }
    if (Math.abs(maxScale % unit) > 0.001) {
      out.push(1 - maxScale / 100, 1 + maxScale / 100);
    }
    return out.sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1));
  }

  function buildOffsetCandidates(maxOffset, step, center, radius = null) {
    const max = Math.max(0, Number(maxOffset) || 0);
    const stride = Math.max(1, Math.round(Number(step) || 1));
    const origin = Math.max(-max, Math.min(max, Math.round(Number(center) || 0)));
    const searchRadius = radius === null || radius === undefined
      ? max
      : Math.max(0, Math.min(max, Number(radius) || 0));
    const start = Math.max(-max, Math.round(origin - searchRadius));
    const end = Math.min(max, Math.round(origin + searchRadius));
    const values = [];
    for (let value = start; value <= end; value += stride) {
      values.push(Math.round(value));
    }
    values.push(start, origin, end);
    if (radius === null || radius === undefined) {
      values.push(-max, 0, max);
    }
    return Array.from(new Set(values)).sort((a, b) => {
      const da = Math.abs(a - origin);
      const db = Math.abs(b - origin);
      return da - db || a - b;
    });
  }

  function getLargeOffsetStep(sampleOffset) {
    const max = Math.max(1, Number(sampleOffset) || 1);
    if (max > 96) return 8;
    if (max > 48) return 6;
    if (max > 28) return 4;
    if (max > 16) return 2;
    return 1;
  }

  function base64ToUint8Array(base64) {
    const text = String(base64 || "");
    if (!text) return null;
    const binary = global.atob(text);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      out[index] = binary.charCodeAt(index);
    }
    return out;
  }

  function normalizeSample(sample) {
    if (!sample || typeof sample !== "object") return null;
    const width = Math.max(1, Math.floor(Number(sample.width) || 0));
    const height = Math.max(1, Math.floor(Number(sample.height) || 0));
    let data = sample.data || sample.rgba || null;
    if (data && data.buffer instanceof ArrayBuffer && typeof data.length === "number") {
      data = new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength || data.length);
    } else if (Array.isArray(data)) {
      data = new Uint8Array(data);
    } else if (!data && sample.base64) {
      data = base64ToUint8Array(sample.base64);
    }
    if (!data || data.length < width * height * 4) return null;
    return {
      width,
      height,
      scaleX: Number(sample.scaleX) || 1,
      scaleY: Number(sample.scaleY) || 1,
      data: data instanceof Uint8Array ? data : new Uint8Array(data)
    };
  }

  class BlendMatchWebglAlignmentEngine {
    constructor() {
      const initStart = nowMs();
      this.canvas = document.createElement("canvas");
      this.canvas.width = 1;
      this.canvas.height = 1;
      this.gl = modules.glowGpuCapabilities && typeof modules.glowGpuCapabilities.getWebgl2Context === "function"
        ? modules.glowGpuCapabilities.getWebgl2Context(this.canvas)
        : null;
      if (!this.gl) throw new Error("WebGL2 is unavailable");
      const gl = this.gl;
      const support = BlendMatchWebglAlignmentEngine.detectSupport();
      if (!support.webgl2 || !support.colorBufferFloat) {
        throw new Error(support.reason || "WebGL2 float render target is unavailable");
      }
      if (!gl.getExtension("EXT_color_buffer_float")) {
        throw new Error("EXT_color_buffer_float-unavailable");
      }
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.programs = {
        sobel: createProgram(gl, LUMA_SOBEL_SHADER),
        score: createProgram(gl, SCORE_SHADER),
        scoreSum: createProgram(gl, SCORE_SUM_SHADER)
      };
      this.locations = {
        sobel: queryLocations(gl, this.programs.sobel, ["uImage", "uSize"]),
        score: queryLocations(gl, this.programs.score, ["uSourceGrad", "uReferenceGrad", "uCandidates", "uSize", "uTiles", "uStride"]),
        scoreSum: queryLocations(gl, this.programs.scoreSum, ["uSourceGrad", "uReferenceGrad", "uCandidates", "uSize", "uTiles", "uStride"])
      };
      this.vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.sourceTexture = null;
      this.referenceTexture = null;
      this.sourceGradTarget = null;
      this.referenceGradTarget = null;
      this.scoreTarget = null;
      this.scoreSumTarget = null;
      this.candidateTexture = null;
      this.maxBatchSize = 0;
      this.scoreReadback = null;
      this.scoreSumReadback = null;
      this.size = { width: 0, height: 0, tilesX: 0, tilesY: 0 };
      this.initMs = roundMs(nowMs() - initStart);
    }

    static detectSupport() {
      const report = modules.glowGpuCapabilities && typeof modules.glowGpuCapabilities.getReport === "function"
        ? modules.glowGpuCapabilities.getReport()
        : { webgl2: false, reason: "webgl2-capability-module-missing" };
      if (!report || !report.webgl2) {
        return {
          ...(report || {}),
          supported: false,
          reason: report && report.reason ? report.reason : "webgl2-context-unavailable"
        };
      }
      if (!report.colorBufferFloat) {
        return {
          ...report,
          supported: false,
          reason: "EXT_color_buffer_float-unavailable"
        };
      }
      return {
        ...report,
        supported: true,
        reason: ""
      };
    }

    ensureSize(width, height, stride, batchSize = 1) {
      const safeWidth = Math.max(1, Math.floor(Number(width) || 1));
      const safeHeight = Math.max(1, Math.floor(Number(height) || 1));
      const safeStride = Math.max(1, Math.floor(Number(stride) || 1));
      const safeBatchSize = Math.max(1, Math.floor(Number(batchSize) || 1));
      const sampleWidth = Math.max(0, Math.ceil((safeWidth - 2) / safeStride));
      const sampleHeight = Math.max(0, Math.ceil((safeHeight - 2) / safeStride));
      const tilesX = Math.max(1, Math.ceil(sampleWidth / 16));
      const tilesY = Math.max(1, Math.ceil(sampleHeight / 16));
      const scoreHeight = Math.max(1, tilesX * tilesY);
      if (
        this.size.width === safeWidth &&
        this.size.height === safeHeight &&
        this.size.tilesX === tilesX &&
        this.size.tilesY === tilesY &&
        this.maxBatchSize >= safeBatchSize
      ) {
        return;
      }
      const gl = this.gl;
      this.canvas.width = Math.max(safeWidth, safeBatchSize);
      this.canvas.height = Math.max(safeHeight, scoreHeight);
      if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
      if (this.referenceTexture) gl.deleteTexture(this.referenceTexture);
      if (this.candidateTexture) gl.deleteTexture(this.candidateTexture);
      destroyTarget(gl, this.sourceGradTarget);
      destroyTarget(gl, this.referenceGradTarget);
      destroyTarget(gl, this.scoreTarget);
      destroyTarget(gl, this.scoreSumTarget);
      this.sourceTexture = null;
      this.referenceTexture = null;
      this.candidateTexture = null;
      this.sourceGradTarget = createFloatTarget(gl, safeWidth, safeHeight, gl.RGBA32F, gl.RGBA);
      this.referenceGradTarget = createFloatTarget(gl, safeWidth, safeHeight, gl.RGBA32F, gl.RGBA);
      this.scoreTarget = createFloatTarget(gl, safeBatchSize, scoreHeight, gl.RGBA32F, gl.RGBA);
      this.scoreSumTarget = createFloatTarget(gl, safeBatchSize, scoreHeight, gl.RGBA32F, gl.RGBA);
      this.candidateTexture = createFloatTexture(gl, safeBatchSize, 1);
      this.scoreReadback = new Float32Array(safeBatchSize * scoreHeight * 4);
      this.scoreSumReadback = new Float32Array(safeBatchSize * scoreHeight * 4);
      this.maxBatchSize = safeBatchSize;
      this.size = { width: safeWidth, height: safeHeight, tilesX, tilesY };
    }

    uploadSamples(sourceSample, referenceSample) {
      const gl = this.gl;
      if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
      if (this.referenceTexture) gl.deleteTexture(this.referenceTexture);
      this.sourceTexture = createRgba8Texture(gl, sourceSample.width, sourceSample.height, sourceSample.data);
      this.referenceTexture = createRgba8Texture(gl, referenceSample.width, referenceSample.height, referenceSample.data);
    }

    renderSobel(texture, target, width, height) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, width, height);
      gl.useProgram(this.programs.sobel);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(this.locations.sobel.uImage, 0);
      gl.uniform2i(this.locations.sobel.uSize, width, height);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }

    scoreCandidateBatch(candidates, stride) {
      if (!Array.isArray(candidates) || !candidates.length) return [];
      const gl = this.gl;
      const { width, height, tilesX, tilesY } = this.size;
      const batchSize = Math.max(1, candidates.length);
      const scoreHeight = Math.max(1, tilesX * tilesY);
      const candidateData = new Float32Array(this.maxBatchSize * 4);
      candidates.forEach((candidate, index) => {
        candidateData[index * 4] = Number(candidate.dx) || 0;
        candidateData[index * 4 + 1] = Number(candidate.dy) || 0;
        candidateData[index * 4 + 2] = Number(candidate.scale) || 1;
        candidateData[index * 4 + 3] = 1;
      });
      gl.bindTexture(gl.TEXTURE_2D, this.candidateTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.maxBatchSize, 1, gl.RGBA, gl.FLOAT, candidateData);
      gl.bindVertexArray(this.vao);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scoreTarget.framebuffer);
      gl.viewport(0, 0, batchSize, scoreHeight);
      gl.useProgram(this.programs.score);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceGradTarget.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.referenceGradTarget.texture);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.candidateTexture);
      gl.uniform1i(this.locations.score.uSourceGrad, 0);
      gl.uniform1i(this.locations.score.uReferenceGrad, 1);
      gl.uniform1i(this.locations.score.uCandidates, 2);
      gl.uniform2f(this.locations.score.uSize, width, height);
      gl.uniform2i(this.locations.score.uTiles, tilesX, tilesY);
      gl.uniform1f(this.locations.score.uStride, stride);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scoreSumTarget.framebuffer);
      gl.viewport(0, 0, batchSize, scoreHeight);
      gl.useProgram(this.programs.scoreSum);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceGradTarget.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.referenceGradTarget.texture);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.candidateTexture);
      gl.uniform1i(this.locations.scoreSum.uSourceGrad, 0);
      gl.uniform1i(this.locations.scoreSum.uReferenceGrad, 1);
      gl.uniform1i(this.locations.scoreSum.uCandidates, 2);
      gl.uniform2f(this.locations.scoreSum.uSize, width, height);
      gl.uniform2i(this.locations.scoreSum.uTiles, tilesX, tilesY);
      gl.uniform1f(this.locations.scoreSum.uStride, stride);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scoreTarget.framebuffer);
      gl.readPixels(0, 0, batchSize, scoreHeight, gl.RGBA, gl.FLOAT, this.scoreReadback);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scoreSumTarget.framebuffer);
      gl.readPixels(0, 0, batchSize, scoreHeight, gl.RGBA, gl.FLOAT, this.scoreSumReadback);

      const summaries = new Array(batchSize);
      for (let candidateIndex = 0; candidateIndex < batchSize; candidateIndex += 1) {
        let sumA = 0;
        let sumB = 0;
        let sumAA = 0;
        let sumBB = 0;
        let sumAB = 0;
        let directionSum = 0;
        let overlapSum = 0;
        let count = 0;
        for (let tileIndex = 0; tileIndex < scoreHeight; tileIndex += 1) {
          const index = (tileIndex * batchSize + candidateIndex) * 4;
          sumA += this.scoreReadback[index];
          sumB += this.scoreReadback[index + 1];
          sumAA += this.scoreReadback[index + 2];
          sumBB += this.scoreReadback[index + 3];
          sumAB += this.scoreSumReadback[index];
          count += this.scoreSumReadback[index + 1];
          directionSum += this.scoreSumReadback[index + 2];
          overlapSum += this.scoreSumReadback[index + 3];
        }
        if (count < 64) {
          summaries[candidateIndex] = {
            score: -1,
            sampleCount: Math.max(0, Math.round(count)),
            directionAgreement: 0,
            edgeOverlap: 0
          };
          continue;
        }
        const numerator = sumAB - (sumA * sumB) / count;
        const denomA = sumAA - (sumA * sumA) / count;
        const denomB = sumBB - (sumB * sumB) / count;
        const denom = Math.sqrt(Math.max(0.0001, denomA * denomB));
        summaries[candidateIndex] = {
          score: numerator / denom,
          sampleCount: Math.max(0, Math.round(count)),
          directionAgreement: directionSum / count,
          edgeOverlap: overlapSum / count
        };
      }
      return summaries;
    }

    searchGlobal(width, height, sampleOffset, scaleCandidates, stride, batchSize) {
      const coarseStep = getLargeOffsetStep(sampleOffset);
      const coarseStride = Math.max(1, Math.floor((Number(stride) || 1) * (coarseStep >= 6 ? 1.65 : coarseStep >= 4 ? 1.35 : 1)));
      let best = { dx: 0, dy: 0, scale: 1, score: -1 };
      let second = -1;
      let translationBase = { dx: 0, dy: 0, scale: 1, score: -1 };
      let translationSecond = -1;
      let scoreCalls = 0;
      const topCandidates = [];
      const stages = [];
      const updateTopCandidates = (candidate) => {
        if (!candidate || !Number.isFinite(Number(candidate.score))) return;
        topCandidates.push({
          dx: Number((Number(candidate.dx) || 0).toFixed(3)),
          dy: Number((Number(candidate.dy) || 0).toFixed(3)),
          scale: Number((Number(candidate.scale) || 1).toFixed(6)),
          score: Number((Number(candidate.score) || 0).toFixed(6)),
          sampleCount: Math.max(0, Math.round(Number(candidate.sampleCount) || 0)),
          directionAgreement: Number((Number(candidate.directionAgreement) || 0).toFixed(6)),
          edgeOverlap: Number((Number(candidate.edgeOverlap) || 0).toFixed(6)),
          stage: String(candidate.stage || "")
        });
        topCandidates.sort((a, b) => Number(b.score) - Number(a.score));
        if (topCandidates.length > 8) topCandidates.length = 8;
      };
      const update = (dx, dy, scale, summary, stageName) => {
        scoreCalls += 1;
        const score = Number(summary && typeof summary === "object" ? summary.score : summary);
        updateTopCandidates({
          dx,
          dy,
          scale,
          score,
          sampleCount: summary && typeof summary === "object" ? summary.sampleCount : 0,
          directionAgreement: summary && typeof summary === "object" ? summary.directionAgreement : 0,
          edgeOverlap: summary && typeof summary === "object" ? summary.edgeOverlap : 0,
          stage: stageName
        });
        if (Math.abs(scale - 1) < 0.000001) {
          if (score > translationBase.score) {
            translationSecond = translationBase.score;
            translationBase = {
              dx,
              dy,
              scale: 1,
              score,
              sampleCount: summary && typeof summary === "object" ? summary.sampleCount : 0,
              directionAgreement: summary && typeof summary === "object" ? summary.directionAgreement : 0,
              edgeOverlap: summary && typeof summary === "object" ? summary.edgeOverlap : 0
            };
          } else if (score > translationSecond) {
            translationSecond = score;
          }
        }
        if (score > best.score) {
          second = best.score;
          best = {
            dx,
            dy,
            scale,
            score,
            sampleCount: summary && typeof summary === "object" ? summary.sampleCount : 0,
            directionAgreement: summary && typeof summary === "object" ? summary.directionAgreement : 0,
            edgeOverlap: summary && typeof summary === "object" ? summary.edgeOverlap : 0
          };
        } else if (score > second) {
          second = score;
        }
      };
      const runGrid = (stageName, maxOffset, step, centerDx, centerDy, activeStride, radius = null) => {
        const dxValues = buildOffsetCandidates(maxOffset, step, centerDx, radius);
        const dyValues = buildOffsetCandidates(maxOffset, step, centerDy, radius);
        const stage = {
          name: String(stageName || "grid-search"),
          maxOffset,
          step,
          centerDx,
          centerDy,
          stride: activeStride,
          radius: radius === null || radius === undefined ? maxOffset : radius,
          dxCandidates: dxValues.length,
          dyCandidates: dyValues.length,
          scaleCandidates: scaleCandidates.length,
          candidates: dxValues.length * dyValues.length * scaleCandidates.length,
          bestBefore: { ...best },
          bestAfter: null
        };
        scaleCandidates.forEach((scale) => {
          let pending = [];
          const flush = () => {
            if (!pending.length) return;
            const summaries = this.scoreCandidateBatch(pending, activeStride);
            pending.forEach((candidate, index) => {
              update(candidate.dx, candidate.dy, candidate.scale, summaries[index], stage.name);
            });
            pending = [];
          };
          dyValues.forEach((dy) => {
            dxValues.forEach((dx) => {
              pending.push({ dx, dy, scale });
              if (pending.length >= batchSize) flush();
            });
          });
          flush();
        });
        stage.bestAfter = { ...best };
        stages.push(stage);
      };
      runGrid("coarse-global-translation-scale", sampleOffset, coarseStep, 0, 0, coarseStride);
      if (coarseStep > 1) {
        const refineRadius = Math.min(sampleOffset, Math.max(3, coarseStep * 2));
        runGrid("mid-global-translation-scale-refine", sampleOffset, Math.max(1, Math.floor(coarseStep / 2)), best.dx, best.dy, Math.max(1, stride), refineRadius);
        runGrid("fine-global-translation-scale-refine", sampleOffset, 1, best.dx, best.dy, Math.max(1, stride), Math.min(sampleOffset, 2));
      }
      const rankedTopCandidates = topCandidates.map((candidate, index) => {
        const next = topCandidates[index + 1] || null;
        const secondScore = Number.isFinite(Number(next && next.score)) ? Number(next.score) : Number(second);
        const scoreGap = Number(candidate.score) - Math.max(0, Number.isFinite(secondScore) ? secondScore : -1);
        return {
          ...candidate,
          secondScore: Number.isFinite(secondScore) ? Number(secondScore.toFixed(6)) : -1,
          scoreGap: Number.isFinite(scoreGap) ? Number(scoreGap.toFixed(6)) : -1
        };
      });
      const bestSecondScore = Math.max(0, Number(second) || -1);
      const bestScoreGap = Number(best.score) - bestSecondScore;
      const validationSummary = {
        schemaVersion: 1,
        backend: "gpu-webgl2-global-v1",
        compact: true,
        topK: rankedTopCandidates,
        best: {
          dx: Number((Number(best.dx) || 0).toFixed(3)),
          dy: Number((Number(best.dy) || 0).toFixed(3)),
          scale: Number((Number(best.scale) || 1).toFixed(6)),
          score: Number((Number(best.score) || 0).toFixed(6)),
          secondScore: Number((Number(bestSecondScore) || 0).toFixed(6)),
          scoreGap: Number((Number(bestScoreGap) || 0).toFixed(6)),
          sampleCount: Math.max(0, Math.round(Number(best.sampleCount) || 0)),
          directionAgreement: Number((Number(best.directionAgreement) || 0).toFixed(6)),
          edgeOverlap: Number((Number(best.edgeOverlap) || 0).toFixed(6))
        },
        sampleCount: Math.max(0, Math.round(Number(best.sampleCount) || 0)),
        score: Number((Number(best.score) || 0).toFixed(6)),
        secondScore: Number((Number(bestSecondScore) || 0).toFixed(6)),
        scoreGap: Number((Number(bestScoreGap) || 0).toFixed(6)),
        directionAgreement: Number((Number(best.directionAgreement) || 0).toFixed(6)),
        edgeOverlap: Number((Number(best.edgeOverlap) || 0).toFixed(6)),
        scoreCalls,
        scoreReadback: "candidate-tile-summary"
      };
      return {
        best,
        second,
        translationBase,
        translationSecond,
        coarseStep,
        coarseStride,
        scoreCalls,
        topCandidates: rankedTopCandidates,
        validationSummary,
        stages
      };
    }

    estimateGradientAlignmentGpu(sourceInput, referenceInput, config = {}) {
      const startedAt = nowMs();
      const timings = { init: this.initMs };
      const sourceSample = normalizeSample(sourceInput);
      const referenceSample = normalizeSample(referenceInput);
      if (!sourceSample || !referenceSample || sourceSample.width !== referenceSample.width || sourceSample.height !== referenceSample.height) {
        return { applied: false, dx: 0, dy: 0, confidence: 0, score: -1, reason: "preview-size-mismatch", gpu: true, timings };
      }
      const width = sourceSample.width;
      const height = sourceSample.height;
      if (width < 32 || height < 32) {
        return { applied: false, dx: 0, dy: 0, confidence: 0, score: -1, reason: "too-small", gpu: true, timings };
      }
      const support = BlendMatchWebglAlignmentEngine.detectSupport();
      if (!support.supported) {
        return { applied: false, dx: 0, dy: 0, confidence: 0, score: -1, reason: support.reason, gpu: true, timings, support };
      }
      const sampleOffset = Math.max(
        1,
        Math.min(
          Math.floor(Math.min(width, height) * 0.45),
          Math.round(Number(config.alignmentMaxOffset) / Math.max(sourceSample.scaleX, sourceSample.scaleY))
        )
      );
      const stride = Math.max(1, Math.floor(Math.max(width, height) / 180));
      const scaleCandidates = buildScaleCandidates(Number(config.alignmentMaxScale) || 0, config.alignmentScaleEnabled !== false);
      const maxBatchSize = Math.max(8, Math.min(96, Math.floor((Number(support.maxTextureSize) || 4096) / 2)));
      this.ensureSize(width, height, stride, maxBatchSize);
      const preparedAt = nowMs();
      this.uploadSamples(sourceSample, referenceSample);
      timings.upload = roundMs(nowMs() - preparedAt);
      const sobelStartedAt = nowMs();
      this.renderSobel(this.sourceTexture, this.sourceGradTarget, width, height);
      this.renderSobel(this.referenceTexture, this.referenceGradTarget, width, height);
      this.gl.finish();
      timings.sobel = roundMs(nowMs() - sobelStartedAt);
      const searchStartedAt = nowMs();
      const globalSearch = this.searchGlobal(width, height, sampleOffset, scaleCandidates, stride, maxBatchSize);
      timings.globalSearch = roundMs(nowMs() - searchStartedAt);
      timings.total = roundMs(nowMs() - startedAt);

      const best = globalSearch.best;
      const second = Math.max(0, globalSearch.second, globalSearch.translationSecond);
      const confidence = Math.max(0, Math.min(1, (best.score - second) * 3 + Math.max(0, best.score - 0.22)));
      const docDx = -best.dx * sourceSample.scaleX;
      const docDy = -best.dy * sourceSample.scaleY;
      const scalePercent = Number((best.scale * 100).toFixed(3));
      const significant =
        Math.abs(docDx) >= 0.35 ||
        Math.abs(docDy) >= 0.35 ||
        Math.abs(scalePercent - 100) >= 0.08;
      return {
        applied: confidence >= 0.18 && significant,
        dx: confidence >= 0.18 && significant ? Number(docDx.toFixed(2)) : 0,
        dy: confidence >= 0.18 && significant ? Number(docDy.toFixed(2)) : 0,
        scalePercent: confidence >= 0.18 && significant ? scalePercent : 100,
        scaleXPercent: confidence >= 0.18 && significant ? scalePercent : 100,
        scaleYPercent: confidence >= 0.18 && significant ? scalePercent : 100,
        rotation: 0,
        confidence,
        score: best.score,
        sampleDx: best.dx,
        sampleDy: best.dy,
        sampleScale: best.scale,
        sampleScaleX: best.scale,
        sampleScaleY: best.scale,
        sampleRotation: 0,
        rawSampleDx: best.dx,
        rawSampleDy: best.dy,
        rawSampleScaleX: best.scale,
        rawSampleScaleY: best.scale,
        rawSampleRotation: 0,
        search: {
          sampleOffset,
          stride,
          scaleCandidates: scaleCandidates.length,
          scoreCalls: globalSearch.scoreCalls,
          batchSize: maxBatchSize,
          coarseStep: globalSearch.coarseStep,
          coarseStride: globalSearch.coarseStride,
          topCandidates: globalSearch.topCandidates,
          topCandidate: globalSearch.topCandidates && globalSearch.topCandidates[0] || null,
          globalValidation: globalSearch.validationSummary,
          refinedCandidate: {
            dx: Number((Number(best.dx) || 0).toFixed(3)),
            dy: Number((Number(best.dy) || 0).toFixed(3)),
            scale: Number((Number(best.scale) || 1).toFixed(6)),
            score: Number((Number(best.score) || 0).toFixed(6)),
            secondScore: Number((Number(second) || 0).toFixed(6)),
            scoreGap: Number((Number(best.score - second) || 0).toFixed(6)),
            sampleCount: Math.max(0, Math.round(Number(best.sampleCount) || 0)),
            directionAgreement: Number((Number(best.directionAgreement) || 0).toFixed(6)),
            edgeOverlap: Number((Number(best.edgeOverlap) || 0).toFixed(6))
          },
          translationCandidate: {
            dx: Number((Number(globalSearch.translationBase.dx) || 0).toFixed(3)),
            dy: Number((Number(globalSearch.translationBase.dy) || 0).toFixed(3)),
            scale: 1,
            score: Number((Number(globalSearch.translationBase.score) || 0).toFixed(6)),
            secondScore: Number((Number(globalSearch.translationSecond) || 0).toFixed(6)),
            scoreGap: Number((Number(globalSearch.translationBase.score - Math.max(0, globalSearch.translationSecond)) || 0).toFixed(6)),
            sampleCount: Math.max(0, Math.round(Number(globalSearch.translationBase.sampleCount) || 0)),
            directionAgreement: Number((Number(globalSearch.translationBase.directionAgreement) || 0).toFixed(6)),
            edgeOverlap: Number((Number(globalSearch.translationBase.edgeOverlap) || 0).toFixed(6))
          },
          stages: [
            { name: "sobel-magnitude", backend: "gpu-webgl2" },
            ...globalSearch.stages
          ],
          gpuStages: ["sobel-magnitude", "coarse-global-translation-scale", "mid/fine-global-translation-scale-refine"],
          remainingCpuStages: ["affine-refine", "local-mesh"]
        },
        local: {
          enabled: Boolean(config.localAlignmentEnabled),
          applied: false,
          validTiles: 0,
          totalTiles: 0,
          reason: "gpu-v1-global-only"
        },
        localDeformation: false,
        reason: confidence < 0.18 ? "gpu-v1-low-confidence" : significant ? "gpu-v1-global-ncc" : "already-aligned",
        gpu: true,
        timings,
        support
      };
    }

    dispose() {
      const gl = this.gl;
      if (!gl) return;
      destroyTarget(gl, this.sourceGradTarget);
      destroyTarget(gl, this.referenceGradTarget);
      destroyTarget(gl, this.scoreTarget);
      destroyTarget(gl, this.scoreSumTarget);
      if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
      if (this.referenceTexture) gl.deleteTexture(this.referenceTexture);
      if (this.candidateTexture) gl.deleteTexture(this.candidateTexture);
      if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
      if (this.vao) gl.deleteVertexArray(this.vao);
      Object.values(this.programs).forEach((program) => gl.deleteProgram(program));
      this.sourceTexture = null;
      this.referenceTexture = null;
      this.candidateTexture = null;
      this.sourceGradTarget = null;
      this.referenceGradTarget = null;
      this.scoreTarget = null;
      this.scoreSumTarget = null;
      this.gl = null;
    }
  }

  modules.blendMatchWebglAlignment = {
    detectSupport: () => BlendMatchWebglAlignmentEngine.detectSupport(),
    createWebglAlignmentEngine: () => new BlendMatchWebglAlignmentEngine(),
    createEngine: () => new BlendMatchWebglAlignmentEngine()
  };
})(window);
