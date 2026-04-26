import {
	BOOST_COOLDOWN,
	BOOST_DURATION,
	BOOST_MULTIPLIER,
	BRAKE_COOLDOWN,
	BRAKE_DURATION,
	BRAKE_MULTIPLIER,
	SPEED_MOD_LERP_TIME,
} from '../constants'
import type { SimulationWorld } from '../sim-world'

/**
 * Speed-mod system — manages boost and brake cooldowns, timers, and the
 * smoothed `state.speedMod` multiplier read by WorldScrollSystem.
 *
 * Order: runs BEFORE worldScrollSystem so the multiplier is current on the
 * same tick.  Cooldowns live in SimulationState for ghost-replay and
 * multiplayer determinism.
 *
 * Rules:
 *   - Boost: 1.4× for 1.2 s, then 5 s cooldown.
 *   - Brake: 0.65× for 1.0 s, then 3 s cooldown.
 *   - Both active: brake wins.
 *   - Activating one cancels the other (timer reset, no partial cooldown).
 *   - speedMod lerps toward target over ~150 ms in/out.
 */
export function createSpeedModSystem(world: SimulationWorld) {
	return (dt: number) => {
		const input = world.input.getState()
		const s = world.state

		// --- Tick active timers ---
		if (s.boostTimer > 0) {
			s.boostTimer = Math.max(0, s.boostTimer - dt)
			if (s.boostTimer === 0) s.boostCooldown = BOOST_COOLDOWN
		}
		if (s.brakeTimer > 0) {
			s.brakeTimer = Math.max(0, s.brakeTimer - dt)
			if (s.brakeTimer === 0) s.brakeCooldown = BRAKE_COOLDOWN
		}

		// --- Tick cooldowns ---
		if (s.boostCooldown > 0) s.boostCooldown = Math.max(0, s.boostCooldown - dt)
		if (s.brakeCooldown > 0) s.brakeCooldown = Math.max(0, s.brakeCooldown - dt)

		// --- Activate (edge-like: only when not already active and ready) ---
		// Brake wins if both inputs pressed simultaneously.
		if (input.brake && s.brakeTimer === 0 && s.brakeCooldown === 0) {
			s.brakeTimer = BRAKE_DURATION
			s.boostTimer = 0 // cancel any active boost (no cooldown for canceled action)
		} else if (input.boost && s.boostTimer === 0 && s.boostCooldown === 0) {
			s.boostTimer = BOOST_DURATION
			s.brakeTimer = 0 // cancel any active brake
		}

		// --- Target multiplier ---
		let target = 1
		if (s.brakeTimer > 0) target = BRAKE_MULTIPLIER
		else if (s.boostTimer > 0) target = BOOST_MULTIPLIER

		// --- Lerp speedMod toward target (~150 ms) ---
		const lerpFactor = 1 - Math.exp(-dt / SPEED_MOD_LERP_TIME)
		s.speedMod += (target - s.speedMod) * lerpFactor
	}
}
