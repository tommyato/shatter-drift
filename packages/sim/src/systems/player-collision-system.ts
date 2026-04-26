import {
	BUMP_MASS_BOOST_FACTOR,
	BUMP_MIN_CONTACT_IMPULSE,
	BUMP_RESTITUTION,
	BUMP_RAMMER_WINDOW,
	BUMP_VEL_DECAY,
	MAX_BUMP_KICK,
	PLAYABLE_HALF_WIDTH,
	PLAYER_BUMP_RADIUS,
	clamp,
} from '../constants'
import type { SimulationWorld } from '../sim-world'

/**
 * Phase 3 — sphere-bump player collision.
 *
 * Runs after `PlayerMovementSystem` (so input-driven x is settled) and before
 * `CollisionSystem` (obstacle). Iterates all ordered pairs (i < j); resolves
 * overlap and applies a lateral velocity impulse. Tracks rammer-credit for
 * kill attribution (Phase 4 results screen).
 *
 * Determinism: no Math.random() calls. All RNG-free. simTime is incremented
 * deterministically by dt each tick. bumpVelX decays via exponential formula
 * (deterministic for fixed dt).
 */
export function createPlayerCollisionSystem(world: SimulationWorld) {
	return (dt: number) => {
		const state = world.state

		// Tick simTime and decay bumpVelX for all players
		state.simTime += dt
		const decayFactor = Math.exp(-BUMP_VEL_DECAY * dt)
		for (const player of state.players) {
			player.bumpVelX *= decayFactor
			// Apply ongoing bump velocity to position
			if (Math.abs(player.bumpVelX) > 0.001) {
				player.x = clamp(player.x + player.bumpVelX * dt, -PLAYABLE_HALF_WIDTH, PLAYABLE_HALF_WIDTH)
			}
			// Clear stale rammer credit
			if (
				player.lastRammedBy !== null &&
				state.simTime - player.lastRammedAt > BUMP_RAMMER_WINDOW
			) {
				player.lastRammedBy = null
			}
		}

		const players = state.players
		const minDist = 2 * PLAYER_BUMP_RADIUS

		// Pairwise collision — ordered i < j for determinism
		for (let i = 0; i < players.length; i++) {
			const a = players[i]
			if (!a.alive) continue

			for (let j = i + 1; j < players.length; j++) {
				const b = players[j]
				if (!b.alive) continue

				let dx = b.x - a.x
				const dz = b.z - a.z
				const distSq = dx * dx + dz * dz
				if (distSq >= minDist * minDist) continue

				const dist = Math.sqrt(distSq)
				const overlap = minDist - dist

				// Contact normal (from A toward B)
				const invDist = dist < 0.0001 ? 1 / 0.0001 : 1 / dist
				const nx = dx * invDist
				const nz = dz * invDist

				// --- Sprint 3.5: boost mass multiplier ---
				const massA = a.boostTimer > 0 ? BUMP_MASS_BOOST_FACTOR : 1.0
				const massB = b.boostTimer > 0 ? BUMP_MASS_BOOST_FACTOR : 1.0

				// Relative velocity along the contact normal
				// Lateral: use stored bumpVelX (input-driven x velocity is not in state)
				// Longitudinal: use speed * speedMod (z velocity)
				const relVx = b.bumpVelX - a.bumpVelX
				const relVz = b.speed * b.speedMod - a.speed * a.speedMod
				const relVn = -(relVx * nx + relVz * nz)  // positive = closing

				// --- Sprint 3.2: impulse model ---
				// Use max of actual approach speed and minimum contact impulse so
				// side-by-side same-speed players still get a satisfying nudge.
				const effectiveApproach = Math.max(BUMP_MIN_CONTACT_IMPULSE, relVn)
				const kickMag = Math.min(BUMP_RESTITUTION * effectiveApproach, MAX_BUMP_KICK)

				// Direction: lateral only (x). Determine which side B is relative to A.
				// If dx ≈ 0 (head-on z collision), use small fallback to avoid symmetry freeze.
				if (Math.abs(dx) < 0.001) dx = 0.001
				const signX = dx > 0 ? 1.0 : -1.0

				// Apply lateral impulse — A pushed away from B, B pushed away from A
				a.bumpVelX = clamp(a.bumpVelX - (kickMag / massA) * signX, -MAX_BUMP_KICK, MAX_BUMP_KICK)
				b.bumpVelX = clamp(b.bumpVelX + (kickMag / massB) * signX, -MAX_BUMP_KICK, MAX_BUMP_KICK)

				// Separate overlapping spheres by half-overlap each (x only; z driven by speed)
				const halfOverlap = overlap * 0.5
				a.x = clamp(a.x - nx * halfOverlap, -PLAYABLE_HALF_WIDTH, PLAYABLE_HALF_WIDTH)
				b.x = clamp(b.x + nx * halfOverlap, -PLAYABLE_HALF_WIDTH, PLAYABLE_HALF_WIDTH)

				// --- Sprint 3.4: rammer-credit tracking ---
				// Rammer = the player behind (lower z) who is also going as fast or faster.
				// Covers both direct-from-behind and lateral collisions (lateral wins go to
				// whoever has higher z-speed).
				const aIsBehind = a.z < b.z
				const aIsFaster = a.speed * a.speedMod >= b.speed * b.speedMod
				if (aIsBehind && aIsFaster) {
					b.lastRammedBy = a.playerIndex
					b.lastRammedAt = state.simTime
				} else if (!aIsBehind && !aIsFaster) {
					a.lastRammedBy = b.playerIndex
					a.lastRammedAt = state.simTime
				}
				// Lateral collisions at same speed: no rammer credit assigned (neither is clearly the aggressor)

				// --- Sprint 3.3: emit event for visual/audio feedback ---
				world.pushEvent({
					type: 'player_bumped',
					playerA: a.playerIndex,
					playerB: b.playerIndex,
					contactX: (a.x + b.x) * 0.5,
					contactZ: (a.z + b.z) * 0.5,
				})
			}
		}
	}
}
