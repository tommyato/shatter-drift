import * as THREE from "three";
import { BiomeManager } from "./biomes";
import { PLASMA_OBSTACLE_FRAGMENT, PLASMA_VERTEX } from "./shaders";
import { VoronoiShatter } from "./voronoi-shatter";

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

// --- Vibeverse portal ---

export interface VibeversePortal {
  group: THREE.Group;
  z: number;
  x: number;
  active: boolean;
  ring: THREE.Mesh;
}

// --- World generation ---

const SPAWN_DISTANCE = 80; // how far ahead to spawn
const DESPAWN_DISTANCE = -10; // how far behind to remove
const ORB_SPACING = 3;
const LANE_WIDTH = 9; // total playable width (-4.5 to 4.5)
const PORTAL_INTERVAL = 300; // meters between portal appearances

const GRID_FLOOR_VERTEX = /* glsl */ `
varying vec2 vWorldXZ;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldXZ = worldPos.xz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const GRID_FLOOR_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vWorldXZ;

uniform float uTime;
uniform float uPlayerZ;
uniform float uPlayerX;
uniform vec3 uGridColor;
uniform float uGridOpacity;

void main() {
  float cellSize = 4.0;
  vec2 p = vWorldXZ / cellSize;

  // Anti-aliased grid lines
  // min(fract(p), 1 - fract(p)) = distance to nearest integer (0 at line, 0.5 at cell center)
  vec2 f = fract(p);
  vec2 lineT = min(f, 1.0 - f);
  vec2 fw = max(fwidth(p), vec2(0.001));

  float lineWidth = 0.04; // 4% of cellSize = 0.16 world units per line
  float lineX = 1.0 - smoothstep(lineWidth, lineWidth + fw.x * 2.0, lineT.x);
  float lineZ = 1.0 - smoothstep(lineWidth, lineWidth + fw.y * 2.0, lineT.y);
  float line = max(lineX, lineZ);

  // Intersection glow — crossings are brighter than individual lines
  float intersection = lineX * lineZ;

  // Player proximity glow — lines near the player are brighter
  float dx = vWorldXZ.x - uPlayerX;
  float dz = vWorldXZ.y - uPlayerZ;
  float dist2 = dx * dx + dz * dz;
  float distFromPlayer = sqrt(dist2);
  float proximityGlow = exp(-dist2 / (18.0 * 18.0));

  // Vignette falloff — grid fades into darkness at the edges/distance
  float vignette = 1.0 - smoothstep(35.0, 80.0, distFromPlayer);

  // Subtle pulse animation
  float pulse = 0.88 + 0.12 * sin(uTime * 2.2);

  // Combine: line intensity + intersection bonus + proximity boost, all modulated by biome opacity
  float gridIntensity = (line + intersection * 0.5) * (1.0 + proximityGlow * 0.5) * vignette * pulse * uGridOpacity;

  // Output: additive grid lines (transparent background — scene darkness shows through)
  gl_FragColor = vec4(uGridColor, clamp(gridIntensity, 0.0, 1.0));
}
`;

const PLASMA_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vWorldPosition;

uniform float uTime;
uniform vec3 uBaseColor;
uniform vec3 uEdgeColor;
uniform vec3 uAccentColor;
uniform float uOpacity;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i + vec2(0.0, 0.0)), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = p * 2.02 + vec2(19.7, -11.3);
    amplitude *= 0.5;
  }
  return value;
}

