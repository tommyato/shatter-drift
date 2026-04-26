import type { SimulationWorld } from '../sim-world'
import { biomeFromDistance } from './obstacle-patterns'
import { updateRiftFlip } from './gravity-flip-scheduler'

/**
 * Headless Cosmic Rift flip scheduler system. Advances the scheduler state and
 * pushes `rift_flip_warning` / `rift_flip_start` / `rift_flip_end` events. The
 * live game listens for these to drive the camera inversion + HUD warning.
 *
 * Never fires outside biome 4 (Cosmic Rift, ≥1800m). Never starts a warning
 * while ANY player is mid-phase (would feel like a cheap shot for the live one).
 *
 * The anchor used for biome and distance is the fastest live player — that's
 * who's about to enter Cosmic Rift first.
 */
export function createRiftFlipSystem(world: SimulationWorld) {
	return (dt: number) => {
		const anchor = world.anchorZ()
		const biome = biomeFromDistance(anchor)
		// Suppress new warnings while any player is mid-phase. Already-active
		// flips finish normally — we only gate the warning→active transition.
		const anyPhasing = world.state.players.some((p) => p.alive && p.shattered)
		const canTrigger = !anyPhasing

		const events = updateRiftFlip(
			world.state.riftFlip,
			dt,
			anchor,
			biome,
			canTrigger,
			world.random,
		)

		for (const event of events) {
			world.pushEvent({ type: event.type })
		}
	}
}
