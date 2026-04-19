import * as THREE from "three";
import { BiomeManager } from "./biomes";
import { PLASMA_OBSTACLE_FRAGMENT, PLASMA_VERTEX } from "./shaders";

/**
 * Boss Wave system — dramatic obstacle encounters every 500m.
 * These are animated, multi-part obstacles that create "wow" moments.
 */

export interface BossWave {
  group: THREE.Group;
  z: number;
  active: boolean;
  type: BossType;
  parts: BossPart[];
  timer: number;
  triggered: boolean;
}

interface BossPart {
  mesh: THREE.Mesh;
  baseX: number;
  baseY: number;
  /** For collision */
  halfWidth: number;
  /** Movement pattern */
  pattern: "spin" | "oscillate" | "converge" | "static";
  phase: number;
  speed: number;
}

export enum BossType {
  SpinningGate = "spinning_gate",
  ConvergingWalls = "converging_walls",
  OrbitalRings = "orbital_rings",
  LaserGrid = "laser_grid",
}

const BOSS_INTERVAL = 500;
const BOSS_WARNING_DISTANCE = 60;
const BOSS_ZONE_LENGTH = 30;

export class BossWaveManager {
  waves: BossWave[] = [];
  private scene: THREE.Scene;
  private biomes: BiomeManager;
  private random: () => number = Math.random;
  private nextBossZ = BOSS_INTERVAL;
  private bossCount = 0;
  private plasmaElapsed = 0;

  // Warning system
  warningActive = false;
  warningText = "";
  private warningTimer = 0;

  /** Replace the PRNG used for boss wave generation. Call before each game start. */
  setRandom(fn: () => number) {
    this.random = fn;
  }

  constructor(scene: THREE.Scene, biomes: BiomeManager) {
    this.scene = scene;
    this.biomes = biomes;
  }

  update(dt: number, playerZ: number) {
    const SPAWN_DISTANCE = 100;

    // Spawn boss waves ahead
    while (this.nextBossZ < playerZ + SPAWN_DISTANCE) {
      this.spawnBossWave(this.nextBossZ);
      this.nextBossZ += BOSS_INTERVAL;
    }

    // Animate active bosses
    this.plasmaElapsed += dt;
    for (const wave of this.waves) {
      if (!wave.active) continue;
      wave.timer += dt;

      // Check if player is approaching — show warning
      const distToPlayer = wave.z - playerZ;
      if (distToPlayer < BOSS_WARNING_DISTANCE && distToPlayer > 0 && !wave.triggered) {
        wave.triggered = true;
        this.warningActive = true;
        this.warningText = "⚠ BOSS WAVE ⚠";
        this.warningTimer = 2.5;
      }

      // Animate parts
      for (const part of wave.parts) {
        this.animatePart(part, wave.timer, dt);
      }

      for (const part of wave.parts) {
        if (part.mesh.material instanceof THREE.ShaderMaterial) {
          part.mesh.material.uniforms.uTime.value = this.plasmaElapsed;
        }
      }

      // Despawn far behind — remove from scene and dispose
      if (wave.z < playerZ - 20) {
        wave.active = false;
        this.scene.remove(wave.group);
        wave.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
          if (child instanceof THREE.LineSegments) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
      }
    }

    // Cleanup inactive waves from array
    for (let i = this.waves.length - 1; i >= 0; i--) {
      if (!this.waves[i].active) {
        this.waves.splice(i, 1);
      }
    }

    // Warning timer
    if (this.warningTimer > 0) {
      this.warningTimer -= dt;
      if (this.warningTimer <= 0) {
        this.warningActive = false;
      }
    }
  }

  private animatePart(part: BossPart, time: number, dt: number) {
    switch (part.pattern) {
      case "spin":
        part.mesh.rotation.y += part.speed * dt;
        part.mesh.rotation.z = Math.sin(time * 0.5 + part.phase) * 0.3;
        break;
      case "oscillate":
        part.mesh.position.x = part.baseX + Math.sin(time * part.speed + part.phase) * 3;
        break;
      case "converge": {
        // Walls that close in then open
        const cycle = (Math.sin(time * part.speed + part.phase) + 1) / 2; // 0-1
        const x = part.baseX * (0.3 + cycle * 0.7);
        part.mesh.position.x = x;
        break;
      }
      case "static":
        break;
    }
  }

  private spawnBossWave(z: number) {
    const types = Object.values(BossType);
    const type = types[this.bossCount % types.length] as BossType;
    this.bossCount++;

    const group = new THREE.Group();
    group.position.z = z;
    const parts: BossPart[] = [];

    const c = this.biomes.colors;

    switch (type) {
      case BossType.SpinningGate:
        this.createSpinningGate(group, parts, c.obstacleEdge);
        break;
      case BossType.ConvergingWalls:
        this.createConvergingWalls(group, parts, c.obstacleEdge);
        break;
      case BossType.OrbitalRings:
        this.createOrbitalRings(group, parts, c.obstacleEdge);
        break;
      case BossType.LaserGrid:
        this.createLaserGrid(group, parts, c.obstacleEdge);
        break;
    }

    this.scene.add(group);

    this.waves.push({
      group,
      z,
      active: true,
      type,
      parts,
      timer: 0,
      triggered: false,
    });
  }

