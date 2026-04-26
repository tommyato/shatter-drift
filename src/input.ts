/**
 * Unified input system. Tracks keyboard, mouse, pointer, and gamepad state.
 *
 * Usage:
 *   input.isDown("w")            // held this frame
 *   input.justPressed("space")   // pressed this frame (not last)
 *   input.justReleased("a")      // released this frame
 *   input.mousePos               // { x, y } in screen pixels
 *   input.mouseNDC               // { x, y } in [-1, 1] NDC
 *   input.isDown("click")        // left mouse button
 *   input.isDown("rightclick")   // right mouse button
 *   input.justPressedDir("up")   // edge-detected menu direction (kbd + d-pad + stick)
 *   input.justPressedCancel()    // edge-detected Esc / gamepad-B
 *
 * "space" is treated as the universal activate channel — it includes
 * keyboard space, keyboard Enter, and gamepad A (button 0). Menu nav reads
 * `justPressedDir` for movement (separate from gameplay movement, which
 * folds the analog stick in via `getMovement()` directly).
 */

type NavDirection = "up" | "down" | "left" | "right";

/** Threshold the analog stick must cross to count as a nav-direction press. */
const NAV_STICK_THRESHOLD = 0.6;

export class Input {
  private keys = new Set<string>();
  private prevKeys = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private canvasWidth = 1;
  private canvasHeight = 1;

  // Gamepad state — polled each frame in update(). Buttons are tracked
  // separately from `keys` so they can be edge-detected without conflating
  // with keyboard state.
  private gamepadA = false;       // button 0 — activate / shatter
  private prevGamepadA = false;
  private gamepadB = false;       // button 1 — cancel/back
  private prevGamepadB = false;
  private gamepadBoost = false;   // button 7 — RT, boost
  private gamepadBrake = false;   // button 6 — LT, brake
  private gamepadMovement = { x: 0, y: 0 }; // analog stick + d-pad, for gameplay
  private gamepadNav = { up: false, down: false, left: false, right: false };
  private prevGamepadNav = { up: false, down: false, left: false, right: false };

  /** Current mouse position in screen pixels */
  mousePos = { x: 0, y: 0 };

  /** Current mouse position in normalized device coordinates [-1, 1] */
  mouseNDC = { x: 0, y: 0 };

  /** Mouse movement delta this frame */
  mouseDelta = { x: 0, y: 0 };

  /** Scroll wheel delta this frame */
  scrollDelta = 0;

  private prevMouseX = 0;
  private prevMouseY = 0;
  private scrollAccum = 0;

  init(canvas: HTMLCanvasElement) {
    this.canvasWidth = canvas.clientWidth;
    this.canvasHeight = canvas.clientHeight;

    window.addEventListener("keydown", (e) => {
      // Normalize spacebar: e.key returns " " but we use "space" everywhere
      const key = e.key === " " ? "space" : e.key.toLowerCase();
      this.keys.add(key);
      // Prevent browser defaults for game keys
      if (["space", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        e.preventDefault();
      }
    });

    window.addEventListener("keyup", (e) => {
      const key = e.key === " " ? "space" : e.key.toLowerCase();
      this.keys.delete(key);
    });

    window.addEventListener("mousemove", (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });

    window.addEventListener("mousedown", (e) => {
      // Don't capture clicks on interactive UI elements
      const target = e.target as HTMLElement;
      if (target.closest("input, button, select, textarea, [data-ui]")) return;
      if (e.button === 0) this.keys.add("click");
      if (e.button === 2) this.keys.add("rightclick");
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.keys.delete("click");
      if (e.button === 2) this.keys.delete("rightclick");
    });

    window.addEventListener("wheel", (e) => {
      this.scrollAccum += e.deltaY;
    });

    // Prevent context menu on right-click
    window.addEventListener("contextmenu", (e) => e.preventDefault());

    // Track canvas resize
    window.addEventListener("resize", () => {
      this.canvasWidth = canvas.clientWidth;
      this.canvasHeight = canvas.clientHeight;
    });

    // Handle blur — release all keys
    window.addEventListener("blur", () => {
      this.keys.clear();
    });

    // --- Touch controls ---
    // Left half = move left/right via drag; tap anywhere = shatter
    this.initTouch(canvas);
  }

  // Touch state
  private touchStartX = 0;
  private touchCurrentX = 0;
  private touching = false;
  private touchMoveX = 0;
  private touchRecenterTimer = 0;

  private initTouch(canvas: HTMLCanvasElement) {
    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this.touchStartX = touch.clientX;
      this.touchCurrentX = touch.clientX;
      this.touching = true;
      this.touchRecenterTimer = 0;
      // Touch = shatter (like holding click)
      this.keys.add("click");
    }, { passive: false });

