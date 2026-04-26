---
phase: 3
parent: multiplayer-survival
title: Sphere-bump player-vs-player collision
created: 2026-04-25
status: implemented
---

# Phase 3 — Sphere-Bump Player Collision

## Goal

Players can ram each other. Two crystals overlapping → momentum exchange (impulse) + lateral separation. Knock a rival into a wall = they die, you survive. Boost-into-bump is the aggressive play; brake-to-let-them-overshoot is the defensive play. **Critical to multiplayer feel.**

## Carryover Context

- Phase 2 shipped: shared sim, lockstep, N players in `players[]`. Players currently pass through each other.
- All player-affecting state is in `PlayerState`. Speed is a scalar; lateral position is `x`. The bump applies an impulse on `x` (lateral knockback) and optionally a small `speed` reduction on the rammed player.

## Sprints

- [x] **Sprint 3.1 — `PlayerCollisionSystem`.** New ECS system, runs after `PlayerMovementSystem` + `SpeedModSystem`, before `CollisionSystem` (obstacles). For every pair (i, j) where both alive: check distance(players[i], players[j]) < `2 * PLAYER_RADIUS`. If overlap, compute impulse and apply.
- [x] **Sprint 3.2 — Impulse model.** Relative velocity along the contact normal (mostly lateral X for SD's geometry, but include z for boost-from-behind ram). Elastic-ish: each player gets `0.6 *` the relative velocity component as kick. Cap kick at `MAX_BUMP_KICK = 8 m/s` to prevent yeet-to-the-moon edge cases. Separate overlapping spheres by half-overlap each.
- [x] **Sprint 3.3 — Visual feedback.** Spawn small particle burst at the contact point, both players' colors mixed. Brief screen-shake for the local player if they were involved. Audio: thud + glass clink — different from obstacle hit.
- [x] **Sprint 3.4 — Rammer-credit tracking.** `PlayerState.lastRammedBy: number | null` set when player B's bump kicks player A. Cleared after 2s. If A dies within that window with `lastRammedBy === B`, credit the kill to B (used in Phase 4 results screen).
- [x] **Sprint 3.5 — Boost+bump synergy.** When a player boosts, increase their effective bump mass — they get knocked back less, the rammed player gets knocked back more. Tunable via a `bumpMassMultiplier` field; 1.0 normal, ~1.6 during boost. Makes "boost-ram" the clear aggressive play.

## Verification

- Sprint 3.1: two players collide, log shows pair check firing, separation applied.
- Sprint 3.2: ram from various angles in playtest — feel natural? No tunneling? No infinite-bounce?
- Sprint 3.3: visual + audio feedback present and not annoying.
- Sprint 3.4: ram a rival into a wall — confirm `lastRammedBy` set on death.
- Sprint 3.5: boost-ram visibly knocks rival further than normal-ram. Tommy plays + signs off on feel.

## Edge Cases (specific to this phase)

- **Three players collide simultaneously.** Pair-check iterates over ordered pairs; resolve each in sequence. Order is deterministic (`i < j`). Avoid "all-three at once" coupling — sequential pair resolution is good enough for SD's frequency of 3-way collisions (rare).
- **Bump kicks player off-track.** SD has `PLAYABLE_HALF_WIDTH` lateral bound. Existing movement system clamps; bump-applied velocity respects the same clamp. Player can be knocked into the wall via the X-clamp + obstacle position, but not off the playfield.
- **Ramming a dead player.** Check `alive` before applying impulse — corpse doesn't react, doesn't transfer impulse to the rammer. Treat dead player like a static obstacle that doesn't damage.

## Files

| File | Change |
|---|---|
| `src/systems/player-collision-system.ts` | **NEW** — pairwise sphere collision |
| `src/runtime.ts` | Wire new system between movement and obstacle-collision |
| `src/tokens.ts` | `PlayerCollisionSystemToken` |
| `src/types.ts` | Add `lastRammedBy`, `lastRammedAt` to `PlayerState` |
| `src/constants.ts` | `PLAYER_RADIUS`, `MAX_BUMP_KICK`, `BUMP_RESTITUTION` |
| `src/effects.ts` | Bump particle burst |
| `src/audio.ts` | Bump SFX |

## Acceptance for Phase Done

- [x] Two players in the same lobby can collide and bounce off each other
- [x] Boost-ram knocks the rammed player further than non-boost ram
- [x] Knock-into-wall kills register with rammer credit
- [x] No tunneling, no infinite-bounce, no off-track yeets
- [x] N=1 singleplayer determinism harness still passes (N=1 pair loop never fires)
