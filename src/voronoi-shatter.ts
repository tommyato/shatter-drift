import * as THREE from "three";
import type { Obstacle } from "./world";
import { SHARD_PLASMA_FRAGMENT, SHARD_PLASMA_VERTEX } from "./shaders";

// --- 2D vector helpers ---

interface Vec2 { x: number; y: number }

function v2(x: number, y: number): Vec2 { return { x, y }; }
function dot2(a: Vec2, b: Vec2) { return a.x * b.x + a.y * b.y; }
function sub2(a: Vec2, b: Vec2): Vec2 { return v2(a.x - b.x, a.y - b.y); }
function add2(a: Vec2, b: Vec2): Vec2 { return v2(a.x + b.x, a.y + b.y); }
function scale2(a: Vec2, s: number): Vec2 { return v2(a.x * s, a.y * s); }

/**
 * Clip polygon by half-plane defined by: dot(p - pt, normal) >= 0
 * (Sutherland-Hodgman single-plane clip)
 */
function clipPolygonByHalfPlane(poly: Vec2[], pt: Vec2, normal: Vec2): Vec2[] {
  if (poly.length === 0) return [];
  const out: Vec2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const curr = poly[i];
    const next = poly[(i + 1) % n];
    const dCurr = dot2(sub2(curr, pt), normal);
    const dNext = dot2(sub2(next, pt), normal);
    if (dCurr >= 0) out.push(curr);
    if ((dCurr >= 0) !== (dNext >= 0)) {
      // Edge crosses the plane — compute intersection
      const t = dCurr / (dCurr - dNext);
      out.push(add2(curr, scale2(sub2(next, curr), t)));
    }
  }
  return out;
}

/**
 * Compute Voronoi cells for `seeds` within rect [-hw,hw] x [-hh,hh].
 * Returns one convex polygon per seed (in 2D, XY coords relative to rect center).
 */
function computeVoronoiCells(seeds: Vec2[], hw: number, hh: number): Vec2[][] {
  const cells: Vec2[][] = [];
  const rectPoly: Vec2[] = [
    v2(-hw, -hh), v2(hw, -hh), v2(hw, hh), v2(-hw, hh),
  ];

  for (let i = 0; i < seeds.length; i++) {
    let cell = rectPoly.slice();
    for (let j = 0; j < seeds.length; j++) {
      if (i === j) continue;
      // Perpendicular bisector between seeds[i] and seeds[j]
      const mid = scale2(add2(seeds[i], seeds[j]), 0.5);
      const normal = sub2(seeds[i], seeds[j]); // points toward seeds[i]
      cell = clipPolygonByHalfPlane(cell, mid, normal);
      if (cell.length === 0) break;
    }
    if (cell.length >= 3) cells.push(cell);
  }
  return cells;
}

/**
 * Build a BufferGeometry for an extruded 2D polygon (prism).
 * poly: 2D XY points (CCW or CW — we handle both winding via double-sided or flipping)
 * depth: extrusion depth along Z
 * The front face is at z=+depth/2, back at z=-depth/2.
 */
