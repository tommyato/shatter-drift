/**
 * Choreographed obstacle patterns — multi-obstacle compositions emitted as
 * pure functions of (t, density, biome, seed). Replaces the IID single-obstacle
 * sampler with sequenced "beats" — Weave, Wall Sandwich, Shotgun, Crescendo,
 * False Safety, Twin Gates.
 *
 * Every pattern is a pure function: same rng + ctx → same specs. No side effects.
 * The spawn system materializes specs into SimulationObstacles via the existing
 * createGate/createPillar/createWideBar vocabulary. No new obstacle types.
 */

export type ObstacleKind =
	| 'gate'
	| 'pillar'
	| 'dual-pillar'
	| 'wide-bar'
	| 'phase-wall' // full-width pillar — shatter-only (composes existing pillar vocabulary at width=20)

export interface ObstacleSpec {
	kind: ObstacleKind
	/** z offset relative to pattern start */
	dz: number
	/** optional hints — spawn system may ignore if undefined */
	x?: number
	width?: number
	gapX?: number
	gapHalfWidth?: number
}

export interface PatternCtx {
	playerZ: number
	biome: number // 0–4
	difficultyT: number // normalized distance scalar (0 at start, →1 by 2000m)
}

export interface Pattern {
	name: string
	length: number
	obstacleCount: number
	emit(rng: () => number, ctx: PatternCtx): ObstacleSpec[]
}

// ---------------------------------------------------------------------------
// Pattern library
// ---------------------------------------------------------------------------

/** Weave — 6 alternating L/R pillars at tight spacing (every 8 units). Lateral agility.
 *  First pillar is tightest-to-center to reward an early lateral commit (and guarantees
 *  the player must actually move rather than ride center). */
const weave: Pattern = {
	name: 'weave',
	length: 48,
	obstacleCount: 6,
	emit(rng, _ctx) {
		const startSide = rng() < 0.5 ? -1 : 1
		const specs: ObstacleSpec[] = []
		for (let i = 0; i < 6; i++) {
			const side = startSide * (i % 2 === 0 ? 1 : -1)
			// First pillar tight to center (|x|≈1.2), rest at normal weave offsets
			const x = i === 0 ? side * (0.8 + rng() * 0.4) : side * (2 + rng() * 1.5)
			specs.push({ kind: 'pillar', dz: i * 8, x, width: 1.2 + rng() * 0.8 })
		}
		return specs
	},
}

/** Wall Sandwich — gate | phase-wall | gate. Phase-decision trainer. */
const wallSandwich: Pattern = {
	name: 'wall-sandwich',
	length: 30,
	obstacleCount: 3,
	emit(rng, _ctx) {
		return [
			{ kind: 'gate', dz: 0, gapX: (rng() - 0.5) * 5 },
			{ kind: 'phase-wall', dz: 12 },
			{ kind: 'gate', dz: 24, gapX: (rng() - 0.5) * 5 },
		]
	},
}

/** Shotgun — 5 obstacles in ~25 units, then a breather (handled by caller via pattern.length). */
const shotgun: Pattern = {
	name: 'shotgun',
	length: 60, // 25 compression + 35 breather built-in
	obstacleCount: 5,
	emit(rng, _ctx) {
		const specs: ObstacleSpec[] = []
		for (let i = 0; i < 5; i++) {
			const pick = rng()
			if (pick < 0.5) {
				specs.push({ kind: 'pillar', dz: i * 5, x: (rng() - 0.5) * 6 })
			} else if (pick < 0.8) {
				specs.push({ kind: 'gate', dz: i * 5, gapX: (rng() - 0.5) * 5 })
			} else {
				specs.push({ kind: 'dual-pillar', dz: i * 5 })
			}
		}
		return specs
	},
}

