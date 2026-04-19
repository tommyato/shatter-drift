import * as THREE from "three";

/**
 * Ghost racing — async multiplayer via recorded playbacks.
 *
 * A GhostRecorder captures the player's position/speed/phase state at 10Hz during a run.
 * A GhostManager fetches up to N ghost recordings and renders them as semi-transparent
 * wireframe crystals racing alongside the live player.
 */

/** Compact frame record — about 25 bytes as JSON. */
export interface GhostFrame {
  /** Lateral position (world X) */
  x: number;
  /** Distance along the track (world Z) */
  z: number;
  /** Current speed at this frame */
  speed: number;
  /** 1 if shattered/phased, 0 otherwise — stored as number for compactness */
  shattered: 0 | 1;
  /** Milliseconds since run start */
  t: number;
}

/** Metadata returned with a ghost recording. */
export interface GhostRecord {
  id: string;
  name: string;
  score: number;
  distance: number;
  grade: string;
  frames: GhostFrame[];
}

/** Records player state at a fixed interval. */
export class GhostRecorder {
  private frames: GhostFrame[] = [];
  private startTime = 0;
  private lastSampleTime = 0;
  private recording = false;
  /** 10Hz = 100ms between samples */
  private readonly sampleInterval = 100;

  start() {
    this.frames = [];
    this.startTime = performance.now();
    this.lastSampleTime = this.startTime - this.sampleInterval; // force first sample immediately
    this.recording = true;
  }

  stop() {
    this.recording = false;
  }

  /** Sample player state if the interval has elapsed. */
  sample(x: number, z: number, speed: number, isShattered: boolean) {
    if (!this.recording) return;
    const now = performance.now();
    if (now - this.lastSampleTime < this.sampleInterval) return;
    this.lastSampleTime = now;
    this.frames.push({
      x: Math.round(x * 100) / 100, // 2 decimals — plenty for position
      z: Math.round(z * 100) / 100,
      speed: Math.round(speed * 10) / 10,
      shattered: isShattered ? 1 : 0,
      t: Math.round(now - this.startTime),
    });
  }

  getFrames(): GhostFrame[] {
    return this.frames;
  }

  get frameCount(): number {
    return this.frames.length;
  }
}

const GHOST_COLORS = [
  { hex: 0xffffff, label: "white" },
  { hex: 0xffcc66, label: "gold" },
  { hex: 0xcccccc, label: "silver" },
];

const GHOST_OPACITY = 0.3;
const NAME_SPRITE_SCALE = 1.4;

/** One running ghost. */
interface Ghost {
  record: GhostRecord;
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  nameSprite: THREE.Sprite;
  nameMaterial: THREE.SpriteMaterial;
  color: number;
  finished: boolean;
  outlasted: boolean;
  /** Fade-out timer once the player has outlasted them. */
  fadeTimer: number;
  /** Cached current frame index (linear search hint). */
  lastFrameIdx: number;
}

/** Particle burst that plays when a ghost fades out. */
interface GhostBurst {
  group: THREE.Group;
  points: THREE.Points;
  material: THREE.PointsMaterial;
  velocities: Float32Array;
  age: number;
  lifetime: number;
}

/**
 * Manages up to N ghost meshes: fetching data, spawning visuals, interpolating playback,
 * and cleanup. Created once at game init, reset between runs.
 */
