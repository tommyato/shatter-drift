/**
 * @sd/sim build script.
 *
 * Bundles the pure simulation into Node-loadable artifacts under `dist/` so
 * that `validate-sim.mjs`, `verify-patterns.mjs`, and other deterministic-replay
 * tooling can `import` the sim without a TypeScript loader.
 *
 * Outputs:
 *   dist/simulation.mjs         — full ShatterDriftSimulation entry
 *   dist/lockstep-runner.mjs    — multiplayer-friendly runner
 *   dist/rift-flip-scheduler.mjs — gravity-flip scheduler (pure logic only)
 */
import { build as esbuild } from 'esbuild'

const targets = [
	{ entry: 'src/simulation.ts',                    out: 'dist/simulation.mjs' },
	{ entry: 'src/lockstep-runner.ts',               out: 'dist/lockstep-runner.mjs' },
	{ entry: 'src/systems/gravity-flip-scheduler.ts', out: 'dist/rift-flip-scheduler.mjs' },
	{ entry: 'src/spatial-hash.ts',                  out: 'dist/spatial-hash.mjs' },
]

for (const { entry, out } of targets) {
	await esbuild({
		entryPoints: [entry],
		outfile: out,
		bundle: true,
		format: 'esm',
		target: 'node18',
		platform: 'node',
		sourcemap: false,
	})
}
