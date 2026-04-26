import { markOrbCollected, type SimulationWorld } from '../sim-world'

export function createOrbSystem(world: SimulationWorld) {
	return (_dt: number) => {
		for (const orb of world.state.orbs) {
			if (!orb.active) continue
			for (const player of world.state.players) {
				if (!player.alive || player.shattered) continue
				const dx = player.x - orb.x
				const dz = player.z - orb.z
				if (Math.sqrt(dx * dx + dz * dz) < 1.1) {
					orb.active = false
					markOrbCollected(world, player.playerIndex)
					break // one orb per pickup
				}
			}
		}
	}
}
