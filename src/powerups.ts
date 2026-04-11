import * as THREE from "three";

/**
 * Power-up system — collectible items that grant temporary abilities.
 * Adds variety and replayability beyond the core shatter mechanic.
 */

export enum PowerUpType {
  Shield = "shield",        // Absorb one hit
  Magnet = "magnet",        // Attract nearby orbs
  SlowMo = "slowmo",        // Slow down time
  HyperPhase = "hyperphase", // Phase without breaking combo
  ScoreBoost = "scoreboost", // 3x score for duration
}

export interface PowerUp {
  mesh: THREE.Group;
  z: number;
  x: number;
  type: PowerUpType;
  active: boolean;
  collected: boolean;
  /** Animation time accumulator */
  animTime: number;
}

export interface ActivePowerUp {
  type: PowerUpType;
  remaining: number;
  duration: number;
}

const POWERUP_CONFIGS: Record<PowerUpType, {
  color: number;
  emissive: number;
  symbol: string;
  duration: number; // seconds (0 = instant/one-use)
  geometry: "diamond" | "star" | "ring" | "cube" | "helix";
}> = {
  [PowerUpType.Shield]: {
    color: 0x44aaff,
    emissive: 0x2288ff,
    symbol: "🛡",
    duration: 0, // one-time use
    geometry: "diamond",
  },
  [PowerUpType.Magnet]: {
    color: 0xff44ff,
    emissive: 0xcc22cc,
    symbol: "🧲",
    duration: 8,
    geometry: "ring",
  },
  [PowerUpType.SlowMo]: {
    color: 0x44ffaa,
    emissive: 0x22cc88,
    symbol: "⏱",
    duration: 5,
    geometry: "helix",
  },
  [PowerUpType.HyperPhase]: {
    color: 0xaa44ff,
    emissive: 0x8822ee,
    symbol: "⚡",
    duration: 6,
    geometry: "star",
  },
  [PowerUpType.ScoreBoost]: {
    color: 0xffcc00,
    emissive: 0xddaa00,
    symbol: "★",
    duration: 10,
    geometry: "cube",
  },
};

