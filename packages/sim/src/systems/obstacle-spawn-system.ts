import {
	INITIAL_OBSTACLE_Z,
	INITIAL_ORB_Z,
	ORB_SPACING,
	PLAYABLE_HALF_WIDTH,
	SPAWN_DISTANCE,
	clamp,
} from '../constants'
import type { SimulationObstacle, SimulationWorld } from '../sim-world'
import {
	type ObstacleSpec,
	type PatternCtx,
	biomeFromDistance,
	pickNextPattern,
} from './obstacle-patterns'

const BOSS_WAVE_INTERVAL = 500

function createGate(
	world: SimulationWorld,
	z: number,
	gapHalfWidth: number,
	gapXOverride?: number,
): void {
	const gapX = gapXOverride ?? (world.random() - 0.5) * 5
	const leftWidth = gapX - gapHalfWidth + PLAYABLE_HALF_WIDTH
	const rightStart = gapX + gapHalfWidth
	const rightWidth = PLAYABLE_HALF_WIDTH - rightStart
	const wallSegments = []
	if (leftWidth > 0.5) {
		wallSegments.push({
			x: -PLAYABLE_HALF_WIDTH + leftWidth / 2,
			halfWidth: leftWidth / 2,
		})
	}
	if (rightWidth > 0.5) {
		wallSegments.push({
			x: rightStart + rightWidth / 2,
			halfWidth: rightWidth / 2,
		})
	}
	world.state.obstacles.push({
		z,
		x: 0,
		halfWidth: PLAYABLE_HALF_WIDTH,
		halfHeight: 1.5,
		isGate: true,
		gapX,
		gapHalfWidth,
		active: true,
		partiallyShattered: false,
		passed: false,
		wallSegments,
	})
}

function createPillar(world: SimulationWorld, z: number, x?: number, width?: number): void {
	const centerX = x ?? (world.random() - 0.5) * 6
	const actualWidth = width ?? 1 + world.random() * 1.5
	const height = 2 + world.random() * 2
	world.state.obstacles.push({
		z,
		x: centerX,
		halfWidth: actualWidth / 2,
		halfHeight: height / 2,
		isGate: false,
		gapX: 0,
		gapHalfWidth: 0,
		active: true,
		partiallyShattered: false,
		passed: false,
	})
}

function createWideBar(world: SimulationWorld, z: number, gapXOverride?: number): void {
	const gapSide = world.random() < 0.5 ? -1 : 1
	const gapX = gapXOverride ?? gapSide * (2 + world.random() * 2)
	const gapHalfWidth = 2
	const gapLeft = gapX - gapHalfWidth
	const gapRight = gapX + gapHalfWidth
	const leftWidth = gapLeft + PLAYABLE_HALF_WIDTH
	const rightWidth = PLAYABLE_HALF_WIDTH - gapRight
	const wallSegments = []
	if (leftWidth > 0.5) {
		wallSegments.push({
			x: -PLAYABLE_HALF_WIDTH + leftWidth / 2,
			halfWidth: leftWidth / 2,
		})
	}
	if (rightWidth > 0.5) {
		wallSegments.push({
			x: gapRight + rightWidth / 2,
			halfWidth: rightWidth / 2,
		})
	}
	world.state.obstacles.push({
		z,
		x: 0,
		halfWidth: PLAYABLE_HALF_WIDTH,
		halfHeight: 0.75,
		isGate: true,
		gapX,
		gapHalfWidth,
		active: true,
		partiallyShattered: false,
		passed: false,
		wallSegments,
	})
}

/** Phase-only wall: full-width pillar (halfWidth = PLAYABLE_HALF_WIDTH). Must be phased through.
 *  Composes the existing pillar vocabulary — no new obstacle type. */
function createPhaseWall(world: SimulationWorld, z: number): void {
	world.state.obstacles.push({
		z,
		x: 0,
		halfWidth: PLAYABLE_HALF_WIDTH,
		halfHeight: 1.5,
		isGate: false,
		gapX: 0,
		gapHalfWidth: 0,
		active: true,
		partiallyShattered: false,
		passed: false,
	})
}

/** Crystal Caves rising slab: full-width obstacle that oscillates vertically.
 *  Passable only via boost/brake timing — lateral dodge cannot clear it.
 *  BiomeGimmickSystem drives ghosted state each tick based on simTime + slabPhase. */
function createRisingSlab(world: SimulationWorld, z: number): void {
	world.state.obstacles.push({
		z,
		x: 0,
		halfWidth: PLAYABLE_HALF_WIDTH,
		halfHeight: 1.5,
		isGate: false,
		gapX: 0,
		gapHalfWidth: 0,
		active: true,
		partiallyShattered: false,
		passed: false,
		isRisingSlab: true,
	})
}

