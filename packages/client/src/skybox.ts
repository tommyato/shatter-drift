import * as THREE from "three";
import {
  SKYBOX_VOID,
  SKYBOX_CRYSTAL_CAVES,
  SKYBOX_NEON_CITY,
  SKYBOX_SOLAR_STORM,
  SKYBOX_COSMIC_RIFT,
} from "./skybox-data";

/**
 * AI-generated skybox system — equirectangular textures for each biome
 * with smooth crossfading during biome transitions. Uses a large inverted
 * sphere with a custom blend shader.
 *
 * Textures generated via fal.ai FLUX Pro, optimized to 1024x512 JPEG.
 */

const SKYBOX_DATA_URIS = [
  SKYBOX_VOID,
  SKYBOX_CRYSTAL_CAVES,
  SKYBOX_NEON_CITY,
  SKYBOX_SOLAR_STORM,
  SKYBOX_COSMIC_RIFT,
];

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D texA;
  uniform sampler2D texB;
  uniform float mixFactor;
  uniform float brightness;
  uniform float saturation;
  uniform vec3 ambientLift;  // additive base color to lift dark pixels of the dome
  uniform float gamma;        // <1 lifts midtones/darks; 1 = unchanged
  varying vec2 vUv;

  void main() {
    vec4 colorA = texture2D(texA, vUv);
    vec4 colorB = texture2D(texB, vUv);
    vec4 color = mix(colorA, colorB, mixFactor);

    // Lift darks via gamma curve (so the near-black 80% of the texture
    // doesn't stay invisible when we just multiply by brightness).
    color.rgb = pow(max(color.rgb, vec3(0.0)), vec3(gamma));

    // Apply brightness
    color.rgb *= brightness;

    // Add a faint ambient nebula color across the whole dome, so areas
    // outside the painted nebula band don't read as flat black.
    color.rgb += ambientLift;

    // Saturation adjustment
    float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(lum), color.rgb, saturation);

    gl_FragColor = color;
  }
`;

// Per-biome brightness tuning — darker for early biomes, brighter for later
// 2026-04-29 — Tommy reframe: most players never see zones 2-5, so zone 1
// should be the hero, not the appetizer. Cranking void to match later zones.
// Brightness, saturation, gamma (lifts darks), and ambientLift (additive
// purple haze across the dome) all tuned per-biome.
const BIOME_BRIGHTNESS = [0.95, 0.55, 0.55, 0.55, 0.55];
const BIOME_SATURATION = [1.0, 0.8, 1.0, 0.9, 0.85];
// gamma < 1 lifts dark pixels; void had 80% near-black sky, so push hardest there.
const BIOME_GAMMA = [0.55, 0.7, 0.75, 0.75, 0.7];
// ambient lift = additive RGB applied AFTER brightness/gamma. Fills the dome
// with a subtle nebula-colored haze so empty regions don't read as flat black.
const BIOME_AMBIENT_LIFT: [number, number, number][] = [
  [0.10, 0.04, 0.18], // void: deep purple haze
  [0.02, 0.06, 0.14], // crystal caves: cool blue haze
  [0.10, 0.02, 0.10], // neon district: magenta haze
  [0.14, 0.06, 0.02], // solar storm: warm amber haze
  [0.02, 0.12, 0.10], // cosmic rift: cyan haze
];

export class SkyboxManager {
  private sphere: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private textures: THREE.Texture[] = [];
  private rotationSpeed = 0.003;

  constructor(scene: THREE.Scene) {
    const loader = new THREE.TextureLoader();

    // Load all skybox textures from inlined data URIs
    for (const dataUri of SKYBOX_DATA_URIS) {
      const tex = loader.load(dataUri);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this.textures.push(tex);
    }

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        texA: { value: this.textures[0] },
        texB: { value: this.textures[0] },
        mixFactor: { value: 0.0 },
        brightness: { value: BIOME_BRIGHTNESS[0] },
        saturation: { value: BIOME_SATURATION[0] },
        gamma: { value: BIOME_GAMMA[0] },
        ambientLift: {
          value: new THREE.Vector3(
            BIOME_AMBIENT_LIFT[0][0],
            BIOME_AMBIENT_LIFT[0][1],
            BIOME_AMBIENT_LIFT[0][2],
          ),
        },
      },
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      transparent: false,
    });

    const geo = new THREE.SphereGeometry(190, 48, 24);
    this.sphere = new THREE.Mesh(geo, this.material);
    this.sphere.renderOrder = -1000;
    scene.add(this.sphere);
  }

  update(
    biomeIndex: number,
    isTransitioning: boolean,
    transitionProgress: number,
    playerZ: number,
    dt: number
  ) {
    // Follow player
    this.sphere.position.z = playerZ;

    // Slow rotation for subtle dynamism
    this.sphere.rotation.y += this.rotationSpeed * dt;

    if (isTransitioning && biomeIndex + 1 < this.textures.length) {
      // Crossfade between current and next biome
      const nextIdx = biomeIndex + 1;
      this.material.uniforms.texA.value = this.textures[biomeIndex];
      this.material.uniforms.texB.value = this.textures[nextIdx];
      this.material.uniforms.mixFactor.value = transitionProgress;

      // Lerp brightness and saturation
      const bA = BIOME_BRIGHTNESS[biomeIndex];
      const bB = BIOME_BRIGHTNESS[nextIdx];
      this.material.uniforms.brightness.value = bA + (bB - bA) * transitionProgress;

      const sA = BIOME_SATURATION[biomeIndex];
      const sB = BIOME_SATURATION[nextIdx];
      this.material.uniforms.saturation.value = sA + (sB - sA) * transitionProgress;

      const gA = BIOME_GAMMA[biomeIndex];
      const gB = BIOME_GAMMA[nextIdx];
      this.material.uniforms.gamma.value = gA + (gB - gA) * transitionProgress;

      const lA = BIOME_AMBIENT_LIFT[biomeIndex];
      const lB = BIOME_AMBIENT_LIFT[nextIdx];
      const lift = this.material.uniforms.ambientLift.value as THREE.Vector3;
      lift.set(
        lA[0] + (lB[0] - lA[0]) * transitionProgress,
        lA[1] + (lB[1] - lA[1]) * transitionProgress,
        lA[2] + (lB[2] - lA[2]) * transitionProgress,
      );
    } else {
      // Static — show current biome skybox
      this.material.uniforms.texA.value = this.textures[biomeIndex];
      this.material.uniforms.texB.value = this.textures[biomeIndex];
      this.material.uniforms.mixFactor.value = 0;
      this.material.uniforms.brightness.value = BIOME_BRIGHTNESS[biomeIndex];
      this.material.uniforms.saturation.value = BIOME_SATURATION[biomeIndex];
      this.material.uniforms.gamma.value = BIOME_GAMMA[biomeIndex];
      const lift = this.material.uniforms.ambientLift.value as THREE.Vector3;
      const l = BIOME_AMBIENT_LIFT[biomeIndex];
      lift.set(l[0], l[1], l[2]);
    }
  }

  dispose() {
    this.sphere.geometry.dispose();
    this.material.dispose();
    for (const tex of this.textures) tex.dispose();
  }
}
