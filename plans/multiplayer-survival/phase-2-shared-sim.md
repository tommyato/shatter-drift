---
phase: 2
parent: multiplayer-survival
title: Shared deterministic sim with N player entities (headless building blocks)
created: 2026-04-25
updated: 2026-04-26
status: shipped-partial
shipped_hashes: [5831df0, 6b6bd5a]
follow_up: phase-2-5-live-world-integration.md
---

# Phase 2 — Shared Sim with N Player Entities

## Goal

Refactor `SimulationWorld` to carry an array of `PlayerState` instead of a single implicit player. The sim runs lockstep across all peers — same seed, same ordered action frames per tick, identical state on every machine. Remote players are rendered as full SD crystals (same mesh as ghosts, but solid + colored per player, with name labels). At end of phase, two browsers in the same lobby can race together — but they pass through each other (Phase 3 adds collision).

## Carryover Context

- Phase 1 shipped: lobby + WebRTC + `InputFrame` transport. Frames flow but sim ignores them.
- The existing single-player path uses `world.playerX`, `world.playerZ`, `world.speed`, etc. as scalars on `SimulationState`. This phase moves them to `world.players[i]`.
- Lockstep delay: 3 ticks. Each peer broadcasts action for tick `currentTick + 3`. Sim only advances tick `T` when all peers' action for `T` has arrived (or peer has been marked dropped).

## Status (2026-04-26)

Worker `089c8660` (claude-code, opus-4-7) shipped the headless half of this phase: 15 files changed, +970/-242, 19/19 harness tests pass including determinism (FNV-1a hash match). SP code path bit-identical. Branch `feat/sd-mp-phase-2-shared-sim` opened as PR #1, **not merged to main** — waiting for Phase 2.5 (live world integration) so that MP actually plays in the browser before main absorbs the change.

The worker correctly used the plan's escape hatch when it discovered `game.ts` does not drive the headless `SimulationWorld` — that integration is now Phase 2.5 ([`phase-2-5-live-world-integration.md`](./phase-2-5-live-world-integration.md)).

## Sprints

- [x] **Sprint 2.1 — `PlayerState` extraction.** **SHIPPED** `5831df0`. Three fields added beyond the verbatim spec (`speedMod`, `score`, `lastCloseCallZ`) — per-player correctness required them; the system refactor implied they were per-player. Define `PlayerState { x, z, speed, alive, shattered, phaseEnergy, phaseLocked, phaseCooldown, phaseMinTimer, boostCooldown, brakeCooldown, boostTimer, brakeTimer, playerIndex, name, color }`. Move all per-player fields off `SimulationState` into `players: PlayerState[]`. Add `localPlayerIndex` to `SimulationConfig`.
- [x] **Sprint 2.2 — System refactor.** **SHIPPED** `5831df0`. `PlayerMovementSystem`, `ShatterSystem`, `CollisionSystem`, `SpeedModSystem`, plus also `OrbSystem`, `RiftFlipSystem`, `ObstacleDespawnSystem`, `ObstacleSpawnSystem`, `WorldScrollSystem` — all iterate `players[]`. Determinism harness 19/19 green.
- [x] **Sprint 2.3 — Camera and world scroll anchor.** **SHIPPED (headless half)** `5831df0`. `world.getState()` returns a `GameSnapshot` for the local `playerIndex` — anchor-by-local-player is correct in the headless sim. Live-renderer camera anchor wiring lands in Phase 2.5.
- [x] **Sprint 2.4 — Lockstep runner.** **SHIPPED** `6b6bd5a`. `LockstepRunner` exported from `src/multiplayer.ts:797`. Drains `MeshTransport`'s queue, advances when all peers have submitted frame for tick `T`, 2s peer-drop timeout fills `action=0`.
- [x] **Sprint 2.5 — Remote player rendering (factory).** **SHIPPED (factory only)** `6b6bd5a`. `createRemotePlayer`, `updateRemotePlayer`, `disposeRemotePlayer`, `pickPlayerColor` exported from `src/multiplayer.ts`. Wiring into `game.ts`'s render loop is Phase 2.5.
- [x] **Sprint 2.6 — Match start handshake.** **SHIPPED** `6b6bd5a`. `MatchStartCoordinator` exported from `src/multiplayer.ts:960`. Lowest-connection-ID peer generates seed, broadcasts, waits for acks, fires `onMatchStart` callback. Game-loop integration is Phase 2.5.

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

- [x] N=1 singleplayer determinism harness passes (no regressions) — 19/19 green
- [ ] Two browsers in a lobby start a synced match — same world, different cameras → **moved to Phase 2.5**
- [ ] Players can pass through each other (no collision yet — Phase 3) → **moved to Phase 2.5**
- [x] Disconnect handling: dead peer → inert player, match continues — `LockstepRunner` 2s timeout + action=0 fill landed