mat2 rot(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

void main() {
  // Scale UVs for the wall — use world position for seamless tiling
  vec2 p = vUv * vec2(12.0, 3.5);  // stretch horizontally since walls are long
  
  float flowA = fbm(p + vec2(0.0, uTime * 0.72));
  float flowB = fbm((p + vec2(4.3, -2.1)) * rot(-0.2) - vec2(uTime * 0.4, -uTime * 0.28));
  float band = fbm(p * 2.2 + vec2(flowA * 2.4, flowB * 1.8));
  float heat = clamp(flowA * 0.55 + flowB * 0.4 + band * 0.65, 0.0, 1.0);
  
  // Vertical center weighting — brighter in the middle of the wall
  float centerWeight = smoothstep(0.88, 0.08, abs(vUv.y - 0.5) * 2.0);
  float turbulence = sin((flowA + flowB + band) * 10.0 - uTime * 3.6) * 0.5 + 0.5;
  
  vec3 color = mix(uBaseColor * 0.55, uEdgeColor, heat);
  color = mix(color, uAccentColor, turbulence * 0.25 + centerWeight * 0.18);
  color += uEdgeColor * centerWeight * 0.48;
  
  // Edge glow — brighter at top and bottom edges of wall
  float edgeDist = min(vUv.y, 1.0 - vUv.y);
  float edgeGlow = pow(1.0 - clamp(edgeDist * 4.0, 0.0, 1.0), 2.4);
  color += uEdgeColor * edgeGlow * 0.3;
  
  float alpha = uOpacity * (0.55 + heat * 0.2 + centerWeight * 0.15);

  gl_FragColor = vec4(color, alpha);
}
`;

const SCANLINES_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const SCANLINES_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vWorldPosition;

uniform float uTime;
uniform vec3 uBaseColor;
uniform vec3 uEdgeColor;
uniform vec3 uAccentColor;
uniform float uOpacity;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i + vec2(0.0, 0.0)), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  float lines = pow(clamp(sin((vUv.y * 84.0) - uTime * 6.2) * 0.5 + 0.5, 0.0, 1.0), 5.0);
  float shimmer = noise(vec2(vUv.x * 11.0 + uTime * 0.4, vUv.y * 19.0 - uTime * 1.7));
  float pulse = 0.5 + 0.5 * sin(uTime * 2.4 + vUv.y * 9.0);
  float streak = smoothstep(0.75, 1.0, sin((vUv.y + uTime * 0.65) * 20.0) * 0.5 + 0.5);

  vec3 color = mix(uBaseColor * 0.65, uEdgeColor, lines * 0.7 + pulse * 0.18);
  color += uAccentColor * streak * 0.45;
  color += uAccentColor * shimmer * 0.18;
  float alpha = uOpacity * (0.16 + lines * 0.2 + streak * 0.08 + pulse * 0.04);

  gl_FragColor = vec4(color, alpha);
}
`;

export class World {
  obstacles: Obstacle[] = [];
  orbs: EnergyOrb[] = [];
  portals: VibeversePortal[] = [];

  private scene: THREE.Scene;
  private biomes: BiomeManager;
  /** Seeded PRNG for deterministic world generation. Defaults to Math.random (normal mode). */
  private random: () => number = Math.random;
  private nextObstacleZ = 30;
  private nextOrbZ = 15;
  private nextPortalZ = PORTAL_INTERVAL;
  private nextMarkerZ = 100; // distance markers every 100m
  private cleanupTimer = 0; // periodic cleanup of inactive objects
  private plasmaElapsed = 0;

  // Starfield
  private starfield!: THREE.Points;
  private starColors!: Float32Array;
  private starBaseColors!: Float32Array;
  private starPhases!: Float32Array;

  // Shader-driven TRON grid floor
  private gridFloorMesh!: THREE.Mesh;
  private gridFloorMat!: THREE.ShaderMaterial;

  // Tunnel walls for depth perception
  private tunnelWalls: THREE.Mesh[] = [];
  private tunnelWallMats: THREE.ShaderMaterial[] = [];

  // Tunnel edge highlight lines
  private tunnelEdges: THREE.LineSegments[] = [];
  private tunnelEdgeMats: THREE.LineBasicMaterial[] = [];

  // Distance markers
  private markers: { group: THREE.Group; z: number; active: boolean }[] = [];

  private voronoiShatter!: VoronoiShatter;

  /** Replace the PRNG used for world generation. Call before each game start.
   *  Pass Math.random for normal mode, seededRandom(seed) for daily challenge. */
  setRandom(fn: () => number) {
    this.random = fn;
  }

  constructor(scene: THREE.Scene, biomes: BiomeManager) {
    this.scene = scene;
    this.biomes = biomes;
    this.voronoiShatter = new VoronoiShatter(scene);
    this.createStarfield();
    this.createShaderFloor();
    this.createTunnelWalls();
  }

  private createStarfield() {
    const count = 2500;
    const STAR_RADIUS = 150;
    const positions = new Float32Array(count * 3);
    this.starBaseColors = new Float32Array(count * 3);
    this.starColors = new Float32Array(count * 3);
    this.starPhases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = STAR_RADIUS * (0.8 + Math.random() * 0.2);
      const sinPhi = Math.sin(phi);

      positions[i * 3] = r * sinPhi * Math.cos(theta);
      positions[i * 3 + 1] = Math.abs(r * sinPhi * Math.sin(theta)) + 5;
      positions[i * 3 + 2] = r * Math.cos(phi);

      const brightness = 0.3 + Math.random() * 0.7;
      this.starBaseColors[i * 3] = brightness;
      this.starBaseColors[i * 3 + 1] = brightness;
      this.starBaseColors[i * 3 + 2] = brightness;
      this.starColors[i * 3] = brightness;
      this.starColors[i * 3 + 1] = brightness;
      this.starColors[i * 3 + 2] = brightness;
      this.starPhases[i] = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.starColors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.3,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
    });

    this.starfield = new THREE.Points(geo, mat);
    this.scene.add(this.starfield);
  }

  private createShaderFloor() {
    // Shader-driven TRON grid floor — replaces old grid lines + floor panels
    const floorGeo = new THREE.PlaneGeometry(LANE_WIDTH * 2.5, 300, 1, 1);
    const c = this.biomes.colors;
    this.gridFloorMat = new THREE.ShaderMaterial({
      vertexShader: GRID_FLOOR_VERTEX,
      fragmentShader: GRID_FLOOR_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uPlayerZ: { value: 0 },
        uPlayerX: { value: 0 },
        uGridColor: { value: new THREE.Color(c.gridColor) },
        uGridOpacity: { value: c.gridOpacity },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
    this.gridFloorMesh = new THREE.Mesh(floorGeo, this.gridFloorMat);
    this.gridFloorMesh.rotation.x = -Math.PI / 2;
    this.gridFloorMesh.position.y = -1.5;
    this.scene.add(this.gridFloorMesh);
  }

  private createTunnelWalls() {
    // Side walls that frame the play area — creates a tunnel/corridor feeling
    const wallHeight = 8;
    const wallLength = 300;
    const wallDistance = LANE_WIDTH / 2 + 1.5;
    const wallGeo = new THREE.PlaneGeometry(wallLength, wallHeight, 30, 4);

    for (const side of [-1, 1]) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: SCANLINES_VERTEX,
        fragmentShader: SCANLINES_FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uBaseColor: { value: new THREE.Color(0x7733cc) },
          uEdgeColor: { value: new THREE.Color(0xdd99ff) },
          uAccentColor: { value: new THREE.Color(0xff87f8) },
          uOpacity: { value: 0.25 },
        },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const wall = new THREE.Mesh(wallGeo, mat);
      wall.position.set(side * wallDistance, wallHeight / 2 - 1.5, 0);
      wall.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.scene.add(wall);
      this.tunnelWalls.push(wall);
      this.tunnelWallMats.push(mat);

      // Edge highlight line along the bottom of each wall for depth perception
      const edgePoints = [
        new THREE.Vector3(side * wallDistance, -1.5, -wallLength / 2),
        new THREE.Vector3(side * wallDistance, -1.5, wallLength / 2),
      ];
      const edgeGeo = new THREE.BufferGeometry().setFromPoints(edgePoints);
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x333355,
        transparent: true,
        opacity: 0.15,
      });
      const edge = new THREE.LineSegments(edgeGeo, edgeMat);
      this.scene.add(edge);
      this.tunnelEdges.push(edge);
      this.tunnelEdgeMats.push(edgeMat);

      // Upper edge highlight
      const upperPoints = [
        new THREE.Vector3(side * wallDistance, wallHeight - 1.5, -wallLength / 2),
        new THREE.Vector3(side * wallDistance, wallHeight - 1.5, wallLength / 2),
      ];
      const upperGeo = new THREE.BufferGeometry().setFromPoints(upperPoints);
      const upperMat = new THREE.LineBasicMaterial({
        color: 0x222244,
        transparent: true,
        opacity: 0.1,
      });
      const upperEdge = new THREE.LineSegments(upperGeo, upperMat);
      this.scene.add(upperEdge);
      this.tunnelEdges.push(upperEdge);
      this.tunnelEdgeMats.push(upperMat);
    }
  }

  /** Remove inactive objects from arrays and dispose their Three.js resources */
  private cleanupInactive() {
    // Obstacles
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      if (!obs.active) {
        this.scene.remove(obs.mesh);
        if (obs.mesh instanceof THREE.Mesh) {
          obs.mesh.geometry.dispose();
          (obs.mesh.material as THREE.Material).dispose();
        } else if (obs.mesh instanceof THREE.Group) {
          obs.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose();
              (child.material as THREE.Material).dispose();
            }
            if (child instanceof THREE.LineSegments) {
              child.geometry.dispose();
              (child.material as THREE.Material).dispose();
            }
          });
        }
        this.obstacles.splice(i, 1);
      }
    }
    // Orbs
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      if (!this.orbs[i].active) {
        const orb = this.orbs[i];
        this.scene.remove(orb.mesh);
        orb.mesh.geometry.dispose();
        (orb.mesh.material as THREE.Material).dispose();
        this.orbs.splice(i, 1);
      }
    }
    // Portals
    for (let i = this.portals.length - 1; i >= 0; i--) {
      if (!this.portals[i].active) {
        const portal = this.portals[i];
        this.scene.remove(portal.group);
        portal.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
        this.portals.splice(i, 1);
      }
    }
    // Markers
    for (let i = this.markers.length - 1; i >= 0; i--) {
      if (!this.markers[i].active) {
        const marker = this.markers[i];
        this.scene.remove(marker.group);
        marker.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
        this.markers.splice(i, 1);
      }
    }
  }

  update(dt: number, playerZ: number, playerX: number, speed: number, isPhasing: boolean = false) {
    // Generate obstacles ahead — spacing is biome-driven
    while (this.nextObstacleZ < playerZ + SPAWN_DISTANCE) {
      this.spawnObstacle(this.nextObstacleZ);
      this.nextObstacleZ += this.getBiomeSpacing();
    }

    // Generate orbs
    while (this.nextOrbZ < playerZ + SPAWN_DISTANCE) {
      this.spawnOrbCluster(this.nextOrbZ);
      this.nextOrbZ += ORB_SPACING + this.random() * 5;
    }

    // Generate Vibeverse portals
    while (this.nextPortalZ < playerZ + SPAWN_DISTANCE) {
      this.spawnPortal(this.nextPortalZ);
      this.nextPortalZ += PORTAL_INTERVAL;
    }

    // Generate distance markers every 100m
    while (this.nextMarkerZ < playerZ + SPAWN_DISTANCE) {
      this.spawnDistanceMarker(this.nextMarkerZ);
      this.nextMarkerZ += 100;
    }

    // Animate obstacles — pulse emissive glow
    for (const obs of this.obstacles) {
      if (!obs.active) continue;
      // Distance-based pulse intensity (closer = more visible animation)
      const distToPlayer = Math.abs(obs.z - playerZ);
      if (distToPlayer > 40) continue; // skip far obstacles for perf

      const mesh = obs.mesh;
      // Pulse the obstacle — update plasma shader time
      if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.ShaderMaterial) {
        mesh.material.uniforms.uTime.value = this.plasmaElapsed;
      }
      // Traverse groups (gates have children)
      if (mesh instanceof THREE.Group) {
        mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial) {
            child.material.uniforms.uTime.value = this.plasmaElapsed;
          }
        });
      }
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

    // Update portals
    for (const portal of this.portals) {
      if (!portal.active) continue;
      portal.ring.rotation.z += dt * 1.5;
      portal.ring.rotation.x += dt * 0.3;
      // Pulse glow
      const pulse = 0.6 + Math.sin(performance.now() * 0.003) * 0.2;
      (portal.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
    }

    // Despawn behind player
    for (const portal of this.portals) {
      if (portal.active && portal.z < playerZ + DESPAWN_DISTANCE) {
        portal.active = false;
        portal.group.visible = false;
      }
    }
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
    for (const marker of this.markers) {
      if (marker.active && marker.z < playerZ + DESPAWN_DISTANCE) {
        marker.active = false;
        marker.group.visible = false;
      }
    }

    // Periodic cleanup — remove inactive objects from arrays and scene to prevent memory growth
    this.cleanupTimer += dt;
    if (this.cleanupTimer > 3) { // every 3 seconds
      this.cleanupTimer = 0;
      this.cleanupInactive();
    }

    // Move tunnel walls and edges with player
    for (const wall of this.tunnelWalls) {
      wall.position.z = playerZ;
    }
    for (const edge of this.tunnelEdges) {
      edge.position.z = playerZ;
    }
    this.plasmaElapsed += dt;
    for (const mat of this.tunnelWallMats) {
      mat.uniforms.uTime.value = this.plasmaElapsed;
    }

    // Move shader floor with player and update uniforms
    this.gridFloorMesh.position.z = playerZ;
    this.gridFloorMat.uniforms.uTime.value = this.plasmaElapsed;
    this.gridFloorMat.uniforms.uPlayerZ.value = playerZ;
    this.gridFloorMat.uniforms.uPlayerX.value = playerX;

    // Move starfield with player so it behaves like a sky dome.
    this.starfield.position.x = 0;
    this.starfield.position.z = playerZ;

    // Update biome-reactive colors
    this.updateBiomeVisuals();

    // Update voronoi shard physics
    this.voronoiShatter.update(dt);
  }

  private updateBiomeVisuals() {
    const c = this.biomes.colors;
    const tint = c.starTint;
    const time = this.plasmaElapsed;
    for (let i = 0; i < this.starPhases.length; i++) {
      const shimmer = 0.7 + 0.3 * Math.sin(time * (1.5 + this.starPhases[i] * 0.5) + this.starPhases[i]);
      this.starColors[i * 3] = this.starBaseColors[i * 3] * tint[0] * shimmer;
      this.starColors[i * 3 + 1] = this.starBaseColors[i * 3 + 1] * tint[1] * shimmer;
      this.starColors[i * 3 + 2] = this.starBaseColors[i * 3 + 2] * tint[2] * shimmer;
    }
    (this.starfield.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;

    // Shader grid floor — update biome color and opacity
    this.gridFloorMat.uniforms.uGridColor.value.setHex(c.gridColor);
    this.gridFloorMat.uniforms.uGridOpacity.value = c.gridOpacity;

    // Tunnel walls — scanlines, subtle decorative (dimmer than obstacle colors)
    const wallBaseColor = new THREE.Color(c.obstacleBase).multiplyScalar(0.5);
    const wallEdgeColor = new THREE.Color(c.obstacleEdge).multiplyScalar(0.7);
    const wallAccentColor = new THREE.Color(c.obstacleEdge).multiplyScalar(0.5);
    for (const mat of this.tunnelWallMats) {
      mat.uniforms.uBaseColor.value.copy(wallBaseColor);
      mat.uniforms.uEdgeColor.value.copy(wallEdgeColor);
      mat.uniforms.uAccentColor.value.copy(wallAccentColor);
    }

    // Obstacle barriers — update ShaderMaterial colors for biome transitions
    const obsBaseColor = new THREE.Color(c.obstacleBase);
    const obsEdgeColor = new THREE.Color(c.obstacleEdge);
    const obsAccentColor = new THREE.Color(c.obstacleEdge).multiplyScalar(1.3);
    for (const obs of this.obstacles) {
      if (!obs.active) continue;
      const mesh = obs.mesh;
      if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.ShaderMaterial) {
        mesh.material.uniforms.uBaseColor.value.copy(obsBaseColor);
        mesh.material.uniforms.uEdgeColor.value.copy(obsEdgeColor);
        mesh.material.uniforms.uAccentColor.value.copy(obsAccentColor);
      }
      if (mesh instanceof THREE.Group) {
        mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial) {
            child.material.uniforms.uBaseColor.value.copy(obsBaseColor);
            child.material.uniforms.uEdgeColor.value.copy(obsEdgeColor);
            child.material.uniforms.uAccentColor.value.copy(obsAccentColor);
          }
        });
      }
    }

    // Tunnel edge lines — barely visible boundary markers
    for (const mat of this.tunnelEdgeMats) {
      mat.color.setHex(this.darkenHex(c.gridColor, 0.5));
    }
  }

  /**
   * Biome spacing — wider and simpler early, denser and more complex later.
   * Random variance is baked in per-biome to avoid uniform rhythms.
   */
  private getBiomeSpacing(): number {
    const idx = this.biomes.biomeIndex;
    if (idx === 0) return 18 + this.random() * 6;   // THE VOID: 18–24, wide open
    if (idx === 1) return 13 + this.random() * 5;   // CRYSTAL CAVES: 13–18
    if (idx === 2) return 9 + this.random() * 4;    // NEON DISTRICT: 9–13
    if (idx === 3) return 7 + this.random() * 4;    // SOLAR STORM: 7–11, dense
    return 5 + this.random() * 4;                   // COSMIC RIFT: 5–9, still tough but fairer
  }

  /**
   * Formation selection is gated by biome — early biomes get simple
   * obstacles only, later biomes unlock complex multi-piece formations.
   */
  private spawnObstacle(z: number) {
    const type = this.random();
    const biome = this.biomes.biomeIndex;

    if (biome === 0) {
      // THE VOID: gates and simple pillars only — learn the mechanics
      if (type < 0.5) {
        this.spawnGate(z);
      } else if (type < 0.85) {
        this.spawnPillar(z);
      } else {
        this.spawnDoublePillar(z);
      }
      return;
    }

    if (biome === 1) {
      // CRYSTAL CAVES: introduces double pillars and wide bars
      if (type < 0.30) {
        this.spawnGate(z);
      } else if (type < 0.50) {
        this.spawnPillar(z);
      } else if (type < 0.72) {
        this.spawnDoublePillar(z);
      } else {
        this.spawnWideBar(z);
      }
      return;
    }

    if (biome === 2) {
      // NEON DISTRICT: full pattern variety, no scatter field yet
      if (type < 0.20) {
        this.spawnGate(z);
      } else if (type < 0.35) {
        this.spawnPillar(z);
      } else if (type < 0.50) {
        this.spawnDoublePillar(z);
      } else if (type < 0.62) {
        this.spawnWideBar(z);
      } else if (type < 0.78) {
        this.spawnWeave(z);
      } else if (type < 0.92) {
        this.spawnDiamond(z);
      } else {
        this.spawnGate(z);
      }
      return;
    }

    if (biome === 3) {
      // SOLAR STORM: all formations including zigzag corridors
      if (type < 0.12) {
        this.spawnGate(z);
      } else if (type < 0.24) {
        this.spawnPillar(z);
      } else if (type < 0.36) {
        this.spawnDoublePillar(z);
      } else if (type < 0.48) {
        this.spawnWideBar(z);
      } else if (type < 0.62) {
        this.spawnWeave(z);
      } else if (type < 0.76) {
        this.spawnDiamond(z);
      } else if (type < 0.90) {
        this.spawnZigzagCorridor(z);
      } else {
        this.spawnScatterField(z);
      }
      return;
    }

    // COSMIC RIFT (biome 4+): maximum challenge, all formations at high weight
    if (type < 0.10) {
      this.spawnGate(z);
    } else if (type < 0.20) {
      this.spawnPillar(z);
    } else if (type < 0.30) {
      this.spawnDoublePillar(z);
    } else if (type < 0.40) {
      this.spawnWideBar(z);
    } else if (type < 0.54) {
      this.spawnWeave(z);
    } else if (type < 0.68) {
      this.spawnDiamond(z);
    } else if (type < 0.82) {
      this.spawnZigzagCorridor(z);
    } else {
      this.spawnScatterField(z);
    }
  }

  private spawnGate(z: number) {
    const gapX = (this.random() - 0.5) * 5;
    // Gap narrows with each biome — more forgiving early, punishing late
    const biomeGapWidths = [4.5, 4.2, 3.8, 3.4, 3.0];
    const gapWidth = biomeGapWidths[Math.min(this.biomes.biomeIndex, 4)];
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
    const x = (this.random() - 0.5) * 6;
    const width = 1 + this.random() * 1.5;
    const height = 2 + this.random() * 2;

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
    const spread = 2 + this.random() * 2;
    const offset = (this.random() - 0.5) * 2;

    // Left pillar
    this.spawnPillarAt(z, offset - spread, 1 + this.random());
    // Right pillar
    this.spawnPillarAt(z, offset + spread, 1 + this.random());
  }

  private spawnPillarAt(z: number, x: number, width: number) {
    const height = 2 + this.random() * 2;
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
    const gapSide = this.random() < 0.5 ? -1 : 1;
    const gapX = gapSide * (2 + this.random() * 2);

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
    const c = this.biomes.colors;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.ShaderMaterial({
      vertexShader: PLASMA_VERTEX,
      fragmentShader: PLASMA_OBSTACLE_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uBaseColor: { value: new THREE.Color(c.obstacleBase) },
        uEdgeColor: { value: new THREE.Color(c.obstacleEdge) },
        uAccentColor: { value: new THREE.Color(c.obstacleEdge).multiplyScalar(1.3) },
        uOpacity: { value: 1.0 },
      },
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, 0);

    // Add edge glow wireframe — bright and fully opaque so obstacles pop
    const edgeGeo = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({
      color: c.obstacleEdge,
      transparent: true,
      opacity: 1.0,
      linewidth: 2,
    });
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    edges.position.copy(mesh.position);
    mesh.add(edges);
    edges.position.set(0, 0, 0);

    return mesh;
  }

  /**
   * Weave: 3-4 staggered pillars at close Z spacing, alternating left/right.
   * Forces serpentine dodging.
   */
  private spawnWeave(z: number) {
    // Later biomes add a 4th pillar to the weave
    const count = 3 + (this.biomes.biomeIndex >= 3 ? 1 : 0);
    const startSide = this.random() < 0.5 ? -1 : 1;

    for (let i = 0; i < count; i++) {
      const side = startSide * (i % 2 === 0 ? 1 : -1);
      const x = side * (1.5 + this.random() * 1.5);
      const width = 2 + this.random();
      const height = 2 + this.random() * 1.5;
      const mesh = this.createObstacleMesh(width, height, 0.8, 0, 0);
      const pz = z + i * 3.5;
      mesh.position.set(x, 0, pz);
      this.scene.add(mesh);

      this.obstacles.push({
        mesh,
        z: pz,
        halfWidth: width / 2,
        halfHeight: height / 2,
        x,
        isGate: false,
        gapX: 0,
        gapHalfWidth: 0,
        active: true,
      });
    }

    // Advance nextObstacleZ past the formation
    this.nextObstacleZ = z + count * 3.5 + 4;
  }

  /**
   * Diamond formation: 4 pillars arranged in a diamond.
   * Gap is in the center — player threads the needle.
   */
  private spawnDiamond(z: number) {
    const cx = (this.random() - 0.5) * 3;
    // Tighter diamond in later biomes — less room to thread the needle
    const biomeSpread = [4.0, 3.5, 3.0, 2.5, 2.0];
    const spread = biomeSpread[Math.min(this.biomes.biomeIndex, 4)];
    const pillarW = 0.8 + this.random() * 0.6;
    const pillarH = 2 + this.random();

    // Top, Bottom, Left, Right relative to center
    const offsets = [
      { x: cx, z: z + spread },       // front
      { x: cx, z: z - spread },       // back
      { x: cx - spread, z: z },       // left
      { x: cx + spread, z: z },       // right
    ];

    for (const off of offsets) {
      const mesh = this.createObstacleMesh(pillarW, pillarH, pillarW, 0, 0);
      mesh.position.set(off.x, 0, off.z);
      // Rotate 45° for diamond look
      mesh.rotation.y = Math.PI / 4;
      this.scene.add(mesh);

      this.obstacles.push({
        mesh,
        z: off.z,
        halfWidth: pillarW * 0.7, // slightly smaller collision for rotated box
        halfHeight: pillarH / 2,
        x: off.x,
        isGate: false,
        gapX: 0,
        gapHalfWidth: 0,
        active: true,
      });
    }
  }

  /**
   * Zigzag corridor: 3 gates with alternating gap positions in quick succession.
   * Forces fast reactions or shatter-through.
   */
  private spawnZigzagCorridor(z: number) {
    // Faster gate rhythm and tighter gaps in later biomes
    const biomeGateSpacing = [5.5, 5.0, 4.5, 4.0, 3.5];
    const biomeZigzagGap = [3.8, 3.5, 3.2, 3.0, 2.8];
    const gateSpacing = biomeGateSpacing[Math.min(this.biomes.biomeIndex, 4)];

    for (let i = 0; i < 3; i++) {
      const gapX = (i % 2 === 0 ? -1 : 1) * (1.5 + this.random() * 1.5);
      const gapWidth = biomeZigzagGap[Math.min(this.biomes.biomeIndex, 4)];
      const wallHeight = 3;
      const wallThickness = 0.6;
      const pz = z + i * gateSpacing;

      const group = new THREE.Group();
      group.position.z = pz;

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
        z: pz,
        halfWidth: LANE_WIDTH,
        halfHeight: wallHeight / 2,
        x: 0,
        isGate: true,
        gapX,
        gapHalfWidth: gapWidth / 2,
        active: true,
      });
    }

    // Advance past formation
    this.nextObstacleZ = z + 3 * gateSpacing + 4;
  }

  /**
   * Scatter field: 5-7 small pillars randomly placed.
   * Creates a debris field requiring constant micro-dodging or sustained shatter.
   */
  private spawnScatterField(z: number) {
    const count = 5 + Math.floor(this.random() * 3);
    const fieldDepth = 10;

    for (let i = 0; i < count; i++) {
      const x = (this.random() - 0.5) * 7;
      const pz = z + this.random() * fieldDepth;
      const w = 0.6 + this.random() * 0.8;
      const h = 1 + this.random() * 2;
      const mesh = this.createObstacleMesh(w, h, w, 0, 0);
      mesh.position.set(x, 0, pz);
      this.scene.add(mesh);

      this.obstacles.push({
        mesh,
        z: pz,
        halfWidth: w / 2,
        halfHeight: h / 2,
        x,
        isGate: false,
        gapX: 0,
        gapHalfWidth: 0,
        active: true,
      });
    }

    this.nextObstacleZ = z + fieldDepth + 4;
  }

  private spawnOrbCluster(z: number) {
    const count = 1 + Math.floor(this.random() * 3);
    const baseX = (this.random() - 0.5) * 6;

    for (let i = 0; i < count; i++) {
      const x = baseX + (i - (count - 1) / 2) * 1.5;
      this.spawnOrb(z + i * 1.5, x);
    }
  }

  private spawnOrb(z: number, x: number) {
    const c = this.biomes.colors;
    const geo = new THREE.OctahedronGeometry(0.35, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: c.orbColor,
      emissive: c.orbColor,
      emissiveIntensity: 1.0,
      metalness: 0.5,
      roughness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.5 + this.random() * 0.5, z);
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

  /** Magnet: attract orbs toward player */
  attractOrbs(playerX: number, playerZ: number, radius: number, dt: number) {
    for (const orb of this.orbs) {
      if (!orb.active || orb.collected) continue;
      const dx = playerX - orb.x;
      const dz = playerZ - orb.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < radius && dist > 0.1) {
        const strength = (1 - dist / radius) * 15 * dt;
        orb.x += (dx / dist) * strength;
        orb.z += (dz / dist) * strength;
        orb.mesh.position.x = orb.x;
        orb.mesh.position.z = orb.z;
      }
    }
  }

  /** Check collision between player and obstacles */
  checkObstacleCollision(playerX: number, playerZ: number, playerRadius: number): Obstacle | null {
    for (const obs of this.obstacles) {
      if (!obs.active) continue;

      const dz = Math.abs(playerZ - obs.z);
      if (dz > 2) continue; // Too far in Z

      if (obs.isGate) {
        // Gate: player must be in the gap (small forgiveness margin so it doesn't feel unfair)
        const dx = Math.abs(playerX - obs.gapX);
        const forgiveness = 0.15;
        if (dx > obs.gapHalfWidth - playerRadius + forgiveness) {
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

  private spawnDistanceMarker(z: number) {
    const c = this.biomes.colors;
    const group = new THREE.Group();
    group.position.z = z;

    // Glowing line across the floor
    const lineGeo = new THREE.PlaneGeometry(LANE_WIDTH * 1.5, 0.15);
    const lineMat = new THREE.MeshBasicMaterial({
      color: c.playerTrail,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.y = -1.49;
    group.add(line);

    // Side pillars with distance label effect
    for (const side of [-1, 1]) {
      const pillarGeo = new THREE.BoxGeometry(0.1, 2, 0.1);
      const pillarMat = new THREE.MeshBasicMaterial({
        color: c.playerTrail,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(side * (LANE_WIDTH / 2 + 0.5), -0.5, 0);
      group.add(pillar);
    }

    this.scene.add(group);
    this.markers.push({ group, z, active: true });
  }

  private spawnPortal(z: number) {
    const group = new THREE.Group();
    const x = (this.random() < 0.5 ? -1 : 1) * (2 + this.random() * 1.5);

    // Torus ring
    const torusGeo = new THREE.TorusGeometry(1.5, 0.15, 16, 32);
    const torusMat = new THREE.MeshStandardMaterial({
      color: 0x00ff44,
      emissive: 0x00ff44,
      emissiveIntensity: 0.6,
      metalness: 0.3,
      roughness: 0.2,
      transparent: true,
      opacity: 0.85,
    });
    const ring = new THREE.Mesh(torusGeo, torusMat);
    ring.rotation.y = Math.PI / 2; // face the player
    group.add(ring);

    // Inner glow disc
    const discGeo = new THREE.CircleGeometry(1.3, 32);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x00ff44,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.y = Math.PI / 2;
    group.add(disc);

    group.position.set(x, 1, z);
    this.scene.add(group);

    this.portals.push({
      group,
      z,
      x,
      active: true,
      ring,
    });
  }

  /** Check if player entered a portal */
  checkPortalCollision(playerX: number, playerZ: number): VibeversePortal | null {
    for (const portal of this.portals) {
      if (!portal.active) continue;
      const dz = Math.abs(playerZ - portal.z);
      if (dz > 2) continue;
      const dx = Math.abs(playerX - portal.x);
      if (dx < 1.5) {
        return portal;
      }
    }
    return null;
  }

  /** Shatter an obstacle visually and disable its collision */
  shatterObstacle(obs: Obstacle, impactX: number, impactZ: number, speed: number = 0): void {
    this.voronoiShatter.shatterObstacle(obs, impactX, impactZ, this.biomes.colors, speed);
    obs.active = false;
    // Hide the original mesh and all its children
    obs.mesh.visible = false;
    obs.mesh.traverse((child) => { child.visible = false; });
  }

  /** Check close calls (passing through obstacle while shattered) */
  checkCloseCall(playerX: number, playerZ: number): Obstacle | null {
    for (const obs of this.obstacles) {
      if (!obs.active) continue;
      const dz = Math.abs(playerZ - obs.z);
      if (dz > 1.5) continue;

      if (obs.isGate) {
        const dx = Math.abs(playerX - obs.gapX);
        if (dx > obs.gapHalfWidth - 0.3) return obs;
      } else {
        const dx = Math.abs(playerX - obs.x);
        if (dx < obs.halfWidth + 0.8) return obs;
      }
    }
    return null;
  }

  reset() {
    this.voronoiShatter.reset();
    // Remove all obstacles, orbs, and portals
    for (const obs of this.obstacles) {
      this.scene.remove(obs.mesh);
    }
    for (const orb of this.orbs) {
      this.scene.remove(orb.mesh);
    }
    for (const portal of this.portals) {
      this.scene.remove(portal.group);
    }
    this.obstacles.length = 0;
    this.orbs.length = 0;
    this.portals.length = 0;
    for (const marker of this.markers) {
      this.scene.remove(marker.group);
    }
    this.markers.length = 0;
    this.nextObstacleZ = 30;
    this.nextOrbZ = 15;
    this.nextPortalZ = PORTAL_INTERVAL;
    this.nextMarkerZ = 100;
  }

  dispose() {
    this.reset();
    if (this.starfield) {
      this.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      (this.starfield.material as THREE.Material).dispose();
    }
    if (this.gridFloorMesh) {
      this.scene.remove(this.gridFloorMesh);
      this.gridFloorMesh.geometry.dispose();
      this.gridFloorMat.dispose();
    }
    for (const wall of this.tunnelWalls) {
      this.scene.remove(wall);
      wall.geometry.dispose();
      (wall.material as THREE.Material).dispose();
    }
    for (const edge of this.tunnelEdges) {
      this.scene.remove(edge);
      edge.geometry.dispose();
      (edge.material as THREE.Material).dispose();
    }
  }

  /** Scale a hex color's brightness (multiplier > 1 brightens, < 1 darkens) */
  private darkenHex(hex: number, multiplier: number): number {
    const r = Math.min(255, Math.max(0, ((hex >> 16) & 0xff) * multiplier)) | 0;
    const g = Math.min(255, Math.max(0, ((hex >> 8) & 0xff) * multiplier)) | 0;
    const b = Math.min(255, Math.max(0, (hex & 0xff) * multiplier)) | 0;
    return (r << 16) | (g << 8) | b;
  }
}
