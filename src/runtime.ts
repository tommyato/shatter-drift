import { createContainer, type Container } from './lib/di'
import { getSystemRandom, mulberry32 } from './constants'
import { createAgentInput } from './input/agent-input'
import { createSimulationWorld } from './sim-world'
import {
	CollisionSystemToken,
	ObstacleDespawnSystemToken,
	ObstacleSpawnSystemToken,
	OrbSystemToken,
	PlayerMovementSystemToken,
	RandomToken,
	ShatterSystemToken,
	SimulationInputToken,
	SimulationWorldToken,
	WorldScrollSystemToken,
} from './tokens'
import type { GameEvent, GameSnapshot, SimulationConfig } from './types'
import { createCollisionSystem } from './systems/collision-system'
import { createObstacleDespawnSystem } from './systems/obstacle-despawn-system'
import { createObstacleSpawnSystem } from './systems/obstacle-spawn-system'
import { createOrbSystem } from './systems/orb-system'
import { createPlayerMovementSystem } from './systems/player-movement-system'
import { createShatterSystem } from './systems/shatter-system'
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

	const world = container.get(SimulationWorldToken)
	const playerMovementSystem = container.get(PlayerMovementSystemToken)
	const worldScrollSystem = container.get(WorldScrollSystemToken)
	const obstacleSpawnSystem = container.get(ObstacleSpawnSystemToken)
	const shatterSystem = container.get(ShatterSystemToken)
	const collisionSystem = container.get(CollisionSystemToken)
	const orbSystem = container.get(OrbSystemToken)
	const obstacleDespawnSystem = container.get(ObstacleDespawnSystemToken)
	const input = container.get(SimulationInputToken)

	return {
		container,
		reset() {
			world.reset()
		},
		update(dt: number) {
			worldScrollSystem(dt)
			shatterSystem(dt)
			playerMovementSystem(dt)
			obstacleSpawnSystem(dt)
			orbSystem(dt)
			collisionSystem(dt)
			obstacleDespawnSystem(dt)
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