  private createBossMesh(w: number, h: number, d: number, color: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.ShaderMaterial({
      vertexShader: PLASMA_VERTEX,
      fragmentShader: PLASMA_OBSTACLE_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uBaseColor: { value: new THREE.Color(color) },
        uEdgeColor: { value: new THREE.Color(color).multiplyScalar(1.5) },
        uAccentColor: { value: new THREE.Color(color).multiplyScalar(1.3) },
        uOpacity: { value: 1.0 },
      },
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: true,
    });
    const mesh = new THREE.Mesh(geo, mat);

    // Edge glow
    const edgeGeo = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
    });
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    mesh.add(edges);

    return mesh;
  }

  private createSpinningGate(group: THREE.Group, parts: BossPart[], color: number) {
    // Central rotating cross
    for (let i = 0; i < 4; i++) {
      const arm = this.createBossMesh(6, 1.5, 0.8, color);
      arm.position.set(0, 1.5, i * 4 - 6);
      arm.rotation.y = (i * Math.PI) / 4;
      group.add(arm);

      parts.push({
        mesh: arm,
        baseX: 0,
        baseY: 1.5,
        halfWidth: 3,
        pattern: "spin",
        phase: i * Math.PI / 2,
        speed: 1.5 + i * 0.3,
      });
    }
  }

  private createConvergingWalls(group: THREE.Group, parts: BossPart[], color: number) {
    // Two walls that oscillate open/closed, staggered
    for (let row = 0; row < 3; row++) {
      for (const side of [-1, 1]) {
        const wall = this.createBossMesh(3, 4, 0.8, color);
        const x = side * 3;
        wall.position.set(x, 2, row * 5 - 5);
        group.add(wall);

        parts.push({
          mesh: wall,
          baseX: x,
          baseY: 2,
          halfWidth: 1.5,
          pattern: "converge",
          phase: row * 1.5,
          speed: 1.2,
        });
      }
    }
  }

  private createOrbitalRings(group: THREE.Group, parts: BossPart[], color: number) {
    // Multiple pillars that oscillate side to side
    for (let i = 0; i < 5; i++) {
      const pillar = this.createBossMesh(1.5, 3, 1.5, color);
      const x = (i % 2 === 0 ? -1 : 1) * 2;
      pillar.position.set(x, 1.5, i * 3 - 6);
      group.add(pillar);

      parts.push({
        mesh: pillar,
        baseX: x,
        baseY: 1.5,
        halfWidth: 0.75,
        pattern: "oscillate",
        phase: i * 1.2,
        speed: 2.0,
      });
    }
  }

  private createLaserGrid(group: THREE.Group, parts: BossPart[], color: number) {
    // Horizontal bars that oscillate vertically (some can be ducked, some can't)
    for (let i = 0; i < 4; i++) {
      const bar = this.createBossMesh(LANE_WIDTH, 0.8, 0.5, color);
      const x = (this.random() - 0.5) * 4;
      bar.position.set(x, 1.5, i * 4 - 6);
      group.add(bar);

      parts.push({
        mesh: bar,
        baseX: x,
        baseY: 1.5,
        halfWidth: LANE_WIDTH / 2,
        pattern: "oscillate",
        phase: i * 2,
        speed: 1.5,
      });
    }
  }

  /** Check if player is hitting any boss part */
  checkCollision(playerX: number, playerZ: number, playerRadius: number): boolean {
    for (const wave of this.waves) {
      if (!wave.active) continue;

      for (const part of wave.parts) {
        const worldPos = new THREE.Vector3();
        part.mesh.getWorldPosition(worldPos);

        const dx = Math.abs(playerX - worldPos.x);
        const dz = Math.abs(playerZ - worldPos.z);

        if (dx < part.halfWidth + playerRadius && dz < 1.5) {
          return true;
        }
      }
    }
    return false;
  }

  /** Check close calls for boss parts */
  checkCloseCall(playerX: number, playerZ: number): boolean {
    for (const wave of this.waves) {
      if (!wave.active) continue;

      for (const part of wave.parts) {
        const worldPos = new THREE.Vector3();
        part.mesh.getWorldPosition(worldPos);

        const dx = Math.abs(playerX - worldPos.x);
        const dz = Math.abs(playerZ - worldPos.z);

        if (dx < part.halfWidth + 1.0 && dz < 2) {
          return true;
        }
      }
    }
    return false;
  }

  reset() {
    for (const wave of this.waves) {
      this.scene.remove(wave.group);
    }
    this.waves.length = 0;
    this.nextBossZ = BOSS_INTERVAL;
    this.bossCount = 0;
    this.plasmaElapsed = 0;
    this.warningActive = false;
    this.warningTimer = 0;
  }
}

const LANE_WIDTH = 9;
