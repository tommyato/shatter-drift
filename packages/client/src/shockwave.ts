import * as THREE from "three";

/**
 * Shockwave ring effect — expanding luminous ring on close calls,
 * power-up collections, and biome transitions. Much more visually
 * impactful than point particles alone.
 */

interface ShockwaveRing {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxScale: number;
  color: THREE.Color;
}

const MAX_RINGS = 8;

export class ShockwaveEffect {
  private rings: ShockwaveRing[] = [];
  private scene: THREE.Scene;
  private pool: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Pre-create mesh pool
    for (let i = 0; i < MAX_RINGS; i++) {
      const geo = new THREE.RingGeometry(0.8, 1.0, 48);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00ffcc,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2; // flat on ground
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push(mesh);
    }
  }

  /**
   * Trigger a shockwave ring at a position.
   * @param position World position
   * @param color Hex color
   * @param maxScale How large the ring expands
   * @param duration How long the animation lasts
   */
  trigger(
    position: THREE.Vector3,
    color: number = 0x00ffcc,
    maxScale: number = 6,
    duration: number = 0.5
  ) {
    // Find an inactive mesh from pool
    let mesh: THREE.Mesh | null = null;
    let reuseIndex = -1;

    // Check if we have inactive rings
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].visible) {
        mesh = this.pool[i];
        break;
      }
    }

    // If all active, reuse oldest
    if (!mesh) {
      if (this.rings.length > 0) {
        const oldest = this.rings.shift()!;
        mesh = oldest.mesh;
      } else {
        return; // shouldn't happen
      }
    }

    mesh.position.copy(position);
    mesh.position.y = 0.1; // slightly above ground
    mesh.visible = true;
    mesh.scale.setScalar(0.1);
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.8;

    this.rings.push({
      mesh,
      life: duration,
      maxLife: duration,
      maxScale,
      color: new THREE.Color(color),
    });
  }

  /** Trigger a vertical ring (facing forward) — great for phase-through */
  triggerVertical(
    position: THREE.Vector3,
    color: number = 0xff44ff,
    maxScale: number = 4,
    duration: number = 0.4
  ) {
    let mesh: THREE.Mesh | null = null;

    for (const m of this.pool) {
      if (!m.visible) { mesh = m; break; }
    }
    if (!mesh) {
      if (this.rings.length > 0) {
        const oldest = this.rings.shift()!;
        mesh = oldest.mesh;
      } else return;
    }

    mesh.position.copy(position);
    mesh.visible = true;
    mesh.scale.setScalar(0.1);
    mesh.rotation.x = 0; // vertical — facing camera
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.8;

    this.rings.push({
      mesh,
      life: duration,
      maxLife: duration,
      maxScale,
      color: new THREE.Color(color),
    });
  }

  update(dt: number) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.life -= dt;

      const progress = 1 - ring.life / ring.maxLife;
      const eased = this.easeOutQuart(progress);

      // Expand
      const scale = 0.1 + eased * ring.maxScale;
      ring.mesh.scale.setScalar(scale);

      // Fade out
      const opacity = (1 - progress) * 0.8;
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, opacity);

      if (ring.life <= 0) {
        ring.mesh.visible = false;
        ring.mesh.rotation.x = -Math.PI / 2; // reset to flat
        this.rings.splice(i, 1);
      }
    }
  }

  private easeOutQuart(t: number): number {
    return 1 - Math.pow(1 - t, 4);
  }

  dispose() {
    for (const mesh of this.pool) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
