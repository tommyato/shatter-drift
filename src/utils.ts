import * as THREE from "three";

/**
 * Common utility functions for Three.js game jams.
 */

/** Create a basic box mesh with optional shadows */
export function createBox(
  width: number,
  height: number,
  depth: number,
  color: number | string = 0x888888,
  position?: [number, number, number]
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(width, height, depth);
  const mat = new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (position) mesh.position.set(...position);
  return mesh;
}

/** Create a sphere mesh */
export function createSphere(
  radius: number,
  color: number | string = 0x888888,
  position?: [number, number, number]
): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 32, 16);
  const mat = new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (position) mesh.position.set(...position);
  return mesh;
}

/** Create a cylinder mesh */
export function createCylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  color: number | string = 0x888888,
  position?: [number, number, number]
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 16);
  const mat = new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (position) mesh.position.set(...position);
  return mesh;
}

/** Lerp a value */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Smooth damp (like Unity's Mathf.SmoothDamp) */
export function smoothDamp(
  current: number,
  target: number,
  velocity: { value: number },
  smoothTime: number,
  dt: number,
  maxSpeed = Infinity
): number {
  const t = Math.max(0.0001, smoothTime);
  const omega = 2 / t;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let change = current - target;
  const maxChange = maxSpeed * t;
  change = clamp(change, -maxChange, maxChange);
  const temp = (velocity.value + omega * change) * dt;
  velocity.value = (velocity.value - omega * temp) * exp;
  let result = current - change + (change + temp) * exp;
  if (target - current > 0 === result > target) {
    result = target;
    velocity.value = (result - target) / dt;
  }
  return result;
}

/** Random float between min and max */
export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Random integer between min and max (inclusive) */
export function randomInt(min: number, max: number): number {
  return Math.floor(randomRange(min, max + 1));
}

/** Pick a random element from an array */
export function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Easing functions */
export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => t * (2 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => --t * t * t + 1,
  inOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  inElastic: (t: number) =>
    t === 0 || t === 1
      ? t
      : -Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI),
  outElastic: (t: number) =>
    t === 0 || t === 1
      ? t
      : Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1,
  outBounce: (t: number) => {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
    if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
    return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
  },
};

/** Screen shake helper — call each frame, applies to camera */
export class ScreenShake {
  intensity = 0;
  decay = 5; // how fast it fades

  trigger(intensity: number) {
    this.intensity = Math.max(this.intensity, intensity);
  }

  apply(camera: THREE.Camera, dt: number) {
    if (this.intensity > 0.001) {
      camera.position.x += (Math.random() - 0.5) * this.intensity;
      camera.position.y += (Math.random() - 0.5) * this.intensity;
      this.intensity *= Math.exp(-this.decay * dt);
    } else {
      this.intensity = 0;
    }
  }
}

/** Simple tween manager */
export interface Tween {
  from: number;
  to: number;
  duration: number;
  elapsed: number;
  easing: (t: number) => number;
  onUpdate: (value: number) => void;
  onComplete?: () => void;
}

export class TweenManager {
  private tweens: Tween[] = [];

  add(
    from: number,
    to: number,
    duration: number,
    onUpdate: (value: number) => void,
    easing: (t: number) => number = ease.outQuad,
    onComplete?: () => void
  ): Tween {
    const tween: Tween = { from, to, duration, elapsed: 0, easing, onUpdate, onComplete };
    this.tweens.push(tween);
    return tween;
  }

  update(dt: number) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i];
      t.elapsed += dt;
      const progress = clamp(t.elapsed / t.duration, 0, 1);
      const eased = t.easing(progress);
      t.onUpdate(lerp(t.from, t.to, eased));
      if (progress >= 1) {
        t.onComplete?.();
        this.tweens.splice(i, 1);
      }
    }
  }

  clear() {
    this.tweens.length = 0;
  }
}

/** Timer helper — counts down and fires callback */
export class Timer {
  remaining: number;
  private callback: () => void;
  private repeat: boolean;
  private interval: number;
  active = true;

  constructor(seconds: number, callback: () => void, repeat = false) {
    this.remaining = seconds;
    this.interval = seconds;
    this.callback = callback;
    this.repeat = repeat;
  }

  update(dt: number): boolean {
    if (!this.active) return false;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.callback();
      if (this.repeat) {
        this.remaining += this.interval;
        return true;
      }
      this.active = false;
      return true;
    }
    return false;
  }

  reset() {
    this.remaining = this.interval;
    this.active = true;
  }
}
