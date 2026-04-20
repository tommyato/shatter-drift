import {
	CLOSE_CALL_SCORE,
	LOOKAHEAD_DISTANCE,
	LOOKAHEAD_OBSTACLES,
	MAX_SPEED,
	ORB_SCORE,
	PHASE_MIN_THRESHOLD,
	PHASE_RECHARGE_RATE,
	PLAYABLE_HALF_WIDTH,
	clamp,
} from './constants'
import type { GameEvent, GameSnapshot, ObstacleData, OrbData, SimulationInput } from './types'

export interface SimulationObstacle extends ObstacleData {
	partiallyShattered: boolean
	passed: boolean
	/** Boss animation — if set, obstacle x-position is animated each tick */
	bossAnimation?: {
		pattern: 'oscillate' | 'converge' | 'static'
		baseX: number
		phase: number
		speed: number
		timer: number
	}
}

export interface SimulationOrb extends OrbData {
	active: boolean
}

export interface SimulationState {
	playerX: number
	playerZ: number
	shattered: boolean
	phaseEnergy: number
	phaseLocked: boolean
	speed: number
	score: number
	alive: boolean
	obstacles: SimulationObstacle[]
	orbs: SimulationOrb[]
	nextObstacleZ: number
	nextOrbZ: number
	lastCloseCallZ: number
	nextBossZ: number
	bossCount: number
}

export interface SimulationWorld {
	readonly input: SimulationInput
	readonly random: () => number
	readonly state: SimulationState
	reset(): void
	pushEvent(event: GameEvent): void
	drainEvents(): GameEvent[]
	addScore(points: number): void
	getState(): GameSnapshot
	getObservation(): Float64Array
}

function createInitialState(): SimulationState {
	return {
		playerX: 0,
		playerZ: 0,
		shattered: false,
		phaseEnergy: 1,
		phaseLocked: false,
		speed: 0,
		score: 0,
		alive: true,
		obstacles: [],
		orbs: [],
		nextObstacleZ: 30,
		nextOrbZ: 15,
		lastCloseCallZ: -10,
		nextBossZ: 500, // matches BOSS_INTERVAL in bosswaves.ts
		bossCount: 0,
	}
}

export function createSimulationWorld(
	input: SimulationInput,
	random: () => number,
): SimulationWorld {
	let state = createInitialState()
	const events: GameEvent[] = []

	return {
		input,
		random,
		get state() {
			return state
		},
		reset() {
			state = createInitialState()
			input.reset()
			events.length = 0
		},
		pushEvent(event: GameEvent) {
			events.push(event)
		},
		drainEvents() {
			const drained = events.slice()
			events.length = 0
			return drained
		},
		addScore(points: number) {
			state.score += points
		},
		getState() {
			const cooldown =
				state.phaseLocked && state.phaseEnergy < PHASE_MIN_THRESHOLD
					? (PHASE_MIN_THRESHOLD - state.phaseEnergy) / PHASE_RECHARGE_RATE
					: 0
			return {
				playerX: state.playerX,
				shattered: state.shattered,
				shatterCooldown: cooldown,
				speed: state.speed,
				distance: state.playerZ,
				score: Math.round(state.score),
				alive: state.alive,
				obstacles: state.obstacles
					.filter((obstacle) => obstacle.active)
					.map((obstacle) => ({
						z: obstacle.z,
						x: obstacle.x,
						halfWidth: obstacle.halfWidth,
						halfHeight: obstacle.halfHeight,
						isGate: obstacle.isGate,
						gapX: obstacle.gapX,
						gapHalfWidth: obstacle.gapHalfWidth,
						active: obstacle.active,
						wallSegments: obstacle.wallSegments?.map((segment) => ({
							x: segment.x,
							halfWidth: segment.halfWidth,
						})),
					})),
				orbs: state.orbs
					.filter((orb) => orb.active)
					.map((orb) => ({
						x: orb.x,
						z: orb.z,
					})),
			}
		},
		getObservation() {
			const observation = new Float64Array(4 + LOOKAHEAD_OBSTACLES * 4)
			observation[0] = clamp(state.playerX / PLAYABLE_HALF_WIDTH, -1, 1)
			observation[1] = state.shattered ? 1 : 0
			observation[2] = clamp(state.speed / MAX_SPEED, 0, 1)
			observation[3] = clamp(
				(state.phaseLocked && state.phaseEnergy < PHASE_MIN_THRESHOLD
					? (PHASE_MIN_THRESHOLD - state.phaseEnergy) / PHASE_MIN_THRESHOLD
					: 0),
				0,
				1,
			)

			const upcoming = state.obstacles
				.filter((obstacle) => obstacle.active && obstacle.z >= state.playerZ)
				.sort((a, b) => a.z - b.z)
				.slice(0, LOOKAHEAD_OBSTACLES)

			upcoming.forEach((obstacle, index) => {
				const offset = 4 + index * 4
				observation[offset] = clamp((obstacle.z - state.playerZ) / LOOKAHEAD_DISTANCE, 0, 1)
				observation[offset + 1] = clamp(
					(obstacle.isGate ? obstacle.gapX : obstacle.x) / PLAYABLE_HALF_WIDTH,
					-1,
					1,
				)
				observation[offset + 2] = clamp(
					(obstacle.isGate ? obstacle.gapHalfWidth * 2 : obstacle.halfWidth * 2) /
						(PLAYABLE_HALF_WIDTH * 2),
					0,
					1,
				)
				observation[offset + 3] = obstacle.isGate
					? 1.0
					: obstacle.halfWidth >= PLAYABLE_HALF_WIDTH * 0.85
						? 0.5
						: 0.0
			})

			return observation
		},
	}
}

export function markOrbCollected(world: SimulationWorld): void {
	world.addScore(ORB_SCORE)
	world.pushEvent({ type: 'orb_collected' })
}

export function markCloseCall(world: SimulationWorld): void {
	world.addScore(CLOSE_CALL_SCORE)
	world.pushEvent({ type: 'close_call' })
}

