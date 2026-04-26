import * as THREE from "three";

/**
 * Afterimage trail — ghostly copies of the player that fade behind
 * at high speed. Creates that classic "speed ghost" look.
 */

const MAX_GHOSTS = 8;
const GHOST_INTERVAL = 0.04; // seconds between ghost spawns
const GHOST_LIFETIME = 0.35;  // seconds until ghost fades

interface Ghost {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  baseScale: number;
}

export class AfterimageTrail {
  private ghosts: Ghost[] = [];
  private pool: THREE.Mesh[] = [];
  private scene: THREE.Scene;
  private geo: THREE.IcosahedronGeometry;
  private spawnTimer = 0;
  private intensity = 0; // 0–1 driven by speed

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.geo = new THREE.IcosahedronGeometry(0.6, 0);

    // Pre-create mesh pool
    for (let i = 0; i < MAX_GHOSTS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00ffcc,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        wireframe: true,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push(mesh);
    }
  }

  /** Set intensity from speed (0 = none, 1 = full) */
  setIntensity(speedNorm: number) {
    // Start showing at 50% speed
    this.intensity = Math.max(0, (speedNorm - 0.4) / 0.6);
  }

  /** Set color to match biome/state */
  setColor(color: number) {
    for (const mesh of this.pool) {
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    }
  }

  /** Spawn a ghost at the given position + rotation */
  private spawn(position: THREE.Vector3, rotation: THREE.Euler) {
    // Find an available mesh from pool
    let mesh: THREE.Mesh | null = null;
    for (const m of this.pool) {
      if (!m.visible) { mesh = m; break; }
    }
    if (!mesh) {
      // Reuse oldest ghost
      if (this.ghosts.length > 0) {
        const old = this.ghosts.shift()!;
        mesh = old.mesh;
      } else return;
    }

    mesh.visible = true;
    mesh.position.copy(position);
    mesh.rotation.copy(rotation);
    mesh.scale.setScalar(1);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.4 * this.intensity;

    this.ghosts.push({
      mesh,
      life: GHOST_LIFETIME,
      maxLife: GHOST_LIFETIME,
      baseScale: 1,
    });
  }

  update(dt: number, playerPos: THREE.Vector3, playerRotation: THREE.Euler, isShattered: boolean) {
    if (this.intensity < 0.01) {
      // Hide all when not at speed
      for (const ghost of this.ghosts) {
        ghost.mesh.visible = false;
      }
      this.ghosts.length = 0;
      return;
    }

    // Spawn timer
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = GHOST_INTERVAL / this.intensity; // more frequent at higher speed
      if (!isShattered) {
        this.spawn(playerPos, playerRotation);
      }
    }

    // Update existing ghosts
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.life -= dt;

      const t = g.life / g.maxLife; // 1 → 0
      const mat = g.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = t * 0.35 * this.intensity;
      g.mesh.scale.setScalar(g.baseScale * (0.6 + t * 0.4)); // shrink as it fades

      if (g.life <= 0) {
        g.mesh.visible = false;
        this.ghosts.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const mesh of this.pool) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    this.geo.dispose();
  }
}
