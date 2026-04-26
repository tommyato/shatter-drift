import { computeSpeed } from '../constants'
import type { SimulationWorld } from '../sim-world'

export function createWorldScrollSystem(world: SimulationWorld) {
	return (dt: number) => {
		// Apply speedMod set by SpeedModSystem in the previous tick (starts at 1.0).
		world.state.speed = computeSpeed(world.state.playerZ) * world.state.speedMod
		world.state.playerZ += world.state.speed * dt
		world.addScore(Math.floor(world.state.speed * dt))
	}
}

