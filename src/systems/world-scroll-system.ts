import { computeSpeed } from '../constants'
import type { SimulationWorld } from '../sim-world'

export function createWorldScrollSystem(world: SimulationWorld) {
	return (dt: number) => {
		world.state.speed = computeSpeed(world.state.playerZ)
		world.state.playerZ += world.state.speed * dt
		world.addScore(Math.floor(world.state.speed * dt))
	}
}

