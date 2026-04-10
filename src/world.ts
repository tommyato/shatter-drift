import * as THREE from "three";

// --- Obstacle types ---

export interface Obstacle {
  mesh: THREE.Object3D;
  /** Z position in world (moves toward player) */
  z: number;
  /** Half-width for collision */
  halfWidth: number;
  /** Half-height for collision */
  halfHeight: number;
  /** X center position */
  x: number;
  /** Whether this is a "gate" (has a gap) */
  isGate: boolean;
  /** Gap center X (for gates) */
  gapX: number;
  /** Gap half-width */
  gapHalfWidth: number;
  active: boolean;
}

export interface EnergyOrb {
  mesh: THREE.Mesh;
  z: number;
  x: number;
  y: number;
  active: boolean;
  collected: boolean;
}

// --- Colors ---
const OBSTACLE_COLOR = 0x220033;
const OBSTACLE_EDGE_COLOR = 0x9933ff;
const ORB_COLOR = 0xffcc00;

// --- World generation ---

const SPAWN_DISTANCE = 80; // how far ahead to spawn
const DESPAWN_DISTANCE = -10; // how far behind to remove
const OBSTACLE_SPACING_MIN = 8;
const OBSTACLE_SPACING_MAX = 16;
const ORB_SPACING = 3;
const LANE_WIDTH = 9; // total playable width (-4.5 to 4.5)

export class World {
  obstacles: Obstacle[] = [];
  orbs: EnergyOrb[] = [];

  private scene: THREE.Scene;
  private nextObstacleZ = 30;
  private nextOrbZ = 15;
  private difficulty = 0; // 0-1, increases over time

  // Object pools
  private obstaclePool: Obstacle[] = [];
  private orbPool: EnergyOrb[] = [];

  // Starfield
  private starfield!: THREE.Points;

  // Ground grid lines for motion perception
  private gridLines: THREE.LineSegments[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.createStarfield();
    this.createGridLines();
  }

