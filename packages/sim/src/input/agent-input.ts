import type { SimulationInput, SimulationInputState } from '../types'

/**
 * Legacy action enum (0-5) — preserved exactly so RL policy and ghost replay
 * remain valid without retraining.
 *
 * 0: idle   1: left   2: right
 * 3: shatter   4: left+shatter   5: right+shatter
 *
 * Extended bit-flag encoding for actions ≥ 6:
 *   bit 0 (0x01): left  (-1 horizontal)
 *   bit 1 (0x02): right (+1 horizontal)
 *   bit 2 (0x04): shatter
 *   bit 3 (0x08): boost
 *   bit 4 (0x10): brake
 *
 * If both left+right bits are set, horizontal resolves to 0.
 * If both boost+brake are set, brake wins (defensive default).
 */

const LEGACY: Record<number, SimulationInputState> = {
	0: { horizontal: 0, shatter: false, boost: false, brake: false },
	1: { horizontal: -1, shatter: false, boost: false, brake: false },
	2: { horizontal: 1, shatter: false, boost: false, brake: false },
	3: { horizontal: 0, shatter: true, boost: false, brake: false },
	4: { horizontal: -1, shatter: true, boost: false, brake: false },
	5: { horizontal: 1, shatter: true, boost: false, brake: false },
}

function decodeAction(action: number): SimulationInputState {
	if (action >= 0 && action <= 5) {
		return LEGACY[action]
	}
	const left = !!(action & 0x01)
	const right = !!(action & 0x02)
	const boost = !!(action & 0x08)
	const brake = !!(action & 0x10)
	return {
		horizontal: left === right ? 0 : left ? -1 : 1,
		shatter: !!(action & 0x04),
		// brake wins if both pressed (defensive default)
		boost: boost && !brake,
		brake,
	}
}

export function createAgentInput(): SimulationInput {
	let currentAction = 0

	return {
		getState() {
			return decodeAction(currentAction)
		},
		setAction(action: number) {
			currentAction = Number.isFinite(action) ? Math.trunc(action) : 0
		},
		reset() {
			currentAction = 0
		},
	}
}
