import * as THREE from "three";
import { BiomeManager } from "./biomes";

/**
 * Speed Gates — booster rings that give a massive speed burst
 * with dramatic visual effects. Passing through one feels amazing.
 */

export interface SpeedGate {
  group: THREE.Group;
  z: number;
  x: number;
  active: boolean;
  collected: boolean;
  ring: THREE.Mesh;
  particles: THREE.Points;
  /** The amount of speed boost this gate gives */
  boostAmount: number;
}

export class SpeedGateManager {
  private scene: THREE.Scene;
  private biomes: BiomeManager;
  private random: () => number = Math.random;
  private gates: SpeedGate[] = [];
  private nextGateZ = 60;
  private gateSpacing = 80; // meters between gates
  private activeBoost = 0; // remaining boost time
  private boostSpeed = 0; // current boost speed addition
  private cleanupTimer = 0;

  /** Replace the PRNG used for gate spawning. Call before each game start. */
  setRandom(fn: () => number) {
    this.random = fn;
  }

  constructor(scene: THREE.Scene, biomes: BiomeManager) {
    this.scene = scene;
    this.biomes = biomes;
  }

  update(dt: number, playerZ: number, playerX: number): {
    justCollected: boolean;
    boostAmount: number;
    gatePosition: THREE.Vector3 | null;
  } {
    let justCollected = false;
    let boostAmount = 0;
    let gatePosition: THREE.Vector3 | null = null;

    // Spawn gates ahead
    while (this.nextGateZ < playerZ + 80) {
      this.spawnGate(this.nextGateZ);
      this.nextGateZ += this.gateSpacing + (this.random() - 0.5) * 20;
    }

    // Animate gates
    const time = performance.now() * 0.001;
    for (const gate of this.gates) {
      if (!gate.active) continue;

      // Ring rotation
      gate.ring.rotation.z += dt * 3;
      gate.ring.rotation.x += dt * 0.5;

      // Particle swirl
      const positions = gate.particles.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i++) {
        const angle = time * 4 + (i / positions.count) * Math.PI * 2;
        const radius = 1.2 + Math.sin(time * 2 + i) * 0.3;
        positions.setXYZ(
          i,
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          Math.sin(time * 3 + i * 0.5) * 0.3
        );
      }
      positions.needsUpdate = true;

      // Pulse glow based on proximity
      const dist = Math.abs(playerZ - gate.z);
      if (dist < 15) {
        const proximity = 1 - dist / 15;
        const mat = gate.ring.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.6 + proximity * 0.8;
        gate.group.scale.setScalar(1 + proximity * 0.1);
      }

      // Collection check
      if (!gate.collected) {
        const dz = Math.abs(playerZ - gate.z);
        const dx = Math.abs(playerX - gate.x);
        if (dz < 1.5 && dx < 2.0) {
          gate.collected = true;
          justCollected = true;
          boostAmount = gate.boostAmount;
          gatePosition = new THREE.Vector3(gate.x, 1, gate.z);

          // Visual: expand ring rapidly then fade
          gate.ring.scale.setScalar(3);
          const mat = gate.ring.material as THREE.MeshStandardMaterial;
          mat.opacity = 0.3;
        }
      }

      // Despawn behind player
      if (gate.z < playerZ - 10) {
        gate.active = false;
        gate.group.visible = false;
      }
    }

    // Decay boost
    if (this.activeBoost > 0) {
      this.activeBoost -= dt;
      if (this.activeBoost <= 0) {
        this.boostSpeed = 0;
      }
    }

    // Periodic cleanup
    this.cleanupTimer += dt;
    if (this.cleanupTimer > 5) {
      this.cleanupTimer = 0;
      this.cleanup();
    }

    return { justCollected, boostAmount, gatePosition };
  }

  /** Apply a speed boost */
  applyBoost(amount: number) {
    this.boostSpeed = amount;
    this.activeBoost = 2.5; // 2.5 seconds of boost
  }

  /** Get current boost speed addition */
  getBoostSpeed(): number {
    if (this.activeBoost <= 0) return 0;
    // Ease out the boost
    const t = this.activeBoost / 2.5;
    return this.boostSpeed * t;
  }

  /** Whether currently boosting */
  isBoosting(): boolean {
    return this.activeBoost > 0;
  }

  private spawnGate(z: number) {
    const x = (this.random() - 0.5) * 4; // centered-ish
    const group = new THREE.Group();
    group.position.set(x, 1, z);

    const c = this.biomes.colors;
    const gateColor = 0x00ffff; // always cyan for recognition

    // Main ring — torus
    const torusGeo = new THREE.TorusGeometry(1.5, 0.08, 8, 32);
    const torusMat = new THREE.MeshStandardMaterial({
      color: gateColor,
      emissive: gateColor,
      emissiveIntensity: 0.6,
      metalness: 0.8,
      roughness: 0.1,
      transparent: true,
      opacity: 0.9,
    });
    const ring = new THREE.Mesh(torusGeo, torusMat);
    group.add(ring);

    // Outer ring for depth
    const outerGeo = new THREE.TorusGeometry(1.8, 0.04, 6, 32);
    const outerMat = new THREE.MeshStandardMaterial({
      color: gateColor,
      emissive: gateColor,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.5,
    });
    const outerRing = new THREE.Mesh(outerGeo, outerMat);
    outerRing.rotation.z = Math.PI / 6;
    group.add(outerRing);

    // Swirling particles inside
    const particleCount = 20;
    const positions = new Float32Array(particleCount * 3);
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: gateColor,
      size: 0.12,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    group.add(particles);

    // Arrow indicators pointing inward (chevrons)
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const arrowGeo = new THREE.ConeGeometry(0.12, 0.3, 4);
      const arrowMat = new THREE.MeshBasicMaterial({
        color: gateColor,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
      });
      const arrow = new THREE.Mesh(arrowGeo, arrowMat);
      arrow.position.set(Math.cos(angle) * 1.2, Math.sin(angle) * 1.2, 0);
      arrow.rotation.z = angle + Math.PI / 2;
      group.add(arrow);
    }

    this.scene.add(group);

    // Boost scales with distance (later gates give bigger boosts)
    const boostAmount = 10 + Math.min(z / 200, 15);

    this.gates.push({
      group,
      z,
      x,
      active: true,
      collected: false,
      ring,
      particles,
      boostAmount,
    });
  }

  private cleanup() {
    for (let i = this.gates.length - 1; i >= 0; i--) {
      if (!this.gates[i].active) {
        const gate = this.gates[i];
        this.scene.remove(gate.group);
        gate.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
          if (child instanceof THREE.Points) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
        this.gates.splice(i, 1);
      }
    }
  }

  reset() {
    for (const gate of this.gates) {
      this.scene.remove(gate.group);
      gate.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
        if (child instanceof THREE.Points) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    }
    this.gates = [];
    this.nextGateZ = 60;
    this.activeBoost = 0;
    this.boostSpeed = 0;
  }
}
