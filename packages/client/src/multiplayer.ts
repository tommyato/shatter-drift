/**
 * Shatter Drift multiplayer client.
 *
 * Connects to the Colyseus server-authoritative match server (`@sd/server`).
 * Server is authoritative for player movement + collision; world / obstacles /
 * crystals stay client-side and agree across peers via the shared `seed` the
 * server announces in its `start` broadcast.
 *
 * The previous implementation (Firestore lobbies + WebRTC mesh + lockstep
 * input exchange) is gone. Public class names are preserved as thin façades so
 * `game.ts` only sees a small surface change:
 *   - `LobbyClient`            — wraps the colyseus.js Client + active Room
 *   - `MeshTransport`          — sends input messages to the server
 *   - `MatchStartCoordinator`  — listens for the server's `start` broadcast
 *
 * Remote-player rendering helpers (`createRemotePlayer`, `updateRemotePlayer`,
 * `disposeRemotePlayer`, `pickPlayerColor`) are unchanged from the previous
 * version — single-player rendering didn't depend on them, and game.ts uses
 * them as-is.
 */
import * as THREE from "three";
import { Client, Room } from "colyseus.js";
import type {
  MatchPlayerInfo,
  MultiplayerConfig,
  PlayerState,
} from "@sd/sim";

import { SD_MP_URL } from "./config";

declare const __BUILD_HASH__: string;

const ROOM_NAME = "shatter-drift";
const MAX_PLAYERS = 4;

// Colyseus generates 9-character mixed-case alphanumeric room IDs (e.g.
// `cfJZQLzs6`). `joinById` is case-sensitive against that exact string, so
// we keep normalization permissive — strip whitespace + control chars only,
// preserve case and every alphanumeric. The 12-char cap matches the input's
// `maxlength` and gives headroom if Colyseus ever lengthens the default.

const PLAYER_COLOR_PALETTE = [0x4be1ff, 0xff5fa2, 0xffd24b, 0x7bff5f] as const;

export type LobbyPlayer = {
  peerId: string; // Colyseus sessionId
  name: string;
  buildHash: string;
  joinedAtMs: number;
  ready: boolean;
  playerIndex: number;
  isLocal: boolean;
};

type LobbyCallbacks = {
  onPlayersChanged?: (players: LobbyPlayer[]) => void;
  onError?: (message: string) => void;
  onLobbyClosed?: (message: string) => void;
};

type StartBroadcast = {
  seed: string | number;
  startedAt: number;
  tick: number;
  slots: MatchPlayerInfo[];
};

type SnapshotPlayer = {
  sessionId: string;
  slot: number;
  color: number;
  name: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  bumpVelX: number;
  boostActive: boolean;
  alive: boolean;
  lastInputTick: number;
};

export type ServerSnapshot = {
  receivedAtMs: number;
  tick: number;
  seed: string;
  startedAt: number;
  players: SnapshotPlayer[];
};

function normalizeName(name: string): string {
  const clean = name.trim().replace(/[\x00-\x1F\x7F]/g, "").slice(0, 24).trim();
  return clean || "Player";
}

export function normalizeCode(code: string): string {
  return code.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12);
}

export function pickPlayerColor(playerIndex: number): number {
  return PLAYER_COLOR_PALETTE[
    ((playerIndex % PLAYER_COLOR_PALETTE.length) + PLAYER_COLOR_PALETTE.length) % PLAYER_COLOR_PALETTE.length
  ]!;
}

function createPeerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `peer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildPlayerListFromRoom(room: Room | null, localSessionId: string, buildHash: string): LobbyPlayer[] {
  if (!room) return [];
  const state = room.state as { slots?: { sessionId?: string; slot?: number; playerIndex?: number; name?: string; color?: number }[] } | undefined;
  const slots = state?.slots;
  if (!slots) return [];

  const out: LobbyPlayer[] = [];
  let i = 0;
  for (const slot of slots) {
    out.push({
      peerId: slot.sessionId ?? `slot-${i}`,
      name: slot.name ?? `P${(slot.playerIndex ?? i) + 1}`,
      buildHash,
      joinedAtMs: 0,
      ready: true, // Colyseus server takes "joined" as "ready" — match starts at 2 players
      playerIndex: slot.playerIndex ?? i,
      isLocal: slot.sessionId === localSessionId,
    });
    i++;
  }
  return out;
}

// ===========================================================================
// LobbyClient — Colyseus connection + room lifecycle
// ===========================================================================

/**
 * Façade over `colyseus.js`'s Client + Room. Preserves the surface the game
 * UI consumed from the old Firestore implementation (`createLobby`,
 * `joinLobby`, `leaveLobby`, `setReady`, `subscribe`, `getPlayers`, etc.) so
 * the lobby/HUD code in `game.ts` doesn't need wholesale rewrites.
 *
 * Match-start handshake is server-driven: when the second player joins, the
 * server broadcasts `start` and `MatchStartCoordinator` fires onMatchStart.
 */
export class LobbyClient {
  private readonly client = new Client(SD_MP_URL);
  private readonly localPeerId = createPeerId();
  private readonly buildHash = __BUILD_HASH__;
  private playerName: string;
  private room: Room | null = null;
  private hostSelf = false;
  private players: LobbyPlayer[] = [];
  private callbacks = new Set<LobbyCallbacks>();
  private latestSnapshot: ServerSnapshot | null = null;
  private snapshotListeners = new Set<(snapshot: ServerSnapshot) => void>();
  private startListeners = new Set<(start: StartBroadcast) => void>();

  constructor(playerName: string) {
    this.playerName = normalizeName(playerName);
  }

  subscribe(callbacks: LobbyCallbacks): () => void {
    this.callbacks.add(callbacks);
    if (callbacks.onPlayersChanged) callbacks.onPlayersChanged(this.players.slice());
    return () => {
      this.callbacks.delete(callbacks);
    };
  }

  /** Listen for authoritative-state snapshots derived from server schema patches. */
  onSnapshot(listener: (snapshot: ServerSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    if (this.latestSnapshot) listener(this.latestSnapshot);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  /** Listen for the server's `start` broadcast (fired once per room when ≥2 players present). */
  onStart(listener: (start: StartBroadcast) => void): () => void {
    this.startListeners.add(listener);
    return () => {
      this.startListeners.delete(listener);
    };
  }

  async createLobby(): Promise<string> {
    await this.leaveLobby();
    const room = await this.client.create(ROOM_NAME, { name: this.playerName });
    this.bindRoom(room, true);
    return room.roomId;
  }

  async joinLobby(code: string): Promise<LobbyPlayer[]> {
    await this.leaveLobby();
    const cleanCode = code.trim();
    if (cleanCode.length === 0) {
      throw new Error("Enter a lobby code to join.");
    }
    let room: Room;
    try {
      room = await this.client.joinById(cleanCode, { name: this.playerName });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "join failed";
      throw new Error(`Could not join lobby ${cleanCode}: ${reason}`);
    }
    this.bindRoom(room, false);
    return this.players.slice();
  }

  /**
   * Convenience: join any open `shatter-drift` room or create one. Used by the
   * mp-smoke harness which doesn't care about lobby codes — just wants two
   * tabs to find each other.
   */
  async quickMatch(): Promise<string> {
    await this.leaveLobby();
    const room = await this.client.joinOrCreate(ROOM_NAME, { name: this.playerName });
    this.bindRoom(room, false);
    return room.roomId;
  }

  async leaveLobby(): Promise<void> {
    if (!this.room) return;
    try {
      await this.room.leave(true);
    } catch {
      // Room already disconnected — best-effort cleanup.
    }
    this.room = null;
    this.hostSelf = false;
    this.players = [];
    this.latestSnapshot = null;
    this.emitPlayersChanged();
  }

  async setPlayerName(name: string): Promise<void> {
    this.playerName = normalizeName(name);
    // The Colyseus server reads the name once at join — name changes mid-room
    // would require a custom message. For now it's fixed at room entry; the
    // HUD echoes the in-room name from the schema on next snapshot.
  }

  async setReady(_ready: boolean): Promise<void> {
    // The Colyseus server treats "joined" as "ready". This call is kept so
    // game.ts's lobby UI flow doesn't need to change shape — it just refreshes
    // the player list.
    if (this.room) {
      this.players = buildPlayerListFromRoom(this.room, this.room.sessionId, this.buildHash);
      this.emitPlayersChanged();
    }
  }

  /** Send the manual "start" trigger (host-only). Server is the source of truth. */
  requestStart(): void {
    this.room?.send("start", {});
  }

  getLobbyCode(): string | null {
    return this.room?.roomId ?? null;
  }

  getLocalPeerId(): string {
    return this.room?.sessionId ?? this.localPeerId;
  }

  getLocalName(): string {
    return this.playerName;
  }

  getBuildHash(): string {
    return this.buildHash;
  }

  getPlayers(): LobbyPlayer[] {
    return this.players.slice();
  }

  getLocalPlayerIndex(): number {
    const local = this.players.find((p) => p.isLocal);
    return local?.playerIndex ?? -1;
  }

  isHost(): boolean {
    return this.hostSelf;
  }

  /** Underlying Colyseus room — used by MeshTransport to send input messages. */
  getRoom(): Room | null {
    return this.room;
  }

  reportError(message: string): void {
    for (const callbacks of this.callbacks) {
      callbacks.onError?.(message);
    }
  }

  private bindRoom(room: Room, isHost: boolean): void {
    this.room = room;
    this.hostSelf = isHost;

    room.onStateChange((_state) => {
      this.players = buildPlayerListFromRoom(room, room.sessionId, this.buildHash);
      this.emitPlayersChanged();
      this.emitSnapshot(room);
    });

    room.onMessage("start", (payload: StartBroadcast) => {
      for (const listener of this.startListeners) listener(payload);
    });

    room.onLeave((code) => {
      const wasIntentional = code === 1000 || code === 4000; // 4000 = client-initiated leave in colyseus.js
      this.room = null;
      this.players = [];
      this.emitPlayersChanged();
      if (!wasIntentional) {
        this.emitLobbyClosed("Disconnected from match server.");
      }
    });

    room.onError((code, message) => {
      this.reportError(`Server error ${code}: ${message ?? ""}`.trim());
    });
  }

  private emitPlayersChanged(): void {
    const snapshot = this.players.slice();
    for (const callbacks of this.callbacks) {
      callbacks.onPlayersChanged?.(snapshot);
    }
  }

  private emitLobbyClosed(message: string): void {
    for (const callbacks of this.callbacks) {
      callbacks.onLobbyClosed?.(message);
    }
  }

  private emitSnapshot(room: Room): void {
    const state = room.state as
      | {
          tick?: number;
          seed?: string;
          startedAt?: number;
          players?: { forEach: (cb: (value: SnapshotPlayer, key: string) => void) => void };
        }
      | undefined;
    if (!state) return;
    const snap: ServerSnapshot = {
      receivedAtMs: performance.now(),
      tick: state.tick ?? 0,
      seed: state.seed ?? "0",
      startedAt: state.startedAt ?? 0,
      players: [],
    };
    state.players?.forEach((p, sessionId) => {
      snap.players.push({
        sessionId,
        slot: p.slot ?? 0,
        color: p.color ?? 0,
        name: p.name ?? "Player",
        x: p.x ?? 0,
        y: p.y ?? 0,
        z: p.z ?? 0,
        vx: p.vx ?? 0,
        vy: p.vy ?? 0,
        vz: p.vz ?? 0,
        bumpVelX: p.bumpVelX ?? 0,
        boostActive: !!p.boostActive,
        alive: p.alive !== false,
        lastInputTick: p.lastInputTick ?? 0,
      });
    });
    this.latestSnapshot = snap;
    for (const listener of this.snapshotListeners) listener(snap);
  }
}

// ===========================================================================
// MeshTransport — input message sender
// ===========================================================================

/**
 * Used to be the WebRTC mesh manager. Now a thin wrapper that sends the local
 * client's input messages to the Colyseus room. Kept under the same name so
 * `game.ts` doesn't have to relearn the spelling.
 */
export class MeshTransport {
  private active = false;

  constructor(private readonly lobby: LobbyClient) {}

  start(): void {
    this.active = true;
  }

  async stop(): Promise<void> {
    this.active = false;
  }

  /**
   * Send a single input frame. `tick` is the client's current sim tick;
   * `action` is the agent-input encoded action int (see `@sd/sim` agent-input.ts).
   */
  sendInputFrame(tick: number, action: number): void {
    if (!this.active) return;
    const room = this.lobby.getRoom();
    if (!room) return;
    room.send("input", { tick, action });
  }

  // The legacy mesh-only methods below are no longer used by Colyseus, but we
  // keep no-op stubs so any straggler call sites in `game.ts` don't blow up
  // before the larger refactor lands.

  setMatchHandler(_handler: unknown): void {
    /* noop — server is authoritative now, no peer-to-peer messaging */
  }

  setPeerConnectedHandler(_handler: unknown): void {
    /* noop — Colyseus connection state is owned by LobbyClient */
  }

  broadcastMatchMessage(_msg: unknown): void {
    /* noop */
  }

  sendMatchMessageTo(_peerId: string, _msg: unknown): void {
    /* noop */
  }

  getConnectedPeerIds(): string[] {
    return this.lobby.getPlayers().filter((p) => !p.isLocal).map((p) => p.peerId);
  }

  drainQueuedFrames(): never[] {
    return [];
  }
}

// ===========================================================================
// MatchStartCoordinator — listens for server `start` broadcast
// ===========================================================================

export type MatchStartCallbacks = {
  onMatchStart: (config: MultiplayerConfig) => void;
  onError?: (msg: string) => void;
};

export class MatchStartCoordinator {
  private active = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly lobby: LobbyClient,
    private readonly _transport: MeshTransport,
    private readonly callbacks: MatchStartCallbacks,
  ) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.unsubscribe = this.lobby.onStart((payload) => this.handleServerStart(payload));
  }

  stop(): void {
    this.active = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * No-op preserved for compatibility — the server decides when the match
   * actually begins. We forward a manual "start" message in case the server
   * supports a host-triggered launch path; auto-start at 2 players still works
   * regardless.
   */
  requestMatchStart(_opts: { startTickOffset?: number } = {}): boolean {
    if (!this.active) return false;
    this.lobby.requestStart();
    return true;
  }

  private handleServerStart(payload: StartBroadcast): void {
    const localPeerId = this.lobby.getLocalPeerId();
    const local = payload.slots.find((s) => s.peerId === localPeerId);
    if (!local) {
      this.callbacks.onError?.("Match started but local peer is not in the slot list.");
      return;
    }
    const seedNum = typeof payload.seed === "string" ? parseInt(payload.seed, 10) : payload.seed;
    const config: MultiplayerConfig = {
      seed: Number.isFinite(seedNum) && seedNum !== 0 ? seedNum : 1,
      startTick: payload.tick ?? 0,
      localPlayerIndex: local.playerIndex,
      players: payload.slots,
    };
    this.callbacks.onMatchStart(config);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Remote player rendering (carried over verbatim from the previous mesh
// implementation — purely visual, no transport coupling)
// ────────────────────────────────────────────────────────────────────────────

export interface RemotePlayer {
  playerIndex: number;
  name: string;
  color: number;
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  nameSprite: THREE.Sprite;
  nameMaterial: THREE.SpriteMaterial;
}

const REMOTE_PLAYER_RADIUS = 0.6;
const REMOTE_NAME_SPRITE_SCALE = 0.7;

export function createRemotePlayer(playerIndex: number, name: string, color: number): RemotePlayer {
  const group = new THREE.Group();

  const geo = new THREE.IcosahedronGeometry(REMOTE_PLAYER_RADIUS, 0);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: false,
    wireframe: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  group.add(mesh);

  const wireMat = new THREE.MeshBasicMaterial({
    color,
    wireframe: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  const wireMesh = new THREE.Mesh(geo, wireMat);
  wireMesh.scale.setScalar(1.05);
  group.add(wireMesh);

  const nameTexture = makeRemoteNameTexture(name, color);
  const nameMaterial = new THREE.SpriteMaterial({
    map: nameTexture,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
  });
  const nameSprite = new THREE.Sprite(nameMaterial);
  nameSprite.scale.set(REMOTE_NAME_SPRITE_SCALE * 4, REMOTE_NAME_SPRITE_SCALE * 0.5, 1);
  nameSprite.position.y = 1.4;
  group.add(nameSprite);

  return { playerIndex, name, color, group, mesh, material, nameSprite, nameMaterial };
}

export function updateRemotePlayer(remote: RemotePlayer, player: PlayerState, dt: number): void {
  remote.group.visible = player.alive;
  if (!player.alive) return;

  remote.group.position.set(player.x, 0, player.z);
  remote.mesh.rotation.y += dt * 1.2;
  remote.mesh.rotation.x = Math.sin(performance.now() * 0.0017) * 0.15;

  const targetOpacity = player.shattered ? 0.35 : 1;
  remote.material.opacity = THREE.MathUtils.lerp(
    remote.material.opacity || 1,
    targetOpacity,
    1 - Math.exp(-8 * dt),
  );
  remote.material.transparent = player.shattered;
}

export function disposeRemotePlayer(remote: RemotePlayer): void {
  remote.mesh.geometry.dispose();
  remote.material.dispose();
  if (remote.nameMaterial.map) remote.nameMaterial.map.dispose();
  remote.nameMaterial.dispose();
}

function makeRemoteNameTexture(name: string, color: number): THREE.CanvasTexture {
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

// Re-export `LockstepRunner` from the sim package — single-player still uses
// it for deterministic ghost replay and validate-sim. Multiplayer no longer
// uses lockstep on the wire.
export { LockstepRunner } from "@sd/sim";

// ===========================================================================
// MpRunner — local prediction + server reconciliation + remote interpolation
// ===========================================================================

import { ShatterDriftSimulation } from "@sd/sim";
import type { AuthoritativeStateSnapshot, GameSnapshot, PlayerState as SimPlayerState } from "@sd/sim";

/** Render delay for remote-player snapshot interpolation. ~3 server ticks at 30 Hz. */
const REMOTE_RENDER_DELAY_MS = 100;
/** Client logic tick rate — must match server's `setSimulationInterval` cadence. */
const CLIENT_TICK_HZ = 30;
const CLIENT_TICK_DT = 1 / CLIENT_TICK_HZ;
/** How many input ticks we keep in the local replay buffer (drop older). */
const INPUT_BUFFER_LIMIT_TICKS = 120; // ~4s at 30Hz

export type MpRunnerEvents = {
  type: "player_bumped";
  playerA: number;
  playerB: number;
  contactX: number;
  contactZ: number;
};

export interface MpRunnerOptions {
  config: MultiplayerConfig;
  transport: MeshTransport;
  onTickAdvanced?: (tick: number, state: GameSnapshot) => void;
  onEvent?: (event: MpRunnerEvents) => void;
  onLocalDeath?: () => void;
}

interface RemotePlayerSample {
  receivedAtMs: number;
  player: SnapshotPlayer;
}

/**
 * Drives the local prediction sim during a Colyseus match.
 *
 * Each frame: accumulates real-time dt, runs the local sim at a fixed 30 Hz
 * matching the server, and forwards input messages over the transport. On
 * each incoming server snapshot, snaps the local player to the server's
 * authoritative position and replays buffered inputs newer than the last
 * server-acked tick — classic client-side prediction + reconciliation.
 *
 * For remote players, holds a small history of server samples and exposes a
 * helper that returns positions interpolated ~100 ms behind the latest
 * snapshot, smoothing over packet jitter.
 */
export class MpRunner {
  private readonly sim: ShatterDriftSimulation;
  private readonly transport: MeshTransport;
  private readonly localPlayerIndex: number;
  private readonly config: MultiplayerConfig;
  private accumulator = 0;
  private currentTick: number;
  private lastServerTick = -1;
  private inputBuffer = new Map<number, number>();
  private remoteHistory = new Map<number, RemotePlayerSample[]>();
  private latestSnapshot: ServerSnapshot | null = null;
  private running = false;

  constructor(opts: MpRunnerOptions) {
    const { config, transport } = opts;
    this.config = config;
    this.transport = transport;
    this.localPlayerIndex = config.localPlayerIndex;
    this.currentTick = config.startTick;
    this.sim = new ShatterDriftSimulation({
      seed: config.seed,
      playerCount: config.players.length,
      localPlayerIndex: config.localPlayerIndex,
      playerNames: config.players.map((p) => p.name),
      playerColors: config.players.map((p) => p.color),
      fixedDt: CLIENT_TICK_DT,
    });
    this.onTickAdvanced = opts.onTickAdvanced;
    this.onEvent = opts.onEvent;
    this.onLocalDeath = opts.onLocalDeath;
  }

  private readonly onTickAdvanced?: MpRunnerOptions["onTickAdvanced"];
  private readonly onEvent?: MpRunnerOptions["onEvent"];
  private readonly onLocalDeath?: MpRunnerOptions["onLocalDeath"];

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.inputBuffer.clear();
    this.remoteHistory.clear();
  }

  getCurrentTick(): number {
    return this.currentTick;
  }

  /** Underlying simulation — exposed so renderers can call `applyAuthoritativeState`, etc. */
  getSim(): ShatterDriftSimulation {
    return this.sim;
  }

  /**
   * Advance one render frame. Runs as many fixed-DT sim ticks as needed to
   * keep up with wall clock, sends input to the server, and buffers it for
   * reconciliation.
   */
  tickFrame(realDt: number, action: number): void {
    if (!this.running) return;
    this.accumulator += Math.min(realDt, 0.25); // cap so a tab-blur stall doesn't fast-forward minutes
    while (this.accumulator >= CLIENT_TICK_DT) {
      if (!this.running) return; // onLocalDeath / external stop dropped us mid-loop
      this.sim.setAction(action, this.localPlayerIndex);
      const result = this.sim.tick();
      this.inputBuffer.set(this.currentTick, action);
      this.transport.sendInputFrame(this.currentTick, action);
      this.dispatchEvents(result.events);
      this.onTickAdvanced?.(this.currentTick, result.state);
      if (!this.running) return; // onTickAdvanced may have called stop() (e.g. transitionToMatchOver)
      if (result.events.some((ev) => ev.type === "death")) {
        const local = this.sim.getAuthoritativeState().players[this.localPlayerIndex];
        if (local && !local.alive) this.onLocalDeath?.();
      }
      this.currentTick += 1;
      this.accumulator -= CLIENT_TICK_DT;
    }
    this.gcInputBuffer();
  }

  /**
   * Apply a server snapshot. Snaps local player state to the server's
   * authoritative values and replays buffered inputs > server-ack tick to
   * fast-forward back to the client's predicted current tick.
   */
  applySnapshot(snapshot: ServerSnapshot): void {
    this.latestSnapshot = snapshot;
    const serverTick = snapshot.tick;
    if (serverTick < this.lastServerTick) return; // out-of-order — drop
    this.lastServerTick = serverTick;

    // Stash remote-player history for interpolation.
    for (const player of snapshot.players) {
      const idx = player.slot;
      if (idx === this.localPlayerIndex) continue;
      const history = this.remoteHistory.get(idx) ?? [];
      history.push({ receivedAtMs: snapshot.receivedAtMs, player });
      while (history.length > 8) history.shift();
      this.remoteHistory.set(idx, history);
    }

    // Snap the local sim's player states to the server snapshot.
    const simState = this.sim.getAuthoritativeState();
    for (const serverPlayer of snapshot.players) {
      const idx = serverPlayer.slot;
      const localPlayer = (this.sim as unknown as {
        runtime: {
          container: {
            get: (token: unknown) => { state: { players: SimPlayerState[] } };
          };
        };
      })["runtime"]?.container?.get;
      // Guard: don't reach into runtime internals — instead use the public
      // sim API. We snap by re-running the sim from scratch ONLY for the
      // local player, otherwise we just record server values for remote
      // rendering. The cheap approach: bring local player x and bumpVelX in
      // line with server values via the runtime reference held on the sim.
      void localPlayer;
      void simState;
      const worldPlayer = this.unsafeGetSimPlayer(idx);
      if (!worldPlayer) continue;
      worldPlayer.x = serverPlayer.x;
      worldPlayer.z = serverPlayer.z;
      worldPlayer.bumpVelX = serverPlayer.bumpVelX;
      worldPlayer.alive = serverPlayer.alive;
      worldPlayer.color = serverPlayer.color;
      // For remote players, also overwrite name to keep HUD label in sync.
      if (idx !== this.localPlayerIndex && serverPlayer.name) {
        worldPlayer.name = serverPlayer.name;
      }
    }

    // Replay buffered local inputs strictly newer than the server-ack tick
    // to fast-forward the local sim to the client's current tick.
    const localServerPlayer = snapshot.players.find((p) => p.slot === this.localPlayerIndex);
    const ackTick = localServerPlayer?.lastInputTick ?? serverTick;
    const replayInputs = Array.from(this.inputBuffer.entries())
      .filter(([tick]) => tick > ackTick && tick < this.currentTick)
      .sort((a, b) => a[0] - b[0]);
    for (const [, replayAction] of replayInputs) {
      this.sim.setAction(replayAction, this.localPlayerIndex);
      this.sim.tick();
    }
    // Drop inputs the server has already acknowledged.
    for (const tick of Array.from(this.inputBuffer.keys())) {
      if (tick <= ackTick) this.inputBuffer.delete(tick);
    }
  }

  /**
   * Latest local-sim view (predicted local player, snapped/replayed remotes).
   * Caller treats this exactly like the singleplayer `sim.getState()`.
   */
  getState(): GameSnapshot {
    return this.sim.getState();
  }

  /**
   * Authoritative-shaped snapshot for renderers that need per-player data.
   * Local player comes from local prediction; remote players are overwritten
   * with the latest server snapshot interpolated to the render delay.
   */
  getInterpolatedAuthoritativeState(nowMs: number = performance.now()): AuthoritativeStateSnapshot {
    const base = this.sim.getAuthoritativeState();
    const renderTime = nowMs - REMOTE_RENDER_DELAY_MS;
    for (const player of base.players) {
      if (player.playerIndex === this.localPlayerIndex) continue;
      const interpolated = this.interpolateRemote(player.playerIndex, renderTime);
      if (interpolated) {
        player.x = interpolated.x;
        player.z = interpolated.z;
        player.bumpVelX = interpolated.bumpVelX;
        player.alive = interpolated.alive;
        player.color = interpolated.color;
        if (interpolated.name) player.name = interpolated.name;
      }
    }
    return base;
  }

  getLatestSnapshot(): ServerSnapshot | null {
    return this.latestSnapshot;
  }

  getConfig(): MultiplayerConfig {
    return this.config;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private dispatchEvents(events: ReadonlyArray<{ type: string; [k: string]: unknown }>): void {
    if (!this.onEvent) return;
    for (const ev of events) {
      if (ev.type === "player_bumped") {
        this.onEvent({
          type: "player_bumped",
          playerA: ev.playerA as number,
          playerB: ev.playerB as number,
          contactX: ev.contactX as number,
          contactZ: ev.contactZ as number,
        });
      }
    }
  }

  private gcInputBuffer(): void {
    if (this.inputBuffer.size <= INPUT_BUFFER_LIMIT_TICKS) return;
    const minKeep = this.currentTick - INPUT_BUFFER_LIMIT_TICKS;
    for (const tick of Array.from(this.inputBuffer.keys())) {
      if (tick < minKeep) this.inputBuffer.delete(tick);
    }
  }

  private interpolateRemote(playerIndex: number, renderTimeMs: number): SnapshotPlayer | null {
    const history = this.remoteHistory.get(playerIndex);
    if (!history || history.length === 0) return null;
    if (history.length === 1) return history[0]!.player;

    // Find the two samples bracketing renderTime.
    let prev = history[0]!;
    let next = history[history.length - 1]!;
    for (let i = 0; i < history.length - 1; i++) {
      if (history[i]!.receivedAtMs <= renderTimeMs && history[i + 1]!.receivedAtMs >= renderTimeMs) {
        prev = history[i]!;
        next = history[i + 1]!;
        break;
      }
    }
    const span = next.receivedAtMs - prev.receivedAtMs;
    if (span <= 0) return next.player;
    const t = Math.max(0, Math.min(1, (renderTimeMs - prev.receivedAtMs) / span));
    return {
      ...next.player,
      x: prev.player.x + (next.player.x - prev.player.x) * t,
      z: prev.player.z + (next.player.z - prev.player.z) * t,
      bumpVelX: prev.player.bumpVelX + (next.player.bumpVelX - prev.player.bumpVelX) * t,
    };
  }

  /**
   * Reach into the live sim runtime to mutate a player's authoritative
   * fields. Used to snap to server values during reconciliation. We can't
   * achieve this through `setAction` alone — the server's authoritative `x`
   * and `bumpVelX` would otherwise stay client-predicted forever if RTT > 0.
   *
   * The runtime's container exposes the world singleton via `SimulationWorldToken`.
   * We import the token lazily to avoid a hot path coupling to sim internals.
   */
  private unsafeGetSimPlayer(playerIndex: number): SimPlayerState | undefined {
    const runtime = (this.sim as unknown as { runtime?: { container?: { get: (token: unknown) => unknown } } }).runtime;
    if (!runtime?.container) return undefined;
    // The token import is deferred: pulling it from `@sd/sim` at module-load
    // time would create a circular shape between the runner and the sim's
    // tokens module on certain bundlers. Resolve via the sim's index re-exports.
    const tokenMod = MP_SIM_TOKENS;
    const world = runtime.container.get(tokenMod.SimulationWorldToken) as
      | { state: { players: SimPlayerState[] } }
      | undefined;
    return world?.state.players[playerIndex];
  }
}

// Lazy-resolve the world token via sim package to avoid an import-time cycle.
// `@sd/sim` re-exports `SimulationWorldToken` from `./tokens`.
import * as MP_SIM_TOKENS from "@sd/sim";