/** Crescendo — 8 obstacles with spacing 20→8 linearly. Ends in phase-wall climax. */
const crescendo: Pattern = {
	name: 'crescendo',
	length: 115,
	obstacleCount: 8,
	emit(rng, _ctx) {
		const specs: ObstacleSpec[] = []
		let dz = 0
		for (let i = 0; i < 7; i++) {
			// spacing 20 → ~9 across 7 steps
			const spacing = 20 - (12 * i) / 6
			specs.push({
				kind: rng() < 0.5 ? 'pillar' : 'gate',
				dz,
				x: (rng() - 0.5) * 6,
				gapX: (rng() - 0.5) * 4,
			})
			dz += spacing
		}
		// Climax — phase-wall at the end (≈ dz 104, +breathing room inside length budget)
		specs.push({ kind: 'phase-wall', dz })
		return specs
	},
}

/** False Safety — 3 easy at wide spacing then surprise phase-wall at tight spacing. */
const falseSafety: Pattern = {
	name: 'false-safety',
	length: 38,
	obstacleCount: 4,
	emit(rng, _ctx) {
		return [
			{ kind: 'gate', dz: 0, gapX: (rng() - 0.5) * 5 },
			{ kind: 'pillar', dz: 10, x: (rng() - 0.5) * 5 },
			{ kind: 'gate', dz: 20, gapX: (rng() - 0.5) * 5 },
			{ kind: 'phase-wall', dz: 26 }, // surprise, 6 units after the gate — tight
		]
	},
}

/** Twin Gates — two gates with opposite gap offsets forcing rapid lateral swap. */
const twinGates: Pattern = {
	name: 'twin-gates',
	length: 16,
	obstacleCount: 2,
	emit(rng, _ctx) {
		const offset = 2 + rng() * 1.5
		const side = rng() < 0.5 ? -1 : 1
		return [
			{ kind: 'gate', dz: 0, gapX: side * offset, gapHalfWidth: 2.25 },
			{ kind: 'gate', dz: 8, gapX: -side * offset, gapHalfWidth: 2.25 },
		]
	},
}

export const PATTERNS: Pattern[] = [
	weave,
	wallSandwich,
	shotgun,
	crescendo,
	falseSafety,
	twinGates,
]

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Weighted-random pick. Weights shift with difficulty:
 *  - calm patterns (twin-gates, wall-sandwich) are common early, fade later
 *  - heavy patterns (shotgun, crescendo) are rare early, dominant late
 *  - weave, false-safety stay moderate throughout
 * All patterns are reachable in every biome — weights bias, never gate.
 * Never returns the same pattern as lastPatternName (drops its weight to 0).
 */
export function pickNextPattern(
	ctx: PatternCtx,
	rng: () => number,
	lastPatternName: string | null,
): Pattern {
	const t = ctx.difficultyT // 0 → 1 by 2000m
	// Calm patterns (twin-gates, wall-sandwich) dominate early;
	// heavy patterns (shotgun, crescendo) ramp up with distance.
	const weights: Record<string, number> = {
		weave: 0.15 + t * 0.9,
		'wall-sandwich': 0.8 - t * 0.3,
		shotgun: 0.05 + t * 1.2,
		crescendo: 0.05 + t * 1.2,
		'false-safety': 0.3 + t * 0.4,
		'twin-gates': 1.0 - t * 0.5,
	}

	// Biome nudge: Cosmic Rift (4) favors heavy patterns, Void (0) favors calm.
	if (ctx.biome === 4) {
		weights['shotgun'] += 0.2
		weights['crescendo'] += 0.2
	} else if (ctx.biome === 0) {
		weights['twin-gates'] += 0.3
		weights['wall-sandwich'] += 0.2
	}

	if (lastPatternName && weights[lastPatternName] !== undefined) {
		weights[lastPatternName] = 0
	}

	// Clamp nonnegative
	let total = 0
	for (const k of Object.keys(weights)) {
		weights[k] = Math.max(0, weights[k]!)
		total += weights[k]!
	}

	if (total <= 0) return twinGates // defensive fallback — should never happen

	let r = rng() * total
	for (const pat of PATTERNS) {
		const w = weights[pat.name] ?? 0
		if (r < w) return pat
		r -= w
	}
	return PATTERNS[PATTERNS.length - 1]!
}

/** Biome index from world distance — matches BIOMES startDistance thresholds in biomes.ts. */
export function biomeFromDistance(distance: number): number {
	if (distance < 300) return 0
	if (distance < 700) return 1
	if (distance < 1200) return 2
	if (distance < 1800) return 3
	return 4
}
