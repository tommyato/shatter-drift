import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Input } from "./input";
import { Player } from "./player";
import { World } from "./world";
import { createComposer, ParticleTrail, ExplosionEffect, CollectFlash } from "./effects";
import { initAudio, updateAmbient, playShatter, playRecombine, playCollect, playCloseCall, playDeath, playPowerUp, playBiomeTransition, playShieldBreak, stopAudio, startMusic, updateMusic, fadeOutMusic } from "./audio";
import { Autopilot } from "./autopilot";
import { GameRecorder } from "./recorder";
import { clamp, ScreenShake } from "./utils";
import { BiomeManager } from "./biomes";
import { PowerUpManager, PowerUpType } from "./powerups";
import { MilestoneTracker } from "./milestones";
import { BossWaveManager } from "./bosswaves";

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

  constructor() {
    this.el = document.createElement("div");
    this.el.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 9;
      background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.8) 100%);
      opacity: 0; transition: opacity 0.5s;
    `;
    document.body.appendChild(this.el);
  }

  setIntensity(v: number) {
    this.intensity = clamp(v, 0, 1);
    this.el.style.opacity = String(this.intensity);
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
  GameOver,
}

// --- Game tuning ---
const INITIAL_SPEED = 15;
const SPEED_INCREASE = 0.8; // units/sec per second of play
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
  private shake = new ScreenShake();
  private speedLines!: SpeedLines;
  private vignette!: Vignette;
  private screenFlash!: ScreenFlash;

  // New systems
  private biomes!: BiomeManager;
  private powerups!: PowerUpManager;
  private milestones!: MilestoneTracker;
  private bossWaves!: BossWaveManager;

  // Lights (for biome transitions)
  private ambientLight!: THREE.AmbientLight;
  private directionalLight!: THREE.DirectionalLight;
  private rimLight!: THREE.PointLight;

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

  // Camera juice
  private baseFOV = 70;
  private targetFOV = 70;
  private currentFOV = 70;
  private cameraRoll = 0;
  private targetCameraRoll = 0;
  private slowMoFactor = 1; // visual slow-mo for close calls
  private slowMoTimer = 0;

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
    // Load high score
    this.highScore = parseInt(localStorage.getItem("shatterDriftHighScore") || "0", 10);

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
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      300
    );

    // Lighting — minimal, let emissives and bloom do the work
    this.ambientLight = new THREE.AmbientLight(0x222244, 0.3);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0x4466aa, 0.5);
    this.directionalLight.position.set(5, 10, 10);
    this.scene.add(this.directionalLight);

    // Rim light for player (from behind)
    this.rimLight = new THREE.PointLight(0x00ffcc, 1, 20);
    this.rimLight.position.set(0, 2, -3);
    this.scene.add(this.rimLight);

    // Post-processing (bloom)
    const { composer, bloom } = createComposer(this.renderer, this.scene, this.camera);
    this.composer = composer;
    this.bloomPass = bloom;

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
    this.speedLines = new SpeedLines();
    this.vignette = new Vignette();
    this.screenFlash = new ScreenFlash();

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

    // Show high score on title
    if (this.highScore > 0) {
      this.titleHighScore.textContent = `HIGH SCORE: ${this.highScore}`;
    }

    // Resize
    window.addEventListener("resize", () => this.onResize());

    // Handle Vibeverse portal arrival
    this.handlePortalArrival();
  }

  private loop() {
    let dt = Math.min(this.clock.getDelta(), 0.05);

    // Apply slow-mo from power-ups
    if (this.state === GameState.Playing) {
      const puTimeScale = this.powerups.getTimeScale();
      dt *= puTimeScale;
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
      case GameState.GameOver:
        this.updateGameOver(dt);
        break;
    }

    // Always update effects
    this.trail.update(dt);
    this.explosion.update(dt);
    this.collectFlash.update(dt);
    this.screenFlash.update(dt);
    this.milestones.update(dt);

    // Camera FOV interpolation
    this.currentFOV = THREE.MathUtils.lerp(this.currentFOV, this.targetFOV, 1 - Math.exp(-3 * dt));
    this.camera.fov = this.currentFOV;
    this.camera.updateProjectionMatrix();

    // Camera roll interpolation
    this.cameraRoll = THREE.MathUtils.lerp(this.cameraRoll, this.targetCameraRoll, 1 - Math.exp(-5 * dt));
    this.camera.rotation.z = this.cameraRoll;

    // Render with bloom
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
    this.camera.lookAt(0, 0, 0);

    if (this.input.justPressed("space") || this.input.justPressed("click")) {
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
    this.player.laneX = 0;
    this.player.shattered = false;
    this.slowMoFactor = 1;
    this.slowMoTimer = 0;
    this.targetFOV = this.baseFOV;
    this.currentFOV = this.baseFOV;
    this.targetCameraRoll = 0;
    this.cameraRoll = 0;

    // Reset systems
    this.world.reset();
    this.biomes.reset();
    this.powerups.reset();
    this.milestones.reset();
    this.bossWaves.reset();

    // Reset scene to first biome
    this.applyBiomeColors();

    // Show HUD, hide title
    this.hud.classList.remove("hidden");
    this.titleOverlay.classList.add("hidden");
    this.centerMessage.style.opacity = "0";

    // Position camera behind player
    this.camera.position.set(0, 3, -6);
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

    // Speed increases over time
    this.speed = Math.min(MAX_SPEED, INITIAL_SPEED + this.playTime * SPEED_INCREASE);

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
      // Autopilot returns world-space moveX, but player.update expects negated input
      moveX = ai.moveX;
      shatterInput = ai.shatter;
    } else {
      const move = this.input.getMovement();
      moveX = -move.x; // negate X: camera faces +Z so screen-right = world -X
      shatterInput = this.input.isDown("space") || this.input.isDown("click");
    }

    // HyperPhase power-up: always phasing without input
    if (this.powerups.hasActivePowerUp(PowerUpType.HyperPhase)) {
      // Player can ALSO phase manually; hyperphase means combo doesn't break
    }

    this.player.shattered = shatterInput;

    // Shield visual indicator
    this.player.setShieldActive(this.powerups.hasActivePowerUp(PowerUpType.Shield));

    // Shatter/recombine audio triggers
    if (shatterInput && !this.wasShattered) playShatter();
    if (!shatterInput && this.wasShattered) playRecombine();
    this.wasShattered = shatterInput;

    // Update player
    this.player.update(dt, moveX);
    this.player.group.position.z = this.playerZ;

    // Update difficulty
    this.world.setDifficulty(Math.min(1, this.playTime / 120)); // max difficulty at 2 minutes

    // Update world
    this.world.update(dt, this.playerZ, this.speed);

    // Update biomes
    const biomeChanged = this.biomes.update(this.distance);
    if (biomeChanged) {
      this.milestones.showBiomeAnnouncement(this.biomes.currentBiome.displayName);
      playBiomeTransition();
      this.shake.trigger(0.3);
    }
    this.applyBiomeColors();

    // Update power-ups
    this.powerups.update(dt, this.playerZ, this.player.group.position.x);

    // Update boss waves
    this.bossWaves.update(dt, this.playerZ);

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
    const speedNorm = this.speed / MAX_SPEED;
    this.targetFOV = this.baseFOV + speedNorm * 15; // 70 → 85 FOV

    // Camera roll on lateral movement (subtle)
    this.targetCameraRoll = -moveX * 0.03;

    // Trail particles
    const biomeTrailColor = this.biomes.colors.playerTrail;
    const trailColor = this.player.shattered ? 0xff44ff : biomeTrailColor;
    this.trail.setColor(trailColor);
    this.trail.emit(
      new THREE.Vector3(this.player.group.position.x, 0, this.playerZ - 0.5),
      this.player.shattered ? 3 : 1,
      this.player.shattered ? 1.5 : 0.3
    );

    // Vignette — stronger at high speed and during transitions
    const vignetteTarget = speedNorm * 0.4 + (this.biomes.isTransitioning ? 0.3 : 0);
    this.vignette.setIntensity(vignetteTarget);

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
        this.score += ORB_SCORE * multiplier * puMultiplier;
        playCollect(this.combo);
        this.collectFlash.trigger(
          new THREE.Vector3(orb.x, orb.y, orb.z)
        );
        // Score flash effect on big combos
        if (this.combo >= 5) {
          this.hudScore.style.transform = "scale(1.2)";
          setTimeout(() => { this.hudScore.style.transform = "scale(1)"; }, 100);
        }
      }
    } else {
      // Check close calls while shattered (regular obstacles + boss parts)
      const regularCloseCall = this.world.checkCloseCall(this.player.group.position.x, this.playerZ);
      const bossCloseCall = this.bossWaves.checkCloseCall(this.player.group.position.x, this.playerZ);
      if (regularCloseCall || bossCloseCall) {
        if (this.playerZ - this.lastCloseCall > 3) {
          const puMultiplier = this.powerups.getScoreMultiplier();
          this.score += CLOSE_CALL_SCORE * puMultiplier;
          this.lastCloseCall = this.playerZ;
          this.closeCallCount++;
          playCloseCall();
          this.milestones.registerCloseCall();

          // Brief slow-mo on close calls for dramatic effect
          this.slowMoFactor = 0.3;
          this.slowMoTimer = 0.15;

          // Particle burst at close call location
          this.trail.emit(
            new THREE.Vector3(this.player.group.position.x, 0.5, this.playerZ),
            8, 2.0
          );
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
    this.camera.lookAt(
      this.player.group.position.x * 0.5,
      0.5,
      this.playerZ + 15
    );

    // Screen shake
    this.shake.apply(this.camera, dt);

    // Speed lines with biome color
    this.speedLines.update(this.speed / MAX_SPEED, this.biomes.colors.playerTrail);

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
      this.hudState.textContent = "PHASE";
      this.hudState.className = "shattered";
    } else {
      this.hudState.textContent = "SOLID";
      this.hudState.className = "whole";
    }
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
    // Death sound + stop ambient + fade music
    playDeath();
    updateAmbient(0, false);
    fadeOutMusic();

    // Screen shake + explosion
    this.shake.trigger(1.5);
    this.explosion.trigger(this.player.group.position.clone());

    // Reset speed lines + vignette
    this.speedLines.update(0);
    this.vignette.setIntensity(0);
    this.targetCameraRoll = 0;

    // Save high score
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem("shatterDriftHighScore", String(this.highScore));
    }

    // Show game over with more stats
    this.state = GameState.GameOver;
    this.centerTitle!.textContent = "SHATTERED";
    this.centerStats!.innerHTML = `
      Score: <span class="highlight">${this.score.toLocaleString()}</span><br>
      Distance: ${this.distance.toLocaleString()}m<br>
      Top Speed: ${Math.floor(this.speed)} m/s<br>
      Max Combo: x${this.maxCombo}<br>
      Close Calls: ${this.closeCallCount}<br>
      Zone: ${this.biomes.currentBiome.displayName}<br>
      ${this.score >= this.highScore ? '<span class="highlight">NEW HIGH SCORE!</span>' : `Best: ${this.highScore.toLocaleString()}`}
    `;
    this.centerRetry!.textContent = "PRESS SPACE OR CLICK TO RETRY";
    this.centerMessage.style.opacity = "1";

    // Hide player
    this.player.group.visible = false;
  }

  // --- Game Over ---

  private gameOverTimer = 0;

  private updateGameOver(dt: number) {
    // Camera slowly drifts + continue shake
    this.camera.position.y += dt * 0.5;
    this.shake.apply(this.camera, dt);
    this.gameOverTimer += dt;

    // Demo mode: auto-restart after 2 seconds
    const shouldRestart = this.demoMode
      ? this.gameOverTimer > 2
      : this.input.justPressed("space") || this.input.justPressed("click");

    if (shouldRestart) {
      this.player.group.visible = true;
      this.centerMessage.style.opacity = "0";
      this.gameOverTimer = 0;
      this.startGame();
    }
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
  }
}
