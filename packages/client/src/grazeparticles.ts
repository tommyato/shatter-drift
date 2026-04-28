/**
 * GrazeParticleStream — DOM particle pool that emits a stream from the player's
 * screen position toward the phase-bar HUD on each near-miss event.
 *
 * Intensity (0..1) scales the burst count: a wide miss inside the graze band
 * emits a few; a razor-thin miss emits a burst. On arrival each particle pulses
 * the bar fill briefly.
 *
 * Implementation: 64 absolute-positioned divs pre-created inside a container.
 * Each particle stores its from/to/start time/duration; update() advances
 * position via lerp + slight upward arc and fades alpha out near the end.
 *
 * Also used for gem→score trail with different colors.
 */

const POOL_SIZE = 64;
const PARTICLE_DURATION = 0.42; // seconds, player → bar
const ARC_HEIGHT_PX = 60;       // peak of the parabolic arc

interface Particle {
  el: HTMLDivElement;
  active: boolean;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  size: number;
  elapsed: number;
  duration: number;
  jitterX: number; // small random offset along travel
}

interface ParticleStreamConfig {
  color: string;         // particle base color
  glowColor: string;     // glow/shadow color
  glowSize: string;      // e.g. "6px" for inner, "12px" for outer
  zIndex: string;        // CSS z-index for container
}

export class GrazeParticleStream {
  private container: HTMLDivElement;
  private particles: Particle[] = [];
  private targetEl: HTMLElement | null = null;
  private targetPulseEl: HTMLElement | null = null;
  private pulseTimer = 0;
  private config: ParticleStreamConfig;

  constructor(parent: HTMLElement, config?: Partial<ParticleStreamConfig>) {
    // Default: cyan graze particles
    this.config = {
      color: config?.color ?? "#66f5ff",
      glowColor: config?.glowColor ?? "#00ccff",
      glowSize: config?.glowSize ?? "6px",
      zIndex: config?.zIndex ?? "25",
    };

    this.container = document.createElement("div");
    this.container.className = "particle-stream";
    this.container.style.cssText = [
      "position: absolute",
      "top: 0",
      "left: 0",
      "width: 100%",
      "height: 100%",
      "pointer-events: none",
      `z-index: ${this.config.zIndex}`, // above HUD bits, below center messages
      "overflow: hidden",
    ].join(";");
    parent.appendChild(this.container);

    for (let i = 0; i < POOL_SIZE; i++) {
      const el = document.createElement("div");
      const shadowSize = parseInt(this.config.glowSize, 10) || 6;
      const outerSize = shadowSize * 2;
      el.style.cssText = [
        "position: absolute",
        "border-radius: 50%",
        `background: ${this.config.color}`,
        `box-shadow: 0 0 ${shadowSize}px ${this.config.glowColor}, 0 0 ${outerSize}px rgba(${this.hexToRgb(this.config.glowColor)},0.6)`,
        "opacity: 0",
        "will-change: transform, opacity",
        "pointer-events: none",
      ].join(";");
      this.container.appendChild(el);
      this.particles.push({
        el, active: false,
        fromX: 0, fromY: 0, toX: 0, toY: 0,
        size: 4, elapsed: 0, duration: PARTICLE_DURATION, jitterX: 0,
      });
    }
  }

  private hexToRgb(hex: string): string {
    const cleaned = hex.replace("#", "");
    const r = parseInt(cleaned.substring(0, 2), 16);
    const g = parseInt(cleaned.substring(2, 4), 16);
    const b = parseInt(cleaned.substring(4, 6), 16);
    return `${r},${g},${b}`;
  }

  /** Cache the target HUD element and optional pulse element. */
  setTarget(targetEl: HTMLElement, pulseEl?: HTMLElement) {
    this.targetEl = targetEl;
    this.targetPulseEl = pulseEl ?? null;
  }

  /** Backwards-compat alias for graze stream. */
  setBarTarget(barEl: HTMLElement, fillEl: HTMLElement | null) {
    this.setTarget(barEl, fillEl ?? undefined);
  }

