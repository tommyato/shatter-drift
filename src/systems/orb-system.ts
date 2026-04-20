import { markOrbCollected, type SimulationWorld } from '../sim-world'

export function createOrbSystem(world: SimulationWorld) {
	return (_dt: number) => {
		if (!world.state.alive || world.state.shattered) {
			return
		}
		for (const orb of world.state.orbs) {
			if (!orb.active) {
				continue
			}
			const dx = world.state.playerX - orb.x
			const dz = world.state.playerZ - orb.z
			if (Math.sqrt(dx * dx + dz * dz) < 1.1) {
				orb.active = false
				markOrbCollected(world)
			}
		}
	}
}

