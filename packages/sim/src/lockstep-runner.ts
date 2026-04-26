import type { ShatterDriftSimulation } from "./simulation";

export type InputFrame = {
  tick: number;
  action: number;
  playerIndex: number;
};

export interface LockstepFrameSource {
  drainQueuedFrames(): InputFrame[];
}

export interface LockstepTickResult {
  state: ReturnType<ShatterDriftSimulation["getState"]>;
  events: ReturnType<ShatterDriftSimulation["tick"]>["events"];
}

export interface LockstepRunnerConfig {
  sim: ShatterDriftSimulation;
  transport: LockstepFrameSource;
  playerIndices: ReadonlyMap<string, number>;
  localPlayerIndex: number;
  startTick: number;
  dropTimeoutMs?: number;
  onTickAdvanced?: (
    tick: number,
    actions: Map<number, number>,
    result: LockstepTickResult,
  ) => void;
  onPeerDropped?: (peerId: string, playerIndex: number) => void;
}

export class LockstepRunner {
  private readonly sim: ShatterDriftSimulation;
  private readonly transport: LockstepFrameSource;
  private readonly playerIndices: Map<string, number>;
  private readonly indexToPeerId: Map<number, string>;
  private readonly localPlayerIndex: number;
  private readonly dropTimeoutMs: number;
  private readonly onTickAdvanced?: (
    tick: number,
    actions: Map<number, number>,
    result: LockstepTickResult,
  ) => void;
  private readonly onPeerDropped?: (peerId: string, playerIndex: number) => void;
  private readonly pending = new Map<number, Map<number, number>>();
  private readonly droppedPlayers = new Set<number>();
  private readonly firstWaitedAt = new Map<number, number>();

  private currentTick: number;
  private running = false;

  constructor(config: LockstepRunnerConfig) {
    this.sim = config.sim;
    this.transport = config.transport;
    this.playerIndices = new Map(config.playerIndices);
    this.indexToPeerId = new Map();
    for (const [peerId, idx] of this.playerIndices) this.indexToPeerId.set(idx, peerId);
    this.localPlayerIndex = config.localPlayerIndex;
    this.dropTimeoutMs = config.dropTimeoutMs ?? 2000;
    this.onTickAdvanced = config.onTickAdvanced;
    this.onPeerDropped = config.onPeerDropped;
    this.currentTick = config.startTick;
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.pending.clear();
    this.firstWaitedAt.clear();
  }

  getCurrentTick(): number {
    return this.currentTick;
  }

  submitLocalInput(tick: number, action: number): void {
    if (!this.running) return;
    if (tick < this.currentTick) return;
    let bucket = this.pending.get(tick);
    if (!bucket) {
      bucket = new Map();
      this.pending.set(tick, bucket);
    }
    bucket.set(this.localPlayerIndex, action);
  }

  tryAdvance(nowMs: number = performance.now()): number {
    if (!this.running) return 0;

    const drained = this.transport.drainQueuedFrames();
    for (const frame of drained) {
      if (frame.tick < this.currentTick) continue;
      let bucket = this.pending.get(frame.tick);
      if (!bucket) {
        bucket = new Map();
        this.pending.set(frame.tick, bucket);
      }
      bucket.set(frame.playerIndex, frame.action);
    }

    let advanced = 0;
    while (this.canAdvance(nowMs)) {
      const bucket = this.pending.get(this.currentTick) ?? new Map<number, number>();
      for (const idx of this.droppedPlayers) {
        if (!bucket.has(idx)) bucket.set(idx, 0);
      }
      for (const [idx, action] of bucket) {
        this.sim.setAction(action, idx);
      }
      const result = this.sim.tick();
      this.onTickAdvanced?.(this.currentTick, bucket, result);
      this.pending.delete(this.currentTick);
      this.firstWaitedAt.delete(this.currentTick);
      this.currentTick += 1;
      advanced += 1;
    }
    return advanced;
  }

  private canAdvance(nowMs: number): boolean {
    const bucket = this.pending.get(this.currentTick);
    const needed = this.allPlayerIndices();
    let allHave = true;
    let firstMissingIdx = -1;
    for (const idx of needed) {
      if (this.droppedPlayers.has(idx)) continue;
      if (!bucket?.has(idx)) {
        allHave = false;
        if (firstMissingIdx < 0) firstMissingIdx = idx;
      }
    }
    if (allHave) return true;

    if (!this.firstWaitedAt.has(this.currentTick)) {
      this.firstWaitedAt.set(this.currentTick, nowMs);
      return false;
    }
    const waitedFor = nowMs - this.firstWaitedAt.get(this.currentTick)!;
    if (waitedFor >= this.dropTimeoutMs && firstMissingIdx >= 0) {
      this.markDropped(firstMissingIdx);
      return this.canAdvance(nowMs);
    }
    return false;
  }

  private allPlayerIndices(): number[] {
    return Array.from(this.indexToPeerId.keys());
  }

  private markDropped(playerIndex: number): void {
    if (this.droppedPlayers.has(playerIndex)) return;
    this.droppedPlayers.add(playerIndex);
    const peerId = this.indexToPeerId.get(playerIndex);
    if (peerId) this.onPeerDropped?.(peerId, playerIndex);
  }
}