function createPowerUpMesh(type: PowerUpType): THREE.Group {
  const config = POWERUP_CONFIGS[type];
  const group = new THREE.Group();

  const mat = new THREE.MeshStandardMaterial({
    color: config.color,
    emissive: config.emissive,
    emissiveIntensity: 0.8,
    metalness: 0.6,
    roughness: 0.2,
    transparent: true,
    opacity: 0.9,
  });

  let coreMesh: THREE.Mesh;

  switch (config.geometry) {
    case "diamond": {
      const geo = new THREE.OctahedronGeometry(0.4, 0);
      coreMesh = new THREE.Mesh(geo, mat);
      coreMesh.scale.set(1, 1.5, 1);
      break;
    }
    case "star": {
      const geo = new THREE.IcosahedronGeometry(0.35, 0);
      coreMesh = new THREE.Mesh(geo, mat);
      break;
    }
    case "ring": {
      const geo = new THREE.TorusGeometry(0.3, 0.1, 8, 16);
      coreMesh = new THREE.Mesh(geo, mat);
      break;
    }
    case "cube": {
      const geo = new THREE.BoxGeometry(0.45, 0.45, 0.45);
      coreMesh = new THREE.Mesh(geo, mat);
      coreMesh.rotation.set(Math.PI / 4, Math.PI / 4, 0);
      break;
    }
    case "helix": {
      const geo = new THREE.DodecahedronGeometry(0.35, 0);
      coreMesh = new THREE.Mesh(geo, mat);
      break;
    }
  }

  group.add(coreMesh!);

  // Outer glow ring
  const ringGeo = new THREE.RingGeometry(0.55, 0.7, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: config.color,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  return group;
}

export class PowerUpManager {
  powerups: PowerUp[] = [];
  activePowerUps: ActivePowerUp[] = [];

  private scene: THREE.Scene;
  private nextSpawnZ = 80;
  private spawnInterval = 60; // meters between power-up spawns

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(dt: number, playerZ: number, playerX: number) {
    const SPAWN_DISTANCE = 80;
    const DESPAWN_DISTANCE = -10;

    // Spawn ahead
    while (this.nextSpawnZ < playerZ + SPAWN_DISTANCE) {
      this.spawnPowerUp(this.nextSpawnZ);
      this.nextSpawnZ += this.spawnInterval + Math.random() * 30;
    }

    // Animate
    for (const pu of this.powerups) {
      if (!pu.active) continue;
      pu.animTime += dt;
      pu.mesh.rotation.y += dt * 2;
      pu.mesh.position.y = 0.8 + Math.sin(pu.animTime * 3) * 0.3;

      // Pulse glow
      const pulse = 0.7 + Math.sin(pu.animTime * 5) * 0.3;
      const coreMesh = pu.mesh.children[0] as THREE.Mesh;
      if (coreMesh.material instanceof THREE.MeshStandardMaterial) {
        coreMesh.material.emissiveIntensity = pulse;
      }
    }

    // Despawn
    for (const pu of this.powerups) {
      if (pu.active && pu.z < playerZ + DESPAWN_DISTANCE) {
        pu.active = false;
        pu.mesh.visible = false;
      }
    }

    // Tick active power-up timers
    for (let i = this.activePowerUps.length - 1; i >= 0; i--) {
      const ap = this.activePowerUps[i];
      ap.remaining -= dt;
      if (ap.remaining <= 0) {
        this.activePowerUps.splice(i, 1);
      }
    }

    // Magnet effect: pull orbs toward player
    // (handled externally by game.ts checking hasActivePowerUp)
  }

  spawnPowerUp(z: number) {
    const types = Object.values(PowerUpType);
    const type = types[Math.floor(Math.random() * types.length)];
    const x = (Math.random() - 0.5) * 7;

    const mesh = createPowerUpMesh(type);
    mesh.position.set(x, 0.8, z);
    this.scene.add(mesh);

    this.powerups.push({
      mesh,
      z,
      x,
      type,
      active: true,
      collected: false,
      animTime: Math.random() * 10,
    });
  }

  checkCollection(playerX: number, playerZ: number, radius: number): PowerUp | null {
    for (const pu of this.powerups) {
      if (!pu.active || pu.collected) continue;
      const dx = playerX - pu.x;
      const dz = playerZ - pu.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < radius + 0.5) {
        pu.collected = true;
        pu.active = false;
        pu.mesh.visible = false;
        return pu;
      }
    }
    return null;
  }

  activatePowerUp(type: PowerUpType) {
    const config = POWERUP_CONFIGS[type];

    // Shield is instant/one-use — add with remaining = Infinity (consumed on hit)
    if (type === PowerUpType.Shield) {
      // Remove existing shield if any
      this.activePowerUps = this.activePowerUps.filter(p => p.type !== PowerUpType.Shield);
      this.activePowerUps.push({ type, remaining: Infinity, duration: Infinity });
      return;
    }

    // Remove existing of same type, add fresh
    this.activePowerUps = this.activePowerUps.filter(p => p.type !== type);
    this.activePowerUps.push({
      type,
      remaining: config.duration,
      duration: config.duration,
    });
  }

  hasActivePowerUp(type: PowerUpType): boolean {
    return this.activePowerUps.some(p => p.type === type);
  }

  /** Consume shield (returns true if shield was active) */
  consumeShield(): boolean {
    const idx = this.activePowerUps.findIndex(p => p.type === PowerUpType.Shield);
    if (idx >= 0) {
      this.activePowerUps.splice(idx, 1);
      return true;
    }
    return false;
  }

  getActivePowerUpProgress(type: PowerUpType): number {
    const ap = this.activePowerUps.find(p => p.type === type);
    if (!ap) return 0;
    if (ap.duration === Infinity) return 1;
    return ap.remaining / ap.duration;
  }

  getScoreMultiplier(): number {
    return this.hasActivePowerUp(PowerUpType.ScoreBoost) ? 3 : 1;
  }

  getTimeScale(): number {
    return this.hasActivePowerUp(PowerUpType.SlowMo) ? 0.5 : 1;
  }

  reset() {
    for (const pu of this.powerups) {
      this.scene.remove(pu.mesh);
    }
    this.powerups.length = 0;
    this.activePowerUps.length = 0;
    this.nextSpawnZ = 80;
  }

  getConfig(type: PowerUpType) {
    return POWERUP_CONFIGS[type];
  }
}
