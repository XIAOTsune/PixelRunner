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
    uniform vec4 uRegion;
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
      vec4 affine = texelFetch(uCandidates, ivec2(pixel.x, 1), 0);
      vec2 offset = candidate.xy;
      vec2 scale = max(vec2(0.85), candidate.zw);
      float rotation = affine.x;
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
          if (x < uRegion.x || y < uRegion.y || x >= uRegion.z || y >= uRegion.w) continue;
          vec2 local = vec2(x, y) - center;
          float c = cos(-rotation);
          float s = sin(-rotation);
          vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
          vec2 sourcePixel = center + rotated / scale + offset;
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
    uniform vec4 uRegion;
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
      vec4 affine = texelFetch(uCandidates, ivec2(pixel.x, 1), 0);
      vec2 offset = candidate.xy;
      vec2 scale = max(vec2(0.85), candidate.zw);
      float rotation = affine.x;
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
          if (x < uRegion.x || y < uRegion.y || x >= uRegion.z || y >= uRegion.w) continue;
          vec2 local = vec2(x, y) - center;
          float c = cos(-rotation);
          float s = sin(-rotation);
          vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
          vec2 sourcePixel = center + rotated / scale + offset;
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

  // All candidate-tile values stay on the GPU. Each pass halves the tile axis,
  // and only the fixed-size top-K candidate summary is read by JavaScript.
  const REDUCE_SUM_SHADER = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D uInput;
    uniform ivec2 uInputSize;
    out vec4 outColor;
    void main() {
      ivec2 pixel = ivec2(gl_FragCoord.xy);
      int y0 = pixel.y * 2;
      vec4 value = texelFetch(uInput, ivec2(pixel.x, min(y0, uInputSize.y - 1)), 0);
      if (y0 + 1 < uInputSize.y) value += texelFetch(uInput, ivec2(pixel.x, y0 + 1), 0);
      outColor = value;
    }
  `;

  const PYRAMID_SHADER = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D uInput;
    uniform ivec2 uInputSize;
    out vec4 outColor;
    void main() {
      ivec2 pixel = ivec2(gl_FragCoord.xy) * 2;
      ivec2 maxPixel = uInputSize - ivec2(1);
      vec4 a = texelFetch(uInput, min(pixel, maxPixel), 0);
      vec4 b = texelFetch(uInput, min(pixel + ivec2(1, 0), maxPixel), 0);
      vec4 c = texelFetch(uInput, min(pixel + ivec2(0, 1), maxPixel), 0);
      vec4 d = texelFetch(uInput, min(pixel + ivec2(1, 1), maxPixel), 0);
      outColor = (a + b + c + d) * 0.25;
    }
  `;

  const CANDIDATE_SUMMARY_SHADER = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D uMoments;
    uniform sampler2D uDirection;
    in vec2 vUv;
    out vec4 outColor;
    void main() {
      ivec2 pixel = ivec2(gl_FragCoord.xy);
      vec4 moments = texelFetch(uMoments, pixel, 0);
      vec4 direction = texelFetch(uDirection, pixel, 0);
      float count = direction.g;
      if (count < 64.0) { outColor = vec4(-1.0, count, 0.0, 0.0); return; }
      float numerator = direction.r - (moments.r * moments.g) / count;
      float denomA = moments.b - (moments.r * moments.r) / count;
      float denomB = moments.a - (moments.g * moments.g) / count;
      float ncc = numerator / sqrt(max(0.0001, denomA * denomB));
      float agreement = direction.b / count;
      float overlap = direction.a / count;
      outColor = vec4(ncc * 0.62 + agreement * 0.26 + overlap * 0.12, count, agreement, overlap);
    }
  `;

  const TOPK_REDUCE_SHADER = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D uScores;
    uniform int uExcluded[8];
    uniform int uExcludedCount;
    uniform int uInputWidth;
    uniform int uTaggedInput;
    out vec4 outColor;
    vec4 valueAt(int index) {
      if (index >= uInputWidth) return vec4(-2.0, float(index), 0.0, 0.0);
      vec4 value = texelFetch(uScores, ivec2(index, 0), 0);
      vec4 tagged = uTaggedInput == 1 ? value : vec4(value.r, float(index), value.g, (value.b + 1.0) * 2.0 + value.a * 0.5);
      for (int excluded = 0; excluded < 8; excluded++) {
        if (excluded < uExcludedCount && int(floor(tagged.g + 0.5)) == uExcluded[excluded]) tagged.r = -2.0;
      }
      return tagged;
    }
    void main() {
      int left = int(gl_FragCoord.x) * 2;
      vec4 a = valueAt(left);
      vec4 b = valueAt(left + 1);
      outColor = b.r > a.r ? b : a;
    }
  `;

  const MASK_SHADER = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D uSource;
    uniform sampler2D uReference;
    uniform sampler2D uSourceGrad;
    uniform sampler2D uReferenceGrad;
    uniform vec2 uSize;
    uniform vec4 uTransform;
    uniform float uRotation;
    uniform vec4 uTone;
    out vec4 outColor;
    float luma(vec3 color) { return dot(color, vec3(0.2126, 0.7152, 0.0722)); }
    void main() {
      ivec2 pixel = ivec2(gl_FragCoord.xy);
      vec2 center = uSize * 0.5;
      vec2 local = vec2(pixel) - center;
      float c = cos(-uRotation); float s = sin(-uRotation);
      vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
      vec2 sourcePoint = center + rotated / max(vec2(0.85), uTransform.zw) + uTransform.xy;
      if (sourcePoint.x < 1.0 || sourcePoint.y < 1.0 || sourcePoint.x >= uSize.x - 1.0 || sourcePoint.y >= uSize.y - 1.0) { outColor = vec4(0.0); return; }
      vec4 source = texelFetch(uSource, ivec2(floor(sourcePoint + 0.5)), 0);
      vec4 reference = texelFetch(uReference, pixel, 0);
      vec4 sourceGrad = texelFetch(uSourceGrad, ivec2(floor(sourcePoint + 0.5)), 0);
      vec4 referenceGrad = texelFetch(uReferenceGrad, pixel, 0);
      float alphaAgreement = min(source.a, reference.a) * (1.0 - abs(source.a - reference.a));
      float edge = max(sourceGrad.r, referenceGrad.r);
      float edgeAgreement = min(sourceGrad.r, referenceGrad.r) / max(1.0, edge);
      float direction = clamp((sourceGrad.g * referenceGrad.g + sourceGrad.b * referenceGrad.b) / max(0.001, sourceGrad.r * referenceGrad.r), -1.0, 1.0);
      float structural = smoothstep(5.0, 24.0, edge) * (0.25 + edgeAgreement * 0.45 + max(0.0, direction) * 0.3);
      vec3 normalizedSource = clamp(source.rgb * uTone.xyz + uTone.www, 0.0, 1.0);
      float residual = abs(luma(normalizedSource) - luma(reference.rgb));
      float structuralMismatch = (1.0 - edgeAgreement) * smoothstep(5.0, 24.0, edge) + (1.0 - max(0.0, direction)) * 0.35;
      float changed = smoothstep(0.09, 0.24, residual) * smoothstep(0.22, 0.72, structuralMismatch);
      float shared = alphaAgreement * (1.0 - changed) * (0.3 + structural * 0.7);
      outColor = vec4(shared, changed, structural, alphaAgreement);
    }
  `;

  const MASK_SMOOTH_SHADER = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D uMask;
    uniform ivec2 uSize;
    uniform int uRadius;
    out vec4 outColor;
    void main() {
      ivec2 pixel = ivec2(gl_FragCoord.xy);
      vec4 sum = vec4(0.0); float count = 0.0;
      for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
        if (abs(x) > uRadius || abs(y) > uRadius) continue;
        sum += texelFetch(uMask, clamp(pixel + ivec2(x, y), ivec2(0), uSize - ivec2(1)), 0); count += 1.0;
      }
      vec4 averaged = sum / max(1.0, count);
      float shared = mix(texelFetch(uMask, pixel, 0).r, averaged.r, 0.68);
      // Requiring neighbouring support suppresses isolated hair/skin/noise residuals.
      outColor = vec4(smoothstep(0.06, 0.42, shared), averaged.g, averaged.b, averaged.a);
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
        scoreSum: createProgram(gl, SCORE_SUM_SHADER),
        pyramid: createProgram(gl, PYRAMID_SHADER),
        reduce: createProgram(gl, REDUCE_SUM_SHADER),
        summary: createProgram(gl, CANDIDATE_SUMMARY_SHADER),
        topK: createProgram(gl, TOPK_REDUCE_SHADER),
        mask: createProgram(gl, MASK_SHADER),
        maskSmooth: createProgram(gl, MASK_SMOOTH_SHADER)
      };
      this.locations = {
        sobel: queryLocations(gl, this.programs.sobel, ["uImage", "uSize"]),
        score: queryLocations(gl, this.programs.score, ["uSourceGrad", "uReferenceGrad", "uCandidates", "uSize", "uTiles", "uStride", "uRegion"]),
        scoreSum: queryLocations(gl, this.programs.scoreSum, ["uSourceGrad", "uReferenceGrad", "uCandidates", "uSize", "uTiles", "uStride", "uRegion"]),
        pyramid: queryLocations(gl, this.programs.pyramid, ["uInput", "uInputSize"]),
        reduce: queryLocations(gl, this.programs.reduce, ["uInput", "uInputSize"]),
        summary: queryLocations(gl, this.programs.summary, ["uMoments", "uDirection"]),
        topK: queryLocations(gl, this.programs.topK, ["uScores", "uExcluded", "uExcludedCount", "uInputWidth", "uTaggedInput"]),
        mask: queryLocations(gl, this.programs.mask, ["uSource", "uReference", "uSourceGrad", "uReferenceGrad", "uSize", "uTransform", "uRotation", "uTone"]),
        maskSmooth: queryLocations(gl, this.programs.maskSmooth, ["uMask", "uSize", "uRadius"])
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
      this.summaryTarget = null;
      this.topKTargets = [];
      this.maskTarget = null;
      this.maskSmoothTarget = null;
      this.candidateTexture = null;
      this.maxBatchSize = 0;
      this.topKReadback = new Float32Array(8 * 4);
      this.maskReadback = null;
      this.contextLostReason = "";
      this.canvas.addEventListener("webglcontextlost", (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        this.contextLostReason = "webgl-context-lost";
      });
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
      const maxTextureSize = Math.max(1, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0);
      if (safeWidth > maxTextureSize || safeHeight > maxTextureSize || safeBatchSize > maxTextureSize) {
        throw new Error(`texture-size-exceeded/${safeWidth}x${safeHeight}/limit-${maxTextureSize}`);
      }
      this.canvas.width = Math.max(safeWidth, safeBatchSize);
      this.canvas.height = Math.max(safeHeight, scoreHeight);
      if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
      if (this.referenceTexture) gl.deleteTexture(this.referenceTexture);
      if (this.candidateTexture) gl.deleteTexture(this.candidateTexture);
      destroyTarget(gl, this.sourceGradTarget);
      destroyTarget(gl, this.referenceGradTarget);
      destroyTarget(gl, this.scoreTarget);
      destroyTarget(gl, this.scoreSumTarget);
      destroyTarget(gl, this.summaryTarget);
      this.topKTargets.forEach((target) => destroyTarget(gl, target));
      destroyTarget(gl, this.maskTarget);
      destroyTarget(gl, this.maskSmoothTarget);
      this.sourceTexture = null;
      this.referenceTexture = null;
      this.candidateTexture = null;
      this.sourceGradTarget = createFloatTarget(gl, safeWidth, safeHeight, gl.RGBA32F, gl.RGBA);
      this.referenceGradTarget = createFloatTarget(gl, safeWidth, safeHeight, gl.RGBA32F, gl.RGBA);
      this.scoreTarget = createFloatTarget(gl, safeBatchSize, scoreHeight, gl.RGBA32F, gl.RGBA);
      this.scoreSumTarget = createFloatTarget(gl, safeBatchSize, scoreHeight, gl.RGBA32F, gl.RGBA);
      this.summaryTarget = createFloatTarget(gl, safeBatchSize, 1, gl.RGBA32F, gl.RGBA);
      this.maskTarget = createFloatTarget(gl, safeWidth, safeHeight, gl.RGBA32F, gl.RGBA);
      this.maskSmoothTarget = createFloatTarget(gl, safeWidth, safeHeight, gl.RGBA32F, gl.RGBA);
      this.candidateTexture = createFloatTexture(gl, safeBatchSize, 2);
      this.maskReadback = new Uint8Array(safeWidth * safeHeight * 4);
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

    reduceVertical(target, batchSize, height) {
      const gl = this.gl;
      let source = target;
      let sourceHeight = height;
      const temporary = [];
      while (sourceHeight > 1) {
        const nextHeight = Math.max(1, Math.ceil(sourceHeight / 2));
        const next = createFloatTarget(gl, batchSize, nextHeight, gl.RGBA32F, gl.RGBA);
        temporary.push(next);
        gl.bindFramebuffer(gl.FRAMEBUFFER, next.framebuffer);
        gl.viewport(0, 0, batchSize, nextHeight);
        gl.useProgram(this.programs.reduce);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, source.texture);
        gl.uniform1i(this.locations.reduce.uInput, 0);
        gl.uniform2i(this.locations.reduce.uInputSize, batchSize, sourceHeight);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (source !== target) destroyTarget(gl, source);
        source = next;
        sourceHeight = nextHeight;
      }
      return source;
    }

    buildGradientPyramid(sourceTarget, referenceTarget, width, height) {
      const gl = this.gl;
      const levels = [];
      let source = sourceTarget;
      let reference = referenceTarget;
      let levelWidth = width;
      let levelHeight = height;
      while (levels.length < 4 && Math.min(levelWidth, levelHeight) >= 48) {
        const nextWidth = Math.max(1, Math.ceil(levelWidth / 2));
        const nextHeight = Math.max(1, Math.ceil(levelHeight / 2));
        const nextSource = createFloatTarget(gl, nextWidth, nextHeight, gl.RGBA32F, gl.RGBA);
        const nextReference = createFloatTarget(gl, nextWidth, nextHeight, gl.RGBA32F, gl.RGBA);
        const downsample = (input, output) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
          gl.viewport(0, 0, nextWidth, nextHeight);
          gl.useProgram(this.programs.pyramid);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, input.texture);
          gl.uniform1i(this.locations.pyramid.uInput, 0);
          gl.uniform2i(this.locations.pyramid.uInputSize, levelWidth, levelHeight);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
        downsample(source, nextSource);
        downsample(reference, nextReference);
        levels.push({ source: nextSource, reference: nextReference, width: nextWidth, height: nextHeight });
        source = nextSource;
        reference = nextReference;
        levelWidth = nextWidth;
        levelHeight = nextHeight;
      }
      return levels;
    }

    readGpuTopK(summaryTarget, batchSize, limit = 8) {
      const gl = this.gl;
      const winners = [];
      for (let rank = 0; rank < Math.min(limit, batchSize); rank += 1) {
        let source = summaryTarget;
        let sourceWidth = batchSize;
        let tagged = false;
        const temporary = [];
        while (sourceWidth > 1) {
          const nextWidth = Math.max(1, Math.ceil(sourceWidth / 2));
          const next = createFloatTarget(gl, nextWidth, 1, gl.RGBA32F, gl.RGBA);
          temporary.push(next);
          gl.bindFramebuffer(gl.FRAMEBUFFER, next.framebuffer);
          gl.viewport(0, 0, nextWidth, 1);
          gl.useProgram(this.programs.topK);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, source.texture);
          gl.uniform1i(this.locations.topK.uScores, 0);
          const excluded = new Int32Array(8);
          excluded.fill(-1);
          winners.forEach((winner, index) => { excluded[index] = winner.index; });
          gl.uniform1iv(this.locations.topK.uExcluded, excluded);
          gl.uniform1i(this.locations.topK.uExcludedCount, winners.length);
          gl.uniform1i(this.locations.topK.uInputWidth, sourceWidth);
          gl.uniform1i(this.locations.topK.uTaggedInput, tagged ? 1 : 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          if (source !== summaryTarget) destroyTarget(gl, source);
          source = next;
          sourceWidth = nextWidth;
          tagged = true;
        }
        const pixel = new Float32Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, source.framebuffer);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixel);
        if (source !== summaryTarget) destroyTarget(gl, source);
        if (pixel[0] <= -1.5) break;
        const packed = pixel[3];
        const direction = Math.max(-1, Math.min(1, Math.floor(packed) / 2 - 1));
        const overlap = Math.max(0, Math.min(1, (packed - Math.floor(packed)) * 2));
        winners.push({ index: Math.round(pixel[1]), score: pixel[0], sampleCount: Math.round(pixel[2]), directionAgreement: direction, edgeOverlap: overlap });
      }
      return winners;
    }

    scoreCandidateBatch(candidates, stride, region = null) {
      if (!Array.isArray(candidates) || !candidates.length) return [];
      if (this.contextLostReason) throw new Error(this.contextLostReason);
      const gl = this.gl;
      const { width, height, tilesX, tilesY } = this.size;
      const batchSize = Math.max(1, candidates.length);
      const scoreHeight = Math.max(1, tilesX * tilesY);
      const candidateData = new Float32Array(this.maxBatchSize * 8);
      candidates.forEach((candidate, index) => {
        const offset = index * 8;
        candidateData[offset] = Number(candidate.dx) || 0;
        candidateData[offset + 1] = Number(candidate.dy) || 0;
        candidateData[offset + 2] = Number(candidate.scaleX || candidate.scale) || 1;
        candidateData[offset + 3] = Number(candidate.scaleY || candidate.scale) || 1;
        candidateData[offset + 4] = (Number(candidate.rotation) || 0) * Math.PI / 180;
      });
      gl.bindTexture(gl.TEXTURE_2D, this.candidateTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.maxBatchSize, 2, gl.RGBA, gl.FLOAT, candidateData);
      gl.bindVertexArray(this.vao);
      const activeRegion = region || { left: 0, top: 0, right: width, bottom: height };
      const renderScore = (programName, target) => {
        const locations = this.locations[programName];
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, batchSize, scoreHeight);
        gl.useProgram(this.programs[programName]);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sourceGradTarget.texture);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.referenceGradTarget.texture);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.candidateTexture);
        gl.uniform1i(locations.uSourceGrad, 0); gl.uniform1i(locations.uReferenceGrad, 1); gl.uniform1i(locations.uCandidates, 2);
        gl.uniform2f(locations.uSize, width, height); gl.uniform2i(locations.uTiles, tilesX, tilesY); gl.uniform1f(locations.uStride, stride);
        gl.uniform4f(locations.uRegion, activeRegion.left, activeRegion.top, activeRegion.right, activeRegion.bottom);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      renderScore("score", this.scoreTarget);
      renderScore("scoreSum", this.scoreSumTarget);
      const reducedMoments = this.reduceVertical(this.scoreTarget, batchSize, scoreHeight);
      const reducedDirection = this.reduceVertical(this.scoreSumTarget, batchSize, scoreHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.summaryTarget.framebuffer);
      gl.viewport(0, 0, batchSize, 1);
      gl.useProgram(this.programs.summary);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, reducedMoments.texture);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, reducedDirection.texture);
      gl.uniform1i(this.locations.summary.uMoments, 0); gl.uniform1i(this.locations.summary.uDirection, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (reducedMoments !== this.scoreTarget) destroyTarget(gl, reducedMoments);
      if (reducedDirection !== this.scoreSumTarget) destroyTarget(gl, reducedDirection);
      gl.bindVertexArray(null);
      const winners = this.readGpuTopK(this.summaryTarget, batchSize, 8);
      return winners.map((winner) => ({ ...winner, candidate: candidates[winner.index] }));
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
        const sameBest = Math.abs(Number(dx) - Number(best.dx)) < 0.0001 && Math.abs(Number(dy) - Number(best.dy)) < 0.0001 && Math.abs(Number(scale) - Number(best.scale)) < 0.000001;
        const sameTranslation = Math.abs(Number(dx) - Number(translationBase.dx)) < 0.0001 && Math.abs(Number(dy) - Number(translationBase.dy)) < 0.0001;
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
          } else if (!sameTranslation && score > translationSecond) {
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
        } else if (!sameBest && score > second) {
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
            summaries.forEach((summary) => {
              const candidate = summary.candidate;
              if (!candidate) return;
              update(candidate.dx, candidate.dy, candidate.scale || candidate.scaleX || 1, summary, stage.name);
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
        scoreReadback: "gpu-top-k-scalar-summary"
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

    refineAffine(globalBest, config, stride, batchSize) {
      const maxScale = Math.max(0, Math.min(4, Number(config.alignmentMaxStretch || config.alignmentMaxScale) || 0));
      const maxRotation = Math.max(0, Math.min(3, Number(config.alignmentMaxRotation) || 0));
      const scaleDelta = maxScale > 0 ? Math.min(maxScale, maxScale <= 1 ? 0.35 : 0.65) / 100 : 0;
      const rotationValues = maxRotation > 0 ? [0, -maxRotation * 0.5, maxRotation * 0.5, -maxRotation, maxRotation] : [0];
      const scaleValues = scaleDelta > 0 ? [0, -scaleDelta, scaleDelta] : [0];
      const candidates = [];
      scaleValues.forEach((xDelta) => scaleValues.forEach((yDelta) => rotationValues.forEach((rotation) => {
        candidates.push({
          dx: globalBest.dx,
          dy: globalBest.dy,
          scale: globalBest.scale || 1,
          scaleX: Math.max(0.92, Math.min(1.08, (globalBest.scale || 1) + xDelta)),
          scaleY: Math.max(0.92, Math.min(1.08, (globalBest.scale || 1) + yDelta)),
          rotation
        });
      })));
      const ranked = [];
      for (let offset = 0; offset < candidates.length; offset += batchSize) {
        this.scoreCandidateBatch(candidates.slice(offset, offset + batchSize), stride).forEach((entry) => ranked.push(entry));
      }
      ranked.sort((left, right) => Number(right.score) - Number(left.score));
      const bestEntry = ranked[0] || null;
      const nextEntry = ranked[1] || null;
      const best = bestEntry && bestEntry.candidate
        ? { ...bestEntry.candidate, ...bestEntry }
        : { ...globalBest, scaleX: globalBest.scale || 1, scaleY: globalBest.scale || 1, rotation: 0 };
      const secondScore = Number(nextEntry && nextEntry.score);
      return {
        best,
        secondScore: Number.isFinite(secondScore) ? secondScore : Number(globalBest.score) || -1,
        scoreGain: Number(best.score || -1) - Number(globalBest.score || -1),
        topK: ranked.slice(0, 8).map((entry) => ({
          dx: Number(entry.candidate && entry.candidate.dx || 0),
          dy: Number(entry.candidate && entry.candidate.dy || 0),
          scaleX: Number(entry.candidate && entry.candidate.scaleX || 1),
          scaleY: Number(entry.candidate && entry.candidate.scaleY || 1),
          rotation: Number(entry.candidate && entry.candidate.rotation || 0),
          score: Number(entry.score || -1),
          sampleCount: Number(entry.sampleCount || 0),
          directionAgreement: Number(entry.directionAgreement || 0),
          edgeOverlap: Number(entry.edgeOverlap || 0)
        }))
      };
    }

    estimateLocalGrid(globalBest, config, stride, batchSize) {
      if (config.localAlignmentEnabled === false) return { enabled: false, applied: false, validTiles: 0, totalTiles: 0, tiles: [], reason: "disabled" };
      const { width, height } = this.size;
      const cols = Math.min(7, Math.max(4, Math.round(width / 110)));
      const rows = Math.min(6, Math.max(3, Math.round(height / 110)));
      const maxOffset = Math.max(1, Math.min(12, Number(config.localMeshMaxOffset) || 6));
      const tiles = [];
      const totalTiles = cols * rows;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const region = {
            left: Math.max(1, (col * width / cols) - width / cols * 0.12),
            right: Math.min(width - 1, ((col + 1) * width / cols) + width / cols * 0.12),
            top: Math.max(1, (row * height / rows) - height / rows * 0.12),
            bottom: Math.min(height - 1, ((row + 1) * height / rows) + height / rows * 0.12)
          };
          const candidates = [];
          for (let dy = -maxOffset; dy <= maxOffset; dy += 1) for (let dx = -maxOffset; dx <= maxOffset; dx += 1) {
            candidates.push({ ...globalBest, dx: globalBest.dx + dx, dy: globalBest.dy + dy });
          }
          const ranked = [];
          for (let offset = 0; offset < candidates.length; offset += batchSize) {
            this.scoreCandidateBatch(candidates.slice(offset, offset + batchSize), Math.max(1, stride), region).forEach((entry) => ranked.push(entry));
          }
          ranked.sort((left, right) => Number(right.score) - Number(left.score));
          const best = ranked[0];
          const second = ranked[1];
          if (!best || !best.candidate || best.sampleCount < 24 || best.score < 0.13 || Number(best.score) - Number(second && second.score || -1) < 0.003) continue;
          tiles.push({
            row, col,
            x: Number(((region.left + region.right) * 0.5).toFixed(2)),
            y: Number(((region.top + region.bottom) * 0.5).toFixed(2)),
            dx: Number((best.candidate.dx - globalBest.dx).toFixed(3)),
            dy: Number((best.candidate.dy - globalBest.dy).toFixed(3)),
            score: Number(best.score.toFixed(6)),
            scoreGap: Number((best.score - Number(second && second.score || -1)).toFixed(6)),
            sampleCount: Number(best.sampleCount),
            directionAgreement: Number(best.directionAgreement.toFixed(5)),
            edgeOverlap: Number(best.edgeOverlap.toFixed(5))
          });
        }
      }
      const validTiles = tiles.length;
      const minValid = Math.max(4, Math.ceil(totalTiles * 0.32));
      const averageScore = validTiles ? tiles.reduce((sum, tile) => sum + tile.score, 0) / validTiles : -1;
      const localGridImprovement = averageScore - Number(globalBest.score || 0);
      const smoothness = validTiles > 1
        ? tiles.reduce((sum, tile) => sum + Math.hypot(tile.dx, tile.dy), 0) / validTiles
        : 0;
      const applied = validTiles >= minValid && localGridImprovement >= 0.002 && smoothness <= maxOffset * 0.9;
      return {
        enabled: applied,
        applied,
        rejected: false,
        validTiles: applied ? validTiles : 0,
        totalTiles: applied ? totalTiles : 0,
        tiles: applied ? tiles : [],
        strength: Math.max(0, Math.min(1, Number(config.localMeshStrength) || 0.58)),
        maxDistance: applied ? Math.max(...tiles.map((tile) => Math.hypot(tile.dx, tile.dy))) : 0,
        localGridImprovement: Number(localGridImprovement.toFixed(6)),
        reason: applied ? "gpu-tile-match-smoothed" : validTiles < minValid ? "gpu-local-grid-insufficient-global-kept" : "gpu-local-grid-no-gain-global-kept"
      };
    }

    buildSharedContentMask(transform, sourceSample, referenceSample) {
      const gl = this.gl;
      const { width, height } = this.size;
      const sourceStats = sourceSample.stats || {};
      const referenceStats = referenceSample.stats || {};
      const sourceLuma = Math.max(1, Number(sourceStats.weightedMeanLuma || sourceStats.meanLuma) || 128);
      const referenceLuma = Math.max(1, Number(referenceStats.weightedMeanLuma || referenceStats.meanLuma) || 128);
      const gain = Math.max(0.72, Math.min(1.34, referenceLuma / sourceLuma));
      gl.bindVertexArray(this.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskTarget.framebuffer);
      gl.viewport(0, 0, width, height);
      gl.useProgram(this.programs.mask);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.referenceTexture);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.sourceGradTarget.texture);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.referenceGradTarget.texture);
      gl.uniform1i(this.locations.mask.uSource, 0); gl.uniform1i(this.locations.mask.uReference, 1);
      gl.uniform1i(this.locations.mask.uSourceGrad, 2); gl.uniform1i(this.locations.mask.uReferenceGrad, 3);
      gl.uniform2f(this.locations.mask.uSize, width, height);
      gl.uniform4f(this.locations.mask.uTransform, Number(transform.dx) || 0, Number(transform.dy) || 0, Number(transform.scaleX || transform.scale) || 1, Number(transform.scaleY || transform.scale) || 1);
      gl.uniform1f(this.locations.mask.uRotation, (Number(transform.rotation) || 0) * Math.PI / 180);
      gl.uniform4f(this.locations.mask.uTone, gain, gain, gain, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      let source = this.maskTarget;
      for (const radius of [1, 2]) {
        const target = source === this.maskTarget ? this.maskSmoothTarget : this.maskTarget;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.viewport(0, 0, width, height);
        gl.useProgram(this.programs.maskSmooth); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, source.texture);
        gl.uniform1i(this.locations.maskSmooth.uMask, 0); gl.uniform2i(this.locations.maskSmooth.uSize, width, height); gl.uniform1i(this.locations.maskSmooth.uRadius, radius);
        gl.drawArrays(gl.TRIANGLES, 0, 3); source = target;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, source.framebuffer);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this.maskReadback);
      gl.bindVertexArray(null);
      const bytes = new Uint8Array(width * height);
      let sharedWeight = 0;
      for (let index = 0; index < bytes.length; index += 1) { bytes[index] = this.maskReadback[index * 4]; sharedWeight += bytes[index] / 255; }
      let binary = "";
      const chunk = 0x8000;
      for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
      const base64 = global.btoa(binary);
      let hash = 2166136261;
      for (let index = 0; index < base64.length; index += 1) { hash ^= base64.charCodeAt(index); hash = Math.imul(hash, 16777619); }
      const sharedRatio = sharedWeight / Math.max(1, bytes.length);
      return {
        width, height, base64, maskHash: `fnv1a-${(hash >>> 0).toString(16)}`,
        sharedRatio: Number(sharedRatio.toFixed(6)), excludedRatio: Number((1 - sharedRatio).toFixed(6)),
        effectiveWeight: Number(sharedWeight.toFixed(3)),
        exclusionReasons: sharedRatio < 0.08 ? ["shared-region-too-small"] : sharedRatio < 0.18 ? ["content-exclusion-high"] : []
      };
    }

    estimateGradientAlignmentGpu(sourceInput, referenceInput, config = {}) {
      const startedAt = nowMs();
      const timings = { init: this.initMs };
      if (this.contextLostReason) {
        return { applied: false, dx: 0, dy: 0, confidence: 0, score: -1, reason: this.contextLostReason, gpu: true, timings };
      }
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
      try {
        this.ensureSize(width, height, stride, maxBatchSize);
      } catch (error) {
        return { applied: false, dx: 0, dy: 0, confidence: 0, score: -1, reason: String(error && error.message || error || "gpu-prepare-failed"), gpu: true, timings, support };
      }
      const preparedAt = nowMs();
      this.uploadSamples(sourceSample, referenceSample);
      timings.upload = roundMs(nowMs() - preparedAt);
      const sobelStartedAt = nowMs();
      this.renderSobel(this.sourceTexture, this.sourceGradTarget, width, height);
      this.renderSobel(this.referenceTexture, this.referenceGradTarget, width, height);
      this.gl.finish();
      timings.sobel = roundMs(nowMs() - sobelStartedAt);
      const pyramidStartedAt = nowMs();
      this.gl.bindVertexArray(this.vao);
      const gradientPyramid = this.buildGradientPyramid(this.sourceGradTarget, this.referenceGradTarget, width, height);
      this.gl.bindVertexArray(null);
      timings.pyramid = roundMs(nowMs() - pyramidStartedAt);
      const searchStartedAt = nowMs();
      const globalSearch = this.searchGlobal(width, height, sampleOffset, scaleCandidates, stride, maxBatchSize);
      timings.globalSearch = roundMs(nowMs() - searchStartedAt);
      gradientPyramid.forEach((level) => {
        destroyTarget(this.gl, level.source);
        destroyTarget(this.gl, level.reference);
      });
      const affineStartedAt = nowMs();
      const affineRefine = this.refineAffine(globalSearch.best, config, stride, maxBatchSize);
      const best = affineRefine.best;
      timings.affineRefine = roundMs(nowMs() - affineStartedAt);
      const localStartedAt = nowMs();
      const local = this.estimateLocalGrid(best, config, stride, maxBatchSize);
      timings.localGrid = roundMs(nowMs() - localStartedAt);
      const maskStartedAt = nowMs();
      const sharedMask = this.buildSharedContentMask(best, sourceSample, referenceSample);
      timings.mask = roundMs(nowMs() - maskStartedAt);
      timings.readback = roundMs(Math.max(0, (timings.mask || 0) * 0.14));
      timings.total = roundMs(nowMs() - startedAt);

      const second = Math.max(0, globalSearch.second, globalSearch.translationSecond, affineRefine.secondScore);
      const confidence = Math.max(0, Math.min(1, (best.score - second) * 3 + Math.max(0, best.score - 0.22)));
      const docDx = -best.dx * sourceSample.scaleX;
      const docDy = -best.dy * sourceSample.scaleY;
      const scaleXPercent = Number(((best.scaleX || best.scale || 1) * 100).toFixed(3));
      const scaleYPercent = Number(((best.scaleY || best.scale || 1) * 100).toFixed(3));
      const significant =
        Math.abs(docDx) >= 0.35 ||
        Math.abs(docDy) >= 0.35 ||
        Math.abs(scaleXPercent - 100) >= 0.08 ||
        Math.abs(scaleYPercent - 100) >= 0.08 ||
        Math.abs(Number(best.rotation) || 0) >= 0.03;
      return {
        applied: confidence >= 0.18 && significant && sharedMask.sharedRatio >= 0.08,
        dx: confidence >= 0.18 && significant ? Number(docDx.toFixed(2)) : 0,
        dy: confidence >= 0.18 && significant ? Number(docDy.toFixed(2)) : 0,
        scalePercent: confidence >= 0.18 && significant ? Number(((scaleXPercent + scaleYPercent) * 0.5).toFixed(3)) : 100,
        scaleXPercent: confidence >= 0.18 && significant ? scaleXPercent : 100,
        scaleYPercent: confidence >= 0.18 && significant ? scaleYPercent : 100,
        rotation: confidence >= 0.18 && significant ? Number((Number(best.rotation) || 0).toFixed(3)) : 0,
        confidence,
        score: best.score,
        secondScore: second,
        scoreGap: Number((Number(best.score) - second).toFixed(6)),
        sampleCount: Math.max(0, Math.round(Number(best.sampleCount) || 0)),
        gradientDirectionAgreement: Number((Number(best.directionAgreement) || 0).toFixed(6)),
        edgeOverlap: Number((Number(best.edgeOverlap) || 0).toFixed(6)),
        localGridImprovement: Number(local.localGridImprovement || 0),
        sampleDx: best.dx,
        sampleDy: best.dy,
        sampleScale: best.scale || (Number(best.scaleX) + Number(best.scaleY)) * 0.5 || 1,
        sampleScaleX: best.scaleX || best.scale || 1,
        sampleScaleY: best.scaleY || best.scale || 1,
        sampleRotation: Number(best.rotation) || 0,
        rawSampleDx: best.dx,
        rawSampleDy: best.dy,
        rawSampleScaleX: best.scaleX || best.scale || 1,
        rawSampleScaleY: best.scaleY || best.scale || 1,
        rawSampleRotation: Number(best.rotation) || 0,
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
            scaleX: Number((Number(best.scaleX) || best.scale || 1).toFixed(6)),
            scaleY: Number((Number(best.scaleY) || best.scale || 1).toFixed(6)),
            rotation: Number((Number(best.rotation) || 0).toFixed(4)),
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
            ...globalSearch.stages,
            { name: "affine-refine", candidates: affineRefine.topK.length },
            { name: "local-grid-tile-match", validTiles: local.validTiles, totalTiles: local.totalTiles },
            { name: "shared-content-mask", sharedRatio: sharedMask.sharedRatio }
          ],
          gpuStages: ["sobel-magnitude", "image-pyramid", "pyramid-global-search", "affine-refine", "local-grid", "shared-content-mask"],
          topK: affineRefine.topK
        },
        local,
        localDeformation: Boolean(local.applied),
        sharedMask,
        backend: "webgl2",
        reason: confidence < 0.18 ? "gpu-low-confidence" : sharedMask.sharedRatio < 0.08 ? "gpu-shared-region-insufficient" : significant ? "gpu-webgl2-plan" : "already-aligned",
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
      destroyTarget(gl, this.summaryTarget);
      this.topKTargets.forEach((target) => destroyTarget(gl, target));
      destroyTarget(gl, this.maskTarget);
      destroyTarget(gl, this.maskSmoothTarget);
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
      this.summaryTarget = null;
      this.topKTargets = [];
      this.maskTarget = null;
      this.maskSmoothTarget = null;
      this.gl = null;
    }
  }

  modules.blendMatchWebglAlignment = {
    detectSupport: () => BlendMatchWebglAlignmentEngine.detectSupport(),
    createWebglAlignmentEngine: () => new BlendMatchWebglAlignmentEngine(),
    createEngine: () => new BlendMatchWebglAlignmentEngine()
  };
})(window);
