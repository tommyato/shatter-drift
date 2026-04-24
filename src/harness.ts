/**
 * Deterministic QA harness for Shatter Drift.
 *
 * Activated via `?_harness=1`. Wraps ShatterDriftSimulation and exposes a
 * scriptable surface for Puppeteer, devtools, and property-based tests.
 *
 * IMPORTANT: Do NOT import this from any file that the rendered Game uses
 * without gating — this module is small and the sim is already in the bundle,
 * but the window assignment must only happen in harness mode.
 */

import { DEFAULT_FIXED_DT } from './constants'
import { ShatterDriftSimulation } from './simulation'
import type { GameSnapshot } from './types'

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface InvariantResult {
	name: string
	ok: boolean
	msg?: string
}

export interface ScriptResult {
	state: GameSnapshot
	invariants: InvariantResult[]
	ticks: number
}

export interface Harness {
	reset(seed?: number): GameSnapshot
	step(n: number, action?: number | ((tick: number) => number)): GameSnapshot
	getState(): GameSnapshot
	getStateHash(): string
	invariants(): InvariantResult[]
	runScript(name: string): ScriptResult
	listScripts(): string[]
}

// ---------------------------------------------------------------------------
// FNV-1a 32-bit hash
// ---------------------------------------------------------------------------

function fnv1a32(str: string): number {
	let hash = 0x811c9dc5
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i)
		hash = (Math.imul(hash, 0x01000193) >>> 0)
	}
	return hash >>> 0
}

function roundFloat(v: number): number {
	return Math.round(v * 1_000_000) / 1_000_000
}

/** Recursively canonicalise a value: round floats, sort object keys, exclude
 *  time/timestamp/Date-named fields. Returns a plain JS value ready for
 *  JSON.stringify. */
function canonicalise(val: unknown): unknown {
	if (val === null || val === undefined) return val
	if (typeof val === 'boolean') return val
	if (typeof val === 'number') {
		if (Number.isNaN(val)) return '__NaN__'
		if (!Number.isFinite(val)) return '__Inf__'
		return roundFloat(val)
	}
	if (Array.isArray(val)) {
		return val.map(canonicalise)
	}
	if (typeof val === 'object') {
		const keys = Object.keys(val as Record<string, unknown>)
			.filter((k) => !/time|timestamp|Date/i.test(k))
			.sort()
		const out: Record<string, unknown> = {}
		for (const k of keys) {
			out[k] = canonicalise((val as Record<string, unknown>)[k])
		}
		return out
	}
	return val
}

// ---------------------------------------------------------------------------
// NaN detection
// ---------------------------------------------------------------------------

