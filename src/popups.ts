/**
 * Floating score popups — the #1 missing arcade game feel element.
 * Shows "+100", "CLOSE CALL!", "x5 COMBO!", etc. with animated float-up + fade.
 */

interface Popup {
  el: HTMLElement;
  life: number;
  maxLife: number;
  x: number;
  startY: number;
}

const MAX_POPUPS = 4;

export class ScorePopups {
  private container: HTMLElement;
  private popups: Popup[] = [];

  constructor() {
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: fixed; inset: 0;
      pointer-events: none; z-index: 28;
      overflow: hidden;
    `;
    document.body.appendChild(this.container);
  }

  /** Show a score popup at screen position */
  show(
    text: string,
    screenX: number,
    screenY: number,
    color: string = "#ffcc00",
    size: number = 20,
    duration: number = 0.5
  ) {
    // Recycle oldest if at limit
    if (this.popups.length >= MAX_POPUPS) {
      const old = this.popups.shift()!;
      old.el.remove();
    }

    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = `
      position: absolute;
      left: ${screenX}px;
      top: ${screenY}px;
      font-family: 'Orbitron', monospace;
      font-size: ${size}px;
      font-weight: 900;
      color: ${color};
      text-shadow: 0 0 12px ${color}, 0 0 24px ${color}44;
      pointer-events: none;
      white-space: nowrap;
      transform: translate(-50%, 0) scale(0.5);
      opacity: 0;
      will-change: transform, opacity;
    `;
    this.container.appendChild(el);

    const popup: Popup = {
      el,
      life: duration,
      maxLife: duration,
      x: screenX,
      startY: screenY,
    };
    this.popups.push(popup);

    // Pop-in animation
    requestAnimationFrame(() => {
      el.style.transition = `transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.1s`;
      el.style.transform = `translate(-50%, 0) scale(1)`;
      el.style.opacity = "1";
    });
  }

  /** Show a popup anchored to a 3D world position — pushed to screen edges to avoid obstructing gameplay */
  showAt3D(
    text: string,
    worldX: number,
    worldZ: number,
    camera: THREE.Camera,
    color: string = "#ffcc00",
    size: number = 12
  ) {
    // Project world position to screen
    const vec = new THREE.Vector3(worldX, 1.5, worldZ);
    vec.project(camera);

    // Don't show if behind camera
    if (vec.z > 1) return;

    const halfW = window.innerWidth / 2;
    // Push popup to top margin — keeps it visible but out of the play area
    const sx = vec.x * halfW + halfW;
    const sy = Math.min(80, 40 + Math.random() * 40);

    this.show(text, sx, sy, color, size, 0.4);
  }

  /** Show a centered large popup (for milestones) — positioned in upper zone to avoid obstructing gameplay */
  showCenter(text: string, subtitle: string = "", color: string = "#ffcc00") {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * 0.22;
    this.show(text, cx, cy, color, 24, 0.6);
    if (subtitle) {
      this.show(subtitle, cx, cy + 30, "#aaccdd", 11, 0.6);
    }
  }

  update(dt: number) {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;

      const progress = 1 - p.life / p.maxLife;
      const floatY = p.startY - progress * 40; // float upward 40px

      // Fade out in last 30% of life
      const fadeStart = 0.7;
      const opacity = progress > fadeStart
        ? 1 - (progress - fadeStart) / (1 - fadeStart)
        : 1;

      p.el.style.transform = `translate(-50%, 0) scale(${1 - progress * 0.2})`;
      p.el.style.top = `${floatY}px`;
      p.el.style.opacity = String(Math.max(0, opacity));

      if (p.life <= 0) {
        p.el.remove();
        this.popups.splice(i, 1);
      }
    }
  }

  dispose() {
    this.container.remove();
  }
}

// Need THREE for 3D projections
import * as THREE from "three";
