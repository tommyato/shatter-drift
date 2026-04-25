---
phase: 2
parent: multiplayer-survival
title: Shared deterministic sim with N player entities
created: 2026-04-25
status: planned
---

# Phase 2 — Shared Sim with N Player Entities

## Goal

Refactor `SimulationWorld` to carry an array of `PlayerState` instead of a single implicit player. The sim runs lockstep across all peers — same seed, same ordered action frames per tick, identical state on every machine. Remote players are rendered as full SD crystals (same mesh as ghosts, but solid + colored per player, with name labels). At end of phase, two browsers in the same lobby can race together — but they pass through each other (Phase 3 adds collision).

## Carryover Context

- Phase 1 shipped: lobby + WebRTC + `InputFrame` transport. Frames flow but sim ignores them.
- The existing single-player path uses `world.playerX`, `world.playerZ`, `world.speed`, etc. as scalars on `SimulationState`. This phase moves them to `world.players[i]`.
- Lockstep delay: 3 ticks. Each peer broadcasts action for tick `currentTick + 3`. Sim only advances tick `T` when all peers' action for `T` has arrived (or peer has been marked dropped).

## Sprints

- [ ] **Sprint 2.1 — `PlayerState` extraction.** Define `PlayerState { x, z, speed, alive, shattered, phaseEnergy, phaseLocked, phaseCooldown, phaseMinTimer, boostCooldown, brakeCooldown, boostTimer, brakeTimer, playerIndex, name, color }`. Move all per-player fields off `SimulationState` into `players: PlayerState[]`. Add `localPlayerIndex` to `SimulationConfig`.
- [ ] **Sprint 2.2 — System refactor.** `PlayerMovementSystem`, `ShatterSystem`, `CollisionSystem`, and `SpeedModSystem` (from Plan 2) all iterate `players[]`. Obstacles remain shared. World scroll is driven by the *fastest live player* (camera-anchor decision below). Verify singleplayer (N=1) still passes determinism harness.
- [ ] **Sprint 2.3 — Camera and world scroll anchor.** SD's world scrolls toward the player. With N players, choose: anchor on **local player**. World physics (obstacles) are shared, but each peer's *render camera* tracks their own player. Players see their own ship centered; rivals appear ahead/behind based on relative `z`.
- [ ] **Sprint 2.4 — Lockstep runner.** New `LockstepRunner` wraps `simulation.step`. Polls the input-frame queue from `MeshTransport`. Advances sim only when frame for tick `T` is available from every peer. Times out a peer after 2s of missing frames → marks dropped, fills with `action=0`.
- [ ] **Sprint 2.5 — Remote player rendering.** Each remote player gets a `THREE.Mesh` (icosahedron, solid, player-color tint). Position from `players[i]`. Name sprite above. Mirror the ghost rendering pattern but with full opacity + collision-eligible.
- [ ] **Sprint 2.6 — Match start handshake.** All peers in the lobby agree on `seed`, `localPlayerIndex` assignments, and `startTick`. One peer (lowest connection ID, deterministic) generates seed; broadcasts. Wait for ack from all peers. Start sim.

## Verification

- Sprint 2.1-2.2: `npm run determinism` passes — two N=1 runs same seed + actions hash-match.
- Sprint 2.3: solo play — camera tracks correctly, no regression.
- Sprint 2.4: kill a peer's connection mid-game (close tab); verify other peer continues, rival becomes inert.
- Sprint 2.5: two peers in the same lobby see each other's crystal moving, with name labels.
- Sprint 2.6: two browsers click "READY," world starts identical on both; obstacle pattern matches.

## Files

| File | Change |
|---|---|
| `src/types.ts` | `PlayerState`, `MultiplayerConfig`, `MatchStartMessage` |
| `src/sim-world.ts` | Refactor `SimulationState` — `players: PlayerState[]` |
| `src/systems/player-movement-system.ts` | Iterate players |
| `src/systems/shatter-system.ts` | Iterate players |
| `src/systems/collision-system.ts` | Iterate players |
| `src/systems/speed-mod-system.ts` | Iterate players |
| `src/multiplayer.ts` | Add `LockstepRunner`, match-start handshake |
| `src/game.ts` | Remote player meshes + match-start flow |

## Acceptance for Phase Done

- [ ] N=1 singleplayer determinism harness passes (no regressions)
- [ ] Two browsers in a lobby start a synced match — same world, different cameras
- [ ] Players can pass through each other (no collision yet — Phase 3)
- [ ] Disconnect handling: dead peer → inert player, match continues
