/**
 * @sd/client build script.
 *
 * Pipeline:
 *   1. vite build  → produces the inlined single-file game (dist/index.html)
 *   2. esbuild     → produces ad-hoc browser bundles consumed at runtime
 *                    (dist/game.js for legacy entry, dist/harness.js for the
 *                     ?_harness=1 QA harness)
 *
 * The Node-side sim bundles (dist/simulation.mjs, dist/lockstep-runner.mjs,
 * dist/rift-flip-scheduler.mjs) are produced by the sibling @sd/sim package's
 * build.mjs and consumed by `validate-sim.mjs` / `verify-patterns.mjs` from
 * that package's directory. They are intentionally NOT mirrored here.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { build as esbuild } from 'esbuild'
import { build as viteBuild } from 'vite'

const BUILD_HASH = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
const SD_MP_URL = process.env.VITE_SD_MP_URL || ''
const define = {
	__BUILD_HASH__: JSON.stringify(BUILD_HASH),
	__SD_MP_URL__: JSON.stringify(SD_MP_URL),
}

const SIM_SRC = resolve(import.meta.dirname, '../sim/src')

await viteBuild()

const distDir = resolve(import.meta.dirname, 'dist')
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })

// Browser entry — used by the legacy /game.js loader path.
await esbuild({
	entryPoints: ['src/main.ts'],
	outfile: 'dist/game.js',
	bundle: true,
	format: 'esm',
	target: 'es2022',
	platform: 'browser',
	sourcemap: false,
	define,
})

// Harness bundle — loaded dynamically via ?_harness=1 (browser, ESM).
// NOT inlined into index.html so normal users never download this code.
// Source lives in @sd/sim; we resolve it via the workspace path so this build
// stays self-contained.
await esbuild({
	entryPoints: [`${SIM_SRC}/harness.ts`],
	outfile: 'dist/harness.js',
	bundle: true,
	format: 'esm',
	target: 'es2022',
	platform: 'browser',
	sourcemap: false,
	define,
})
