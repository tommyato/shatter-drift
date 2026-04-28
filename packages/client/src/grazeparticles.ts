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

export class GrazeParticleStream {
  private container: HTMLDivElement;
  private particles: Particle[] = [];
  private barEl: HTMLElement | null = null;
  private barFillEl: HTMLElement | null = null;
  private pulseTimer = 0;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.id = "graze-particle-stream";
    this.container.style.cssText = [
      "position: absolute",
      "top: 0",
      "left: 0",
      "width: 100%",
      "height: 100%",
      "pointer-events: none",
      "z-index: 25", // above HUD bits, below center messages
      "overflow: hidden",
    ].join(";");
    parent.appendChild(this.container);

    for (let i = 0; i < POOL_SIZE; i++) {
      const el = document.createElement("div");
      el.style.cssText = [
        "position: absolute",
        "border-radius: 50%",
        "background: #66f5ff",
        "box-shadow: 0 0 6px #00ccff, 0 0 12px rgba(0,204,255,0.6)",
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

  /** Cache the phase-bar elements once they're in the DOM. */
  setBarTarget(barEl: HTMLElement, fillEl: HTMLElement | null) {
    this.barEl = barEl;
    this.barFillEl = fillEl;
  }

  /**
   * Emit a burst of particles from a screen-space (px) position toward the
   * cached phase bar. Intensity scales count and size.
   * @param fromX  body-relative x in px
   * @param fromY  body-relative y in px
   * @param intensity 0..1 — proximity ratio (1 = razor-thin miss)
   */
  emit(fromX: number, fromY: number, intensity: number) {
    if (!this.barEl) return;
    const parentRect = this.container.getBoundingClientRect();
    const barRect = this.barEl.getBoundingClientRect();
    // Aim near the right edge of the meter so particles "pour into" the fill.
    const toX = barRect.right - parentRect.left - 8;
    const toY = barRect.top + barRect.height / 2 - parentRect.top;

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
    // Bar fill pulse: brighten + tiny scale on the fill element while pulseTimer > 0
    if (this.pulseTimer > 0) {
      this.pulseTimer = Math.max(0, this.pulseTimer - dt);
      if (this.barFillEl) {
        const k = this.pulseTimer / 0.3; // 0..1ish
        const k01 = Math.max(0, Math.min(1, k));
        this.barFillEl.style.filter = `brightness(${1 + k01 * 0.8}) saturate(${1 + k01 * 0.5})`;
      }
    } else if (this.barFillEl && this.barFillEl.style.filter) {
      this.barFillEl.style.filter = "";
    }
  }

  clearAll() {
    for (const p of this.particles) {
      p.active = false;
      p.el.style.opacity = "0";
    }
    this.pulseTimer = 0;
    if (this.barFillEl) this.barFillEl.style.filter = "";
  }
}