function materializeSpec(world: SimulationWorld, z: number, spec: ObstacleSpec): void {
	switch (spec.kind) {
		case 'gate':
			createGate(world, z, spec.gapHalfWidth ?? 2.25, spec.gapX)
			return
		case 'pillar':
			createPillar(world, z, spec.x, spec.width)
			return
		case 'dual-pillar': {
			const spread = 2 + world.random() * 2
			const offset = (world.random() - 0.5) * 2
			createPillar(world, z, offset - spread, 1 + world.random())
			createPillar(world, z, offset + spread, 1 + world.random())
			return
		}
		case 'wide-bar':
			createWideBar(world, z, spec.gapX)
			return
		case 'phase-wall':
			createPhaseWall(world, z)
			return
		case 'rising-slab':
			createRisingSlab(world, z)
			return
	}
}

function getObstacleSpacing(world: SimulationWorld): number {
	const distance = world.anchorZ()
	if (distance < 300) {
		return 18 + world.random() * 6
	}
	if (distance < 700) {
		return 13 + world.random() * 5
	}
	if (distance < 1200) {
		return 9 + world.random() * 4
	}
	if (distance < 1800) {
		return 7 + world.random() * 4
	}
	return 5 + world.random() * 4
}

// Boss type 0: SpinningGate — 4 wide pillars spread over ~12m zone; arms rotate (visual only, x stays 0)
function spawnBossSpinningGate(world: SimulationWorld, bossZ: number): void {
	;[-6, -2, 2, 6].forEach((zOff, i) => {
		world.state.obstacles.push({
			z: bossZ + zOff,
			x: 0,
			halfWidth: 3,
			halfHeight: 1.5,
			isGate: false,
			gapX: 0,
			gapHalfWidth: 0,
			active: true,
			partiallyShattered: false,
			passed: false,
			bossAnimation: { pattern: 'static', baseX: 0, phase: (i * Math.PI) / 2, speed: 1.5 + i * 0.3, timer: 0 },
		})
	})
}

// Boss type 1: ConvergingWalls — 2 walls per row (left+right), 3 rows; walls converge open/closed
function spawnBossConvergingWalls(world: SimulationWorld, bossZ: number): void {
	for (let row = 0; row < 3; row++) {
		for (const side of [-1, 1]) {
			world.state.obstacles.push({
				z: bossZ + row * 5 - 5,
				x: side * 3,
				halfWidth: 1.5,
				halfHeight: 2,
				isGate: false,
				gapX: 0,
				gapHalfWidth: 0,
				active: true,
				partiallyShattered: false,
				passed: false,
				bossAnimation: { pattern: 'converge', baseX: side * 3, phase: row * 1.5, speed: 1.2, timer: 0 },
			})
		}
	}
}

// Boss type 2: OrbitalRings — 5 pillars alternating sides; oscillate side to side
function spawnBossOrbitalRings(world: SimulationWorld, bossZ: number): void {
	;[-6, -3, 0, 3, 6].forEach((zOff, i) => {
		const baseX = i % 2 === 0 ? -2 : 2
		world.state.obstacles.push({
			z: bossZ + zOff,
			x: baseX,
			halfWidth: 0.75,
			halfHeight: 1.5,
			isGate: false,
			gapX: 0,
			gapHalfWidth: 0,
			active: true,
			partiallyShattered: false,
			passed: false,
			bossAnimation: { pattern: 'oscillate', baseX, phase: i * 1.2, speed: 2.0, timer: 0 },
		})
	})
}

// Boss type 3: LaserGrid — 4 full-width bars; CANNOT be dodged — agent MUST shatter; bars oscillate
function spawnBossLaserGrid(world: SimulationWorld, bossZ: number): void {
	;[-6, -2, 2, 6].forEach((zOff, i) => {
		const x = (world.random() - 0.5) * 4
		world.state.obstacles.push({
			z: bossZ + zOff,
			x,
			halfWidth: PLAYABLE_HALF_WIDTH,
			halfHeight: 0.4,
			isGate: false,
			gapX: 0,
			gapHalfWidth: 0,
			active: true,
			partiallyShattered: false,
			passed: false,
			bossAnimation: { pattern: 'oscillate', baseX: x, phase: i * 2, speed: 1.5, timer: 0 },
		})
	})
}

function spawnBossWave(world: SimulationWorld, bossZ: number): void {
	switch (world.state.bossCount % 4) {
		case 0:
			spawnBossSpinningGate(world, bossZ)
			break
		case 1:
			spawnBossConvergingWalls(world, bossZ)
			break
		case 2:
			spawnBossOrbitalRings(world, bossZ)
			break
		case 3:
			spawnBossLaserGrid(world, bossZ)
			break
	}
}

