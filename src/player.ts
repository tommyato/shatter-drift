import * as THREE from "three";

const FRAGMENT_COUNT = 20; // icosahedron faces
const SHATTER_SPREAD = 2.5;
const RECOMBINE_SPEED = 28;
const PLAYER_COLOR = 0x00ffcc;
const SHATTER_COLOR = 0xff44ff;
const GHOST_OPACITY = 0.25;
const SHIELD_COLOR = 0x44aaff;

export class Player {
  group = new THREE.Group();
  /** The whole crystal mesh (visible when solid) */
  crystalMesh!: THREE.Mesh;
  /** Individual fragment meshes (visible when shattered) */
  fragments: THREE.Mesh[] = [];
  /** Target positions for fragments when shattered */
  private fragmentTargets: THREE.Vector3[] = [];
  /** Original positions (all at origin) */
  private fragmentOrigins: THREE.Vector3[] = [];

  /** Player state */
  shattered = false;
  /** Horizontal position (-1 to 1 range, mapped to world X) */
  laneX = 0;
  /** Smoothed X for rendering */
  private renderX = 0;
  /** How far shatter animation has progressed (0=whole, 1=fully shattered) */
  shatterT = 0;
  /** Particle trail emitter position */
  trailPosition = new THREE.Vector3();

  // Glow ring (visual indicator of state)
  private glowRing!: THREE.Mesh;

  // Shield visual
  private shieldBubble!: THREE.Mesh;
  private shieldActive = false;

  constructor() {
    this.buildCrystal();
    this.buildFragments();
    this.buildGlowRing();
    this.buildShieldBubble();
  }

