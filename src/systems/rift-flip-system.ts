import type { SimulationWorld } from '../sim-world'
import { biomeFromDistance } from './obstacle-patterns'
import { updateRiftFlip } from './gravity-flip-scheduler'

/**
 * Headless Cosmic Rift flip scheduler system. Advances the scheduler state and
 * pushes `rift_flip_warning` / `rift_flip_start` / `rift_flip_end` events. The
 * live game listens for these to drive the camera inversion + HUD warning.
 *
 * Never fires outside biome 4 (Cosmic Rift, ≥1800m). Never starts a warning
 * while the player is mid-phase (would feel like a cheap shot).
 */
export function createRiftFlipSystem(world: SimulationWorld) {
	return (dt: number) => {
		const biome = biomeFromDistance(world.state.playerZ)
		// Suppress new warnings while mid-phase. (An already-active flip still
		// completes normally; we only gate the warning→active transition.)
		const canTrigger = !world.state.shattered

		const events = updateRiftFlip(
			world.state.riftFlip,
			dt,
			world.state.playerZ,
			biome,
			canTrigger,
			world.random,
		)

		for (const event of events) {
			world.pushEvent({ type: event.type })
		}
	}
}
