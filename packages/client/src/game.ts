import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Input } from "./input";
import { Player } from "./player";
import { World, type Obstacle } from "./world";
import { createComposer, ParticleTrail, ExplosionEffect, CollectFlash, DebrisBurst, BumpEffect } from "./effects";
import { PostFXPass } from "./postfx";
import { initAudio, updateAmbient, playShatter, playRecombine, playCollect, playCloseCall, playDeath, playPowerUp, playBiomeTransition, playShieldBreak, playSpeedBoost, playChallengeComplete, playWorldEvent, playPersonalBest, playLaunch, stopAudio, startMusic, updateMusic, fadeOutMusic, setMasterVolume, getMasterVolume, playWallBreak, playPhaseTierUp, playGrazeWhoosh, playPhaseRejected, playBump } from "./audio";
import { Autopilot } from "./autopilot";
import { GameRecorder } from "./recorder";
import { OnnxAgent } from "./onnx-agent";
import { clamp, ease, ScreenShake, seededRandom } from "./utils";
import { BiomeManager } from "./biomes";
import { PowerUpManager, PowerUpType } from "./powerups";
import { MilestoneTracker } from "./milestones";
import { BossWaveManager } from "./bosswaves";
import { ScorePopups } from "./popups";
import { ShockwaveEffect } from "./shockwave";
import { GrazeParticleStream } from "./grazeparticles";
import { EnvironmentParticles } from "./environment";
import { SkyboxManager } from "./skybox";
import { Tutorial } from "./tutorial";
import { SpeedGateManager } from "./speedgates";
import { ChallengeManager } from "./challenges";
import { WorldEventManager } from "./events";
import { UnlockManager, TRAIL_STYLES, CRYSTAL_SKINS, type TrailStyle, type CrystalSkin } from "./unlocks";
import { AfterimageTrail } from "./afterimage";
import { RibbonTrail } from "./ribbon";
import { RunHistoryTracker } from "./stats";
import {
  pickRandomContracts,
  ContractHUD,
  type ContractCtx,
  type ContractInstance,
} from "./contracts";
import { fetchLeaderboard, submitScore, fetchGhosts, submitGhost, fetchGhostUploadThreshold, type LeaderboardEntry } from "./leaderboard";
import { GhostRecorder, GhostManager, type GhostRecord } from "./ghost";
import { getLocalUsername, setLocalUsername, migrateLegacyUsername } from "./coolname";
import { MenuNavigation } from "./menu-navigation";
import {
  LobbyClient,
  MeshTransport,
  MatchStartCoordinator,
  MpRunner,
  createRemotePlayer,
  disposeRemotePlayer,
  normalizeCode,
  LOBBY_CODE_RE,
  updateRemotePlayer,
  type LobbyPlayer,
  type RemotePlayer,
} from "./multiplayer";
import { MULTIPLAYER_ENABLED, MULTIPLAYER_HASH_DEBUG, MULTIPLAYER_AUTO_QUICKMATCH } from "./config";
import { ShatterDriftSimulation } from "@sd/sim";
import type { AuthoritativeStateSnapshot, MultiplayerConfig } from "@sd/sim";
import {
  createRiftFlipState,
  updateRiftFlip,
  RIFT_FLIP_ACTIVE_DURATION,
  type RiftFlipState,
} from "@sd/sim";
import {
  BOOST_COOLDOWN,
  BOOST_DURATION,
  BOOST_MULTIPLIER,
  BRAKE_COOLDOWN,
  BRAKE_DURATION,
  BRAKE_MULTIPLIER,
  CLOSE_CALL_SCORE,
  COMBO_MAX,
  INITIAL_SPEED,
  MAX_SPEED,
  ORB_SCORE,
  PHASE_ACTIVATION_COST,
  PHASE_DRAIN_RATE,
  PHASE_MIN_DURATION,
  PHASE_MIN_THRESHOLD,
  PHASE_POST_COOLDOWN,
  PHASE_RECHARGE_RATE,
  SPEED_MOD_LERP_TIME,
  computeSpeed,
} from "@sd/sim";

/** Speed lines overlay — CSS radial gradient that fades in at high speed */
class SpeedLines {
  private el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 10;
      background: radial-gradient(ellipse at center, transparent 30%, rgba(0,255,204,0.0) 70%);
      opacity: 0; transition: opacity 0.3s;
    `;
    document.body.appendChild(this.el);
  }

  update(speedNorm: number, color: number = 0x00ffcc) {
    // Start showing at 60% speed, full at 100%
    const t = clamp((speedNorm - 0.6) / 0.4, 0, 1);
    const alpha = t * 0.12;
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    this.el.style.background = `radial-gradient(ellipse at center, transparent 20%, rgba(${r},${g},${b},${alpha}) 100%)`;
    this.el.style.opacity = t > 0.01 ? "1" : "0";
  }
}

/** Vignette overlay for dramatic moments */
class Vignette {
  private el: HTMLElement;
  private intensity = 0;
  private bright = false;
  private color = 0x000000;
  private edgeAlpha = 0.8;

  constructor() {
    this.el = document.createElement("div");
    this.el.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 9;
      opacity: 0; transition: opacity 0.5s;
    `;
    document.body.appendChild(this.el);
    this.updateBackground();
  }

  setIntensity(v: number) {
    this.intensity = clamp(v, 0, 1);
    this.el.style.opacity = String(this.intensity);
  }

  setStyle(color: number, bright: boolean, edgeAlpha: number = 0.8) {
    this.color = color;
    this.bright = bright;
    this.edgeAlpha = edgeAlpha;
    this.updateBackground();
  }

  private updateBackground() {
    const r = (this.color >> 16) & 0xff;
    const g = (this.color >> 8) & 0xff;
    const b = this.color & 0xff;
    const innerStop = this.bright ? 64 : 50;
    const outerStop = this.bright ? 96 : 100;
    this.el.style.background = `radial-gradient(ellipse at center, transparent ${innerStop}%, rgba(${r},${g},${b},${this.edgeAlpha}) ${outerStop}%)`;
    this.el.style.mixBlendMode = this.bright ? "screen" : "normal";
  }
}

/** Combo border glow overlay — screen-edge feedback for growing combos */
class ComboBorderGlow {
  private el: HTMLElement;
  private previousCombo = 0;
  private breakFlashTimer = 0;
  private pulseTime = 0;

  constructor() {
    this.el = document.createElement("div");
    this.el.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 11;
      opacity: 0; transition: opacity 0.12s linear;
      will-change: opacity, box-shadow, filter;
    `;
    document.body.appendChild(this.el);
  }

  update(dt: number, combo: number) {
    this.pulseTime += dt;

    if (this.previousCombo >= 3 && combo === 0) {
      this.breakFlashTimer = 0.3;
    }

    if (this.breakFlashTimer > 0) {
      this.breakFlashTimer = Math.max(0, this.breakFlashTimer - dt);
      const fade = this.breakFlashTimer / 0.3;
      const alpha = 0.7 * fade;
      const spread = 18 + fade * 30;
      this.el.style.opacity = String(fade);
      this.el.style.filter = "none";
      this.el.style.boxShadow = `inset 0 0 ${spread}px rgba(255,120,64,${alpha}), inset 0 0 ${spread * 3}px rgba(255,40,0,${alpha * 0.7})`;
      this.previousCombo = combo;
      return;
    }

    if (combo < 3) {
      this.el.style.opacity = "0";
      this.el.style.boxShadow = "none";
      this.el.style.filter = "none";
      this.previousCombo = combo;
      return;
    }

    const pulse = 0.5 + 0.5 * Math.sin(this.pulseTime * (combo >= 10 ? 10 : combo >= 8 ? 7 : combo >= 5 ? 4.5 : 0));
    let opacity = 1;
    let shadow = "";
    let filter = "none";

    if (combo >= 10) {
      const hueA = (this.pulseTime * 180) % 360;
      const hueB = (hueA + 70) % 360;
      const innerColor = `hsla(${hueA}, 100%, 60%, ${0.38 + pulse * 0.16})`;
      const outerColor = `hsla(${hueB}, 100%, 55%, ${0.26 + pulse * 0.16})`;
      shadow = `inset 0 0 20px ${innerColor}, inset 0 0 56px ${outerColor}, inset 0 0 96px rgba(255,255,255,${0.08 + pulse * 0.08})`;
      filter = `saturate(${1.2 + pulse * 0.35})`;
    } else if (combo >= 8) {
      shadow = `inset 0 0 18px rgba(255,120,40,${0.34 + pulse * 0.16}), inset 0 0 54px rgba(255,50,0,${0.24 + pulse * 0.18})`;
    } else if (combo >= 5) {
      shadow = `inset 0 0 14px rgba(255,180,60,${0.18 + pulse * 0.1}), inset 0 0 36px rgba(255,110,0,${0.14 + pulse * 0.1})`;
    } else {
      opacity = 0.75;
      shadow = `inset 0 0 12px rgba(255,196,80,${0.12 + pulse * 0.05}), inset 0 0 24px rgba(255,156,40,${0.08 + pulse * 0.04})`;
    }

    this.el.style.opacity = String(opacity);
    this.el.style.boxShadow = shadow;
    this.el.style.filter = filter;
    this.previousCombo = combo;
  }

  /** Hard-clear all paint state. Call on return-to-title / startGame so the
   *  break-flash box-shadow doesn't bleed into the title screen when the
   *  player dies mid-combo (combo break sets a 0.3s orange-red glow that
   *  stays painted forever if no further update() ticks fire). */
  reset() {
    this.previousCombo = 0;
    this.breakFlashTimer = 0;
    this.pulseTime = 0;
    this.el.style.opacity = "0";
    this.el.style.boxShadow = "none";
    this.el.style.filter = "none";
  }
}

/** Flash overlay for power-up collection */
class ScreenFlash {
  private el: HTMLElement;
  private timer = 0;

  constructor() {
    this.el = document.createElement("div");
    this.el.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 25;
      opacity: 0; transition: opacity 0.1s;
    `;
    document.body.appendChild(this.el);
  }

  trigger(color: number, duration: number = 0.15) {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    this.el.style.background = `rgba(${r},${g},${b},0.3)`;
    this.el.style.opacity = "1";
    this.timer = duration;
  }

  update(dt: number) {
    if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.el.style.opacity = "0";
      }
    }
  }
}

enum GameState {
  Title,
  Launching,
  Playing,
  Paused,
  GameOver,
}

type MatchState = "idle" | "inLobby" | "inMatch" | "matchOver";

// --- Graze meter tuning ---
const GRAZE_PHASE_COST = 30;       // units consumed per phase activation
const GRAZE_FILL_RATE = 20;        // units per second while grazing
const GRAZE_BAND = 2.7;            // world-unit proximity to obstacle edge (~0.3 × lane width)
const GRAZE_Z_RANGE = 5;           // how far ahead/behind to check for graze obstacles

// --- Game tuning ---
const BIOME_MILESTONES = [
  { name: "THE VOID", startDistance: 0 },
  { name: "CRYSTAL CAVES", startDistance: 300 },
  { name: "NEON DISTRICT", startDistance: 700 },
  { name: "SOLAR STORM", startDistance: 1200 },
  { name: "COSMIC RIFT", startDistance: 1800 },
] as const;
const GRADE_THRESHOLDS = [
  { label: "S RANK", minScore: 90, color: "#ffcc00" },
  { label: "A RANK", minScore: 75, color: "#00ffcc" },
  { label: "B RANK", minScore: 55, color: "#44aaff" },
  { label: "C RANK", minScore: 35, color: "#aa88ff" },
  { label: "D RANK", minScore: 15, color: "#ff88aa" },
  { label: "E RANK", minScore: 0, color: "#666688" },
] as const;

export class Game {
  // Three.js
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private clock = new THREE.Clock();
  /** The 16:9 letterbox frame element. Renderer + camera read its dims. */
  private gameContainer!: HTMLElement;

  // Game objects
  private player!: Player;
  private world!: World;
  private input = new Input();

  // Effects
  private trail!: ParticleTrail;
  private explosion!: ExplosionEffect;
  private collectFlash!: CollectFlash;
  private debris!: DebrisBurst;
  private bumpEffect!: BumpEffect;
  private shake = new ScreenShake();
  private speedLines!: SpeedLines;
  private vignette!: Vignette;
  private comboBorderGlow!: ComboBorderGlow;
  private screenFlash!: ScreenFlash;
  private postfx!: PostFXPass;
  private afterimage!: AfterimageTrail;
  private ribbon!: RibbonTrail;
  private runHistory!: RunHistoryTracker;

  // New systems
  private biomes!: BiomeManager;
  private powerups!: PowerUpManager;
  private milestones!: MilestoneTracker;
  private bossWaves!: BossWaveManager;
  private popups!: ScorePopups;
  private shockwave!: ShockwaveEffect;
  private grazeStream!: GrazeParticleStream;
  private scoreStream!: GrazeParticleStream; // gem→score particles
  private envParticles!: EnvironmentParticles;
  private skybox!: SkyboxManager;
  private tutorial!: Tutorial;
  private speedGates!: SpeedGateManager;
  private challenges!: ChallengeManager;
  private worldEvents!: WorldEventManager;
  private unlocks!: UnlockManager;

  // Lights (for biome transitions)
  private ambientLight!: THREE.AmbientLight;
  private directionalLight!: THREE.DirectionalLight;
  private rimLight!: THREE.PointLight;
  private tunnelLight!: THREE.PointLight;

  // State
  private state = GameState.Title;
  private score = 0;
  private highScore = 0;
  private distance = 0;
  private speed = INITIAL_SPEED;
  private combo = 0;
  private maxCombo = 0;
  private playerZ = 0;
  private playTime = 0;
  private lastCloseCall = -10;
  private wasShattered = false;
  private closeCallCount = 0;
  private phaseStreak = 0; // consecutive close calls without recombining
  private phaseEnergy = 1;
  private phaseLocked = false;
  private phaseCooldown = 0;
  private phaseMinTimer = 0;
  private phaseMeter = 50;          // 0..100 — earned by grazing obstacles; seeded at 50 so first run isn't a brick wall
  private grazeThrottleTimer = 0;   // prevents audio/particle spam during sustained graze
  private rejectionThrottleTimer = 0; // throttles rejection SFX
  private meterFlashTimer = 0;      // 0..0.15 — graze flash animation (scale+alpha burst)
  private meterRejectionTimer = 0;  // 0..0.3 — red rejection flash
  private nearMissHintObstacleTimer = 0; // seconds since last obstacle-in-range; drives NEAR MISS TO CHARGE hint
  private nearMissHintEl: HTMLElement | null = null;
  private deathSlowMo = false;
  private deathSlowMoTimer = 0;

  // Boost / brake speed-mod (mirrors sim-layer state in the renderer)
  private boostTimer = 0;
  private boostCooldown = 0;
  private brakeTimer = 0;
  private brakeCooldown = 0;
  private speedMod = 1;
  private hudBoostFillEl: SVGElement | null = null;
  private hudBrakeFillEl: SVGElement | null = null;
  private prevBoostCooldown = 0;
  private prevBrakeCooldown = 0;

  // Cosmic Rift gravity flip
  private riftFlip: RiftFlipState = createRiftFlipState();
  // Smoothed camera-up lerp (0 = upright, 1 = fully inverted)
  private riftFlipLerp = 0;
  // HUD warning element — shows "RIFT" glyph during the 1.5s warning window
  private riftWarningEl: HTMLElement | null = null;
  private riftWarningTimer = 0;

  // Camera juice
  private baseFOV = 75;
  private targetFOV = 75;
  private currentFOV = 75;
  private cameraRoll = 0;
  private targetCameraRoll = 0;
  private slowMoFactor = 1; // visual slow-mo for close calls
  private slowMoTimer = 0;
  private fovBoost = 0;
  private cameraZKick = 0; // brief push-toward-player on tier-up, decays ~150ms
  private skillFactor = 1;
  private personalBestTarget = 0;
  private personalBestStage = 0;
  private personalBestTriggered = false;
  private phaseTimeAccum = 0;
  private phaseBonusFlashTimer = 0;
  private phaseBonusFlashValue = 1;

  // Launch sequence
  private launchTimer = 0;
  private readonly launchDuration = 1.5;
  private launchStartCamPos = new THREE.Vector3();
  private launchStartLookAt = new THREE.Vector3();
  private launchDistortTriggered = false;

  // HUD elements
  private hudScore!: HTMLElement;
  private hudDistance!: HTMLElement;
  private hudSpeed!: HTMLElement;
  private hudCombo!: HTMLElement;
  private hudState!: HTMLElement;
  private hud!: HTMLElement;
  private hudPhaseMeter!: HTMLElement;
  private hudPhaseFill!: HTMLElement;
  private hudPhaseWarnVignette!: HTMLElement;
  private titleOverlay!: HTMLElement;
  private titleLeaderboardEl: HTMLElement | null = null;
  private titleLeaderboardToggleEl: HTMLButtonElement | null = null;
  private titleLeaderboardExpanded = false;
  private centerMessage!: HTMLElement;
  private centerTitle!: HTMLElement;
  private centerStats!: HTMLElement;
  private centerRetry!: HTMLElement;
  private titleHighScore!: HTMLElement;
  private hudPowerUp!: HTMLElement;
  private hudBossWarning!: HTMLElement;
  private customizePanel!: HTMLElement;
  private customizeOpen = false;
  private multiplayerModal!: HTMLElement;
  private multiplayerOpen = false;
  private multiplayerStatusEl!: HTMLElement;
  private multiplayerCodeEl!: HTMLElement;
  private multiplayerPlayerListEl!: HTMLElement;
  private multiplayerEmptyEl!: HTMLElement;
  private multiplayerCodeInput!: HTMLInputElement;
  private multiplayerReadyBtn!: HTMLButtonElement;
  private multiplayerLeaveBtn!: HTMLButtonElement;
  private multiplayerCopyLinkBtn!: HTMLButtonElement;
  private multiplayerCopyLinkFallbackEl!: HTMLInputElement;
  private multiplayerQuickplayBtn!: HTMLButtonElement;
  private multiplayerBusy = false;
  private lobbyClient: LobbyClient | null = null;
  private meshTransport: MeshTransport | null = null;
  private matchCoordinator: MatchStartCoordinator | null = null;
  private matchState: MatchState = "idle";
  private mpRunner: MpRunner | null = null;
  private multiplayerSim: ShatterDriftSimulation | null = null;
  private multiplayerConfig: MultiplayerConfig | null = null;
  private multiplayerAuthoritativeState: AuthoritativeStateSnapshot | null = null;
  /** Snapshot subscription disposer — set when transitionToMatch wires to lobby snapshots. */
  private mpSnapshotUnsubscribe: (() => void) | null = null;
  /** Bump events queued in onTickAdvanced; drained in applyMultiplayerAuthoritativeState. */
  private pendingBumpEvents: Array<{ playerA: number; playerB: number; contactX: number; contactZ: number }> = [];
  private multiplayerLastAdvancedTick = -1;
  private multiplayerMatchRequested = false;
  /** BUG 2: defer transitionToMatchOver after onLocalDeath so the local crash visual + SFX play first. */
  private mpDeathPending = false;
  private mpDeathTimer = 0;
  private mpDeathReason = "";
  /** BUG 3: ensure score submission only runs once per match-over even if transition reasons stack. */
  private mpScoreSubmitted = false;
  private remotePlayers = new Map<number, RemotePlayer>();
  private pauseMenu!: HTMLElement;
  private gameOverOverlay!: HTMLElement;

  // Persistent stats
  private totalRuns = 0;
  private bestGrade = "";
  private bestDistance = 0;

  // Autopilot & recording
  private autopilot: Autopilot | null = null;
  private onnxAgent: OnnxAgent | null = null;
  private recorder: GameRecorder | null = null;
  private demoMode = false;
  private onnxMode = false;

  // Ghost racing — async multiplayer playback
  private ghostRecorder = new GhostRecorder();
  private ghostManager!: GhostManager;
  private ghostUploadThreshold = 0;
  private ghostToggle = true;
  /** Seed used for the current/most-recent run. Captured at startGame(). */
  private runSeed = 0;
  /** Ghost records from the last successful fetchGhosts() — source of truth for race selection. */
  private cachedGhosts: GhostRecord[] = [];
  /** One-shot transitional state set when the user clicks RACE — copied into
   *  currentRaceGhostId/Seed at the next startGame() and then cleared. Kept
   *  separate from the persistent fields so the legacy entry points (which
   *  set "pending" right before calling startGame) keep working unchanged. */
  private pendingRaceSeed: number | null = null;
  private pendingRaceGhostId: string | null = null;
  /** Persistent ghost-race selection: survives RETRY, cleared by BACK TO TITLE
   *  or by starting a fresh non-race run from the title (PLAY / DAILY). */
  private currentRaceGhostId: string | null = null;
  private currentRaceSeed: number | null = null;
  /** Name of the ghost being raced this run — shown in the race chip HUD element. */
  private racingGhostName: string | null = null;
  /** HUD chip that shows "RACING: NAME" when chasing a specific ghost. */
  private raceChipEl: HTMLElement | null = null;

  // Run contracts — three randomized goals per run, award score bonuses on completion
  private contracts: ContractInstance[] = [];
  private contractHUD!: ContractHUD;
  private powerupsCollected = 0;
  private bestPhaseStreak = 0;

  // Daily Challenge mode
  private isDailyMode = false;
  private dailyDateKey = ""; // YYYYMMDD
  private lastGameOverTab = "stats";
  private dailyChallengeQueued = false;
  private dailyBanner: HTMLElement | null = null;
  private dailyTimerInterval: ReturnType<typeof setInterval> | null = null;

  // Camera offset
  private cameraOffset = new THREE.Vector3(0, 3, -6);

  // Menu navigation (keyboard arrows / WASD / d-pad / left stick + Enter
  // / Space / gamepad-A activation). Wired up per state in init/transitions.
  private menuNav = new MenuNavigation();
  // Suppresses menu activation reads for N frames after a state change so a
  // single Enter/Space/A press can't fire across two states (e.g. mash
  // Enter on game-over → instant retry → instant pause).
  private menuNavSuppressFrames = 0;

  async start() {
    this.init();
    this.renderer.setAnimationLoop(() => this.loop());
  }

  private init() {
    // One-shot migration of any legacy per-game username into the shared
    // `cc-username` key. No-op if the user already has a coolname.
    migrateLegacyUsername();

    // Load persistent stats
    this.highScore = parseInt(localStorage.getItem("shatterDriftHighScore") || "0", 10);
    this.totalRuns = parseInt(localStorage.getItem("shatterDriftTotalRuns") || "0", 10);
    this.bestGrade = localStorage.getItem("shatterDriftBestGrade") || "";
    this.bestDistance = parseInt(localStorage.getItem("shatterDriftBestDistance") || "0", 10);

    // Init Three.js
    // The page now letterboxes to 16:9 — `body` is the centered 16:9 frame
    // (see index.html). `#game-container` fills the frame, so its
    // `clientWidth/clientHeight` give us the canvas pixel dims to render at,
    // independent of the actual viewport size.
    const container = document.getElementById("game-container")!;
    this.gameContainer = container;
    const initW = container.clientWidth || 1;
    const initH = container.clientHeight || 1;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(initW, initH);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.insertBefore(this.renderer.domElement, container.firstChild);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020208);
    this.scene.fog = new THREE.FogExp2(0x020208, 0.015);

    this.camera = new THREE.PerspectiveCamera(
      this.baseFOV,
      initW / initH,
      0.1,
      300
    );

