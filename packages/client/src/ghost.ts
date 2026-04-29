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
  /** World seed the run was played on. Undefined for legacy records pre-seeding. */
  seed?: number;
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

/** One running ghost. */
interface Ghost {
  record: GhostRecord;
  /** Current interpolated position — updated every frame for HUD display. */
  position: THREE.Vector3;
  id: string;
  finished: boolean;
  /** Cached current frame index (linear search hint). */
  lastFrameIdx: number;
}

/**
 * Manages ghost playback: interpolating position from recorded frames,
 * tracking completion. No rendering — HUD-only.
 */
export class GhostManager {
  private ghosts: Ghost[] = [];
  /** Run time in seconds since Playing state started. */
  private runTime = 0;
  /** Names of ghosts that the player has outlasted this run (reset each run). */
  private beatenNames: string[] = [];

  get ghostCount(): number {
    return this.ghosts.length;
  }

  /** The loaded ghost records — used by Game to build the ghost pool for a race. */
  getRecords(): GhostRecord[] {
    return this.ghosts.map(g => g.record);
  }

  /** Populate ghosts from fetched records. Call before gameplay starts.
   *  The legacy "top 3 ghosts as ambient racers" cap was removed: the game
   *  now passes either zero (normal run) or one (Race This Ghost) record
   *  per the single-ghost race model — ambient ghosts ran on the wrong
   *  seed and produced unrelated obstacle layouts, so they weren't a race. */
  loadGhosts(records: GhostRecord[]) {
    this.clear();
    for (const record of records) {
      if (!record.frames || record.frames.length < 2) continue;
      this.ghosts.push({
        record,
        position: new THREE.Vector3(0, 0, 0),
        id: record.id,
        finished: false,
        lastFrameIdx: 0,
      });
    }
  }



  /** Reset run time for a fresh run. */
  startRun() {
    this.runTime = 0;
    this.beatenNames = [];
    for (const g of this.ghosts) {
      g.finished = false;
      g.lastFrameIdx = 0;
      g.position.set(0, 0, 0);
    }
  }

  /** Advance ghost playback. Call every frame while Playing. */
  update(dt: number) {
    this.runTime += dt;
    const runTimeMs = this.runTime * 1000;

    for (const g of this.ghosts) {
      if (g.finished) continue;

      const frames = g.record.frames;
      const last = frames[frames.length - 1];

      if (runTimeMs >= last.t) {
        // Player outlasted this ghost.
        g.finished = true;
        this.beatenNames.push(g.record.name);
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

      g.position.set(x, 0, z);
    }
  }



  /** Names of ghosts the player outlasted during the current run. */
  getBeatenNames(): string[] {
    return this.beatenNames.slice();
  }

  /** No-op for backward compatibility. */
  hideAll() {
    // Ghosts are now HUD-only — no visuals to hide.
  }

  /** Minimal accessor for the active race ghost's world position + finished state + record.
   *  Game uses this for the HUD (distance chip + progress bar). */
  getGhostById(id: string): { position: THREE.Vector3; finished: boolean; record: GhostRecord } | null {
    const g = this.ghosts.find(ghost => ghost.id === id);
    if (!g) return null;
    return { position: g.position, finished: g.finished, record: g.record };
  }

  clear() {
    this.ghosts = [];
  }
}