  private buildCrystal() {
    const geo = new THREE.IcosahedronGeometry(0.6, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: PLAYER_COLOR,
      emissive: PLAYER_COLOR,
      emissiveIntensity: 0.4,
      metalness: 0.8,
      roughness: 0.2,
      transparent: true,
      opacity: 1,
    });
    this.crystalMesh = new THREE.Mesh(geo, mat);
    this.crystalMesh.castShadow = true;
    this.group.add(this.crystalMesh);
  }

  private buildFragments() {
    // Extract triangular faces from icosahedron
    const icoGeo = new THREE.IcosahedronGeometry(0.6, 0);
    const positions = icoGeo.getAttribute("position");
    const index = icoGeo.getIndex();

    if (!index) return;

    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);

      // Create individual triangle geometry
      const triGeo = new THREE.BufferGeometry();
      const verts = new Float32Array(9);
      for (let v = 0; v < 3; v++) {
        const idx = [a, b, c][v];
        verts[v * 3] = positions.getX(idx);
        verts[v * 3 + 1] = positions.getY(idx);
        verts[v * 3 + 2] = positions.getZ(idx);
      }
      triGeo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
      triGeo.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        color: SHATTER_COLOR,
        emissive: SHATTER_COLOR,
        emissiveIntensity: 0.6,
        metalness: 0.8,
        roughness: 0.2,
        transparent: true,
        opacity: GHOST_OPACITY,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(triGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.fragments.push(mesh);

      // Calculate face center for shatter direction
      const cx = (verts[0] + verts[3] + verts[6]) / 3;
      const cy = (verts[1] + verts[4] + verts[7]) / 3;
      const cz = (verts[2] + verts[5] + verts[8]) / 3;
      const dir = new THREE.Vector3(cx, cy, cz).normalize();

      this.fragmentTargets.push(dir.multiplyScalar(SHATTER_SPREAD));
      this.fragmentOrigins.push(new THREE.Vector3(0, 0, 0));
    }

    icoGeo.dispose();
  }

  private buildGlowRing() {
    const geo = new THREE.RingGeometry(0.9, 1.1, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: PLAYER_COLOR,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    this.glowRing = new THREE.Mesh(geo, mat);
    this.glowRing.rotation.x = -Math.PI / 2;
    this.glowRing.position.y = -0.3;
    this.group.add(this.glowRing);
  }

  private buildShieldBubble() {
    const geo = new THREE.SphereGeometry(1.2, 24, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: SHIELD_COLOR,
      emissive: SHIELD_COLOR,
      emissiveIntensity: 0.3,
      metalness: 0.1,
      roughness: 0.1,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      wireframe: true,
    });
    this.shieldBubble = new THREE.Mesh(geo, mat);
    this.group.add(this.shieldBubble);
  }

  setShieldActive(active: boolean) {
    this.shieldActive = active;
  }

  update(dt: number, moveInput: number) {
    // Horizontal movement
    const moveSpeed = 8;
    this.laneX += moveInput * moveSpeed * dt;
    this.laneX = THREE.MathUtils.clamp(this.laneX, -4, 4);

    // Smooth rendering position
    this.renderX = THREE.MathUtils.lerp(this.renderX, this.laneX, 1 - Math.exp(-15 * dt));
    this.group.position.x = this.renderX;

    // Subtle bob
    this.group.position.y = Math.sin(performance.now() * 0.003) * 0.1;

    // Shatter/recombine animation
    const targetT = this.shattered ? 1 : 0;
    const speed = this.shattered ? 10 : RECOMBINE_SPEED;
    this.shatterT = THREE.MathUtils.lerp(this.shatterT, targetT, 1 - Math.exp(-speed * dt));

    // Update fragment positions
    const isFullyWhole = this.shatterT < 0.1;
    const isPartiallyShattered = this.shatterT > 0.02;

    this.crystalMesh.visible = !isPartiallyShattered;

    for (let i = 0; i < this.fragments.length; i++) {
      const frag = this.fragments[i];
      frag.visible = isPartiallyShattered;
      if (isPartiallyShattered) {
        const target = this.fragmentTargets[i];
        frag.position.x = target.x * this.shatterT;
        frag.position.y = target.y * this.shatterT;
        frag.position.z = target.z * this.shatterT;
        // Rotate fragments for visual interest
        frag.rotation.x += dt * 3 * this.shatterT;
        frag.rotation.z += dt * 2 * this.shatterT;
      }
    }

    // Crystal rotation (slow when whole, fast when shattered)
    const rotSpeed = isPartiallyShattered ? 4 : 1;
    this.crystalMesh.rotation.y += dt * rotSpeed;
    this.crystalMesh.rotation.x = Math.sin(performance.now() * 0.002) * 0.2;

    // Glow ring
    const ringColor = this.shattered ? SHATTER_COLOR : PLAYER_COLOR;
    (this.glowRing.material as THREE.MeshBasicMaterial).color.setHex(ringColor);
    (this.glowRing.material as THREE.MeshBasicMaterial).opacity = 0.15 + this.shatterT * 0.2;
    this.glowRing.scale.setScalar(1 + this.shatterT * 0.5);
    this.glowRing.rotation.z += dt * 0.5;

    // Shield bubble animation
    const shieldMat = this.shieldBubble.material as THREE.MeshStandardMaterial;
    if (this.shieldActive) {
      shieldMat.opacity = THREE.MathUtils.lerp(shieldMat.opacity, 0.15, 1 - Math.exp(-5 * dt));
      this.shieldBubble.rotation.y += dt * 1.5;
      this.shieldBubble.rotation.x += dt * 0.7;
      const pulse = 1 + Math.sin(performance.now() * 0.005) * 0.05;
      this.shieldBubble.scale.setScalar(pulse);
    } else {
      shieldMat.opacity = THREE.MathUtils.lerp(shieldMat.opacity, 0, 1 - Math.exp(-8 * dt));
    }

    // Trail position (world space)
    this.trailPosition.copy(this.group.position);
  }

  /** Get collision radius (smaller when shattered = more forgiving) */
  getCollisionRadius(): number {
    return this.shattered ? 0.15 : 0.35;
  }

  /** Check if player can collect (must be whole) */
  canCollect(): boolean {
    return !this.shattered && this.shatterT < 0.1;
  }

  dispose() {
    this.crystalMesh.geometry.dispose();
    (this.crystalMesh.material as THREE.Material).dispose();
    for (const frag of this.fragments) {
      frag.geometry.dispose();
      (frag.material as THREE.Material).dispose();
    }
    this.glowRing.geometry.dispose();
    (this.glowRing.material as THREE.Material).dispose();
    this.shieldBubble.geometry.dispose();
    (this.shieldBubble.material as THREE.Material).dispose();
  }
}
