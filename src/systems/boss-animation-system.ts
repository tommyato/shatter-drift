import type { SimulationWorld } from '../sim-world'

export function createBossAnimationSystem(world: SimulationWorld) {
	return (dt: number) => {
		for (const obstacle of world.state.obstacles) {
			if (!obstacle.bossAnimation || !obstacle.active) continue
			const anim = obstacle.bossAnimation
			anim.timer += dt
			switch (anim.pattern) {
				case 'oscillate':
					obstacle.x = anim.baseX + Math.sin(anim.timer * anim.speed + anim.phase) * 3
					break
				case 'converge': {
					const cycle = (Math.sin(anim.timer * anim.speed + anim.phase) + 1) / 2
					obstacle.x = anim.baseX * (0.3 + cycle * 0.7)
					break
				}
				case 'static':
					break
			}
		}
	}
}
