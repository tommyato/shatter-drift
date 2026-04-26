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

/**
 * Per-player state inside the deterministic sim. Phase 2 of multiplayer
 * extracted these fields off `SimulationState` so the sim can carry N
 * players whose inputs are advanced in lockstep across peers.
 *
 * Fields (verbatim from `plans/multiplayer-survival/phase-2-shared-sim.md`):
 *   playerIndex, name, color, x, z, speed, alive, shattered,
 *   phaseEnergy, phaseLocked, phaseCooldown, phaseMinTimer,
 *   boostCooldown, brakeCooldown, boostTimer, brakeTimer
 *
 * Additions (needed for per-player correctness; documented as Phase-2
 * deviations in the PR):
 *   speedMod        — `SpeedModSystem` lerps this per player
 *   score           — `WorldScrollSystem` adds per-player distance score
 *   lastCloseCallZ  — `ShatterSystem`'s close-call debouncer is per player
 */
export interface PlayerState {
	playerIndex: number
	name: string
	color: number

	x: number
	z: number

	speed: number
	speedMod: number
	boostTimer: number
	boostCooldown: number
	brakeTimer: number
	brakeCooldown: number

	alive: boolean
	shattered: boolean
	phaseEnergy: number
	phaseLocked: boolean
	phaseCooldown: number
	phaseMinTimer: number

	score: number
	lastCloseCallZ: number
}

export interface SimulationConfig {
	seed?: number
	fixedDt?: number
	/** Number of players in the sim. Default 1 (singleplayer). */
	playerCount?: number
	/** Index of the local player (used by `getState()` to choose whose view to expose). Default 0. */
	localPlayerIndex?: number
	/** Optional per-player display names (length should match playerCount). */
	playerNames?: string[]
	/** Optional per-player display colors as packed 0xRRGGBB ints. */
	playerColors?: number[]
}

// ---------------------------------------------------------------------------
// Multiplayer (Phase 2) — match-start handshake
// ---------------------------------------------------------------------------

/** Per-player slot agreed at match start. */
export interface MatchPlayerInfo {
	peerId: string
	name: string
	color: number
	playerIndex: number
}

/** Config produced by the match-start handshake; consumed by the lockstep runner. */
export interface MultiplayerConfig {
	seed: number
	startTick: number
	localPlayerIndex: number
	players: MatchPlayerInfo[]
}

/** Wire-format messages exchanged over `MeshTransport` during the match-start handshake. */
export type MatchStartMessage =
	| {
			type: 'match_propose'
			seed: number
			startTick: number
			players: MatchPlayerInfo[]
			proposerPeerId: string
	  }
	| { type: 'match_ack'; proposerPeerId: string; ackerPeerId: string }
