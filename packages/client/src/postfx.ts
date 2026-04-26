import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * Custom post-processing pass: chromatic aberration, film grain, scan lines,
 * radial distortion pulse, and color grading.
 *
 * All driven by gameplay uniforms (speed, impact, biome color).
 */

const PostFXShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uChromaIntensity: { value: 0 },     // 0–1 speed-driven chromatic aberration
    uDistortPulse: { value: 0 },         // 0–1 radial distortion on impacts
    uScanLineIntensity: { value: 0.03 }, // subtle scan lines
    uGrainIntensity: { value: 0.04 },    // subtle film grain
    uTintColor: { value: new THREE.Vector3(1, 1, 1) }, // biome color tint
    uTintStrength: { value: 0 },         // how much tint to apply
    uVignetteIntensity: { value: 0 },    // shader vignette (GPU, not CSS)
    uGlitch: { value: 0 },              // glitch effect 0–1 for death/boss
    uResolution: { value: new THREE.Vector2(1, 1) },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uChromaIntensity;
    uniform float uDistortPulse;
    uniform float uScanLineIntensity;
    uniform float uGrainIntensity;
    uniform vec3 uTintColor;
    uniform float uTintStrength;
    uniform float uVignetteIntensity;
    uniform float uGlitch;
    uniform vec2 uResolution;

    varying vec2 vUv;

    // Simple pseudo-random
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = vec2(0.5);

      // --- Radial distortion pulse (barrel/pincushion) ---
      if (uDistortPulse > 0.001) {
        vec2 d = uv - center;
        float dist = length(d);
        float distortAmount = uDistortPulse * 0.15;
        uv += d * dist * dist * distortAmount;
      }

      // --- Glitch (horizontal shift for death/boss) ---
      if (uGlitch > 0.01) {
        float glitchLine = step(0.97, hash(vec2(floor(uv.y * 40.0), floor(uTime * 20.0))));
        uv.x += glitchLine * uGlitch * 0.08 * (hash(vec2(uTime, uv.y)) - 0.5);

        // Block glitch
        float blockY = floor(uv.y * 12.0 + uTime * 8.0);
        float blockGlitch = step(0.92, hash(vec2(blockY, floor(uTime * 10.0))));
        uv.x += blockGlitch * uGlitch * 0.04 * sin(uTime * 50.0);
      }

      // --- Chromatic aberration ---
      vec2 chromaDir = (uv - center) * uChromaIntensity;

      // Radial CA: stronger at edges
      float edgeDist = length(uv - center);
      float caScale = 0.003 + edgeDist * 0.012;
      vec2 caOffset = chromaDir * caScale;

      float r = texture2D(tDiffuse, uv + caOffset).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - caOffset).b;

      vec3 color = vec3(r, g, b);

      // --- Color grading / biome tint ---
      if (uTintStrength > 0.001) {
        vec3 tinted = color * mix(vec3(1.0), uTintColor, 0.3);
        color = mix(color, tinted, uTintStrength);
      }

      // --- Scan lines ---
      if (uScanLineIntensity > 0.001) {
        float scanline = sin(uv.y * uResolution.y * 1.5) * 0.5 + 0.5;
        scanline = pow(scanline, 1.5);
        color *= 1.0 - uScanLineIntensity * (1.0 - scanline);
      }

      // --- Film grain ---
      if (uGrainIntensity > 0.001) {
        float grain = hash(uv * uResolution + vec2(uTime * 100.0));
        grain = (grain - 0.5) * uGrainIntensity;
        color += grain;
      }

      // --- Vignette (GPU-side, replaces CSS vignette) ---
      if (uVignetteIntensity > 0.001) {
        float vignette = 1.0 - edgeDist * 1.4;
        vignette = clamp(vignette, 0.0, 1.0);
        vignette = pow(vignette, 1.5);
        color *= mix(1.0, vignette, uVignetteIntensity);
      }

      // --- Subtle color boost (slightly more vivid) ---
      float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luminance), color, 1.15); // +15% saturation

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `,
};

export class PostFXPass {
  readonly pass: ShaderPass;
  private distortDecay = 0;
  private glitchDecay = 0;
  private targetChroma = 0;
  private currentChroma = 0;
  private targetTint = new THREE.Vector3(1, 1, 1);
  private currentTint = new THREE.Vector3(1, 1, 1);
  private targetTintStrength = 0;

  constructor() {
    this.pass = new ShaderPass(PostFXShader);
    this.pass.renderToScreen = true;
  }

  /** Call on resize */
  setResolution(w: number, h: number) {
    this.pass.uniforms.uResolution.value.set(w, h);
  }

  /** Set speed-driven chromatic aberration (0–1) */
  setSpeed(speedNorm: number) {
    // Starts at 0.3 speed, maxes out at full speed
    this.targetChroma = Math.max(0, (speedNorm - 0.3) / 0.7);
  }

  /** Trigger a radial distortion pulse (close calls, impacts, etc.) */
  triggerDistort(intensity: number = 1) {
    this.distortDecay = Math.max(this.distortDecay, intensity);
  }

  /** Trigger glitch effect (death, boss encounter) */
  triggerGlitch(intensity: number = 1) {
    this.glitchDecay = Math.max(this.glitchDecay, intensity);
  }

  /** Set biome color tint */
  setBiomeTint(color: number, strength: number = 0.15) {
    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;
    this.targetTint.set(r, g, b);
    this.targetTintStrength = strength;
  }

  /** Set vignette intensity (replaces CSS vignette) */
  setVignette(intensity: number) {
    this.pass.uniforms.uVignetteIntensity.value = intensity;
  }

  /** Per-frame update */
  update(dt: number) {
    const u = this.pass.uniforms;

    u.uTime.value += dt;

    // Smooth chromatic aberration
    this.currentChroma += (this.targetChroma - this.currentChroma) * Math.min(1, 5 * dt);
    u.uChromaIntensity.value = this.currentChroma;

    // Decay distort pulse
    if (this.distortDecay > 0.001) {
      u.uDistortPulse.value = this.distortDecay;
      this.distortDecay *= Math.exp(-12 * dt); // fast decay
      if (this.distortDecay < 0.001) this.distortDecay = 0;
    } else {
      u.uDistortPulse.value = 0;
    }

    // Decay glitch
    if (this.glitchDecay > 0.001) {
      u.uGlitch.value = this.glitchDecay;
      this.glitchDecay *= Math.exp(-4 * dt); // slower decay for dramatic effect
      if (this.glitchDecay < 0.001) this.glitchDecay = 0;
    } else {
      u.uGlitch.value = 0;
    }

    // Smooth tint
    this.currentTint.lerp(this.targetTint, Math.min(1, 2 * dt));
    u.uTintColor.value.copy(this.currentTint);
    u.uTintStrength.value += (this.targetTintStrength - u.uTintStrength.value) * Math.min(1, 3 * dt);
  }
}
