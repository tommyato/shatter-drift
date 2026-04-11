import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

// --- Bloom post-processing ---

export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera
): { composer: EffectComposer; bloom: UnrealBloomPass } {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.8,   // strength
    0.4,   // radius
    0.85   // threshold
  );
  composer.addPass(bloom);

  return { composer, bloom };
}

// --- Particle trail system ---

const MAX_TRAIL_PARTICLES = 200;

interface TrailParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

export class ParticleTrail {
  private particles: TrailParticle[] = [];
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private points: THREE.Points;
  private positions: Float32Array;
  private sizes: Float32Array;
  private colors: Float32Array;

  constructor(scene: THREE.Scene, color: number = 0x00ffcc) {
    this.positions = new Float32Array(MAX_TRAIL_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_TRAIL_PARTICLES);
    this.colors = new Float32Array(MAX_TRAIL_PARTICLES * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));

    this.material = new THREE.PointsMaterial({
      color,
      size: 0.15,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(position: THREE.Vector3, count: number, spread: number = 0.5, color?: number) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_TRAIL_PARTICLES) {
        // Reuse oldest
        this.particles.shift();
      }

      this.particles.push({
        position: position.clone().add(
          new THREE.Vector3(
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread
          )
        ),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2 + 0.5,
          (Math.random() - 0.5) * 2
        ),
        life: 1,
        maxLife: 0.3 + Math.random() * 0.7,
        size: 0.05 + Math.random() * 0.15,
      });
    }
  }

  update(dt: number) {
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt / p.maxLife;
      p.position.add(p.velocity.clone().multiplyScalar(dt));
      p.velocity.y -= dt * 2; // slight gravity
      p.velocity.multiplyScalar(1 - dt * 3); // drag

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Update geometry
    const posAttr = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < MAX_TRAIL_PARTICLES; i++) {
      if (i < this.particles.length) {
        const p = this.particles[i];
        this.positions[i * 3] = p.position.x;
        this.positions[i * 3 + 1] = p.position.y;
        this.positions[i * 3 + 2] = p.position.z;
      } else {
        this.positions[i * 3] = 0;
        this.positions[i * 3 + 1] = -100; // hide unused
        this.positions[i * 3 + 2] = 0;
      }
    }
    posAttr.needsUpdate = true;
  }

  setColor(color: number) {
    this.material.color.setHex(color);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// --- Explosion effect ---

const EXPLOSION_PARTICLE_COUNT = 80;

interface ExplosionParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
}

export class ExplosionEffect {
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private points: THREE.Points;
  private particles: ExplosionParticle[] = [];
  private positions: Float32Array;
  active = false;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(EXPLOSION_PARTICLE_COUNT * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3)
    );

    this.material = new THREE.PointsMaterial({
      color: 0xff4444,
      size: 0.3,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  trigger(position: THREE.Vector3) {
    this.active = true;
    this.points.visible = true;
    this.particles.length = 0;

    for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).normalize();
      const speed = 5 + Math.random() * 15;

      this.particles.push({
        position: position.clone(),
        velocity: dir.multiplyScalar(speed),
        life: 0.5 + Math.random() * 0.5,
      });
    }
  }

  update(dt: number) {
    if (!this.active) return;

    let anyAlive = false;
    const posAttr = this.geometry.getAttribute("position") as THREE.BufferAttribute;

    for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
      if (i < this.particles.length) {
        const p = this.particles[i];
        p.life -= dt;
        p.position.add(p.velocity.clone().multiplyScalar(dt));
        p.velocity.multiplyScalar(1 - dt * 4);

        if (p.life > 0) {
          anyAlive = true;
          this.positions[i * 3] = p.position.x;
          this.positions[i * 3 + 1] = p.position.y;
          this.positions[i * 3 + 2] = p.position.z;
        } else {
          this.positions[i * 3 + 1] = -100;
        }
      } else {
        this.positions[i * 3 + 1] = -100;
      }
    }

    posAttr.needsUpdate = true;
    this.material.opacity = Math.max(0, this.material.opacity - dt * 2);

    if (!anyAlive) {
      this.active = false;
      this.points.visible = false;
      this.material.opacity = 1;
    }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// --- Orb collect flash ---

export class CollectFlash {
  private mesh: THREE.Mesh;
  private life = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(0.5, 16, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffcc00,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  trigger(position: THREE.Vector3) {
    this.mesh.position.copy(position);
    this.mesh.visible = true;
    this.mesh.scale.setScalar(0.5);
    this.life = 0.3;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8;
  }

  update(dt: number) {
    if (this.life <= 0) return;
    this.life -= dt;
    const t = 1 - this.life / 0.3;
    this.mesh.scale.setScalar(0.5 + t * 3);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
    if (this.life <= 0) {
      this.mesh.visible = false;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