  /**
   * Emit a burst of particles from a screen-space (px) position toward the
   * cached target element. Intensity scales count and size.
   * @param fromX  body-relative x in px
   * @param fromY  body-relative y in px
   * @param intensity 0..1 — proximity ratio (1 = razor-thin miss) or combo scale
   */
  emit(fromX: number, fromY: number, intensity: number) {
    if (!this.targetEl) return;
    const parentRect = this.container.getBoundingClientRect();
    const targetRect = this.targetEl.getBoundingClientRect();
    // Aim near center or right edge depending on target shape
    const toX = targetRect.left + targetRect.width * 0.8 - parentRect.left;
    const toY = targetRect.top + targetRect.height / 2 - parentRect.top;

    const clamped = Math.max(0, Math.min(1, intensity));
    const count = Math.round(4 + clamped * 12); // 4 → 16
    const baseSize = 3 + clamped * 3;            // 3 → 6 px
    const dur = PARTICLE_DURATION + Math.random() * 0.08;

    let spawned = 0;
    for (const p of this.particles) {
      if (spawned >= count) break;
      if (p.active) continue;
      p.active = true;
      p.fromX = fromX + (Math.random() - 0.5) * 14;
      p.fromY = fromY + (Math.random() - 0.5) * 14;
      p.toX = toX + (Math.random() - 0.5) * 6;
      p.toY = toY + (Math.random() - 0.5) * 6;
      p.size = baseSize + Math.random() * 2;
      p.elapsed = 0;
      p.duration = dur + Math.random() * 0.1;
      p.jitterX = (Math.random() - 0.5) * 24;
      p.el.style.width = `${p.size}px`;
      p.el.style.height = `${p.size}px`;
      spawned++;
    }
    // Light pulse on arrival — strongest pulse triggers when particles land.
    this.pulseTimer = Math.max(this.pulseTimer, 0.18 + clamped * 0.12);
  }

  update(dt: number) {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.elapsed += dt;
      const t = Math.min(1, p.elapsed / p.duration);
      // Ease out cubic for arrival feel
      const e = 1 - Math.pow(1 - t, 3);
      const x = p.fromX + (p.toX - p.fromX) * e + p.jitterX * Math.sin(t * Math.PI);
      // Parabolic upward arc: y dips up at midpoint, lands on toY
      const arc = -Math.sin(t * Math.PI) * ARC_HEIGHT_PX;
      const y = p.fromY + (p.toY - p.fromY) * e + arc;
      // Fade in fast, fade out near end
      const fade = t < 0.15 ? t / 0.15 : t > 0.7 ? (1 - t) / 0.3 : 1;
      p.el.style.transform = `translate(${x}px, ${y}px)`;
      p.el.style.opacity = String(fade);
      if (t >= 1) {
        p.active = false;
        p.el.style.opacity = "0";
      }
    }
    // Target pulse: brighten + tiny scale on the pulse element while pulseTimer > 0
    if (this.pulseTimer > 0) {
      this.pulseTimer = Math.max(0, this.pulseTimer - dt);
      if (this.targetPulseEl) {
        const k = this.pulseTimer / 0.3; // 0..1ish
        const k01 = Math.max(0, Math.min(1, k));
        this.targetPulseEl.style.filter = `brightness(${1 + k01 * 0.8}) saturate(${1 + k01 * 0.5})`;
        this.targetPulseEl.style.transform = `scale(${1 + k01 * 0.15})`;
      }
    } else if (this.targetPulseEl && this.targetPulseEl.style.filter) {
      this.targetPulseEl.style.filter = "";
      this.targetPulseEl.style.transform = "";
    }
  }

  clearAll() {
    for (const p of this.particles) {
      p.active = false;
      p.el.style.opacity = "0";
    }
    this.pulseTimer = 0;
    if (this.targetPulseEl) {
      this.targetPulseEl.style.filter = "";
      this.targetPulseEl.style.transform = "";
    }
  }
}
