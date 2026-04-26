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
		for (const player of world.state.players) {
			if (!player.alive) {
				player.shattered = false
				player.phaseMinTimer = 0
				continue
			}

			const input = world.inputs[player.playerIndex]?.getState()
			if (!input) continue
			const wasShattered = player.shattered

			// Tick down post-shatter cooldown
			if (player.phaseCooldown > 0) {
				player.phaseCooldown = Math.max(0, player.phaseCooldown - dt)
			}

			// Tick down minimum-duration lock
			if (player.phaseMinTimer > 0) {
				player.phaseMinTimer = Math.max(0, player.phaseMinTimer - dt)
			}

			// Phase stays active while min-duration timer is running OR input is held
			const wantsToShatter = input.shatter && !player.phaseLocked && player.phaseCooldown <= 0
			const forcedByMinTimer = player.phaseMinTimer > 0 && !player.phaseLocked
			const isPhasing = (wantsToShatter || forcedByMinTimer) && player.phaseEnergy > 0

			if (isPhasing) {
				player.phaseEnergy = Math.max(0, player.phaseEnergy - PHASE_DRAIN_RATE * dt)
			} else {
				player.phaseEnergy = Math.min(1, player.phaseEnergy + PHASE_RECHARGE_RATE * dt)
			}

			if (player.phaseEnergy <= 0) {
				player.phaseEnergy = 0
				player.phaseLocked = true
				player.phaseMinTimer = 0
				player.shattered = false
			} else if (player.phaseLocked && player.phaseEnergy >= PHASE_MIN_THRESHOLD) {
				player.phaseLocked = false
			}

			player.shattered = isPhasing && !player.phaseLocked && player.phaseEnergy > 0

			// Start post-shatter cooldown when phase ends
			if (wasShattered && !player.shattered) {
				player.phaseCooldown = PHASE_POST_COOLDOWN
			}
			// On fresh activation: apply activation cost and start min-duration lock
			if (player.shattered && !wasShattered) {
				player.phaseEnergy = Math.max(0, player.phaseEnergy - PHASE_ACTIVATION_COST)
				player.phaseMinTimer = PHASE_MIN_DURATION
				if (player.phaseEnergy <= 0) {
					player.phaseEnergy = 0
					player.phaseLocked = true
					player.phaseMinTimer = 0
					player.shattered = false
				}
				world.pushEvent({ type: 'shatter_activated' })
			}

			if (!player.shattered) {
				continue
			}

			for (const obstacle of world.state.obstacles) {
				if (!obstacle.active) {
					continue
				}
				const dz = Math.abs(player.z - obstacle.z)
				if (dz > 1.5) {
					continue
				}

				let withinCloseCall = false
				if (obstacle.isGate && obstacle.wallSegments) {
					if (obstacle.partiallyShattered) {
						continue
					}
					for (const segment of obstacle.wallSegments) {
						if (Math.abs(player.x - segment.x) < segment.halfWidth + 0.8) {
							withinCloseCall = true
							break
						}
					}
				} else {
					withinCloseCall = Math.abs(player.x - obstacle.x) < obstacle.halfWidth + 0.8
				}

				if (!withinCloseCall) {
					continue
				}

				destroyObstacle(world, obstacle, player.x)
				if (player.z - player.lastCloseCallZ > 3) {
					player.lastCloseCallZ = player.z
					markCloseCall(world, player.playerIndex)
				}
			}
		}
	}
}