    canvas.addEventListener("touchmove", (e) => {
      e.preventDefault();
      if (!this.touching) return;
      const touch = e.touches[0];
      const prevX = this.touchCurrentX;
      this.touchCurrentX = touch.clientX;

      // Velocity-based input: blend absolute position with finger velocity
      // This makes quick flicks responsive while sustained drags feel smooth
      const velocity = (this.touchCurrentX - prevX) * 0.15;
      const position = (this.touchCurrentX - this.touchStartX) / 60;
      this.touchMoveX = Math.max(-1, Math.min(1, position + velocity));

      // Gradually recenter the anchor toward the finger to prevent drift
      this.touchStartX += (this.touchCurrentX - this.touchStartX) * 0.02;
    }, { passive: false });

    canvas.addEventListener("touchend", (e) => {
      e.preventDefault();
      this.touching = false;
      this.touchMoveX = 0;
      this.keys.delete("click");
    }, { passive: false });

    canvas.addEventListener("touchcancel", () => {
      this.touching = false;
      this.touchMoveX = 0;
      this.keys.delete("click");
    });
  }

  /** Call at the start of each frame */
  update() {
    this.mousePos.x = this.mouseX;
    this.mousePos.y = this.mouseY;

    this.mouseNDC.x = (this.mouseX / this.canvasWidth) * 2 - 1;
    this.mouseNDC.y = -(this.mouseY / this.canvasHeight) * 2 + 1;

    this.mouseDelta.x = this.mouseX - this.prevMouseX;
    this.mouseDelta.y = this.mouseY - this.prevMouseY;

    this.scrollDelta = this.scrollAccum;
    this.scrollAccum = 0;

    this.pollGamepad();
  }

  private pollGamepad() {
    this.gamepadA = false;
    this.gamepadB = false;
    this.gamepadBoost = false;
    this.gamepadBrake = false;
    this.gamepadMovement.x = 0;
    this.gamepadMovement.y = 0;
    this.gamepadNav.up = false;
    this.gamepadNav.down = false;
    this.gamepadNav.left = false;
    this.gamepadNav.right = false;

    if (typeof navigator === "undefined" || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    if (!pads) return;
    let gp: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) { gp = p; break; }
    }
    if (!gp) return;

    // Movement (analog stick) — same deadzone as gameplay so player movement
    // gets stick input via getMovement() while menu nav uses the higher
    // NAV_STICK_THRESHOLD edge below.
    const ax = Math.abs(gp.axes[0] || 0) < 0.15 ? 0 : (gp.axes[0] || 0);
    // SD's gameplay y is "up = +y" (see getMovement: arrowup yields +1), so
    // invert the stick y here to match.
    const ay = Math.abs(gp.axes[1] || 0) < 0.15 ? 0 : (gp.axes[1] || 0);
    this.gamepadMovement.x = ax;
    this.gamepadMovement.y = -ay;

    const dpadUp = !!gp.buttons[12]?.pressed;
    const dpadDown = !!gp.buttons[13]?.pressed;
    const dpadLeft = !!gp.buttons[14]?.pressed;
    const dpadRight = !!gp.buttons[15]?.pressed;
    if (dpadUp) this.gamepadMovement.y += 1;
    if (dpadDown) this.gamepadMovement.y -= 1;
    if (dpadLeft) this.gamepadMovement.x -= 1;
    if (dpadRight) this.gamepadMovement.x += 1;

    // Menu nav: d-pad OR stick crossing the higher 0.6 threshold. Threshold
    // is well above the deadzone so a slow stick drift doesn't step the cursor.
    this.gamepadNav.up    = dpadUp    || ay < -NAV_STICK_THRESHOLD;
    this.gamepadNav.down  = dpadDown  || ay >  NAV_STICK_THRESHOLD;
    this.gamepadNav.left  = dpadLeft  || ax < -NAV_STICK_THRESHOLD;
    this.gamepadNav.right = dpadRight || ax >  NAV_STICK_THRESHOLD;

    this.gamepadA = !!gp.buttons[0]?.pressed; // A — activate / shatter
    this.gamepadB = !!gp.buttons[1]?.pressed; // B — cancel
    this.gamepadBrake = !!gp.buttons[6]?.pressed; // LT — brake
    this.gamepadBoost = !!gp.buttons[7]?.pressed; // RT — boost
  }

  /** Call at the end of each frame */
  endFrame() {
    this.prevKeys = new Set(this.keys);
    this.prevMouseX = this.mouseX;
    this.prevMouseY = this.mouseY;
    this.prevGamepadA = this.gamepadA;
    this.prevGamepadB = this.gamepadB;
    this.prevGamepadNav.up = this.gamepadNav.up;
    this.prevGamepadNav.down = this.gamepadNav.down;
    this.prevGamepadNav.left = this.gamepadNav.left;
    this.prevGamepadNav.right = this.gamepadNav.right;
  }

  /** Key is currently held down. "space" includes Enter and gamepad-A. */
  isDown(key: string): boolean {
    const k = key.toLowerCase();
    if (k === "space") {
      return this.keys.has("space") || this.keys.has("enter") || this.gamepadA;
    }
    return this.keys.has(k);
  }

  /** Key was pressed this frame (wasn't down last frame). "space" aggregates Enter + gamepad-A. */
  justPressed(key: string): boolean {
    const k = key.toLowerCase();
    if (k === "space") {
      const now =
        this.keys.has("space") || this.keys.has("enter") || this.gamepadA;
      const prev =
        this.prevKeys.has("space") || this.prevKeys.has("enter") || this.prevGamepadA;
      return now && !prev;
    }
    return this.keys.has(k) && !this.prevKeys.has(k);
  }

  /** Key was released this frame (was down last frame, isn't now) */
  justReleased(key: string): boolean {
    const k = key.toLowerCase();
    return !this.keys.has(k) && this.prevKeys.has(k);
  }

  /**
   * Edge-detected directional press for menu navigation. Aggregates keyboard
   * arrows / WASD with gamepad d-pad and left-stick threshold crossings.
   * Used by MenuNavigation; deliberately separate from gameplay's
   * `getMovement()` (which folds the stick in via gamepadMovement) so menu
   * nav doesn't double-count stick deflection.
   */
  justPressedDir(direction: NavDirection): boolean {
    const kbdNow = this.keyboardDirDown(direction);
    const kbdPrev = this.keyboardDirWasDown(direction);
    const padNow = this.gamepadNav[direction];
    const padPrev = this.prevGamepadNav[direction];
    return (kbdNow && !kbdPrev) || (padNow && !padPrev);
  }

  /**
   * Edge-detected cancel/back. Aggregates Esc + gamepad B (button 1).
   * Used by MenuNavigation to close modals.
   */
  justPressedCancel(): boolean {
    const escNow = this.keys.has("escape");
    const escPrev = this.prevKeys.has("escape");
    return (escNow && !escPrev) || (this.gamepadB && !this.prevGamepadB);
  }

  /**
   * Boost is held: keyboard Shift OR gamepad RT (button 7).
   * Used by the game layer to trigger the speed-mod boost effect.
   */
  isBoostDown(): boolean {
    return this.keys.has("shift") || this.gamepadBoost;
  }

  /**
   * Brake is held: keyboard Ctrl OR gamepad LT (button 6).
   * Used by the game layer to trigger the speed-mod brake effect.
   */
  isBrakeDown(): boolean {
    return this.keys.has("control") || this.gamepadBrake;
  }

  private keyboardDirDown(direction: NavDirection): boolean {
    switch (direction) {
      case "left":  return this.keys.has("a") || this.keys.has("arrowleft");
      case "right": return this.keys.has("d") || this.keys.has("arrowright");
      case "up":    return this.keys.has("w") || this.keys.has("arrowup");
      case "down":  return this.keys.has("s") || this.keys.has("arrowdown");
    }
  }

  private keyboardDirWasDown(direction: NavDirection): boolean {
    switch (direction) {
      case "left":  return this.prevKeys.has("a") || this.prevKeys.has("arrowleft");
      case "right": return this.prevKeys.has("d") || this.prevKeys.has("arrowright");
      case "up":    return this.prevKeys.has("w") || this.prevKeys.has("arrowup");
      case "down":  return this.prevKeys.has("s") || this.prevKeys.has("arrowdown");
    }
  }

  /** Any of the given keys are held down */
  anyDown(...keys: string[]): boolean {
    return keys.some((k) => this.isDown(k));
  }

  /** Get a movement vector from WASD/arrow keys + touch drag + gamepad. Returns {x, y} normalized. */
  getMovement(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) y += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) y -= 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) x -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) x += 1;
    // Normalize diagonal (keyboard only)
    const len = Math.sqrt(x * x + y * y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    // Blend touch input (overrides keyboard if touching)
    if (this.touching) {
      x = this.touchMoveX;
    }
    // Add gamepad analog stick + d-pad. Clamp to [-1,1] so combined input
    // doesn't exceed unit magnitude.
    x += this.gamepadMovement.x;
    y += this.gamepadMovement.y;
    return {
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
    };
  }
}
