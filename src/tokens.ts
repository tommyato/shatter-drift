import { createToken } from './lib/token'
import type { SimulationInput } from './types'
import type { SimulationWorld } from './sim-world'

export const RandomToken = createToken<() => number>('Random')
export const SimulationInputToken = createToken<SimulationInput>('SimulationInput')
export const SimulationWorldToken = createToken<SimulationWorld>('SimulationWorld')

export const PlayerMovementSystemToken = createToken<(dt: number) => void>('PlayerMovementSystem')
export const WorldScrollSystemToken = createToken<(dt: number) => void>('WorldScrollSystem')
export const ObstacleSpawnSystemToken = createToken<(dt: number) => void>('ObstacleSpawnSystem')
export const ObstacleDespawnSystemToken = createToken<(dt: number) => void>('ObstacleDespawnSystem')
export const CollisionSystemToken = createToken<(dt: number) => void>('CollisionSystem')
export const ShatterSystemToken = createToken<(dt: number) => void>('ShatterSystem')
export const OrbSystemToken = createToken<(dt: number) => void>('OrbSystem')

