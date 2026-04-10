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

  /** Get a movement vector from WASD/arrow keys. Returns {x, y} normalized. */
  getMovement(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.isDown("w") || this.isDown("arrowup")) y += 1;
    if (this.isDown("s") || this.isDown("arrowdown")) y -= 1;
    if (this.isDown("a") || this.isDown("arrowleft")) x -= 1;
    if (this.isDown("d") || this.isDown("arrowright")) x += 1;
    // Normalize diagonal
    const len = Math.sqrt(x * x + y * y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }
}
