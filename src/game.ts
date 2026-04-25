import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Input } from "./input";
import { Player } from "./player";
import { World, type Obstacle } from "./world";
import { createComposer, ParticleTrail, ExplosionEffect, CollectFlash, DebrisBurst } from "./effects";
import { PostFXPass } from "./postfx";
import { initAudio, updateAmbient, playShatter, playRecombine, playCollect, playCloseCall, playDeath, playPowerUp, playBiomeTransition, playShieldBreak, playSpeedBoost, playChallengeComplete, playWorldEvent, playPersonalBest, playLaunch, stopAudio, startMusic, updateMusic, fadeOutMusic, setMasterVolume, getMasterVolume, playWallBreak, playPhaseTierUp, playGrazeWhoosh, playPhaseRejected } from "./audio";
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
import { GhostRecorder, GhostManager } from "./ghost";
import { getLocalUsername, setLocalUsername, migrateLegacyUsername } from "./coolname";
import { MenuNavigation } from "./menu-navigation";
import {
  createRiftFlipState,
  updateRiftFlip,
  RIFT_FLIP_ACTIVE_DURATION,
  type RiftFlipState,
} from "./systems/gravity-flip-scheduler";
import {
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
  computeSpeed,
} from "./constants";

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

  // Game objects
  private player!: Player;
  private world!: World;
  private input = new Input();

  // Effects
  private trail!: ParticleTrail;
  private explosion!: ExplosionEffect;
  private collectFlash!: CollectFlash;
  private debris!: DebrisBurst;
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
  private hudGrazeMeter!: HTMLElement;
  private hudGrazeFill!: HTMLElement;
  private titleOverlay!: HTMLElement;
  private centerMessage!: HTMLElement;
  private centerTitle!: HTMLElement;
  private centerStats!: HTMLElement;
  private centerRetry!: HTMLElement;
  private titleHighScore!: HTMLElement;
  private hudPowerUp!: HTMLElement;
  private hudBossWarning!: HTMLElement;
  private customizePanel!: HTMLElement;
  private customizeOpen = false;
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
  private portalRefUrl = "";

  // Ghost racing — async multiplayer playback
  private ghostRecorder = new GhostRecorder();
  private ghostManager!: GhostManager;
  private ghostUploadThreshold = 0;
  private ghostToggle = true;

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
    const container = document.getElementById("game-container")!;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.insertBefore(this.renderer.domElement, container.firstChild);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020208);
    this.scene.fog = new THREE.FogExp2(0x020208, 0.015);

    this.camera = new THREE.PerspectiveCamera(
      this.baseFOV,
      window.innerWidth / window.innerHeight,
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
    this.postfx.setResolution(window.innerWidth, window.innerHeight);
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
    this.hudGrazeMeter = document.getElementById("hud-graze-meter")!;
    this.hudGrazeFill = document.getElementById("hud-graze-fill")!;

    // "NEAR MISS TO CHARGE" pulsing hint — appears near the meter when meter is low and an obstacle is approaching
    this.nearMissHintEl = document.createElement("div");
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
    this.centerMessage = document.getElementById("center-message")!;
    this.centerTitle = document.getElementById("center-title")!;
    this.centerStats = document.getElementById("center-stats")!;
    this.centerRetry = document.getElementById("center-retry")!;
    this.titleHighScore = document.getElementById("title-high-score")!;
    this.hudPowerUp = document.getElementById("hud-powerup")!;
    this.hudBossWarning = document.getElementById("hud-boss-warning")!;
    this.customizePanel = document.getElementById("customize-panel")!;
    this.pauseMenu = document.getElementById("pause-menu")!;
    this.gameOverOverlay = document.getElementById("gameover-overlay")!;

    // Cache daily banner
    this.dailyBanner = document.getElementById("daily-banner");

    // Pause menu
    this.initPauseMenu();

    // Customize UI
    this.initCustomizePanel();

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

    // Resize
    window.addEventListener("resize", () => this.onResize());

    // Wire the explicit PLAY button on the title screen (added for
    // universal polish rule 4 — a clear index-0 menu target). Same
    // behavior as the legacy "press space anywhere" path; just routes
    // through `startGame(false)` like the daily button does.
    const playBtn = document.getElementById("play-btn");
    if (playBtn) {
      playBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.startGame(false);
      });
      playBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    }

    // Default menu scope = title. Refreshed on every state transition.
    this.applyTitleMenuScope();

    // Handle Vibeverse portal arrival
    this.handlePortalArrival();
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
    const customizeBtn = document.getElementById("customize-btn");
    if (playBtn) items.push(playBtn);
    if (dailyBtn) items.push(dailyBtn);
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
    // navigate to STATS / LEADERBOARD tabs and the SHARE button.
    const items: HTMLElement[] = [];
    if (this.centerRetry) items.push(this.centerRetry);
    const tabs = document.querySelectorAll<HTMLElement>(".go-tab");
    tabs.forEach((el) => items.push(el));
    const share = document.getElementById("share-x-btn");
    if (share) items.push(share);
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

  /** Fetch ghost recordings + upload threshold in parallel. Fire-and-forget. */
  private async loadGhostsAsync() {
    try {
      const [ghosts, threshold] = await Promise.all([
        fetchGhosts(3),
        fetchGhostUploadThreshold(),
      ]);
      this.ghostUploadThreshold = threshold;
      this.ghostManager.loadGhosts(ghosts);
      this.updateTitleGhostLine();
    } catch {
      // Silent — ghost racing is optional polish.
    }
  }

  /** Update the "Racing against N ghosts" line on the title screen. */
  private updateTitleGhostLine() {
    const el = document.getElementById("title-ghost-line");
    if (!el) return;
    const n = this.ghostManager?.ghostCount ?? 0;
    if (n > 0 && this.ghostToggle) {
      el.textContent = `👻 Racing against ${n} ghost${n === 1 ? "" : "s"}`;
      el.style.display = "";
    } else {
      el.style.display = "none";
    }
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
    if (this.state === GameState.Playing) {
      const puTimeScale = this.powerups.getTimeScale();
      dt *= puTimeScale;
    }

    // Death slow-mo — dramatic time dilation before game over screen
    if (this.deathSlowMo) {
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
        this.updatePlaying(dt);
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
    this.screenFlash.update(dt);
    this.milestones.update(dt);
    this.popups.update(dt);
    this.shockwave.update(dt);
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
      this.startGame(true);
      return;
    }

    // Legacy "click anywhere or space" launch — still works for mouse +
    // gamepad-A pressed off-button. Menu nav handles the focused PLAY
    // button; don't double-fire if it already activated something.
    if (
      !menuConsumedActivate &&
      !this.customizeOpen &&
      this.menuNavSuppressFrames === 0 &&
      this.input.justPressed("click")
    ) {
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
      this.world.setRandom(seededRandom(baseSeed));
      this.powerups.setRandom(seededRandom(baseSeed + 1));
      this.speedGates.setRandom(seededRandom(baseSeed + 2));
      this.worldEvents.setRandom(seededRandom(baseSeed + 3));
      this.bossWaves.setRandom(seededRandom(baseSeed + 4));
    } else {
      this.world.setRandom(Math.random);
      this.powerups.setRandom(Math.random);
      this.speedGates.setRandom(Math.random);
      this.worldEvents.setRandom(Math.random);
      this.bossWaves.setRandom(Math.random);
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
    this.phaseMeter = 50;
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
    this.updateGrazeMeterHud();
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
    // Clear blur overlay and game-over content from previous game over
    this.gameOverOverlay.classList.remove("active");
    if (this.centerStats) this.centerStats.innerHTML = "";
    // Restore HUD state indicator
    this.hudState.style.display = "";

    // Start recording after launch completes
    if (this.recorder && !this.recorder.isRecording) {
      setTimeout(() => {
        this.recorder?.start(this.renderer.domElement);
      }, 2000);
    }

    // Ghost racing — reset playback clock and start recording this run
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

    // Rejection feedback: Space pressed but graze meter too low
    const hasMeterForPhase = this.phaseMeter >= GRAZE_PHASE_COST;
    if (shatterInput && !this.phaseLocked && this.phaseCooldown <= 0 && !hasMeterForPhase && this.rejectionThrottleTimer <= 0) {
      playPhaseRejected();
      this.rejectionThrottleTimer = 0.5;
      this.meterRejectionTimer = 0.3; // red meter flash
    }

    // Phase stays active while min-duration timer is running OR input is held AND meter available
    const wantsToPhase = shatterInput && !this.phaseLocked && this.phaseCooldown <= 0 && hasMeterForPhase;
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

    // Vibeverse portal check (always active, even when phasing)
    if (!this.demoMode) {
      const portal = this.world.checkPortalCollision(
        this.player.group.position.x,
        this.playerZ
      );
      if (portal) {
        this.enterVibeverse();
        return;
      }
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

        // Score flash effect on big combos (no per-crystal popup — too noisy)
        if (this.combo >= 5) {
          this.hudScore.style.transform = "scale(1.2)";
          setTimeout(() => { this.hudScore.style.transform = "scale(1)"; }, 100);
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
    this.updateGrazeMeterHud();

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
    const fillWidth = this.phaseEnergy * 140;
    const isFull = this.phaseEnergy >= 0.999 && !this.player.shattered && !this.phaseLocked;

    this.hudPhaseFill.style.width = `${fillWidth}px`;

    if (this.phaseLocked) {
      const flash = 0.55 + Math.sin(performance.now() * 0.025) * 0.25;
      this.hudPhaseFill.style.background = "#ff4444";
      this.hudPhaseFill.style.boxShadow = `0 0 10px rgba(255,68,68,${0.45 + flash * 0.35})`;
      this.hudPhaseMeter.style.opacity = String(0.65 + flash * 0.25);
      return;
    }

    if (this.player.shattered) {
      this.hudPhaseFill.style.background = "#ff44ff";
      this.hudPhaseFill.style.boxShadow = "0 0 12px rgba(255,68,255,0.7)";
      this.hudPhaseMeter.style.opacity = "1";
      return;
    }

    this.hudPhaseFill.style.background = "#00ffcc";
    this.hudPhaseFill.style.boxShadow = "0 0 10px rgba(0,255,204,0.45)";
    this.hudPhaseMeter.style.opacity = isFull ? "0.16" : "0.45";
  }

  /** Compute closest-edge distance from player to any nearby non-colliding obstacle.
   *  Returns Infinity if no obstacle is in the Z range. */
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

  private updateGrazeMeterHud() {
    const fillPct = this.phaseMeter; // 0..100
    const ready = this.phaseMeter >= GRAZE_PHASE_COST;
    const isGrazing = !this.player.shattered && this.grazeThrottleTimer > 0;

    this.hudGrazeFill.style.height = `${fillPct}%`;

    // Rejection flash overrides all other colour states (red pulse)
    if (this.meterRejectionTimer > 0) {
      const t = this.meterRejectionTimer / 0.3;
      const pulse = Math.sin(t * Math.PI); // 0 → peak → 0
      this.hudGrazeFill.style.background = "#ff3030";
      this.hudGrazeFill.style.boxShadow = `0 0 ${4 + pulse * 10}px rgba(255,48,48,${0.3 + pulse * 0.5})`;
      this.hudGrazeMeter.style.opacity = String(0.6 + pulse * 0.4);
    } else if (ready) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
      this.hudGrazeFill.style.background = "#00ccff";
      this.hudGrazeFill.style.boxShadow = `0 0 ${6 + pulse * 4}px rgba(0,204,255,${0.5 + pulse * 0.3})`;
      this.hudGrazeMeter.style.opacity = String(0.7 + pulse * 0.25);
    } else if (isGrazing) {
      this.hudGrazeFill.style.background = "#00eeff";
      this.hudGrazeFill.style.boxShadow = "0 0 8px rgba(0,238,255,0.6)";
      this.hudGrazeMeter.style.opacity = "0.85";
    } else {
      this.hudGrazeFill.style.background = "#0099cc";
      this.hudGrazeFill.style.boxShadow = "0 0 4px rgba(0,153,204,0.3)";
      this.hudGrazeMeter.style.opacity = fillPct > 5 ? "0.5" : "0.25";
    }

    // Graze flash: brief scale bounce on the meter container (1.0 → 1.1 → 1.0 over 150ms)
    if (this.meterFlashTimer > 0) {
      const t = this.meterFlashTimer / 0.15; // 1 → 0
      const scaleY = 1 + 0.1 * Math.sin(t * Math.PI);
      this.hudGrazeMeter.style.transform = `scaleY(${scaleY.toFixed(3)})`;
      this.hudGrazeMeter.style.transformOrigin = "bottom center";
    } else {
      this.hudGrazeMeter.style.transform = "";
    }

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
  }

  // --- Game Over ---

  private gameOverTimer = 0;

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

  // --- Vibeverse ---

  private enterVibeverse() {
    const gameUrl = encodeURIComponent(window.location.origin + window.location.pathname);
    const speed = Math.floor(this.speed);
    const url = `https://portal.pieter.com/?username=crystal&color=00ffcc&speed=${speed}&ref=${gameUrl}`;
    window.location.href = url;
  }

  private handlePortalArrival() {
    const params = new URLSearchParams(window.location.search);
    const isPortal = params.get("portal") === "true";
    this.onnxMode = params.get("_ai") === "onnx";
    this.demoMode = params.get("demo") === "true" || this.onnxMode;
    const shouldRecord = params.get("record") === "true";
    const recordDuration = parseInt(params.get("duration") || "15", 10);

    // Store ref URL for return portal
    this.portalRefUrl = params.get("ref") || "";

    if (this.onnxMode) {
      this.autopilot = null;
      this.onnxAgent = new OnnxAgent();
      void this.onnxAgent.load();
      if (shouldRecord) {
        this.recorder = new GameRecorder(recordDuration);
      }
      this.startGame();
    } else if (this.demoMode) {
      this.autopilot = new Autopilot();
      if (shouldRecord) {
        this.recorder = new GameRecorder(recordDuration);
      }
      this.startGame();
    } else if (isPortal) {
      this.startGame();
    }
  }

  // --- Resize ---

  private onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.postfx.setResolution(w, h);
  }
}
