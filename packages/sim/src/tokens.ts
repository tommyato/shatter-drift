import { createToken } from './lib/token'
import type { SimulationConfig, SimulationInput } from './types'
import type { SimulationWorld } from './sim-world'

export const RandomToken = createToken<() => number>('Random')
export const SimulationConfigToken = createToken<SimulationConfig>('SimulationConfig')
/** Per-player inputs — index aligns with `players[i].playerIndex`. Array of length `playerCount`. */
export const SimulationInputsToken = createToken<readonly SimulationInput[]>('SimulationInputs')
/** Local-player input (back-compat alias for `inputs[localPlayerIndex]`). */
export const SimulationInputToken = createToken<SimulationInput>('SimulationInput')
export const SimulationWorldToken = createToken<SimulationWorld>('SimulationWorld')

export const SpeedModSystemToken = createToken<(dt: number) => void>('SpeedModSystem')
export const PlayerMovementSystemToken = createToken<(dt: number) => void>('PlayerMovementSystem')
export const WorldScrollSystemToken = createToken<(dt: number) => void>('WorldScrollSystem')
export const ObstacleSpawnSystemToken = createToken<(dt: number) => void>('ObstacleSpawnSystem')
export const ObstacleDespawnSystemToken = createToken<(dt: number) => void>('ObstacleDespawnSystem')
export const PlayerCollisionSystemToken = createToken<(dt: number) => void>('PlayerCollisionSystem')
export const CollisionSystemToken = createToken<(dt: number) => void>('CollisionSystem')
export const ShatterSystemToken = createToken<(dt: number) => void>('ShatterSystem')
export const OrbSystemToken = createToken<(dt: number) => void>('OrbSystem')
export const BossAnimationSystemToken = createToken<(dt: number) => void>('BossAnimationSystem')
export const RiftFlipSystemToken = createToken<(dt: number) => void>('RiftFlipSystem')
