import {
	CLOSE_CALL_SCORE,
	LOOKAHEAD_DISTANCE,
	LOOKAHEAD_OBSTACLES,
	MAX_SPEED,
	ORB_SCORE,
	PHASE_MIN_THRESHOLD,
	PHASE_POST_COOLDOWN,
	PHASE_RECHARGE_RATE,
	PLAYABLE_HALF_WIDTH,
	clamp,
} from './constants'
import type {
	GameEvent,
	GameSnapshot,
	ObstacleData,
	OrbData,
	PlayerState,
	AuthoritativeStateSnapshot,
	SimulationConfig,
	SimulationInput,
} from './types'

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
	// Biome gimmick state (managed by BiomeGimmickSystem)
	/** Crystal Caves: seconds remaining while frozen (>0 = frozen) */
	frozenTimer?: number
	/** Crystal Caves: post-thaw cooldown before re-freeze is eligible */
	freezeCooldown?: number
	/** Neon District: per-obstacle blink phase offset (seeded from spawn z) */
	blinkOffset?: number
	/** Neon District: true during the non-colliding blink window */
	ghosted?: boolean
	/** Solar Storm: per-obstacle sine phase in radians (seeded from spawn z) */
	driftPhase?: number
	/** Solar Storm/Freeze: original x (or gapX for gates) before drift is applied */
	baseX?: number
	/** Solar Storm: original x positions of gate wall segments before drift */
	baseWallSegmentX?: number[]
}

export interface SimulationOrb extends OrbData {
	active: boolean
}

/**
 * Sim state. Phase 2 of multiplayer split per-player fields off into
 * `players[i]: PlayerState`. Obstacles, orbs, and the spawner cursors stay
 * shared — every peer sees the same world.
 */
export interface SimulationState {
	players: PlayerState[]
	obstacles: SimulationObstacle[]
	orbs: SimulationOrb[]
	nextObstacleZ: number
	nextOrbZ: number
	nextBossZ: number
	bossCount: number
	/** Last pattern emitted by the obstacle spawn system — never repeats back-to-back. */
	lastPatternName: string | null
	/** Cumulative simulation time in seconds — used by PlayerCollisionSystem for rammer-credit expiry. */
	simTime: number
	/** Cosmic Rift gravity-flip scheduler state. */
	riftFlip: {
		phase: 'idle' | 'warning' | 'active'
		timer: number
		nextFlipDistance: number
	}
}

export interface SimulationWorld {
	/** Per-player input — index aligns with `state.players[i].playerIndex`. */
	readonly inputs: readonly SimulationInput[]
	/** Local player's input — back-compat alias for `inputs[localPlayerIndex]`. */
	readonly input: SimulationInput
	readonly random: () => number
	readonly state: SimulationState
	readonly localPlayerIndex: number
	reset(): void
	pushEvent(event: GameEvent): void
	drainEvents(): GameEvent[]
	/** Add score to a specific player (defaults to local player for back-compat). */
	addScore(points: number, playerIndex?: number): void
	getState(): GameSnapshot
	getAuthoritativeState(): AuthoritativeStateSnapshot
	getObservation(): Float64Array
	/**
	 * Anchor z used by world-scroll-driven systems (spawn, despawn, rift-flip).
	 * Returns the fastest live player's z, or 0 if no live players.
	 */
	anchorZ(): number
	/** Slowest live player's z — used by despawn so we don't cull obstacles a trailing player still needs. */
	trailingZ(): number
}

const DEFAULT_PLAYER_COLORS = [0x4be1ff, 0xff5fa2, 0xffd24b, 0x7bff5f] as const

function createInitialPlayer(
	index: number,
	name: string,
	color: number,
): PlayerState {
	return {
		playerIndex: index,
		name,
		color,
		x: 0,
		z: 0,
		speed: 0,
		speedMod: 1,
		boostTimer: 0,
		boostCooldown: 0,
		brakeTimer: 0,
		brakeCooldown: 0,
		alive: true,
		shattered: false,
		phaseEnergy: 1,
		phaseLocked: false,
		phaseCooldown: 0,
		phaseMinTimer: 0,
		score: 0,
		lastCloseCallZ: -10,
		bumpVelX: 0,
		lastRammedBy: null,
		lastRammedAt: 0,
	}
}

