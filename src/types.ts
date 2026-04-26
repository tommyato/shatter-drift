export interface WallSegmentData {
	x: number
	halfWidth: number
}

export interface ObstacleData {
	z: number
	x: number
	halfWidth: number
	halfHeight: number
	isGate: boolean
	gapX: number
	gapHalfWidth: number
	active: boolean
	wallSegments?: WallSegmentData[]
}

export interface OrbData {
	x: number
	z: number
}

export interface GameSnapshot {
	playerX: number
	shattered: boolean
	shatterCooldown: number
	speed: number
	speedMod: number
	boostCooldown: number
	brakeCooldown: number
	distance: number
	score: number
	alive: boolean
	obstacles: ObstacleData[]
	orbs: OrbData[]
}

export type GameEvent =
	| { type: 'obstacle_passed' }
	| { type: 'orb_collected' }
	| { type: 'close_call' }
	| { type: 'shatter_activated' }
	| { type: 'wall_destroyed' }
	| { type: 'death' }
	| { type: 'pattern_emitted'; pattern: string; obstacleCount: number; startZ: number }
	| { type: 'rift_flip_warning' }
	| { type: 'rift_flip_start' }
	| { type: 'rift_flip_end' }

export interface SimulationInputState {
	horizontal: number
	shatter: boolean
	boost: boolean
	brake: boolean
}

export interface SimulationInput {
	getState(): SimulationInputState
	setAction(action: number): void
	reset(): void
}

export interface SimulationConfig {
	seed?: number
	fixedDt?: number
}