  private createStarfield() {
    const count = 2000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 100 + 20;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;

      const brightness = 0.3 + Math.random() * 0.7;
      // Slight color variation (blue/white/cyan)
      colors[i * 3] = brightness * (0.7 + Math.random() * 0.3);
      colors[i * 3 + 1] = brightness * (0.8 + Math.random() * 0.2);
      colors[i * 3 + 2] = brightness;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
    });

    this.starfield = new THREE.Points(geo, mat);
    this.scene.add(this.starfield);
  }

  private createGridLines() {
    // Create scrolling grid on the "floor" for speed perception
    const lineCount = 40;
    const lineSpacing = 4;

    for (let i = 0; i < lineCount; i++) {
      const points = [
        new THREE.Vector3(-LANE_WIDTH, -1.5, i * lineSpacing),
        new THREE.Vector3(LANE_WIDTH, -1.5, i * lineSpacing),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: 0x112233,
        transparent: true,
        opacity: 0.3,
      });
      const line = new THREE.LineSegments(geo, mat);
      this.scene.add(line);
      this.gridLines.push(line);
    }
  }

  setDifficulty(d: number) {
    this.difficulty = THREE.MathUtils.clamp(d, 0, 1);
  }

  update(dt: number, playerZ: number, speed: number) {
    // Generate obstacles ahead
    while (this.nextObstacleZ < playerZ + SPAWN_DISTANCE) {
      this.spawnObstacle(this.nextObstacleZ);
      const spacing = THREE.MathUtils.lerp(
        OBSTACLE_SPACING_MAX,
        OBSTACLE_SPACING_MIN,
        this.difficulty
      );
      this.nextObstacleZ += spacing + (Math.random() - 0.5) * 4;
    }

    // Generate orbs
    while (this.nextOrbZ < playerZ + SPAWN_DISTANCE) {
      this.spawnOrbCluster(this.nextOrbZ);
      this.nextOrbZ += ORB_SPACING + Math.random() * 5;
    }

    // Update orb rotation
    for (const orb of this.orbs) {
      if (!orb.active) continue;
      orb.mesh.rotation.y += dt * 2;
      orb.mesh.rotation.x += dt * 0.5;
      // Pulse scale
      const pulse = 1 + Math.sin(performance.now() * 0.005 + orb.x * 10) * 0.15;
      orb.mesh.scale.setScalar(pulse);
    }

    // Despawn behind player
    for (const obs of this.obstacles) {
      if (obs.active && obs.z < playerZ + DESPAWN_DISTANCE) {
        obs.active = false;
        obs.mesh.visible = false;
      }
    }
    for (const orb of this.orbs) {
      if (orb.active && orb.z < playerZ + DESPAWN_DISTANCE) {
        orb.active = false;
        orb.mesh.visible = false;
      }
    }

    // Update grid lines to create scrolling effect
    for (const line of this.gridLines) {
      // Keep grid lines relative to player position
      const baseZ = Math.floor(playerZ / 4) * 4;
      const offset = line.position.z;
      // wrap around
    }
  }

  private spawnObstacle(z: number) {
    const type = Math.random();

    if (type < 0.4) {
      // Wall with gap (gate)
      this.spawnGate(z);
    } else if (type < 0.7) {
      // Single pillar
      this.spawnPillar(z);
    } else if (type < 0.85) {
      // Double pillar
      this.spawnDoublePillar(z);
    } else {
      // Low bar (jump-like, but player dodges sideways)
      this.spawnWideBar(z);
    }
  }

  private spawnGate(z: number) {
    const gapX = (Math.random() - 0.5) * 5;
    const gapWidth = THREE.MathUtils.lerp(4, 2.5, this.difficulty);
    const wallHeight = 3;
    const wallThickness = 0.6;

    const group = new THREE.Group();
    group.position.z = z;

    // Left wall
    const leftWidth = (gapX - gapWidth / 2) + LANE_WIDTH / 2 + 1;
    if (leftWidth > 0.5) {
      const leftX = -LANE_WIDTH / 2 - 1 + leftWidth / 2;
      group.add(this.createObstacleMesh(leftWidth, wallHeight, wallThickness, leftX, 0));
    }

    // Right wall
    const rightStart = gapX + gapWidth / 2;
    const rightWidth = LANE_WIDTH / 2 + 1 - rightStart;
    if (rightWidth > 0.5) {
      const rightX = rightStart + rightWidth / 2;
      group.add(this.createObstacleMesh(rightWidth, wallHeight, wallThickness, rightX, 0));
    }

    this.scene.add(group);

    this.obstacles.push({
      mesh: group,
      z,
      halfWidth: LANE_WIDTH,
      halfHeight: wallHeight / 2,
      x: 0,
      isGate: true,
      gapX,
      gapHalfWidth: gapWidth / 2,
      active: true,
    });
  }

  private spawnPillar(z: number) {
    const x = (Math.random() - 0.5) * 6;
    const width = 1 + Math.random() * 1.5;
    const height = 2 + Math.random() * 2;

    const mesh = this.createObstacleMesh(width, height, 0.8, 0, 0);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);

    this.obstacles.push({
      mesh,
      z,
      halfWidth: width / 2,
      halfHeight: height / 2,
      x,
      isGate: false,
      gapX: 0,
      gapHalfWidth: 0,
      active: true,
    });
  }

  private spawnDoublePillar(z: number) {
    const spread = 2 + Math.random() * 2;
    const offset = (Math.random() - 0.5) * 2;

    // Left pillar
    this.spawnPillarAt(z, offset - spread, 1 + Math.random());
    // Right pillar
    this.spawnPillarAt(z, offset + spread, 1 + Math.random());
  }

  private spawnPillarAt(z: number, x: number, width: number) {
    const height = 2 + Math.random() * 2;
    const mesh = this.createObstacleMesh(width, height, 0.8, 0, 0);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);

    this.obstacles.push({
      mesh,
      z,
      halfWidth: width / 2,
      halfHeight: height / 2,
      x,
      isGate: false,
      gapX: 0,
      gapHalfWidth: 0,
      active: true,
    });
  }

  private spawnWideBar(z: number) {
    const gapSide = Math.random() < 0.5 ? -1 : 1;
    const gapX = gapSide * (2 + Math.random() * 2);

    const width = LANE_WIDTH * 2;
    const height = 1.5;

    const group = new THREE.Group();
    group.position.z = z;

    // Bar spanning most of the width with a gap on one side
    const barX = -gapSide * 1;
    group.add(this.createObstacleMesh(width * 0.6, height, 0.5, barX, 0));

    this.scene.add(group);

    this.obstacles.push({
      mesh: group,
      z,
      halfWidth: width * 0.3,
      halfHeight: height / 2,
      x: barX,
      isGate: true,
      gapX,
      gapHalfWidth: 2,
      active: true,
    });
  }

  private createObstacleMesh(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color: OBSTACLE_COLOR,
      emissive: OBSTACLE_EDGE_COLOR,
      emissiveIntensity: 0.15,
      metalness: 0.9,
      roughness: 0.3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, 0);

    // Add edge glow wireframe
    const edgeGeo = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({
      color: OBSTACLE_EDGE_COLOR,
      transparent: true,
      opacity: 0.6,
    });
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    edges.position.copy(mesh.position);
    mesh.add(edges);
    edges.position.set(0, 0, 0);

    return mesh;
  }

  private spawnOrbCluster(z: number) {
    const count = 1 + Math.floor(Math.random() * 3);
    const baseX = (Math.random() - 0.5) * 6;

    for (let i = 0; i < count; i++) {
      const x = baseX + (i - (count - 1) / 2) * 1.5;
      this.spawnOrb(z + i * 1.5, x);
    }
  }

  private spawnOrb(z: number, x: number) {
    const geo = new THREE.OctahedronGeometry(0.25, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: ORB_COLOR,
      emissive: ORB_COLOR,
      emissiveIntensity: 0.8,
      metalness: 0.5,
      roughness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.5 + Math.random() * 0.5, z);
    this.scene.add(mesh);

    this.orbs.push({
      mesh,
      z,
      x,
      y: mesh.position.y,
      active: true,
      collected: false,
    });
  }

  /** Check collision between player and obstacles */
  checkObstacleCollision(playerX: number, playerZ: number, playerRadius: number): Obstacle | null {
    for (const obs of this.obstacles) {
      if (!obs.active) continue;

      const dz = Math.abs(playerZ - obs.z);
      if (dz > 2) continue; // Too far in Z

      if (obs.isGate) {
        // Gate: player must be in the gap
        const dx = Math.abs(playerX - obs.gapX);
        if (dx > obs.gapHalfWidth - playerRadius) {
          // Outside the gap = collision
          return obs;
        }
      } else {
        // Pillar: check bounding box
        const dx = Math.abs(playerX - obs.x);
        if (dx < obs.halfWidth + playerRadius) {
          return obs;
        }
      }
    }
    return null;
  }

  /** Check collection of energy orbs */
  checkOrbCollection(playerX: number, playerZ: number, collectRadius: number): EnergyOrb[] {
    const collected: EnergyOrb[] = [];
    for (const orb of this.orbs) {
      if (!orb.active || orb.collected) continue;

      const dx = playerX - orb.x;
      const dz = playerZ - orb.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < collectRadius + 0.3) {
        orb.collected = true;
        orb.active = false;
        orb.mesh.visible = false;
        collected.push(orb);
      }
    }
    return collected;
  }

  /** Check close calls (passing through obstacle while shattered) */
  checkCloseCall(playerX: number, playerZ: number): boolean {
    for (const obs of this.obstacles) {
      if (!obs.active) continue;
      const dz = Math.abs(playerZ - obs.z);
      if (dz > 1.5) continue;

      if (obs.isGate) {
        const dx = Math.abs(playerX - obs.gapX);
        if (dx > obs.gapHalfWidth - 0.3) return true;
      } else {
        const dx = Math.abs(playerX - obs.x);
        if (dx < obs.halfWidth + 0.8) return true;
      }
    }
    return false;
  }

  reset() {
    // Remove all obstacles and orbs
    for (const obs of this.obstacles) {
      this.scene.remove(obs.mesh);
    }
    for (const orb of this.orbs) {
      this.scene.remove(orb.mesh);
    }
    this.obstacles.length = 0;
    this.orbs.length = 0;
    this.nextObstacleZ = 30;
    this.nextOrbZ = 15;
    this.difficulty = 0;
  }

  dispose() {
    this.reset();
    if (this.starfield) {
      this.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      (this.starfield.material as THREE.Material).dispose();
    }
    for (const line of this.gridLines) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
  }
}
