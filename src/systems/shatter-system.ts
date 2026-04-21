import {
	PHASE_ACTIVATION_COST,
	PHASE_DRAIN_RATE,
	PHASE_MIN_DURATION,
	PHASE_MIN_THRESHOLD,
	PHASE_POST_COOLDOWN,
	PHASE_RECHARGE_RATE,
} from '../constants'
import { markCloseCall, type SimulationWorld } from '../sim-world'
import { destroyObstacle } from './obstacle-spawn-system'

export function createShatterSystem(world: SimulationWorld) {
	return (dt: number) => {
		if (!world.state.alive) {
			world.state.shattered = false
			world.state.phaseMinTimer = 0
			return
		}

		const input = world.input.getState()
		const wasShattered = world.state.shattered

		// Tick down post-shatter cooldown
		if (world.state.phaseCooldown > 0) {
			world.state.phaseCooldown = Math.max(0, world.state.phaseCooldown - dt)
		}

		// Tick down minimum-duration lock
		if (world.state.phaseMinTimer > 0) {
			world.state.phaseMinTimer = Math.max(0, world.state.phaseMinTimer - dt)
		}

		// Phase stays active while min-duration timer is running OR input is held
		const wantsToShatter = input.shatter && !world.state.phaseLocked && world.state.phaseCooldown <= 0
		const forcedByMinTimer = world.state.phaseMinTimer > 0 && !world.state.phaseLocked
		const isPhasing = (wantsToShatter || forcedByMinTimer) && world.state.phaseEnergy > 0

		if (isPhasing) {
			world.state.phaseEnergy = Math.max(0, world.state.phaseEnergy - PHASE_DRAIN_RATE * dt)
		} else {
			world.state.phaseEnergy = Math.min(1, world.state.phaseEnergy + PHASE_RECHARGE_RATE * dt)
		}

		if (world.state.phaseEnergy <= 0) {
			world.state.phaseEnergy = 0
			world.state.phaseLocked = true
			world.state.phaseMinTimer = 0
			world.state.shattered = false
		} else if (world.state.phaseLocked && world.state.phaseEnergy >= PHASE_MIN_THRESHOLD) {
			world.state.phaseLocked = false
		}

		world.state.shattered = isPhasing && !world.state.phaseLocked && world.state.phaseEnergy > 0

		// Start post-shatter cooldown when phase ends
		if (wasShattered && !world.state.shattered) {
			world.state.phaseCooldown = PHASE_POST_COOLDOWN
		}
		// On fresh activation: apply activation cost and start min-duration lock
		if (world.state.shattered && !wasShattered) {
			world.state.phaseEnergy = Math.max(0, world.state.phaseEnergy - PHASE_ACTIVATION_COST)
			world.state.phaseMinTimer = PHASE_MIN_DURATION
			if (world.state.phaseEnergy <= 0) {
				world.state.phaseEnergy = 0
				world.state.phaseLocked = true
				world.state.phaseMinTimer = 0
				world.state.shattered = false
			}
			world.pushEvent({ type: 'shatter_activated' })
		}

		if (!world.state.shattered) {
			return
		}

		for (const obstacle of world.state.obstacles) {
			if (!obstacle.active) {
				continue
			}
			const dz = Math.abs(world.state.playerZ - obstacle.z)
			if (dz > 1.5) {
				continue
			}

			let withinCloseCall = false
			if (obstacle.isGate && obstacle.wallSegments) {
				if (obstacle.partiallyShattered) {
					continue
				}
				for (const segment of obstacle.wallSegments) {
					if (Math.abs(world.state.playerX - segment.x) < segment.halfWidth + 0.8) {
						withinCloseCall = true
						break
					}
				}
			} else {
				withinCloseCall = Math.abs(world.state.playerX - obstacle.x) < obstacle.halfWidth + 0.8
			}

			if (!withinCloseCall) {
				continue
			}

			destroyObstacle(world, obstacle, world.state.playerX)
			if (world.state.playerZ - world.state.lastCloseCallZ > 3) {
				world.state.lastCloseCallZ = world.state.playerZ
				markCloseCall(world)
			}
		}
	}
}

