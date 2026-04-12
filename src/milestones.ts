/**
 * Milestone system — dramatic announcements for achievements during gameplay.
 * Provides dopamine hits and sense of progression.
 */

export interface Milestone {
  id: string;
  label: string;
  subtitle: string;
  distance?: number;     // trigger at distance
  score?: number;        // trigger at score
  combo?: number;        // trigger at combo
  speed?: number;        // trigger at speed
  closeCallCount?: number;
  triggered: boolean;
}

const DISTANCE_MILESTONES: Milestone[] = [
  { id: "d100", label: "100m", subtitle: "WARMING UP", distance: 100, triggered: false },
  { id: "d250", label: "250m", subtitle: "FINDING YOUR RHYTHM", distance: 250, triggered: false },
  { id: "d500", label: "500m", subtitle: "HALF CLICK", distance: 500, triggered: false },
  { id: "d1000", label: "1,000m", subtitle: "ONE KILOMETER", distance: 1000, triggered: false },
  { id: "d1500", label: "1,500m", subtitle: "DEEP SPACE", distance: 1500, triggered: false },
  { id: "d2000", label: "2,000m", subtitle: "MARATHON", distance: 2000, triggered: false },
  { id: "d3000", label: "3,000m", subtitle: "LEGENDARY RUN", distance: 3000, triggered: false },
  { id: "d5000", label: "5,000m", subtitle: "TRANSCENDENT", distance: 5000, triggered: false },
];

const SCORE_MILESTONES: Milestone[] = [
  { id: "s5k", label: "5,000", subtitle: "NICE SCORE", score: 5000, triggered: false },
  { id: "s10k", label: "10,000", subtitle: "FIVE DIGITS", score: 10000, triggered: false },
  { id: "s25k", label: "25,000", subtitle: "QUARTER MASTER", score: 25000, triggered: false },
  { id: "s50k", label: "50,000", subtitle: "CRYSTAL MASTER", score: 50000, triggered: false },
  { id: "s100k", label: "100,000", subtitle: "SHATTERING RECORDS", score: 100000, triggered: false },
];

const COMBO_MILESTONES: Milestone[] = [
  { id: "c5", label: "x5 COMBO", subtitle: "ON FIRE", combo: 5, triggered: false },
  { id: "c10", label: "x10 COMBO", subtitle: "UNSTOPPABLE", combo: 10, triggered: false },
];

const SPEED_MILESTONES: Milestone[] = [
  { id: "sp30", label: "30 m/s", subtitle: "CRUISING", speed: 30, triggered: false },
  { id: "sp40", label: "40 m/s", subtitle: "TERMINAL VELOCITY", speed: 40, triggered: false },
  { id: "sp45", label: "MAX SPEED", subtitle: "LIGHT SPEED", speed: 45, triggered: false },
];

export class MilestoneTracker {
  private milestones: Milestone[];
  private displayQueue: Milestone[] = [];
  private currentDisplay: Milestone | null = null;
  private displayTimer = 0;
  private displayDuration = 1.2;

  // HUD elements
  private container: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private subtitleEl: HTMLElement | null = null;

  // Close call tracking
  private closeCallCount = 0;

  constructor() {
    this.milestones = [
      ...DISTANCE_MILESTONES,
      ...SCORE_MILESTONES,
      ...COMBO_MILESTONES,
      ...SPEED_MILESTONES,
    ];
    this.createHUD();
  }

  private createHUD() {
    this.container = document.createElement("div");
    this.container.id = "milestone-display";
    this.container.style.cssText = `
      position: fixed;
      top: 12%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      z-index: 30;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s ease-out;
    `;

    this.labelEl = document.createElement("div");
    this.labelEl.style.cssText = `
      font-family: 'Orbitron', monospace;
      font-size: 48px;
      font-weight: 900;
      color: #ffcc00;
      text-shadow: 0 0 30px rgba(255,204,0,0.6), 0 0 60px rgba(255,204,0,0.3);
      letter-spacing: 4px;
      transform: scale(0.5);
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    `;

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.style.cssText = `
      font-family: 'Orbitron', monospace;
      font-size: 16px;
      color: #aaccdd;
      letter-spacing: 6px;
      margin-top: 8px;
      opacity: 0.8;
    `;

    this.container.appendChild(this.labelEl);
    this.container.appendChild(this.subtitleEl);
    document.body.appendChild(this.container);
  }

  check(distance: number, score: number, combo: number, speed: number) {
    for (const m of this.milestones) {
      if (m.triggered) continue;

      let triggered = false;
      if (m.distance && distance >= m.distance) triggered = true;
      if (m.score && score >= m.score) triggered = true;
      if (m.combo && combo >= m.combo) triggered = true;
      if (m.speed && speed >= m.speed) triggered = true;

      if (triggered) {
        m.triggered = true;
        this.displayQueue.push(m);
      }
    }
  }

  registerCloseCall() {
    this.closeCallCount++;
  }

  update(dt: number) {
    if (this.currentDisplay) {
      this.displayTimer -= dt;
      if (this.displayTimer <= 0) {
        this.currentDisplay = null;
        this.container!.style.opacity = "0";
        this.labelEl!.style.transform = "scale(0.5)";
      }
    }

    if (!this.currentDisplay && this.displayQueue.length > 0) {
      this.currentDisplay = this.displayQueue.shift()!;
      this.displayTimer = this.displayDuration;
      this.show(this.currentDisplay);
    }
  }

  private show(milestone: Milestone) {
    this.labelEl!.textContent = milestone.label;
    this.subtitleEl!.textContent = milestone.subtitle;
    this.container!.style.opacity = "1";

    // Pop-in animation
    requestAnimationFrame(() => {
      this.labelEl!.style.transform = "scale(1)";
    });
  }

  /** Show a biome announcement */
  showBiomeAnnouncement(name: string) {
    this.displayQueue.push({
      id: "biome_" + name,
      label: name,
      subtitle: "ENTERING NEW ZONE",
      triggered: true,
    });
  }

  /** Show a power-up announcement */
  showPowerUpAnnouncement(name: string) {
    this.displayQueue.push({
      id: "pu_" + name,
      label: name,
      subtitle: "POWER UP",
      triggered: true,
    });
  }

  reset() {
    for (const m of this.milestones) {
      m.triggered = false;
    }
    this.displayQueue.length = 0;
    this.currentDisplay = null;
    this.displayTimer = 0;
    this.closeCallCount = 0;
    this.container!.style.opacity = "0";
  }
}
