(function initGlowWebglCompositorModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  const VERTEX_SHADER = `#version 300 es
    in vec2 aPosition;
    out vec2 vUv;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const COMPOSITE_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uBase;
    uniform sampler2D uGlow;
    uniform sampler2D uMasks;
    uniform float uIntensity;
    uniform float uSoftAddMix;
    uniform float uWarmth;
    uniform float uSaturation;
    uniform float uHighlightProtect;
    uniform float uShadowProtect;
    uniform float uColorProtect;
    uniform float uShoulder;
    uniform float uColorShift;
    uniform vec3 uColorTint;
    uniform float uColorAmount;
    uniform float uChromaticOffset;
    uniform float uChromaticAmount;
    uniform float uCoreSuppression;
    uniform float uCoreCeiling;
    uniform float uHaloBoost;
    uniform float uHaloMix;
    uniform float uSourceAnchorBase;
    uniform float uSourceAnchorAmount;
    uniform float uEnergyFloor;
    uniform float uEnergyFloorSoftness;
    uniform vec2 uTexel;
    in vec2 vUv;
    out vec4 outColor;

    float saturate(float value) {
      return clamp(value, 0.0, 1.0);
    }

    float softShoulder(float value, float shoulder) {
      float safeShoulder = clamp(shoulder, 0.04, 0.95);
      return value / (1.0 + value * safeShoulder);
    }

    float linearToSrgb(float value) {
      float v = max(0.0, value);
      return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055;
    }

    vec3 linearToSrgb(vec3 color) {
      return vec3(linearToSrgb(color.r), linearToSrgb(color.g), linearToSrgb(color.b));
    }

    float hashNoise(vec2 p, float channel) {
      return fract(sin(dot(p + vec2(channel * 17.17, channel * 3.31), vec2(12.9898, 78.233))) * 43758.5453);
    }

    vec3 applySaturation(vec3 color, float saturation) {
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      return vec3(luma) + (color - vec3(luma)) * saturation;
    }

    vec3 applyGlowColorShift(vec3 color) {
      float amount = clamp(uColorShift, -1.0, 1.0);
      if (amount >= 0.0) {
        return color * vec3(1.0 + amount * 0.34, 1.0 + amount * 0.1, 1.0 - amount * 0.24);
      }
      float cool = -amount;
      return color * vec3(1.0 - cool * 0.18, 1.0 + cool * 0.04, 1.0 + cool * 0.38);
    }

    vec3 applyGlowTint(vec3 color) {
      float amount = clamp(uColorAmount, 0.0, 1.0);
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 tinted = luma * uColorTint * 1.32;
      return mix(color, tinted, amount);
    }

    vec3 splitCoreAndHalo(vec3 glow, float baseLuma, float protect, float source, float haloSource) {
      float haloBoost = max(0.0, uHaloBoost);
      float haloMix = clamp(uHaloMix, 0.0, 1.0);
      float baseGuard = 1.0 - clamp(baseLuma, 0.0, 1.0) * 0.018;
      float protectGuard = 1.0 - clamp(protect, 0.0, 1.0) * 0.035;
      float diffusionGain = 1.0 + haloMix * 0.16 + max(0.0, haloBoost - 1.0) * 0.06;
      return clamp(glow * clamp(baseGuard * protectGuard * diffusionGain, 0.88, 1.18), 0.0, 1.0);
    }

    vec3 visibilityGate(vec3 glow) {
      if (uEnergyFloor <= 0.000001) return glow;
      vec3 gate = smoothstep(vec3(uEnergyFloor), vec3(uEnergyFloor + uEnergyFloorSoftness), glow);
      return glow * gate;
    }

    vec3 computeGlow(vec3 glowLayer, vec3 fringe, vec4 masks) {
      float baseLuma = masks.r;
      float protect = masks.g;
      float source = masks.a;
      float haloSource = masks.b;
      float baseMax = max(max(texture(uBase, vUv).r, texture(uBase, vUv).g), texture(uBase, vUv).b);
      float baseMin = min(min(texture(uBase, vUv).r, texture(uBase, vUv).g), texture(uBase, vUv).b);
      float baseSat = baseMax <= 0.0 ? 0.0 : (baseMax - baseMin) / baseMax;
      float highlightProtect = protect * uHighlightProtect * (0.5 + baseLuma * 0.78 + (1.0 - baseSat) * 0.08);
      float protectGain = clamp(1.0 - highlightProtect * 0.045, 0.9, 1.0);
      vec3 warmed = vec3(
        glowLayer.r * (1.0 + uWarmth),
        glowLayer.g * (1.0 + uWarmth * 0.35),
        glowLayer.b * (1.0 - uWarmth * 0.28)
      );
      warmed = applyGlowColorShift(warmed);
      warmed = applyGlowTint(warmed);
      warmed += fringe;
      vec3 saturated = applySaturation(warmed, uSaturation);
      vec3 glow = clamp(vec3(
        softShoulder(max(0.0, saturated.r) * uIntensity * protectGain, uShoulder),
        softShoulder(max(0.0, saturated.g) * uIntensity * protectGain, uShoulder),
        softShoulder(max(0.0, saturated.b) * uIntensity * protectGain, uShoulder)
      ), 0.0, 1.0);
      return visibilityGate(splitCoreAndHalo(glow, baseLuma, protect, source, haloSource));
    }

    void main() {
      vec4 base = texture(uBase, vUv);
      float protect = texture(uMasks, vUv).g;
      vec2 chroma = vec2(uChromaticOffset, 0.0) * uTexel;
      vec3 glowLayer = vec3(
        texture(uGlow, vUv + chroma).r,
        texture(uGlow, vUv).g,
        texture(uGlow, vUv - chroma).b
      );
      vec3 centerGlow = texture(uGlow, vUv).rgb;
      float centerMax = max(max(centerGlow.r, centerGlow.g), centerGlow.b);
      float chromaStrength = pow(clamp(uChromaticAmount, 0.0, 1.0), 1.02);
      float edgeGate = texture(uMasks, vUv).a * (0.68 + (1.0 - protect) * 0.32);
      vec3 fringe = vec3(
        max(0.0, glowLayer.r - centerMax * 0.62) * chromaStrength * 2.18 * edgeGate,
        0.0,
        max(0.0, glowLayer.b - centerMax * 0.62) * chromaStrength * 2.18 * edgeGate
      );
      vec3 glow = clamp(linearToSrgb(computeGlow(glowLayer, fringe, texture(uMasks, vUv))), 0.0, 1.0);
      vec3 previewDither = (vec3(
        hashNoise(gl_FragCoord.xy, 0.0),
        hashNoise(gl_FragCoord.xy, 1.0),
        hashNoise(gl_FragCoord.xy, 2.0)
      ) - vec3(0.5)) * (0.45 / 255.0);
      glow = clamp(glow + previewDither, 0.0, 1.0);
      vec3 screen = 1.0 - (1.0 - base.rgb) * (1.0 - glow);
      vec3 soft = clamp(base.rgb + glow * (1.0 - base.rgb * 0.62), 0.0, 1.0);
      float maxGlow = max(max(glow.r, glow.g), glow.b);
      float baseMax = max(max(base.r, base.g), base.b);
      float baseMin = min(min(base.r, base.g), base.b);
      float baseSat = baseMax <= 0.0 ? 0.0 : (baseMax - baseMin) / baseMax;
      float colorProtect = clamp(1.0 - maxGlow * uColorProtect * (0.88 + baseSat * 0.22), 0.86, 1.0);
      vec3 result = mix(screen, soft, uSoftAddMix) * colorProtect + base.rgb * (1.0 - colorProtect);
      outColor = vec4(clamp(result, 0.0, 1.0), base.a);
    }
  `;

  const GLOW_LAYER_SHADER = `#version 300 es
    precision highp float;
    uniform sampler2D uGlow;
    uniform sampler2D uMasks;
    uniform float uIntensity;
    uniform float uWarmth;
    uniform float uSaturation;
    uniform float uHighlightProtect;
    uniform float uShadowProtect;
    uniform float uShoulder;
    uniform float uColorShift;
    uniform vec3 uColorTint;
    uniform float uColorAmount;
    uniform float uChromaticOffset;
    uniform float uChromaticAmount;
    uniform float uCoreSuppression;
    uniform float uCoreCeiling;
    uniform float uHaloBoost;
    uniform float uHaloMix;
    uniform float uSourceAnchorBase;
    uniform float uSourceAnchorAmount;
    uniform float uEnergyFloor;
    uniform float uEnergyFloorSoftness;
    uniform vec2 uTexel;
    in vec2 vUv;
    out vec4 outColor;

    float saturate(float value) {
      return clamp(value, 0.0, 1.0);
    }

    float softShoulder(float value, float shoulder) {
      float safeShoulder = clamp(shoulder, 0.04, 0.95);
      return value / (1.0 + value * safeShoulder);
    }

    float linearToSrgb(float value) {
      float v = max(0.0, value);
      return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055;
    }

    vec3 linearToSrgb(vec3 color) {
      return vec3(linearToSrgb(color.r), linearToSrgb(color.g), linearToSrgb(color.b));
    }

    float hashNoise(vec2 p, float channel) {
      return fract(sin(dot(p + vec2(channel * 17.17, channel * 3.31), vec2(12.9898, 78.233))) * 43758.5453);
    }

    vec3 applySaturation(vec3 color, float saturation) {
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      return vec3(luma) + (color - vec3(luma)) * saturation;
    }

    vec3 applyGlowColorShift(vec3 color) {
      float amount = clamp(uColorShift, -1.0, 1.0);
      if (amount >= 0.0) {
        return color * vec3(1.0 + amount * 0.34, 1.0 + amount * 0.1, 1.0 - amount * 0.24);
      }
      float cool = -amount;
      return color * vec3(1.0 - cool * 0.18, 1.0 + cool * 0.04, 1.0 + cool * 0.38);
    }

    vec3 applyGlowTint(vec3 color) {
      float amount = clamp(uColorAmount, 0.0, 1.0);
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 tinted = luma * uColorTint * 1.32;
      return mix(color, tinted, amount);
    }

    vec3 splitCoreAndHalo(vec3 glow, float baseLuma, float protect, float source, float haloSource) {
      float haloBoost = max(0.0, uHaloBoost);
      float haloMix = clamp(uHaloMix, 0.0, 1.0);
      float baseGuard = 1.0 - clamp(baseLuma, 0.0, 1.0) * 0.018;
      float protectGuard = 1.0 - clamp(protect, 0.0, 1.0) * 0.035;
      float diffusionGain = 1.0 + haloMix * 0.16 + max(0.0, haloBoost - 1.0) * 0.06;
      return clamp(glow * clamp(baseGuard * protectGuard * diffusionGain, 0.88, 1.18), 0.0, 1.0);
    }

    vec3 visibilityGate(vec3 glow) {
      if (uEnergyFloor <= 0.000001) return glow;
      vec3 gate = smoothstep(vec3(uEnergyFloor), vec3(uEnergyFloor + uEnergyFloorSoftness), glow);
      return glow * gate;
    }

    void main() {
      vec2 chroma = vec2(uChromaticOffset, 0.0) * uTexel;
      vec3 glowLayer = vec3(
        texture(uGlow, vUv + chroma).r,
        texture(uGlow, vUv).g,
        texture(uGlow, vUv - chroma).b
      );
      vec3 centerGlow = texture(uGlow, vUv).rgb;
      float centerMax = max(max(centerGlow.r, centerGlow.g), centerGlow.b);
      vec4 masks = texture(uMasks, vUv);
      float baseLuma = masks.r;
      float source = masks.a;
      float haloSource = masks.b;
      float protect = masks.g;
      float chromaStrength = pow(clamp(uChromaticAmount, 0.0, 1.0), 1.02);
      float edgeGate = source * (0.68 + (1.0 - protect) * 0.32);
      vec3 fringe = vec3(
        max(0.0, glowLayer.r - centerMax * 0.62) * chromaStrength * 2.18 * edgeGate,
        0.0,
        max(0.0, glowLayer.b - centerMax * 0.62) * chromaStrength * 2.18 * edgeGate
      );
      float highlightProtect = protect * uHighlightProtect * 0.86;
      float protectGain = clamp(1.0 - highlightProtect * 0.045, 0.9, 1.0);
      vec3 warmed = vec3(
        glowLayer.r * (1.0 + uWarmth),
        glowLayer.g * (1.0 + uWarmth * 0.35),
        glowLayer.b * (1.0 - uWarmth * 0.28)
      );
      warmed = applyGlowColorShift(warmed);
      warmed = applyGlowTint(warmed);
      warmed += fringe;
      vec3 saturated = applySaturation(warmed, uSaturation);
      vec3 glow = clamp(vec3(
        softShoulder(max(0.0, saturated.r) * uIntensity * protectGain, uShoulder),
        softShoulder(max(0.0, saturated.g) * uIntensity * protectGain, uShoulder),
        softShoulder(max(0.0, saturated.b) * uIntensity * protectGain, uShoulder)
      ), 0.0, 1.0);
      glow = visibilityGate(splitCoreAndHalo(glow, baseLuma, protect, source, haloSource));
      vec3 encoded = linearToSrgb(glow);
      vec3 dither = (vec3(
        hashNoise(gl_FragCoord.xy, 0.0),
        hashNoise(gl_FragCoord.xy, 1.0),
        hashNoise(gl_FragCoord.xy, 2.0)
      ) - vec3(0.5)) * (0.75 / 255.0);
      outColor = vec4(clamp(encoded + dither, 0.0, 1.0), 1.0);
    }
  `;

  const FULLSCREEN_TRIANGLE = new Float32Array([
    -1, -1,
     3, -1,
    -1,  3
  ]);

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

  function createTarget(gl, width, height) {
    const texture = createTexture(gl, width, height);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("WebGL2 compositor framebuffer is incomplete");
    }
    return { width, height, texture, framebuffer };
  }

  function imageDataToRgba8(imageData) {
    return new Uint8Array(imageData.data.buffer.slice(0));
  }

  function layerToRgba8(layer) {
    const count = layer.width * layer.height;
    const data = new Uint8Array(count * 4);
    for (let pixel = 0, index = 0; pixel < count; pixel += 1, index += 4) {
      data[index] = Math.round(Math.min(1, Math.max(0, layer.r[pixel])) * 255);
      data[index + 1] = Math.round(Math.min(1, Math.max(0, layer.g[pixel])) * 255);
      data[index + 2] = Math.round(Math.min(1, Math.max(0, layer.b[pixel])) * 255);
      data[index + 3] = 255;
    }
    return data;
  }

  function layerToFloat32(layer) {
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


  function masksToRgba8(masks, width, height) {
    const count = width * height;
    const data = new Uint8Array(count * 4);
    for (let pixel = 0, index = 0; pixel < count; pixel += 1, index += 4) {
      data[index] = Math.round(Math.min(1, Math.max(0, masks.luma[pixel] || 0)) * 255);
      data[index + 1] = Math.round(Math.min(1, Math.max(0, masks.protectMask[pixel] || 0)) * 255);
      data[index + 2] = Math.round(Math.min(1, Math.max(0, (masks.haloMask || masks.sourceMask)[pixel] || 0)) * 255);
      data[index + 3] = Math.round(Math.min(1, Math.max(0, masks.sourceMask[pixel] || 0)) * 255);
    }
    return data;
  }

  class WebglCompositorBackend {
    constructor() {
      this.canvas = document.createElement("canvas");
      this.gl = modules.glowGpuCapabilities.getWebgl2Context(this.canvas);
      if (!this.gl) throw new Error("WebGL2 is unavailable");
      this.programs = {
        composite: createProgram(this.gl, COMPOSITE_SHADER),
        glowLayer: createProgram(this.gl, GLOW_LAYER_SHADER)
      };
      this.vertexBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, this.gl.STATIC_DRAW);
      this.floatTextures = !!this.gl.getExtension("OES_texture_float_linear");
      this.sourceFloatFormat = this.floatTextures
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

    setCompositeUniforms(program, params) {
      const gl = this.gl;
      const composite = params.composite;
      gl.uniform1f(gl.getUniformLocation(program, "uIntensity"), composite.intensity);
      gl.uniform1f(gl.getUniformLocation(program, "uSoftAddMix"), composite.softAddMix);
      gl.uniform1f(gl.getUniformLocation(program, "uWarmth"), composite.warmth);
      gl.uniform1f(gl.getUniformLocation(program, "uSaturation"), composite.saturation);
      gl.uniform1f(gl.getUniformLocation(program, "uHighlightProtect"), composite.highlightProtect);
      gl.uniform1f(gl.getUniformLocation(program, "uShadowProtect"), composite.shadowProtect);
      gl.uniform1f(gl.getUniformLocation(program, "uColorProtect"), composite.colorProtect);
      gl.uniform1f(gl.getUniformLocation(program, "uShoulder"), composite.shoulder);
      gl.uniform1f(gl.getUniformLocation(program, "uColorShift"), composite.colorShift);
      const tint = Array.isArray(composite.colorTint) ? composite.colorTint : [1, 0.82, 0.48];
      gl.uniform3f(gl.getUniformLocation(program, "uColorTint"), tint[0], tint[1], tint[2]);
      gl.uniform1f(gl.getUniformLocation(program, "uColorAmount"), composite.colorAmount);
      gl.uniform1f(gl.getUniformLocation(program, "uChromaticOffset"), Math.min(30, Math.max(0, Math.pow(Math.max(0, composite.chromatic), 0.96) * (4.2 + Math.sqrt(Math.max(1, Number(params.radius) || 1)) * 1.22))));
      gl.uniform1f(gl.getUniformLocation(program, "uChromaticAmount"), composite.chromatic);
      gl.uniform1f(gl.getUniformLocation(program, "uCoreSuppression"), Math.max(0, Math.min(1, Number(composite.coreSuppression) || 0.5)));
      gl.uniform1f(gl.getUniformLocation(program, "uCoreCeiling"), Math.max(0.12, Math.min(1, Number(composite.coreCeiling) || 0.42)));
      gl.uniform1f(gl.getUniformLocation(program, "uHaloBoost"), Math.max(0, Number(composite.haloBoost) || 1));
      gl.uniform1f(gl.getUniformLocation(program, "uHaloMix"), Math.max(0, Math.min(1, Number(composite.haloMix) || 0.5)));
      const radiusRatio = Math.max(0, Math.min(1, (Number(params.radius) || 0) / 500));
      gl.uniform1f(gl.getUniformLocation(program, "uSourceAnchorBase"), 0.38 + radiusRatio * 0.08);
      gl.uniform1f(gl.getUniformLocation(program, "uSourceAnchorAmount"), 0.78 - radiusRatio * 0.1);
      gl.uniform1f(gl.getUniformLocation(program, "uEnergyFloor"), Math.max(0, Number(composite.energyFloor) || 0));
      gl.uniform1f(gl.getUniformLocation(program, "uEnergyFloorSoftness"), Math.max(0.001, Number(composite.energyFloorSoftness) || 0.04));
      gl.uniform2f(gl.getUniformLocation(program, "uTexel"), 1 / Math.max(1, this.canvas.width), 1 / Math.max(1, this.canvas.height));
    }

    setGlowLayerUniforms(program, params) {
      const gl = this.gl;
      const composite = params.composite;
      gl.uniform1f(gl.getUniformLocation(program, "uIntensity"), composite.intensity);
      gl.uniform1f(gl.getUniformLocation(program, "uWarmth"), composite.warmth);
      gl.uniform1f(gl.getUniformLocation(program, "uSaturation"), composite.saturation);
      gl.uniform1f(gl.getUniformLocation(program, "uHighlightProtect"), composite.highlightProtect);
      gl.uniform1f(gl.getUniformLocation(program, "uShadowProtect"), composite.shadowProtect);
      gl.uniform1f(gl.getUniformLocation(program, "uShoulder"), composite.shoulder);
      gl.uniform1f(gl.getUniformLocation(program, "uColorShift"), composite.colorShift);
      const tint = Array.isArray(composite.colorTint) ? composite.colorTint : [1, 0.82, 0.48];
      gl.uniform3f(gl.getUniformLocation(program, "uColorTint"), tint[0], tint[1], tint[2]);
      gl.uniform1f(gl.getUniformLocation(program, "uColorAmount"), composite.colorAmount);
      gl.uniform1f(gl.getUniformLocation(program, "uChromaticOffset"), Math.min(30, Math.max(0, Math.pow(Math.max(0, composite.chromatic), 0.96) * (4.2 + Math.sqrt(Math.max(1, Number(params.radius) || 1)) * 1.22))));
      gl.uniform1f(gl.getUniformLocation(program, "uChromaticAmount"), composite.chromatic);
      gl.uniform1f(gl.getUniformLocation(program, "uCoreSuppression"), Math.max(0, Math.min(1, Number(composite.coreSuppression) || 0.5)));
      gl.uniform1f(gl.getUniformLocation(program, "uCoreCeiling"), Math.max(0.12, Math.min(1, Number(composite.coreCeiling) || 0.42)));
      gl.uniform1f(gl.getUniformLocation(program, "uHaloBoost"), Math.max(0, Number(composite.haloBoost) || 1));
      gl.uniform1f(gl.getUniformLocation(program, "uHaloMix"), Math.max(0, Math.min(1, Number(composite.haloMix) || 0.5)));
      const radiusRatio = Math.max(0, Math.min(1, (Number(params.radius) || 0) / 500));
      gl.uniform1f(gl.getUniformLocation(program, "uSourceAnchorBase"), 0.38 + radiusRatio * 0.08);
      gl.uniform1f(gl.getUniformLocation(program, "uSourceAnchorAmount"), 0.78 - radiusRatio * 0.1);
      gl.uniform1f(gl.getUniformLocation(program, "uEnergyFloor"), Math.max(0, Number(composite.energyFloor) || 0));
      gl.uniform1f(gl.getUniformLocation(program, "uEnergyFloorSoftness"), Math.max(0.001, Number(composite.energyFloorSoftness) || 0.04));
      gl.uniform2f(gl.getUniformLocation(program, "uTexel"), 1 / Math.max(1, this.canvas.width), 1 / Math.max(1, this.canvas.height));
    }

    render(program, target) {
      const gl = this.gl;
      if (target && target.framebuffer) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, target.width, target.height);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    readTarget(target) {
      const gl = this.gl;
      const pixels = new Uint8ClampedArray(target.width * target.height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return new ImageData(pixels, target.width, target.height);
    }

    compose(baseImageData, glowLayer, masks, params, options = {}) {
      if (!this.floatTextures) {
        throw new Error("WebGL2 glow compositor requires float textures");
      }
      const gl = this.gl;
      const { width, height } = baseImageData;
      const includeGlowLayer = options.includeGlowLayer !== false;
      const previewCanvas = options.previewCanvas || null;
      this.canvas.width = width;
      this.canvas.height = height;
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);

      const baseTexture = createTexture(gl, width, height, imageDataToRgba8(baseImageData));
      const glowTexture = this.floatTextures
        ? createTexture(gl, width, height, layerToFloat32(glowLayer), this.sourceFloatFormat)
        : createTexture(gl, width, height, layerToRgba8(glowLayer));
      const masksTexture = createTexture(gl, width, height, masksToRgba8(masks, width, height));
      const previewTarget = previewCanvas ? null : createTarget(gl, width, height);
      const glowLayerTarget = includeGlowLayer ? createTarget(gl, width, height) : null;

      try {
        let program = this.programs.composite;
        this.bindProgram(program);
        this.bindTexture(program, "uBase", baseTexture, 0);
        this.bindTexture(program, "uGlow", glowTexture, 1);
        this.bindTexture(program, "uMasks", masksTexture, 2);
        this.setCompositeUniforms(program, params);
        this.render(program, previewTarget);
        if (previewCanvas) {
          const previewCtx = previewCanvas.getContext("2d", { alpha: true, desynchronized: true });
          if (previewCtx) {
            if (previewCanvas.width !== width) previewCanvas.width = width;
            if (previewCanvas.height !== height) previewCanvas.height = height;
            previewCtx.clearRect(0, 0, width, height);
            previewCtx.drawImage(this.canvas, 0, 0, width, height);
          }
        }

        if (glowLayerTarget) {
          program = this.programs.glowLayer;
          this.bindProgram(program);
          this.bindTexture(program, "uGlow", glowTexture, 0);
          this.bindTexture(program, "uMasks", masksTexture, 1);
          this.setGlowLayerUniforms(program, params);
          this.render(program, glowLayerTarget);
        }

        return {
          previewImageData: previewTarget ? this.readTarget(previewTarget) : null,
          glowLayerImageData: glowLayerTarget ? this.readTarget(glowLayerTarget) : null,
          previewRenderedOnGpu: !!previewCanvas,
          backend: "webgl2"
        };
      } finally {
        [baseTexture, glowTexture, masksTexture, previewTarget && previewTarget.texture, glowLayerTarget && glowLayerTarget.texture].filter(Boolean).forEach((texture) => {
          gl.deleteTexture(texture);
        });
        if (previewTarget) gl.deleteFramebuffer(previewTarget.framebuffer);
        if (glowLayerTarget) gl.deleteFramebuffer(glowLayerTarget.framebuffer);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    }
  }

  let backend = null;

  function getBackend() {
    if (!modules.glowGpuCapabilities || !modules.glowGpuCapabilities.canUseWebgl2()) {
      throw new Error("WebGL2 compositor backend is unavailable");
    }
    if (!backend) backend = new WebglCompositorBackend();
    return backend;
  }

  function compose(baseImageData, glowLayer, masks, params, options = {}) {
    if (!baseImageData || !baseImageData.width || !baseImageData.height) {
      throw new Error("Glow base image is invalid");
    }
    if (!modules.glowGpuCapabilities.canUseWebgl2(baseImageData.width, baseImageData.height)) {
      throw new Error("Image exceeds WebGL2 texture limits");
    }
    return getBackend().compose(baseImageData, glowLayer, masks, params, options);
  }

  function reset() {
    backend = null;
  }

  modules.glowWebglCompositor = {
    compose,
    reset
  };
})(window);
