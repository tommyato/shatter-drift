import { execSync } from 'node:child_process'
import { build as esbuild } from 'esbuild'
import { build as viteBuild } from 'vite'

const BUILD_HASH = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
const define = {
	__BUILD_HASH__: JSON.stringify(BUILD_HASH),
}

await viteBuild()

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

await esbuild({
	entryPoints: ['src/simulation.ts'],
	outfile: 'dist/simulation.mjs',
	bundle: true,
	format: 'esm',
	target: 'node18',
	platform: 'node',
	sourcemap: false,
	define,
})

await esbuild({
	entryPoints: ['src/lockstep-runner.ts'],
	outfile: 'dist/lockstep-runner.mjs',
	bundle: true,
	format: 'esm',
	target: 'node18',
	platform: 'node',
	sourcemap: false,
	define,
})

// Standalone bundle of the gravity-flip scheduler so verify-patterns.mjs can
// unit-test the pure logic without needing the whole sim.
await esbuild({
	entryPoints: ['src/systems/gravity-flip-scheduler.ts'],
	outfile: 'dist/rift-flip-scheduler.mjs',
	bundle: true,
	format: 'esm',
	target: 'node18',
	platform: 'node',
	sourcemap: false,
	define,
})

// Harness bundle — loaded dynamically via ?_harness=1 (browser, ESM).
// NOT inlined into index.html so normal users never download this code.
await esbuild({
	entryPoints: ['src/harness.ts'],
	outfile: 'dist/harness.js',
	bundle: true,
	format: 'esm',
	target: 'es2022',
	platform: 'browser',
	sourcemap: false,
	define,
})
