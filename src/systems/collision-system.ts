import { PLAYER_COLLISION_RADIUS } from '../constants'
import type { SimulationObstacle, SimulationWorld } from '../sim-world'

function findCollision(world: SimulationWorld): SimulationObstacle | null {
	for (const obstacle of world.state.obstacles) {
		if (!obstacle.active) {
			continue
		}
		const dz = Math.abs(world.state.playerZ - obstacle.z)
		if (dz > 2) {
			continue
		}
		if (obstacle.isGate && obstacle.wallSegments) {
			for (const segment of obstacle.wallSegments) {
				const dx = Math.abs(world.state.playerX - segment.x)
				if (dx < segment.halfWidth + PLAYER_COLLISION_RADIUS - 0.15) {
					return obstacle
				}
			}
			continue
		}
		const dx = Math.abs(world.state.playerX - obstacle.x)
		if (dx < obstacle.halfWidth + PLAYER_COLLISION_RADIUS) {
			return obstacle
		}
	}
	return null
}

export function createCollisionSystem(world: SimulationWorld) {
	return (_dt: number) => {
		if (!world.state.alive || world.state.shattered) {
			return
		}
		const hit = findCollision(world)
		if (!hit) {
			return
		}
		world.state.alive = false
		world.pushEvent({ type: 'death' })
	}
}