function spawnOrbCluster(world: SimulationWorld, z: number): void {
	const count = 1 + Math.floor(world.random() * 3)
	const baseX = (world.random() - 0.5) * 6
	for (let index = 0; index < count; index += 1) {
		world.state.orbs.push({
			x: baseX + (index - (count - 1) / 2) * 1.5,
			z: z + index * 1.5,
			active: true,
		})
	}
}

/** Emit a choreographed pattern at the current spawn cursor. Advances the cursor by
 *  pattern.length plus a randomized breather (1.0–2.0× distance-adaptive spacing).
 *  Returns the z-delta the cursor advanced. Breather calibrated so that mean
 *  obstacle density matches the pre-patterns IID baseline (~0.081 obstacles/m
 *  over 2000m, within ±15%). */
function emitPattern(world: SimulationWorld): number {
	const startZ = world.state.nextObstacleZ
	const ctx: PatternCtx = {
		playerZ: world.anchorZ(),
		biome: biomeFromDistance(startZ),
		difficultyT: clamp(startZ / 2000, 0, 1),
	}
	const pattern = pickNextPattern(ctx, world.random, world.state.lastPatternName)
	let specs = pattern.emit(world.random, ctx)

	// Crystal Caves (biome 1): replace ~1-in-4 obstacles with rising slabs.
	// Rising slabs are full-width and cleared only by boost/brake timing.
	// Replace 1:1 so obstacle count and density are unchanged.
	if (ctx.biome === 1) {
		specs = specs.map((spec) =>
			world.random() < 0.25 ? { kind: 'rising-slab' as const, dz: spec.dz } : spec,
		)
	}

	for (const spec of specs) {
		materializeSpec(world, startZ + spec.dz, spec)
	}

	world.state.lastPatternName = pattern.name
	world.pushEvent({
		type: 'pattern_emitted',
		pattern: pattern.name,
		obstacleCount: specs.length,
		startZ,
	})

	const breather = getObstacleSpacing(world) * (1.0 + world.random())
	return pattern.length + breather
}

export function createObstacleSpawnSystem(world: SimulationWorld) {
	return (_dt: number) => {
		if (world.state.nextObstacleZ === 0) {
			world.state.nextObstacleZ = INITIAL_OBSTACLE_Z
		}
		if (world.state.nextOrbZ === 0) {
			world.state.nextOrbZ = INITIAL_ORB_Z
		}

		const anchor = world.anchorZ()
		while (world.state.nextObstacleZ < anchor + SPAWN_DISTANCE) {
			const advance = emitPattern(world)
			world.state.nextObstacleZ += advance
		}

		while (world.state.nextOrbZ < anchor + SPAWN_DISTANCE) {
			spawnOrbCluster(world, world.state.nextOrbZ)
			world.state.nextOrbZ += ORB_SPACING + world.random() * 5
		}

		// Boss wave spawning — additive on top of regular obstacles
		while (world.state.nextBossZ < anchor + SPAWN_DISTANCE) {
			spawnBossWave(world, world.state.nextBossZ)
			world.state.nextBossZ += BOSS_WAVE_INTERVAL
			world.state.bossCount += 1
		}
	}
}

export function destroyObstacle(
	world: SimulationWorld,
	obstacle: SimulationObstacle,
	impactX: number,
): boolean {
	if (!obstacle.active) {
		return false
	}
	if (!obstacle.isGate) {
		obstacle.active = false
		world.pushEvent({ type: 'wall_destroyed' })
		return true
	}

	if (!obstacle.wallSegments || obstacle.wallSegments.length === 0) {
		obstacle.active = false
		return false
	}

	let nearestIndex = 0
	let nearestDistance = Infinity
	for (let index = 0; index < obstacle.wallSegments.length; index += 1) {
		const distance = Math.abs(impactX - obstacle.wallSegments[index]!.x)
		if (distance < nearestDistance) {
			nearestDistance = distance
			nearestIndex = index
		}
	}

	obstacle.wallSegments.splice(nearestIndex, 1)
	obstacle.partiallyShattered = true
	world.pushEvent({ type: 'wall_destroyed' })

	if (obstacle.wallSegments.length === 0) {
		obstacle.active = false
		return true
	}

	if (obstacle.wallSegments.length === 1) {
		const segment = obstacle.wallSegments[0]!
		if (segment.x < 0) {
			const rightEdge = obstacle.gapX + obstacle.gapHalfWidth
			obstacle.gapX = (-PLAYABLE_HALF_WIDTH + rightEdge) / 2
			obstacle.gapHalfWidth = (rightEdge + PLAYABLE_HALF_WIDTH) / 2
		} else {
			const leftEdge = obstacle.gapX - obstacle.gapHalfWidth
			obstacle.gapX = (leftEdge + PLAYABLE_HALF_WIDTH) / 2
			obstacle.gapHalfWidth = (PLAYABLE_HALF_WIDTH - leftEdge) / 2
		}
	}

	return true
}
