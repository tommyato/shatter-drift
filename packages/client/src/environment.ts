import * as THREE from "three";
import { BiomeManager } from "./biomes";

/**
 * Biome environment particles — floating geometry unique to each biome
 * that gives each zone a distinct visual identity and depth.
 *
 * Void: drifting dust motes
 * Crystal Caves: floating crystal shards
 * Neon District: neon light streaks
 * Solar Storm: falling ember particles
 * Cosmic Rift: swirling energy wisps
 */

interface EnvParticle {
  mesh: THREE.Mesh | THREE.Points;
  basePos: THREE.Vector3;
  phase: number;
  speed: number;
  drift: THREE.Vector3;
  type: number; // biome index
}

const PARTICLE_COUNT = 40;
const PARTICLE_SPREAD_X = 20;
const PARTICLE_SPREAD_Y = 12;
const PARTICLE_SPREAD_Z = 60;

export class EnvironmentParticles {
  private scene: THREE.Scene;
  private biomes: BiomeManager;
  private particles: EnvParticle[] = [];
  private lastBiomeIndex = -1;

  // Shared geometries
  private shardGeo: THREE.BufferGeometry;
  private cubeGeo: THREE.BufferGeometry;
  private octaGeo: THREE.BufferGeometry;
  private sphereGeo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, biomes: BiomeManager) {
    this.scene = scene;
    this.biomes = biomes;

    // Pre-create shared geometries
    this.shardGeo = new THREE.TetrahedronGeometry(0.15, 0);
    this.cubeGeo = new THREE.BoxGeometry(0.08, 0.4, 0.08);
    this.octaGeo = new THREE.OctahedronGeometry(0.12, 0);
    this.sphereGeo = new THREE.SphereGeometry(0.06, 6, 4);

    this.spawnParticles();
  }

  private spawnParticles() {
    this.clearParticles();

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const particle = this.createParticle(i);
      this.particles.push(particle);
    }
  }

  private createParticle(index: number): EnvParticle {
    const biomeIdx = this.biomes.biomeIndex;
    const c = this.biomes.colors;

    const basePos = new THREE.Vector3(
      (Math.random() - 0.5) * PARTICLE_SPREAD_X,
      Math.random() * PARTICLE_SPREAD_Y + 1,
      (Math.random() - 0.5) * PARTICLE_SPREAD_Z
    );

    let mesh: THREE.Mesh;
    let drift = new THREE.Vector3(0, 0, 0);

    switch (biomeIdx) {
      case 0: // Void — small drifting dust
        mesh = new THREE.Mesh(
          this.sphereGeo,
          new THREE.MeshBasicMaterial({
            color: 0x444466,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        drift.set(
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.1,
          0
        );
        break;

      case 1: // Crystal Caves — floating crystal shards
        mesh = new THREE.Mesh(
          this.shardGeo,
          new THREE.MeshStandardMaterial({
            color: 0x2266cc,
            emissive: 0x44aaff,
            emissiveIntensity: 0.6,
            transparent: true,
            opacity: 0.5,
            metalness: 0.8,
            roughness: 0.1,
          })
        );
        drift.set(
          (Math.random() - 0.5) * 0.2,
          Math.sin(index) * 0.15,
          0
        );
        break;

      case 2: // Neon District — thin vertical light streaks
        mesh = new THREE.Mesh(
          this.cubeGeo,
          new THREE.MeshBasicMaterial({
            color: Math.random() > 0.5 ? 0xff44aa : 0xaa44ff,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        drift.set(0, -1.5 - Math.random() * 2, 0); // falling streaks
        break;

      case 3: // Solar Storm — ember particles
        mesh = new THREE.Mesh(
          this.sphereGeo,
          new THREE.MeshBasicMaterial({
            color: Math.random() > 0.5 ? 0xff6600 : 0xffaa00,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        mesh.scale.setScalar(0.5 + Math.random() * 1.5);
        drift.set(
          (Math.random() - 0.5) * 0.5,
          0.5 + Math.random() * 1,
          (Math.random() - 0.5) * 0.3
        );
        break;

      case 4: // Cosmic Rift — swirling energy wisps
      default:
        mesh = new THREE.Mesh(
          this.octaGeo,
          new THREE.MeshStandardMaterial({
            color: 0x00aa66,
            emissive: 0x00ffaa,
            emissiveIntensity: 0.8,
            transparent: true,
            opacity: 0.4,
            metalness: 0.5,
            roughness: 0.2,
          })
        );
        drift.set(
          Math.cos(index * 0.7) * 0.6,
          Math.sin(index * 0.5) * 0.3,
          0
        );
        break;
    }

    mesh.position.copy(basePos);
    this.scene.add(mesh);

    return {
      mesh,
      basePos: basePos.clone(),
      phase: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.7,
      drift,
      type: biomeIdx,
    };
  }

  update(dt: number, playerZ: number) {
    const time = performance.now() * 0.001;
    const biomeIdx = this.biomes.biomeIndex;

    // Respawn particles when biome changes
    if (biomeIdx !== this.lastBiomeIndex) {
      this.lastBiomeIndex = biomeIdx;
      this.spawnParticles();
    }

    for (const p of this.particles) {
      // Move with player (parallax — particles are scenery)
      const relZ = p.basePos.z + playerZ * 0.8;
      const wrappedZ = ((relZ % PARTICLE_SPREAD_Z) + PARTICLE_SPREAD_Z) % PARTICLE_SPREAD_Z - PARTICLE_SPREAD_Z / 2;

      // Base position with drift animation
      p.mesh.position.x = p.basePos.x + Math.sin(time * p.speed + p.phase) * p.drift.x * 3;
      p.mesh.position.y = p.basePos.y + Math.sin(time * p.speed * 0.7 + p.phase * 2) * p.drift.y;
      p.mesh.position.z = wrappedZ + playerZ;

      // Rotation
      p.mesh.rotation.x += dt * p.speed * 0.5;
      p.mesh.rotation.y += dt * p.speed * 0.3;
      p.mesh.rotation.z += dt * p.speed * 0.2;

      // Pulse opacity based on distance from player
      const distFromPlayer = Math.abs(p.mesh.position.z - playerZ);
      const fadeNear = Math.min(1, distFromPlayer / 5);
      const fadeFar = Math.max(0, 1 - distFromPlayer / (PARTICLE_SPREAD_Z * 0.6));
      const baseMat = p.mesh.material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;
      if ('opacity' in baseMat) {
        const baseOpacity = biomeIdx === 0 ? 0.3 : biomeIdx === 2 ? 0.4 : 0.5;
        baseMat.opacity = baseOpacity * fadeNear * fadeFar;
      }
    }
  }

  private clearParticles() {
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      // Don't dispose shared geometries — just dispose materials
      if (p.mesh instanceof THREE.Mesh) {
        (p.mesh.material as THREE.Material).dispose();
      }
    }
    this.particles.length = 0;
  }

  dispose() {
    this.clearParticles();
    this.shardGeo.dispose();
    this.cubeGeo.dispose();
    this.octaGeo.dispose();
    this.sphereGeo.dispose();
  }
}
