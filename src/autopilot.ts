/**
 * Autopilot AI for demo mode / video recording.
 * Reads the world state and produces simulated input.
 */

import { World, Obstacle, EnergyOrb } from "./world";

export interface AutopilotInput {
  moveX: number;    // -1 to 1 horizontal
  shatter: boolean; // hold to phase
}

const LOOK_AHEAD = 25;     // distance ahead to scan for obstacles
const DODGE_THRESHOLD = 3;  // start dodging this many units ahead
const SHATTER_RANGE = 5;    // shatter when obstacle within this range and can't dodge

export class Autopilot {
  private targetX = 0;
  private shatterTimer = 0;

  update(
    playerX: number,
    playerZ: number,
    speed: number,
    world: World
  ): AutopilotInput {
    const result: AutopilotInput = { moveX: 0, shatter: false };

    // Find nearest upcoming obstacle
    let nearestObs: Obstacle | null = null;
    let nearestDist = Infinity;

    for (const obs of world.obstacles) {
      if (!obs.active) continue;
      const dist = obs.z - playerZ;
      if (dist < -1 || dist > LOOK_AHEAD) continue;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestObs = obs;
      }
    }

    // Find nearest orb to collect
    let bestOrb: EnergyOrb | null = null;
    let bestOrbScore = -Infinity;

    for (const orb of world.orbs) {
      if (!orb.active || orb.collected) continue;
      const dist = orb.z - playerZ;
      if (dist < -1 || dist > LOOK_AHEAD * 0.7) continue;
      // Prefer close orbs that don't require much lateral movement
      const lateralCost = Math.abs(orb.x - playerX) * 2;
      const score = -dist - lateralCost;
      if (score > bestOrbScore) {
        bestOrbScore = score;
        bestOrb = orb;
      }
    }

    // Decide target position
    if (nearestObs && nearestDist < LOOK_AHEAD) {
      if (nearestObs.isGate) {
        // Head for the gap
        this.targetX = nearestObs.gapX;

        // If we can't reach the gap in time, shatter through
        const timeToReach = nearestDist / speed;
        const distToGap = Math.abs(playerX - nearestObs.gapX);
        const canReach = distToGap / (8 * timeToReach) < 1.2; // 8 = move speed

        if (!canReach && nearestDist < SHATTER_RANGE) {
          result.shatter = true;
          this.shatterTimer = 0.3; // hold shatter for a bit
        }
      } else {
        // Dodge pillar — go to whichever side has more room
        const leftSpace = nearestObs.x - nearestObs.halfWidth;
        const rightSpace = -(nearestObs.x + nearestObs.halfWidth);

        if (playerX < nearestObs.x) {
          // We're to the left, dodge left
          this.targetX = nearestObs.x - nearestObs.halfWidth - 1.5;
        } else {
          // We're to the right, dodge right
          this.targetX = nearestObs.x + nearestObs.halfWidth + 1.5;
        }

        // Shatter if too close to dodge
        const timeToReach = nearestDist / speed;
        const distToDodge = Math.abs(playerX - this.targetX);
        if (timeToReach < 0.15 && distToDodge > 1) {
          result.shatter = true;
          this.shatterTimer = 0.25;
        }
      }
    } else if (bestOrb) {
      // No immediate threat, go for orbs
      this.targetX = bestOrb.x;
    } else {
      // Drift toward center
      this.targetX = this.targetX * 0.95;
    }

    // Clamp target
    this.targetX = Math.max(-3.5, Math.min(3.5, this.targetX));

    // Shatter timer
    if (this.shatterTimer > 0) {
      result.shatter = true;
      this.shatterTimer -= 1 / 60; // approximate dt
    }

    // Convert target to movement input
    const diff = this.targetX - playerX;
    if (Math.abs(diff) > 0.3) {
      result.moveX = Math.sign(diff) * Math.min(1, Math.abs(diff) * 0.8);
    }

    // Occasionally shatter for style (every ~8 seconds, 0.5s burst)
    if (!result.shatter && Math.random() < 0.002) {
      this.shatterTimer = 0.4;
    }

    return result;
  }
}
