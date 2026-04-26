import { PLAYER_COLLISION_RADIUS } from '../constants'
import type { PlayerState } from '../types'
import type { SimulationObstacle, SimulationWorld } from '../sim-world'

function findCollisionFor(world: SimulationWorld, player: PlayerState): SimulationObstacle | null {
	for (const obstacle of world.state.obstacles) {
		if (!obstacle.active) {
			continue
		}
		const dz = Math.abs(player.z - obstacle.z)
		if (dz > 2) {
			continue
		}
		if (obstacle.isGate && obstacle.wallSegments) {
			for (const segment of obstacle.wallSegments) {
				const dx = Math.abs(player.x - segment.x)
				if (dx < segment.halfWidth + PLAYER_COLLISION_RADIUS - 0.15) {
					return obstacle
				}
			}
			continue
		}
		const dx = Math.abs(player.x - obstacle.x)
		if (dx < obstacle.halfWidth + PLAYER_COLLISION_RADIUS) {
			return obstacle
		}
	}
	return null
}

export function createCollisionSystem(world: SimulationWorld) {
	return (_dt: number) => {
		for (const player of world.state.players) {
			if (!player.alive || player.shattered) continue
			const hit = findCollisionFor(world, player)
			if (!hit) continue
			player.alive = false
			world.pushEvent({ type: 'death' })
		}
	}
}
