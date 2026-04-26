import { createContainer, type Container } from './lib/di'
import { getSystemRandom, mulberry32 } from './constants'
import { createAgentInput } from './input/agent-input'
import { createSimulationWorld } from './sim-world'
import {
	BossAnimationSystemToken,
	CollisionSystemToken,
	ObstacleDespawnSystemToken,
	ObstacleSpawnSystemToken,
	OrbSystemToken,
	PlayerMovementSystemToken,
	RandomToken,
	RiftFlipSystemToken,
	ShatterSystemToken,
	SimulationInputToken,
	SimulationWorldToken,
	SpeedModSystemToken,
	WorldScrollSystemToken,
} from './tokens'
import type { GameEvent, GameSnapshot, SimulationConfig } from './types'
import { createBossAnimationSystem } from './systems/boss-animation-system'
import { createCollisionSystem } from './systems/collision-system'
import { createObstacleDespawnSystem } from './systems/obstacle-despawn-system'
import { createObstacleSpawnSystem } from './systems/obstacle-spawn-system'
import { createOrbSystem } from './systems/orb-system'
import { createPlayerMovementSystem } from './systems/player-movement-system'
import { createRiftFlipSystem } from './systems/rift-flip-system'
import { createShatterSystem } from './systems/shatter-system'
import { createSpeedModSystem } from './systems/speed-mod-system'
import { createWorldScrollSystem } from './systems/world-scroll-system'

export interface SimulationRuntime {
	container: Container
	reset(): void
	update(dt: number): void
	setAction(action: number): void
	getState(): GameSnapshot
	getObservation(): Float64Array
	drainEvents(): GameEvent[]
}

export function createRuntime(config: SimulationConfig = {}): SimulationRuntime {
	const container = createContainer()
	const random =
		Number.isFinite(config.seed) && config.seed !== undefined
			? mulberry32(Number(config.seed))
			: getSystemRandom()

	container.bind(RandomToken).toValue(random)
	container.bind(SimulationInputToken).toFactory(createAgentInput).asSingleton()
	container
		.bind(SimulationWorldToken)
		.toFactory(createSimulationWorld)
		.withDeps(SimulationInputToken, RandomToken)
		.asSingleton()

	container
		.bind(SpeedModSystemToken)
		.toFactory(createSpeedModSystem)
		.withDeps(SimulationWorldToken)
		.asSingleton()
	container
		.bind(PlayerMovementSystemToken)
		.toFactory(createPlayerMovementSystem)
		.withDeps(SimulationWorldToken)
		.asSingleton()
	container
		.bind(WorldScrollSystemToken)
		.toFactory(createWorldScrollSystem)
		.withDeps(SimulationWorldToken)
		.asSingleton()
	container
		.bind(ObstacleSpawnSystemToken)
		.toFactory(createObstacleSpawnSystem)
		.withDeps(SimulationWorldToken)
		.asSingleton()
	container
		.bind(ObstacleDespawnSystemToken)
		.toFactory(createObstacleDespawnSystem)
		.withDeps(SimulationWorldToken)
		.asSingleton()
	container
		.bind(ShatterSystemToken)
		.toFactory(createShatterSystem)
		.withDeps(SimulationWorldToken)
		.asSingleton()
	container
		.bind(CollisionSystemToken)
		.toFactory(createCollisionSystem)
		.withDeps(SimulationWorldToken)
		.asSingleton()
	container
		.bind(OrbSystemToken)
		.toFactory(createOrbSystem)
		.withDeps(SimulationWorldToken)
		.asSingleton()
	container
		.bind(BossAnimationSystemToken)
		.toFactory(createBossAnimationSystem)
		.withDeps(SimulationWorldToken)
		.asSingleton()
	container
		.bind(RiftFlipSystemToken)
		.toFactory(createRiftFlipSystem)
		.withDeps(SimulationWorldToken)
		.asSingleton()

	const world = container.get(SimulationWorldToken)
	const speedModSystem = container.get(SpeedModSystemToken)
	const playerMovementSystem = container.get(PlayerMovementSystemToken)
	const worldScrollSystem = container.get(WorldScrollSystemToken)
	const obstacleSpawnSystem = container.get(ObstacleSpawnSystemToken)
	const shatterSystem = container.get(ShatterSystemToken)
	const collisionSystem = container.get(CollisionSystemToken)
	const orbSystem = container.get(OrbSystemToken)
	const obstacleDespawnSystem = container.get(ObstacleDespawnSystemToken)
	const bossAnimationSystem = container.get(BossAnimationSystemToken)
	const riftFlipSystem = container.get(RiftFlipSystemToken)
	const input = container.get(SimulationInputToken)

	return {
		container,
		reset() {
			world.reset()
		},
		update(dt: number) {
			speedModSystem(dt)      // update speedMod first so worldScrollSystem sees it
			worldScrollSystem(dt)
			shatterSystem(dt)
			playerMovementSystem(dt)
			obstacleSpawnSystem(dt)
			bossAnimationSystem(dt)
			orbSystem(dt)
			collisionSystem(dt)
			obstacleDespawnSystem(dt)
			riftFlipSystem(dt)
		},
		setAction(action: number) {
			input.setAction(action)
		},
		getState() {
			return world.getState()
		},
		getObservation() {
			return world.getObservation().slice()
		},
		drainEvents() {
			return world.drainEvents()
		},
	}
}

