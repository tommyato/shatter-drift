---
topic: Shatter Drift — multiplayer survival (last man standing) with sphere-bump
created: 2026-04-25
tags: [plan, shatter-drift, multiplayer, webrtc, lockstep, post-jam]
---

# Multiplayer Survival

## Overview

Real-time multiplayer Shatter Drift: 2-8 players race the same procedurally-generated obstacle stream on a shared seed. **Players can bump each other** via sphere-sphere collision — knock a rival into a wall, get knocked into one yourself. **Last alive wins.** Death is permanent within a match; spectators see the survivors finish.

This plan is **post-vibejam** (Plan 1 + Plan 2 ship for the May 1 jam; this lands after). Reason: a deterministic-lockstep multiplayer system with WebRTC mesh transport and bump physics is the kind of work that bleeds 4-8 days of bugs and risks the jam submission. Building it post-jam means we get to do it right; the jam version stays single-player with seeded ghost racing as the "online competition" surface.

The ECS refactor that already shipped is what makes this tractable. SD's sim is fully deterministic (`harness.ts:239` proves two same-seed same-action runs hash-match), input is a single int per tick, world state is a typed snapshot. That's the lockstep multiplayer data shape exactly.

## Phases

| # | Phase | Status | Hash |
|---|---|---|---|
| 1 | Lobby + WebRTC mesh transport | Planned | — |
| 2 | Shared deterministic sim with N player entities | Planned | — |
| 3 | Sphere-bump player-vs-player collision | Planned | — |
| 4 | Survival rules + winner declaration + spectator | Planned | — |

## Research Context

- **SD's sim is already lockstep-ready.** `simulation.ts` `step(action: number)` accepts a single int per tick. `runtime.ts` is fully DI'd. `harness.ts:33` already runs deterministic replays with hash checks. The architecture cost of multiplayer is paid; this plan harvests it.
- **CC has the reference implementation.** `gamedevjs-2026-entry/src/multiplayer.ts` + `remote-ghosts.ts` already do WebRTC mesh + state broadcast + remote-player rendering. Read these first; crib the lobby UI, the WebRTC negotiation, the input-frame format. Don't re-invent.
- **Player entity in SD is implicit.** `SimulationState.playerX` is a single scalar — there is no "player array." Phase 2 must refactor `SimulationWorld` to carry `players: PlayerState[]` and refactor `PlayerMovementSystem` + `CollisionSystem` to iterate. This is the largest single change in the plan.
- **CollisionSystem is obstacle-vs-player today.** `systems/collision-system.ts` checks player against obstacles. Phase 3 adds player-vs-player as a separate pass — keep them decoupled.
- **Server.** This is mesh (peer-to-peer) — no authoritative server. CC's signaling server (Firebase realtime DB) hosts lobby + initial WebRTC SDP exchange only. Reuse it; don't stand up a new service.

## Architecture Decisions

- **Lockstep, not client-side prediction.** SD's tick rate (60Hz) is achievable over WebRTC for ≤8 players. Lockstep means: each peer broadcasts their action int every tick; a tick is computed only when all peers' inputs for that tick have arrived (or a timeout drops a peer). Determinism guarantees identical state on every machine. No reconciliation, no rollback, no server.
  - Trade-off: input latency = max(peer RTT) / 2. Acceptable for a racing-survival game where reactions are at obstacle scale (~200ms windows). Unacceptable for fighting games — but this isn't one.
- **Mesh, not star.** Up to 8 peers means 28 connections at full mesh — fine. Star (one peer is "host") is a single point of failure and host-migration is a tar pit. CC chose mesh; mirror.
- **Input buffer + lockstep delay.** 3-frame input delay (50ms at 60Hz) hides typical local-network jitter. Each peer broadcasts action for tick N+3 at tick N. Smooth.
- **Bump physics: impulse exchange, not penetration solving.** When two player spheres overlap, compute relative velocity, exchange momentum (elastic-ish), separate. No penetration depth tracking, no continuous collision detection — sim ticks are short enough that tunneling through another player at SD's speeds is not a real risk.
- **Death is sim state, not network state.** A dead player remains in the sim (their PlayerState has `alive: false`); they just don't move. Spectator view = camera follows nearest survivor.
- **No matchmaking — invite codes.** Generate a 6-char lobby code. Share via clipboard. Vibejam-aesthetic, ships in a day, beats "elo + queue" by every metric.

## Edge Cases

- **Peer drops mid-game.** Drop their action stream; their player becomes inert (drifts at last velocity, dies on next obstacle). Continue the match — don't pause for disconnects.
- **Lobby host (the one who created the code) leaves before match start.** Anyone can be the "host" for signaling — just whoever created the code. If they leave, code dies. Players in the lobby get kicked. Ugly but acceptable for v1.
- **Two players spawn-collide.** Spawn positions on the start grid are pre-assigned by player index — no overlap by construction.
- **Player A boosts into B from behind, both die in same tick.** Tie-break: whoever has the lower `playerIndex` wins. Deterministic, dumb, fine.
- **Different versions of the game in the same lobby.** Embed a build hash in the lobby join handshake; reject mismatches. Otherwise determinism breaks subtly and games desync mid-match.
- **A player has a much faster local clock than another.** Lockstep prevents drift — sim only advances when all inputs received.

## Sprints

See per-phase files:

- [`phase-1-lobby-transport.md`](./phase-1-lobby-transport.md) — WebRTC mesh + lobby UI. Codebase remains runnable as singleplayer; lobby is an opt-in panel.
- [`phase-2-shared-sim.md`](./phase-2-shared-sim.md) — Refactor `SimulationWorld` to N player entities; render remote players. Codebase still runs singleplayer (N=1 is the default).
- [`phase-3-sphere-bump.md`](./phase-3-sphere-bump.md) — New `PlayerCollisionSystem` for sphere-sphere bump. No-op when N=1.
- [`phase-4-survival-rules.md`](./phase-4-survival-rules.md) — Death broadcast, last-survivor wins, spectator camera, results screen.

## Files Created / Modified (high level)

| Area | Change |
|---|---|
| `src/multiplayer.ts` | **NEW** — lobby + WebRTC mesh + signaling client |
| `src/sim-world.ts` | Refactor to `players: PlayerState[]` |
| `src/systems/player-movement-system.ts` | Iterate over players |
| `src/systems/collision-system.ts` | Iterate over players |
| `src/systems/player-collision-system.ts` | **NEW** — sphere-bump |
| `src/runtime.ts` | New token + system wiring |
| `src/game.ts` | Lobby panel UI; remote player rendering; spectator camera |
| `src/types.ts` | `PlayerState`, multiplayer config, lobby messages |

## Estimated Effort

13-21 SP across 4 phases. Phase 2 is the big one (player-array refactor). Phase 1 is the most parallel-ready (lobby UI can develop while sim refactor lands). Phases 3 + 4 are smaller — each ~3-5 SP.

## Vibejam Note

This is **post-jam work**. Vibejam deadline is 2026-05-01. Do not start this plan before May 2 unless we hit Plan 1 + Plan 2 with multiple days of buffer. The cost of an undercooked multiplayer in the jam submission > the value of having multiplayer at all. Singleplayer SD with seeded ghost racing is the jam version.
