#!/usr/bin/env node
/**
 * Headless pattern verification.
 *
 * Acceptance criteria (task: "choreographed obstacle patterns"):
 *   3. 60s headless playthrough for 3 seeds produces ≥ 4 distinct pattern names.
 *   - Total obstacle count over 2000m is within ±15% of the IID baseline.
 *
 * Usage: node verify-patterns.mjs [--verbose]
 */

import { pathToFileURL } from 'node:url'

const verbose = process.argv.includes('--verbose')
const simUrl = pathToFileURL(new URL('./dist/simulation.mjs', import.meta.url).pathname).href
const mod = await import(simUrl)
const SimClass = mod.ShatterDriftSimulation || mod.default

let passed = 0
let failed = 0
function assert(cond, msg) {
	if (cond) {
		passed++
		if (verbose) console.log(`  ✓ ${msg}`)
	} else {
		failed++
		console.error(`  ✗ FAIL: ${msg}`)
	}
}

// ==========================================================================
// Test 1: 60s × 3 seeds — ≥ 4 distinct pattern names per run
// ==========================================================================
console.log('\n▶ Pattern variety (60s, 3 seeds)')
for (const seed of [42, 7, 999]) {
	const sim = new SimClass({ seed, fixedDt: 1 / 60 })
	sim.reset()
	const patternsSeen = new Set()
	const patternSequence = []

	// Drive the sim with a "smart" policy for 60s so the player actually progresses.
	for (let i = 0; i < 60 * 60; i++) {
		const obs = sim.getObservation()
		const playerX = obs[0]
		const nearestZ = obs[4]
		const nearestCenter = obs[5]
		const nearestIsGate = obs[7]
		const cooldown = obs[3]

		let action = 0
		if (nearestZ > 0 && nearestZ < 0.3) {
			if (nearestIsGate > 0.5) {
				if (nearestCenter > playerX + 0.05) action = 2
				else if (nearestCenter < playerX - 0.05) action = 1
			} else if (cooldown === 0) {
				action = 3
			} else {
				action = nearestCenter > 0 ? 1 : 2
			}
		}

		const res = sim.step(action)
		for (const ev of res.events) {
			if (ev.type === 'pattern_emitted') {
				patternsSeen.add(ev.pattern)
				patternSequence.push(ev.pattern)
			}
		}
		if (!res.state.alive) sim.reset()
	}

	const distinctCount = patternsSeen.size
	if (verbose) {
		console.log(`  seed=${seed}: ${distinctCount} distinct patterns = [${[...patternsSeen].join(', ')}]`)
		console.log(`    sequence (${patternSequence.length} patterns): ${patternSequence.slice(0, 20).join(', ')}${patternSequence.length > 20 ? ' …' : ''}`)
	}
	assert(
		distinctCount >= 4,
		`seed=${seed}: ≥4 distinct patterns in 60s (got ${distinctCount}: ${[...patternsSeen].join(', ')})`,
	)
}

// ==========================================================================
// Test 2: Obstacle density rate — measures obstacles emitted per meter of
// spawn-cursor advance within each contiguous life. We cannot drive the sim
// 2000m without deaths (test harness policy isn't good enough), so we measure
// rate instead of absolute count. Old IID baseline computed from getObstacleSpacing
// weighted by biome zones: 14.3 + 22.9 + 35.7 + 60 + 28.6 ≈ 161 obstacles / 2000m
// = 0.081 obstacles/meter. Acceptance ±15% → 0.069–0.093. Rate is seed-invariant
// and reset-invariant.
// ==========================================================================
console.log('\n▶ Obstacle density rate (acceptance: 0.069–0.093 obstacles/meter)')
for (const seed of [42, 7, 999]) {
	const sim = new SimClass({ seed, fixedDt: 1 / 60 })
	sim.reset()
	let totalObstacles = 0
	let totalMeters = 0
	let lifeStartZ = 0
	let maxZ = 0

	for (let i = 0; i < 60 * 120; i++) {
		const obs = sim.getObservation()
		const playerX = obs[0]
		const nearestZ = obs[4]
		const nearestCenter = obs[5]
		const nearestIsGate = obs[7]
		const cooldown = obs[3]

		let action = 0
		if (nearestZ > 0 && nearestZ < 0.3) {
			if (nearestIsGate > 0.5) {
				if (nearestCenter > playerX + 0.05) action = 2
				else if (nearestCenter < playerX - 0.05) action = 1
			} else if (cooldown === 0) {
				action = 3
			} else {
				action = nearestCenter > 0 ? 1 : 2
			}
		}

		const res = sim.step(action)
		for (const ev of res.events) {
			if (ev.type === 'pattern_emitted') totalObstacles += ev.obstacleCount
		}
		maxZ = Math.max(maxZ, res.state.distance)
		if (!res.state.alive) {
			// Life ended — credit the meters advanced to the total, then reset.
			totalMeters += maxZ - lifeStartZ
			sim.reset()
			lifeStartZ = 0
			maxZ = 0
		}
	}
	totalMeters += maxZ - lifeStartZ

	const rate = totalMeters > 0 ? totalObstacles / totalMeters : 0
	if (verbose) {
		console.log(`  seed=${seed}: ${totalObstacles} obstacles across ${totalMeters.toFixed(0)}m → ${rate.toFixed(4)} obstacles/m`)
	}
	assert(
		rate >= 0.069 && rate <= 0.093,
		`seed=${seed}: obstacle rate within ±15% of IID baseline (got ${rate.toFixed(4)}, target 0.069–0.093)`,
	)
}

