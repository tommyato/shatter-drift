import * as THREE from "three";
import type { MatchPlayerInfo, MatchStartMessage, MultiplayerConfig, PlayerState } from "./types";
import { LockstepRunner, type InputFrame } from "./lockstep-runner";
export { LockstepRunner } from "./lockstep-runner";
import { initializeApp, getApp, getApps, type FirebaseApp } from "firebase/app";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  type Firestore,
  type QueryDocumentSnapshot,
  type Unsubscribe,
  updateDoc,
  where,
} from "firebase/firestore";

declare const __BUILD_HASH__: string;

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBO4CUdtMB5Njhq6NDdYf1A1ltOx_OvnI0",
  authDomain: "tommyato-deployments.firebaseapp.com",
  projectId: "tommyato-deployments",
  storageBucket: "tommyato-deployments.firebasestorage.app",
  messagingSenderId: "856931391351",
  appId: "1:856931391351:web:456c4709f968c7c0ec3372",
};

const COLLECTION_LOBBIES = "sd-mp-lobbies";
const SIGNAL_KIND_OFFER = "offer";
const SIGNAL_KIND_ANSWER = "answer";
const SIGNAL_KIND_ICE = "ice";
const MAX_PLAYERS = 4;
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export type LobbyPlayer = {
  peerId: string;
  name: string;
  buildHash: string;
  joinedAtMs: number;
  ready: boolean;
  playerIndex: number;
  isLocal: boolean;
};

type LobbyDoc = {
  code: string;
  hostPeerId: string;
  hostName: string;
  buildHash: string;
  createdAtMs: number;
  updatedAtMs: number;
  closedAtMs?: number;
};

type MemberDoc = {
  peerId: string;
  name: string;
  buildHash: string;
  joinedAtMs: number;
  updatedAtMs: number;
  ready?: boolean;
};

type SignalDoc = {
  from: string;
  to: string;
  kind: typeof SIGNAL_KIND_OFFER | typeof SIGNAL_KIND_ANSWER | typeof SIGNAL_KIND_ICE;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  createdAtMs: number;
};

type LobbyCallbacks = {
  onPlayersChanged?: (players: LobbyPlayer[]) => void;
  onSignal?: (signal: SignalEnvelope) => void | Promise<void>;
  onError?: (message: string) => void;
  onLobbyClosed?: (message: string) => void;
};

export type SignalEnvelope = SignalDoc & { id: string };

type TransportMessage =
  | { type: "hello"; buildHash: string; peerId: string }
  | { type: "hello_ack"; buildHash: string; peerId: string }
  | { type: "input_frame"; frame: InputFrame }
  | { type: "frame_ack"; tick: number; playerIndex: number }
  | { type: "match_propose"; seed: number; startTick: number; players: MatchPlayerInfo[]; proposerPeerId: string }
  | { type: "match_ack"; proposerPeerId: string; ackerPeerId: string };

type PeerState = {
  peerId: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  helloValidated: boolean;
};

function createFirebaseApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();
  return initializeApp(FIREBASE_CONFIG);
}

function normalizeName(name: string): string {
  const clean = name.trim().replace(/[\x00-\x1F\x7F]/g, "").slice(0, 24).trim();
  return clean || "Player";
}

function normalizeCode(code: string): string {
  const allowed = new Set(CODE_ALPHABET.split(""));
  return code
    .toUpperCase()
    .split("")
    .filter((char) => allowed.has(char))
    .slice(0, 6)
    .join("");
}

function generateLobbyCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

function createPeerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `peer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class LobbyClient {
  private readonly app = createFirebaseApp();
  private readonly db: Firestore = getFirestore(this.app);
  private readonly peerId = createPeerId();
  private readonly buildHash = __BUILD_HASH__;
  private playerName: string;
  private lobbyCode: string | null = null;
  private hostPeerId: string | null = null;
  private hostSelf = false;
  private players: LobbyPlayer[] = [];
  private callbacks = new Set<LobbyCallbacks>();
  private signalUnsub: Unsubscribe | null = null;
  private membersUnsub: Unsubscribe | null = null;
  private lobbyUnsub: Unsubscribe | null = null;

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

  async createLobby(): Promise<string> {
    await this.leaveLobby();
    const code = await this.reserveLobbyCode();
    const now = Date.now();
    const lobbyRef = this.getLobbyRef(code);
    const memberRef = this.getMemberRef(code, this.peerId);
    const lobby: LobbyDoc = {
      code,
      hostPeerId: this.peerId,
      hostName: this.playerName,
      buildHash: this.buildHash,
      createdAtMs: now,
      updatedAtMs: now,
    };
    const member: MemberDoc = {
      peerId: this.peerId,
      name: this.playerName,
      buildHash: this.buildHash,
      joinedAtMs: now,
      updatedAtMs: now,
    };
    await setDoc(lobbyRef, { ...lobby, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await setDoc(memberRef, { ...member, joinedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    this.lobbyCode = code;
    this.hostPeerId = this.peerId;
    this.hostSelf = true;
    this.players = [
      {
        peerId: this.peerId,
        name: this.playerName,
        buildHash: this.buildHash,
        joinedAtMs: now,
        ready: false,
        playerIndex: 0,
        isLocal: true,
      },
    ];
    this.emitPlayersChanged();
    this.watchLobby(code);
    return code;
  }

  async joinLobby(code: string): Promise<LobbyPlayer[]> {
    await this.leaveLobby();
    const cleanCode = normalizeCode(code);
    if (cleanCode.length !== 6) {
      throw new Error("Enter a valid 6-character lobby code.");
    }
    const lobbySnap = await getDoc(this.getLobbyRef(cleanCode));
    if (!lobbySnap.exists()) {
      throw new Error(`Lobby ${cleanCode} not found.`);
    }
    const lobby = lobbySnap.data() as LobbyDoc;
    if (lobby.closedAtMs) {
      throw new Error(`Lobby ${cleanCode} is no longer active.`);
    }
    if (lobby.buildHash !== this.buildHash) {
      throw new Error(`Build mismatch. Host is on ${lobby.buildHash}; this build is ${this.buildHash}.`);
    }
    const membersSnap = await getDoc(this.getMemberRef(cleanCode, lobby.hostPeerId));
    if (!membersSnap.exists()) {
      throw new Error(`Lobby ${cleanCode} is missing its host.`);
    }
    const membersCol = collection(this.getLobbyRef(cleanCode), "members");
    const allMembers = (await getDocs(membersCol)).docs.map((docSnap) => docSnap.data() as MemberDoc);
    if (allMembers.length >= MAX_PLAYERS) {
      throw new Error(`Lobby ${cleanCode} is full.`);
    }
    const now = Date.now();
    await setDoc(this.getMemberRef(cleanCode, this.peerId), {
      peerId: this.peerId,
      name: this.playerName,
      buildHash: this.buildHash,
      joinedAtMs: now,
      updatedAtMs: now,
      ready: false,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    this.lobbyCode = cleanCode;
    this.hostPeerId = lobby.hostPeerId;
    this.hostSelf = false;
    this.players = [...allMembers, {
      peerId: this.peerId,
      name: this.playerName,
      buildHash: this.buildHash,
      joinedAtMs: now,
      updatedAtMs: now,
    }]
      .sort((a, b) => {
        if (a.joinedAtMs !== b.joinedAtMs) return a.joinedAtMs - b.joinedAtMs;
        return a.peerId.localeCompare(b.peerId);
      })
      .map((player, index) => ({
        peerId: player.peerId,
        name: player.name,
        buildHash: player.buildHash,
        joinedAtMs: player.joinedAtMs,
        ready: Boolean(player.ready),
        playerIndex: index,
        isLocal: player.peerId === this.peerId,
      }));
    this.emitPlayersChanged();
    this.watchLobby(cleanCode);
    return this.players.slice();
  }

  async leaveLobby(): Promise<void> {
    const code = this.lobbyCode;
    const wasHost = this.hostSelf;
    this.cleanupWatchers();
    this.players = [];
    this.lobbyCode = null;
    this.hostPeerId = null;
    this.hostSelf = false;
    if (!code) return;

    try {
      await deleteDoc(this.getMemberRef(code, this.peerId));
    } catch {
      // Best-effort cleanup.
    }

    if (wasHost) {
      try {
        await updateDoc(this.getLobbyRef(code), {
          closedAtMs: Date.now(),
          updatedAtMs: Date.now(),
          closedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  async setPlayerName(name: string): Promise<void> {
    this.playerName = normalizeName(name);
    if (!this.lobbyCode) return;
    const updates = {
      name: this.playerName,
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    };
    await updateDoc(this.getMemberRef(this.lobbyCode, this.peerId), updates);
    if (this.hostSelf) {
      await updateDoc(this.getLobbyRef(this.lobbyCode), {
        hostName: this.playerName,
        updatedAtMs: Date.now(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  async setReady(ready: boolean): Promise<void> {
    if (!this.lobbyCode) return;
    await updateDoc(this.getMemberRef(this.lobbyCode, this.peerId), {
      ready,
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    });
  }

  async sendSignal(
    to: string,
    kind: SignalDoc["kind"],
    payload: { sdp?: string; candidate?: RTCIceCandidateInit },
  ): Promise<void> {
    if (!this.lobbyCode) return;
    await addDoc(collection(this.getLobbyRef(this.lobbyCode), "signals"), {
      from: this.peerId,
      to,
      kind,
      createdAtMs: Date.now(),
      createdAt: serverTimestamp(),
      ...payload,
    });
  }

  getLobbyCode(): string | null {
    return this.lobbyCode;
  }

  getLocalPeerId(): string {
    return this.peerId;
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
    return this.players.find((player) => player.peerId === this.peerId)?.playerIndex ?? -1;
  }

  isHost(): boolean {
    return this.hostSelf;
  }

  private async reserveLobbyCode(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = generateLobbyCode();
      const snap = await getDoc(this.getLobbyRef(code));
      if (!snap.exists()) return code;
    }
    throw new Error("Could not allocate a lobby code. Try again.");
  }

  private watchLobby(code: string): void {
    this.cleanupWatchers();

    this.membersUnsub = onSnapshot(collection(this.getLobbyRef(code), "members"), (snapshot) => {
      this.players = snapshot.docs
        .map((docSnap) => this.memberDocToPlayer(docSnap))
        .sort((a, b) => {
          if (a.joinedAtMs !== b.joinedAtMs) return a.joinedAtMs - b.joinedAtMs;
          return a.peerId.localeCompare(b.peerId);
        })
        .map((player, index) => ({
          ...player,
          playerIndex: index,
        }));
      this.emitPlayersChanged();
    });

    this.signalUnsub = onSnapshot(
      query(collection(this.getLobbyRef(code), "signals"), where("to", "==", this.peerId)),
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type !== "added") continue;
          const data = change.doc.data() as SignalDoc;
          const envelope: SignalEnvelope = { id: change.doc.id, ...data };
          this.emitSignal(envelope);
          void deleteDoc(change.doc.ref);
        }
      },
    );

    this.lobbyUnsub = onSnapshot(this.getLobbyRef(code), (snapshot) => {
      if (!snapshot.exists()) {
        this.emitLobbyClosed("Lobby closed.");
        return;
      }
      const lobby = snapshot.data() as LobbyDoc;
      this.hostPeerId = lobby.hostPeerId;
      if (lobby.closedAtMs && !this.hostSelf) {
        this.emitLobbyClosed("Host left the lobby.");
      }
    });
  }

  private cleanupWatchers(): void {
    this.signalUnsub?.();
    this.signalUnsub = null;
    this.membersUnsub?.();
    this.membersUnsub = null;
    this.lobbyUnsub?.();
    this.lobbyUnsub = null;
  }

  private emitPlayersChanged(): void {
    const players = this.players.slice();
    for (const callbacks of this.callbacks) {
      callbacks.onPlayersChanged?.(players);
    }
  }

  private emitSignal(signal: SignalEnvelope): void {
    for (const callbacks of this.callbacks) {
      void callbacks.onSignal?.(signal);
    }
  }

  private emitLobbyClosed(message: string): void {
    for (const callbacks of this.callbacks) {
      callbacks.onLobbyClosed?.(message);
    }
  }

  reportError(message: string): void {
    for (const callbacks of this.callbacks) {
      callbacks.onError?.(message);
    }
  }

  private memberDocToPlayer(docSnap: QueryDocumentSnapshot): LobbyPlayer {
    const data = docSnap.data() as MemberDoc;
    return {
      peerId: data.peerId,
      name: data.name,
      buildHash: data.buildHash,
      joinedAtMs: data.joinedAtMs ?? 0,
      ready: Boolean(data.ready),
      playerIndex: -1,
      isLocal: data.peerId === this.peerId,
    };
  }

  private getLobbyRef(code: string) {
    return doc(this.db, COLLECTION_LOBBIES, code);
  }

  private getMemberRef(code: string, peerId: string) {
    return doc(this.db, COLLECTION_LOBBIES, code, "members", peerId);
  }
}

type MatchMessageHandler = (msg: MatchStartMessage, fromPeerId: string) => void;

export class MeshTransport {
  private readonly peers = new Map<string, PeerState>();
  private readonly frameQueue = new Map<number, Map<number, InputFrame>>();
  private readonly frameAckSentAt = new Map<string, number>();
  private unsubscribe: (() => void) | null = null;
  private active = false;
  private matchHandler: MatchMessageHandler | null = null;

  constructor(private readonly lobby: LobbyClient) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.unsubscribe = this.lobby.subscribe({
      onPlayersChanged: (players) => {
        void this.syncPeers(players);
      },
      onSignal: (signal) => {
        void this.handleSignal(signal);
      },
      onLobbyClosed: () => {
        void this.stop();
      },
      onError: () => {
        // Errors are surfaced by the lobby UI; transport just stays quiet.
      },
    });
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.active = false;
    for (const state of this.peers.values()) {
      state.channel?.close();
      state.pc.close();
    }
    this.peers.clear();
    this.frameQueue.clear();
    this.frameAckSentAt.clear();
    this.matchHandler = null;
  }

  sendInputFrame(tick: number, action: number): void {
    if (!this.active) return;
    const playerIndex = this.lobby.getLocalPlayerIndex();
    if (playerIndex < 0) return;
    const frame: InputFrame = { tick, action, playerIndex };
    for (const [peerId, state] of this.peers) {
      if (!state.channel || state.channel.readyState !== "open" || !state.helloValidated) continue;
      this.frameAckSentAt.set(`${peerId}:${tick}:${playerIndex}`, performance.now());
      this.sendMessage(state.channel, { type: "input_frame", frame });
    }
  }

  drainQueuedFrames(): InputFrame[] {
    const out: InputFrame[] = [];
    const sortedTicks = Array.from(this.frameQueue.keys()).sort((a, b) => a - b);
    for (const tick of sortedTicks) {
      const byPlayer = this.frameQueue.get(tick);
      if (!byPlayer) continue;
      const frames = Array.from(byPlayer.values()).sort((a, b) => a.playerIndex - b.playerIndex);
      out.push(...frames);
    }
    this.frameQueue.clear();
    return out;
  }

  getQueuedFrameCount(): number {
    let total = 0;
    for (const byPlayer of this.frameQueue.values()) total += byPlayer.size;
    return total;
  }

  /** Register a callback for incoming match-start handshake messages. */
  setMatchHandler(handler: MatchMessageHandler | null): void {
    this.matchHandler = handler;
  }

  /** Broadcast a match-start handshake message to every connected peer. */
  broadcastMatchMessage(msg: MatchStartMessage): void {
    if (!this.active) return;
    for (const state of this.peers.values()) {
      if (!state.channel || state.channel.readyState !== "open" || !state.helloValidated) continue;
      this.sendMessage(state.channel, msg);
    }
  }

  /** Send a match-start handshake message to a single peer. */
  sendMatchMessageTo(peerId: string, msg: MatchStartMessage): void {
    if (!this.active) return;
    const state = this.peers.get(peerId);
    if (!state || !state.channel || state.channel.readyState !== "open" || !state.helloValidated) return;
    this.sendMessage(state.channel, msg);
  }

  /** Snapshot of currently-connected, hello-validated peer IDs. */
  getConnectedPeerIds(): string[] {
    const out: string[] = [];
    for (const [peerId, state] of this.peers) {
      if (state.helloValidated && state.channel?.readyState === "open") out.push(peerId);
    }
    return out;
  }

  private async syncPeers(players: LobbyPlayer[]): Promise<void> {
    const localPeerId = this.lobby.getLocalPeerId();
    const remoteIds = new Set(players.filter((player) => !player.isLocal).map((player) => player.peerId));
    for (const peerId of Array.from(this.peers.keys())) {
      if (!remoteIds.has(peerId)) {
        this.closePeer(peerId);
      }
    }
    for (const player of players) {
      if (player.peerId === localPeerId) continue;
      if (this.peers.has(player.peerId)) continue;
      const initiator = localPeerId.localeCompare(player.peerId) < 0;
      const state = this.createPeer(player.peerId);
      this.peers.set(player.peerId, state);
      if (initiator) {
        this.attachChannel(state, state.pc.createDataChannel("input-frames", { ordered: true }));
        const offer = await state.pc.createOffer();
        await state.pc.setLocalDescription(offer);
        await this.lobby.sendSignal(player.peerId, SIGNAL_KIND_OFFER, { sdp: offer.sdp ?? "" });
      }
    }
  }

  private createPeer(peerId: string): PeerState {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const state: PeerState = {
      peerId,
      pc,
      channel: null,
      helloValidated: false,
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void this.lobby.sendSignal(peerId, SIGNAL_KIND_ICE, {
        candidate: event.candidate.toJSON(),
      });
    };

    pc.ondatachannel = (event) => {
      this.attachChannel(state, event.channel);
    };

    pc.onconnectionstatechange = () => {
      const conn = pc.connectionState;
      if (conn === "failed" || conn === "disconnected" || conn === "closed") {
        this.closePeer(peerId);
      }
    };

    return state;
  }

  private attachChannel(state: PeerState, channel: RTCDataChannel): void {
    state.channel = channel;
    channel.onopen = () => {
      console.log(`[sd-mp] data channel open with ${state.peerId}`);
      this.sendMessage(channel, {
        type: "hello",
        buildHash: this.lobby.getBuildHash(),
        peerId: this.lobby.getLocalPeerId(),
      });
    };
    channel.onmessage = (event) => {
      this.handleMessage(state, event.data);
    };
    channel.onclose = () => {
      console.log(`[sd-mp] data channel closed with ${state.peerId}`);
    };
  }

  private async handleSignal(signal: SignalEnvelope): Promise<void> {
    if (signal.from === this.lobby.getLocalPeerId()) return;
    let state = this.peers.get(signal.from);
    if (!state) {
      state = this.createPeer(signal.from);
      this.peers.set(signal.from, state);
    }
    if (signal.kind === SIGNAL_KIND_OFFER && signal.sdp) {
      await state.pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
      const answer = await state.pc.createAnswer();
      await state.pc.setLocalDescription(answer);
      await this.lobby.sendSignal(signal.from, SIGNAL_KIND_ANSWER, { sdp: answer.sdp ?? "" });
      return;
    }
    if (signal.kind === SIGNAL_KIND_ANSWER && signal.sdp) {
      await state.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
      return;
    }
    if (signal.kind === SIGNAL_KIND_ICE && signal.candidate) {
      try {
        await state.pc.addIceCandidate(signal.candidate);
      } catch {
        // ICE candidates can legitimately race remote-description setup.
      }
    }
  }

  private handleMessage(state: PeerState, raw: string): void {
    let message: TransportMessage;
    try {
      message = JSON.parse(raw) as TransportMessage;
    } catch {
      return;
    }

    if (message.type === "hello" || message.type === "hello_ack") {
      if (message.buildHash !== this.lobby.getBuildHash()) {
        this.lobby.reportError(
          `Build mismatch. Peer ${state.peerId} is on ${message.buildHash}; this build is ${this.lobby.getBuildHash()}.`,
        );
        this.closePeer(state.peerId);
        return;
      }
      if (message.type === "hello") {
        state.helloValidated = true;
        this.sendMessage(state.channel, {
          type: "hello_ack",
          buildHash: this.lobby.getBuildHash(),
          peerId: this.lobby.getLocalPeerId(),
        });
      } else {
        state.helloValidated = true;
      }
      return;
    }

    if (message.type === "input_frame") {
      if (!state.helloValidated || !state.channel) return;
      this.queueFrame(message.frame);
      console.log(
        `[sd-mp] frame ${message.frame.tick} from ${state.peerId} p${message.frame.playerIndex} queued (${this.getQueuedFrameCount()} total)`,
      );
      this.sendMessage(state.channel, {
        type: "frame_ack",
        tick: message.frame.tick,
        playerIndex: message.frame.playerIndex,
      });
      return;
    }

    if (message.type === "frame_ack") {
      const key = `${state.peerId}:${message.tick}:${message.playerIndex}`;
      const sentAt = this.frameAckSentAt.get(key);
      if (sentAt !== undefined) {
        const rttMs = performance.now() - sentAt;
        this.frameAckSentAt.delete(key);
        console.log(`[sd-mp] frame ${message.tick} ack from ${state.peerId} in ${rttMs.toFixed(1)} ms`);
      }
      return;
    }

    if (message.type === "match_propose" || message.type === "match_ack") {
      if (!state.helloValidated) return;
      this.matchHandler?.(message, state.peerId);
      return;
    }
  }

  private queueFrame(frame: InputFrame): void {
    let byPlayer = this.frameQueue.get(frame.tick);
    if (!byPlayer) {
      byPlayer = new Map();
      this.frameQueue.set(frame.tick, byPlayer);
    }
    byPlayer.set(frame.playerIndex, frame);
  }

  private closePeer(peerId: string): void {
    const state = this.peers.get(peerId);
    if (!state) return;
    state.channel?.close();
    state.pc.close();
    this.peers.delete(peerId);
  }

  private sendMessage(channel: RTCDataChannel | null, message: TransportMessage): void {
    if (!channel || channel.readyState !== "open") return;
    channel.send(JSON.stringify(message));
  }
}

export { normalizeCode };

// ===========================================================================
// Match start coordinator (Phase 2.6)
// ===========================================================================

export type MatchStartCallbacks = {
  onMatchStart: (config: MultiplayerConfig) => void;
  onError?: (msg: string) => void;
};

/**
 * Coordinates the seed + player-slot agreement before a multiplayer match
 * begins. The peer with the lowest peerId in the lobby acts as proposer:
 * generates a seed + startTick + ordered player slots and broadcasts a
 * `match_propose`. Each non-proposer responds with `match_ack` and emits
 * `onMatchStart` immediately. The proposer emits `onMatchStart` once acks
 * from every other connected peer have arrived.
 *
 * Race-safe: if two peers both send proposals (e.g. clock skew), the
 * proposal from the lowest peerId wins; higher-ID proposals are ignored.
 */
export class MatchStartCoordinator {
  private readonly lobby: LobbyClient;
  private readonly transport: MeshTransport;
  private readonly callbacks: MatchStartCallbacks;
  private active = false;
  private pendingProposal: {
    seed: number;
    startTick: number;
    players: MatchPlayerInfo[];
    awaitingAcks: Set<string>;
  } | null = null;

  constructor(lobby: LobbyClient, transport: MeshTransport, callbacks: MatchStartCallbacks) {
    this.lobby = lobby;
    this.transport = transport;
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.transport.setMatchHandler((msg, fromPeerId) => this.handleIncoming(msg, fromPeerId));
  }

  stop(): void {
    this.active = false;
    this.transport.setMatchHandler(null);
    this.pendingProposal = null;
  }

  /**
   * Initiate a match-start handshake from this peer if and only if we are
   * the lowest-peerId peer in the lobby (deterministic proposer). Returns
   * true if a propose was actually sent.
   */
  requestMatchStart(opts: { startTickOffset?: number } = {}): boolean {
    if (!this.active) return false;
    const players = this.lobby.getPlayers();
    if (players.length < 2) {
      this.callbacks.onError?.("Need at least 2 players in the lobby to start a match.");
      return false;
    }
    const localPeerId = this.lobby.getLocalPeerId();
    const lowestPeerId = players
      .map((p) => p.peerId)
      .reduce((a, b) => (a < b ? a : b));
    if (lowestPeerId !== localPeerId) {
      // Not the proposer — wait for the lowest-ID peer to send propose.
      return false;
    }

    const seed = this.generateSeed();
    const startTickOffset = opts.startTickOffset ?? 6; // ~100ms at 60Hz
    const startTick = startTickOffset; // sim ticks start at 0; offset gives peers buffer to receive propose
    const slots = this.assignPlayerSlots(players);
    const awaitingAcks = new Set<string>();
    for (const slot of slots) {
      if (slot.peerId !== localPeerId) awaitingAcks.add(slot.peerId);
    }

    this.pendingProposal = { seed, startTick, players: slots, awaitingAcks };

    const msg: MatchStartMessage = {
      type: "match_propose",
      seed,
      startTick,
      players: slots,
      proposerPeerId: localPeerId,
    };
    this.transport.broadcastMatchMessage(msg);

    if (awaitingAcks.size === 0) {
      // Solo lobby (shouldn't happen — we guard above) — start immediately.
      this.fireMatchStart(seed, startTick, slots);
    }
    return true;
  }

  private handleIncoming(msg: MatchStartMessage, fromPeerId: string): void {
    if (!this.active) return;
    if (msg.type === "match_propose") {
      // Defensive: only accept proposals from the lowest peerId in the lobby.
      const players = this.lobby.getPlayers();
      const lowestPeerId = players
        .map((p) => p.peerId)
        .reduce((a, b) => (a < b ? a : b), msg.proposerPeerId);
      if (msg.proposerPeerId !== lowestPeerId) {
        // Race: a higher-ID peer also proposed. Ignore — wait for the lowest's.
        return;
      }
      // Ack and start.
      const ack: MatchStartMessage = {
        type: "match_ack",
        proposerPeerId: msg.proposerPeerId,
        ackerPeerId: this.lobby.getLocalPeerId(),
      };
      this.transport.sendMatchMessageTo(fromPeerId, ack);
      this.fireMatchStart(msg.seed, msg.startTick, msg.players);
      return;
    }
    if (msg.type === "match_ack") {
      if (!this.pendingProposal) return;
      if (msg.proposerPeerId !== this.lobby.getLocalPeerId()) return; // not for us
      this.pendingProposal.awaitingAcks.delete(msg.ackerPeerId);
      if (this.pendingProposal.awaitingAcks.size === 0) {
        const { seed, startTick, players } = this.pendingProposal;
        this.pendingProposal = null;
        this.fireMatchStart(seed, startTick, players);
      }
    }
  }

  private fireMatchStart(seed: number, startTick: number, players: MatchPlayerInfo[]): void {
    const localPeerId = this.lobby.getLocalPeerId();
    const local = players.find((p) => p.peerId === localPeerId);
    if (!local) {
      this.callbacks.onError?.("Match started but local peer is not in the player list.");
      return;
    }
    const config: MultiplayerConfig = {
      seed,
      startTick,
      localPlayerIndex: local.playerIndex,
      players,
    };
    this.callbacks.onMatchStart(config);
  }

  private generateSeed(): number {
    // mulberry32 has a degenerate sequence from seed 0; guard against it.
    let s = 0;
    while (s === 0) s = Math.floor(Math.random() * 0xffffffff);
    return s;
  }

  private assignPlayerSlots(players: LobbyPlayer[]): MatchPlayerInfo[] {
    // Use the lobby's existing playerIndex assignment (sorted by joinedAtMs+peerId).
    return players
      .slice()
      .sort((a, b) => a.playerIndex - b.playerIndex)
      .map((p) => ({
        peerId: p.peerId,
        name: p.name,
        playerIndex: p.playerIndex,
        color: pickPlayerColor(p.playerIndex),
      }));
  }
}

const PLAYER_COLOR_PALETTE = [0x4be1ff, 0xff5fa2, 0xffd24b, 0x7bff5f] as const;

export function pickPlayerColor(playerIndex: number): number {
  return PLAYER_COLOR_PALETTE[((playerIndex % PLAYER_COLOR_PALETTE.length) + PLAYER_COLOR_PALETTE.length) % PLAYER_COLOR_PALETTE.length]!;
}

// ────────────────────────────────────────────────────────────────────────────
// Remote player rendering (Sprint 2.5)
// ────────────────────────────────────────────────────────────────────────────

/**
 * A remote player visual: a solid color-tinted icosahedron crystal mirroring
 * the local player's geometry, with a name sprite floating above. Mirrors the
 * `Ghost` shape from `src/ghost.ts` but full-opacity (it's a live peer, not a
 * recording) and collision-eligible once Phase 3 wires sphere-bumps.
 */
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

/**
 * Build a remote-player visual ready to add to a scene. Caller owns the
 * lifecycle: position via `updateRemotePlayer`, dispose via `disposeRemotePlayer`.
 *
 * Color and name come from the match-start handshake's `MatchPlayerInfo`.
 */
export function createRemotePlayer(playerIndex: number, name: string, color: number): RemotePlayer {
  const group = new THREE.Group();

  // Solid icosahedron — same geo as local player crystal. Wireframe overlay
  // gives the same fractured look without a second pass at the shader level.
  const geo = new THREE.IcosahedronGeometry(REMOTE_PLAYER_RADIUS, 0);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: false,
    wireframe: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  group.add(mesh);

  // Wireframe overlay — thin colored edges so the silhouette pops on dark BG.
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

  // Name label as a billboarded sprite.
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

/**
 * Snap a remote player visual to its current sim position. World coords —
 * camera anchoring is the renderer's responsibility (see Sprint 2.3).
 *
 * `dt` drives the idle spin so a stationary remote still feels alive, matching
 * the ghost playback feel.
 */
export function updateRemotePlayer(remote: RemotePlayer, player: PlayerState, dt: number): void {
  remote.group.visible = player.alive;
  if (!player.alive) return;

  remote.group.position.set(player.x, 0, player.z);
  remote.mesh.rotation.y += dt * 1.2;
  remote.mesh.rotation.x = Math.sin(performance.now() * 0.0017) * 0.15;

  // Phase flicker: dim while shattered (matches ghost rendering convention).
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

/** Render a short name label to a CanvasTexture — same recipe as ghost.ts. */
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
