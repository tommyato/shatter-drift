import * as THREE from "three";
import { BiomeManager } from "./biomes";

/**
 * World Events — per-biome environmental spectacles that happen
 * during gameplay. Creates "wow moments" that make each run unique.
 *
 * Events by biome:
 * - THE VOID: Cosmic ripple — space distorts briefly
 * - CRYSTAL CAVES: Crystal rain — shimmering particles fall
 * - NEON DISTRICT: Data storm — horizontal streaks of light
 * - SOLAR STORM: Meteor shower — fiery streaks across the sky
 * - COSMIC RIFT: Aurora burst — massive color wave fills the sky
 */

interface WorldEvent {
  type: string;
  particles: THREE.Points | null;
  meshes: THREE.Mesh[];
  timer: number;
  duration: number;
  active: boolean;
  intensity: number;
}

export class WorldEventManager {
  private scene: THREE.Scene;
  private biomes: BiomeManager;
  private currentEvent: WorldEvent | null = null;
  private eventCooldown = 0;
  private minCooldown = 12; // seconds between events
  private maxCooldown = 25;

  // Reusable geometry/materials
  private meteorGeo: THREE.CylinderGeometry;
  private streakGeo: THREE.PlaneGeometry;

  constructor(scene: THREE.Scene, biomes: BiomeManager) {
    this.scene = scene;
    this.biomes = biomes;
    this.eventCooldown = 8; // first event after 8 seconds
    this.meteorGeo = new THREE.CylinderGeometry(0.05, 0.15, 3, 4);
    this.streakGeo = new THREE.PlaneGeometry(8, 0.08);
  }

  update(dt: number, playerZ: number): { eventName: string | null; intensity: number } {
    let triggered: string | null = null;

    // Cooldown
    if (this.eventCooldown > 0) {
      this.eventCooldown -= dt;
      if (this.eventCooldown <= 0 && !this.currentEvent) {
        triggered = this.triggerEvent(playerZ);
      }
    }

    // Update active event
    if (this.currentEvent) {
      this.currentEvent.timer += dt;
      const progress = this.currentEvent.timer / this.currentEvent.duration;

      if (progress >= 1) {
        this.endEvent();
      } else {
        // Intensity curve: quick ramp up, sustain, quick fade
        const fadeIn = Math.min(progress / 0.15, 1);
        const fadeOut = Math.min((1 - progress) / 0.2, 1);
        this.currentEvent.intensity = fadeIn * fadeOut;
        this.updateEvent(dt, playerZ);
      }
    }

    return {
      eventName: triggered,
      intensity: this.currentEvent?.intensity ?? 0,
    };
  }

  private triggerEvent(playerZ: number): string {
    const biomeIndex = this.biomes.biomeIndex;
    const events = ["cosmic_ripple", "crystal_rain", "data_storm", "meteor_shower", "aurora_burst"];
    const eventType = events[Math.min(biomeIndex, events.length - 1)];

    this.currentEvent = {
      type: eventType,
      particles: null,
      meshes: [],
      timer: 0,
      duration: this.getEventDuration(eventType),
      active: true,
      intensity: 0,
    };

    this.createEventVisuals(eventType, playerZ);
    return eventType;
  }

  private getEventDuration(type: string): number {
    switch (type) {
      case "cosmic_ripple": return 3;
      case "crystal_rain": return 5;
      case "data_storm": return 4;
      case "meteor_shower": return 6;
      case "aurora_burst": return 5;
      default: return 4;
    }
  }

