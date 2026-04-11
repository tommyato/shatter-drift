import * as THREE from "three";

/**
 * Ribbon trail — a smooth, flowing ribbon that streams behind the player.
 * Much more visually striking than point particles. Renders as a textured
 * mesh strip that tapers and fades.
 */

const MAX_POINTS = 60;
const POINT_LIFETIME = 0.8; // seconds

interface RibbonPoint {
  position: THREE.Vector3;
  age: number;
  width: number;
}

export class RibbonTrail {
  private points: RibbonPoint[] = [];
  private mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private positions: Float32Array;
  private alphas: Float32Array;
  private scene: THREE.Scene;
  private enabled = true;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // 2 vertices per point (left + right edge of ribbon)
    const vertexCount = MAX_POINTS * 2;
    this.positions = new Float32Array(vertexCount * 3);
    this.alphas = new Float32Array(vertexCount);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("alpha", new THREE.BufferAttribute(this.alphas, 1));

    // Build index buffer for triangle strip
    const indices: number[] = [];
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
    this.geometry.setIndex(indices);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(0x00ffcc) },
        uOpacity: { value: 0.5 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vAlpha;
        varying vec2 vPos;

        void main() {
          vAlpha = alpha;
          vPos = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uTime;
        varying float vAlpha;
        varying vec2 vPos;

        void main() {
          // Core glow — brighter at center, fading at edges
          float glow = vAlpha * uOpacity;

          // Subtle energy pulse
          float pulse = 0.9 + 0.1 * sin(vPos.y * 0.5 + uTime * 5.0);
          glow *= pulse;

          // Color with slight white core
          vec3 col = mix(uColor, vec3(1.0), vAlpha * 0.3);

          gl_FragColor = vec4(col, glow);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  setColor(color: number) {
    (this.material.uniforms.uColor.value as THREE.Color).setHex(color);
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    this.mesh.visible = v;
  }

  setOpacity(v: number) {
    this.material.uniforms.uOpacity.value = v;
  }

  addPoint(worldPos: THREE.Vector3, width: number = 0.3) {
    if (!this.enabled) return;

    this.points.unshift({
      position: worldPos.clone(),
      age: 0,
      width,
    });

    // Trim excess
    if (this.points.length > MAX_POINTS) {
      this.points.length = MAX_POINTS;
    }
  }

  update(dt: number) {
    this.material.uniforms.uTime.value += dt;

    // Age all points
    for (let i = this.points.length - 1; i >= 0; i--) {
      this.points[i].age += dt;
      if (this.points[i].age > POINT_LIFETIME) {
        this.points.splice(i, 1);
      }
    }

    // Rebuild vertex data
    const up = new THREE.Vector3(0, 1, 0);
    const posAttr = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    const alphaAttr = this.geometry.getAttribute("alpha") as THREE.BufferAttribute;

    for (let i = 0; i < MAX_POINTS; i++) {
      const idx = i * 2;

      if (i < this.points.length) {
        const p = this.points[i];
        const t = 1 - p.age / POINT_LIFETIME;       // 1 at birth, 0 at death
        const taper = t * (1 - (i / this.points.length) * 0.5); // also taper toward tail

        // Get direction for ribbon width
        let dir: THREE.Vector3;
        if (i < this.points.length - 1) {
          dir = new THREE.Vector3().subVectors(this.points[i + 1].position, p.position).normalize();
        } else if (i > 0) {
          dir = new THREE.Vector3().subVectors(p.position, this.points[i - 1].position).normalize();
        } else {
          dir = new THREE.Vector3(0, 0, 1);
        }

        // Perpendicular to direction and up
        const perp = new THREE.Vector3().crossVectors(dir, up).normalize();
        const halfWidth = p.width * taper;

        // Left vertex
        this.positions[idx * 3] = p.position.x - perp.x * halfWidth;
        this.positions[idx * 3 + 1] = p.position.y - perp.y * halfWidth;
        this.positions[idx * 3 + 2] = p.position.z - perp.z * halfWidth;
        this.alphas[idx] = taper;

        // Right vertex
        this.positions[(idx + 1) * 3] = p.position.x + perp.x * halfWidth;
        this.positions[(idx + 1) * 3 + 1] = p.position.y + perp.y * halfWidth;
        this.positions[(idx + 1) * 3 + 2] = p.position.z + perp.z * halfWidth;
        this.alphas[idx + 1] = taper;
      } else {
        // Hide unused vertices
        this.positions[idx * 3 + 1] = -100;
        this.positions[(idx + 1) * 3 + 1] = -100;
        this.alphas[idx] = 0;
        this.alphas[idx + 1] = 0;
      }
    }

    posAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
