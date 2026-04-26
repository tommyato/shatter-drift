import { computeSpeed } from '../constants'
import type { SimulationWorld } from '../sim-world'

/**
 * Per-player world scroll. Each player's z advances by their own
 * computed speed × speedMod. The world's "anchor" (used by spawners) is
 * the fastest live player — see `world.anchorZ()`.
 */
export function createWorldScrollSystem(world: SimulationWorld) {
	return (dt: number) => {
		for (const player of world.state.players) {
			if (!player.alive) continue
			player.speed = computeSpeed(player.z) * player.speedMod
			player.z += player.speed * dt
			player.score += Math.floor(player.speed * dt)
		}
	}
}
