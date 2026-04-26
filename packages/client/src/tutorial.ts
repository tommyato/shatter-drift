/**
 * Interactive tutorial overlay — teaches the core mechanic in 3 steps.
 * Appears only on first play (or when no high score exists).
 * Disappears naturally as the player demonstrates understanding.
 */

interface TutorialStep {
  text: string;
  subtext: string;
  condition: "move" | "shatter" | "recombine" | "time";
  duration?: number; // for time-based steps
  done: boolean;
}

export class Tutorial {
  private container: HTMLElement;
  private textEl: HTMLElement;
  private subtextEl: HTMLElement;
  private progressEl: HTMLElement;
  private steps: TutorialStep[];
  private currentStep = 0;
  private stepTimer = 0;
  private active = false;
  private fadingOut = false;
  private fadeTimer = 0;
  private shatterSeen = false;
  private recombineSeen = false;
  private moveSeen = false;

  constructor() {
    this.steps = [
      {
        text: "DODGE",
        subtext: "← A/D or Arrow Keys →",
        condition: "move",
        done: false,
      },
      {
        text: "HOLD SPACE TO SHATTER",
        subtext: "Phase through obstacles as fragments",
        condition: "shatter",
        done: false,
      },
      {
        text: "RELEASE TO RECOMBINE",
        subtext: "Collect orbs while solid · Build combos",
        condition: "recombine",
        done: false,
      },
    ];

    // Create DOM
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: fixed;
      bottom: 20%;
      left: 50%;
      transform: translateX(-50%);
      text-align: center;
      z-index: 35;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.5s ease-out;
    `;

    this.textEl = document.createElement("div");
    this.textEl.style.cssText = `
      font-family: 'Orbitron', monospace;
      font-size: 28px;
      font-weight: 700;
      color: #00ffcc;
      text-shadow: 0 0 20px rgba(0,255,204,0.5);
      letter-spacing: 4px;
      margin-bottom: 8px;
    `;

    this.subtextEl = document.createElement("div");
    this.subtextEl.style.cssText = `
      font-family: 'Orbitron', monospace;
      font-size: 14px;
      color: #668899;
      letter-spacing: 3px;
    `;

    this.progressEl = document.createElement("div");
    this.progressEl.style.cssText = `
      margin-top: 16px;
      display: flex;
      gap: 8px;
      justify-content: center;
    `;

    // Progress dots
    for (let i = 0; i < this.steps.length; i++) {
      const dot = document.createElement("div");
      dot.style.cssText = `
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #334455;
        transition: background 0.3s;
      `;
      dot.dataset.idx = String(i);
      this.progressEl.appendChild(dot);
    }

    this.container.appendChild(this.textEl);
    this.container.appendChild(this.subtextEl);
    this.container.appendChild(this.progressEl);
    document.body.appendChild(this.container);
  }

  /** Start tutorial if this is the player's first run */
  startIfNeeded(): boolean {
    const hasPlayed = localStorage.getItem("shatterDriftHighScore");
    if (hasPlayed && parseInt(hasPlayed, 10) > 0) {
      return false; // skip for returning players
    }

    this.active = true;
    this.currentStep = 0;
    this.stepTimer = 0;
    this.fadingOut = false;
    this.shatterSeen = false;
    this.recombineSeen = false;
    this.moveSeen = false;

    // Show first step
    this.showStep(0);
    this.container.style.opacity = "1";

    return true;
  }

  /** Call each frame with player state */
  update(dt: number, moveX: number, isShattered: boolean, wasShattered: boolean) {
    if (!this.active) return;

    this.stepTimer += dt;

    // Track player actions
    if (Math.abs(moveX) > 0.3) this.moveSeen = true;
    if (isShattered) this.shatterSeen = true;
    if (!isShattered && wasShattered) this.recombineSeen = true;

    // Check current step completion
    const step = this.steps[this.currentStep];
    if (!step) {
      this.complete();
      return;
    }

    let completed = false;
    switch (step.condition) {
      case "move":
        completed = this.moveSeen;
        break;
      case "shatter":
        completed = this.shatterSeen;
        break;
      case "recombine":
        completed = this.recombineSeen;
        break;
      case "time":
        completed = this.stepTimer >= (step.duration || 3);
        break;
    }

    // Also auto-advance after 5 seconds if stuck
    if (!completed && this.stepTimer > 5) {
      completed = true;
    }

    if (completed) {
      step.done = true;
      this.markDone(this.currentStep);
      this.currentStep++;
      this.stepTimer = 0;

      if (this.currentStep < this.steps.length) {
        // Brief fade between steps
        this.container.style.opacity = "0";
        setTimeout(() => {
          if (!this.active) return;
          this.showStep(this.currentStep);
          this.container.style.opacity = "1";
        }, 400);
      } else {
        this.complete();
      }
    }
  }

  private showStep(idx: number) {
    const step = this.steps[idx];
    if (!step) return;
    this.textEl.textContent = step.text;
    this.subtextEl.textContent = step.subtext;
  }

  private markDone(idx: number) {
    const dots = this.progressEl.children;
    if (dots[idx]) {
      (dots[idx] as HTMLElement).style.background = "#00ffcc";
    }
  }

  private complete() {
    if (this.fadingOut) return;
    this.fadingOut = true;

    // Show completion message
    this.textEl.textContent = "GO!";
    this.subtextEl.textContent = "";
    this.container.style.opacity = "1";

    setTimeout(() => {
      this.container.style.opacity = "0";
      setTimeout(() => {
        this.active = false;
      }, 500);
    }, 800);
  }

  get isActive(): boolean {
    return this.active;
  }

  reset() {
    this.active = false;
    this.fadingOut = false;
    this.currentStep = 0;
    this.container.style.opacity = "0";
    // Reset progress dots
    const dots = this.progressEl.children;
    for (let i = 0; i < dots.length; i++) {
      (dots[i] as HTMLElement).style.background = "#334455";
    }
    for (const step of this.steps) {
      step.done = false;
    }
  }
}
