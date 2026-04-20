import { DEFAULT_FIXED_DT } from './constants'
import { createRuntime } from './runtime'
import type { GameEvent, GameSnapshot, SimulationConfig } from './types'

export class ShatterDriftSimulation {
	private readonly config: { fixedDt: number | null }
	private readonly runtime

	constructor(config: SimulationConfig = {}) {
		this.config = {
			fixedDt:
				Number.isFinite(config.fixedDt) && config.fixedDt !== undefined
					? Number(config.fixedDt)
					: null,
		}
		this.runtime = createRuntime(config)
	}

	reset(): { state: GameSnapshot; events: GameEvent[] } {
		this.runtime.reset()
		return {
			state: this.runtime.getState(),
			events: [],
		}
	}

	step(action: number, dt?: number): { state: GameSnapshot; events: GameEvent[] } {
		const stepDt =
			this.config.fixedDt ?? (Number.isFinite(dt) ? Number(dt) : DEFAULT_FIXED_DT)
		if (!this.runtime.getState().alive || stepDt <= 0) {
			return {
				state: this.runtime.getState(),
				events: [],
			}
		}
		this.runtime.setAction(action)
		this.runtime.update(stepDt)
		return {
			state: this.runtime.getState(),
			events: this.runtime.drainEvents(),
		}
	}

	getObservation(): Float64Array {
		return this.runtime.getObservation()
	}

	getState(): GameSnapshot {
		return this.runtime.getState()
	}
}

