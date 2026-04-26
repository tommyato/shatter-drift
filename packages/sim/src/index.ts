/**
 * @sd/sim — pure deterministic simulation for Shatter Drift.
 *
 * This package is render-free: zero Three.js, GSAP, Howler, or DOM imports.
 * It is consumed by both `@sd/client` (for local play + client-side prediction)
 * and `@sd/server` (for the server-authoritative match host, when implemented).
 *
 * Public API: re-exported here from the individual modules so consumers can
 * `import { ... } from '@sd/sim'`. Sub-path imports (e.g.
 * `@sd/sim/systems/gravity-flip-scheduler`) are also supported via
 * package.json `exports` for tools that bundle subsets of the sim.
 */

export * from './types'
export * from './constants'
export * from './simulation'
export * from './sim-world'
export * from './runtime'
export * from './tokens'
export * from './lockstep-runner'
export * from './harness'
export * from './systems/gravity-flip-scheduler'
