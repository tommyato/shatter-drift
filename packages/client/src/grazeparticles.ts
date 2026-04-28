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
   * @param side  optional spatial hint: -1 = particles came from player's left,
   *              +1 = right, 0 = no preference (default). Used to vary the
   *              spline so left grazes curve through the left side of the
   *              screen and right grazes through the right — instead of every
   *              trail tracing the same arc through the player's center.
   */
  emit(fromX: number, fromY: number, intensity: number, side: number = 0) {
    if (!this.targetEl) return;
    const parentRect = this.container.getBoundingClientRect();
    const targetRect = this.targetEl.getBoundingClientRect();
    // Aim at the middle of the target element. For the phase bar this means
    // particles land at the bar's center — symmetric, easier to read than the
    // old 80%-across aim, and pairs naturally with side-varied splines.
    const toX = targetRect.left + targetRect.width * 0.5 - parentRect.left;
    const toY = targetRect.top + targetRect.height / 2 - parentRect.top;

    const clamped = Math.max(0, Math.min(1, intensity));
    const count = Math.round(8 + clamped * 16); // 8 → 24 — louder so the trail reads at a glance
    const baseSize = 4 + clamped * 4;            // 4 → 8 px
    const dur = PARTICLE_DURATION + Math.random() * 0.08;

    // Side-biased lateral push: left grazes (side=-1) push the spline's mid
    // point further left before converging on the bar centre; right grazes do
    // the opposite. Magnitude scales with intensity so close calls swing
    // wider. Zero side ⇒ unbiased (gem→score uses this).
    const sideClamped = Math.max(-1, Math.min(1, side));
    const lateralPush = sideClamped * (60 + clamped * 60); // ±60..±120 px

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
      // Combine the side-biased push with a smaller jitter so neighbouring
      // particles still spread but the trail as a whole curves toward the
      // graze side. sin(t·π) profile in update() means jitterX peaks at
      // mid-arc — which is exactly where we want the lateral bow.
      p.jitterX = lateralPush + (Math.random() - 0.5) * 36;
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
    // Target pulse on arrival. Two layers, both visible regardless of
    // overflow:hidden on the bar wrapper:
    //   • drop-shadow on targetEl (outer) — expands OUTSIDE the element so
    //     the bar visibly halos brighter and bigger even though its 8 px
    //     height clips any inner transform.
    //   • brightness/saturate filter on targetPulseEl (inner) — the cyan
    //     fill gets noticeably hotter inside the bar.
    // For score (where targetEl === targetPulseEl) only one element animates.
    if (this.pulseTimer > 0) {
      this.pulseTimer = Math.max(0, this.pulseTimer - dt);
      const k = this.pulseTimer / 0.3; // 0..1ish
      const k01 = Math.max(0, Math.min(1, k));
      const blur = 8 + k01 * 22;       // 8 → 30 px outer halo
      const alpha = 0.4 + k01 * 0.5;   // 0.4 → 0.9
      const rgb = this.hexToRgb(this.config.glowColor);
      const dropShadow = `drop-shadow(0 0 ${blur.toFixed(1)}px rgba(${rgb},${alpha.toFixed(2)}))`;
      if (this.targetEl) {
        // Outer halo + slight brightness lift on the whole bar.
        this.targetEl.style.filter = `${dropShadow} brightness(${1 + k01 * 0.4})`;
      }
      if (this.targetPulseEl && this.targetPulseEl !== this.targetEl) {
        // Inner fill: punchier brightness/saturation since the bar is dim by
        // default (opacity 0.2..0.45) and the cyan fill is what we want to
        // see flash.
        this.targetPulseEl.style.filter = `brightness(${1 + k01 * 1.6}) saturate(${1 + k01 * 0.8})`;
      } else if (this.targetPulseEl) {
        this.targetPulseEl.style.filter = `${dropShadow} brightness(${1 + k01 * 1.4}) saturate(${1 + k01 * 0.6})`;
        // Score number is a standalone element with no clipping parent, so
        // the scale pop still reads.
        this.targetPulseEl.style.transform = `scale(${1 + k01 * 0.25})`;
      }
    } else {
      if (this.targetEl && this.targetEl.style.filter) {
        this.targetEl.style.filter = "";
      }
      if (this.targetPulseEl && (this.targetPulseEl.style.filter || this.targetPulseEl.style.transform)) {
        this.targetPulseEl.style.filter = "";
        this.targetPulseEl.style.transform = "";
      }
    }
  }

  clearAll() {
    for (const p of this.particles) {
      p.active = false;
      p.el.style.opacity = "0";
    }
    this.pulseTimer = 0;
    if (this.targetEl) {
      this.targetEl.style.filter = "";
    }
    if (this.targetPulseEl) {
      this.targetPulseEl.style.filter = "";
      this.targetPulseEl.style.transform = "";
    }
  }
}