  private createEventVisuals(type: string, playerZ: number) {
    if (!this.currentEvent) return;

    switch (type) {
      case "cosmic_ripple":
        // No persistent visuals — handled by intensity pulse to bloom/FOV
        break;

      case "crystal_rain": {
        // Falling particle shower
        const count = 200;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          positions[i * 3] = (Math.random() - 0.5) * 30;
          positions[i * 3 + 1] = Math.random() * 20 + 5;
          positions[i * 3 + 2] = playerZ + Math.random() * 40 - 5;
          // Cyan/blue crystals
          colors[i * 3] = 0.2 + Math.random() * 0.3;
          colors[i * 3 + 1] = 0.7 + Math.random() * 0.3;
          colors[i * 3 + 2] = 1.0;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        const mat = new THREE.PointsMaterial({
          size: 0.2,
          vertexColors: true,
          transparent: true,
          opacity: 0.8,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        this.currentEvent.particles = new THREE.Points(geo, mat);
        this.scene.add(this.currentEvent.particles);
        break;
      }

      case "data_storm": {
        // Horizontal light streaks
        const streakCount = 15;
        for (let i = 0; i < streakCount; i++) {
          const mat = new THREE.MeshBasicMaterial({
            color: 0xff44aa,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const mesh = new THREE.Mesh(this.streakGeo, mat);
          mesh.position.set(
            (Math.random() - 0.5) * 20,
            1 + Math.random() * 8,
            playerZ + Math.random() * 50
          );
          mesh.rotation.y = Math.PI / 2;
          mesh.userData.speed = 20 + Math.random() * 30;
          mesh.userData.startX = mesh.position.x;
          this.scene.add(mesh);
          this.currentEvent.meshes.push(mesh);
        }
        break;
      }

      case "meteor_shower": {
        // Fiery streaks across the sky
        const meteorCount = 12;
        for (let i = 0; i < meteorCount; i++) {
          const mat = new THREE.MeshBasicMaterial({
            color: 0xff6600,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const mesh = new THREE.Mesh(this.meteorGeo, mat);
          mesh.position.set(
            (Math.random() - 0.5) * 40,
            15 + Math.random() * 20,
            playerZ + 20 + Math.random() * 60
          );
          // Angled trajectory
          mesh.rotation.z = -Math.PI / 4 + (Math.random() - 0.5) * 0.5;
          mesh.rotation.x = Math.PI / 6;
          mesh.userData.velocityX = -15 - Math.random() * 10;
          mesh.userData.velocityY = -20 - Math.random() * 15;
          mesh.userData.delay = Math.random() * 4; // stagger spawns
          mesh.visible = false;
          this.scene.add(mesh);
          this.currentEvent.meshes.push(mesh);
        }
        break;
      }

      case "aurora_burst": {
        // Large translucent planes that pulse with color
        const waveCount = 5;
        for (let i = 0; i < waveCount; i++) {
          const waveGeo = new THREE.PlaneGeometry(50, 8, 10, 3);
          const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(0.4 + i * 0.1, 1, 0.5),
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const mesh = new THREE.Mesh(waveGeo, mat);
          mesh.position.set(
            0,
            12 + i * 3,
            playerZ + 30 + i * 5
          );
          mesh.userData.baseY = mesh.position.y;
          mesh.userData.phase = i * 0.5;
          this.scene.add(mesh);
          this.currentEvent.meshes.push(mesh);
        }
        break;
      }
    }
  }

  private updateEvent(dt: number, playerZ: number) {
    if (!this.currentEvent) return;
    const intensity = this.currentEvent.intensity;
    const time = performance.now() * 0.001;

    switch (this.currentEvent.type) {
      case "crystal_rain": {
        if (this.currentEvent.particles) {
          const positions = this.currentEvent.particles.geometry.getAttribute("position") as THREE.BufferAttribute;
          for (let i = 0; i < positions.count; i++) {
            let y = positions.getY(i);
            y -= dt * (8 + Math.sin(i) * 3); // fall speed
            if (y < -2) {
              y = 15 + Math.random() * 10;
              positions.setX(i, (Math.random() - 0.5) * 30);
              positions.setZ(i, playerZ + Math.random() * 40 - 5);
            }
            positions.setY(i, y);
          }
          positions.needsUpdate = true;
          (this.currentEvent.particles.material as THREE.PointsMaterial).opacity = intensity * 0.8;
          // Follow player in Z
          this.currentEvent.particles.position.z = playerZ * 0.3;
        }
        break;
      }

      case "data_storm": {
        for (const mesh of this.currentEvent.meshes) {
          const mat = mesh.material as THREE.MeshBasicMaterial;
          mat.opacity = intensity * 0.6;
          // Horizontal sweep
          mesh.position.x += mesh.userData.speed * dt;
          if (mesh.position.x > 15) {
            mesh.position.x = -15;
            mesh.position.z = playerZ + Math.random() * 50;
            mesh.position.y = 1 + Math.random() * 8;
          }
          // Flicker
          mat.opacity *= 0.5 + Math.sin(time * 20 + mesh.position.y * 3) * 0.5;
        }
        break;
      }

      case "meteor_shower": {
        const elapsed = this.currentEvent.timer;
        for (const mesh of this.currentEvent.meshes) {
          if (elapsed < mesh.userData.delay) continue;
          mesh.visible = true;
          const mat = mesh.material as THREE.MeshBasicMaterial;
          mat.opacity = intensity * 0.9;
          mesh.position.x += mesh.userData.velocityX * dt;
          mesh.position.y += mesh.userData.velocityY * dt;
          // Respawn if fallen below
          if (mesh.position.y < -5) {
            mesh.position.set(
              (Math.random() - 0.5) * 40,
              15 + Math.random() * 20,
              playerZ + 20 + Math.random() * 60
            );
          }
          // Trail effect: scale stretch
          mesh.scale.y = 1 + intensity * 2;
        }
        break;
      }

      case "aurora_burst": {
        for (const mesh of this.currentEvent.meshes) {
          const mat = mesh.material as THREE.MeshBasicMaterial;
          mat.opacity = intensity * 0.25;
          // Wave motion
          mesh.position.y = mesh.userData.baseY + Math.sin(time + mesh.userData.phase) * 2;
          mesh.position.z = playerZ + 30;
          // Color shift
          const hue = (time * 0.1 + mesh.userData.phase * 0.1) % 1;
          mat.color.setHSL(hue, 1, 0.5);
          // Vertex wave deformation
          const posAttr = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
          for (let i = 0; i < posAttr.count; i++) {
            const x = posAttr.getX(i);
            const baseY = posAttr.getY(i);
            posAttr.setZ(i, Math.sin(x * 0.2 + time * 2 + mesh.userData.phase) * 2 * intensity);
          }
          posAttr.needsUpdate = true;
        }
        break;
      }
    }
  }

  private endEvent() {
    if (!this.currentEvent) return;

    // Clean up visuals
    if (this.currentEvent.particles) {
      this.scene.remove(this.currentEvent.particles);
      this.currentEvent.particles.geometry.dispose();
      (this.currentEvent.particles.material as THREE.Material).dispose();
    }
    for (const mesh of this.currentEvent.meshes) {
      this.scene.remove(mesh);
      // Don't dispose shared geometries (meteorGeo, streakGeo)
      if (mesh.geometry !== this.meteorGeo && mesh.geometry !== this.streakGeo) {
        mesh.geometry.dispose();
      }
      (mesh.material as THREE.Material).dispose();
    }

    this.currentEvent = null;
    this.eventCooldown = this.minCooldown + Math.random() * (this.maxCooldown - this.minCooldown);
  }

  /** Get bloom boost during events (for cosmic_ripple especially) */
  getBloomBoost(): number {
    if (!this.currentEvent) return 0;
    if (this.currentEvent.type === "cosmic_ripple") {
      return this.currentEvent.intensity * 0.5;
    }
    return this.currentEvent.intensity * 0.15;
  }

  /** Get FOV pulse during events */
  getFOVPulse(): number {
    if (!this.currentEvent) return 0;
    if (this.currentEvent.type === "cosmic_ripple") {
      return Math.sin(this.currentEvent.timer * 4) * this.currentEvent.intensity * 5;
    }
    return 0;
  }

  reset() {
    if (this.currentEvent) {
      this.endEvent();
    }
    this.eventCooldown = 8;
  }
}
