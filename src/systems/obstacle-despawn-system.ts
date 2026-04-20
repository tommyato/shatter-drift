import { DESPAWN_DISTANCE } from '../constants'
import type { SimulationWorld } from '../sim-world'

export function createObstacleDespawnSystem(world: SimulationWorld) {
	return (_dt: number) => {
		for (const obstacle of world.state.obstacles) {
			if (!obstacle.active) {
				continue
			}
			if (obstacle.z < world.state.playerZ + DESPAWN_DISTANCE) {
				obstacle.active = false
				if (!obstacle.passed) {
					obstacle.passed = true
					world.pushEvent({ type: 'obstacle_passed' })
				}
			}
		}

		for (const orb of world.state.orbs) {
			if (orb.active && orb.z < world.state.playerZ + DESPAWN_DISTANCE) {
				orb.active = false
			}
		}

		world.state.obstacles = world.state.obstacles.filter((obstacle) => obstacle.active)
		world.state.orbs = world.state.orbs.filter((orb) => orb.active)
	}
}

