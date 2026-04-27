import { PLAYER_COLLISION_RADIUS } from '../constants'
import type { PlayerState } from '../types'
import type { SimulationObstacle, SimulationWorld } from '../sim-world'
import { SpatialHash } from '../spatial-hash'

function findCollisionFor(
	world: SimulationWorld,
	player: PlayerState,
	spatialHash: SpatialHash,
): SimulationObstacle | null {
	// Query spatial hash for nearby obstacles (broadphase)
	const queryRadius = 5 // Player collision radius + max obstacle halfWidth (typically 3) + margin
	const candidates = spatialHash.queryCircle(player.x, player.z, queryRadius)

	// Narrow phase: exact collision checks on candidates only
	for (const obstacleIndex of candidates) {
		const obstacle = world.state.obstacles[obstacleIndex]
		if (!obstacle || !obstacle.active) continue
		if (obstacle.ghosted) continue // Neon District blink — non-colliding window

		const dz = Math.abs(player.z - obstacle.z)
		if (dz > 2) continue

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
	const spatialHash = new SpatialHash(6.0)

	return (_dt: number) => {
		// Rebuild spatial hash each frame
		spatialHash.clear()
		for (let i = 0; i < world.state.obstacles.length; i++) {
			const obstacle = world.state.obstacles[i]
			if (!obstacle.active) continue

			// Use obstacle's position and size as radius
			const radius = Math.max(obstacle.halfWidth, 2)
			spatialHash.insert(i, obstacle.x, obstacle.z, radius)
		}

		// Check collisions for each player
		for (const player of world.state.players) {
			if (!player.alive || player.shattered) continue
			const hit = findCollisionFor(world, player, spatialHash)
			if (!hit) continue
			player.alive = false
			world.pushEvent({ type: 'death' })
		}
	}
}
