import type { SimulationInput, SimulationInputState } from '../types'

const ACTION_TO_STATE: Record<number, SimulationInputState> = {
	0: { horizontal: 0, shatter: false },
	1: { horizontal: -1, shatter: false },
	2: { horizontal: 1, shatter: false },
	3: { horizontal: 0, shatter: true },
	4: { horizontal: -1, shatter: true },
	5: { horizontal: 1, shatter: true },
}

export function createAgentInput(): SimulationInput {
	let currentAction = 0

	return {
		getState() {
			return ACTION_TO_STATE[currentAction] ?? ACTION_TO_STATE[0]
		},
		setAction(action: number) {
			currentAction = Number.isFinite(action) ? Math.trunc(action) : 0
		},
		reset() {
			currentAction = 0
		},
	}
}

