import * as THREE from "three";

/**
 * Biome system — visually distinct environments that transition
 * as the player progresses. Each biome has unique colors, fog,
 * obstacle styling, and atmosphere.
 */

export interface BiomeColors {
  background: number;
  fog: number;
  fogDensity: number;
  obstacleBase: number;
  obstacleEdge: number;
  obstacleEmissiveIntensity: number;
  orbColor: number;
  playerTrail: number;
  ambientLight: number;
  ambientIntensity: number;
  directionalLight: number;
  directionalIntensity: number;
  starTint: [number, number, number]; // RGB multiplier
  gridColor: number;
  gridOpacity: number;
  bloomStrength: number;
  bloomThreshold: number;
}

export interface Biome {
  name: string;
  displayName: string;
  colors: BiomeColors;
  /** Distance at which this biome starts */
  startDistance: number;
  /** Transition length in meters */
  transitionLength: number;
}

const BIOMES: Biome[] = [
  {
    name: "void",
    displayName: "THE VOID",
    colors: {
      background: 0x0a0a2e,
      fog: 0x0a0a2e,
      fogDensity: 0.007,
      obstacleBase: 0x7733cc,
      obstacleEdge: 0xdd99ff,
      obstacleEmissiveIntensity: 1.2,
      orbColor: 0xffcc00,
      playerTrail: 0x00ffcc,
      ambientLight: 0x445588,
      ambientIntensity: 1.1,
      directionalLight: 0x6688cc,
      directionalIntensity: 1.0,
      starTint: [0.7, 0.8, 1.0],
      gridColor: 0x2a4466,
      gridOpacity: 0.7,
      bloomStrength: 1.1,
      bloomThreshold: 0.8,
    },
    startDistance: 0,
    transitionLength: 0,
  },
  {
    name: "crystal_caves",
    displayName: "CRYSTAL CAVES",
    colors: {
      background: 0x040820,
      fog: 0x040820,
      fogDensity: 0.012,
      obstacleBase: 0x2255bb,
      obstacleEdge: 0x55bbee,
      obstacleEmissiveIntensity: 0.9,
      orbColor: 0x44ffdd,
      playerTrail: 0x44aaff,
      ambientLight: 0x334477,
      ambientIntensity: 0.7,
      directionalLight: 0x55aaee,
      directionalIntensity: 0.9,
      starTint: [0.4, 0.7, 1.0],
      gridColor: 0x224466,
      gridOpacity: 0.6,
      bloomStrength: 0.7,
      bloomThreshold: 0.85,
    },
    startDistance: 300,
    transitionLength: 40,
  },
  {
    name: "neon_city",
    displayName: "NEON DISTRICT",
    colors: {
      background: 0x0e0020,
      fog: 0x0e0020,
      fogDensity: 0.010,
      obstacleBase: 0x882266,
      obstacleEdge: 0xff66cc,
      obstacleEmissiveIntensity: 1.05,
      orbColor: 0xff66ff,
      playerTrail: 0xff44aa,
      ambientLight: 0x442255,
      ambientIntensity: 0.65,
      directionalLight: 0xff4499,
      directionalIntensity: 0.9,
      starTint: [1.0, 0.3, 0.7],
      gridColor: 0x332266,
      gridOpacity: 0.6,
      bloomStrength: 1.2,
      bloomThreshold: 0.7,
    },
    startDistance: 700,
    transitionLength: 50,
  },
  {
    name: "solar_storm",
    displayName: "SOLAR STORM",
    colors: {
      background: 0x1a0c02,
      fog: 0x1a0c02,
      fogDensity: 0.008,
      obstacleBase: 0x995522,
      obstacleEdge: 0xffaa33,
      obstacleEmissiveIntensity: 1.1,
      orbColor: 0xffaa00,
      playerTrail: 0xff8800,
      ambientLight: 0x553311,
      ambientIntensity: 0.7,
      directionalLight: 0xff7744,
      directionalIntensity: 1.0,
      starTint: [1.0, 0.6, 0.2],
      gridColor: 0x442200,
      gridOpacity: 0.6,
      bloomStrength: 1.3,
      bloomThreshold: 0.65,
    },
    startDistance: 1200,
    transitionLength: 60,
  },
  {
    name: "cosmic_rift",
    displayName: "COSMIC RIFT",
    colors: {
      background: 0x021210,
      fog: 0x021210,
      fogDensity: 0.006,
      obstacleBase: 0x227755,
      obstacleEdge: 0x44ffcc,
      obstacleEmissiveIntensity: 1.2,
      orbColor: 0x00ffcc,
      playerTrail: 0x00ffaa,
      ambientLight: 0x115544,
      ambientIntensity: 0.8,
      directionalLight: 0x22ffbb,
      directionalIntensity: 1.1,
      starTint: [0.3, 1.0, 0.8],
      gridColor: 0x115533,
      gridOpacity: 0.65,
      bloomStrength: 1.5,
      bloomThreshold: 0.6,
    },
    startDistance: 1800,
    transitionLength: 70,
  },
];

