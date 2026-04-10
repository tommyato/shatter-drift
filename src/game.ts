import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { Input } from "./input";
import { Player } from "./player";
import { World } from "./world";
import { createComposer, ParticleTrail, ExplosionEffect, CollectFlash } from "./effects";
import { clamp } from "./utils";

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
  private clock = new THREE.Clock();

  // Game objects
  private player!: Player;
  private world!: World;
  private input = new Input();

  // Effects
  private trail!: ParticleTrail;
  private explosion!: ExplosionEffect;
  private collectFlash!: CollectFlash;

  // State
  private state = GameState.Title;
  private score = 0;
  private highScore = 0;
  private distance = 0;
  private speed = INITIAL_SPEED;
  private combo = 0;
  private playerZ = 0;
  private playTime = 0;
  private lastCloseCall = -10;

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
    const ambient = new THREE.AmbientLight(0x222244, 0.3);
    this.scene.add(ambient);

    const mainLight = new THREE.DirectionalLight(0x4466aa, 0.5);
    mainLight.position.set(5, 10, 10);
    this.scene.add(mainLight);

    // Rim light for player (from behind)
    const rimLight = new THREE.PointLight(0x00ffcc, 1, 20);
    rimLight.position.set(0, 2, -3);
    this.scene.add(rimLight);

    // Post-processing (bloom)
    this.composer = createComposer(this.renderer, this.scene, this.camera);

    // Input
    this.input.init(this.renderer.domElement);

    // Player
    this.player = new Player();
    this.scene.add(this.player.group);

    // World
    this.world = new World(this.scene);

    // Effects
    this.trail = new ParticleTrail(this.scene, 0x00ffcc);
    this.explosion = new ExplosionEffect(this.scene);
    this.collectFlash = new CollectFlash(this.scene);

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
    const dt = Math.min(this.clock.getDelta(), 0.05);
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

    // Render with bloom
    this.composer.render();

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
    this.state = GameState.Playing;
    this.score = 0;
    this.distance = 0;
    this.speed = INITIAL_SPEED;
    this.combo = 0;
    this.playerZ = 0;
    this.playTime = 0;
    this.player.laneX = 0;
    this.player.shattered = false;

    // Reset world
    this.world.reset();

    // Show HUD, hide title
    this.hud.classList.remove("hidden");
    this.titleOverlay.classList.add("hidden");
    this.centerMessage.style.opacity = "0";

    // Position camera behind player
    this.camera.position.set(0, 3, -6);
    this.camera.lookAt(0, 0, 10);
  }

  private updatePlaying(dt: number) {
    this.playTime += dt;

    // Speed increases over time
    this.speed = Math.min(MAX_SPEED, INITIAL_SPEED + this.playTime * SPEED_INCREASE);

    // Move forward
    this.playerZ += this.speed * dt;
    this.distance = Math.floor(this.playerZ);

    // Player input
    const move = this.input.getMovement();
    const shatterInput = this.input.isDown("space") || this.input.isDown("click");
    this.player.shattered = shatterInput;

    // Update player (negate X: camera faces +Z so screen-right = world -X)
    this.player.update(dt, -move.x);
    this.player.group.position.z = this.playerZ;

    // Update difficulty
    this.world.setDifficulty(Math.min(1, this.playTime / 120)); // max difficulty at 2 minutes

    // Update world
    this.world.update(dt, this.playerZ, this.speed);

    // Trail particles
    const trailColor = this.player.shattered ? 0xff44ff : 0x00ffcc;
    this.trail.setColor(trailColor);
    this.trail.emit(
      new THREE.Vector3(this.player.group.position.x, 0, this.playerZ - 0.5),
      this.player.shattered ? 3 : 1,
      this.player.shattered ? 1.5 : 0.3
    );

    // Collision detection
    if (!this.player.shattered) {
      // Check obstacle collision (only when solid)
      const hit = this.world.checkObstacleCollision(
        this.player.group.position.x,
        this.playerZ,
        this.player.getCollisionRadius()
      );
      if (hit) {
        this.die();
        return;
      }

      // Check orb collection (only when solid)
      const collected = this.world.checkOrbCollection(
        this.player.group.position.x,
        this.playerZ,
        0.8
      );
      for (const orb of collected) {
        this.combo++;
        const multiplier = Math.min(this.combo, COMBO_MAX);
        this.score += ORB_SCORE * multiplier;
        this.collectFlash.trigger(
          new THREE.Vector3(orb.x, orb.y, orb.z)
        );
      }
    } else {
      // Check close calls while shattered
      if (this.world.checkCloseCall(this.player.group.position.x, this.playerZ)) {
        if (this.playerZ - this.lastCloseCall > 3) {
          this.score += CLOSE_CALL_SCORE;
          this.lastCloseCall = this.playerZ;
          // Could flash "CLOSE CALL" text here
        }
      }
      // Shattering breaks combo
      this.combo = 0;
    }

    // Distance score
    this.score += Math.floor(this.speed * dt);

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

    // Update HUD
    this.hudScore.textContent = String(this.score);
    this.hudDistance.textContent = `${this.distance}m`;
    this.hudSpeed.textContent = `${Math.floor(this.speed)} m/s`;

    if (this.combo > 1) {
      this.hudCombo.textContent = `x${Math.min(this.combo, COMBO_MAX)}`;
      this.hudCombo.style.opacity = "1";
    } else {
      this.hudCombo.style.opacity = "0";
    }

    // State indicator
    if (this.player.shattered) {
      this.hudState.textContent = "PHASE";
      this.hudState.className = "shattered";
    } else {
      this.hudState.textContent = "SOLID";
      this.hudState.className = "whole";
    }
  }

  private die() {
    // Explosion
    this.explosion.trigger(this.player.group.position.clone());

    // Save high score
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem("shatterDriftHighScore", String(this.highScore));
    }

    // Show game over
    this.state = GameState.GameOver;
    this.centerTitle!.textContent = "SHATTERED";
    this.centerStats!.innerHTML = `
      Score: <span class="highlight">${this.score}</span><br>
      Distance: ${this.distance}m<br>
      Top Speed: ${Math.floor(this.speed)} m/s<br>
      ${this.score >= this.highScore ? '<span class="highlight">NEW HIGH SCORE!</span>' : `Best: ${this.highScore}`}
    `;
    this.centerRetry!.textContent = "PRESS SPACE OR CLICK TO RETRY";
    this.centerMessage.style.opacity = "1";

    // Hide player
    this.player.group.visible = false;
  }

  // --- Game Over ---

  private updateGameOver(dt: number) {
    // Camera slowly drifts
    this.camera.position.y += dt * 0.5;

    if (this.input.justPressed("space") || this.input.justPressed("click")) {
      this.player.group.visible = true;
      this.centerMessage.style.opacity = "0";
      this.startGame();
    }
  }

  // --- Vibeverse ---

  private handlePortalArrival() {
    const params = new URLSearchParams(window.location.search);
    const isPortal = params.get("portal") === "true";

    if (isPortal) {
      // Skip title, go straight to game
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