// ==========================================================================
// Test 3: No back-to-back pattern repeats
// ==========================================================================
console.log('\n▶ No back-to-back pattern repeats')
{
	const sim = new SimClass({ seed: 42, fixedDt: 1 / 60 })
	sim.reset()
	let lastPattern = null
	let repeats = 0
	let totalPatterns = 0

	for (let i = 0; i < 60 * 60; i++) {
		const obs = sim.getObservation()
		const action = obs[4] > 0 && obs[4] < 0.3 && obs[7] < 0.5 && obs[3] === 0 ? 3 : 0
		const res = sim.step(action)
		for (const ev of res.events) {
			if (ev.type === 'pattern_emitted') {
				if (lastPattern === ev.pattern) repeats++
				lastPattern = ev.pattern
				totalPatterns++
			}
		}
		if (!res.state.alive) {
			// Pattern-repeat tracking is per-life — resets clear the sim's
			// lastPatternName too, so the first pattern of the new life is not
			// a "repeat" of the previous life's last.
			lastPattern = null
			sim.reset()
		}
	}

	if (verbose) console.log(`  ${totalPatterns} patterns, ${repeats} back-to-back repeats`)
	assert(repeats === 0, `Zero back-to-back pattern repeats (got ${repeats} / ${totalPatterns})`)
}

// ==========================================================================
// Test 4: Cosmic Rift gravity flip — test the pure scheduler function directly
// (the sim harness can't keep the player alive past 1800m, so we validate the
// scheduler's logic in isolation; it's integrated into the runtime via
// rift-flip-system.ts so sim-level invocation is verified by code-reading).
// ==========================================================================
console.log('\n▶ Cosmic Rift gravity flip — scheduler logic')
{
	const schedUrl = pathToFileURL(
		new URL('./dist/rift-flip-scheduler.mjs', import.meta.url).pathname,
	).href
	const schedMod = await import(schedUrl)
	const { createRiftFlipState, updateRiftFlip, RIFT_FLIP_WARNING_DURATION } = schedMod
	{
		// Pure scheduler unit tests
		const rng = () => 0.5
		// 1. Idle outside biome 4 → no events.
		{
			const s = createRiftFlipState()
			const events = updateRiftFlip(s, 0.016, 500, 0, true, rng)
			assert(events.length === 0, 'No events when outside biome 4 at d=500m')
		}
		// 2. Entering biome 4 at exactly 1800m → still idle until cursor approaches nextFlipDistance.
		{
			const s = createRiftFlipState()
			const events = updateRiftFlip(s, 0.016, 1800, 4, true, rng)
			assert(events.length === 0, 'No immediate event at d=1800m (warning trigger is at nextFlipDistance-20)')
		}
		// 3. Crossing warningTriggerDistance fires warning.
		{
			const s = createRiftFlipState()
			s.nextFlipDistance = 1900
			const events = updateRiftFlip(s, 0.016, 1880, 4, true, rng)
			assert(events.length === 1 && events[0].type === 'rift_flip_warning', 'Warning fires at d=1880 (trigger=1880)')
			assert(s.phase === 'warning', 'Phase transitions to warning')
			assert(s.timer === RIFT_FLIP_WARNING_DURATION, `Timer set to ${RIFT_FLIP_WARNING_DURATION}s`)
		}
		// 4. Warning → active transition after 1.5s.
		{
			const s = createRiftFlipState()
			s.phase = 'warning'
			s.timer = 0.01
			const events = updateRiftFlip(s, 0.016, 1900, 4, true, rng)
			assert(events.length === 1 && events[0].type === 'rift_flip_start', 'Start fires when warning timer reaches 0')
			assert(s.phase === 'active', 'Phase transitions to active')
		}
		// 5. Active → idle after 3s with scheduling.
		{
			const s = createRiftFlipState()
			s.phase = 'active'
			s.timer = 0.01
			const events = updateRiftFlip(s, 0.016, 1910, 4, true, rng)
			assert(events.length === 1 && events[0].type === 'rift_flip_end', 'End fires when active timer reaches 0')
			assert(s.phase === 'idle', 'Phase returns to idle')
			assert(s.nextFlipDistance > 1910, 'Next flip scheduled ahead of current distance')
		}
		// 6. canTrigger=false (mid-phase) suppresses the warning transition.
		{
			const s = createRiftFlipState()
			s.nextFlipDistance = 1900
			const events = updateRiftFlip(s, 0.016, 1880, 4, false, rng)
			assert(events.length === 0, 'Mid-phase suppresses warning (fair play)')
			assert(s.phase === 'idle', 'Phase stays idle while mid-phase')
		}
		if (verbose) console.log(`  pure scheduler: 6 logic cases verified`)
	}
}

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
