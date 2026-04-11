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
      background: 0x020208,
      fog: 0x020208,
      fogDensity: 0.015,
      obstacleBase: 0x220033,
      obstacleEdge: 0x9933ff,
      obstacleEmissiveIntensity: 0.15,
      orbColor: 0xffcc00,
      playerTrail: 0x00ffcc,
      ambientLight: 0x222244,
      ambientIntensity: 0.3,
      directionalLight: 0x4466aa,
      directionalIntensity: 0.5,
      starTint: [0.7, 0.8, 1.0],
      gridColor: 0x112233,
      gridOpacity: 0.3,
      bloomStrength: 0.8,
      bloomThreshold: 0.85,
    },
    startDistance: 0,
    transitionLength: 0,
  },
  {
    name: "crystal_caves",
    displayName: "CRYSTAL CAVES",
    colors: {
      background: 0x050212,
      fog: 0x050212,
      fogDensity: 0.018,
      obstacleBase: 0x0a1a3a,
      obstacleEdge: 0x44aaff,
      obstacleEmissiveIntensity: 0.25,
      orbColor: 0x44ffdd,
      playerTrail: 0x44aaff,
      ambientLight: 0x112244,
      ambientIntensity: 0.25,
      directionalLight: 0x3388cc,
      directionalIntensity: 0.4,
      starTint: [0.4, 0.7, 1.0],
      gridColor: 0x0a2244,
      gridOpacity: 0.4,
      bloomStrength: 1.0,
      bloomThreshold: 0.75,
    },
    startDistance: 300,
    transitionLength: 40,
  },
  {
    name: "neon_city",
    displayName: "NEON DISTRICT",
    colors: {
      background: 0x0a0015,
      fog: 0x0a0015,
      fogDensity: 0.012,
      obstacleBase: 0x1a0028,
      obstacleEdge: 0xff44aa,
      obstacleEmissiveIntensity: 0.35,
      orbColor: 0xff66ff,
      playerTrail: 0xff44aa,
      ambientLight: 0x220033,
      ambientIntensity: 0.35,
      directionalLight: 0xff3388,
      directionalIntensity: 0.6,
      starTint: [1.0, 0.3, 0.7],
      gridColor: 0x220044,
      gridOpacity: 0.5,
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
      background: 0x120800,
      fog: 0x120800,
      fogDensity: 0.010,
      obstacleBase: 0x331100,
      obstacleEdge: 0xff6600,
      obstacleEmissiveIntensity: 0.4,
      orbColor: 0xffaa00,
      playerTrail: 0xff8800,
      ambientLight: 0x332200,
      ambientIntensity: 0.4,
      directionalLight: 0xff6633,
      directionalIntensity: 0.7,
      starTint: [1.0, 0.6, 0.2],
      gridColor: 0x331800,
      gridOpacity: 0.45,
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
      background: 0x000808,
      fog: 0x000808,
      fogDensity: 0.008,
      obstacleBase: 0x002222,
      obstacleEdge: 0x00ffaa,
      obstacleEmissiveIntensity: 0.5,
      orbColor: 0x00ffcc,
      playerTrail: 0x00ffaa,
      ambientLight: 0x003322,
      ambientIntensity: 0.5,
      directionalLight: 0x00ffaa,
      directionalIntensity: 0.8,
      starTint: [0.3, 1.0, 0.8],
      gridColor: 0x003322,
      gridOpacity: 0.5,
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