export class BiomeManager {
  private currentBiomeIndex = 0;
  private transitionProgress = 0; // 0-1 during transitions
  private transitioning = false;
  private currentColors: BiomeColors;
  private lastAnnouncedBiome = 0;

  // Callbacks
  onBiomeChange: ((biome: Biome) => void) | null = null;

  constructor() {
    this.currentColors = { ...BIOMES[0].colors };
  }

  get currentBiome(): Biome {
    return BIOMES[this.currentBiomeIndex];
  }

  get nextBiome(): Biome | null {
    if (this.currentBiomeIndex + 1 < BIOMES.length) {
      return BIOMES[this.currentBiomeIndex + 1];
    }
    return null;
  }

  get colors(): BiomeColors {
    return this.currentColors;
  }

  get biomeIndex(): number {
    return this.currentBiomeIndex;
  }

  get isTransitioning(): boolean {
    return this.transitioning;
  }

  get progress(): number {
    return this.transitionProgress;
  }

  update(distance: number): boolean {
    const next = this.nextBiome;
    if (!next) return false;

    let announced = false;

    if (distance >= next.startDistance && !this.transitioning) {
      this.transitioning = true;
      this.transitionProgress = 0;
    }

    if (this.transitioning) {
      const next = BIOMES[this.currentBiomeIndex + 1];
      const elapsed = distance - next.startDistance;
      this.transitionProgress = Math.min(1, Math.max(0, elapsed / next.transitionLength));

      // Interpolate colors
      const from = BIOMES[this.currentBiomeIndex].colors;
      const to = next.colors;
      this.lerpColors(from, to, this.smoothStep(this.transitionProgress));

      if (this.transitionProgress >= 1) {
        this.transitioning = false;
        this.currentBiomeIndex++;
        this.currentColors = { ...BIOMES[this.currentBiomeIndex].colors };

        if (this.currentBiomeIndex > this.lastAnnouncedBiome) {
          this.lastAnnouncedBiome = this.currentBiomeIndex;
          announced = true;
          this.onBiomeChange?.(BIOMES[this.currentBiomeIndex]);
        }
      }
    }

    return announced;
  }

  private smoothStep(t: number): number {
    return t * t * (3 - 2 * t);
  }

  private lerpColors(from: BiomeColors, to: BiomeColors, t: number) {
    this.currentColors.fogDensity = THREE.MathUtils.lerp(from.fogDensity, to.fogDensity, t);
    this.currentColors.obstacleEmissiveIntensity = THREE.MathUtils.lerp(from.obstacleEmissiveIntensity, to.obstacleEmissiveIntensity, t);
    this.currentColors.ambientIntensity = THREE.MathUtils.lerp(from.ambientIntensity, to.ambientIntensity, t);
    this.currentColors.directionalIntensity = THREE.MathUtils.lerp(from.directionalIntensity, to.directionalIntensity, t);
    this.currentColors.gridOpacity = THREE.MathUtils.lerp(from.gridOpacity, to.gridOpacity, t);
    this.currentColors.bloomStrength = THREE.MathUtils.lerp(from.bloomStrength, to.bloomStrength, t);
    this.currentColors.bloomThreshold = THREE.MathUtils.lerp(from.bloomThreshold, to.bloomThreshold, t);

    // Lerp hex colors
    this.currentColors.background = this.lerpHex(from.background, to.background, t);
    this.currentColors.fog = this.lerpHex(from.fog, to.fog, t);
    this.currentColors.obstacleBase = this.lerpHex(from.obstacleBase, to.obstacleBase, t);
    this.currentColors.obstacleEdge = this.lerpHex(from.obstacleEdge, to.obstacleEdge, t);
    this.currentColors.orbColor = this.lerpHex(from.orbColor, to.orbColor, t);
    this.currentColors.playerTrail = this.lerpHex(from.playerTrail, to.playerTrail, t);
    this.currentColors.ambientLight = this.lerpHex(from.ambientLight, to.ambientLight, t);
    this.currentColors.directionalLight = this.lerpHex(from.directionalLight, to.directionalLight, t);
    this.currentColors.gridColor = this.lerpHex(from.gridColor, to.gridColor, t);

    // Star tint
    this.currentColors.starTint = [
      THREE.MathUtils.lerp(from.starTint[0], to.starTint[0], t),
      THREE.MathUtils.lerp(from.starTint[1], to.starTint[1], t),
      THREE.MathUtils.lerp(from.starTint[2], to.starTint[2], t),
    ];
  }

  private lerpHex(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return (r << 16) | (g << 8) | bl;
  }

  reset() {
    this.currentBiomeIndex = 0;
    this.transitionProgress = 0;
    this.transitioning = false;
    this.lastAnnouncedBiome = 0;
    this.currentColors = { ...BIOMES[0].colors };
  }
}

export { BIOMES };
