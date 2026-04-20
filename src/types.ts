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

export interface SimulationInputState {
	horizontal: number
	shatter: boolean
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

