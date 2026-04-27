import type { SimulationWorld } from '../sim-world'
import { biomeFromDistance } from './obstacle-patterns'

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

// Crystal Caves (biome 1) — freeze
export const FREEZE_RADIUS = 6     // m — triggers freeze when obstacle is this close ahead
export const FREEZE_DURATION = 0.4 // s — obstacle stays frozen this long
export const FREEZE_COOLDOWN = 0.6 // s — post-thaw cooldown before re-freeze is eligible
export const FREEZE_MAX = 2        // max simultaneous frozen obstacles per frame

// Neon District (biome 2) — blink
export const BLINK_SOLID = 0.25   // s solid (colliding)
export const BLINK_GHOST = 0.20   // s ghosted (non-colliding)
export const BLINK_CYCLE = 0.45   // total cycle — must equal BLINK_SOLID + BLINK_GHOST

// Solar Storm (biome 3) — lateral drift
export const DRIFT_AMPLITUDE = 1.5  // m peak-to-peak half amplitude
export const DRIFT_FREQUENCY = 0.6  // Hz

export function createBiomeGimmickSystem(world: SimulationWorld) {
	return (dt: number) => {
		const state = world.state

		// Anchor player for biome detection and freeze proximity
		const anchorZ = world.anchorZ()

		// Find the alive anchor player (fastest) for speed reference
		let anchorPlayer = state.players[0]
		for (const p of state.players) {
			if (p.alive && p.z >= (anchorPlayer?.z ?? -Infinity)) anchorPlayer = p
		}
		const playerSpeed = anchorPlayer?.speed ?? 0
		const playerBiome = biomeFromDistance(anchorZ)

		// -----------------------------------------------------------------------
		// Biome 1: Crystal Caves freeze
		// Obstacles within FREEZE_RADIUS ahead of the player freeze for FREEZE_DURATION.
		// While frozen the obstacle advances at player speed so relative distance stays fixed.
		// After thaw a FREEZE_COOLDOWN prevents immediate re-freeze.
		// -----------------------------------------------------------------------

		let frozenCount = 0

		for (const obs of state.obstacles) {
			if (!obs.active) continue

			if (biomeFromDistance(obs.z) !== 1) {
				// Clear frozen state when obstacle leaves biome 1 (shouldn't happen mid-freeze
				// but be safe — obstacles don't change biome during normal play)
				if ((obs.frozenTimer ?? 0) > 0) obs.frozenTimer = 0
				continue
			}

			// Tick down timers
			if ((obs.frozenTimer ?? 0) > 0) {
				obs.frozenTimer = Math.max(0, obs.frozenTimer! - dt)
				// Advance obstacle z at player speed so it holds relative distance
				obs.z += playerSpeed * dt
				frozenCount++
				if (obs.frozenTimer <= 0) {
					obs.freezeCooldown = FREEZE_COOLDOWN
				}
			} else if ((obs.freezeCooldown ?? 0) > 0) {
				obs.freezeCooldown = Math.max(0, obs.freezeCooldown! - dt)
			}
		}

		// Trigger new freezes when player is in biome 1
		if (playerBiome === 1 && frozenCount < FREEZE_MAX) {
			const candidates: { z: number; idx: number }[] = []
			for (let i = 0; i < state.obstacles.length; i++) {
				const obs = state.obstacles[i]!
				if (!obs.active) continue
				if (biomeFromDistance(obs.z) !== 1) continue
				if ((obs.frozenTimer ?? 0) > 0 || (obs.freezeCooldown ?? 0) > 0) continue
				const dist = obs.z - anchorZ
				if (dist > 0 && dist <= FREEZE_RADIUS) candidates.push({ z: obs.z, idx: i })
			}
			// Sort ascending by distance (closest first)
			candidates.sort((a, b) => a.z - b.z)
			for (const { idx } of candidates.slice(0, FREEZE_MAX - frozenCount)) {
				state.obstacles[idx]!.frozenTimer = FREEZE_DURATION
			}
		}

		// -----------------------------------------------------------------------
		// Biome 2: Neon District blink
		// Each obstacle cycles solid (colliding) / ghosted (non-colliding) based on
		// simTime + per-obstacle phase offset. Offset is seeded from obstacle z so
		// adjacent obstacles don't strobe in unison.
		// -----------------------------------------------------------------------

		for (const obs of state.obstacles) {
			if (!obs.active) continue

			if (biomeFromDistance(obs.z) !== 2) {
				// Clear ghosted state so an obstacle can't carry it into another biome
				if (obs.ghosted) obs.ghosted = false
				continue
			}

			// Init once
			if (obs.blinkOffset === undefined) {
				obs.blinkOffset = (obs.z * 1.6180339887) % BLINK_CYCLE
			}

			const phase = (state.simTime + obs.blinkOffset) % BLINK_CYCLE
			obs.ghosted = phase >= BLINK_SOLID
		}

		// -----------------------------------------------------------------------
		// Biome 3: Solar Storm lateral drift
		// Obstacles sine-drift in X. Gates shift gapX and wall segment positions
		// so collision geometry matches the visual drift. Pillars shift obs.x.
		// -----------------------------------------------------------------------

		for (const obs of state.obstacles) {
			if (!obs.active) continue

			if (biomeFromDistance(obs.z) !== 3) continue

			// Init drift state once per obstacle using obs.z as deterministic seed
			if (obs.driftPhase === undefined) {
				obs.driftPhase = (obs.z * 2.718281828) % (Math.PI * 2)
				obs.baseX = obs.isGate ? obs.gapX : obs.x
				if (obs.wallSegments) {
					obs.baseWallSegmentX = obs.wallSegments.map((s) => s.x)
				}
			}

			const driftOffset =
				DRIFT_AMPLITUDE * Math.sin(state.simTime * DRIFT_FREQUENCY * Math.PI * 2 + obs.driftPhase)

			if (obs.isGate) {
				obs.gapX = (obs.baseX ?? 0) + driftOffset
				if (obs.wallSegments && obs.baseWallSegmentX) {
					for (let i = 0; i < obs.wallSegments.length; i++) {
						obs.wallSegments[i]!.x = (obs.baseWallSegmentX[i] ?? 0) + driftOffset
					}
				}
			} else {
				obs.x = (obs.baseX ?? 0) + driftOffset
			}
		}
	}
}