    // Lighting — bright enough to see walls clearly, emissives and bloom add the punch
    this.ambientLight = new THREE.AmbientLight(0x334466, 0.6);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0x5577bb, 0.7);
    this.directionalLight.position.set(5, 10, 10);
    this.scene.add(this.directionalLight);

    // Rim light for player (from behind)
    this.rimLight = new THREE.PointLight(0x00ffcc, 1, 20);
    this.rimLight.position.set(0, 2, -3);
    this.scene.add(this.rimLight);

    // Forward tunnel light — illuminates walls and obstacles ahead
    this.tunnelLight = new THREE.PointLight(0x4444aa, 0.8, 35);
    this.tunnelLight.position.set(0, 3, 15);
    this.scene.add(this.tunnelLight);

    // Post-processing (bloom + custom PostFX)
    const { composer, bloom } = createComposer(this.renderer, this.scene, this.camera);
    this.composer = composer;
    this.bloomPass = bloom;

    // Custom post-processing: chromatic aberration, film grain, scan lines, distortion
    this.postfx = new PostFXPass();
    this.postfx.setResolution(initW, initH);
    this.composer.addPass(this.postfx.pass);

    // Input
    this.input.init(this.renderer.domElement);

    // Rift-flip HUD warning glyph (shown during the 1.5s warning window)
    this.riftWarningEl = document.createElement("div");
    this.riftWarningEl.textContent = "⟳ RIFT";
    this.riftWarningEl.style.cssText = [
      "position:fixed",
      "top:18%",
      "left:50%",
      "transform:translateX(-50%)",
      "font-family:'Orbitron',system-ui,sans-serif",
      "font-size:clamp(28px,4vw,56px)",
      "font-weight:900",
      "letter-spacing:0.3em",
      "color:#ff44ff",
      "text-shadow:0 0 20px #ff44ff,0 0 40px #ff44ff,0 0 80px #ff00ff",
      "opacity:0",
      "transition:opacity 0.15s ease-out",
      "pointer-events:none",
      "z-index:50",
    ].join(";");
    document.body.appendChild(this.riftWarningEl);

    // Player. Created up-front so gameplay can re-use the same Three.js
    // resources, but hidden until the run actually starts (universal
    // polish rule 5: no gameplay actors visible on the title screen).
    // updateTitle() flips visibility back on while the customize panel is
    // open so the cosmetic preview still works.
    this.player = new Player();
    this.player.group.visible = false;
    this.scene.add(this.player.group);

    // Biome manager
    this.biomes = new BiomeManager();

    // World
    this.world = new World(this.scene, this.biomes);

    // Power-ups
    this.powerups = new PowerUpManager(this.scene);

    // Boss waves
    this.bossWaves = new BossWaveManager(this.scene, this.biomes);

    // Milestones
    this.milestones = new MilestoneTracker();

    // Effects
    this.trail = new ParticleTrail(this.scene, 0x00ffcc);
    this.explosion = new ExplosionEffect(this.scene);
    this.collectFlash = new CollectFlash(this.scene);
    this.debris = new DebrisBurst(this.scene);
    this.bumpEffect = new BumpEffect(this.scene);
    this.speedLines = new SpeedLines();
    this.vignette = new Vignette();
    this.comboBorderGlow = new ComboBorderGlow();
    this.screenFlash = new ScreenFlash();
    this.popups = new ScorePopups();
    this.shockwave = new ShockwaveEffect(this.scene);
    this.envParticles = new EnvironmentParticles(this.scene, this.biomes);
    this.skybox = new SkyboxManager(this.scene);
    this.tutorial = new Tutorial();
    this.speedGates = new SpeedGateManager(this.scene, this.biomes);
    this.challenges = new ChallengeManager();
    this.worldEvents = new WorldEventManager(this.scene, this.biomes);
    this.unlocks = new UnlockManager();
    this.afterimage = new AfterimageTrail(this.scene);
    this.ribbon = new RibbonTrail(this.scene);
    this.runHistory = new RunHistoryTracker();
    this.contractHUD = new ContractHUD();

    // Ghost racing — load persisted toggle and kick off async fetch
    const storedGhostToggle = localStorage.getItem("shatterDriftGhostToggle");
    this.ghostToggle = storedGhostToggle === null ? true : storedGhostToggle === "1";
    this.ghostManager = new GhostManager(this.scene);
    this.ghostManager.setEnabled(this.ghostToggle);
    this.loadGhostsAsync();

    // Cache HUD elements
    this.hudScore = document.getElementById("hud-score")!;
    this.hudDistance = document.getElementById("hud-distance")!;
    this.hudSpeed = document.getElementById("hud-speed")!;
    this.hudCombo = document.getElementById("hud-combo")!;
    this.hudState = document.getElementById("hud-state-indicator")!;
    this.hud = document.getElementById("hud")!;
    this.hudPhaseMeter = document.getElementById("hud-phase-meter")!;
    this.hudPhaseFill = document.getElementById("hud-phase-fill")!;
    this.hudPhaseWarnVignette = document.getElementById("hud-phase-warn-vignette")!;
    // Particle stream from player → phase bar on near-miss; intensity scales count.
    // Graze stream — explicit cyan config with chunkier glow so the trail
    // reads clearly against the dark bottom-center phase bar. Default was
    // too subtle once the bar moved from left-edge (vertical) to bottom
    // (small + horizontal, easy to miss).
    this.grazeStream = new GrazeParticleStream(document.body, {
      color: "#aef9ff",
      glowColor: "#00ccff",
      glowSize: "14px",
      zIndex: "25",
    });
    this.grazeStream.setBarTarget(this.hudPhaseMeter, this.hudPhaseFill);
    // Particle stream from gems → score HUD; yellow/orange to match gem color.
    this.scoreStream = new GrazeParticleStream(document.body, {
      color: "#ffcc00",
      glowColor: "#ffaa00",
      glowSize: "8px",
      zIndex: "26", // above graze particles
    });
    this.scoreStream.setTarget(this.hudScore, this.hudScore);
    this.hudBoostFillEl = document.getElementById("hud-boost-fill") as SVGElement | null;
    this.hudBrakeFillEl = document.getElementById("hud-brake-fill") as SVGElement | null;

    // "NEAR MISS TO CHARGE" pulsing hint — appears near the meter when meter is low and an obstacle is approaching
    this.nearMissHintEl = document.createElement("div");
    this.nearMissHintEl.id = "near-miss-hint";
    this.nearMissHintEl.textContent = "NEAR MISS TO CHARGE";
    this.nearMissHintEl.style.cssText = [
      "position: fixed",
      "left: 26px",
      "bottom: calc(22% + 24px)",
      "font-family: 'Orbitron', monospace",
      "font-size: 7px",
      "letter-spacing: 1.5px",
      "color: #00ccff",
      "white-space: nowrap",
      "pointer-events: none",
      "opacity: 0",
      "z-index: 20",
    ].join(";");
    document.body.appendChild(this.nearMissHintEl);

    this.titleOverlay = document.getElementById("title-overlay")!;
    this.titleLeaderboardEl = document.getElementById("title-leaderboard");
    this.titleLeaderboardToggleEl = document.getElementById("title-leaderboard-toggle") as HTMLButtonElement | null;
    this.centerMessage = document.getElementById("center-message")!;
    this.centerTitle = document.getElementById("center-title")!;
    this.centerStats = document.getElementById("center-stats")!;
    this.centerRetry = document.getElementById("center-retry")!;
    this.titleHighScore = document.getElementById("title-high-score")!;
    this.hudPowerUp = document.getElementById("hud-powerup")!;
    this.hudBossWarning = document.getElementById("hud-boss-warning")!;
    this.customizePanel = document.getElementById("customize-panel")!;
    this.multiplayerModal = document.getElementById("multiplayer-modal")!;
    this.multiplayerStatusEl = document.getElementById("multiplayer-status")!;
    this.multiplayerCodeEl = document.getElementById("multiplayer-current-code")!;
    this.multiplayerPlayerListEl = document.getElementById("multiplayer-player-list")!;
    this.multiplayerEmptyEl = document.getElementById("multiplayer-empty")!;
    this.multiplayerCodeInput = document.getElementById("multiplayer-code-input") as HTMLInputElement;
    this.multiplayerReadyBtn = document.getElementById("multiplayer-ready-btn") as HTMLButtonElement;
    this.multiplayerLeaveBtn = document.getElementById("multiplayer-leave-btn") as HTMLButtonElement;
    this.multiplayerCopyLinkBtn = document.getElementById("multiplayer-copy-link-btn") as HTMLButtonElement;
    this.multiplayerCopyLinkFallbackEl = document.getElementById("multiplayer-copy-link-fallback") as HTMLInputElement;
    this.multiplayerQuickplayBtn = document.getElementById("multiplayer-quickplay-btn") as HTMLButtonElement;
    this.pauseMenu = document.getElementById("pause-menu")!;
    this.gameOverOverlay = document.getElementById("gameover-overlay")!;

    // Cache daily banner
    this.dailyBanner = document.getElementById("daily-banner");

    // Race chip — shows "RACING: GHOST-NAME" during a targeted ghost race.
    // Created dynamically and appended to the HUD div so it hides/shows with it.
    {
      const chip = document.createElement("div");
      chip.id = "hud-race-chip";
      chip.style.cssText = [
        "position:absolute",
        "top:18px",
        "left:50%",
        "transform:translateX(-50%)",
        "font-family:'Orbitron',monospace",
        "font-size:10px",
        "font-weight:700",
        "letter-spacing:2px",
        "color:#00ffcc",
        "background:rgba(0,255,204,0.08)",
        "border:1px solid rgba(0,255,204,0.3)",
        "border-radius:3px",
        "padding:3px 10px",
        "pointer-events:none",
        "z-index:15",
        "white-space:nowrap",
        "display:none",
      ].join(";");
      this.hud.appendChild(chip);
      this.raceChipEl = chip;
    }

    // Pause menu
    this.initPauseMenu();

    // Customize UI
    this.initCustomizePanel();

    // Multiplayer lobby UI
    this.initMultiplayerUI();
    if (!MULTIPLAYER_ENABLED) {
      const multiplayerBtn = document.getElementById("multiplayer-btn");
      if (multiplayerBtn) multiplayerBtn.style.display = "none";
    }

    // Daily Challenge button
    this.initDailyButton();

    // Show stats on title
    const summary = this.runHistory.getSummary();
    if (summary.totalRuns > 0 || this.highScore > 0) {
      const hs = Math.max(this.highScore, summary.bestScore);
      let statsText = `HIGH SCORE: ${hs.toLocaleString()}`;
      if (this.bestGrade) statsText += ` | BEST: ${this.bestGrade}`;
      const bd = Math.max(this.bestDistance, summary.bestDistance);
      if (bd > 0) statsText += ` | ${bd.toLocaleString()}m`;
      const runs = Math.max(this.totalRuns, summary.totalRuns);
      if (runs > 0) statsText += ` | RUNS: ${runs}`;
      if (summary.avgScore > 0) statsText += ` | AVG: ${summary.avgScore.toLocaleString()}`;
      const cStats = this.challenges.getStats();
      if (cStats.completed > 0) statsText += ` | ★ ${cStats.completed}/${cStats.total}`;
      const trendIcon = summary.recentTrend === "up" ? " ↑" : summary.recentTrend === "down" ? " ↓" : "";
      if (trendIcon) statsText += trendIcon;
      this.titleHighScore.textContent = statsText;
    }

    // Resize. `window.resize` fires when the viewport changes (which
    // recomputes body's `min(...)` 16:9 formula). We also subscribe to a
    // ResizeObserver on the container itself as a belt-and-braces signal.
    window.addEventListener("resize", () => this.onResize());
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => this.onResize());
      ro.observe(this.gameContainer);
    }

    // Wire the explicit PLAY button on the title screen (added for
    // universal polish rule 4 — a clear index-0 menu target). Same
    // behavior as the legacy "press space anywhere" path; just routes
    // through `startGame(false)` like the daily button does.
    const playBtn = document.getElementById("play-btn");
    if (playBtn) {
      playBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        // PLAY = fresh normal run; abandon any persistent ghost-race lock.
        this.currentRaceGhostId = null;
        this.currentRaceSeed = null;
        this.startGame(false);
      });
      playBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    }

    this.initTitleLeaderboardToggle();

    // Default menu scope = title. Refreshed on every state transition.
    this.applyTitleMenuScope();
  }

  // -----------------------------------------------------------------
  // Menu scope helpers — keep keyboard / gamepad nav focused on the
  // currently-visible overlay. Called whenever a state transitions or
  // a panel opens / closes.
  // -----------------------------------------------------------------

  private applyTitleMenuScope() {
    const items: HTMLElement[] = [];
    const playBtn = document.getElementById("play-btn");
    const dailyBtn = document.getElementById("daily-btn");
    const leaderboardToggle = document.getElementById("title-leaderboard-toggle");
    const multiplayerBtn = document.getElementById("multiplayer-btn");
    const customizeBtn = document.getElementById("customize-btn");
    if (playBtn) items.push(playBtn);
    if (dailyBtn) items.push(dailyBtn);
    if (leaderboardToggle && getComputedStyle(leaderboardToggle).display !== "none") items.push(leaderboardToggle);
    if (MULTIPLAYER_ENABLED && multiplayerBtn) items.push(multiplayerBtn);
    if (customizeBtn) items.push(customizeBtn);
    // Esc / B is a no-op on the title screen — there's nothing to back
    // out to. Pass undefined onCancel so the press is harmlessly ignored.
    this.menuNav.setScope(items);
  }

  private applyCustomizeMenuScope() {
    const items: HTMLElement[] = [];
    // Cosmetic grids first (skin + trail) so the cursor lands inside the
    // panel content. Order in the DOM matches visual order, so spatial
    // nav (left/right inside a row, up/down between rows) Just Works.
    const skinItems = document.querySelectorAll<HTMLElement>("#crystal-grid .cosmetic-item:not(.locked)");
    const trailItems = document.querySelectorAll<HTMLElement>("#trail-grid .cosmetic-item:not(.locked)");
    skinItems.forEach((el) => items.push(el));
    trailItems.forEach((el) => items.push(el));
    const back = document.getElementById("customize-back");
    if (back) items.push(back);
    // Note: the name input is intentionally NOT in this scope — text fields
    // need raw arrow keys for cursor movement and conflict with menu nav.
    // Mouse-click into the input still works for editing.
    this.menuNav.setScope(items, () => this.closeCustomize());
  }

  private applyMultiplayerMenuScope() {
    const items: HTMLElement[] = [];
    const create = document.getElementById("multiplayer-create-btn");
    const join = document.getElementById("multiplayer-join-btn");
    if (this.matchState === "inLobby") items.push(this.multiplayerReadyBtn);
    items.push(this.multiplayerQuickplayBtn);
    if (create) items.push(create);
    if (join) items.push(join);
    items.push(this.multiplayerLeaveBtn);
    this.menuNav.pushScope(items, () => {
      void this.leaveOrCloseMultiplayer();
    });
  }

  private applyPauseMenuScope() {
    const items: HTMLElement[] = [];
    const volume = document.getElementById("pause-volume");
    const resume = document.getElementById("pause-resume");
    const ghost = document.getElementById("pause-ghost-toggle");
    // Resume first so it's the default-focused (mash A to unpause).
    if (resume) items.push(resume);
    if (ghost) items.push(ghost);
    if (volume) items.push(volume);
    this.menuNav.setScope(items, () => this.resumeGame());
  }

  private applyGameOverMenuScope() {
    // Retry first so mash-Enter / gamepad-A defaults to "retry" — matches
    // the "PRESS SPACE OR CLICK TO RETRY" prompt the player sees. Arrows
    // navigate to STATS / LEADERBOARD tabs, SHARE, then BACK TO TITLE.
    const items: HTMLElement[] = [];
    if (this.centerRetry) items.push(this.centerRetry);
    const tabs = document.querySelectorAll<HTMLElement>(".go-tab");
    tabs.forEach((el) => items.push(el));
    const share = document.getElementById("share-x-btn");
    if (share) items.push(share);
    const back = document.getElementById("center-back-to-title");
    if (back) items.push(back);
    this.menuNav.setScope(items);
  }

  private closeCustomize() {
    if (!this.customizeOpen) return;
    this.customizeOpen = false;
    this.customizePanel.classList.add("hidden");
    this.titleOverlay.classList.remove("hidden");
    this.applyTitleMenuScope();
    this.menuNavSuppressFrames = 2;
  }

  private closeMultiplayerModal() {
    if (!this.multiplayerOpen) return;
    this.multiplayerOpen = false;
    this.multiplayerModal.classList.add("hidden");
    this.menuNav.popScope();
    this.menuNavSuppressFrames = 2;
  }

  private initTitleLeaderboardToggle() {
    if (!this.titleLeaderboardEl || !this.titleLeaderboardToggleEl) return;
    this.titleLeaderboardToggleEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.titleLeaderboardExpanded = !this.titleLeaderboardExpanded;
      this.updateTitleLeaderboardLayout();
      this.applyTitleMenuScope();
    });
    this.titleLeaderboardToggleEl.addEventListener("mousedown", (e) => e.stopPropagation());
    this.updateTitleLeaderboardLayout();
    setTimeout(() => this.updateTitleLeaderboardLayout(), 0);
  }

  private updateTitleLeaderboardLayout() {
    if (!this.titleLeaderboardEl || !this.titleLeaderboardToggleEl) return;
    const frameWidth = document.body.clientWidth || this.gameContainer?.clientWidth || window.innerWidth;
    const desktop = frameWidth >= 720;
    const expanded = desktop || this.titleLeaderboardExpanded;
    this.titleLeaderboardEl.dataset.collapsed = expanded ? "false" : "true";
    this.titleLeaderboardToggleEl.setAttribute("aria-expanded", expanded ? "true" : "false");
    this.titleLeaderboardToggleEl.textContent = expanded ? "TOP RUNS ▲" : "TOP RUNS ▼";
  }

  /** Fetch ghost recordings + upload threshold in parallel. Fire-and-forget.
   *  We cache the records but don't pre-load them into ghostManager — the
   *  single-ghost race model loads exactly one record at startGame() time. */
  private async loadGhostsAsync() {
    try {
      const [ghosts, threshold] = await Promise.all([
        fetchGhosts(10), // top 10 — powers the title leaderboard's RACE list
        fetchGhostUploadThreshold(),
      ]);
      this.ghostUploadThreshold = threshold;
      this.cachedGhosts = ghosts; // source of truth for race selection
      this.updateTitleGhostLine();
      this.populateTitleLeaderboard(ghosts);
    } catch {
      // Silent — ghost racing is optional polish.
    }
  }

  /** Show/hide the race chip based on whether a specific ghost was targeted this run. */
  private updateRaceChip() {
    if (!this.raceChipEl) return;
    if (this.racingGhostName) {
      this.raceChipEl.textContent = `👻 RACING: ${this.racingGhostName.toUpperCase()}`;
      this.raceChipEl.style.display = "";
    } else {
      this.raceChipEl.style.display = "none";
    }
  }

  /** Legacy "Racing against N ghosts" line — dead under the single-ghost
   *  race model. Kept as a no-op to retain the call sites' invariants
   *  (always hide the line) without restoring the multi-ghost affordance. */
  private updateTitleGhostLine() {
    const el = document.getElementById("title-ghost-line");
    if (el) el.style.display = "none";
  }

  /** Populate the title screen leaderboard from fetched ghost records. */
  private populateTitleLeaderboard(ghosts: GhostRecord[]) {
    const rows = document.getElementById("title-lb-rows");
    const threshold = document.getElementById("title-lb-threshold");
    if (!rows) return;

    if (ghosts.length === 0) {
      if (threshold) threshold.textContent = "TARGETS · BE FIRST TO SET THE TARGET";
      rows.innerHTML = `<div class="title-lb-empty">No runs yet — be first.</div>`;
      return;
    }

    if (threshold) {
      threshold.textContent = this.getTitleLeaderboardThresholdCallout(ghosts[0]);
    }

    let html = "";
    for (let i = 0; i < ghosts.length; i++) {
      const g = ghosts[i];
      const hasRace = typeof g.seed === "number" && g.seed !== 0;
      const isTop3 = i < 3;
      const safeName = g.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const rowClass = `title-lb-row${hasRace ? " is-raceable" : ""}${isTop3 ? " is-podium" : ""}`;
      if (hasRace) {
        html += `<button type="button" class="${rowClass}" data-ui data-ghost-id="${g.id}" data-ghost-seed="${g.seed}" data-ghost-name="${safeName}">`;
      } else {
        html += `<div class="${rowClass}">`;
      }
      html += `<span class="title-lb-rank">${String(i + 1).padStart(2, "0")}</span>`;
      html += `<span class="title-lb-name">${safeName}</span>`;
      html += `<span class="title-lb-side">`;
      html += `<span class="title-lb-score">${g.score.toLocaleString()}</span>`;
      html += `<span class="title-lb-meta">${g.distance}m${hasRace ? ` · <span class="title-lb-race-badge">RACE ›</span>` : ""}</span>`;
      html += `</span>`;
      if (hasRace) {
        html += `</button>`;
      } else {
        html += `</div>`;
      }
    }
    rows.innerHTML = html;

    // Event delegation — one persistent listener handles all RACE clicks.
    if (rows.dataset.bound === "1") return;
    rows.dataset.bound = "1";
    rows.addEventListener("click", (e: Event) => {
      const btn = (e.target as Element).closest("button[data-ghost-id]") as HTMLElement | null;
      if (!btn) return;
      const ghostId = btn.dataset.ghostId;
      const ghostSeed = parseInt(btn.dataset.ghostSeed ?? "0", 10);
      if (!ghostId || !ghostSeed) return;
      this.pendingRaceGhostId = ghostId;
      this.pendingRaceSeed = ghostSeed;
      this.startGame(false);
    });
  }

  private getTitleLeaderboardThresholdCallout(topGhost: GhostRecord): string {
    // TODO: enrich ghost metadata with streak/orb counts so this hook can mirror
    // the full Clockwork Climb-style "distance / streak / orbs" target line.
    const targetScore = this.roundLeaderboardTarget(topGhost.score, 5000);
    const targetDistance = this.roundLeaderboardTarget(topGhost.distance, 25);
    return `TARGETS · SCORE ${targetScore.toLocaleString()}+ · DISTANCE ${targetDistance}m+`;
  }

  private roundLeaderboardTarget(value: number, step: number): number {
    return Math.max(step, Math.ceil(value / step) * step);
  }

  private initPauseMenu() {
    const volumeSlider = document.getElementById("pause-volume") as HTMLInputElement;
    const resumeBtn = document.getElementById("pause-resume")!;

    // Set initial volume
    volumeSlider.value = String(Math.round(getMasterVolume() * 100));

    volumeSlider.addEventListener("input", () => {
      setMasterVolume(parseInt(volumeSlider.value) / 100);
    });

    resumeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.resumeGame();
    });

    // Ghost toggle — persisted and applied live
    const ghostBtn = document.getElementById("pause-ghost-toggle");
    if (ghostBtn) {
      const paint = () => {
        ghostBtn.textContent = `GHOST: ${this.ghostToggle ? "ON" : "OFF"}`;
        ghostBtn.style.color = this.ghostToggle ? "#00ffcc" : "#668899";
        ghostBtn.style.borderColor = this.ghostToggle ? "#00ffcc" : "#334455";
      };
      paint();
      ghostBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.ghostToggle = !this.ghostToggle;
        localStorage.setItem("shatterDriftGhostToggle", this.ghostToggle ? "1" : "0");
        this.ghostManager.setEnabled(this.ghostToggle);
        this.updateTitleGhostLine();
        paint();
      });
    }

    // ESC to pause/resume
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.matchState !== "idle") return;
        if (this.state === GameState.Playing) {
          this.pauseGame();
        } else if (this.state === GameState.Paused) {
          this.resumeGame();
        }
      }
    });
  }

  private pauseGame() {
    this.state = GameState.Paused;
    this.pauseMenu.classList.remove("hidden");
    this.applyPauseMenuScope();
    this.menuNavSuppressFrames = 2;
  }

  private resumeGame() {
    this.state = GameState.Playing;
    this.pauseMenu.classList.add("hidden");
    this.menuNav.detach();
    this.menuNavSuppressFrames = 2;
    // Reset clock delta so we don't get a huge dt spike
    this.clock.getDelta();
  }

  private initCustomizePanel() {
    const crystalGrid = document.getElementById("crystal-grid")!;
    const trailGrid = document.getElementById("trail-grid")!;
    const backBtn = document.getElementById("customize-back")!;
    const openBtn = document.getElementById("customize-btn")!;

    // Player name input — initialized from the shared coolname identity
    // (universal polish rule 2). Edits propagate live via setLocalUsername;
    // game-over leaderboard / ghost upload all read through getLocalUsername.
    const nameInput = document.getElementById("customize-name-input") as HTMLInputElement;
    nameInput.value = getLocalUsername();
    // stopPropagation so menu-nav direction keys (arrows / WASD) don't fire
    // while the user is editing text.
    nameInput.addEventListener("keydown", (e) => e.stopPropagation());
    nameInput.addEventListener("input", () => setLocalUsername(nameInput.value));
    nameInput.addEventListener("change", () => setLocalUsername(nameInput.value));
    nameInput.addEventListener("blur", () => setLocalUsername(nameInput.value));

    const unlockedRewards = this.challenges.getUnlockedRewards();
    const unlockedCrystals = new Set(["default", ...unlockedRewards.filter(r => r.type === "crystal").map(r => r.value)]);
    const unlockedTrails = new Set(["default", ...unlockedRewards.filter(r => r.type === "trail").map(r => r.value)]);

    const selectedCrystal = this.unlocks.getSelectedCrystal().id;
    const selectedTrail = this.unlocks.getSelectedTrail().id;

    // Build crystal skin items
    for (const skin of Object.values(CRYSTAL_SKINS)) {
      const unlocked = unlockedCrystals.has(skin.id);
      const item = document.createElement("div");
      item.className = `cosmetic-item${skin.id === selectedCrystal ? " selected" : ""}${!unlocked ? " locked" : ""}`;
      const hexColor = `#${skin.emissiveColor.toString(16).padStart(6, "0")}`;
      item.innerHTML = `
        <div class="cosmetic-swatch" style="background:${hexColor};color:${hexColor}"></div>
        <div>
          <div class="cosmetic-name">${skin.name}</div>
          ${!unlocked ? `<div class="cosmetic-lock">🔒 Complete challenge</div>` : ""}
        </div>`;
      if (unlocked) {
        item.addEventListener("click", () => {
          this.unlocks.selectCrystal(skin.id);
          this.player.applySkin(skin);
          crystalGrid.querySelectorAll(".cosmetic-item").forEach(el => el.classList.remove("selected"));
          item.classList.add("selected");
        });
      }
      crystalGrid.appendChild(item);
    }

    // Build trail style items
    for (const trail of Object.values(TRAIL_STYLES)) {
      const unlocked = unlockedTrails.has(trail.id);
      const item = document.createElement("div");
      item.className = `cosmetic-item${trail.id === selectedTrail ? " selected" : ""}${!unlocked ? " locked" : ""}`;
      const hexColor = `#${trail.color.toString(16).padStart(6, "0")}`;
      item.innerHTML = `
        <div class="cosmetic-swatch" style="background:${hexColor};color:${hexColor}"></div>
        <div>
          <div class="cosmetic-name">${trail.name}</div>
          ${!unlocked ? `<div class="cosmetic-lock">🔒 Complete challenge</div>` : ""}
        </div>`;
      if (unlocked) {
        item.addEventListener("click", () => {
          this.unlocks.selectTrail(trail.id);
          trailGrid.querySelectorAll(".cosmetic-item").forEach(el => el.classList.remove("selected"));
          item.classList.add("selected");
        });
      }
      trailGrid.appendChild(item);
    }

    // Open customize panel
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.customizeOpen = true;
      this.titleOverlay.classList.add("hidden");
      nameInput.value = getLocalUsername();
      this.customizePanel.classList.remove("hidden");
      this.applyCustomizeMenuScope();
      // Suppress so the same A press that opened customize doesn't
      // immediately confirm the first cosmetic tile inside it.
      this.menuNavSuppressFrames = 2;
    });

    // Back button
    backBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closeCustomize();
    });

    // Apply initial skin
    this.player.applySkin(this.unlocks.getSelectedCrystal());
  }

  private initMultiplayerUI() {
    if (!MULTIPLAYER_ENABLED) return;
    this.lobbyClient = new LobbyClient(getLocalUsername());
    this.meshTransport = new MeshTransport(this.lobbyClient);
    this.matchCoordinator = new MatchStartCoordinator(this.lobbyClient, this.meshTransport, {
      onMatchStart: (config) => this.beginMultiplayerMatch(config),
      onError: (message) => this.setMultiplayerStatus(message, true),
    });
    this.lobbyClient.subscribe({
      onPlayersChanged: (players) => {
        this.renderLobbyPlayers(players);
        this.maybeStartReadyMatch(players);
      },
      onError: (message) => this.setMultiplayerStatus(message, true),
      onLobbyClosed: (message) => {
        this.setMultiplayerStatus(message, true);
        void this.leaveOrCloseMultiplayer();
      },
    });
    // Re-evaluate match-start eligibility whenever a mesh peer finishes
    // connecting. Without this hook, both players can be ready before the
    // WebRTC data channels finish handshaking — `maybeStartReadyMatch` then
    // bails on the "waiting for peer connections" branch and never retries.
    this.meshTransport.setPeerConnectedHandler(() => {
      if (this.lobbyClient) this.maybeStartReadyMatch(this.lobbyClient.getPlayers());
    });

    const openBtn = document.getElementById("multiplayer-btn")!;
    const createBtn = document.getElementById("multiplayer-create-btn") as HTMLButtonElement;
    const joinBtn = document.getElementById("multiplayer-join-btn") as HTMLButtonElement;

    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openMultiplayerModal();
    });
    openBtn.addEventListener("mousedown", (e) => e.stopPropagation());

    this.multiplayerCodeInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        void this.joinMultiplayerLobby();
      }
    });
    this.multiplayerCodeInput.addEventListener("input", () => {
      this.multiplayerCodeInput.value = normalizeCode(this.multiplayerCodeInput.value);
    });

    this.multiplayerQuickplayBtn.addEventListener("click", () => {
      void this.quickplayMultiplayerLobby();
    });
    createBtn.addEventListener("click", () => {
      void this.createMultiplayerLobby();
    });
    joinBtn.addEventListener("click", () => {
      void this.joinMultiplayerLobby();
    });
    this.multiplayerReadyBtn.addEventListener("click", () => {
      void this.readyMultiplayerLobby();
    });
    this.multiplayerLeaveBtn.addEventListener("click", () => {
      void this.leaveOrCloseMultiplayer();
    });
    this.multiplayerCopyLinkBtn.addEventListener("click", () => {
      const code = this.lobbyClient?.getLobbyCode();
      if (!code || !LOBBY_CODE_RE.test(code)) return;
      const url = this.buildInviteUrl(code);
      const prevText = this.multiplayerStatusEl.textContent ?? "";
      const prevIsError = this.multiplayerStatusEl.classList.contains("error");
      void navigator.clipboard.writeText(url).then(() => {
        this.setMultiplayerStatus("Invite link copied — send it to a friend.", false, true);
        setTimeout(() => {
          if (this.multiplayerStatusEl.textContent === "Invite link copied — send it to a friend.") {
            this.setMultiplayerStatus(prevText, prevIsError);
          }
        }, 2000);
      }).catch(() => {
        this.multiplayerCopyLinkFallbackEl.value = url;
        this.multiplayerCopyLinkFallbackEl.style.display = "";
        this.multiplayerCopyLinkFallbackEl.select();
        this.setMultiplayerStatus("Couldn't auto-copy — use the box below.");
      });
    });

    this.renderLobbyPlayers([]);

    // Dev hook: `?mp=1&mp_auto=1` skips the lobby UI dance and auto-pairs both
    // tabs into the same Colyseus room via `joinOrCreate`. Used by the puppeteer
    // smoke test (`tools/mp-smoke-puppeteer.mjs`) to drive a deterministic
    // two-tab session without clicking through CREATE/JOIN.
    if (MULTIPLAYER_AUTO_QUICKMATCH && this.lobbyClient && this.meshTransport && this.matchCoordinator) {
      void (async () => {
        try {
          await this.syncLobbyNameFromStorage();
          await (this.lobbyClient as LobbyClient).quickMatch();
          this.meshTransport!.start();
          this.matchCoordinator!.start();
          this.transitionToLobby();
          this.setMultiplayerStatus("Auto-quickmatch joined; waiting for second player.");
        } catch (err) {
          this.setMultiplayerStatus(err instanceof Error ? err.message : "auto-quickmatch failed", true);
        }
      })();
    } else {
      // Deep-link auto-join: if the URL has ?lobby=<9-char code>, open the
      // modal and trigger join automatically. Skipped when mp_auto is active
      // (smoke harness) to avoid conflicting with the quickmatch flow.
      this.checkDeepLinkLobby();
    }
  }

  private openMultiplayerModal() {
    if (!MULTIPLAYER_ENABLED) return;
    if (this.multiplayerOpen) return;
    this.multiplayerOpen = true;
    this.multiplayerModal.classList.remove("hidden");
    this.multiplayerCodeInput.value = "";
    if (this.matchState !== "inLobby") {
      this.setMultiplayerStatus("Quick-match into any open lobby, or use a code.");
      this.multiplayerCodeEl.textContent = "";
    }
    this.updateMultiplayerLobbyControls();
    this.applyMultiplayerMenuScope();
    this.menuNavSuppressFrames = 2;
  }

  private setMultiplayerStatus(message: string, isError = false, isInfo = false) {
    this.multiplayerStatusEl.textContent = message;
    this.multiplayerStatusEl.classList.toggle("error", isError);
    this.multiplayerStatusEl.classList.toggle("info", isInfo && !isError);
  }

  private renderLobbyPlayers(players: LobbyPlayer[]) {
    if (players.length === 0) {
      this.multiplayerEmptyEl.classList.remove("hidden");
      this.multiplayerEmptyEl.textContent = this.lobbyClient?.getLobbyCode()
        ? "Waiting for players..."
        : "No active lobby yet.";
      this.multiplayerPlayerListEl.querySelectorAll(".mp-player-row").forEach((el) => el.remove());
      this.updateMultiplayerLobbyControls();
      return;
    }

    this.multiplayerEmptyEl.classList.add("hidden");
    this.multiplayerPlayerListEl.querySelectorAll(".mp-player-row").forEach((el) => el.remove());
    for (const player of players) {
      const row = document.createElement("div");
      row.className = "mp-player-row";
      row.innerHTML = `
        <span class="slot">P${player.playerIndex + 1}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${player.name}</span>
        <span class="you">${player.isLocal ? (player.ready ? "YOU READY" : "YOU") : (player.ready ? "READY" : "WAITING")}</span>
      `;
      this.multiplayerPlayerListEl.appendChild(row);
    }
    this.updateMultiplayerLobbyControls();
  }

  private async syncLobbyNameFromStorage() {
    if (!this.lobbyClient) return;
    await this.lobbyClient.setPlayerName(getLocalUsername());
    this.setMultiplayerStatus(`Using ${getLocalUsername()} for this lobby.`);
  }

  private async createMultiplayerLobby() {
    if (!this.lobbyClient || !this.meshTransport || !this.matchCoordinator || this.multiplayerBusy) return;
    this.multiplayerBusy = true;
    try {
      await this.syncLobbyNameFromStorage();
      await this.lobbyClient.createLobby();
      this.meshTransport.start();
      this.matchCoordinator.start();
      this.transitionToLobby();
      this.setMultiplayerStatus("Lobby ready — share the link and wait for players.");
      this.renderLobbyPlayers(this.lobbyClient.getPlayers());
    } catch (error) {
      this.setMultiplayerStatus(error instanceof Error ? error.message : "Failed to create lobby.", true);
    } finally {
      this.multiplayerBusy = false;
    }
  }

  private async joinMultiplayerLobby() {
    if (!this.lobbyClient || !this.meshTransport || !this.matchCoordinator || this.multiplayerBusy) return;
    this.multiplayerBusy = true;
    try {
      await this.syncLobbyNameFromStorage();
      const players = await this.lobbyClient.joinLobby(this.multiplayerCodeInput.value);
      this.meshTransport.start();
      this.matchCoordinator.start();
      this.transitionToLobby();
      this.setMultiplayerStatus("Joined lobby — waiting for the match to start.");
      this.renderLobbyPlayers(players);
      this.clearLobbyUrlParam();
    } catch (error) {
      this.setMultiplayerStatus(error instanceof Error ? error.message : "Failed to join lobby.", true);
      this.clearLobbyUrlParam();
    } finally {
      this.multiplayerBusy = false;
    }
  }

  private async quickplayMultiplayerLobby() {
    if (!this.lobbyClient || !this.meshTransport || !this.matchCoordinator || this.multiplayerBusy) return;
    this.multiplayerBusy = true;
    try {
      await this.syncLobbyNameFromStorage();
      this.setMultiplayerStatus("Searching for a match...");
      await this.lobbyClient.quickMatch();
      this.meshTransport.start();
      this.matchCoordinator.start();
      this.transitionToLobby();
      this.setMultiplayerStatus("Matched — waiting for players.");
      this.renderLobbyPlayers(this.lobbyClient.getPlayers());
    } catch (error) {
      this.setMultiplayerStatus(error instanceof Error ? error.message : "Quick-match failed.", true);
    } finally {
      this.multiplayerBusy = false;
    }
  }

  private async readyMultiplayerLobby() {
    if (!this.lobbyClient || this.multiplayerBusy || this.matchState !== "inLobby") return;
    this.multiplayerBusy = true;
    try {
      await this.lobbyClient.setReady(true);
      this.setMultiplayerStatus("Ready. Waiting for the rest of the lobby.");
      this.renderLobbyPlayers(this.lobbyClient.getPlayers());
    } catch (error) {
      this.setMultiplayerStatus(error instanceof Error ? error.message : "Failed to mark ready.", true);
    } finally {
      this.multiplayerBusy = false;
    }
  }

  private async leaveOrCloseMultiplayer() {
    if (!this.lobbyClient || !this.meshTransport || this.multiplayerBusy) return;
    // BUG 10: when the room was already closed (unexpected disconnect mid-match),
    // getLobbyCode() returns null but matchState may still be "inMatch" / "matchOver"
    // and the MpRunner is still spinning. Skip the network teardown but still drive
    // the local cleanup so we don't leave the client stuck in match state.
    if (!this.lobbyClient.getLobbyCode()) {
      const stuckInMatch = this.matchState !== "idle";
      this.disposeRemotePlayers();
      this.mpSnapshotUnsubscribe?.();
      this.mpSnapshotUnsubscribe = null;
      this.mpRunner?.stop();
      this.mpRunner = null;
      this.multiplayerSim = null;
      this.multiplayerConfig = null;
      this.multiplayerAuthoritativeState = null;
      this.multiplayerLastAdvancedTick = -1;
      this.pendingBumpEvents.length = 0;
      this.mpDeathPending = false;
      this.mpDeathTimer = 0;
      this.multiplayerCodeEl.textContent = "";
      this.multiplayerCodeInput.value = "";
      this.renderLobbyPlayers([]);
      this.closeMultiplayerModal();
      if (stuckInMatch) {
        this.transitionToIdle();
      }
      return;
    }
    this.multiplayerBusy = true;
    try {
      this.matchCoordinator?.stop();
      await this.meshTransport.stop();
      await this.lobbyClient.leaveLobby();
      this.disposeRemotePlayers();
      this.mpSnapshotUnsubscribe?.();
      this.mpSnapshotUnsubscribe = null;
      this.mpRunner?.stop();
      this.mpRunner = null;
      this.multiplayerSim = null;
      this.multiplayerConfig = null;
      this.multiplayerAuthoritativeState = null;
      this.multiplayerLastAdvancedTick = -1;
      this.pendingBumpEvents.length = 0;
      this.mpDeathPending = false;
      this.mpDeathTimer = 0;
      this.multiplayerCodeEl.textContent = "";
      this.multiplayerCodeInput.value = "";
      this.setMultiplayerStatus("Returned to singleplayer title.");
      this.renderLobbyPlayers([]);
      this.closeMultiplayerModal();
      this.transitionToIdle();
    } finally {
      this.multiplayerBusy = false;
    }
  }

  /**
   * Build a shareable invite URL embedding the lobby code.
   * Existing query params are preserved; any stale `?lobby=` param is replaced.
   */
  private buildInviteUrl(code: string): string {
    let basePath: string;
    if (window.parent !== window && document.referrer) {
      try {
        const ref = new URL(document.referrer);
        basePath = ref.origin + ref.pathname;
      } catch {
        basePath = window.location.origin + window.location.pathname;
      }
    } else {
      basePath = window.location.origin + window.location.pathname;
    }
    const params = new URLSearchParams(window.location.search);
    params.delete("lobby");
    params.set("lobby", code);
    return basePath + "?" + params.toString();
  }

  /** Remove `?lobby=` from the address bar without adding a history entry. */
  private clearLobbyUrlParam() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("lobby")) return;
    params.delete("lobby");
    const newSearch = params.toString();
    history.replaceState({}, "", window.location.pathname + (newSearch ? "?" + newSearch : ""));
  }

  /**
   * If the page loaded with `?lobby=<code>`, open the MP modal and auto-join.
   * Called at the end of initMultiplayerUI() — skipped when mp_auto=1 (smoke harness).
   * Silent no-op for invalid or absent codes.
   */
  private checkDeepLinkLobby() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("lobby");
    if (!code || !LOBBY_CODE_RE.test(code)) return;
    // Open modal, pre-fill the code, then trigger join after a short delay so
    // the audio context has a chance to initialise and the UI is painted first.
    this.openMultiplayerModal();
    this.multiplayerCodeInput.value = code;
    this.setMultiplayerStatus(`Joining lobby ${code}…`);
    setTimeout(() => {
      void this.joinMultiplayerLobby();
    }, 250);
  }

  private initDailyButton() {
    const dailyBtn = document.getElementById("daily-btn");
    if (!dailyBtn) return;
    dailyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.dailyChallengeQueued = true;
    });
    dailyBtn.addEventListener("mousedown", (e) => e.stopPropagation());

    // Countdown timer to midnight UTC
    const updateDailyUI = () => {
      // Countdown
      const timerEl = document.getElementById("daily-timer");
      if (timerEl) {
        const now = Date.now();
        const midnight = new Date();
        midnight.setUTCHours(24, 0, 0, 0);
        const msLeft = midnight.getTime() - now;
        const h = Math.floor(msLeft / 3_600_000);
        const m = Math.floor((msLeft % 3_600_000) / 60_000);
        const s = Math.floor((msLeft % 60_000) / 1_000);
        timerEl.textContent = `Resets in ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      }

      // Today's best
      const bestEl = document.getElementById("title-daily-best");
      if (bestEl) {
        const dateKey = this.getDailyApiDate(this.getDailyDateKey());
        const storedBest = localStorage.getItem(`shatterDriftDailyBest_${dateKey}`);
        if (storedBest && parseInt(storedBest, 10) > 0) {
          bestEl.textContent = `TODAY'S BEST: ${parseInt(storedBest, 10).toLocaleString()}`;
          bestEl.style.display = "block";
        } else {
          bestEl.style.display = "none";
        }
      }
    };

    updateDailyUI();
    this.dailyTimerInterval = setInterval(updateDailyUI, 1000);
  }

  // --- Date helpers ---

  private getDailyDateKey(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
  }

  private formatDailyDate(dateKey: string): string {
    const months = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    const year = parseInt(dateKey.slice(0, 4));
    const month = parseInt(dateKey.slice(4, 6)) - 1;
    const day = parseInt(dateKey.slice(6, 8));
    return `${months[month]} ${day}, ${year}`;
  }

  private getDailyApiDate(dateKey: string): string {
    return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
  }

  private loop() {
    let dt = Math.min(this.clock.getDelta(), 0.05);

    // Apply slow-mo from power-ups
    if (this.state === GameState.Playing && this.matchState === "idle") {
      const puTimeScale = this.powerups.getTimeScale();
      dt *= puTimeScale;
    }

    // Death slow-mo — dramatic time dilation before game over screen
    if (this.deathSlowMo && this.matchState === "idle") {
      this.deathSlowMoTimer -= dt;
      const deathProgress = 1 - Math.max(0, this.deathSlowMoTimer / 0.6);
      // Start at 20% speed, ease out to 5%
      const deathTimescale = 0.2 * (1 - deathProgress * 0.7);
      dt *= deathTimescale;

      // Hold the snapped narrow FOV during death slow-mo
      this.targetFOV = 60;

      // Bloom intensifies
      this.bloomPass.strength = 2.0 - deathProgress * 0.5;

      if (this.deathSlowMoTimer <= 0) {
        this.deathSlowMo = false;
      }
    }

    // Apply close-call slow-mo (brief dramatic pause)
    if (this.slowMoTimer > 0) {
      this.slowMoTimer -= dt;
      this.slowMoFactor = THREE.MathUtils.lerp(this.slowMoFactor, 1, 0.05);
      dt *= this.slowMoFactor;
    }

    this.input.update();

    // Tick menu-nav suppress counter once per frame regardless of state.
    if (this.menuNavSuppressFrames > 0) this.menuNavSuppressFrames -= 1;

    // Update menu navigation BEFORE gameplay state branches so any A
    // press consumed by a menu doesn't leak into gameplay (e.g. mashing
    // Enter to retry shouldn't immediately fire shatter).
    let menuConsumedActivate = false;
    if (this.menuNavSuppressFrames === 0 && this.menuNav.isActive()) {
      menuConsumedActivate = this.menuNav.update(this.input);
    }

    // Pause-menu volume slider live-updates while focused: pressing
    // left/right adjusts the slider value and applies it. Other focused
    // items have no left/right effect, so this is harmless.
    if (this.state === GameState.Paused) {
      this.handlePauseMenuLeftRight();
    }

    switch (this.state) {
      case GameState.Title:
        this.updateTitle(dt, menuConsumedActivate);
        break;
      case GameState.Launching:
        this.updateLaunching(dt);
        break;
      case GameState.Playing:
        if (this.matchState === "inMatch") {
          this.updateMultiplayerPlaying(dt);
        } else if (this.matchState === "matchOver") {
          this.updateMultiplayerMatchOver(dt, menuConsumedActivate);
        } else {
          this.updatePlaying(dt);
        }
        break;
      case GameState.Paused:
        // Frozen — only render, don't update game logic
        break;
      case GameState.GameOver:
        this.updateGameOver(dt, menuConsumedActivate);
        break;
    }

    // Always update effects (even on title/game over for visual continuity)
    this.trail.update(dt);
    this.explosion.update(dt);
    this.collectFlash.update(dt);
    this.debris.update(dt);
    this.bumpEffect.update(dt);
    this.screenFlash.update(dt);
    this.milestones.update(dt);
    this.popups.update(dt);
    this.shockwave.update(dt);
    this.grazeStream.update(dt);
    this.scoreStream.update(dt);
    this.envParticles.update(dt, this.playerZ);
    this.skybox.update(
      this.biomes.biomeIndex,
      this.biomes.isTransitioning,
      this.biomes.progress,
      this.playerZ,
      dt
    );

    // Camera FOV interpolation
    this.currentFOV = THREE.MathUtils.lerp(this.currentFOV, this.targetFOV, 3 * dt);
    this.camera.fov = this.currentFOV;
    this.camera.updateProjectionMatrix();

    // Camera roll interpolation (applied via camera.up in updatePlaying/updateTitle)
    this.cameraRoll = THREE.MathUtils.lerp(this.cameraRoll, this.targetCameraRoll, 1 - Math.exp(-5 * dt));

    // Update PostFX
    this.postfx.update(dt);

    // Render with bloom + PostFX
    this.composer.render();

    // Update recorder
    this.recorder?.update();

    this.input.endFrame();
  }

  // --- Title ---

  private updateTitle(dt: number, menuConsumedActivate: boolean) {
    // Crystal preview is shown ONLY while customize is open, per universal
    // polish rule 5 (no gameplay actors visible on the title screen).
    // Update its transform every frame so the preview stays animated when
    // the customize panel is toggled open mid-title.
    this.player.group.visible = this.customizeOpen;
    this.player.group.position.set(0, -1.5, 0);
    this.player.crystalMesh.rotation.y += dt * 0.5;
    this.player.crystalMesh.rotation.x = Math.sin(performance.now() * 0.001) * 0.3;

    // Camera orbits slowly around the crystal
    const t = performance.now() * 0.0003;
    this.camera.position.set(Math.sin(t) * 5, 1.5, Math.cos(t) * 5);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, -1.5, 0);

    if (this.dailyChallengeQueued) {
      this.dailyChallengeQueued = false;
      // DAILY = fresh deterministic run; abandon any persistent ghost-race lock.
      this.currentRaceGhostId = null;
      this.currentRaceSeed = null;
      this.startGame(true);
      return;
    }

    // Legacy "click anywhere or space" launch — still works for mouse +
    // gamepad-A pressed off-button. Menu nav handles the focused PLAY
    // button; don't double-fire if it already activated something.
    if (
      !menuConsumedActivate &&
      !this.customizeOpen &&
      !this.multiplayerOpen &&
      this.menuNavSuppressFrames === 0 &&
      this.input.justPressed("click")
    ) {
      // Fresh normal run; abandon any persistent ghost-race lock.
      this.currentRaceGhostId = null;
      this.currentRaceSeed = null;
      this.startGame(false);
    }
  }

  /** Volume-slider tweak via gamepad d-pad / arrow keys when focused in pause. */
  private handlePauseMenuLeftRight() {
    const focused = this.menuNav.focusedElement();
    if (!focused) return;
    if (focused.id !== "pause-volume") return;
    const slider = focused as HTMLInputElement;
    const dir =
      this.input.justPressedDir("left")  ? -5 :
      this.input.justPressedDir("right") ?  5 : 0;
    if (dir === 0) return;
    const next = Math.max(0, Math.min(100, parseInt(slider.value || "0", 10) + dir));
    slider.value = String(next);
    setMasterVolume(next / 100);
  }

  private encodeNetworkAction(): number {
    // Negate to convert screen-space input → world-space (matches solo: line ~2217).
    // Camera faces +Z, so screen-right = world -X. Sim's player-movement-system applies
    // input.horizontal directly to player.x: action bit 0x01 (left) → horizontal=-1 → world -X = screen-RIGHT.
    // Solo negates getMovement().x before feeding the sim; MP must too, or controls invert.
    const move = -this.input.getMovement().x;
    const left = move < -0.25;
    const right = move > 0.25;
    const shatter = this.input.isDown("space") || this.input.isDown("click");
    const boost = this.input.isBoostDown();
    const brake = this.input.isBrakeDown();

    if (!boost && !brake) {
      if (!left && !right && !shatter) return 0;
      if (left && !right && !shatter) return 1;
      if (!left && right && !shatter) return 2;
      if (!left && !right && shatter) return 3;
      if (left && !right && shatter) return 4;
      if (!left && right && shatter) return 5;
    }

    let action = 0;
    if (left && !right) action |= 0x01;
    if (right && !left) action |= 0x02;
    if (shatter) action |= 0x04;
    if (boost) action |= 0x08;
    if (brake) action |= 0x10;
    return action;
  }

  private transitionToLobby() {
    this.matchState = "inLobby";
    this.multiplayerMatchRequested = false;
    this.updateMultiplayerLobbyControls();
  }

  private transitionToIdle() {
    this.matchState = "idle";
    this.mpSnapshotUnsubscribe?.();
    this.mpSnapshotUnsubscribe = null;
    this.mpRunner?.stop();
    this.mpRunner = null;
    this.multiplayerSim = null;
    this.multiplayerConfig = null;
    this.multiplayerAuthoritativeState = null;
    this.pendingBumpEvents.length = 0;
    this.multiplayerLastAdvancedTick = -1;
    this.multiplayerMatchRequested = false;
    this.disposeRemotePlayers();
    this.world.reset();
    this.world.setRenderMode("sp");
    this.biomes.reset();
    this.applyBiomeColors();
    // BUG A: restore the unlocked-crystal skin so the local avatar is no
    // longer wearing the MP slot color when the title preview / next solo
    // run renders.
    this.player.applySkin(this.unlocks.getSelectedCrystal());
    this.player.group.visible = this.customizeOpen;
    this.player.shattered = false;
    this.player.group.position.set(0, 0, 0);
    this.hud.classList.add("hidden");
    this.hud.classList.remove("is-gameover");
    document.body.classList.remove("is-gameover");
    this.centerMessage.classList.remove("is-gameover");
    this.gameOverOverlay.classList.remove("active");
    this.titleOverlay.classList.remove("hidden");
    this.centerMessage.style.opacity = "0";
    this.centerTitle.textContent = "";
    this.centerStats.innerHTML = "";
    this.centerRetry.textContent = "";
    this.pauseMenu.classList.add("hidden");
    this.multiplayerReadyBtn.disabled = false;
    this.state = GameState.Title;
    this.applyTitleMenuScope();
    this.menuNavSuppressFrames = 2;
  }

  private transitionToMatch(config: MultiplayerConfig) {
    this.matchState = "inMatch";
    this.multiplayerConfig = config;
    this.multiplayerMatchRequested = false;
    this.mpSnapshotUnsubscribe?.();
    this.mpSnapshotUnsubscribe = null;
    this.mpRunner?.stop();
    this.disposeRemotePlayers();

    this.multiplayerLastAdvancedTick = config.startTick - 1;

    this.mpRunner = new MpRunner({
      config,
      transport: this.meshTransport!,
      onTickAdvanced: (tick) => {
        this.multiplayerLastAdvancedTick = tick;
        this.multiplayerAuthoritativeState = this.mpRunner!.getInterpolatedAuthoritativeState();
        if (MULTIPLAYER_HASH_DEBUG && (tick + 1) % 60 === 0) {
          const hash = this.hashAuthoritativeState(this.multiplayerAuthoritativeState);
          console.log("[sd-mp-hash]", { tick: tick + 1, hash, state: this.multiplayerAuthoritativeState });
        }
      },
      onEvent: (ev) => {
        if (ev.type === "player_bumped") {
          this.pendingBumpEvents.push({
            playerA: ev.playerA,
            playerB: ev.playerB,
            contactX: ev.contactX,
            contactZ: ev.contactZ,
          });
        }
      },
      onLocalDeath: () => {
        // BUG 2: trigger crash visual + SFX immediately, defer the match-over UI
        // by ~1s so the player sees their avatar shatter before "MATCH ENDED" pops.
        if (this.mpDeathPending || this.matchState !== "inMatch") return;
        this.mpDeathPending = true;
        this.mpDeathTimer = 0;
        this.mpDeathReason = "You shattered.";
        this.triggerMpDeathVFX();
      },
    });
    this.multiplayerSim = this.mpRunner.getSim();
    this.mpRunner.start();
    // Reset BUG 2/3 latches for the new match.
    this.mpDeathPending = false;
    this.mpDeathTimer = 0;
    this.mpDeathReason = "";
    this.mpScoreSubmitted = false;

    // Wire server snapshots from the lobby into the runner for reconciliation.
    if (this.lobbyClient) {
      this.mpSnapshotUnsubscribe = this.lobbyClient.onSnapshot((snap) => {
        this.mpRunner?.applySnapshot(snap);
      });
    }
    this.matchCoordinator?.stop();

    this.world.reset();
    this.world.setRenderMode("mp-renderer");
    this.biomes.reset();
    this.powerups.reset();
    this.bossWaves.reset();
    this.speedGates.reset();
    this.worldEvents.reset();
    this.ghostManager.hideAll();
    this.gameOverOverlay.classList.remove("active");

    this.score = 0;
    this.distance = 0;
    this.speed = INITIAL_SPEED;
    this.playerZ = 0;
    this.phaseEnergy = 1;
    this.phaseLocked = false;
    this.phaseMeter = 100;
    this.boostCooldown = 0;
    this.brakeCooldown = 0;
    this.prevBoostCooldown = 0;
    this.prevBrakeCooldown = 0;
    this.player.applySkin(this.unlocks.getSelectedCrystal());
    // BUG A: in MP, override the local avatar's body/emissive/glow color with
    // the server-assigned slot color so each player is visually distinct.
    // Slot 0 = cyan, slot 1 = pink, slot 2 = yellow, slot 3 = green
    // (palette in `multiplayer.ts:PLAYER_COLOR_PALETTE`, mirrored on the
    // server in `MP_COLOR_PALETTE`). Solo color is restored in
    // `transitionToIdle` via the next `applySkin` call.
    const localSlot = config.players.find((p) => p.playerIndex === config.localPlayerIndex);
    if (localSlot) {
      this.player.setSlotColor(localSlot.color);
    }
    this.player.group.visible = true;
    this.player.group.position.set(0, 0, 0);
    this.player.shattered = false;
    this.riftFlipLerp = 0;
    this.riftWarningTimer = 0;
    if (this.riftWarningEl) this.riftWarningEl.style.opacity = "0";

    this.titleOverlay.classList.add("hidden");
    this.customizePanel.classList.add("hidden");
    this.multiplayerOpen = false;
    this.multiplayerModal.classList.add("hidden");
    this.hud.classList.remove("hidden");
    this.hud.classList.remove("is-gameover");
    document.body.classList.remove("is-gameover");
    this.centerMessage.classList.remove("is-gameover");
    this.centerMessage.style.opacity = "0";
    this.menuNav.detach();
    this.menuNavSuppressFrames = 4;
    this.state = GameState.Playing;

    for (const player of config.players) {
      if (player.playerIndex === config.localPlayerIndex) continue;
      const remote = createRemotePlayer(player.playerIndex, player.name, player.color);
      this.remotePlayers.set(player.playerIndex, remote);
      this.scene.add(remote.group);
    }

    this.multiplayerAuthoritativeState = this.mpRunner.getInterpolatedAuthoritativeState();
    this.world.applyAuthoritativeState(this.mpRunner.getState());
    this.applyMultiplayerAuthoritativeState(1 / 60);
    this.updateMultiplayerHud(0);
    this.setMultiplayerStatus("Match live.");
  }

  private transitionToMatchOver(reason: string) {
    if (this.matchState !== "inMatch") return;
    this.matchState = "matchOver";
    this.multiplayerMatchRequested = false;

    // BUG 3: capture authoritative final stats BEFORE tearing down the runner.
    // applyMultiplayerAuthoritativeState keeps these mirrored from the server's
    // last snapshot, so this.score / this.distance reflect what the player
    // actually achieved per server state, not a stale local prediction.
    const finalScore = Math.max(0, Math.floor(this.score));
    const finalDistance = Math.max(0, Math.floor(this.distance));
    const finalBiome = this.biomes.currentBiome.displayName;

    this.mpSnapshotUnsubscribe?.();
    this.mpSnapshotUnsubscribe = null;
    this.mpRunner?.stop();
    this.mpRunner = null;
    this.multiplayerSim = null;
    this.multiplayerConfig = null;
    this.pendingBumpEvents.length = 0;
    this.disposeRemotePlayers();

    // Mirror solo's persistent high-score tracking so MP runs feed into the
    // same career stats. (Daily-mode is solo-only — leave that key alone.)
    if (finalScore > this.highScore) {
      this.highScore = finalScore;
      try { localStorage.setItem("shatterDriftHighScore", String(finalScore)); } catch { /* ignore */ }
    }
    if (finalDistance > this.bestDistance) {
      this.bestDistance = finalDistance;
      try { localStorage.setItem("shatterDriftBestDistance", String(finalDistance)); } catch { /* ignore */ }
    }

    // BUG 3: render a results screen using the same gameOverOverlay structure
    // solo uses, so showLeaderboard's DOM hooks (#go-tab-leaderboard,
    // #go-lb-status, #lb-name-input) work without duplication.
    this.gameOverOverlay.classList.add("active");
    this.hudState.style.opacity = "0";
    this.hudState.style.display = "none";
    this.centerTitle.textContent = "MATCH ENDED";
    this.centerStats.innerHTML = `
      <div style="font-size:13px;color:#ff88aa;letter-spacing:3px;margin-bottom:10px">${reason.replace(/[<>&]/g, (c) => c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;").toUpperCase()}</div>
      <div class="go-tabs">
        <button class="go-tab active" id="go-tab-btn-stats">STATS</button>
        <button class="go-tab" id="go-tab-btn-leaderboard">LEADERBOARD</button>
      </div>
      <div id="go-tab-stats" class="go-tab-content">
        <div style="font-size:32px;margin:8px 0"><span class="highlight">${finalScore.toLocaleString()}</span></div>
        <div style="font-size:13px;color:#8899aa;margin:4px 0">${finalDistance.toLocaleString()}m</div>
        Zone: ${finalBiome}<br>
        <div style="font-size:11px;color:#668899;letter-spacing:2px;margin-top:10px">MULTIPLAYER RUN</div>
      </div>
      <div id="go-tab-leaderboard" class="go-tab-content hidden">
        <div id="go-lb-status" style="font-size:11px;color:#445566;text-align:center;margin:8px 0">Saving...</div>
      </div>
    `;
    this.centerRetry.textContent = "PRESS SPACE OR CLICK TO RETURN";
    this.centerRetry.style.cursor = "pointer";
    this.centerRetry.style.pointerEvents = "auto";
    this.centerMessage.style.opacity = "1";

    // Wire tab switching (mirrors die()'s tab-switch wiring).
    const tabBtns = document.querySelectorAll<HTMLButtonElement>(".go-tab");
    tabBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const tabName = btn.id.replace("go-tab-btn-", "");
        tabBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("go-tab-stats")?.classList.toggle("hidden", tabName !== "stats");
        document.getElementById("go-tab-leaderboard")?.classList.toggle("hidden", tabName !== "leaderboard");
      });
      btn.addEventListener("mousedown", (e) => e.stopPropagation());
      btn.addEventListener("keydown", (e) => e.stopPropagation());
    });

    // Submit score + render leaderboard. Tagged "MP" in the grade slot so MP
    // runs are distinguishable from solo on the global leaderboard.
    if (!this.mpScoreSubmitted) {
      this.mpScoreSubmitted = true;
      this.showLeaderboard(finalScore, finalDistance, "MP", finalBiome);
    }

    this.menuNav.detach();
    this.menuNavSuppressFrames = 6;
  }

  private maybeStartReadyMatch(players: LobbyPlayer[]) {
    if (this.matchState !== "inLobby" || !this.matchCoordinator || !this.meshTransport || this.multiplayerBusy) return;
    if (this.multiplayerMatchRequested) return;
    if (players.length < 2) return;
    const local = players.find((player) => player.isLocal);
    if (!local?.ready) return;
    if (!players.every((player) => player.ready)) return;
    if (this.meshTransport.getConnectedPeerIds().length < players.length - 1) {
      this.setMultiplayerStatus("Everyone is ready. Waiting for peer connections to finish.");
      return;
    }
    const started = this.matchCoordinator.requestMatchStart();
    this.multiplayerMatchRequested = true;
    this.setMultiplayerStatus(started ? "All players ready. Starting match..." : "Ready. Waiting for the host to start.");
  }

  private updateMultiplayerLobbyControls() {
    const inLobby = this.matchState === "inLobby" && !!this.lobbyClient?.getLobbyCode();
    const isHost = inLobby && (this.lobbyClient?.isHost() ?? false);
    const multiplayerActionsEl = document.getElementById("multiplayer-actions");
    const multiplayerJoinRowEl = document.getElementById("multiplayer-join-row");
    
    // Hide matchmaking row entirely when in lobby; show when not in lobby
    if (multiplayerActionsEl) multiplayerActionsEl.style.display = inLobby ? "none" : "";
    if (multiplayerJoinRowEl) multiplayerJoinRowEl.style.display = inLobby ? "none" : "";
    
    this.multiplayerReadyBtn.style.display = inLobby ? "" : "none";
    this.multiplayerReadyBtn.disabled = !inLobby || this.lobbyClient?.getPlayers().find((player) => player.isLocal)?.ready === true;
    this.multiplayerLeaveBtn.textContent = inLobby ? "LEAVE" : "BACK";
    
    // COPY LINK visible only when we're the host with an active lobby code.
    this.multiplayerCopyLinkBtn.style.display = isHost ? "" : "none";
    if (!isHost) this.multiplayerCopyLinkFallbackEl.style.display = "none";
  }

  private disposeRemotePlayers() {
    for (const remote of this.remotePlayers.values()) {
      this.scene.remove(remote.group);
      disposeRemotePlayer(remote);
    }
    this.remotePlayers.clear();
  }

  private updateMultiplayerPlaying(dt: number) {
    if (!this.mpRunner || !this.multiplayerConfig) return;

    const action = this.encodeNetworkAction();
    this.mpRunner.tickFrame(dt, action);
    if (this.matchState !== "inMatch") return;

    const state = this.mpRunner.getState();
    this.multiplayerAuthoritativeState = this.mpRunner.getInterpolatedAuthoritativeState();
    this.world.applyAuthoritativeState(state);
    this.applyMultiplayerAuthoritativeState(dt);
    this.updateMultiplayerHud(dt);

    // BUG 2: tick the post-death delay so the local crash visual + SFX
    // play before the match-over screen appears. ~1.0s feels right (long
    // enough to see the explosion, short enough to not stall the player).
    if (this.mpDeathPending) {
      this.mpDeathTimer += dt;
      if (this.mpDeathTimer >= 1.0) {
        const reason = this.mpDeathReason;
        this.mpDeathPending = false;
        this.mpDeathTimer = 0;
        this.transitionToMatchOver(reason);
      }
    }
  }

  /**
   * BUG 2 — local crash visual + SFX for MP death.
   *
   * Subset of solo `die()`'s VFX: the dramatic stuff (explosion, debris,
   * shockwave, screen flash, shake, death sound, music fade) without the
   * leaderboard / game-over UI side effects, which transitionToMatchOver owns.
   * Hides the local player avatar so the explosion reads as their crash.
   */
  private triggerMpDeathVFX(): void {
    const pos = this.player.group.position.clone();
    this.shake.trigger(1.5);
    this.explosion.trigger(pos);
    this.debris.trigger(pos, 0xff4444, 20);
    this.debris.trigger(pos, 0xff8844, 15);
    this.shockwave.trigger(pos, 0xff4444, 15, 1.0);
    this.screenFlash.trigger(0xff2222, 0.3);
    this.postfx.triggerGlitch(1.0);
    this.postfx.triggerDistort(2.0);
    this.bloomPass.strength = 2.0;
    this.vignette.setIntensity(0.8);
    this.postfx.setVignette(1.0);
    playDeath();
    fadeOutMusic();
    this.player.group.visible = false;
  }

  private applyMultiplayerAuthoritativeState(dt: number) {
    if (!this.multiplayerAuthoritativeState || !this.multiplayerConfig) return;
    const local = this.multiplayerAuthoritativeState.players[this.multiplayerConfig.localPlayerIndex];
    if (!local) return;

    this.playerZ = local.z;
    this.distance = Math.floor(local.z);
    this.score = Math.round(local.score);
    this.speed = local.speed;
    this.phaseEnergy = local.phaseEnergy;
    this.phaseLocked = local.phaseLocked;
    this.phaseMeter = local.phaseEnergy * 100;
    this.boostCooldown = local.boostCooldown;
    this.brakeCooldown = local.brakeCooldown;
    this.player.shattered = local.shattered;
    this.player.laneX = local.x;
    this.player.setShieldActive(false);
    this.player.update(dt, 0);
    this.player.group.position.z = local.z;

    for (const player of this.multiplayerAuthoritativeState.players) {
      if (player.playerIndex === this.multiplayerConfig.localPlayerIndex) continue;
      const remote = this.remotePlayers.get(player.playerIndex);
      if (!remote) continue;
      updateRemotePlayer(remote, player, dt);
    }

    const biomeChanged = this.biomes.update(this.distance);
    if (biomeChanged) {
      this.milestones.showBiomeAnnouncement(this.biomes.currentBiome.displayName);
      playBiomeTransition();
    }
    this.applyBiomeColors();
    this.world.update(dt, local.z, local.x, local.speed, local.shattered);

    this.targetFOV = this.baseFOV + Math.min(local.speed / MAX_SPEED, 1) * 12;
    this.targetCameraRoll = 0;
    const targetCam = new THREE.Vector3(local.x, this.cameraOffset.y, local.z + this.cameraOffset.z);
    this.camera.position.lerp(targetCam, 1 - Math.exp(-8 * dt));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(local.x, 0.5, local.z + 15);

    this.rimLight.position.set(local.x, 2, local.z - 3);
    this.tunnelLight.position.set(local.x, 3, local.z + 15);
    this.speedLines.update(Math.min(local.speed / MAX_SPEED, 1), 0x00ffcc);
    this.vignette.setStyle(0x000000, false, 0.8);
    this.vignette.setIntensity(Math.min(local.speed / MAX_SPEED, 1) * 0.25);

    // --- Sprint 3.3: visual + audio feedback for player bumps ---
    // pendingBumpEvents were queued in onTickAdvanced; drain them each render frame.
    while (this.pendingBumpEvents.length > 0) {
      const ev = this.pendingBumpEvents.shift()!;
      const authState = this.multiplayerAuthoritativeState!;
      const colorA = authState.players[ev.playerA]?.color ?? 0x4be1ff;
      const colorB = authState.players[ev.playerB]?.color ?? 0xff5fa2;
      // Spawn burst at contact point (y=0.5 = roughly crystal height)
      this.bumpEffect.trigger(new THREE.Vector3(ev.contactX, 0.5, ev.contactZ), colorA, colorB);
      // Screen-shake + audio only when the local player was involved
      const localInvolved =
        ev.playerA === this.multiplayerConfig!.localPlayerIndex ||
        ev.playerB === this.multiplayerConfig!.localPlayerIndex;
      if (localInvolved) {
        this.shake.trigger(0.3);
        playBump();
      }
    }
  }

  private updateMultiplayerHud(dt: number) {
    this.hudScore.textContent = this.score.toLocaleString();
    this.hudDistance.textContent = `${Math.floor(this.distance)}m`;
    this.hudSpeed.textContent = `${Math.floor(this.speed)} m/s`;
    this.hudCombo.textContent = "MULTI";
    this.hudState.textContent = this.player.shattered ? "PHASE" : "SOLID";
    this.updatePhaseHud();
    this.updateNearMissHint();
    this.updateBoostBrakeHud(dt);
  }

  private updateMultiplayerMatchOver(dt: number, menuConsumedActivate: boolean) {
    this.camera.position.y += dt * 0.2;
    const shouldReturn =
      !menuConsumedActivate &&
      this.menuNavSuppressFrames === 0 &&
      (this.input.justPressed("space") || this.input.justPressed("click"));
    if (shouldReturn) {
      void this.leaveOrCloseMultiplayer();
    }
  }

  private beginMultiplayerMatch(config: MultiplayerConfig) {
    this.transitionToMatch(config);
  }

  private hashAuthoritativeState(state: AuthoritativeStateSnapshot): string {
    const json = JSON.stringify(state);
    let hash = 0x811c9dc5;
    for (let i = 0; i < json.length; i++) {
      hash ^= json.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  // --- Playing ---

  private startGame(daily = false) {
    // --- Daily Challenge mode setup ---
    this.isDailyMode = daily;
    if (daily) {
      this.dailyDateKey = this.getDailyDateKey();
      // Each subsystem gets its own seeded RNG (offset seed) so their sequences
      // are independent — time-based event triggers won't corrupt distance-based
      // obstacle layout when players have different frame rates.
      const baseSeed = parseInt(this.dailyDateKey, 10);
      this.runSeed = baseSeed; // daily seed is deterministic (date-based)
      this.world.setRandom(seededRandom(baseSeed));
      this.powerups.setRandom(seededRandom(baseSeed + 1));
      this.speedGates.setRandom(seededRandom(baseSeed + 2));
      this.worldEvents.setRandom(seededRandom(baseSeed + 3));
      this.bossWaves.setRandom(seededRandom(baseSeed + 4));
    } else {
      // Resolve the active ghost-race target. New races flow in via the
      // pending* fields (set by the leaderboard RACE buttons just before
      // calling startGame); we copy them to current* so RETRY can replay
      // the same race. BACK TO TITLE / PLAY / DAILY clear current*.
      if (this.pendingRaceGhostId !== null) {
        this.currentRaceGhostId = this.pendingRaceGhostId;
        this.currentRaceSeed = this.pendingRaceSeed;
        this.pendingRaceGhostId = null;
        this.pendingRaceSeed = null;
      }

      // Use the active race seed if set (Race This Ghost), else generate fresh.
      // Guard against seed=0 — mulberry32 produces a degenerate sequence from 0.
      let seed = this.currentRaceSeed;
      if (seed === null) {
        do { seed = Math.floor(Math.random() * 0xffffffff); } while (seed === 0);
      }
      this.runSeed = seed;
      this.world.setRandom(seededRandom(seed));
      this.powerups.setRandom(seededRandom(seed + 1));
      this.speedGates.setRandom(seededRandom(seed + 2));
      this.worldEvents.setRandom(seededRandom(seed + 3));
      this.bossWaves.setRandom(seededRandom(seed + 4));
    }

    // Capture current camera state for the launch transition
    this.launchStartCamPos.copy(this.camera.position);
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.launchStartLookAt.copy(this.camera.position).addScaledVector(camFwd, 10);

    // Audio starts at launch so music fades in during the cinematic transition
    initAudio();
    startMusic();
    playLaunch();

    // Transition to launch state
    this.state = GameState.Launching;
    this.launchTimer = 0;
    this.launchDistortTriggered = false;

    this.score = 0;
    this.distance = 0;
    this.speed = INITIAL_SPEED;
    this.combo = 0;
    this.maxCombo = 0;
    this.comboBorderGlow.update(0, 0);
    this.playerZ = 0;
    this.playTime = 0;
    this.closeCallCount = 0;
    this.phaseStreak = 0;
    this.powerupsCollected = 0;
    this.bestPhaseStreak = 0;
    this.contracts = pickRandomContracts(3);
    this.contractHUD.hide();
    this.phaseEnergy = 1;
    this.phaseLocked = false;
    this.phaseCooldown = 0;
    this.phaseMinTimer = 0;
    this.phaseMeter = 100;
    this.grazeThrottleTimer = 0;
    this.rejectionThrottleTimer = 0;
    this.meterFlashTimer = 0;
    this.meterRejectionTimer = 0;
    this.nearMissHintObstacleTimer = 0;
    this.phaseTimeAccum = 0;
    this.phaseBonusFlashTimer = 0;
    this.phaseBonusFlashValue = 1;
    this.riftFlip = createRiftFlipState();
    this.riftFlipLerp = 0;
    this.riftWarningTimer = 0;
    this.boostTimer = 0;
    this.boostCooldown = 0;
    this.brakeTimer = 0;
    this.brakeCooldown = 0;
    this.prevBoostCooldown = 0;
    this.prevBrakeCooldown = 0;
    this.speedMod = 1;
    if (this.riftWarningEl) this.riftWarningEl.style.opacity = "0";
    this.player.laneX = 0;
    this.player.shattered = false;
    this.slowMoFactor = 1;
    this.slowMoTimer = 0;
    this.fovBoost = 0;
    this.cameraZKick = 0;
    this.targetFOV = 60; // launch starts narrow
    this.currentFOV = 60;
    this.targetCameraRoll = 0;
    this.cameraRoll = 0;
    this.skillFactor = this.runHistory.getSkillFactor();
    this.personalBestTarget = Math.max(this.bestDistance, this.runHistory.getBestDistance());
    this.personalBestStage = 0;
    this.personalBestTriggered = false;

    // Reset systems
    this.world.reset();
    this.biomes.reset();
    this.powerups.reset();
    this.milestones.reset();
    this.bossWaves.reset();
    this.speedGates.reset();
    this.worldEvents.reset();
    this.challenges.resetRun();

    // Reset scene to first biome
    this.applyBiomeColors();

    // Apply selected cosmetics and ensure player is visible
    this.player.applySkin(this.unlocks.getSelectedCrystal());
    this.player.group.visible = true;
    this.updatePhaseHud();
    this.updateNearMissHint();
    this.onnxAgent?.reset();

    // Hide title + customize immediately; HUD revealed when launch completes
    this.hud.classList.add("hidden");
    this.titleOverlay.classList.add("hidden");
    this.customizePanel.classList.add("hidden");
    this.customizeOpen = false;
    // Detach menu nav for gameplay — buttons aren't on screen, no cursor
    // should be tracking. Suppress activation cleanup to keep mash-Enter
    // from leaking into shatter input on frame 0 of Launching.
    this.menuNav.detach();
    this.menuNavSuppressFrames = 4;
    this.centerMessage.style.opacity = "0";
    // Clear blur overlay, game-over class, and game-over content from previous game over
    this.gameOverOverlay.classList.remove("active");
    this.hud.classList.remove("is-gameover");
    document.body.classList.remove("is-gameover");
    this.centerMessage.classList.remove("is-gameover");
    if (this.centerStats) this.centerStats.innerHTML = "";
    // Clear warn vignette from previous run
    this.hudPhaseWarnVignette.style.opacity = "0";
    this.hudPhaseWarnVignette.style.boxShadow = "none";
    // Reset combo-border so any leftover break-flash from a previous run
    // doesn't paint orange-red edges on the new launch.
    this.comboBorderGlow.reset();
    // Restore HUD state indicator
    this.hudState.style.display = "";

    // Start recording after launch completes
    if (this.recorder && !this.recorder.isRecording) {
      setTimeout(() => {
        this.recorder?.start(this.renderer.domElement);
      }, 2000);
    }

    // Ghost racing — single-ghost model only.
    // Race active: load the one selected ghost so it spawns and renders.
    // No race: load no ghosts (a normal run is just the player).
    // The legacy "load top 3 ghosts as ambient racers" behaviour was
    // removed — those ghosts ran on a different seed than the live run,
    // so they were random runs through unrelated obstacles, not a race.
    if (this.currentRaceGhostId !== null) {
      const target = this.cachedGhosts.find(g => g.id === this.currentRaceGhostId);
      if (target) {
        this.ghostManager.loadGhosts([target]);
        this.racingGhostName = target.name;
      } else {
        // Cached ghost list refreshed and the chosen one fell off — bail to
        // a normal run rather than ghosting silently.
        this.ghostManager.loadGhosts([]);
        this.racingGhostName = null;
        this.currentRaceGhostId = null;
        this.currentRaceSeed = null;
      }
    } else {
      this.ghostManager.loadGhosts([]);
      this.racingGhostName = null;
    }
    this.ghostManager.startRun();
    this.ghostRecorder.start();
  }

  private updateLaunching(dt: number) {
    this.launchTimer += dt;
    const rawT = Math.min(this.launchTimer / this.launchDuration, 1);
    const easedT = ease.inOutCubic(rawT);

    // Player moves forward at initial speed — no lateral input
    this.playerZ += this.speed * dt;
    this.distance = Math.floor(this.playerZ);
    this.player.update(dt, 0);
    this.player.group.position.set(0, 0, this.playerZ);

    // World generates obstacles so the scene is live
    this.world.update(dt, this.playerZ, 0, this.speed, false);

    // Camera: smooth interpolation from orbit position to gameplay position
    const endCamPos = new THREE.Vector3(0, this.cameraOffset.y, this.playerZ + this.cameraOffset.z);
    const endLookAt = new THREE.Vector3(0, 0.5, this.playerZ + 15);

    this.camera.position.lerpVectors(this.launchStartCamPos, endCamPos, easedT);
    const lookAt = new THREE.Vector3().lerpVectors(this.launchStartLookAt, endLookAt, easedT);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(lookAt);

    // FOV: widen from 60 → 75 in first 70%, then snap back to baseFOV in last 30%
    let launchFOV: number;
    if (rawT <= 0.7) {
      launchFOV = 60 + (rawT / 0.7) * 15;
    } else {
      launchFOV = 75 - ((rawT - 0.7) / 0.3) * (75 - this.baseFOV);
    }
    // Bypass the normal FOV lerp by pinning both target and current
    this.targetFOV = launchFOV;
    this.currentFOV = launchFOV;

    // Speed lines ramp from 0 → full (mapped so they start appearing partway through)
    this.speedLines.update(0.6 + rawT * 0.4, 0x00ffcc);

    // Bloom builds up during launch
    this.bloomPass.strength = 1.0 + rawT * 0.8;

    // Move lights with player
    this.rimLight.position.set(0, 2, this.playerZ - 3);
    this.tunnelLight.position.set(0, 3, this.playerZ + 15);

    // Distort at midpoint — warp effect
    if (!this.launchDistortTriggered && rawT >= 0.5) {
      this.launchDistortTriggered = true;
      this.postfx.triggerDistort(0.5);
    }

    // Music and ambient during launch
    updateAmbient(this.speed, true);
    updateMusic(dt, this.speed, false);

    // Launch complete
    if (rawT >= 1.0) {
      // Screen flash white/cyan + bloom surge
      this.screenFlash.trigger(0x88ffff, 0.3);
      this.bloomPass.strength = 2.5;

      // Snap camera to exact gameplay position for clean handoff to updatePlaying
      this.camera.position.set(0, this.cameraOffset.y, this.playerZ + this.cameraOffset.z);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 0.5, this.playerZ + 15);
      this.targetFOV = this.baseFOV;
      this.currentFOV = this.baseFOV;

      // Reveal HUD
      this.hud.classList.remove("hidden");
      this.contractHUD.show();
      this.updateRaceChip();

      // Daily banner
      if (this.dailyBanner) {
        if (this.isDailyMode) {
          this.dailyBanner.textContent = `DAILY CHALLENGE — ${this.formatDailyDate(this.dailyDateKey)}`;
          this.dailyBanner.classList.remove("hidden");
        } else {
          this.dailyBanner.classList.add("hidden");
        }
      }

      // Tutorial for first-time players
      if (!this.demoMode) {
        this.tutorial.startIfNeeded();
      }

      this.state = GameState.Playing;
    }
  }

  private updatePlaying(dt: number) {
    this.playTime += dt;
    if (this.phaseBonusFlashTimer > 0) {
      this.phaseBonusFlashTimer -= dt;
    }

    // Piecewise speed ramp — gentle in early biomes, punishing in later ones
    this.speed = this.computeSpeed(this.distance);

    // Boost / brake speed mod — human mode only (ONNX/autopilot never trigger these)
    if (!this.onnxMode && !this.autopilot) {
      this.updateSpeedMod(dt, this.input.isBoostDown(), this.input.isBrakeDown());
    }
    this.speed *= this.speedMod;

    // Move forward
    this.playerZ += this.speed * dt;
    this.distance = Math.floor(this.playerZ);

    // Player input (ONNX, autopilot, or human)
    let moveX: number;
    let shatterInput: boolean;

    if (this.onnxMode && this.onnxAgent) {
      // Build boss wave obstacles for the agent — boss parts are animated THREE.js objects
      // that live outside this.world.obstacles; merge them so the agent can see them.
      const bossObstacles: Obstacle[] = [];
      for (const wave of this.bossWaves.waves) {
        if (!wave.active) continue;
        for (const part of wave.parts) {
          const worldPos = new THREE.Vector3();
          part.mesh.getWorldPosition(worldPos);
          bossObstacles.push({
            mesh: part.mesh,
            z: worldPos.z,
            halfWidth: part.halfWidth,
            halfHeight: 0.8,
            x: worldPos.x,
            isGate: false,
            gapX: 0,
            gapHalfWidth: 0,
            active: true,
            partiallyShattered: false,
          });
        }
      }

      const action = this.onnxAgent.update({
        playerX: this.player.group.position.x,
        playerZ: this.playerZ,
        speed: this.speed,
        shattered: this.player.shattered,
        phaseEnergy: this.phaseEnergy,
        phaseLocked: this.phaseLocked,
        phaseCooldown: this.phaseCooldown,
        obstacles: [...this.world.obstacles, ...bossObstacles],
      });
      // Actions 0-5: idle, left, right, shatter, shatter+left, shatter+right
      moveX = (action === 1 || action === 4) ? -1 : (action === 2 || action === 5) ? 1 : 0;
      shatterInput = action >= 3;
    } else if (this.autopilot) {
      const ai = this.autopilot.update(
        this.player.group.position.x,
        this.playerZ,
        this.speed,
        this.world
      );
      // Autopilot already works in world space — no negation needed
      moveX = ai.moveX;
      shatterInput = ai.shatter;
    } else {
      const move = this.input.getMovement();
      moveX = -move.x; // negate: camera faces +Z so screen-right is world -X
      shatterInput = this.input.isDown("space") || this.input.isDown("click");
    }

    const wasShattered = this.wasShattered;

    // Tick throttle timers
    if (this.grazeThrottleTimer > 0) this.grazeThrottleTimer = Math.max(0, this.grazeThrottleTimer - dt);
    if (this.rejectionThrottleTimer > 0) this.rejectionThrottleTimer = Math.max(0, this.rejectionThrottleTimer - dt);
    if (this.meterFlashTimer > 0) this.meterFlashTimer = Math.max(0, this.meterFlashTimer - dt);
    if (this.meterRejectionTimer > 0) this.meterRejectionTimer = Math.max(0, this.meterRejectionTimer - dt);

    // --- Graze detection: fills phaseMeter while skimming obstacles (not while phased) ---
    if (!this.player.shattered) {
      const grazeDist = this.checkGrazeProximity();
      if (grazeDist > 0 && grazeDist < GRAZE_BAND) {
        this.phaseMeter = Math.min(100, this.phaseMeter + GRAZE_FILL_RATE * dt);
        if (this.grazeThrottleTimer <= 0) {
          // Cyan spark puff at player position
          this.trail.emit(
            new THREE.Vector3(this.player.group.position.x, 0.5, this.playerZ),
            4, 0.5
          );
          playGrazeWhoosh();
          this.grazeThrottleTimer = 0.18; // ~5 times/sec max
          // Flash meter bar and show NEAR MISS +15 float
          this.meterFlashTimer = 0.15;
          this.popups.showAt3D(
            "NEAR MISS +15", this.player.group.position.x, this.playerZ, this.camera,
            "#00ccff", 14
          );
          // Particle stream from player → graze bar. Intensity scales with how
          // close the miss was: razor-thin = full burst, edge of band = trickle.
          const intensity = 1 - grazeDist / GRAZE_BAND;
          this.emitGrazeParticles(intensity);
        }
      }

      // Near-miss hint proximity tracking: obstacle within 1.5× graze band keeps hint alive for 2s
      if (this.phaseMeter < 30 && grazeDist < GRAZE_BAND * 1.5) {
        this.nearMissHintObstacleTimer = 2.0;
      } else {
        this.nearMissHintObstacleTimer = Math.max(0, this.nearMissHintObstacleTimer - dt);
      }
    } else {
      // While phased, drain the hint timer (can't graze while shattered)
      this.nearMissHintObstacleTimer = Math.max(0, this.nearMissHintObstacleTimer - dt);
    }

    // Tick post-shatter cooldown
    if (this.phaseCooldown > 0) {
      this.phaseCooldown = Math.max(0, this.phaseCooldown - dt);
    }

    // Tick minimum-duration lock
    if (this.phaseMinTimer > 0) {
      this.phaseMinTimer = Math.max(0, this.phaseMinTimer - dt);
    }

    // Rejection feedback: Space pressed but graze meter too low (only on fresh activation attempts)
    const hasMeterForPhase = this.phaseMeter >= GRAZE_PHASE_COST;
    if (!wasShattered && shatterInput && !this.phaseLocked && this.phaseCooldown <= 0 && !hasMeterForPhase && this.rejectionThrottleTimer <= 0) {
      playPhaseRejected();
      this.rejectionThrottleTimer = 0.5;
      this.meterRejectionTimer = 0.3; // red meter flash
    }

    // Phase stays active while min-duration timer is running OR input is held AND (already phasing OR meter available for fresh activation)
    // Meter only gates ACTIVATION; once phasing, sustain on energy alone until input released or energy depleted.
    const wantsToPhase = shatterInput && !this.phaseLocked && this.phaseCooldown <= 0 && (wasShattered || hasMeterForPhase);
    const forcedByMinTimer = this.phaseMinTimer > 0 && !this.phaseLocked;
    const isPhasing = (wantsToPhase || forcedByMinTimer) && this.phaseEnergy > 0;

    if (isPhasing) {
      this.phaseEnergy = Math.max(0, this.phaseEnergy - PHASE_DRAIN_RATE * dt);
    } else {
      this.phaseEnergy = Math.min(1, this.phaseEnergy + PHASE_RECHARGE_RATE * dt);
    }

    if (this.phaseEnergy <= 0) {
      this.phaseEnergy = 0;
      this.phaseLocked = true;
      this.phaseMinTimer = 0;
      this.player.shattered = false;
    } else if (this.phaseLocked && this.phaseEnergy >= PHASE_MIN_THRESHOLD) {
      this.phaseLocked = false;
    }

    this.player.shattered = isPhasing && !this.phaseLocked && this.phaseEnergy > 0;

    // Start post-shatter cooldown when phase ends
    if (wasShattered && !this.player.shattered) {
      this.phaseCooldown = PHASE_POST_COOLDOWN;
    }
    const isShattered = this.player.shattered;

    // Shield visual indicator
    this.player.setShieldActive(this.powerups.hasActivePowerUp(PowerUpType.Shield));

    // On fresh activation: consume graze meter, apply activation cost, start min-duration lock
    if (isShattered && !wasShattered) {
      this.phaseMeter = Math.max(0, this.phaseMeter - GRAZE_PHASE_COST);
      this.phaseEnergy = Math.max(0, this.phaseEnergy - PHASE_ACTIVATION_COST);
      this.phaseMinTimer = PHASE_MIN_DURATION;
      if (this.phaseEnergy <= 0) {
        this.phaseEnergy = 0;
        this.phaseLocked = true;
        this.phaseMinTimer = 0;
        this.player.shattered = false;
      }
      playShatter();
      // Energy pulse on entering phase mode
      this.postfx.triggerDistort(0.3);
      this.shockwave.trigger(
        new THREE.Vector3(this.player.group.position.x, 0.5, this.playerZ),
        0xff44ff, 3, 0.3
      );
    }
    if (!isShattered && wasShattered) {
      const phaseMultiplier = this.getPhaseMultiplier();
      playRecombine(phaseMultiplier);
      // Snap-back effect on recombining
      this.postfx.triggerDistort(0.2);
      // Reset phase streak when recombining
      if (this.phaseStreak > 0) {
        this.phaseStreak = 0;
      }
      if (phaseMultiplier > 1.05 && !this.phaseLocked) {
        this.phaseBonusFlashValue = phaseMultiplier;
        this.phaseBonusFlashTimer = 1.1;
        this.popups.showCenter(
          `${phaseMultiplier.toFixed(1)}x PHASE BONUS`,
          "LOCKED IN",
          "#ff88ff"
        );
      }
      this.phaseTimeAccum = 0;
    }
    this.wasShattered = isShattered;

    // Update player
    this.player.update(dt, moveX);
    this.player.group.position.z = this.playerZ;

    // Ghost racing — sample player state and advance ghost playback
    this.ghostRecorder.sample(
      this.player.group.position.x,
      this.playerZ,
      this.speed,
      this.player.shattered
    );
    this.ghostManager.update(dt);

    // World difficulty is now fully biome-driven (see world.ts)

    // Update world
    this.world.update(dt, this.playerZ, this.player.group.position.x, this.speed, this.player.shattered);

    // Update biomes
    const biomeChanged = this.biomes.update(this.distance);
    if (biomeChanged) {
      this.milestones.showBiomeAnnouncement(this.biomes.currentBiome.displayName);
      playBiomeTransition();
      this.shake.trigger(0.3);
      // Epic shockwave on biome transition
      this.shockwave.trigger(
        new THREE.Vector3(this.player.group.position.x, 0, this.playerZ),
        this.biomes.colors.playerTrail, 15, 1.0
      );
      this.screenFlash.trigger(this.biomes.colors.playerTrail, 0.25);
      // PostFX: biome transition distortion
      this.postfx.triggerDistort(0.8);

      // Zone completion bonus — reward for reaching the next biome
      const zoneBonus = 1000 * this.biomes.biomeIndex;
      this.score += zoneBonus;
      setTimeout(() => {
        this.popups.showCenter(
          "ZONE CLEAR",
          `+${zoneBonus.toLocaleString()}`,
          "#" + this.biomes.colors.playerTrail.toString(16).padStart(6, "0")
        );
      }, 800); // slight delay so biome name shows first
    }
    this.applyBiomeColors();

    // Cosmic Rift gravity-flip zones — visual inversion every ~150m inside
    // biome 4. Never fires mid-phase (wouldn't be fair). Camera.up interpolates
    // smoothly between upright and inverted so the transition doesn't snap.
    const canTriggerFlip = !this.player.shattered;
    const riftEvents = updateRiftFlip(
      this.riftFlip,
      dt,
      this.playerZ,
      this.biomes.biomeIndex,
      canTriggerFlip,
      Math.random,
    );
    for (const ev of riftEvents) {
      if (ev.type === "rift_flip_warning") {
        this.riftWarningTimer = 1.5;
        if (this.riftWarningEl) this.riftWarningEl.style.opacity = "1";
        this.postfx.triggerDistort(0.3);
      } else if (ev.type === "rift_flip_start") {
        this.riftWarningTimer = 0;
        if (this.riftWarningEl) this.riftWarningEl.style.opacity = "0";
        this.screenFlash.trigger(0xff44ff, 0.25);
        this.postfx.triggerDistort(0.6);
        this.shake.trigger(0.2);
      } else if (ev.type === "rift_flip_end") {
        this.screenFlash.trigger(0xff44ff, 0.2);
        this.postfx.triggerDistort(0.5);
      }
    }
    // Drive HUD warning pulse: fade out after timer expires
    if (this.riftWarningTimer > 0) {
      this.riftWarningTimer = Math.max(0, this.riftWarningTimer - dt);
      if (this.riftWarningEl) {
        // Pulse opacity 0.5–1.0 every 0.3s during warning
        const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this.riftWarningTimer * Math.PI * 3));
        this.riftWarningEl.style.opacity = String(pulse);
      }
      if (this.riftWarningTimer === 0 && this.riftFlip.phase !== "warning" && this.riftWarningEl) {
        this.riftWarningEl.style.opacity = "0";
      }
    }
    // Smooth camera-up flip: lerp to 1 when active, 0 otherwise.
    const targetFlipLerp = this.riftFlip.phase === "active" ? 1 : 0;
    this.riftFlipLerp = THREE.MathUtils.lerp(
      this.riftFlipLerp,
      targetFlipLerp,
      1 - Math.exp(-6 * dt),
    );

    // Update power-ups
    this.powerups.update(dt, this.playerZ, this.player.group.position.x);

    // Update boss waves
    this.bossWaves.update(dt, this.playerZ);

    // Update speed gates
    const gateResult = this.speedGates.update(dt, this.playerZ, this.player.group.position.x);
    if (gateResult.justCollected) {
      this.speedGates.applyBoost(gateResult.boostAmount);
      this.fovBoost = Math.max(this.fovBoost, 8);
      playSpeedBoost();
      this.shake.trigger(0.6);
      this.screenFlash.trigger(0x00ffff, 0.2);
      this.postfx.triggerDistort(0.7);
      // Dramatic shockwave at gate position
      if (gateResult.gatePosition) {
        this.shockwave.trigger(gateResult.gatePosition, 0x00ffff, 8, 0.7);
      }
      // Score bonus
      const boostScore = Math.floor(gateResult.boostAmount * 50);
      this.score += boostScore;
      this.popups.showAt3D(
        `BOOST +${boostScore}`, this.player.group.position.x, this.playerZ, this.camera,
        "#00ffff", 24
      );
      this.milestones.showPowerUpAnnouncement("SPEED BOOST");
    }

    // Apply speed gate boost
    const gateBoost = this.speedGates.getBoostSpeed();
    if (gateBoost > 0) {
      this.speed = Math.min(MAX_SPEED + 15, this.speed + gateBoost); // can exceed MAX temporarily
    }
    if (this.fovBoost > 0) {
      this.fovBoost = Math.max(0, this.fovBoost - 16 * dt);
    }

    // Update world events
    const eventResult = this.worldEvents.update(dt, this.playerZ);
    if (eventResult.eventName) {
      playWorldEvent();
      // Announce event
      const eventNames: Record<string, string> = {
        cosmic_ripple: "COSMIC RIPPLE",
        crystal_rain: "CRYSTAL RAIN",
        data_storm: "DATA STORM",
        meteor_shower: "METEOR SHOWER",
        aurora_burst: "AURORA BURST",
      };
      const name = eventNames[eventResult.eventName] || eventResult.eventName;
      this.popups.showCenter(name, "", "#ffffff");
    }

    // Apply event effects to bloom and FOV
    const comboBloom = Math.min(this.combo, COMBO_MAX) * 0.03; // combo intensifies bloom
    this.bloomPass.strength = this.biomes.colors.bloomStrength + this.worldEvents.getBloomBoost() + comboBloom;
    this.targetFOV += this.worldEvents.getFOVPulse();

    // Update challenges
    this.challenges.updateRun({
      distance: this.distance,
      score: this.score,
      phaseStreak: this.phaseStreak,
      maxCombo: this.maxCombo,
      closeCallCount: this.closeCallCount,
      biomeIndex: this.biomes.biomeIndex,
      speed: this.speed,
      isPhasing: this.player.shattered,
    });

    // Check for newly completed challenges
    const completions = this.challenges.popCompletions();
    for (const challenge of completions) {
      playChallengeComplete();
      this.screenFlash.trigger(0xffcc00, 0.3);
      this.shake.trigger(0.5);
      this.postfx.triggerDistort(0.6);
      this.popups.showCenter(
        "CHALLENGE COMPLETE",
        challenge.name,
        "#ffcc00"
      );
    }

    // Boss warning display
    if (this.bossWaves.warningActive) {
      this.hudBossWarning.textContent = this.bossWaves.warningText;
      this.hudBossWarning.style.opacity = String(0.5 + Math.sin(performance.now() * 0.01) * 0.5);
    } else {
      this.hudBossWarning.style.opacity = "0";
    }

    // Check milestones
    this.milestones.check(this.distance, this.score, this.combo, this.speed);

    // Camera FOV — increases with speed for rush feeling
    const speedNorm = Math.min(this.speed / MAX_SPEED, 1);
    const comboFOVBoost = Math.min(this.combo, COMBO_MAX) * 0.5; // combo widens FOV slightly
    const phaseNarrow = this.player.shattered ? -3 : 0; // tighter FOV while phasing = focus effect
    const speedFOV = this.baseFOV + speedNorm * 18;
    this.targetFOV = speedFOV + comboFOVBoost + phaseNarrow + this.fovBoost;

    // Camera roll on lateral movement (subtle)
    this.targetCameraRoll = -moveX * 0.03;

    // Trail particles — use unlocked trail or biome default
    const time = performance.now() * 0.001;
    const unlockTrailColor = this.unlocks.getTrailColor(time);
    const biomeTrailColor = this.biomes.colors.playerTrail;
    const baseTrailColor = unlockTrailColor !== 0x00ffcc ? unlockTrailColor : biomeTrailColor;
    const trailColor = this.player.shattered ? 0xff44ff : baseTrailColor;
    const trailSize = this.unlocks.getTrailSize();
    this.trail.setColor(trailColor);
    this.trail.emit(
      new THREE.Vector3(this.player.group.position.x, 0, this.playerZ - 0.5),
      (this.player.shattered ? 3 : 1) * trailSize,
      (this.player.shattered ? 1.5 : 0.3) * trailSize
    );

    // Combo fire — energy particles rise upward at high combo
    if (this.combo >= 5 && !this.player.shattered) {
      const comboFire = Math.min(this.combo, COMBO_MAX) - 4; // 1-6 intensity
      const fireColor = this.combo >= 8 ? 0xff4400 : 0xffcc00;
      this.trail.setColor(fireColor);
      this.trail.emit(
        new THREE.Vector3(
          this.player.group.position.x + (Math.random() - 0.5) * 0.5,
          0.8 + Math.random() * 0.5,
          this.playerZ
        ),
        comboFire, // more particles at higher combo
        0.8
      );
      // Reset trail color for main trail
      this.trail.setColor(trailColor);
    }

    // Ribbon trail — smooth flowing ribbon behind player
    const ribbonWidth = this.player.shattered ? 0.5 : 0.2 + speedNorm * 0.3;
    this.ribbon.setColor(trailColor);
    this.ribbon.setOpacity(this.player.shattered ? 0.6 : 0.35 + speedNorm * 0.15);
    this.ribbon.addPoint(
      new THREE.Vector3(this.player.group.position.x, 0.3, this.playerZ - 0.3),
      ribbonWidth
    );
    this.ribbon.update(dt);

    // Afterimage trail — ghostly copies at high speed
    this.afterimage.setIntensity(this.speed / MAX_SPEED);
    this.afterimage.setColor(trailColor);
    this.afterimage.update(
      dt,
      this.player.group.position,
      this.player.crystalMesh.rotation,
      this.player.shattered
    );

    // Extra trail during speed boost
    if (this.speedGates.isBoosting()) {
      this.trail.emit(
        new THREE.Vector3(this.player.group.position.x + (Math.random() - 0.5) * 0.5, 0.5, this.playerZ - 1),
        4,
        2.0
      );
    }

    if (this.player.shattered) {
      this.phaseTimeAccum += dt;
    }

    this.updatePersonalBestDrama();

    // Vignette — stronger at high speed and during transitions
    const vignetteTarget = speedNorm * 0.4 + (this.biomes.isTransitioning ? 0.3 : 0);
    if (this.personalBestStage >= 4) {
      this.vignette.setStyle(0xc8f6ff, true, 0.8);
      this.vignette.setIntensity(0.28);
    } else if (this.personalBestStage >= 2) {
      this.vignette.setStyle(0xf4f6ff, true, 0.65);
      this.vignette.setIntensity(0.16 + (this.personalBestStage - 2) * 0.05);
    } else {
      this.vignette.setStyle(0x000000, false, 0.8);
      this.vignette.setIntensity(vignetteTarget);
    }


    // Power-up collection (works in any state)
    const collectedPU = this.powerups.checkCollection(
      this.player.group.position.x,
      this.playerZ,
      0.8
    );
    if (collectedPU) {
      this.powerups.activatePowerUp(collectedPU.type);
      this.powerupsCollected++;
      const config = this.powerups.getConfig(collectedPU.type);
      this.screenFlash.trigger(config.color, 0.2);
      playPowerUp();
      this.milestones.showPowerUpAnnouncement(
        collectedPU.type.toUpperCase()
      );
      // Shockwave on power-up collection
      this.shockwave.trigger(
        new THREE.Vector3(this.player.group.position.x, 0, this.playerZ),
        config.color, 5, 0.6
      );
      // Score popup for power-up
      const puLabel = collectedPU.type.toUpperCase();
      const colorHex = "#" + config.color.toString(16).padStart(6, "0");
      this.popups.showAt3D(
        puLabel, this.player.group.position.x, this.playerZ, this.camera,
        colorHex, 28
      );
    }

    // Magnet effect — attract orbs when magnet is active
    if (this.powerups.hasActivePowerUp(PowerUpType.Magnet)) {
      this.world.attractOrbs(this.player.group.position.x, this.playerZ, 6, dt);
    }

    // Collision detection — grace period: don't collide until recombine animation is mostly done
    const isInvulnerable = this.player.shattered || this.player.shatterT > 0.15;
    if (!isInvulnerable) {
      // Check obstacle collision (only when solid and visually recombined)
      const hit = this.world.checkObstacleCollision(
        this.player.group.position.x,
        this.playerZ,
        this.player.getCollisionRadius()
      );
      // Check boss wave collision
      const bossHit = this.bossWaves.checkCollision(
        this.player.group.position.x,
        this.playerZ,
        this.player.getCollisionRadius()
      );
      if (hit || bossHit) {
        // Shield absorbs one hit
        if (this.powerups.consumeShield()) {
          this.shake.trigger(0.8);
          this.screenFlash.trigger(0x44aaff, 0.3);
          this.postfx.triggerDistort(0.6);
          this.postfx.triggerGlitch(0.3);
          playShieldBreak();
          this.player.setShieldActive(false);
          // Remove the regular obstacle that was hit (boss parts persist)
          if (hit) {
            this.world.shatterObstacle(hit, this.player.group.position.x, this.playerZ, this.speed);
            playWallBreak();
          }
        } else {
          this.die();
          return;
        }
      }

      // Check orb collection (only when solid)
      const collected = this.world.checkOrbCollection(
        this.player.group.position.x,
        this.playerZ,
        0.8
      );
      for (const orb of collected) {
        this.combo++;
        if (this.combo > this.maxCombo) this.maxCombo = this.combo;
        const multiplier = Math.min(this.combo, COMBO_MAX);
        const puMultiplier = this.powerups.getScoreMultiplier();
        const orbPoints = ORB_SCORE * multiplier * puMultiplier;
        this.score += orbPoints;
        playCollect(this.combo);
        this.collectFlash.trigger(
          new THREE.Vector3(orb.x, orb.y, orb.z)
        );

        // Emit gem→score particle trail (yellow/orange)
        const orbWorldPos = new THREE.Vector3(orb.x, orb.y, orb.z);
        orbWorldPos.project(this.camera);
        const bodyRect = document.body.getBoundingClientRect();
        const orbScreenX = (orbWorldPos.x * 0.5 + 0.5) * bodyRect.width;
        const orbScreenY = (-orbWorldPos.y * 0.5 + 0.5) * bodyRect.height;
        // Scale intensity with combo (0 at combo 1, 1 at combo 10) → particle count 4..8
        const comboIntensity = Math.min(1, (this.combo - 1) / 9);
        this.scoreStream.emit(orbScreenX, orbScreenY, comboIntensity);

        // Score flash effect on big combos (no per-crystal popup — too noisy)
        // Note: score element pulse is handled by scoreStream arrival pulse; no manual scale needed.
        if (this.combo >= 5) {
          // PostFX distort on high combos
          this.postfx.triggerDistort(0.2 + Math.min(this.combo, COMBO_MAX) * 0.03);
        }

        // Shockwave ring at combo milestones — only x5 and x10
        if (this.combo === 5) {
          this.shockwave.trigger(
            new THREE.Vector3(orb.x, 0, orb.z),
            0xffcc00, 5, 0.5
          );
          this.screenFlash.trigger(0xffaa00, 0.1);
          this.popups.showCenter("COMBO x5", "", "#ffaa00");
        } else if (this.combo === 10) {
          // Max combo — huge celebration
          this.shockwave.trigger(
            new THREE.Vector3(orb.x, 0, orb.z),
            0xff4444, 10, 0.8
          );
          this.screenFlash.trigger(0xff4444, 0.2);
          this.shake.trigger(0.5);
          this.postfx.triggerDistort(0.6);
          this.debris.trigger(
            new THREE.Vector3(this.player.group.position.x, 1, this.playerZ),
            0xffcc00, 20
          );
          this.popups.showCenter("MAX COMBO", "LEGENDARY", "#ff4444");
        }
      }
    } else {
      // Check close calls while shattered (regular obstacles + boss parts)
      const regularCloseCall = this.world.checkCloseCall(this.player.group.position.x, this.playerZ);
      const bossCloseCall = this.bossWaves.checkCloseCall(this.player.group.position.x, this.playerZ);
      if (regularCloseCall || bossCloseCall) {
        // Shatter the obstacle we phased through
        if (regularCloseCall) {
          this.world.shatterObstacle(
            regularCloseCall,
            this.player.group.position.x,
            this.playerZ,
            this.speed
          );
          playWallBreak();
        }
        if (this.playerZ - this.lastCloseCall > 3) {
          this.phaseStreak++;
          if (this.phaseStreak > this.bestPhaseStreak) {
            this.bestPhaseStreak = this.phaseStreak;
          }
          const streakBonus = this.phaseStreakMultiplier(this.phaseStreak); // tiered ×2/×3/×5/×10
          const puMultiplier = this.powerups.getScoreMultiplier();
          const phaseMultiplier = this.getPhaseMultiplier();
          const closeCallPoints = Math.round(CLOSE_CALL_SCORE * streakBonus * puMultiplier * phaseMultiplier);
          this.score += closeCallPoints;
          this.lastCloseCall = this.playerZ;
          this.closeCallCount++;
          playCloseCall();
          this.milestones.registerCloseCall();

          // Near-miss bonus: +25 score (visual flash is enough feedback, no popup)
          const nearMissPoints = Math.round(25 * phaseMultiplier);
          this.score += nearMissPoints;
          this.postfx.triggerDistort(0.3);

          // Brief slow-mo on close calls for dramatic effect
          this.slowMoFactor = 0.3;
          this.slowMoTimer = 0.15;

          // PostFX: distortion pulse on phase-through
          this.postfx.triggerDistort(0.5 + streakBonus * 0.15);

          // Particle burst at close call location
          this.trail.emit(
            new THREE.Vector3(this.player.group.position.x, 0.5, this.playerZ),
            8, 2.0
          );

          // Vertical shockwave ring (through the obstacle!)
          this.shockwave.triggerVertical(
            new THREE.Vector3(this.player.group.position.x, 1, this.playerZ),
            0xff44ff, 3 + streakBonus, 0.4
          );

          // Debris burst — pieces scatter as you phase through!
          const debrisColor = this.biomes.colors.obstacleEdge;
          this.debris.trigger(
            new THREE.Vector3(this.player.group.position.x, 0.8, this.playerZ),
            debrisColor, 8 + streakBonus * 3
          );

          // Tier-up juice — fires only when streak crosses a new multiplier boundary
          const prevTier = this.phaseStreakMultiplier(this.phaseStreak - 1);
          if (streakBonus > prevTier) {
            this.firePhaseTierUp(streakBonus);
          }
        }
      }
      // Shattering breaks combo (unless HyperPhase is active)
      if (!this.powerups.hasActivePowerUp(PowerUpType.HyperPhase)) {
        this.combo = 0;
      }
    }

    // Distance score with power-up multiplier
    const puMultiplier = this.powerups.getScoreMultiplier();
    this.score += Math.floor(this.speed * dt * puMultiplier);

    // Camera follows player
    const targetCamPos = new THREE.Vector3(
      this.player.group.position.x * 0.3,
      this.cameraOffset.y,
      this.playerZ + this.cameraOffset.z + this.cameraZKick
    );
    this.camera.position.lerp(targetCamPos, 1 - Math.exp(-5 * dt));
    // Decay the Z-kick over ~150ms
    this.cameraZKick *= Math.exp(-dt / 0.15);
    if (Math.abs(this.cameraZKick) < 0.01) this.cameraZKick = 0;
    // Keep up vector constant, apply roll via quaternion to avoid Euler gimbal ambiguity.
    // Cosmic Rift gravity-flip: lerp up vector Y from +1 (upright) to -1 (inverted)
    // while the flip zone is active. Gameplay math (collisions, player X) is unchanged —
    // only visuals invert. Use 1 - 2*lerp so 0→+1 and 1→-1.
    const upY = 1 - 2 * this.riftFlipLerp;
    this.camera.up.set(0, upY, 0);
    this.camera.lookAt(
      this.player.group.position.x * 0.5,
      0.5,
      this.playerZ + 15
    );
    // rotateZ applies roll around the camera's local Z (view axis) using quaternions,
    // bypassing the Euler decomposition that can flip the world when facing +Z
    if (Math.abs(this.cameraRoll) > 0.0001) {
      this.camera.rotateZ(this.cameraRoll);
    }

    // Move tunnel and rim lights with player
    this.rimLight.position.set(this.player.group.position.x, 2, this.playerZ - 3);
    this.tunnelLight.position.set(this.player.group.position.x * 0.5, 3, this.playerZ + 15);
    this.tunnelLight.color.setHex(this.biomes.colors.directionalLight);

    // Screen shake
    this.shake.apply(this.camera, dt);

    // Speed lines with biome color
    this.speedLines.update(this.speed / MAX_SPEED, this.biomes.colors.playerTrail);
    this.comboBorderGlow.update(dt, Math.min(this.combo, COMBO_MAX));

    // PostFX: drive chromatic aberration from speed, vignette from speed
    this.postfx.setSpeed(this.speed / MAX_SPEED);
    const pfxVignette = speedNorm * 0.5 + (this.biomes.isTransitioning ? 0.3 : 0);
    this.postfx.setVignette(pfxVignette);
    this.postfx.setBiomeTint(this.biomes.colors.playerTrail, 0.12);

    // --- Contracts ---
    const contractCtx: ContractCtx = {
      distance: this.distance,
      maxCombo: this.maxCombo,
      wallsShattered: this.closeCallCount,
      bestPhaseStreak: this.bestPhaseStreak,
      powerupsCollected: this.powerupsCollected,
    };
    for (const inst of this.contracts) {
      if (inst.complete) {
        if (inst.celebrateTimer > 0) {
          inst.celebrateTimer = Math.max(0, inst.celebrateTimer - dt);
        }
        continue;
      }
      inst.progress = inst.def.progress(contractCtx);
      if (inst.progress >= inst.def.target) {
        inst.complete = true;
        inst.celebrateTimer = 1.5;
        this.score += inst.def.reward;
        playChallengeComplete();
        this.popups.showCenter(
          `+${inst.def.reward.toLocaleString()} · ${inst.def.label}`,
          "CONTRACT COMPLETE",
          "#00ffcc"
        );
      }
    }
    this.contractHUD.render(this.contracts);

    // Update HUD
    this.hudScore.textContent = String(this.score);
    this.hudDistance.textContent = `${this.distance}m`;
    this.hudSpeed.textContent = `${Math.floor(this.speed)} m/s`;
    this.updatePhaseHud();
    this.updateNearMissHint();
    this.updateBoostBrakeHud(dt);

    if (this.combo > 1) {
      const comboVal = Math.min(this.combo, COMBO_MAX);
      this.hudCombo.textContent = `x${comboVal}`;
      this.hudCombo.style.color = "#ffcc00";
      this.hudCombo.style.opacity = "1";
      // Scale and glow based on combo level
      const comboScale = 1 + comboVal * 0.05;
      this.hudCombo.style.transform = `scale(${comboScale})`;
      this.hudCombo.style.textShadow = `0 0 ${10 + comboVal * 3}px rgba(255,204,0,${0.3 + comboVal * 0.07})`;
    } else if (this.player.shattered && this.phaseStreak > 1) {
      // Show phase streak multiplier in the combo slot while phasing
      const phaseMult = this.phaseStreakMultiplier(this.phaseStreak);
      this.hudCombo.textContent = `PHASE x${phaseMult}`;
      this.hudCombo.style.color = "#ff44ff";
      this.hudCombo.style.opacity = "1";
      this.hudCombo.style.transform = `scale(${1 + (phaseMult / 10) * 0.3})`;
      this.hudCombo.style.textShadow = `0 0 ${10 + phaseMult * 2}px rgba(255,68,255,0.65)`;
    } else {
      this.hudCombo.style.opacity = "0";
      this.hudCombo.style.transform = "scale(1)";
      this.hudCombo.style.color = "";
    }

    // Power-up HUD
    this.updatePowerUpHUD();

    // Update ambient audio + music
    updateAmbient(this.speed, true);
    updateMusic(dt, this.speed, this.player.shattered);

    // State indicator
    if (this.player.shattered) {
      const phaseMultiplier = this.getPhaseMultiplier();
      this.hudState.textContent = phaseMultiplier > 1.02 ? `PHASE x${phaseMultiplier.toFixed(1)}` : "PHASE";
      this.hudState.className = "shattered";
      this.hudState.style.color = "#ff44ff";
      this.hudState.style.opacity = phaseMultiplier > 1.02 ? "0.95" : "0.75";
      this.hudState.style.textShadow = phaseMultiplier > 1.02
        ? "0 0 18px rgba(255,136,255,0.65)"
        : "0 0 10px rgba(255,68,255,0.35)";
    } else if (this.phaseBonusFlashTimer > 0) {
      this.hudState.textContent = `${this.phaseBonusFlashValue.toFixed(1)}x PHASE BONUS`;
      this.hudState.className = "shattered";
      this.hudState.style.color = "#ff88ff";
      this.hudState.style.opacity = "1";
      this.hudState.style.textShadow = "0 0 24px rgba(255,136,255,0.8)";
    } else if (this.personalBestStage >= 4) {
      this.hudState.textContent = "IN UNCHARTED TERRITORY";
      this.hudState.className = "whole";
      this.hudState.style.opacity = "1";
      this.hudState.style.color = "#dffcff";
      this.hudState.style.textShadow = "0 0 22px rgba(200,246,255,0.75)";
    } else if (this.personalBestStage >= 2) {
      this.hudState.textContent = this.personalBestStage >= 3 ? "NEW RECORD!" : "APPROACHING BEST";
      this.hudState.className = "whole";
      this.hudState.style.opacity = this.personalBestStage >= 3 ? "1" : "0.95";
      this.hudState.style.color = this.personalBestStage >= 3 ? "#ffdc7a" : "#f4f6ff";
      this.hudState.style.textShadow = this.personalBestStage >= 3
        ? "0 0 26px rgba(255,220,122,0.8)"
        : "0 0 18px rgba(244,246,255,0.6)";
    } else if (this.personalBestStage >= 1) {
      this.hudState.textContent = "APPROACHING BEST";
      this.hudState.className = "whole";
      this.hudState.style.opacity = "0.65";
      this.hudState.style.color = "#9ca7b4";
      this.hudState.style.textShadow = "0 0 10px rgba(156,167,180,0.25)";
    } else {
      this.hudState.textContent = "SOLID";
      this.hudState.className = "whole";
      this.hudState.style.opacity = "0.6";
      this.hudState.style.color = "";
      this.hudState.style.textShadow = "";
    }

    // Tutorial
    this.tutorial.update(dt, moveX, isShattered, wasShattered);
  }

  /**
   * Piecewise speed curve — each biome has its own ramp.
   * Distances match biome boundaries in biomes.ts.
   */
  private computeSpeed(distance: number): number {
    return computeSpeed(distance, this.skillFactor);
  }

  private getPhaseMultiplier(): number {
    return 1 + Math.min(this.phaseTimeAccum * 0.15, 1.5);
  }

  /** Tiered streak multiplier: ×2 at streak 2, ×3 at 3, ×5 at 5, ×10 at 10 */
  private phaseStreakMultiplier(streak: number): number {
    if (streak >= 10) return 10;
    if (streak >= 5) return 5;
    if (streak >= 3) return 3;
    if (streak >= 2) return 2;
    return 1;
  }

  /** Fire all visual/audio juice when the phase streak crosses a tier boundary */
  private firePhaseTierUp(tier: number) {
    const tierColor = tier >= 10 ? 0xff88ff : tier >= 5 ? 0xff44ff : tier >= 3 ? 0xcc44ff : 0xaa44ff;
    const flashIntensity = tier >= 10 ? 0.3 : tier >= 5 ? 0.25 : tier >= 3 ? 0.2 : 0.15;
    const distortAmount = tier >= 10 ? 0.8 : tier >= 5 ? 0.6 : tier >= 3 ? 0.45 : 0.3;
    const kickAmount = tier >= 10 ? 1.8 : tier >= 5 ? 1.2 : tier >= 3 ? 0.8 : 0.5;

    this.screenFlash.trigger(tierColor, flashIntensity);
    this.cameraZKick = kickAmount;
    this.postfx.triggerDistort(distortAmount);
    playPhaseTierUp(tier);

    if (tier >= 5) this.shake.trigger(tier >= 10 ? 0.6 : 0.4);

    const popupColor = "#" + tierColor.toString(16).padStart(6, "0");
    if (tier >= 10) {
      this.popups.showCenter("PHASE x10", "TRANSCENDENT", popupColor);
      this.shockwave.trigger(
        new THREE.Vector3(this.player.group.position.x, 0, this.playerZ),
        tierColor, 10, 0.7
      );
    } else if (tier >= 5) {
      this.popups.showCenter("PHASE x5", "UNSTOPPABLE", popupColor);
    } else if (tier >= 3) {
      this.popups.showCenter("PHASE x3", "", popupColor);
    } else {
      this.popups.showCenter("PHASE x2", "", popupColor);
    }
  }

  private updatePersonalBestDrama() {
    if (this.personalBestTarget <= 0) {
      this.personalBestStage = 0;
      return;
    }

    const distanceRatio = this.distance / this.personalBestTarget;
    let nextStage = 0;

    if (distanceRatio >= 1.1) {
      nextStage = 4;
    } else if (distanceRatio >= 1) {
      nextStage = 3;
    } else if (distanceRatio >= 0.9) {
      nextStage = 2;
    } else if (distanceRatio >= 0.8) {
      nextStage = 1;
    }

    if (!this.personalBestTriggered && nextStage >= 3) {
      this.personalBestTriggered = true;
      this.screenFlash.trigger(0xfff1a6, 0.25);
      this.postfx.triggerDistort(1.25);
      this.shake.trigger(0.45);
      playPersonalBest();
      this.popups.showCenter("NEW RECORD!", `${this.distance.toLocaleString()}m`, "#ffdc7a");
    }

    this.personalBestStage = nextStage;
  }

  private updatePowerUpHUD() {
    const active = this.powerups.activePowerUps;
    if (active.length === 0) {
      this.hudPowerUp.style.opacity = "0";
      return;
    }

    this.hudPowerUp.style.opacity = "1";
    const labels = active.map(ap => {
      if (ap.type === PowerUpType.Shield) return "🛡 SHIELD";
      const pct = ap.duration === Infinity ? 100 : Math.ceil((ap.remaining / ap.duration) * 100);
      const name = ap.type.toUpperCase();
      return `${name} ${pct}%`;
    });
    this.hudPowerUp.textContent = labels.join(" | ");
  }

  private updatePhaseHud() {
    // — warning-state tunables ——————————————————————————————————————————
    const PHASE_WARN_THRESHOLD       = 0.50;  // energy below this → warning ramp
    const PHASE_WARN_FREQ_MIN        = 0.012; // rad/ms — slow pulse near threshold
    const PHASE_WARN_FREQ_MAX        = 0.040; // rad/ms — urgent pulse near 0
    const PHASE_WARN_VIGNETTE_MIN_A  = 0.15;  // screen-edge alpha at threshold
    const PHASE_WARN_VIGNETTE_MAX_A  = 0.55;  // screen-edge alpha at zero energy
    const PHASE_WARN_BAR_WIDTH_PULSE = 0.10;  // ± fraction of fill width that pulses
    const PHASE_WARN_GLOW_MIN_PX     = 12;    // bar glow blur at pulse trough
    const PHASE_WARN_GLOW_MAX_PX     = 32;    // bar glow blur at pulse peak
    // two-stop colour ramp: magenta (t=0) → orange (t=0.5) → red (t=1)
    const PHASE_WARN_MID_G           = 110;   // rgb(255,110,0) orange at t=0.5
    const PHASE_WARN_END_G           =  22;   // rgb(255, 22,0) danger-red at t=1
    const PHASE_BAR_WIDTH            = 220;   // px — ~1.57× original 140 px
    const PHASE_IDLE_WARN_THRESHOLD  = 0.20;  // idle red vignette when energy ≤ this
    // ———————————————————————————————————————————————————————————————————

    const fillWidth = this.phaseEnergy * PHASE_BAR_WIDTH;
    const isFull = this.phaseEnergy >= 0.999 && !this.player.shattered && !this.phaseLocked;

    this.hudPhaseFill.style.width = `${fillWidth}px`;

    // 1. phaseLocked — red flash, highest priority
    if (this.phaseLocked) {
      const flash = 0.55 + Math.sin(performance.now() * 0.025) * 0.25;
      this.hudPhaseFill.style.background = "#ff4444";
      this.hudPhaseFill.style.boxShadow = `0 0 10px rgba(255,68,68,${0.45 + flash * 0.35})`;
      this.hudPhaseMeter.style.opacity = String(0.65 + flash * 0.25);
      this.hudPhaseWarnVignette.style.boxShadow = "none";
      return;
    }

    // 2. actively phasing
    if (this.player.shattered) {
      if (this.phaseEnergy < PHASE_WARN_THRESHOLD) {
        // 2a. low-energy warning: colour ramps magenta→orange→red, pulse accelerates
        const t = 1 - this.phaseEnergy / PHASE_WARN_THRESHOLD; // 0 at threshold, 1 at 0
        const freq = THREE.MathUtils.lerp(PHASE_WARN_FREQ_MIN, PHASE_WARN_FREQ_MAX, t);
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * freq); // 0..1

        // Two-segment RGB lerp through orange midpoint
        const g = t < 0.5
          ? Math.round(THREE.MathUtils.lerp(68, PHASE_WARN_MID_G, t * 2))
          : Math.round(THREE.MathUtils.lerp(PHASE_WARN_MID_G, PHASE_WARN_END_G, (t - 0.5) * 2));
        const b = t < 0.5
          ? Math.round(THREE.MathUtils.lerp(255, 0, t * 2))
          : 0;

        const blurPx = Math.round(PHASE_WARN_GLOW_MIN_PX + pulse * (PHASE_WARN_GLOW_MAX_PX - PHASE_WARN_GLOW_MIN_PX));
        const glowA  = (0.5 + pulse * 0.4).toFixed(2);

        // Fill pulses ±PHASE_WARN_BAR_WIDTH_PULSE around current fill width
        this.hudPhaseFill.style.width      = `${(fillWidth * (1 - PHASE_WARN_BAR_WIDTH_PULSE + pulse * PHASE_WARN_BAR_WIDTH_PULSE * 2)).toFixed(1)}px`;
        this.hudPhaseFill.style.background = `rgb(255,${g},${b})`;
        this.hudPhaseFill.style.boxShadow  = `0 0 ${blurPx}px rgba(255,${g},${b},${glowA})`;
        this.hudPhaseMeter.style.opacity   = (0.75 + pulse * 0.2).toFixed(3);

        // Screen-edge vignette: base alpha ramps with energy depletion, modulated by pulse
        const vignetteBase = THREE.MathUtils.lerp(PHASE_WARN_VIGNETTE_MIN_A, PHASE_WARN_VIGNETTE_MAX_A, t);
        const vignetteA    = (vignetteBase * (0.65 + 0.35 * pulse)).toFixed(3);
        this.hudPhaseWarnVignette.style.boxShadow = `inset 0 0 80px 40px rgba(255,${g},${b},${vignetteA})`;
      } else {
        // 2b. healthy shattered — flat magenta (unchanged)
        this.hudPhaseFill.style.background = "#ff44ff";
        this.hudPhaseFill.style.boxShadow  = "0 0 12px rgba(255,68,255,0.7)";
        this.hudPhaseMeter.style.opacity   = "1";
        this.hudPhaseWarnVignette.style.boxShadow = "none";
      }
      return;
    }

    // 3. recharging / idle
    this.hudPhaseFill.style.background = "#00ffcc";
    this.hudPhaseFill.style.boxShadow  = "0 0 10px rgba(0,255,204,0.45)";
    this.hudPhaseMeter.style.opacity   = isFull ? "0.16" : "0.45";

    if (this.phaseEnergy <= PHASE_IDLE_WARN_THRESHOLD) {
      // Slow red pulse — peripheral warning that phase is critically low while idle
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * PHASE_WARN_FREQ_MIN);
      const vignetteA = (0.35 * (0.65 + 0.35 * pulse)).toFixed(3);
      this.hudPhaseWarnVignette.style.boxShadow = `inset 0 0 80px 40px rgba(255,22,0,${vignetteA})`;
    } else {
      this.hudPhaseWarnVignette.style.boxShadow = "none";
    }
  }

  /** Compute closest-edge distance from player to any nearby non-colliding obstacle.
   *  Returns Infinity if no obstacle is in the Z range. */
  /**
   * Project the player's world position to body-relative screen px and emit
   * a particle burst toward the graze bar. Intensity 0..1 scales count + size.
   */
  private emitGrazeParticles(intensity: number) {
    const v = new THREE.Vector3(
      this.player.group.position.x,
      this.player.group.position.y + 0.4,
      this.playerZ
    );
    v.project(this.camera);
    const bodyRect = document.body.getBoundingClientRect();
    // NDC (-1..1) → body-relative px. Y is flipped.
    const x = (v.x * 0.5 + 0.5) * bodyRect.width;
    const y = (-v.y * 0.5 + 0.5) * bodyRect.height;
    this.grazeStream.emit(x, y, intensity);
  }

  private checkGrazeProximity(): number {
    const px = this.player.group.position.x;
    const pz = this.playerZ;
    let minDist = Infinity;

    for (const obs of this.world.obstacles) {
      if (!obs.active) continue;
      const dz = Math.abs(pz - obs.z);
      if (dz > GRAZE_Z_RANGE) continue;

      if (obs.isGate && obs.wallSegments) {
        for (const seg of obs.wallSegments) {
          const dist = Math.abs(px - seg.x) - seg.halfWidth;
          if (dist < minDist) minDist = dist;
        }
      } else if (!obs.isGate) {
        const dist = Math.abs(px - obs.x) - obs.halfWidth;
        if (dist < minDist) minDist = dist;
      }
    }

    return minDist;
  }


  private updateNearMissHint() {
    // "NEAR MISS TO CHARGE" hint: pulsing, shown when meter < 30% and obstacle recently in range
    if (this.nearMissHintEl) {
      const showHint = this.phaseMeter < 30 && this.nearMissHintObstacleTimer > 0;
      if (showHint) {
        const hintPulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.00785); // 0.8s period
        this.nearMissHintEl.style.opacity = String(hintPulse);
      } else {
        this.nearMissHintEl.style.opacity = "0";
      }
    }
  }

  /**
   * Tick boost/brake timers and lerp speedMod toward the active target.
   * Mirrors the sim-layer SpeedModSystem but runs in the renderer so the
   * actual Three.js speed responds immediately.
   */
  private updateSpeedMod(dt: number, boostWanted: boolean, brakeWanted: boolean) {
    // Tick active timers and start cooldown on expiry
    if (this.boostTimer > 0) {
      this.boostTimer = Math.max(0, this.boostTimer - dt);
      if (this.boostTimer === 0) this.boostCooldown = BOOST_COOLDOWN;
    }
    if (this.brakeTimer > 0) {
      this.brakeTimer = Math.max(0, this.brakeTimer - dt);
      if (this.brakeTimer === 0) this.brakeCooldown = BRAKE_COOLDOWN;
    }
    if (this.boostCooldown > 0) this.boostCooldown = Math.max(0, this.boostCooldown - dt);
    if (this.brakeCooldown > 0) this.brakeCooldown = Math.max(0, this.brakeCooldown - dt);

    // Activate — brake wins if both pressed simultaneously
    if (brakeWanted && this.brakeTimer === 0 && this.brakeCooldown === 0) {
      this.brakeTimer = BRAKE_DURATION;
      this.boostTimer = 0; // cancel boost (no cooldown penalty for canceled action)
    } else if (boostWanted && this.boostTimer === 0 && this.boostCooldown === 0) {
      this.boostTimer = BOOST_DURATION;
      this.brakeTimer = 0; // cancel brake
    }

    // Lerp speedMod toward target (~150 ms)
    let target = 1;
    if (this.brakeTimer > 0) target = BRAKE_MULTIPLIER;
    else if (this.boostTimer > 0) target = BOOST_MULTIPLIER;
    const lerpFactor = 1 - Math.exp(-dt / SPEED_MOD_LERP_TIME);
    this.speedMod += (target - this.speedMod) * lerpFactor;
  }

  /** Update boost/brake cooldown ring HUD elements. */
  private updateBoostBrakeHud(dt: number) {
    if (!this.hudBoostFillEl || !this.hudBrakeFillEl) return;
    const circ = 2 * Math.PI * 11; // circumference of r=11 SVG rings

    const boostJustReady = this.prevBoostCooldown > 0 && this.boostCooldown <= 0;
    const brakeJustReady = this.prevBrakeCooldown > 0 && this.brakeCooldown <= 0;

    // Boost ring (gold)
    const boostFill = this.boostCooldown <= 0
      ? 1
      : 1 - this.boostCooldown / BOOST_COOLDOWN;
    this.hudBoostFillEl.style.strokeDasharray =
      `${(boostFill * circ).toFixed(2)} ${circ.toFixed(2)}`;
    if (boostJustReady) {
      this.hudBoostFillEl.style.filter = "brightness(1.3)";
    } else if (this.boostCooldown <= 0) {
      this.hudBoostFillEl.style.filter = "none";
    } else {
      this.hudBoostFillEl.style.filter = "brightness(0.95)";
    }

    // Brake ring (cyan)
    const brakeFill = this.brakeCooldown <= 0
      ? 1
      : 1 - this.brakeCooldown / BRAKE_COOLDOWN;
    this.hudBrakeFillEl.style.strokeDasharray =
      `${(brakeFill * circ).toFixed(2)} ${circ.toFixed(2)}`;
    if (brakeJustReady) {
      this.hudBrakeFillEl.style.filter = "brightness(1.3)";
    } else if (this.brakeCooldown <= 0) {
      this.hudBrakeFillEl.style.filter = "none";
    } else {
      this.hudBrakeFillEl.style.filter = "brightness(0.95)";
    }

    // Store current cooldowns for next frame's transition detection
    this.prevBoostCooldown = this.boostCooldown;
    this.prevBrakeCooldown = this.brakeCooldown;
  }

  private applyBiomeColors() {
    const c = this.biomes.colors;

    // Scene background and fog
    (this.scene.background as THREE.Color).setHex(c.background);
    (this.scene.fog as THREE.FogExp2).color.setHex(c.fog);
    (this.scene.fog as THREE.FogExp2).density = c.fogDensity;

    // Lighting
    this.ambientLight.color.setHex(c.ambientLight);
    this.ambientLight.intensity = c.ambientIntensity;
    this.directionalLight.color.setHex(c.directionalLight);
    this.directionalLight.intensity = c.directionalIntensity;

    // Bloom
    this.bloomPass.strength = c.bloomStrength;
    this.bloomPass.threshold = c.bloomThreshold;

    // World will read biome colors directly for new obstacles
  }

  private die() {
    const previousBestDistance = Math.max(this.bestDistance, this.runHistory.getBestDistance());

    // Ghost racing — stop recording immediately so we capture a clean set of frames
    this.ghostRecorder.stop();

    // Hide contracts HUD on death
    this.contractHUD.hide();

    // Hide tutorial immediately on death
    this.tutorial.reset();

    // Start death slow-mo sequence — brief time dilation before game over
    this.deathSlowMo = true;
    this.deathSlowMoTimer = 0.6; // 0.6s of dramatic slow-mo
    this.targetFOV = 60;
    this.currentFOV = 60;
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix();

    // Death sound + stop ambient + fade music
    playDeath();
    updateAmbient(0, false);
    fadeOutMusic();

    // Screen shake + explosion
    this.shake.trigger(1.5);
    this.explosion.trigger(this.player.group.position.clone());

    // Death debris burst — player shatters dramatically
    this.debris.trigger(this.player.group.position.clone(), 0xff4444, 20);
    this.debris.trigger(this.player.group.position.clone(), 0xff8844, 15);

    // Death shockwave — dramatic expanding ring
    this.shockwave.trigger(
      this.player.group.position.clone(),
      0xff4444, 15, 1.0
    );
    // Second delayed ring
    setTimeout(() => {
      this.shockwave.trigger(
        this.player.group.position.clone(),
        0xff8844, 10, 0.8
      );
    }, 150);
    // Third ring for extra drama
    setTimeout(() => {
      this.shockwave.trigger(
        this.player.group.position.clone(),
        0xff2222, 6, 0.5
      );
    }, 300);

    // Reset speed lines + vignette
    this.speedLines.update(0);
    this.comboBorderGlow.update(0, 0);
    this.targetCameraRoll = 0;
    this.vignette.setStyle(0x000000, false, 0.8);

    // Dramatic vignette on death
    this.vignette.setIntensity(0.8);
    this.postfx.setVignette(1.0);

    // Screen flash red
    this.screenFlash.trigger(0xff2222, 0.3);

    // PostFX: heavy death glitch + distortion
    this.postfx.triggerGlitch(1.0);
    this.postfx.triggerDistort(2.0);

    // Bloom surge on death
    this.bloomPass.strength = 2.0;

    // Save stats
    this.totalRuns++;
    localStorage.setItem("shatterDriftTotalRuns", String(this.totalRuns));

    const isNewHighScore = this.score > this.highScore;
    if (isNewHighScore) {
      this.highScore = this.score;
      localStorage.setItem("shatterDriftHighScore", String(this.highScore));
    }
    if (this.distance > this.bestDistance) {
      this.bestDistance = this.distance;
      localStorage.setItem("shatterDriftBestDistance", String(this.bestDistance));
    }

    // Performance grade — drives replayability ("I can get S rank!")
    const grade = this.calculateGrade();
    const gotSRank = grade.label === "S RANK";
    const nextGoal = this.getNextGoal(grade, previousBestDistance);

    // Finalize challenges for this run
    this.challenges.endRun(this.totalRuns, gotSRank);
    const challengeStats = this.challenges.getStats();

    // Save best grade
    const gradeRanks = ["E RANK", "D RANK", "C RANK", "B RANK", "A RANK", "S RANK"];
    const currentIdx = gradeRanks.indexOf(grade.label);
    const bestIdx = gradeRanks.indexOf(this.bestGrade);
    if (currentIdx > bestIdx) {
      this.bestGrade = grade.label;
      localStorage.setItem("shatterDriftBestGrade", this.bestGrade);
    }

    // Record run in history and get comparison
    const comparison = this.runHistory.recordRun({
      score: this.score,
      distance: this.distance,
      maxCombo: this.maxCombo,
      closeCallCount: this.closeCallCount,
      topSpeed: Math.floor(this.speed),
      biomeIndex: this.biomes.biomeIndex,
      grade: grade.label,
      timestamp: Date.now(),
    });

    // Build personal best indicators
    const pbIndicators: string[] = [];
    if (!comparison.isFirstRun) {
      if (comparison.newBestScore) pbIndicators.push("🏆 BEST SCORE");
      if (comparison.newBestDistance) pbIndicators.push("📏 BEST DISTANCE");
      if (comparison.newBestCombo) pbIndicators.push("🔥 BEST COMBO");
      if (comparison.newBestSpeed) pbIndicators.push("⚡ BEST SPEED");
      if (comparison.newBestBiome) pbIndicators.push("🌍 NEW ZONE");
    }
    const pbLine = pbIndicators.length > 0
      ? `<div style="color:#ffcc00;font-size:11px;margin:6px 0;letter-spacing:1px">${pbIndicators.join(" • ")}</div>`
      : "";

    // Daily best tracking
    let isNewDailyBest = false;
    let prevDailyBest = 0;
    if (this.isDailyMode) {
      const dailyKey = `shatterDriftDailyBest_${this.getDailyApiDate(this.dailyDateKey)}`;
      prevDailyBest = parseInt(localStorage.getItem(dailyKey) || "0", 10);
      isNewDailyBest = this.score > prevDailyBest;
      if (isNewDailyBest) {
        localStorage.setItem(dailyKey, String(this.score));
      }
    }

    // Build the best/score line — daily mode shows daily best, normal shows global best
    const bestLine = this.isDailyMode
      ? (isNewDailyBest
          ? `<span class="highlight">DAILY BEST!</span>`
          : `Daily Best: ${Math.max(prevDailyBest, this.score).toLocaleString()}`)
      : (isNewHighScore
          ? `<span class="highlight">NEW HIGH SCORE!</span>`
          : `Best: ${this.highScore.toLocaleString()}`);

    // Daily-specific header block
    const dailyHeader = this.isDailyMode
      ? `<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,204,0,0.2)">
           <div style="font-size:11px;color:#ffcc00;letter-spacing:4px;margin-bottom:4px">DAILY CHALLENGE</div>
           <div style="font-size:17px;font-weight:700;color:#ffcc00;text-shadow:0 0 14px rgba(255,204,0,0.5);letter-spacing:2px">${this.formatDailyDate(this.dailyDateKey)}</div>
         </div>`
      : "";

    // "Come back tomorrow" footer for daily mode
    const tomorrowLine = this.isDailyMode
      ? `<div style="margin-top:12px;font-size:11px;color:#ffcc00;letter-spacing:2px;text-shadow:0 0 8px rgba(255,204,0,0.3)">COME BACK TOMORROW FOR A NEW CHALLENGE</div>`
      : `<div id="next-run-goal" style="margin-top:16px;padding-top:12px;border-top:1px solid #223344">
           <div style="font-size:11px;color:#668899;letter-spacing:2px;margin-bottom:6px">NEXT RUN</div>
           <div style="font-size:18px;color:${nextGoal.color};letter-spacing:1px;text-shadow:0 0 14px ${nextGoal.color}55">${nextGoal.text}</div>
           <div style="font-size:11px;color:#7f92a6;margin-top:4px">${nextGoal.subtext}</div>
         </div>`;

    // Hide HUD state indicator so it doesn't overlap game-over text
    this.hudState.style.opacity = "0";
    this.hudState.style.display = "none";

    // Hide all in-game HUD pieces (speed, score, phase bar, near-miss meter,
    // boost/brake rings, etc) so they don't bleed through the blur overlay.
    // CSS in index.html gates each element off `#hud.is-gameover` and the
    // body-scoped `is-gameover` class also covers HUD siblings appended to
    // body (e.g. #near-miss-hint, #graze-particle-stream).
    this.hud.classList.add("is-gameover");
    document.body.classList.add("is-gameover");
    this.centerMessage.classList.add("is-gameover");

    // Blur overlay — frosted glass behind game over screen
    this.gameOverOverlay.classList.add("active");

    // Show game over with more stats
    this.state = GameState.GameOver;
    this.centerTitle!.textContent = "SHATTERED";
    const tabActiveClass = this.isDailyMode ? "active daily" : "active";

    this.centerStats!.innerHTML = `
      ${dailyHeader}
      <div style="font-size:40px;margin-bottom:8px;color:${grade.color};text-shadow:0 0 20px ${grade.color}88;letter-spacing:4px">${grade.label}</div>
      <div class="go-tabs">
        <button class="go-tab ${this.lastGameOverTab === 'stats' ? tabActiveClass : ''}" id="go-tab-btn-stats">STATS</button>
        <button class="go-tab ${this.lastGameOverTab === 'leaderboard' ? tabActiveClass : ''}" id="go-tab-btn-leaderboard">LEADERBOARD</button>
      </div>
      <div id="go-tab-stats" class="go-tab-content${this.lastGameOverTab !== 'stats' ? ' hidden' : ''}">
        <div style="font-size:32px;margin:8px 0"><span class="highlight">${this.score.toLocaleString()}</span></div>
        <div style="font-size:13px;color:#8899aa;margin:4px 0">${this.distance.toLocaleString()}m · ${Math.floor(this.speed)} m/s · x${this.maxCombo}</div>
        Zone: ${this.biomes.currentBiome.displayName}<br>
        ${pbLine}
        ${bestLine}
        ${tomorrowLine}
        <button id="share-x-btn" style="
          margin-top:14px;padding:8px 22px;
          font-family:'Orbitron',monospace;font-size:11px;letter-spacing:2px;
          color:#1da1f2;background:rgba(29,161,242,0.08);
          border:1px solid rgba(29,161,242,0.35);border-radius:4px;
          cursor:pointer;pointer-events:auto;
          transition:all 0.2s;
        " onmouseover="this.style.background='rgba(29,161,242,0.18)';this.style.borderColor='rgba(29,161,242,0.7)';this.style.textShadow='0 0 10px rgba(29,161,242,0.4)'"
           onmouseout="this.style.background='rgba(29,161,242,0.08)';this.style.borderColor='rgba(29,161,242,0.35)';this.style.textShadow='none'"
        >SHARE ON X</button>
      </div>
      <div id="go-tab-leaderboard" class="go-tab-content${this.lastGameOverTab !== 'leaderboard' ? ' hidden' : ''}">
        <div id="go-lb-status" style="font-size:11px;color:#445566;text-align:center;margin:8px 0">Saving...</div>
      </div>
    `;
    this.centerRetry!.textContent = "PRESS SPACE OR CLICK TO RETRY";
    // Make retry keyboard / gamepad / mouse activatable. The legacy
    // "click anywhere to retry" path in updateGameOver still works for
    // mouse, but a focused retry element gives keyboard / gamepad users
    // a clear default activation target after the gameOverTimer cooldown.
    this.centerRetry!.setAttribute("data-ui", "");
    this.centerRetry!.style.cursor = "pointer";
    this.centerRetry!.style.pointerEvents = "auto";
    // Replace any prior listener by cloning + re-binding (innerHTML rewrites
    // every game-over so the element identity is stable, but the content
    // resets each time).
    const newRetry = this.centerRetry!.cloneNode(true) as HTMLElement;
    this.centerRetry!.replaceWith(newRetry);
    this.centerRetry = newRetry;
    this.centerRetry.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.gameOverTimer < 1.2) return;
      this.player.group.visible = true;
      this.centerMessage.style.opacity = "0";
      this.gameOverTimer = 0;
      this.startGame(this.isDailyMode);
    });

    // BACK TO TITLE — clears any active ghost race and returns to the title
    // overlay without a fresh round. Same destination the page-load lands on.
    const backBtn = document.getElementById("center-back-to-title") as HTMLElement | null;
    if (backBtn) {
      // Clone+rebind so we don't accumulate listeners across game-overs.
      const fresh = backBtn.cloneNode(true) as HTMLElement;
      backBtn.replaceWith(fresh);
      fresh.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.gameOverTimer < 0.6) return;
        this.returnToTitleFromGameOver();
      });
      fresh.addEventListener("mousedown", (e) => e.stopPropagation());
      fresh.addEventListener("keydown", (e) => e.stopPropagation());
    }
    this.centerMessage.style.opacity = "1";

    // Tab switching
    const tabBtns = document.querySelectorAll<HTMLButtonElement>(".go-tab");
    tabBtns.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const tabName = btn.id.replace("go-tab-btn-", "");
        this.lastGameOverTab = tabName;
        tabBtns.forEach(b => b.classList.remove("active", "daily"));
        btn.classList.add(...(this.isDailyMode ? ["active", "daily"] : ["active"]));
        document.getElementById("go-tab-stats")?.classList.toggle("hidden", tabName !== "stats");
        document.getElementById("go-tab-leaderboard")?.classList.toggle("hidden", tabName !== "leaderboard");
      });
      btn.addEventListener("mousedown", e => e.stopPropagation());
      btn.addEventListener("keydown", e => e.stopPropagation());
    });

    // Wire up Share to X button
    const shareBtn = document.getElementById("share-x-btn");
    if (shareBtn) {
      shareBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const tweetText = this.isDailyMode
          ? [
              `I scored ${this.score.toLocaleString()} (${grade.label}) on today's SHATTER DRIFT Daily Challenge!`,
              `Can you beat my score? Same course for everyone!`,
              `https://tommyato.com/games/shatter-drift/`,
              ``,
              `#vibejam #dailychallenge @tommyatoai`,
            ].join("\n")
          : [
              `I scored ${this.score.toLocaleString()} (${grade.label}) on SHATTER DRIFT!`,
              `Reached ${this.distance.toLocaleString()}m in the ${this.biomes.currentBiome.displayName} zone`,
              ``,
              `Can you beat my score?`,
              `https://tommyato.com/games/shatter-drift/`,
              ``,
              `#vibejam #gamedev @tommyatoai`,
            ].join("\n");
        const url = `https://x.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
        window.open(url, "_blank", "noopener,noreferrer");
      });
      // Prevent space/click on button from restarting the game
      shareBtn.addEventListener("mousedown", (e) => e.stopPropagation());
      shareBtn.addEventListener("keydown", (e) => e.stopPropagation());
    }

    const nextRunGoal = document.getElementById("next-run-goal");
    if (nextRunGoal) {
      nextRunGoal.animate(
        [
          { opacity: 0.55 },
          { opacity: 1 },
          { opacity: 0.55 },
        ],
        {
          duration: 1600,
          iterations: Infinity,
          easing: "ease-in-out",
        }
      );
    }

    // Leaderboard — submit score and show top 10 (daily mode uses separate endpoint)
    const dailyOptions = this.isDailyMode
      ? { mode: "daily" as const, date: this.getDailyApiDate(this.dailyDateKey) }
      : undefined;
    this.showLeaderboard(this.score, Math.floor(this.distance), grade.label, this.biomes.currentBiome.displayName, dailyOptions);

    // Death popup — show the most exciting achievement
    if (this.isDailyMode && isNewDailyBest) {
      setTimeout(() => {
        this.popups.showCenter("DAILY BEST!", this.score.toLocaleString(), "#ffcc00");
      }, 500);
    } else if (isNewHighScore) {
      setTimeout(() => {
        this.popups.showCenter("NEW HIGH SCORE!", this.score.toLocaleString(), "#ffcc00");
      }, 500);
    } else if (comparison.bestStreak >= 3) {
      setTimeout(() => {
        this.popups.showCenter(`${comparison.bestStreak} RUN STREAK!`, "KEEP GOING", "#ff88ff");
      }, 500);
    } else if (pbIndicators.length >= 2) {
      setTimeout(() => {
        this.popups.showCenter("PERSONAL BESTS!", `${pbIndicators.length} NEW RECORDS`, "#00ffcc");
      }, 500);
    }

    // Hide player
    this.player.group.visible = false;

    // Ghost racing — announce outlasted ghosts, hide meshes, upload run
    this.announceBeatenGhosts();
    this.ghostManager.hideAll();
    this.uploadGhostIfQualified(grade.label);

    // Wire keyboard / gamepad nav to the game-over panel. Suppress for a
    // few frames so the death-trigger keypress (if any) doesn't instantly
    // activate a tab, and so the gameOverTimer >= 1.2s gate stays the
    // primary restart guard.
    this.applyGameOverMenuScope();
    this.menuNavSuppressFrames = 6;
  }

  /** Show "You beat X's ghost!" for each ghost the player outlasted this run. */
  private announceBeatenGhosts() {
    const beaten = this.ghostManager.getBeatenNames();
    if (beaten.length === 0) return;
    // Stagger messages so multiple beats don't overlap.
    beaten.forEach((name, i) => {
      setTimeout(() => {
        this.popups.showCenter(`You beat ${name}'s ghost!`, "👻 OUTLASTED", "#ffcc66");
      }, 1200 + i * 900);
    });
  }

  /** Upload this run's recording if score is in top half of leaderboard. Fire-and-forget. */
  private uploadGhostIfQualified(gradeLabel: string) {
    const frames = this.ghostRecorder.getFrames();
    if (frames.length < 10) return; // too short to be useful
    if (this.score < this.ghostUploadThreshold) return;
    const name = getLocalUsername();
    submitGhost({
      name,
      score: this.score,
      distance: Math.floor(this.distance),
      grade: gradeLabel,
      frames,
      seed: this.runSeed, // captured at run start — server persists so Race This Ghost can replay the same layout
    }).catch(() => { /* silent */ });
  }

  private async showLeaderboard(
    score: number,
    distance: number,
    grade: string,
    biome: string,
    dailyOptions?: { mode: "daily"; date: string }
  ) {
    const lbContainer = document.getElementById("go-tab-leaderboard");
    if (!lbContainer) return;

    const isDaily = !!dailyOptions;
    const lbLabel = isDaily ? "TODAY'S LEADERBOARD" : "GLOBAL LEADERBOARD";
    const rankColor = isDaily ? "#ffcc00" : "#00ffcc";

    // Show loading state in status div (already seeded to "Saving..." by enterGameOver)
    const statusEl = document.getElementById("go-lb-status");
    if (statusEl) statusEl.innerHTML = '<span style="color:#445566">Saving...</span>';

    // Name entry (persistent). Universal polish rule 2: no `PLAYER####`
    // fallback — always go through the shared coolname identity, which
    // self-seeds an `Adjective-Animal-NN` if no name was ever set.
    const playerName = getLocalUsername();

    // Submit score + fetch leaderboard in parallel
    type LeaderboardEntry = Awaited<ReturnType<typeof fetchLeaderboard>>[number];
    type SubmitResult = Awaited<ReturnType<typeof submitScore>>;
    let submitResult: SubmitResult = null;
    let topScores: LeaderboardEntry[] = [];
    try {
      [submitResult, topScores] = await Promise.all([
        submitScore({ name: playerName, score, distance, grade, biome }, dailyOptions),
        fetchLeaderboard(10, dailyOptions),
      ]);
    } catch {
      submitResult = null;
      topScores = [];
    }

    // Update status line
    if (statusEl) {
      if (submitResult) {
        const rankText = isDaily
          ? `✓ Score saved! You placed #${submitResult.rank} today!`
          : `✓ Score saved! You ranked #${submitResult.rank} of ${submitResult.total}`;
        statusEl.innerHTML = `<span style="color:${rankColor}">${rankText}</span>`;
      } else {
        statusEl.innerHTML = '<span style="color:#553333">Offline — score not saved</span>';
      }
    }

    // Build leaderboard HTML
    let html = ``;

    // Name edit row
    html += `<div style="text-align:center;margin:10px 0">`;
    html += `<div style="font-size:10px;color:#445566;letter-spacing:2px;margin-bottom:4px">YOUR NAME</div>`;
    html += `<input id="lb-name-input" type="text" maxlength="16" value="${playerName}" style="
      background:rgba(0,20,30,0.6);border:1px solid #334455;color:#00ffcc;
      font-family:'Orbitron',monospace;font-size:11px;padding:5px 10px;
      text-align:center;width:160px;border-radius:3px;letter-spacing:1px;
      outline:none;" placeholder="YOUR NAME">`;
    html += `</div>`;

    html += `<div style="font-family:'Orbitron',monospace;font-size:12px;color:${isDaily ? "#ffcc00" : "#668899"};letter-spacing:3px;text-align:center;margin-bottom:8px">${lbLabel}</div>`;

    if (topScores.length > 0) {
      html += `<table style="width:100%;font-size:11px;border-collapse:collapse">`;
      html += `<tr style="color:#445566"><td style="padding:2px 6px">#</td><td>NAME</td><td style="text-align:right">SCORE</td><td style="text-align:right">DIST</td></tr>`;
      for (let i = 0; i < topScores.length; i++) {
        const s = topScores[i];
        const isYou = submitResult && s.score === score && s.name === playerName;
        const youColor = isDaily ? "#ffcc00" : "#00ffcc";
        const rowColor = isYou ? youColor : (i < 3 ? "#ffcc00" : "#8899aa");
        const bg = isYou ? (isDaily ? "rgba(255,204,0,0.05)" : "rgba(0,255,204,0.05)") : "transparent";
        html += `<tr style="color:${rowColor};background:${bg}">`;
        html += `<td style="padding:2px 6px">${i + 1}</td>`;
        html += `<td>${s.name}</td>`;
        html += `<td style="text-align:right">${s.score.toLocaleString()}</td>`;
        html += `<td style="text-align:right">${s.distance}m</td>`;
        html += `</tr>`;
      }
      html += `</table>`;
    } else {
      html += `<div style="color:#445566;font-size:11px;text-align:center">No scores yet — be first!</div>`;
    }

    // Append below the status div (keep the status line at top)
    const existingStatus = document.getElementById("go-lb-status");
    if (existingStatus) {
      existingStatus.insertAdjacentHTML("afterend", html);
    } else {
      lbContainer.innerHTML += html;
    }

    // Wire up name input — save on input + change so the customize-screen
    // input stays in sync (universal polish rule 7: live propagation).
    const nameInput = document.getElementById("lb-name-input") as HTMLInputElement;
    if (nameInput) {
      const persist = () => {
        const newName = nameInput.value.trim() || playerName;
        setLocalUsername(newName);
      };
      nameInput.addEventListener("input", persist);
      nameInput.addEventListener("change", persist);
      // Prevent space from restarting game while typing name
      nameInput.addEventListener("keydown", (e) => {
        e.stopPropagation();
      });
    }

    // Ghost pool — RACE buttons for any seeded ghost records.
    // Legacy ghosts without a seed are skipped (no fair race possible).
    const seededGhosts = this.cachedGhosts.filter(g => typeof g.seed === "number");
    if (seededGhosts.length > 0) {
      let ghostHtml = `<div style="font-family:'Orbitron',monospace;font-size:10px;color:#334455;letter-spacing:3px;text-align:center;margin:16px 0 6px;border-top:1px solid #1a2a35;padding-top:12px">RACE A GHOST</div>`;
      for (const ghost of seededGhosts) {
        ghostHtml += `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(0,255,204,0.07)">
            <span style="color:#aabbcc;font-size:10px;font-family:'Orbitron',monospace;flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${ghost.name.slice(0, 16)}</span>
            <span style="color:#445566;font-size:9px;margin:0 8px">${ghost.score.toLocaleString()}</span>
            <button
              class="race-ghost-btn"
              data-ghost-id="${ghost.id}"
              data-ghost-seed="${ghost.seed}"
              data-ghost-name="${ghost.name.replace(/"/g, "&quot;")}"
              style="font-family:'Orbitron',monospace;font-size:8px;color:#00ffcc;border:1px solid rgba(0,255,204,0.5);background:transparent;padding:2px 7px;cursor:pointer;letter-spacing:1px;border-radius:2px;flex-shrink:0"
            >RACE</button>
          </div>`;
      }
      lbContainer.insertAdjacentHTML("beforeend", ghostHtml);

      // Event delegation — single listener handles all RACE buttons in this panel.
      lbContainer.addEventListener("click", (e: Event) => {
        const btn = (e.target as Element).closest(".race-ghost-btn") as HTMLElement | null;
        if (!btn) return;
        const ghostId = btn.dataset.ghostId;
        const ghostSeed = parseInt(btn.dataset.ghostSeed ?? "0", 10);
        const ghostName = btn.dataset.ghostName ?? "";
        if (!ghostId || !ghostSeed) return;
        this.pendingRaceGhostId = ghostId;
        this.pendingRaceSeed = ghostSeed;
        this.startGame(false);
      }, { once: true }); // once: auto-removes after first RACE click (startGame re-renders)
    }
  }

  // --- Game Over ---

  private gameOverTimer = 0;

  /** From the game-over screen, return to the title overlay. Clears any
   *  active ghost race, resets HUD state, and re-applies title menu nav.
   *  Same destination the page-load lands on; the brain reviewer can verify
   *  parity with the Title state by comparing this against transitionToIdle. */
  private returnToTitleFromGameOver() {
    // Clear any in-progress ghost race so the next PLAY is a fresh normal run.
    this.currentRaceGhostId = null;
    this.currentRaceSeed = null;
    this.pendingRaceGhostId = null;
    this.pendingRaceSeed = null;
    this.racingGhostName = null;
    this.updateRaceChip();

    // Hide HUD + game-over overlay, clear gameover styling.
    this.gameOverOverlay.classList.remove("active");
    this.hud.classList.add("hidden");
    this.hud.classList.remove("is-gameover");
    document.body.classList.remove("is-gameover");
    this.centerMessage.classList.remove("is-gameover");
    this.centerMessage.style.opacity = "0";
    this.centerStats.innerHTML = "";
    this.centerRetry.textContent = "";

    // Reset transient effects so the title preview camera doesn't show death VFX.
    this.bloomPass.strength = 0.6;
    this.vignette.setIntensity(0);
    this.postfx.setVignette(0);
    this.shake.intensity = 0;
    // Clear the CSS warn vignette (DOM element)
    this.hudPhaseWarnVignette.style.opacity = "0";
    this.hudPhaseWarnVignette.style.boxShadow = "none";
    // Clear the combo-border break-flash. On death with combo>=3 it paints a
    // 0.3s orange-red inset box-shadow; without a reset, the painted shadow
    // bleeds into the title screen since update() stops being called.
    this.comboBorderGlow.reset();

    // Hide ghosts left over from the race.
    this.ghostManager.hideAll();
    this.ghostManager.clear();

    // Drop any in-flight near-miss particles so they don't linger on title.
    this.grazeStream.clearAll();
    this.scoreStream.clearAll();

    // Restore HUD state indicator for the next run.
    this.hudState.style.display = "";
    this.hudState.style.opacity = "";

    // Hide death debris cleanly — player mesh becomes the title preview crystal.
    this.player.group.visible = false;
    this.player.shattered = false;

    // Show title overlay and re-attach menu nav.
    this.titleOverlay.classList.remove("hidden");
    this.state = GameState.Title;
    this.gameOverTimer = 0;
    this.applyTitleMenuScope();
    this.menuNavSuppressFrames = 4;
  }

  private updateGameOver(dt: number, menuConsumedActivate: boolean) {
    // Camera slowly drifts + continue shake
    this.camera.position.y += dt * 0.5;
    this.shake.apply(this.camera, dt);
    this.gameOverTimer += dt;

    // Slowly fade vignette out
    const vigFade = Math.max(0, 0.8 - this.gameOverTimer * 0.3);
    this.vignette.setIntensity(vigFade);

    // Demo mode: auto-restart after 2 seconds
    // Don't restart while player is typing in the leaderboard name input
    const isTypingName = document.activeElement?.id === "lb-name-input";
    // Require 1.2s cooldown before accepting restart — prevents accidental
    // restarts when the player mashes space during a fast-twitch death.
    // If menu nav consumed the activate (e.g. tab switch), skip the
    // restart this frame so a single Enter doesn't both switch tabs AND
    // retry — same `menuNavSuppressFrames` insurance applies on next
    // state entry too.
    const shouldRestart = this.demoMode
      ? this.gameOverTimer > 2
      : this.gameOverTimer > 1.2
        && !isTypingName
        && !menuConsumedActivate
        && this.menuNavSuppressFrames === 0
        && (this.input.justPressed("space") || this.input.justPressed("click"));

    if (shouldRestart) {
      this.player.group.visible = true;
      this.centerMessage.style.opacity = "0";
      this.gameOverTimer = 0;
      // Retry in the same mode (daily stays daily)
      this.startGame(this.isDailyMode);
    }
  }

  private calculateGrade(): { label: string; color: string } {
    const total = this.getGradeScore();
    for (const grade of GRADE_THRESHOLDS) {
      if (total >= grade.minScore) {
        return { label: grade.label, color: grade.color };
      }
    }

    return { label: "E RANK", color: "#666688" };
  }

  private getGradeScore(): number {
    // Grade based on weighted performance metrics
    const scorePoints = Math.min(this.score / 50000, 1) * 30;
    const distPoints = Math.min(this.distance / 2000, 1) * 25;
    const comboPoints = Math.min(this.maxCombo / 10, 1) * 20;
    const closeCallPoints = Math.min(this.closeCallCount / 15, 1) * 15;
    const biomePoints = Math.min(this.biomes.biomeIndex / 4, 1) * 10;
    return scorePoints + distPoints + comboPoints + closeCallPoints + biomePoints;
  }

  private getNextGoal(
    grade: { label: string; color: string },
    previousBestDistance: number
  ): { text: string; subtext: string; color: string } {
    const nextBiome = BIOME_MILESTONES.find((biome) => biome.startDistance > this.distance);
    const currentBiomeIndex = Math.max(
      0,
      BIOME_MILESTONES.findIndex((biome, index) => {
        const next = BIOME_MILESTONES[index + 1];
        return this.distance >= biome.startDistance && (!next || this.distance < next.startDistance);
      })
    );
    const currentBiomeStart = BIOME_MILESTONES[currentBiomeIndex]?.startDistance ?? 0;

    if (nextBiome) {
      const segmentLength = nextBiome.startDistance - currentBiomeStart;
      const segmentProgress = segmentLength > 0 ? (this.distance - currentBiomeStart) / segmentLength : 0;
      if (segmentProgress >= 0.8) {
        const distanceLeft = Math.max(1, nextBiome.startDistance - this.distance);
        return {
          text: `You were ${distanceLeft}m from ${nextBiome.name}!`,
          subtext: "One cleaner line gets you over the boundary.",
          color: "#7ce8ff",
        };
      }
    }

    if (grade.label !== "S RANK") {
      const currentGradeIndex = GRADE_THRESHOLDS.findIndex((candidate) => candidate.label === grade.label);
      const nextGrade = GRADE_THRESHOLDS[currentGradeIndex - 1];
      if (nextGrade) {
        const weightedGap = Math.max(0, nextGrade.minScore - this.getGradeScore());
        const scoreGap = Math.max(1, Math.ceil((weightedGap / 30) * 50000));
        return {
          text: `${scoreGap.toLocaleString()} more points for ${nextGrade.label}`,
          subtext: "A longer combo chain would likely get you there.",
          color: nextGrade.color,
        };
      }
    }

    if (previousBestDistance > this.distance) {
      const bestDistanceGap = previousBestDistance - this.distance;
      if (bestDistanceGap <= 120 || this.distance >= previousBestDistance * 0.85) {
        return {
          text: `Only ${bestDistanceGap}m from your best!`,
          subtext: "Stay alive a little longer and the record falls.",
          color: "#ffdc7a",
        };
      }
    }

    const furthestDistance = Math.max(this.distance, previousBestDistance);
    const nextUnvisitedBiome = BIOME_MILESTONES.find((biome) => biome.startDistance > furthestDistance);
    if (nextUnvisitedBiome) {
      const distanceLeft = Math.max(1, nextUnvisitedBiome.startDistance - this.distance);
      return {
        text: `Can you reach ${nextUnvisitedBiome.name}?`,
        subtext: `${distanceLeft}m to go on the next push.`,
        color: "#00ffcc",
      };
    }

    return {
      text: "Can you own the COSMIC RIFT?",
      subtext: "There is still more speed to squeeze out of this run.",
      color: "#ff88ff",
    };
  }

  // --- Resize ---

  private onResize() {
    // Read the 16:9 frame's dims, NOT the viewport's. The viewport may be
    // ultrawide/portrait/square — body's CSS `min(...)` formulas resolve to
    // a 16:9 box inside it, and #game-container fills that box.
    const w = this.gameContainer.clientWidth || 1;
    const h = this.gameContainer.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.postfx.setResolution(w, h);
    this.updateTitleLeaderboardLayout();
  }
}
