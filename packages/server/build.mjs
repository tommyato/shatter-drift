#!/usr/bin/env node
// Bundle the @sd/server entrypoint to a single CJS file at dist/index.cjs.
// Includes @sd/sim source via workspaces. External: node built-ins, colyseus,
// @colyseus/schema, express (resolved on the droplet via npm install).

import { build, context } from 'esbuild'

const watch = process.argv.includes('--watch')

const opts = {
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: [
    'colyseus',
    '@colyseus/schema',
    'express',
  ],
  logLevel: 'info',
}

if (watch) {
  const ctx = await context(opts)
  await ctx.watch()
  console.log('[sd-mp build] watching…')
} else {
  await build(opts)
}
