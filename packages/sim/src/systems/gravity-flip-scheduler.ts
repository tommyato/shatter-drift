/**
 * Cosmic Rift gravity-flip scheduler — a pure state machine that decides when
 * to warn, start, and end a gravity-flip zone. All wall-clock driven via dt so
 * it works in headless sim and live game alike.
 *
 * Phases:
 *   idle     → next flip target selected; waiting for distance to cross (target - warning)
 *   warning  → 1.5s warning window; HUD glyph + pulse
 *   active   → 3.0s flipped gameplay/visuals
 *   (back to idle after cooldown pick)
 *
 * Never fires outside biome 4 (Cosmic Rift, ≥1800m). Never fires during phase
 * (suppressed by caller via `canTrigger` arg — the scheduler still advances,
 * but a new window won't start unless canTrigger is true).
 */

export type RiftFlipPhase = 'idle' | 'warning' | 'active'

export interface RiftFlipState {
	phase: RiftFlipPhase
	/** Wall-clock timer for the current phase (decreases to 0). */
	timer: number
	/** Distance (m) at which the next flip is scheduled to START. */
	nextFlipDistance: number
}

export interface RiftFlipEvent {
	type: 'rift_flip_warning' | 'rift_flip_start' | 'rift_flip_end'
}

export const RIFT_FLIP_WARNING_DURATION = 1.5
export const RIFT_FLIP_ACTIVE_DURATION = 3.0
export const RIFT_FLIP_INTERVAL = 150 // meters
export const RIFT_FLIP_JITTER = 30 // meters ± on interval
export const COSMIC_RIFT_START_DISTANCE = 1800

export function createRiftFlipState(): RiftFlipState {
	return {
		phase: 'idle',
		timer: 0,
		nextFlipDistance: COSMIC_RIFT_START_DISTANCE + 100, // first flip ~100m into biome
	}
}

/**
 * Advance the scheduler one frame. Caller provides:
 *   - dt: seconds since last update
 *   - distance: current player distance (m)
 *   - biomeIndex: 0–4
 *   - canTrigger: false when player is mid-phase (suppresses warning → active transition)
 *   - rng: pure random for jitter picks
 *
 * Returns any events fired this frame.
 */
export function updateRiftFlip(
	state: RiftFlipState,
	dt: number,
	distance: number,
	biomeIndex: number,
	canTrigger: boolean,
	rng: () => number,
): RiftFlipEvent[] {
	const events: RiftFlipEvent[] = []

	// Only schedule/fire inside Cosmic Rift.
	if (biomeIndex !== 4 || distance < COSMIC_RIFT_START_DISTANCE) {
		// Outside biome — force-reset to idle so we don't carry over a stale timer.
		if (state.phase !== 'idle') {
			if (state.phase === 'active') events.push({ type: 'rift_flip_end' })
			state.phase = 'idle'
			state.timer = 0
		}
		state.nextFlipDistance = Math.max(state.nextFlipDistance, COSMIC_RIFT_START_DISTANCE + 100)
		return events
	}

	state.timer = Math.max(0, state.timer - dt)

	if (state.phase === 'idle') {
		const warningTriggerDistance = state.nextFlipDistance - 20 // warn ~20m before flip start (~1.5s at cruise speed 13m/s)
		if (distance >= warningTriggerDistance && canTrigger) {
			state.phase = 'warning'
			state.timer = RIFT_FLIP_WARNING_DURATION
			events.push({ type: 'rift_flip_warning' })
		}
	} else if (state.phase === 'warning') {
		if (state.timer <= 0) {
			state.phase = 'active'
			state.timer = RIFT_FLIP_ACTIVE_DURATION
			events.push({ type: 'rift_flip_start' })
		}
	} else if (state.phase === 'active') {
		if (state.timer <= 0) {
			state.phase = 'idle'
			// Schedule next flip with jitter.
			const jitter = (rng() - 0.5) * 2 * RIFT_FLIP_JITTER
			state.nextFlipDistance = distance + RIFT_FLIP_INTERVAL + jitter
			events.push({ type: 'rift_flip_end' })
		}
	}

	return events
}