function hasNaN(val: unknown): boolean {
	if (typeof val === 'number') return Number.isNaN(val)
	if (Array.isArray(val)) return val.some(hasNaN)
	if (val !== null && typeof val === 'object') {
		return Object.values(val as Record<string, unknown>).some(hasNaN)
	}
	return false
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHarness(): Harness {
	let currentSeed: number | undefined = undefined
	let sim = new ShatterDriftSimulation({ seed: currentSeed, fixedDt: DEFAULT_FIXED_DT })

	// Invariant tracking state — reset alongside the sim
	let lastScore = 0
	let aliveSeen = true
	let aliveWentFalse = false

	function resetSim(seed?: number): GameSnapshot {
		currentSeed = seed
		// Re-instantiate to reset the RNG from the same seed for determinism.
		sim = new ShatterDriftSimulation({ seed, fixedDt: DEFAULT_FIXED_DT })
		const { state } = sim.reset()
		lastScore = state.score
		aliveSeen = true
		aliveWentFalse = false
		return state
	}

	function currentState(): GameSnapshot {
		return sim.getState()
	}

	function computeHash(): string {
		const state = currentState()
		const canonical = canonicalise(state)
		const json = JSON.stringify(canonical)
		const h = fnv1a32(json)
		return '0x' + h.toString(16).padStart(8, '0')
	}

	function runInvariants(): InvariantResult[] {
		const state = currentState()
		const results: InvariantResult[] = []

		// 1. no-nan-in-state
		const nanFound = hasNaN(state)
		results.push({
			name: 'no-nan-in-state',
			ok: !nanFound,
			msg: nanFound ? 'NaN detected in state object' : undefined,
		})

		// 2. score-monotonic (checks current score against last recorded)
		const scoreOk = state.score >= lastScore
		results.push({
			name: 'score-monotonic',
			ok: scoreOk,
			msg: scoreOk ? undefined : `score decreased: ${lastScore} → ${state.score}`,
		})

		// 3. alive-is-one-way
		if (!state.alive) {
			aliveWentFalse = true
		}
		const aliveOk = !(aliveWentFalse && state.alive)
		results.push({
			name: 'alive-is-one-way',
			ok: aliveOk,
			msg: aliveOk ? undefined : 'alive flipped from false back to true without reset()',
		})

		// 4. distance-non-negative
		const distOk = state.distance >= 0
		results.push({
			name: 'distance-non-negative',
			ok: distOk,
			msg: distOk ? undefined : `distance is negative: ${state.distance}`,
		})

		// Update tracked values after reporting
		lastScore = state.score
		aliveSeen = state.alive

		return results
	}

	function doStep(n: number, action?: number | ((tick: number) => number)): GameSnapshot {
		const actionFn: (tick: number) => number =
			typeof action === 'function' ? action : () => (typeof action === 'number' ? action : 0)

		for (let tick = 0; tick < n; tick++) {
			const a = actionFn(tick)
			sim.step(a)
			// Track invariant state across ticks (score + alive)
			const state = currentState()
			if (!state.alive) aliveWentFalse = true
			// We DON'T update lastScore here — invariants() does it when called.
			// But we need to keep lastScore updated for monotonic check.
			// Score can only increase so update continuously:
			if (state.score > lastScore) lastScore = state.score
		}
		return currentState()
	}

	// ---------------------------------------------------------------------------
	// Canned scripts
	// ---------------------------------------------------------------------------

	const SCRIPTS: Record<string, () => ScriptResult> = {
		'idle-60s'(): ScriptResult {
			resetSim(42)
			const TICKS = Math.round(60 / DEFAULT_FIXED_DT) // 3600
			const state = doStep(TICKS, 0)
			return { state, invariants: runInvariants(), ticks: TICKS }
		},

		'survive-30s'(): ScriptResult {
			resetSim(42)
			const TICKS = Math.round(30 / DEFAULT_FIXED_DT) // 1800
			// Simple heuristic: alternate left (1) and right (2) every 0.5s
			const switchEvery = Math.round(0.5 / DEFAULT_FIXED_DT) // 30 ticks
			const actionFn = (tick: number): number => {
				const phase = Math.floor(tick / switchEvery) % 2
				return phase === 0 ? 1 : 2
			}
			const state = doStep(TICKS, actionFn)
			return { state, invariants: runInvariants(), ticks: TICKS }
		},

		'determinism'(): ScriptResult {
			const TICKS = Math.round(30 / DEFAULT_FIXED_DT) // 1800
			// Build a fixed action sequence to replay identically
			const switchEvery = Math.round(0.5 / DEFAULT_FIXED_DT)
			const actions = Array.from({ length: TICKS }, (_, tick) =>
				Math.floor(tick / switchEvery) % 2 === 0 ? 1 : 2,
			)
			const actionFn = (tick: number): number => actions[tick]

			// Run A
			resetSim(42)
			doStep(TICKS, actionFn)
			const hashA = computeHash()
			const stateA = currentState()

			// Run B — identical seed + actions
			resetSim(42)
			doStep(TICKS, actionFn)
			const hashB = computeHash()

			const deterministicOk = hashA === hashB
			const invResults: InvariantResult[] = [
				...runInvariants(),
				{
					name: 'determinism-check',
					ok: deterministicOk,
					msg: deterministicOk
						? `hash ${hashA} matches`
						: `hash mismatch: A=${hashA} B=${hashB} — sim is non-deterministic`,
				},
			]
			return { state: stateA, invariants: invResults, ticks: TICKS }
		},
	}

	return {
		reset(seed?: number): GameSnapshot {
			return resetSim(seed)
		},

		step(n: number, action?: number | ((tick: number) => number)): GameSnapshot {
			return doStep(n, action)
		},

		getState(): GameSnapshot {
			return currentState()
		},

		getStateHash(): string {
			return computeHash()
		},

		invariants(): InvariantResult[] {
			return runInvariants()
		},

		runScript(name: string): ScriptResult {
			const script = SCRIPTS[name]
			if (!script) throw new Error(`Unknown harness script: "${name}". Available: ${Object.keys(SCRIPTS).join(', ')}`)
			return script()
		},

		listScripts(): string[] {
			return Object.keys(SCRIPTS)
		},
	}
}
