import { DEFAULT_FIXED_DT } from './constants'
import { createRuntime } from './runtime'
import type {
	AuthoritativeStateSnapshot,
	GameEvent,
	GameSnapshot,
	SimulationConfig,
} from './types'

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

	/**
	 * Singleplayer-style step: applies `action` to the local player and advances one tick.
	 * For multiplayer, use `setAction(playerIndex, action)` for each peer's frame, then `tick()`.
	 */
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

	/** Set a player's input. Default targets the local player. */
	setAction(action: number, playerIndex?: number): void {
		this.runtime.setAction(action, playerIndex)
	}

	/** Advance one tick using whatever inputs were last set per player. Used by the lockstep runner. */
	tick(dt?: number): { state: GameSnapshot; events: GameEvent[] } {
		const stepDt =
			this.config.fixedDt ?? (Number.isFinite(dt) ? Number(dt) : DEFAULT_FIXED_DT)
		if (stepDt <= 0) {
			return { state: this.runtime.getState(), events: [] }
		}
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

	getAuthoritativeState(): AuthoritativeStateSnapshot {
		return this.runtime.getAuthoritativeState()
	}
}
