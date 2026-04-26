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

export type InputFrame = {
  tick: number;
  action: number;
  playerIndex: number;
};

export type LobbyPlayer = {
  peerId: string;
  name: string;
  buildHash: string;
  joinedAtMs: number;
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
  | { type: "frame_ack"; tick: number; playerIndex: number };

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

export class MeshTransport {
  private readonly peers = new Map<string, PeerState>();
  private readonly frameQueue = new Map<number, Map<number, InputFrame>>();
  private readonly frameAckSentAt = new Map<string, number>();
  private unsubscribe: (() => void) | null = null;
  private active = false;

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
