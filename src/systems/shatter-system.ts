import {
	PHASE_DRAIN_RATE,
	PHASE_MIN_THRESHOLD,
	PHASE_RECHARGE_RATE,
} from '../constants'
import { markCloseCall, type SimulationWorld } from '../sim-world'
import { destroyObstacle } from './obstacle-spawn-system'

export function createShatterSystem(world: SimulationWorld) {
	return (dt: number) => {
		if (!world.state.alive) {
			world.state.shattered = false
			return
		}

		const input = world.input.getState()
		const wasShattered = world.state.shattered
		const wantsToShatter = input.shatter && !world.state.phaseLocked

		if (wantsToShatter) {
			world.state.phaseEnergy = Math.max(0, world.state.phaseEnergy - PHASE_DRAIN_RATE * dt)
		} else {
			world.state.phaseEnergy = Math.min(1, world.state.phaseEnergy + PHASE_RECHARGE_RATE * dt)
		}

		if (world.state.phaseEnergy <= 0) {
			world.state.phaseEnergy = 0
			world.state.phaseLocked = true
			world.state.shattered = false
		} else if (world.state.phaseLocked && world.state.phaseEnergy >= PHASE_MIN_THRESHOLD) {
			world.state.phaseLocked = false
		}

		world.state.shattered = wantsToShatter && !world.state.phaseLocked && world.state.phaseEnergy > 0
		if (world.state.shattered && !wasShattered) {
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

