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
  varying vec2 vUv;

  void main() {
    vec4 colorA = texture2D(texA, vUv);
    vec4 colorB = texture2D(texB, vUv);
    vec4 color = mix(colorA, colorB, mixFactor);

    // Apply brightness
    color.rgb *= brightness;

    // Saturation adjustment
    float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(lum), color.rgb, saturation);

    gl_FragColor = color;
  }
`;

// Per-biome brightness tuning — darker for early biomes, brighter for later
const BIOME_BRIGHTNESS = [0.15, 0.25, 0.35, 0.4, 0.35];
const BIOME_SATURATION = [0.6, 0.8, 1.0, 0.9, 0.85];

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
    } else {
      // Static — show current biome skybox
      this.material.uniforms.texA.value = this.textures[biomeIndex];
      this.material.uniforms.texB.value = this.textures[biomeIndex];
      this.material.uniforms.mixFactor.value = 0;
      this.material.uniforms.brightness.value = BIOME_BRIGHTNESS[biomeIndex];
      this.material.uniforms.saturation.value = BIOME_SATURATION[biomeIndex];
    }
  }

  dispose() {
    this.sphere.geometry.dispose();
    this.material.dispose();
    for (const tex of this.textures) tex.dispose();
  }
}
