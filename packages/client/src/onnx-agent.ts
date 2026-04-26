import type { Obstacle } from "./world";
import {
  LOOKAHEAD_DISTANCE,
  LOOKAHEAD_OBSTACLES,
  MAX_SPEED,
  PHASE_MIN_THRESHOLD,
  PHASE_POST_COOLDOWN,
  PLAYABLE_HALF_WIDTH,
} from "@sd/sim";

type OrtTensor = {
  data: ArrayLike<number>;
};

type OrtSession = {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
};

type OrtModule = {
  env: {
    wasm: {
      wasmPaths: string;
      numThreads: number;
    };
  };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => OrtTensor;
  InferenceSession: {
    create(modelPath: string): Promise<OrtSession>;
  };
};

export interface OnnxAgentState {
  playerX: number;
  playerZ: number;
  speed: number;
  shattered: boolean;
  phaseEnergy: number;
  phaseLocked: boolean;
  phaseCooldown: number;
  obstacles: readonly Obstacle[];
}

const OBSERVATION_SIZE = 24;
const ORT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.min.js";
const ORT_WASM_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/";

export class OnnxAgent {
  private session: OrtSession | null = null;
  private loadPromise: Promise<void> | null = null;
  private runtimePromise: Promise<OrtModule> | null = null;
  private inflight = false;
  private lastAction = 0;
  private generation = 0;
  private failed = false;

  constructor(private readonly modelPath = "./model.onnx") {}

  reset() {
    this.generation++;
    this.inflight = false;
    this.lastAction = 0;
  }

  async load() {
    await this.ensureSession();
  }

  update(state: OnnxAgentState): number {
    if (this.failed) {
      return this.lastAction;
    }

    void this.ensureSession();
    if (!this.session || this.inflight) {
      return this.lastAction;
    }

    const observation = this.buildObservation(state);
    const input = new Float32Array(observation);
    const session = this.session;
    const generation = this.generation;
    this.inflight = true;

    void (async () => {
      try {
        const ort = await this.getRuntime();
        const tensor = new ort.Tensor("float32", input, [1, OBSERVATION_SIZE]);
        const outputs = await session.run({ obs: tensor });
        if (generation !== this.generation) {
          return;
        }

        const logits = outputs.logits ?? Object.values(outputs)[0];
        if (!logits) {
          this.failed = true;
          return;
        }

        this.lastAction = this.argmax(logits.data);
      } catch {
        this.failed = true;
      } finally {
        if (generation === this.generation) {
          this.inflight = false;
        }
      }
    })();

    return this.lastAction;
  }

  private async ensureSession() {
    if (this.session || this.loadPromise || this.failed) {
      return this.loadPromise ?? undefined;
    }

    this.loadPromise = (async () => {
      try {
        const ort = await this.getRuntime();
        this.session = await ort.InferenceSession.create(this.modelPath);
      } catch {
        this.failed = true;
      } finally {
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  private async getRuntime(): Promise<OrtModule> {
    if (!this.runtimePromise) {
      this.runtimePromise = import(/* @vite-ignore */ ORT_URL).then((mod) => {
        const ort = mod as unknown as OrtModule;
        ort.env.wasm.wasmPaths = ORT_WASM_URL;
        ort.env.wasm.numThreads = 1;
        return ort;
      });
    }

    return this.runtimePromise;
  }

  private buildObservation(state: OnnxAgentState): Float32Array {
    const observation = new Float32Array(OBSERVATION_SIZE);
    observation[0] = this.clamp(state.playerX / PLAYABLE_HALF_WIDTH, -1, 1);
    observation[1] = state.shattered ? 1 : 0;
    observation[2] = this.clamp(state.speed / MAX_SPEED, 0, 1);
    // Phase unavailability signal — combines energy lock and post-shatter cooldown.
    // 0 = phase available, 1 = fully locked. Agent learns when shatter is usable.
    const energyLock =
      state.phaseLocked && state.phaseEnergy < PHASE_MIN_THRESHOLD
        ? (PHASE_MIN_THRESHOLD - state.phaseEnergy) / PHASE_MIN_THRESHOLD
        : 0;
    const cooldownLock = state.phaseCooldown > 0 ? state.phaseCooldown / PHASE_POST_COOLDOWN : 0;
    observation[3] = this.clamp(Math.max(energyLock, cooldownLock), 0, 1);

    const upcoming = state.obstacles
      .filter((obstacle) => obstacle.active && obstacle.z >= state.playerZ)
      .sort((a, b) => a.z - b.z)
      .slice(0, LOOKAHEAD_OBSTACLES);

    upcoming.forEach((obstacle, index) => {
      const offset = 4 + index * 4;
      observation[offset] = this.clamp((obstacle.z - state.playerZ) / LOOKAHEAD_DISTANCE, 0, 1);
      observation[offset + 1] = this.clamp(
        (obstacle.isGate ? obstacle.gapX : obstacle.x) / PLAYABLE_HALF_WIDTH,
        -1,
        1,
      );
      observation[offset + 2] = this.clamp(
        (obstacle.isGate ? obstacle.gapHalfWidth * 2 : obstacle.halfWidth * 2) /
          (PLAYABLE_HALF_WIDTH * 2),
        0,
        1,
      );
      observation[offset + 3] = obstacle.isGate
        ? 1.0
        : obstacle.halfWidth >= PLAYABLE_HALF_WIDTH * 0.85
          ? 0.5
          : 0.0;
    });

    return observation;
  }

  private argmax(values: ArrayLike<number>): number {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < values.length; i++) {
      const value = values[i] ?? Number.NEGATIVE_INFINITY;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