function createInitialState(
	playerCount: number,
	playerNames: string[],
	playerColors: number[],
): SimulationState {
	const players: PlayerState[] = []
	for (let i = 0; i < playerCount; i++) {
		players.push(
			createInitialPlayer(
				i,
				playerNames[i] ?? `P${i + 1}`,
				playerColors[i] ?? DEFAULT_PLAYER_COLORS[i % DEFAULT_PLAYER_COLORS.length],
			),
		)
	}
	return {
		players,
		obstacles: [],
		orbs: [],
		nextObstacleZ: 30,
		nextOrbZ: 15,
		nextBossZ: 500, // matches BOSS_INTERVAL in bosswaves.ts
		bossCount: 0,
		lastPatternName: null,
		simTime: 0,
		riftFlip: {
			phase: 'idle',
			timer: 0,
			nextFlipDistance: 1900, // first flip ~100m into Cosmic Rift (1800m start)
		},
	}
}

export function createSimulationWorld(
	inputs: SimulationInput | readonly SimulationInput[],
	random: () => number,
	config: SimulationConfig = {},
): SimulationWorld {
	const inputArray: readonly SimulationInput[] = Array.isArray(inputs)
		? (inputs as readonly SimulationInput[])
		: [inputs as SimulationInput]
	const playerCount = Math.max(1, config.playerCount ?? inputArray.length)
	const localPlayerIndex = clamp(config.localPlayerIndex ?? 0, 0, playerCount - 1)
	const playerNames = config.playerNames ?? []
	const playerColors = config.playerColors ?? []

	if (inputArray.length < playerCount) {
		throw new Error(
			`createSimulationWorld: playerCount=${playerCount} but only ${inputArray.length} input(s) provided`,
		)
	}

	let state = createInitialState(playerCount, playerNames, playerColors)
	const events: GameEvent[] = []

	function anchorZ(): number {
		let max = -Infinity
		for (const p of state.players) {
			if (!p.alive) continue
			if (p.z > max) max = p.z
		}
		return max === -Infinity ? 0 : max
	}

	function trailingZ(): number {
		let min = Infinity
		for (const p of state.players) {
			if (!p.alive) continue
			if (p.z < min) min = p.z
		}
		return min === Infinity ? 0 : min
	}

	return {
		inputs: inputArray,
		get input() {
			return inputArray[localPlayerIndex]
		},
		random,
		localPlayerIndex,
		get state() {
			return state
		},
		anchorZ,
		trailingZ,
		reset() {
			state = createInitialState(playerCount, playerNames, playerColors)
			for (const input of inputArray) input.reset()
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
		addScore(points: number, playerIndex?: number) {
			const idx = playerIndex ?? localPlayerIndex
			const player = state.players[idx]
			if (player) player.score += points
		},
		getState() {
			const local = state.players[localPlayerIndex]!
			const cooldown =
				local.phaseLocked && local.phaseEnergy < PHASE_MIN_THRESHOLD
					? (PHASE_MIN_THRESHOLD - local.phaseEnergy) / PHASE_RECHARGE_RATE
					: 0
			return {
				playerX: local.x,
				shattered: local.shattered,
				shatterCooldown: cooldown,
				speed: local.speed,
				speedMod: local.speedMod,
				boostCooldown: local.boostCooldown,
				brakeCooldown: local.brakeCooldown,
				distance: local.z,
				score: Math.round(local.score),
				alive: local.alive,
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
		getAuthoritativeState() {
			return {
				players: state.players.map((player) => ({ ...player })),
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
			const local = state.players[localPlayerIndex]!
			const observation = new Float64Array(4 + LOOKAHEAD_OBSTACLES * 4)
			observation[0] = clamp(local.x / PLAYABLE_HALF_WIDTH, -1, 1)
			observation[1] = local.shattered ? 1 : 0
			observation[2] = clamp(local.speed / MAX_SPEED, 0, 1)
			const energyLock =
				local.phaseLocked && local.phaseEnergy < PHASE_MIN_THRESHOLD
					? (PHASE_MIN_THRESHOLD - local.phaseEnergy) / PHASE_MIN_THRESHOLD
					: 0
			const cooldownLock = local.phaseCooldown > 0 ? local.phaseCooldown / PHASE_POST_COOLDOWN : 0
			observation[3] = clamp(Math.max(energyLock, cooldownLock), 0, 1)

			const upcoming = state.obstacles
				.filter((obstacle) => obstacle.active && obstacle.z >= local.z)
				.sort((a, b) => a.z - b.z)
				.slice(0, LOOKAHEAD_OBSTACLES)

			upcoming.forEach((obstacle, index) => {
				const offset = 4 + index * 4
				observation[offset] = clamp((obstacle.z - local.z) / LOOKAHEAD_DISTANCE, 0, 1)
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

export function markOrbCollected(world: SimulationWorld, playerIndex?: number): void {
	world.addScore(ORB_SCORE, playerIndex)
	world.pushEvent({ type: 'orb_collected' })
}

export function markCloseCall(world: SimulationWorld, playerIndex?: number): void {
	world.addScore(CLOSE_CALL_SCORE, playerIndex)
	world.pushEvent({ type: 'close_call' })
}
