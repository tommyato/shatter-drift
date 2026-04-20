import {
	INITIAL_OBSTACLE_Z,
	INITIAL_ORB_Z,
	ORB_SPACING,
	PLAYABLE_HALF_WIDTH,
	SPAWN_DISTANCE,
} from '../constants'
import type { SimulationObstacle, SimulationWorld } from '../sim-world'

function createGate(world: SimulationWorld, z: number, gapHalfWidth: number): void {
	const gapX = (world.random() - 0.5) * 5
	const leftWidth = gapX - gapHalfWidth + PLAYABLE_HALF_WIDTH
	const rightStart = gapX + gapHalfWidth
	const rightWidth = PLAYABLE_HALF_WIDTH - rightStart
	const wallSegments = []
	if (leftWidth > 0.5) {
		wallSegments.push({
			x: -PLAYABLE_HALF_WIDTH + leftWidth / 2,
			halfWidth: leftWidth / 2,
		})
	}
	if (rightWidth > 0.5) {
		wallSegments.push({
			x: rightStart + rightWidth / 2,
			halfWidth: rightWidth / 2,
		})
	}
	world.state.obstacles.push({
		z,
		x: 0,
		halfWidth: PLAYABLE_HALF_WIDTH,
		halfHeight: 1.5,
		isGate: true,
		gapX,
		gapHalfWidth,
		active: true,
		partiallyShattered: false,
		passed: false,
		wallSegments,
	})
}

function createPillar(world: SimulationWorld, z: number, x?: number, width?: number): void {
	const centerX = x ?? (world.random() - 0.5) * 6
	const actualWidth = width ?? 1 + world.random() * 1.5
	const height = 2 + world.random() * 2
	world.state.obstacles.push({
		z,
		x: centerX,
		halfWidth: actualWidth / 2,
		halfHeight: height / 2,
		isGate: false,
		gapX: 0,
		gapHalfWidth: 0,
		active: true,
		partiallyShattered: false,
		passed: false,
	})
}

function createWideBar(world: SimulationWorld, z: number): void {
	const gapSide = world.random() < 0.5 ? -1 : 1
	const gapX = gapSide * (2 + world.random() * 2)
	const gapHalfWidth = 2
	const gapLeft = gapX - gapHalfWidth
	const gapRight = gapX + gapHalfWidth
	const leftWidth = gapLeft + PLAYABLE_HALF_WIDTH
	const rightWidth = PLAYABLE_HALF_WIDTH - gapRight
	const wallSegments = []
	if (leftWidth > 0.5) {
		wallSegments.push({
			x: -PLAYABLE_HALF_WIDTH + leftWidth / 2,
			halfWidth: leftWidth / 2,
		})
	}
	if (rightWidth > 0.5) {
		wallSegments.push({
			x: gapRight + rightWidth / 2,
			halfWidth: rightWidth / 2,
		})
	}
	world.state.obstacles.push({
		z,
		x: 0,
		halfWidth: PLAYABLE_HALF_WIDTH,
		halfHeight: 0.75,
		isGate: true,
		gapX,
		gapHalfWidth,
		active: true,
		partiallyShattered: false,
		passed: false,
		wallSegments,
	})
}

function spawnObstacle(world: SimulationWorld, z: number): void {
	const type = world.random()
	if (type < 0.4) {
		createGate(world, z, 2.25)
		return
	}
	if (type < 0.7) {
		createPillar(world, z)
		return
	}
	if (type < 0.85) {
		const spread = 2 + world.random() * 2
		const offset = (world.random() - 0.5) * 2
		createPillar(world, z, offset - spread, 1 + world.random())
		createPillar(world, z, offset + spread, 1 + world.random())
		return
	}
	createWideBar(world, z)
}

function spawnOrbCluster(world: SimulationWorld, z: number): void {
	const count = 1 + Math.floor(world.random() * 3)
	const baseX = (world.random() - 0.5) * 6
	for (let index = 0; index < count; index += 1) {
		world.state.orbs.push({
			x: baseX + (index - (count - 1) / 2) * 1.5,
			z: z + index * 1.5,
			active: true,
		})
	}
}

function getObstacleSpacing(world: SimulationWorld): number {
	const distance = world.state.playerZ
	if (distance < 300) {
		return 18 + world.random() * 6
	}
	if (distance < 700) {
		return 13 + world.random() * 5
	}
	if (distance < 1200) {
		return 9 + world.random() * 4
	}
	if (distance < 1800) {
		return 7 + world.random() * 4
	}
	return 5 + world.random() * 4
}

export function createObstacleSpawnSystem(world: SimulationWorld) {
	return (_dt: number) => {
		if (world.state.nextObstacleZ === 0) {
			world.state.nextObstacleZ = INITIAL_OBSTACLE_Z
		}
		if (world.state.nextOrbZ === 0) {
			world.state.nextOrbZ = INITIAL_ORB_Z
		}

		while (world.state.nextObstacleZ < world.state.playerZ + SPAWN_DISTANCE) {
			spawnObstacle(world, world.state.nextObstacleZ)
			world.state.nextObstacleZ += getObstacleSpacing(world)
		}

		while (world.state.nextOrbZ < world.state.playerZ + SPAWN_DISTANCE) {
			spawnOrbCluster(world, world.state.nextOrbZ)
			world.state.nextOrbZ += ORB_SPACING + world.random() * 5
		}
	}
}

export function destroyObstacle(
	world: SimulationWorld,
	obstacle: SimulationObstacle,
	impactX: number,
): boolean {
	if (!obstacle.active) {
		return false
	}
	if (!obstacle.isGate) {
		obstacle.active = false
		world.pushEvent({ type: 'wall_destroyed' })
		return true
	}

	if (!obstacle.wallSegments || obstacle.wallSegments.length === 0) {
		obstacle.active = false
		return false
	}

	let nearestIndex = 0
	let nearestDistance = Infinity
	for (let index = 0; index < obstacle.wallSegments.length; index += 1) {
		const distance = Math.abs(impactX - obstacle.wallSegments[index]!.x)
		if (distance < nearestDistance) {
			nearestDistance = distance
			nearestIndex = index
		}
	}

	obstacle.wallSegments.splice(nearestIndex, 1)
	obstacle.partiallyShattered = true
	world.pushEvent({ type: 'wall_destroyed' })

	if (obstacle.wallSegments.length === 0) {
		obstacle.active = false
		return true
	}

	if (obstacle.wallSegments.length === 1) {
		const segment = obstacle.wallSegments[0]!
		if (segment.x < 0) {
			const rightEdge = obstacle.gapX + obstacle.gapHalfWidth
			obstacle.gapX = (-PLAYABLE_HALF_WIDTH + rightEdge) / 2
			obstacle.gapHalfWidth = (rightEdge + PLAYABLE_HALF_WIDTH) / 2
		} else {
			const leftEdge = obstacle.gapX - obstacle.gapHalfWidth
			obstacle.gapX = (leftEdge + PLAYABLE_HALF_WIDTH) / 2
			obstacle.gapHalfWidth = (PLAYABLE_HALF_WIDTH - leftEdge) / 2
		}
	}

	return true
}

