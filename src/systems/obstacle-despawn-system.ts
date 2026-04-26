import { DESPAWN_DISTANCE } from '../constants'
import type { SimulationWorld } from '../sim-world'

/**
 * Despawn obstacles/orbs once they're behind every live player. With N>1
 * players we use the trailing (slowest) player as the cutoff, so a faster
 * peer racing ahead doesn't cull obstacles their teammates are still
 * approaching.
 */
export function createObstacleDespawnSystem(world: SimulationWorld) {
	return (_dt: number) => {
		const cutoff = world.trailingZ()
		for (const obstacle of world.state.obstacles) {
			if (!obstacle.active) {
				continue
			}
			if (obstacle.z < cutoff + DESPAWN_DISTANCE) {
				obstacle.active = false
				if (!obstacle.passed) {
					obstacle.passed = true
					world.pushEvent({ type: 'obstacle_passed' })
				}
			}
		}

		for (const orb of world.state.orbs) {
			if (orb.active && orb.z < cutoff + DESPAWN_DISTANCE) {
				orb.active = false
			}
		}

		world.state.obstacles = world.state.obstacles.filter((obstacle) => obstacle.active)
		world.state.orbs = world.state.orbs.filter((orb) => orb.active)
	}
}
