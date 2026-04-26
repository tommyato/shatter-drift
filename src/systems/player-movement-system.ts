import { PLAYER_MOVE_SPEED, PLAYABLE_HALF_WIDTH, clamp } from '../constants'
import type { SimulationWorld } from '../sim-world'

export function createPlayerMovementSystem(world: SimulationWorld) {
	return (dt: number) => {
		for (const player of world.state.players) {
			if (!player.alive) continue
			const input = world.inputs[player.playerIndex]?.getState()
			if (!input) continue
			player.x = clamp(
				player.x + input.horizontal * PLAYER_MOVE_SPEED * dt,
				-PLAYABLE_HALF_WIDTH,
				PLAYABLE_HALF_WIDTH,
			)
		}
	}
}
