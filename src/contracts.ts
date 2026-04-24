/**
 * Run Contracts — per-run randomized goals that award score bonuses on completion.
 * Three contracts are rolled at the start of each run. Completing one adds a score
 * bonus, fires a popup, and plays a celebration stinger. All contracts reset on
 * the next run — no carryover.
 *
 * Ported from the Clockwork Climb contract system (CC commit d2d5a5f).
 * The category-dedup logic in pickRandomContracts is non-negotiable — without it
 * a single roll can produce two contracts from the same category (e.g. "Reach 500m"
 * and "Reach 1,500m" both in the same set of three).
 */

// ---- Context ----------------------------------------------------------------

/** Live run stats passed to each contract's progress callback every frame. */
export interface ContractCtx {
  /** Distance traveled in meters this run */
  distance: number;
  /** Best combo (orb streak) reached this run */
  maxCombo: number;
  /** Total walls phased through (close calls) this run */
  wallsShattered: number;
  /** Peak phase-streak reached this run (resets between phase sessions) */
  bestPhaseStreak: number;
  /** Power-ups collected this run */
  powerupsCollected: number;
}

// ---- Types ------------------------------------------------------------------

export interface ContractDef {
  readonly id: string;
  readonly label: string;
  readonly target: number;
  /** Score bonus awarded on completion */
  readonly reward: number;
  // Category tag — prevents a single roll from picking two contracts that
  // track the same dimension (e.g. "Reach 500m" and "Reach 1,500m" together).
  readonly category: string;
  /** Returns current (unclamped) progress in the same unit as `target`. */
  readonly progress: (ctx: ContractCtx) => number;
  /** Optional custom display text; defaults to "n/target". */
  readonly format?: (progress: number, target: number) => string;
}

export interface ContractInstance {
  def: ContractDef;
  progress: number;
  complete: boolean;
  /** Counts down from CELEBRATE_DURATION after completion — drives the glow state. */
  celebrateTimer: number;
}

// ---- Pool -------------------------------------------------------------------

export const CONTRACT_POOL: readonly ContractDef[] = [
  // --- reach (distance milestone) ---
  {
    id: "reach-500",
    label: "Reach 500m",
    target: 500,
    reward: 300,
    category: "reach",
    progress: (ctx) => ctx.distance,
    format: (p, t) => `${Math.min(Math.floor(p), t)}/${t}m`,
  },
  {
    id: "reach-1500",
    label: "Reach 1,500m",
    target: 1500,
    reward: 800,
    category: "reach",
    progress: (ctx) => ctx.distance,
    format: (p, t) => `${Math.min(Math.floor(p), t)}/${t}m`,
  },
  {
    id: "reach-3000",
    label: "Reach 3,000m",
    target: 3000,
    reward: 2000,
    category: "reach",
    progress: (ctx) => ctx.distance,
    format: (p, t) => `${Math.min(Math.floor(p), t)}/${t}m`,
  },

  // --- shatter (walls phased through = close calls) ---
  {
    id: "shatter-5",
    label: "Phase through 5 walls",
    target: 5,
    reward: 250,
    category: "shatter",
    progress: (ctx) => ctx.wallsShattered,
  },
  {
    id: "shatter-15",
    label: "Phase through 15 walls",
    target: 15,
    reward: 600,
    category: "shatter",
    progress: (ctx) => ctx.wallsShattered,
  },
  {
    id: "shatter-30",
    label: "Phase through 30 walls",
    target: 30,
    reward: 1500,
    category: "shatter",
    progress: (ctx) => ctx.wallsShattered,
  },

  // --- combo (orb streak) ---
  {
    id: "combo-x5",
    label: "Hit a 5x combo",
    target: 5,
    reward: 300,
    category: "combo",
    progress: (ctx) => ctx.maxCombo,
    format: (p, t) => `x${Math.min(Math.floor(p), t)}/x${t}`,
  },
  {
    id: "combo-x10",
    label: "Hit a 10x combo",
    target: 10,
    reward: 800,
    category: "combo",
    progress: (ctx) => ctx.maxCombo,
    format: (p, t) => `x${Math.min(Math.floor(p), t)}/x${t}`,
  },

  // --- powerups (any power-up collected) ---
  {
    id: "powerups-3",
    label: "Collect 3 power-ups",
    target: 3,
    reward: 250,
    category: "powerups",
    progress: (ctx) => ctx.powerupsCollected,
  },
  {
    id: "powerups-5",
    label: "Collect 5 power-ups",
    target: 5,
    reward: 500,
    category: "powerups",
    progress: (ctx) => ctx.powerupsCollected,
  },

  // --- phase-streak (consecutive walls phased in one phase session) ---
  {
    id: "phase-streak-3",
    label: "Chain 3 phases in a row",
    target: 3,
    reward: 400,
    category: "phase-streak",
    progress: (ctx) => ctx.bestPhaseStreak,
  },
  {
    id: "phase-streak-5",
    label: "Chain 5 phases in a row",
    target: 5,
    reward: 1000,
    category: "phase-streak",
    progress: (ctx) => ctx.bestPhaseStreak,
  },
];

// ---- Helpers ----------------------------------------------------------------

