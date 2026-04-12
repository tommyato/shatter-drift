import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Input } from "./input";
import { Player } from "./player";
import { World } from "./world";
import { createComposer, ParticleTrail, ExplosionEffect, CollectFlash, DebrisBurst } from "./effects";
import { PostFXPass } from "./postfx";
import { initAudio, updateAmbient, playShatter, playRecombine, playCollect, playCloseCall, playDeath, playPowerUp, playBiomeTransition, playShieldBreak, playSpeedBoost, playChallengeComplete, playWorldEvent, playPersonalBest, stopAudio, startMusic, updateMusic, fadeOutMusic, setMasterVolume, getMasterVolume } from "./audio";
import { Autopilot } from "./autopilot";
import { GameRecorder } from "./recorder";
import { clamp, ScreenShake } from "./utils";
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
import { fetchLeaderboard, submitScore, getPlayerName, setPlayerName, type LeaderboardEntry } from "./leaderboard";

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
  Playing,
  Paused,
  GameOver,
}

// --- Game tuning ---
const INITIAL_SPEED = 12;
const MAX_SPEED = 45;
const ORB_SCORE = 100;
const CLOSE_CALL_SCORE = 50;
const COMBO_MAX = 10;

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
  private deathSlowMo = false;
  private deathSlowMoTimer = 0;

  // Camera juice
  private baseFOV = 75;
  private targetFOV = 75;
  private currentFOV = 75;
  private cameraRoll = 0;
  private targetCameraRoll = 0;
  private slowMoFactor = 1; // visual slow-mo for close calls
  private slowMoTimer = 0;
  private fovBoost = 0;
  private skillFactor = 1;
  private personalBestTarget = 0;
  private personalBestStage = 0;
  private personalBestTriggered = false;
  private phaseTimeAccum = 0;
  private phaseBonusFlashTimer = 0;
  private phaseBonusFlashValue = 1;

  // HUD elements
  private hudScore!: HTMLElement;
  private hudDistance!: HTMLElement;
  private hudSpeed!: HTMLElement;
  private hudCombo!: HTMLElement;
  private hudState!: HTMLElement;
  private hud!: HTMLElement;
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

  // Persistent stats
  private totalRuns = 0;
  private bestGrade = "";
  private bestDistance = 0;

  // Autopilot & recording
  private autopilot: Autopilot | null = null;
  private recorder: GameRecorder | null = null;
  private demoMode = false;
  private portalRefUrl = "";

  // Camera offset
  private cameraOffset = new THREE.Vector3(0, 3, -6);

  async start() {
    this.init();
    this.renderer.setAnimationLoop(() => this.loop());
  }

  private init() {
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

    // Player
    this.player = new Player();
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

    // Cache HUD elements
    this.hudScore = document.getElementById("hud-score")!;
    this.hudDistance = document.getElementById("hud-distance")!;
    this.hudSpeed = document.getElementById("hud-speed")!;
    this.hudCombo = document.getElementById("hud-combo")!;
    this.hudState = document.getElementById("hud-state-indicator")!;
    this.hud = document.getElementById("hud")!;
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

    // Pause menu
    this.initPauseMenu();

    // Customize UI
    this.initCustomizePanel();

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

    // Handle Vibeverse portal arrival
    this.handlePortalArrival();
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
  }

  private resumeGame() {
    this.state = GameState.Playing;
    this.pauseMenu.classList.add("hidden");
    // Reset clock delta so we don't get a huge dt spike
    this.clock.getDelta();
  }

  private initCustomizePanel() {
    const crystalGrid = document.getElementById("crystal-grid")!;
    const trailGrid = document.getElementById("trail-grid")!;
    const backBtn = document.getElementById("customize-back")!;
    const openBtn = document.getElementById("customize-btn")!;

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
      this.customizePanel.classList.remove("hidden");
    });

    // Back button
    backBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.customizeOpen = false;
      this.customizePanel.classList.add("hidden");
      this.titleOverlay.classList.remove("hidden");
    });

    // Apply initial skin
    this.player.applySkin(this.unlocks.getSelectedCrystal());
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

    switch (this.state) {
      case GameState.Title:
        this.updateTitle(dt);
        break;
      case GameState.Playing:
        this.updatePlaying(dt);
        break;
      case GameState.Paused:
        // Frozen — only render, don't update game logic
        break;
      case GameState.GameOver:
        this.updateGameOver(dt);
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

  private updateTitle(dt: number) {
    // Rotate player crystal on title screen
    this.player.group.position.set(0, 0, 0);
    this.player.crystalMesh.rotation.y += dt * 0.5;
    this.player.crystalMesh.rotation.x = Math.sin(performance.now() * 0.001) * 0.3;

    // Camera orbits slowly
    const t = performance.now() * 0.0003;
    this.camera.position.set(Math.sin(t) * 5, 3, Math.cos(t) * 5);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);

    if (!this.customizeOpen && (this.input.justPressed("space") || this.input.justPressed("click"))) {
      this.startGame();
    }
  }

  // --- Playing ---

  private startGame() {
    initAudio();
    startMusic();
    this.state = GameState.Playing;
    this.score = 0;
    this.distance = 0;
    this.speed = INITIAL_SPEED;
    this.combo = 0;
    this.maxCombo = 0;
    this.playerZ = 0;
    this.playTime = 0;
    this.closeCallCount = 0;
    this.phaseStreak = 0;
    this.phaseTimeAccum = 0;
    this.phaseBonusFlashTimer = 0;
    this.phaseBonusFlashValue = 1;
    this.player.laneX = 0;
    this.player.shattered = false;
    this.slowMoFactor = 1;
    this.slowMoTimer = 0;
    this.fovBoost = 0;
    this.targetFOV = this.baseFOV;
    this.currentFOV = this.baseFOV;
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

    // Apply selected cosmetics
    this.player.applySkin(this.unlocks.getSelectedCrystal());

    // Show HUD, hide title + customize
    this.hud.classList.remove("hidden");
    this.titleOverlay.classList.add("hidden");
    this.customizePanel.classList.add("hidden");
    this.customizeOpen = false;
    this.centerMessage.style.opacity = "0";
    // Clear leaderboard from previous game over
    const lbSection = document.getElementById("leaderboard-section");
    if (lbSection) lbSection.innerHTML = "";

    // Tutorial for first-time players
    if (!this.demoMode) {
      this.tutorial.startIfNeeded();
    }

    // Position camera behind player
    this.camera.position.set(0, 3, -6);
    this.camera.up.set(0, 1, 0);
    this.camera.fov = this.baseFOV;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 0, 10);

    // Start recording if in record mode (slight delay to skip title transition)
    if (this.recorder && !this.recorder.isRecording) {
      setTimeout(() => {
        this.recorder?.start(this.renderer.domElement);
      }, 500);
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

    // Player input (autopilot or human)
    let moveX: number;
    let shatterInput: boolean;

    if (this.autopilot) {
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

    // HyperPhase power-up: always phasing without input
    if (this.powerups.hasActivePowerUp(PowerUpType.HyperPhase)) {
      // Player can ALSO phase manually; hyperphase means combo doesn't break
    }

    this.player.shattered = shatterInput;

    // Shield visual indicator
    this.player.setShieldActive(this.powerups.hasActivePowerUp(PowerUpType.Shield));

    // Shatter/recombine audio triggers + visual effects
    if (shatterInput && !this.wasShattered) {
      playShatter();
      // Energy pulse on entering phase mode
      this.postfx.triggerDistort(0.3);
      this.shockwave.trigger(
        new THREE.Vector3(this.player.group.position.x, 0.5, this.playerZ),
        0xff44ff, 3, 0.3
      );
    }
    if (!shatterInput && this.wasShattered) {
      const phaseMultiplier = this.getPhaseMultiplier();
      playRecombine(phaseMultiplier);
      // Snap-back effect on recombining
      this.postfx.triggerDistort(0.2);
      // Reset phase streak when recombining
      if (this.phaseStreak > 0) {
        this.phaseStreak = 0;
      }
      if (phaseMultiplier > 1.05) {
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
    this.wasShattered = shatterInput;

    // Update player
    this.player.update(dt, moveX);
    this.player.group.position.z = this.playerZ;

    // World difficulty is now fully biome-driven (see world.ts)

    // Update world
    this.world.update(dt, this.playerZ, this.speed);

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
    const isPhasing = this.player.shattered || this.player.shatterT > 0.15;
    if (!isPhasing) {
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
            hit.active = false;
            hit.mesh.visible = false;
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

        // Floating score popup
        const comboLabel = this.combo > 1 ? ` x${Math.min(this.combo, COMBO_MAX)}` : "";
        const popupColor = this.combo >= 8 ? "#ff4444" : this.combo >= 5 ? "#ffaa00" : "#ffcc00";
        const popupSize = Math.min(14 + this.combo * 2, 30);
        this.popups.showAt3D(
          `+${orbPoints}${comboLabel}`,
          orb.x, orb.z, this.camera,
          popupColor, popupSize
        );

        // Score flash effect on big combos
        if (this.combo >= 5) {
          this.hudScore.style.transform = "scale(1.2)";
          setTimeout(() => { this.hudScore.style.transform = "scale(1)"; }, 100);
          // PostFX distort on high combos
          this.postfx.triggerDistort(0.2 + Math.min(this.combo, COMBO_MAX) * 0.03);
        }

        // Shockwave ring at combo milestones
        if (this.combo === 5) {
          this.shockwave.trigger(
            new THREE.Vector3(orb.x, 0, orb.z),
            0xffcc00, 5, 0.5
          );
          this.screenFlash.trigger(0xffaa00, 0.1);
          this.popups.showCenter("COMBO x5", "ON FIRE", "#ffaa00");
        } else if (this.combo === 8) {
          this.shockwave.trigger(
            new THREE.Vector3(orb.x, 0, orb.z),
            0xff6600, 7, 0.6
          );
          this.screenFlash.trigger(0xff6600, 0.15);
          this.shake.trigger(0.3);
          this.popups.showCenter("COMBO x8", "BLAZING", "#ff6600");
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
        if (this.playerZ - this.lastCloseCall > 3) {
          this.phaseStreak++;
          const streakBonus = Math.min(this.phaseStreak, 5); // up to 5x streak
          const puMultiplier = this.powerups.getScoreMultiplier();
          const phaseMultiplier = this.getPhaseMultiplier();
          const closeCallPoints = Math.round(CLOSE_CALL_SCORE * streakBonus * puMultiplier * phaseMultiplier);
          this.score += closeCallPoints;
          this.lastCloseCall = this.playerZ;
          this.closeCallCount++;
          playCloseCall();
          this.milestones.registerCloseCall();

          // Near-miss bonus: +25 score with popup and distortion flash
          const nearMissPoints = Math.round(25 * phaseMultiplier);
          this.score += nearMissPoints;
          this.popups.showAt3D(`+${nearMissPoints} NEAR MISS!`, this.player.group.position.x, this.playerZ, this.camera, "#88ccff", 20);
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

          // Score popup with streak indicator
          const streakLabel = this.phaseStreak > 1 ? ` STREAK x${this.phaseStreak}` : "";
          const popupColor = this.phaseStreak >= 4 ? "#ff44ff" : this.phaseStreak >= 2 ? "#aa88ff" : "#88ccff";
          this.popups.showAt3D(
            `+${closeCallPoints} PHASE x${phaseMultiplier.toFixed(1)}${streakLabel}`,
            this.player.group.position.x, this.playerZ, this.camera,
            popupColor, 16 + streakBonus * 2
          );

          // Dramatic announcements at streak milestones
          if (this.phaseStreak === 3) {
            this.popups.showCenter("PHANTOM", "", "#aa88ff");
            this.screenFlash.trigger(0xaa44ff, 0.15);
          } else if (this.phaseStreak === 5) {
            this.popups.showCenter("UNSTOPPABLE", "", "#ff44ff");
            this.screenFlash.trigger(0xff44ff, 0.2);
            this.shake.trigger(0.4);
          } else if (this.phaseStreak === 8) {
            this.popups.showCenter("TRANSCENDENT", "", "#ff88ff");
            this.screenFlash.trigger(0xff88ff, 0.25);
            this.shake.trigger(0.6);
            this.shockwave.trigger(
              new THREE.Vector3(this.player.group.position.x, 0, this.playerZ),
              0xff44ff, 10, 0.7
            );
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
      this.playerZ + this.cameraOffset.z
    );
    this.camera.position.lerp(targetCamPos, 1 - Math.exp(-5 * dt));
    // Keep up vector constant, apply roll via quaternion to avoid Euler gimbal ambiguity
    this.camera.up.set(0, 1, 0);
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

    // PostFX: drive chromatic aberration from speed, vignette from speed
    this.postfx.setSpeed(this.speed / MAX_SPEED);
    const pfxVignette = speedNorm * 0.5 + (this.biomes.isTransitioning ? 0.3 : 0);
    this.postfx.setVignette(pfxVignette);
    this.postfx.setBiomeTint(this.biomes.colors.playerTrail, 0.12);

    // Update HUD
    this.hudScore.textContent = String(this.score);
    this.hudDistance.textContent = `${this.distance}m`;
    this.hudSpeed.textContent = `${Math.floor(this.speed)} m/s`;

    if (this.combo > 1) {
      const comboVal = Math.min(this.combo, COMBO_MAX);
      this.hudCombo.textContent = `x${comboVal}`;
      this.hudCombo.style.opacity = "1";
      // Scale and glow based on combo level
      const comboScale = 1 + comboVal * 0.05;
      this.hudCombo.style.transform = `scale(${comboScale})`;
      this.hudCombo.style.textShadow = `0 0 ${10 + comboVal * 3}px rgba(255,204,0,${0.3 + comboVal * 0.07})`;
    } else {
      this.hudCombo.style.opacity = "0";
      this.hudCombo.style.transform = "scale(1)";
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
    this.tutorial.update(dt, moveX, shatterInput, this.wasShattered);
  }

  /**
   * Piecewise speed curve — each biome has its own ramp.
   * Distances match biome boundaries in biomes.ts.
   */
  private computeSpeed(distance: number): number {
    const speedFactor = this.skillFactor;
    if (distance < 300) {
      // THE VOID: 12 → 20 (gentle warm-up)
      return (12 + (distance / 300) * 8) * speedFactor;
    } else if (distance < 700) {
      // CRYSTAL CAVES: 20 → 30 (moderate ramp)
      return (20 + ((distance - 300) / 400) * 10) * speedFactor;
    } else if (distance < 1200) {
      // NEON DISTRICT: 30 → 38 (full speed ramp)
      return (30 + ((distance - 700) / 500) * 8) * speedFactor;
    } else if (distance < 1800) {
      // SOLAR STORM: 38 → 43 (dense and fast)
      return (38 + ((distance - 1200) / 600) * 5) * speedFactor;
    } else {
      // COSMIC RIFT: 43 → 45 (maximum challenge)
      return Math.min(MAX_SPEED, 43 + ((distance - 1800) / 500) * 2) * speedFactor;
    }
  }

  private getPhaseMultiplier(): number {
    return 1 + Math.min(this.phaseTimeAccum * 0.15, 1.5);
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

    // Improvement/comparison line
    let compLine = "";
    if (!comparison.isFirstRun && comparison.previousBest !== null) {
      if (comparison.newBestScore && comparison.improvementPct > 0) {
        compLine = `<div style="color:#00ff88;font-size:11px">↑ ${comparison.improvementPct}% improvement!</div>`;
      } else if (comparison.averageScore > 0) {
        const vsAvg = this.score >= comparison.averageScore ? "above" : "below";
        const diff = Math.abs(this.score - comparison.averageScore);
        compLine = `<div style="color:#8888aa;font-size:10px">${diff.toLocaleString()} ${vsAvg} your average</div>`;
      }
    }

    // Streak line
    let streakLine = "";
    if (comparison.bestStreak >= 2) {
      streakLine = `<div style="color:#ff88ff;font-size:11px">🔥 ${comparison.bestStreak} run improvement streak!</div>`;
    }

    // Run count line
    const runLine = `<div style="color:#666688;font-size:10px;margin-top:4px">Run #${comparison.runNumber}</div>`;

    // Show game over with more stats
    this.state = GameState.GameOver;
    this.centerTitle!.textContent = "SHATTERED";
    this.centerStats!.innerHTML = `
      <div style="font-size:40px;margin-bottom:12px;color:${grade.color};text-shadow:0 0 20px ${grade.color}88;letter-spacing:4px">${grade.label}</div>
      Score: <span class="highlight">${this.score.toLocaleString()}</span><br>
      Distance: ${this.distance.toLocaleString()}m<br>
      Top Speed: ${Math.floor(this.speed)} m/s<br>
      Max Combo: x${this.maxCombo}<br>
      Close Calls: ${this.closeCallCount}<br>
      Zone: ${this.biomes.currentBiome.displayName}<br>
      <span style="color:#ffcc00;font-size:12px">Challenges: ${challengeStats.completed}/${challengeStats.total}</span><br>
      ${pbLine}
      ${compLine}
      ${streakLine}
      ${isNewHighScore ? '<span class="highlight">NEW HIGH SCORE!</span>' : `Best: ${this.highScore.toLocaleString()}`}
      ${runLine}
    `;
    this.centerRetry!.textContent = "PRESS SPACE OR CLICK TO RETRY";
    this.centerMessage.style.opacity = "1";

    // Leaderboard — submit score and show top 10
    this.showLeaderboard(this.score, Math.floor(this.distance), grade.label, this.biomes.currentBiome.displayName);

    // Death popup — show the most exciting achievement
    if (isNewHighScore) {
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
  }

  private async showLeaderboard(score: number, distance: number, grade: string, biome: string) {
    const lbContainer = document.getElementById("leaderboard-section");
    if (!lbContainer) return;

    // Show loading state
    lbContainer.innerHTML = '<div style="color:#445566;font-size:11px;text-align:center;margin-top:12px">Loading leaderboard...</div>';

    // Name entry (persistent)
    let playerName = getPlayerName();
    if (!playerName) {
      playerName = "PLAYER" + Math.floor(Math.random() * 9999).toString().padStart(4, "0");
      setPlayerName(playerName);
    }

    // Submit score + fetch leaderboard in parallel
    const [submitResult, topScores] = await Promise.all([
      submitScore({ name: playerName, score, distance, grade, biome }),
      fetchLeaderboard(10),
    ]);

    // Build leaderboard HTML
    let html = `<div style="margin-top:16px;border-top:1px solid #223344;padding-top:12px">`;
    html += `<div style="font-family:'Orbitron',monospace;font-size:12px;color:#668899;letter-spacing:3px;text-align:center;margin-bottom:8px">GLOBAL LEADERBOARD</div>`;

    if (submitResult) {
      html += `<div style="color:#00ffcc;font-size:11px;text-align:center;margin-bottom:8px">You ranked #${submitResult.rank} of ${submitResult.total}</div>`;
    }

    // Name edit row
    html += `<div style="text-align:center;margin-bottom:10px">`;
    html += `<input id="lb-name-input" type="text" maxlength="16" value="${playerName}" style="
      background:rgba(0,20,30,0.6);border:1px solid #334455;color:#00ffcc;
      font-family:'Orbitron',monospace;font-size:11px;padding:4px 8px;
      text-align:center;width:120px;border-radius:3px;letter-spacing:1px;
      outline:none;" placeholder="YOUR NAME">`;
    html += `</div>`;

    if (topScores.length > 0) {
      html += `<table style="width:100%;font-size:11px;border-collapse:collapse">`;
      html += `<tr style="color:#445566"><td style="padding:2px 6px">#</td><td>NAME</td><td style="text-align:right">SCORE</td><td style="text-align:right">DIST</td></tr>`;
      for (let i = 0; i < topScores.length; i++) {
        const s = topScores[i];
        const isYou = submitResult && s.score === score && s.name === playerName;
        const rowColor = isYou ? "#00ffcc" : (i < 3 ? "#ffcc00" : "#8899aa");
        const bg = isYou ? "rgba(0,255,204,0.05)" : "transparent";
        html += `<tr style="color:${rowColor};background:${bg}">`;
        html += `<td style="padding:2px 6px">${i + 1}</td>`;
        html += `<td>${s.name}</td>`;
        html += `<td style="text-align:right">${s.score.toLocaleString()}</td>`;
        html += `<td style="text-align:right">${s.distance}m</td>`;
        html += `</tr>`;
      }
      html += `</table>`;
    } else {
      html += `<div style="color:#445566;font-size:11px;text-align:center">No scores yet — you're first!</div>`;
    }

    html += `</div>`;
    lbContainer.innerHTML = html;

    // Wire up name input — save on change
    const nameInput = document.getElementById("lb-name-input") as HTMLInputElement;
    if (nameInput) {
      nameInput.addEventListener("change", () => {
        const newName = nameInput.value.trim().slice(0, 16) || playerName;
        setPlayerName(newName);
      });
      // Prevent space from restarting game while typing name
      nameInput.addEventListener("keydown", (e) => {
        e.stopPropagation();
      });
    }
  }

  // --- Game Over ---

  private gameOverTimer = 0;

  private updateGameOver(dt: number) {
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
    const shouldRestart = this.demoMode
      ? this.gameOverTimer > 2
      : !isTypingName && (this.input.justPressed("space") || this.input.justPressed("click"));

    if (shouldRestart) {
      this.player.group.visible = true;
      this.centerMessage.style.opacity = "0";
      this.gameOverTimer = 0;
      this.startGame();
    }
  }

  private calculateGrade(): { label: string; color: string } {
    // Grade based on weighted performance metrics
    const scorePoints = Math.min(this.score / 50000, 1) * 30;
    const distPoints = Math.min(this.distance / 2000, 1) * 25;
    const comboPoints = Math.min(this.maxCombo / 10, 1) * 20;
    const closeCallPoints = Math.min(this.closeCallCount / 15, 1) * 15;
    const biomePoints = Math.min(this.biomes.biomeIndex / 4, 1) * 10;
    const total = scorePoints + distPoints + comboPoints + closeCallPoints + biomePoints;

    if (total >= 90) return { label: "S RANK", color: "#ffcc00" };
    if (total >= 75) return { label: "A RANK", color: "#00ffcc" };
    if (total >= 55) return { label: "B RANK", color: "#44aaff" };
    if (total >= 35) return { label: "C RANK", color: "#aa88ff" };
    if (total >= 15) return { label: "D RANK", color: "#ff88aa" };
    return { label: "E RANK", color: "#666688" };
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
    this.demoMode = params.get("demo") === "true";
    const shouldRecord = params.get("record") === "true";
    const recordDuration = parseInt(params.get("duration") || "15", 10);

    // Store ref URL for return portal
    this.portalRefUrl = params.get("ref") || "";

    if (this.demoMode) {
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
