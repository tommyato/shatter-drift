import { createContainer, type Container } from './lib/di'
import { getSystemRandom, mulberry32 } from './constants'
import { createAgentInput } from './input/agent-input'
import { createSimulationWorld } from './sim-world'
import {
	BiomeGimmickSystemToken,
	BossAnimationSystemToken,
	CollisionSystemToken,
	ObstacleDespawnSystemToken,
	ObstacleSpawnSystemToken,
	OrbSystemToken,
	PlayerCollisionSystemToken,
	PlayerMovementSystemToken,
	RandomToken,
	RiftFlipSystemToken,
	ShatterSystemToken,
	SimulationConfigToken,
	SimulationInputToken,
	SimulationInputsToken,
	SimulationWorldToken,
	SpeedModSystemToken,
	WorldScrollSystemToken,
} from './tokens'
import type {
	AuthoritativeStateSnapshot,
	GameEvent,
	GameSnapshot,
	SimulationConfig,
	SimulationInput,
} from './types'
import { createBiomeGimmickSystem } from './systems/biome-gimmick-system'
import { createBossAnimationSystem } from './systems/boss-animation-system'
import { createCollisionSystem } from './systems/collision-system'
import { createPlayerCollisionSystem } from './systems/player-collision-system'
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
	/** Set the action for a specific player. Defaults to local player. */
	setAction(action: number, playerIndex?: number): void
	getState(): GameSnapshot
	getAuthoritativeState(): AuthoritativeStateSnapshot
	getObservation(): Float64Array
	drainEvents(): GameEvent[]
}

export function createRuntime(config: SimulationConfig = {}): SimulationRuntime {
	const container = createContainer()
	const playerCount = Math.max(1, config.playerCount ?? 1)
	const localPlayerIndex = Math.max(0, Math.min(playerCount - 1, config.localPlayerIndex ?? 0))
	const random =
		Number.isFinite(config.seed) && config.seed !== undefined
			? mulberry32(Number(config.seed))
			: getSystemRandom()

	const inputs: SimulationInput[] = Array.from({ length: playerCount }, () => createAgentInput())

	container.bind(RandomToken).toValue(random)
	container.bind(SimulationConfigToken).toValue(config)
	container.bind(SimulationInputsToken).toValue(inputs)
	container.bind(SimulationInputToken).toValue(inputs[localPlayerIndex]!)
	container
		.bind(SimulationWorldToken)
		.toFactory(createSimulationWorld)
		.withDeps(SimulationInputsToken, RandomToken, SimulationConfigToken)
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
		.bind(PlayerCollisionSystemToken)
		.toFactory(createPlayerCollisionSystem)
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
	container
		.bind(BiomeGimmickSystemToken)
		.toFactory(createBiomeGimmickSystem)
		.withDeps(SimulationWorldToken)
		.asSingleton()

	const world = container.get(SimulationWorldToken)
	const speedModSystem = container.get(SpeedModSystemToken)
	const playerMovementSystem = container.get(PlayerMovementSystemToken)
	const playerCollisionSystem = container.get(PlayerCollisionSystemToken)
	const worldScrollSystem = container.get(WorldScrollSystemToken)
	const obstacleSpawnSystem = container.get(ObstacleSpawnSystemToken)
	const shatterSystem = container.get(ShatterSystemToken)
	const collisionSystem = container.get(CollisionSystemToken)
	const orbSystem = container.get(OrbSystemToken)
	const obstacleDespawnSystem = container.get(ObstacleDespawnSystemToken)
	const bossAnimationSystem = container.get(BossAnimationSystemToken)
	const riftFlipSystem = container.get(RiftFlipSystemToken)
	const biomeGimmickSystem = container.get(BiomeGimmickSystemToken)

	return {
		container,
		reset() {
			world.reset()
		},
		update(dt: number) {
			speedModSystem(dt)        // update speedMod first so worldScrollSystem sees it
			worldScrollSystem(dt)
			shatterSystem(dt)
			playerMovementSystem(dt)
			playerCollisionSystem(dt) // after movement, before obstacle collision
			obstacleSpawnSystem(dt)
			bossAnimationSystem(dt)
			biomeGimmickSystem(dt)    // biome gimmicks after boss animation, before collision
			orbSystem(dt)
			collisionSystem(dt)
			obstacleDespawnSystem(dt)
			riftFlipSystem(dt)
		},
		setAction(action: number, playerIndex?: number) {
			const idx = playerIndex ?? localPlayerIndex
			const input = inputs[idx]
			if (input) input.setAction(action)
		},
		getState() {
			return world.getState()
		},
		getAuthoritativeState() {
			return world.getAuthoritativeState()
		},
		getObservation() {
			return world.getObservation().slice()
		},
		drainEvents() {
			return world.drainEvents()
		},
	}
}