/**
 * Roll `count` contracts from CONTRACT_POOL.
 * Category dedup ensures no two rolled contracts track the same dimension.
 */
export function pickRandomContracts(count: number): ContractInstance[] {
  // Work from a copy so we can splice without mutating the pool.
  let pool = [...CONTRACT_POOL];
  const picked: ContractInstance[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const idx = Math.floor(Math.random() * pool.length);
    const [def] = pool.splice(idx, 1);
    picked.push({ def, progress: 0, complete: false, celebrateTimer: 0 });
    // Remove all remaining contracts in the same category.
    pool = pool.filter((p) => p.category !== def.category);
  }
  return picked;
}

/** Format a contract's current progress as a display string. */
export function formatContractProgress(instance: ContractInstance): string {
  const { def, progress } = instance;
  if (def.format) {
    return def.format(progress, def.target);
  }
  return `${Math.min(Math.floor(progress), def.target)}/${def.target}`;
}

// ---- HUD --------------------------------------------------------------------

/**
 * DOM widget that renders three contract rows in the top-left HUD zone.
 * Uses plain DOM — no framework. Follows the existing SD "create element,
 * set cssText" pattern used throughout game.ts.
 */
export class ContractHUD {
  private container: HTMLElement;
  private rows: HTMLElement[] = [];
  private labelEls: HTMLElement[] = [];
  private progressEls: HTMLElement[] = [];
  private boxEls: HTMLElement[] = [];

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "contract-hud";
    this.container.style.cssText = [
      "position:fixed",
      "top:72px",
      "left:28px",
      "display:flex",
      "flex-direction:column",
      "gap:6px",
      "pointer-events:none",
      "z-index:20",
      "opacity:0",
      "transition:opacity 0.3s",
    ].join(";");
    document.body.appendChild(this.container);

    for (let i = 0; i < 3; i++) {
      const row = document.createElement("div");
      row.style.cssText = [
        "display:flex",
        "align-items:center",
        "gap:5px",
        "font-family:'Orbitron',monospace",
        "font-size:9px",
        "letter-spacing:1px",
        "color:#556677",
        "transition:color 0.25s,text-shadow 0.25s",
      ].join(";");

      const box = document.createElement("span");
      box.textContent = "▢";
      box.style.cssText = "flex-shrink:0;transition:color 0.25s,text-shadow 0.25s";

      const label = document.createElement("span");
      label.style.cssText = "transition:text-decoration 0.1s";

      const dot = document.createElement("span");
      dot.textContent = "·";
      dot.style.cssText = "flex-shrink:0;opacity:0.5";

      const prog = document.createElement("span");
      prog.style.cssText = "opacity:0.8";

      row.appendChild(box);
      row.appendChild(label);
      row.appendChild(dot);
      row.appendChild(prog);
      this.container.appendChild(row);

      this.rows.push(row);
      this.labelEls.push(label);
      this.progressEls.push(prog);
      this.boxEls.push(box);
    }
  }

  show() {
    this.container.style.opacity = "1";
  }

  hide() {
    this.container.style.opacity = "0";
  }

  render(contracts: ContractInstance[]) {
    for (let i = 0; i < 3; i++) {
      const inst = contracts[i];
      if (!inst) continue;

      const isCelebrating = inst.complete && inst.celebrateTimer > 0;
      const isDimmed = inst.complete && inst.celebrateTimer <= 0;

      if (isCelebrating) {
        // Completed — glowing tint for celebrateTimer duration.
        this.boxEls[i].textContent = "▣";
        this.boxEls[i].style.color = "#00ffcc";
        this.boxEls[i].style.textShadow = "0 0 8px rgba(0,255,204,0.8)";
        this.rows[i].style.color = "#00ffcc";
        this.rows[i].style.textShadow = "0 0 6px rgba(0,255,204,0.4)";
        this.rows[i].style.opacity = "1";
        this.labelEls[i].style.textDecoration = "line-through";
        this.labelEls[i].textContent = inst.def.label;
        this.progressEls[i].textContent = "DONE";
      } else if (isDimmed) {
        // Completed + celebration expired — dim out of the way.
        this.boxEls[i].textContent = "▣";
        this.boxEls[i].style.color = "#2a3a44";
        this.boxEls[i].style.textShadow = "none";
        this.rows[i].style.color = "#2a3a44";
        this.rows[i].style.textShadow = "none";
        this.rows[i].style.opacity = "0.4";
        this.labelEls[i].style.textDecoration = "line-through";
        this.labelEls[i].textContent = inst.def.label;
        this.progressEls[i].textContent = "DONE";
      } else {
        // Active — show live progress.
        this.boxEls[i].textContent = "▢";
        this.boxEls[i].style.color = "#556677";
        this.boxEls[i].style.textShadow = "none";
        this.rows[i].style.color = "#556677";
        this.rows[i].style.textShadow = "none";
        this.rows[i].style.opacity = "1";
        this.labelEls[i].style.textDecoration = "none";
        this.labelEls[i].textContent = inst.def.label;
        this.progressEls[i].textContent = formatContractProgress(inst);
      }
    }
  }

  dispose() {
    this.container.remove();
  }
}
