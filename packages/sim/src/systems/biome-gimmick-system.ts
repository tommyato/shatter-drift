import type { SimulationWorld } from '../sim-world'
import { biomeFromDistance } from './obstacle-patterns'

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

// Neon District (biome 2) — blink
export const BLINK_SOLID = 0.25   // s solid (colliding)
export const BLINK_GHOST = 0.20   // s ghosted (non-colliding)
export const BLINK_CYCLE = 0.45   // total cycle — must equal BLINK_SOLID + BLINK_GHOST

// Crystal Caves (biome 1) — rising slabs
export const SLAB_FREQUENCY = 0.5    // Hz — slower than Solar (0.6 Hz) so rhythms read different
export const SLAB_AMPLITUDE = 3.0    // units of vertical travel
export const SLAB_PASS_HEIGHT = 0.5  // ghosted (passable) while slabOffset ≤ this (slab at/near rest)

// Solar Storm (biome 3) — lateral drift
export const DRIFT_AMPLITUDE = 1.5  // m peak-to-peak half amplitude
export const DRIFT_FREQUENCY = 0.6  // Hz

export function createBiomeGimmickSystem(world: SimulationWorld) {
	return (dt: number) => {
		const state = world.state

		// -----------------------------------------------------------------------
		// Biome 2: Neon District blink
		// Runs first so that the ghosted-clear for non-biome-2 obstacles doesn't
		// overwrite the Crystal slab ghosted state set below.
		// Each obstacle cycles solid (colliding) / ghosted (non-colliding) based on
		// simTime + per-obstacle phase offset. Offset is seeded from obstacle z so
		// adjacent obstacles don't strobe in unison.
		// -----------------------------------------------------------------------

		for (const obs of state.obstacles) {
			if (!obs.active) continue

			if (biomeFromDistance(obs.z) !== 2) {
				// Clear ghosted state so an obstacle can't carry it into another biome.
				// Crystal slab loop below will re-set ghosted for biome-1 slabs after this.
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
		// Biome 1: Crystal Caves — rising slabs
		// Runs AFTER Neon blink so the Neon ghosted-clear (above) doesn't clobber us.
		// Half-wave: slab rests at ground (offset=0) for the negative-sin half-cycle,
		// then rises 0 → SLAB_AMPLITUDE → 0 during the positive half. Never underground.
		// Passable while slabOffset ≤ SLAB_PASS_HEIGHT (at/near rest).
		// Phase is seeded from obs.z so adjacent slabs aren't in sync.
		// -----------------------------------------------------------------------

		for (const obs of state.obstacles) {
			if (!obs.active) continue
			if (biomeFromDistance(obs.z) !== 1) continue
			if (!obs.isRisingSlab) continue

			// Init per-slab phase once using spawn z as deterministic seed
			if (obs.slabPhase === undefined) {
				obs.slabPhase = (obs.z * 2.718281828) % (Math.PI * 2)
			}

			const rawSin = Math.sin(state.simTime * SLAB_FREQUENCY * Math.PI * 2 + obs.slabPhase)
			const slabOffset = Math.max(0, SLAB_AMPLITUDE * rawSin)
			// Passable while slab is at or near rest. Solid when raised above SLAB_PASS_HEIGHT.
			obs.ghosted = slabOffset <= SLAB_PASS_HEIGHT
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
