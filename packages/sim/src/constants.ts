export const PLAYABLE_HALF_WIDTH = 10
export const LANE_WIDTH = 9
export const WALL_DISTANCE = LANE_WIDTH / 2 + 1.5

export const INITIAL_SPEED = 12
export const MAX_SPEED = 45
export const PLAYER_MOVE_SPEED = 8
export const PLAYER_COLLISION_RADIUS = 0.25
export const SHATTERED_COLLISION_RADIUS = 0.1

export const PHASE_DRAIN_RATE = 0.25
export const PHASE_RECHARGE_RATE = 0.15
export const PHASE_MIN_THRESHOLD = 0.2
/** Cooldown (seconds) after phase ends before it can reactivate.
 *  v5: dropped to 0 — same-tick double-activation is impossible because
 *  input is sampled per-frame and `shatter_activated` only fires on the
 *  rising edge. The reward function teaches phasing discipline instead. */
export const PHASE_POST_COOLDOWN = 0
/** Minimum time (seconds) phase stays active once triggered.
 *  v5: dropped to 0 — the activation penalty in the RL reward function
 *  teaches "hold phase, don't rapid-toggle" without forbidding the
 *  legitimate fast-toggle case (walls 2-3 frames apart). */
export const PHASE_MIN_DURATION = 0
/** Flat energy cost deducted each time phase is activated.
 *  Makes each toggle expensive: 10 short phases = 1.0 energy spent on
 *  activation alone. Incentivizes holding phase longer per use. */
export const PHASE_ACTIVATION_COST = 0.1

export const ORB_SCORE = 100
export const CLOSE_CALL_SCORE = 50
export const COMBO_MAX = 10

export const SPAWN_DISTANCE = 80
export const DESPAWN_DISTANCE = -10
export const ORB_SPACING = 3
export const INITIAL_OBSTACLE_Z = 30
export const INITIAL_ORB_Z = 15

export const LOOKAHEAD_OBSTACLES = 5
export const LOOKAHEAD_DISTANCE = 80
export const DEFAULT_FIXED_DT = 1 / 60

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

export function mulberry32(seed: number): () => number {
	let state = seed >>> 0
	return () => {
		state += 0x6d2b79f5
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

export function getSystemRandom(): () => number {
	return () => Math.random()
}

// Player-vs-player sphere collision (Phase 3)
export const PLAYER_BUMP_RADIUS = 0.5       // sphere radius for player-player overlap test
export const MAX_BUMP_KICK = 8              // m/s cap on lateral bump velocity
export const BUMP_RESTITUTION = 0.6         // fraction of closing speed transferred as kick
export const BUMP_MIN_CONTACT_IMPULSE = 3.0 // m/s minimum lateral kick when in contact
export const BUMP_MASS_BOOST_FACTOR = 1.6   // effective mass during boost (shoves rammed player harder)
export const BUMP_RAMMER_WINDOW = 2.0       // seconds lastRammedBy stays set
export const BUMP_VEL_DECAY = 5.0           // exponential decay rate for bumpVelX (1/s)

// Boost / brake speed-mod tuning
export const BOOST_MULTIPLIER = 1.4
export const BOOST_DURATION = 1.2   // seconds active
export const BOOST_COOLDOWN = 5.0   // seconds before reuse
export const BRAKE_MULTIPLIER = 0.65
export const BRAKE_DURATION = 1.0
export const BRAKE_COOLDOWN = 3.0
export const SPEED_MOD_LERP_TIME = 0.15 // ~150ms ease in/out

export function computeSpeed(distance: number, skillFactor = 1): number {
	if (distance < 300) {
		return (12 + (distance / 300) * 8) * skillFactor
	}
	if (distance < 700) {
		return (20 + ((distance - 300) / 400) * 10) * skillFactor
	}
	if (distance < 1200) {
		return (30 + ((distance - 700) / 500) * 8) * skillFactor
	}
	if (distance < 1800) {
		return (38 + ((distance - 1200) / 600) * 5) * skillFactor
	}
	return Math.min(MAX_SPEED, 43 + ((distance - 1800) / 500) * 2) * skillFactor
}

