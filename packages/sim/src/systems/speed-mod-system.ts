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
 * Per-player boost/brake. Iterates `players[]` so each peer's keypresses
 * shape only their own ship. Order: runs BEFORE worldScrollSystem so the
 * multiplier is current on the same tick. Cooldowns live on PlayerState
 * for ghost-replay and multiplayer determinism.
 *
 * Rules (per player):
 *   - Boost: 1.4× for 1.2 s, then 5 s cooldown.
 *   - Brake: 0.65× for 1.0 s, then 3 s cooldown.
 *   - Both active: brake wins.
 *   - Activating one cancels the other (timer reset, no partial cooldown).
 *   - speedMod lerps toward target over ~150 ms in/out.
 */
export function createSpeedModSystem(world: SimulationWorld) {
	return (dt: number) => {
		for (const player of world.state.players) {
			const input = world.inputs[player.playerIndex]?.getState()
			if (!input) continue

			// --- Tick active timers ---
			if (player.boostTimer > 0) {
				player.boostTimer = Math.max(0, player.boostTimer - dt)
				if (player.boostTimer === 0) player.boostCooldown = BOOST_COOLDOWN
			}
			if (player.brakeTimer > 0) {
				player.brakeTimer = Math.max(0, player.brakeTimer - dt)
				if (player.brakeTimer === 0) player.brakeCooldown = BRAKE_COOLDOWN
			}

			// --- Tick cooldowns ---
			if (player.boostCooldown > 0) player.boostCooldown = Math.max(0, player.boostCooldown - dt)
			if (player.brakeCooldown > 0) player.brakeCooldown = Math.max(0, player.brakeCooldown - dt)

			// --- Activate (edge-like: only when not already active and ready) ---
			// Brake wins if both inputs pressed simultaneously.
			if (input.brake && player.brakeTimer === 0 && player.brakeCooldown === 0) {
				player.brakeTimer = BRAKE_DURATION
				player.boostTimer = 0 // cancel any active boost (no cooldown for canceled action)
			} else if (input.boost && player.boostTimer === 0 && player.boostCooldown === 0) {
				player.boostTimer = BOOST_DURATION
				player.brakeTimer = 0 // cancel any active brake
			}

			// --- Target multiplier ---
			let target = 1
			if (player.brakeTimer > 0) target = BRAKE_MULTIPLIER
			else if (player.boostTimer > 0) target = BOOST_MULTIPLIER

			// --- Lerp speedMod toward target (~150 ms) ---
			const lerpFactor = 1 - Math.exp(-dt / SPEED_MOD_LERP_TIME)
			player.speedMod += (target - player.speedMod) * lerpFactor
		}
	}
}