function buildExtrudedGeometry(poly: Vec2[], depth: number): THREE.BufferGeometry {
  const n = poly.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const halfD = depth / 2;

  // Compute centroid for fan triangulation
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;

  // --- Front face (z = +halfD, normal = 0,0,1) ---
  const frontStart = 0;
  // centroid vertex first, then outline
  positions.push(cx, cy, halfD);
  normals.push(0, 0, 1);
  for (const p of poly) {
    positions.push(p.x, p.y, halfD);
    normals.push(0, 0, 1);
  }
  for (let i = 0; i < n; i++) {
    indices.push(frontStart, frontStart + 1 + i, frontStart + 1 + ((i + 1) % n));
  }

  // --- Back face (z = -halfD, normal = 0,0,-1) ---
  const backStart = n + 1;
  positions.push(cx, cy, -halfD);
  normals.push(0, 0, -1);
  for (const p of poly) {
    positions.push(p.x, p.y, -halfD);
    normals.push(0, 0, -1);
  }
  for (let i = 0; i < n; i++) {
    // reverse winding for back face
    indices.push(backStart, backStart + 1 + ((i + 1) % n), backStart + 1 + i);
  }

  // --- Side walls ---
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    // Side edge normal (outward in XY plane)
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.sqrt(ex * ex + ey * ey) || 1;
    const nx = ey / len, ny = -ex / len;

    const base = (positions.length / 3);
    // 4 vertices: a_front, b_front, b_back, a_back
    positions.push(a.x, a.y, halfD);   normals.push(nx, ny, 0);
    positions.push(b.x, b.y, halfD);   normals.push(nx, ny, 0);
    positions.push(b.x, b.y, -halfD);  normals.push(nx, ny, 0);
    positions.push(a.x, a.y, -halfD);  normals.push(nx, ny, 0);

    indices.push(base, base + 1, base + 2);
    indices.push(base, base + 2, base + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal",   new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

// --- Shard physics state ---

interface Shard {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  ax: number; // angular velocity
  ay: number;
  az: number;
  age: number;       // seconds alive
  lifetime: number;  // fade-out duration
}

const SHARD_LIFETIME = 1.2;
const GRAVITY = -28;
const DRAG = 2.5;  // exponential drag coefficient — shards decelerate fast
const ANGULAR_DRAG = 4.0;  // angular velocity decays fast — heavy chunks don't spin like paper
const MAX_SHARDS = 80;

export class VoronoiShatter {
  private scene: THREE.Scene;
  private shards: Shard[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Fractures a single box mesh into Voronoi shards.
   * mesh: the BoxGeometry mesh to shatter (world-space position must be set)
   * impactPoint: world-space point of impact for scatter direction
   */
  shatterMesh(
    mesh: THREE.Mesh,
    impactPoint: THREE.Vector3,
    color: number,
    emissive: number,
    emissiveIntensity: number,
    forwardSpeed: number = 0
  ): void {
    const geo = mesh.geometry as THREE.BoxGeometry;
    if (!geo || !geo.parameters) return;

    const w = geo.parameters.width  ?? 1;
    const h = geo.parameters.height ?? 1;
    const d = geo.parameters.depth  ?? 1;

    // World-space center of this mesh
    const center = new THREE.Vector3();
    mesh.getWorldPosition(center);

    const hw = w / 2;
    const hh = h / 2;

    // 3-5 seeds = fewer, larger chunks that read as heavy wall pieces
    const seedCount = 3 + Math.floor(Math.random() * 3);
    const seeds: Vec2[] = [];
    for (let i = 0; i < seedCount; i++) {
      seeds.push(v2(
        (Math.random() - 0.5) * w * 0.9,
        (Math.random() - 0.5) * h * 0.9
      ));
    }

    const cells = computeVoronoiCells(seeds, hw, hh);

    for (const cell of cells) {
      // Check shard cap
      if (this.shards.length >= MAX_SHARDS) break;

      const shardGeo = buildExtrudedGeometry(cell, d);
      const mat = new THREE.ShaderMaterial({
        vertexShader: SHARD_PLASMA_VERTEX,
        fragmentShader: SHARD_PLASMA_FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uBaseColor: { value: new THREE.Color(color) },
          uEdgeColor: { value: new THREE.Color(emissive || color) },
          uOpacity: { value: 1.0 },
        },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const shardMesh = new THREE.Mesh(shardGeo, mat);
      // No artificial scale — shards are voronoi cells of the actual wall geometry,
      // so they naturally match the wall size. Slight bump for visual presence.
      shardMesh.scale.setScalar(1.1);

      // Position shard at wall's world position
      shardMesh.position.copy(center);
      // Rotate to match mesh orientation
      mesh.getWorldQuaternion(shardMesh.quaternion);

      this.scene.add(shardMesh);

      // Compute centroid of cell in wall-local XY, then world-space
      let cx = 0, cy = 0;
      for (const p of cell) { cx += p.x; cy += p.y; }
      cx /= cell.length; cy /= cell.length;

      // Direction from impact point to shard centroid
      const shardWorldPos = new THREE.Vector3(
        center.x + cx,
        center.y + cy,
        center.z
      );
      const dir = new THREE.Vector3().subVectors(shardWorldPos, impactPoint);
      dir.y = Math.abs(dir.y) * 0.3 - 0.2; // slight downward bias — debris falls
      const dirLen = dir.length() || 1;
      dir.divideScalar(dirLen);

      // Strong radial burst + forward punch. High initial speed + drag =
      // shards blast out then slow quickly, like real debris.
      const speed = 12 + Math.random() * 10;
      const jitter = () => (Math.random() - 0.5) * 6;

      this.shards.push({
        mesh: shardMesh,
        vx: dir.x * speed + jitter(),
        vy: dir.y * speed + Math.random() * 3,  // slight upward on impact
        vz: forwardSpeed + 14 + Math.random() * 10,
        // Heavy chunks tumble slowly — ±4 rad/s max, not ±30.
        // Angular drag decelerates them further. Rigid material feel.
        ax: (Math.random() - 0.5) * 8,
        ay: (Math.random() - 0.5) * 8,
        az: (Math.random() - 0.5) * 8,
        age: 0,
        lifetime: SHARD_LIFETIME * (0.8 + Math.random() * 0.4),
      });
    }
  }

  /**
   * Shatters the appropriate mesh(es) from an obstacle.
   * For gates (Groups), shatters the child mesh closest to impactX.
   * For pillars (single Mesh), shatters it directly.
   */
  shatterObstacle(
    obstacle: Obstacle,
    impactX: number,
    impactZ: number,
    biomeColors: { obstacleBase: number; obstacleEdge: number; obstacleEmissiveIntensity: number },
    forwardSpeed: number = 0
  ): void {
    const impactPoint = new THREE.Vector3(impactX, 1, impactZ);
    const { obstacleBase, obstacleEdge, obstacleEmissiveIntensity } = biomeColors;

    const obj = obstacle.mesh;

    if (obj instanceof THREE.Mesh && obj.geometry instanceof THREE.BoxGeometry) {
      // Single pillar
      this.shatterMesh(obj, impactPoint, obstacleBase, obstacleEdge, obstacleEmissiveIntensity, forwardSpeed);
    } else if (obj instanceof THREE.Group) {
      // Gate: find child mesh closest to impactX
      let closest: THREE.Mesh | null = null;
      let closestDist = Infinity;

      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry) {
          const worldPos = new THREE.Vector3();
          child.getWorldPosition(worldPos);
          const dist = Math.abs(worldPos.x - impactX);
          if (dist < closestDist) {
            closestDist = dist;
            closest = child as THREE.Mesh;
          }
        }
      });

      if (closest) {
        this.shatterMesh(closest, impactPoint, obstacleBase, obstacleEdge, obstacleEmissiveIntensity, forwardSpeed);
      }
    }
  }

  /** Advance physics, fade shards, remove expired ones */
  update(dt: number): void {
    const toRemove: number[] = [];

    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      s.age += dt;

      // Physics — drag decelerates shards so they don't float at constant speed
      const dragFactor = Math.exp(-DRAG * dt);
      const angDragFactor = Math.exp(-ANGULAR_DRAG * dt);
      s.vx *= dragFactor;
      s.vz *= dragFactor;
      s.vy += GRAVITY * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      // Angular drag — heavy chunks slow their spin, not spin forever like confetti
      s.ax *= angDragFactor;
      s.ay *= angDragFactor;
      s.az *= angDragFactor;
      s.mesh.rotation.x += s.ax * dt;
      s.mesh.rotation.y += s.ay * dt;
      s.mesh.rotation.z += s.az * dt;

      // Fade out
      const t = s.age / s.lifetime;
      const opacity = Math.max(0, 1 - t);
      if (s.mesh.material instanceof THREE.ShaderMaterial) {
        s.mesh.material.uniforms.uTime.value += dt;
        s.mesh.material.uniforms.uOpacity.value = opacity;
      }

      if (opacity <= 0 || s.mesh.position.y < -10) {
        toRemove.push(i);
      }
    }

    // Remove expired shards (iterate in reverse to keep indices valid)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      const s = this.shards[idx];
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
      this.shards.splice(idx, 1);
    }
  }

  /** Remove all active shards (e.g. on game reset) */
  reset(): void {
    for (const s of this.shards) {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    this.shards.length = 0;
  }

  dispose(): void {
    this.reset();
  }
}
