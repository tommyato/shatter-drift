/**
 * Unlockable cosmetics — trail colors and crystal skins
 * earned through challenges. Gives tangible progression.
 */

export interface TrailStyle {
  id: string;
  name: string;
  color: number;
  /** Secondary color for rainbow/multi effects */
  color2?: number;
  /** Whether color cycles over time */
  rainbow?: boolean;
  /** Particle size multiplier */
  size?: number;
}

export interface CrystalSkin {
  id: string;
  name: string;
  bodyColor: number;
  emissiveColor: number;
  emissiveIntensity: number;
  /** Optional: add wireframe overlay */
  wireframe?: boolean;
  /** Optional: pulse rate multiplier */
  pulseRate?: number;
}

export const TRAIL_STYLES: Record<string, TrailStyle> = {
  default: { id: "default", name: "Default", color: 0x00ffcc },
  cyan: { id: "cyan", name: "Cyan Pulse", color: 0x00ffff, size: 1.2 },
  emerald: { id: "emerald", name: "Emerald", color: 0x00ff66 },
  gold: { id: "gold", name: "Gold Rush", color: 0xffcc00, size: 1.1 },
  ghost: { id: "ghost", name: "Ghostly", color: 0xaabbff, size: 0.8 },
  electric: { id: "electric", name: "Electric", color: 0x4488ff, color2: 0xffffff, size: 1.3 },
  diamond: { id: "diamond", name: "Diamond", color: 0xccddff, size: 0.7 },
  plasma: { id: "plasma", name: "Plasma", color: 0xff44ff, color2: 0x4400ff, size: 1.4 },
  rainbow: { id: "rainbow", name: "Rainbow", color: 0xff0000, rainbow: true, size: 1.2 },
  supernova: { id: "supernova", name: "Supernova", color: 0xffff00, color2: 0xff4400, size: 1.5 },
  warp: { id: "warp", name: "Warp Drive", color: 0x8844ff, color2: 0x00ccff, size: 1.3 },
};

export const CRYSTAL_SKINS: Record<string, CrystalSkin> = {
  default: {
    id: "default",
    name: "Default",
    bodyColor: 0x003322,
    emissiveColor: 0x00ffcc,
    emissiveIntensity: 0.3,
  },
  prism: {
    id: "prism",
    name: "Prism",
    bodyColor: 0x111133,
    emissiveColor: 0x8866ff,
    emissiveIntensity: 0.5,
    wireframe: true,
  },
  flame: {
    id: "flame",
    name: "Flame",
    bodyColor: 0x331100,
    emissiveColor: 0xff6600,
    emissiveIntensity: 0.6,
    pulseRate: 2.0,
  },
  phantom: {
    id: "phantom",
    name: "Phantom",
    bodyColor: 0x0a0a1a,
    emissiveColor: 0x8888ff,
    emissiveIntensity: 0.2,
  },
  blaze: {
    id: "blaze",
    name: "Blaze",
    bodyColor: 0x220000,
    emissiveColor: 0xff2200,
    emissiveIntensity: 0.7,
    pulseRate: 3.0,
  },
  aurora: {
    id: "aurora",
    name: "Aurora",
    bodyColor: 0x001122,
    emissiveColor: 0x00ffaa,
    emissiveIntensity: 0.5,
    wireframe: true,
    pulseRate: 0.5,
  },
  veteran: {
    id: "veteran",
    name: "Veteran",
    bodyColor: 0x222222,
    emissiveColor: 0xffcc00,
    emissiveIntensity: 0.4,
  },
};

export class UnlockManager {
  private selectedTrail: string;
  private selectedCrystal: string;

  constructor() {
    this.selectedTrail = localStorage.getItem("shatterDriftTrail") || "default";
    this.selectedCrystal = localStorage.getItem("shatterDriftCrystal") || "default";
  }

  getSelectedTrail(): TrailStyle {
    return TRAIL_STYLES[this.selectedTrail] || TRAIL_STYLES.default;
  }

  getSelectedCrystal(): CrystalSkin {
    return CRYSTAL_SKINS[this.selectedCrystal] || CRYSTAL_SKINS.default;
  }

  selectTrail(id: string) {
    if (TRAIL_STYLES[id]) {
      this.selectedTrail = id;
      localStorage.setItem("shatterDriftTrail", id);
    }
  }

  selectCrystal(id: string) {
    if (CRYSTAL_SKINS[id]) {
      this.selectedCrystal = id;
      localStorage.setItem("shatterDriftCrystal", id);
    }
  }

  /** Get the current trail color, accounting for rainbow/time effects */
  getTrailColor(time: number): number {
    const style = this.getSelectedTrail();
    if (style.rainbow) {
      const hue = (time * 0.2) % 1;
      return hslToHex(hue, 1, 0.5);
    }
    if (style.color2) {
      const t = (Math.sin(time * 3) + 1) / 2;
      return lerpColor(style.color, style.color2, t);
    }
    return style.color;
  }

  getTrailSize(): number {
    return this.getSelectedTrail().size ?? 1;
  }
}

function hslToHex(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 1/6) { r = c; g = x; }
  else if (h < 2/6) { r = x; g = c; }
  else if (h < 3/6) { g = c; b = x; }
  else if (h < 4/6) { g = x; b = c; }
  else if (h < 5/6) { r = x; b = c; }
  else { r = c; b = x; }
  return (
    (Math.round((r + m) * 255) << 16) |
    (Math.round((g + m) * 255) << 8) |
    Math.round((b + m) * 255)
  );
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}
