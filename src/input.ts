/**
 * Unified input system. Tracks keyboard, mouse, and pointer state.
 *
 * Usage:
 *   input.isDown("w")        // held this frame
 *   input.justPressed("space") // pressed this frame (not last)
 *   input.justReleased("a")   // released this frame
 *   input.mousePos            // { x, y } in screen pixels
 *   input.mouseNDC            // { x, y } in [-1, 1] NDC
 *   input.isDown("click")     // left mouse button
 *   input.isDown("rightclick") // right mouse button
 */
export class Input {
  private keys = new Set<string>();
  private prevKeys = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private canvasWidth = 1;
  private canvasHeight = 1;

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
  }

  /** Call at the end of each frame */
  endFrame() {
    this.prevKeys = new Set(this.keys);
    this.prevMouseX = this.mouseX;
    this.prevMouseY = this.mouseY;
  }

  /** Key is currently held down */
  isDown(key: string): boolean {
    return this.keys.has(key.toLowerCase());
  }

  /** Key was pressed this frame (wasn't down last frame) */
  justPressed(key: string): boolean {
    const k = key.toLowerCase();
    return this.keys.has(k) && !this.prevKeys.has(k);
  }

  /** Key was released this frame (was down last frame, isn't now) */
  justReleased(key: string): boolean {
    const k = key.toLowerCase();
    return !this.keys.has(k) && this.prevKeys.has(k);
  }

  /** Any of the given keys are held down */
  anyDown(...keys: string[]): boolean {
    return keys.some((k) => this.isDown(k));
  }

  /** Get a movement vector from WASD/arrow keys + touch drag. Returns {x, y} normalized. */
  getMovement(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.isDown("w") || this.isDown("arrowup")) y += 1;
    if (this.isDown("s") || this.isDown("arrowdown")) y -= 1;
    if (this.isDown("a") || this.isDown("arrowleft")) x -= 1;
    if (this.isDown("d") || this.isDown("arrowright")) x += 1;
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
    return { x, y };
  }
}