export class GhostManager {
  private scene: THREE.Scene;
  private ghosts: Ghost[] = [];
  private bursts: GhostBurst[] = [];
  /** Run time in seconds since Playing state started. */
  private runTime = 0;
  private enabled = true;
  /** Names of ghosts that the player has outlasted this run (reset each run). */
  private beatenNames: string[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    for (const g of this.ghosts) {
      g.group.visible = enabled && !g.finished;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  get ghostCount(): number {
    return this.ghosts.length;
  }

  /** Populate ghosts from fetched records. Call before gameplay starts. */
  loadGhosts(records: GhostRecord[]) {
    this.clear();
    for (let i = 0; i < Math.min(records.length, 3); i++) {
      const record = records[i];
      if (!record.frames || record.frames.length < 2) continue;
      const colorSpec = GHOST_COLORS[i % GHOST_COLORS.length];
      this.ghosts.push(this.createGhost(record, colorSpec.hex));
    }
    // Add to scene — hidden until startRun() unhides them.
    for (const g of this.ghosts) {
      g.group.visible = false;
      this.scene.add(g.group);
    }
  }

  private createGhost(record: GhostRecord, color: number): Ghost {
    const group = new THREE.Group();

    // Wireframe icosahedron — same geo as player crystal, but hollow-looking.
    const geo = new THREE.IcosahedronGeometry(0.6, 0);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: GHOST_OPACITY,
      wireframe: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, material);
    group.add(mesh);

    // Name label as sprite so it always faces the camera.
    const nameTexture = makeNameTexture(record.name, color);
    const nameMaterial = new THREE.SpriteMaterial({
      map: nameTexture,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
      depthWrite: false,
    });
    const nameSprite = new THREE.Sprite(nameMaterial);
    nameSprite.scale.set(NAME_SPRITE_SCALE * 4, NAME_SPRITE_SCALE * 0.5, 1);
    nameSprite.position.y = 1.2;
    group.add(nameSprite);

    group.visible = this.enabled;

    return {
      record,
      group,
      mesh,
      material,
      nameSprite,
      nameMaterial,
      color,
      finished: false,
      outlasted: false,
      fadeTimer: 0,
      lastFrameIdx: 0,
    };
  }

  /** Reset run time and un-hide ghosts for a fresh run. */
  startRun() {
    this.runTime = 0;
    this.beatenNames = [];
    for (const g of this.ghosts) {
      g.finished = false;
      g.outlasted = false;
      g.fadeTimer = 0;
      g.lastFrameIdx = 0;
      g.material.opacity = GHOST_OPACITY;
      g.nameMaterial.opacity = 0.7;
      g.group.visible = this.enabled;
    }
  }

  /** Advance ghost playback + bursts. Call every frame while Playing. */
  update(dt: number) {
    this.runTime += dt;
    const runTimeMs = this.runTime * 1000;

    for (const g of this.ghosts) {
      if (g.finished) continue;

      const frames = g.record.frames;
      const last = frames[frames.length - 1];

      if (runTimeMs >= last.t) {
        // Player outlasted this ghost — fade out once.
        if (!g.outlasted) {
          g.outlasted = true;
          g.fadeTimer = 0.6;
          this.beatenNames.push(g.record.name);
          this.spawnBurst(g.group.position, g.color);
        }
        g.fadeTimer -= dt;
        const fade = Math.max(0, g.fadeTimer / 0.6);
        g.material.opacity = GHOST_OPACITY * fade;
        g.nameMaterial.opacity = 0.7 * fade;
        if (g.fadeTimer <= 0) {
          g.finished = true;
          g.group.visible = false;
        }
        continue;
      }

      // Find the two frames bracketing runTimeMs.
      let i = g.lastFrameIdx;
      while (i < frames.length - 2 && frames[i + 1].t <= runTimeMs) i++;
      g.lastFrameIdx = i;

      const a = frames[i];
      const b = frames[i + 1];
      const span = b.t - a.t || 1;
      const tt = Math.min(1, Math.max(0, (runTimeMs - a.t) / span));
      const x = a.x + (b.x - a.x) * tt;
      const z = a.z + (b.z - a.z) * tt;

      g.group.position.set(x, 0, z);

      // Subtle spin so stationary ghosts still feel alive.
      g.mesh.rotation.y += dt * 1.2;
      g.mesh.rotation.x = Math.sin(this.runTime * 1.7) * 0.15;

      // Phase flicker: lower opacity + slightly pink tint while shattered.
      const shattered = a.shattered === 1;
      const targetOpacity = shattered ? GHOST_OPACITY * 0.4 : GHOST_OPACITY;
      g.material.opacity = THREE.MathUtils.lerp(g.material.opacity, targetOpacity, 1 - Math.exp(-8 * dt));
    }

    // Advance bursts.
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.age += dt;
      const positions = burst.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let p = 0; p < positions.count; p++) {
        positions.setX(p, positions.getX(p) + burst.velocities[p * 3] * dt);
        positions.setY(p, positions.getY(p) + burst.velocities[p * 3 + 1] * dt);
        positions.setZ(p, positions.getZ(p) + burst.velocities[p * 3 + 2] * dt);
      }
      positions.needsUpdate = true;
      burst.material.opacity = Math.max(0, 1 - burst.age / burst.lifetime);
      if (burst.age >= burst.lifetime) {
        this.scene.remove(burst.group);
        burst.points.geometry.dispose();
        burst.material.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  private spawnBurst(position: THREE.Vector3, color: number) {
    const count = 24;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;
      const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
      ).normalize().multiplyScalar(3 + Math.random() * 3);
      velocities[i * 3] = dir.x;
      velocities[i * 3 + 1] = dir.y;
      velocities[i * 3 + 2] = dir.z;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color,
      size: 0.25,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, material);
    const group = new THREE.Group();
    group.add(points);
    this.scene.add(group);

    this.bursts.push({
      group,
      points,
      material,
      velocities,
      age: 0,
      lifetime: 0.8,
    });
  }

  /** Names of ghosts the player outlasted during the current run. */
  getBeatenNames(): string[] {
    return this.beatenNames.slice();
  }

  /** Hide all ghosts (e.g. during title / game over). Does not destroy them. */
  hideAll() {
    for (const g of this.ghosts) g.group.visible = false;
  }

  clear() {
    for (const g of this.ghosts) {
      this.scene.remove(g.group);
      g.mesh.geometry.dispose();
      g.material.dispose();
      if (g.nameMaterial.map) g.nameMaterial.map.dispose();
      g.nameMaterial.dispose();
    }
    this.ghosts = [];
    for (const b of this.bursts) {
      this.scene.remove(b.group);
      b.points.geometry.dispose();
      b.material.dispose();
    }
    this.bursts = [];
  }
}

/** Render a short label to a CanvasTexture — used for ghost name sprites. */
function makeNameTexture(name: string, color: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const hex = "#" + color.toString(16).padStart(6, "0");
  ctx.font = "bold 36px 'Orbitron', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = hex;
  ctx.shadowBlur = 12;
  ctx.fillStyle = hex;
  ctx.fillText(name.slice(0, 16).toUpperCase(), canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
