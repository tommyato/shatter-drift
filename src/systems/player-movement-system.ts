import { PLAYER_MOVE_SPEED, PLAYABLE_HALF_WIDTH, clamp } from '../constants'
import type { SimulationWorld } from '../sim-world'

export function createPlayerMovementSystem(world: SimulationWorld) {
	return (dt: number) => {
		const input = world.input.getState()
		world.state.playerX = clamp(
			world.state.playerX + input.horizontal * PLAYER_MOVE_SPEED * dt,
			-PLAYABLE_HALF_WIDTH,
			PLAYABLE_HALF_WIDTH,
		)
	}
}

