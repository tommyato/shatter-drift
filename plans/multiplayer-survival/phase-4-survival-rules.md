---
phase: 4
parent: multiplayer-survival
title: Survival rules + winner declaration + spectator
created: 2026-04-25
status: planned
---

# Phase 4 — Survival Rules + Winner + Spectator

## Goal

Match has explicit rules: last alive wins. Dead players become spectators (camera follows the leader, no input). Match-end shows results screen with kill credits, survival time, distance covered. Match-start countdown ("3-2-1-GO") synchronizes the dramatic moment across all peers.

## Carryover Context

- Phase 3 shipped: bump physics with rammer credit. `PlayerState.lastRammedBy` tracks who knocked a player into their death.
- The sim already has `alive: boolean` per player. Single-player dies on first hit; multiplayer reuses this.
- Lockstep guarantees all peers see the same death tick — no "who died first" reconciliation needed.

## Sprints

- [ ] **Sprint 4.1 — Match-start countdown.** After all peers send "READY" in lobby, host broadcasts `startTick = currentTick + 180` (3 seconds at 60Hz). All peers display countdown overlay synced to ticks. Sim begins ticking at `startTick`. Inputs locked during countdown.
- [ ] **Sprint 4.2 — Death broadcast (already implicit).** Death is sim state; lockstep guarantees all peers see player.alive=false on the same tick. No new network message needed. Renderer: dead player's crystal cracks + fades, name label stays visible (smaller, grayed).
- [ ] **Sprint 4.3 — Spectator camera.** When local player dies, camera transitions over 1.2s from local crystal to the *leader* (highest z among alive). Stays on leader until match end. Player can press tab/RB to cycle through alive rivals.
- [ ] **Sprint 4.4 — Winner detection.** Match ends when `players.filter(p => p.alive).length <= 1`. The single survivor (or last to die in a simultaneous wipe) wins. Don't end the match early — let final survivor's run continue if they're alive at match end (they may want to push for personal-best distance).
- [ ] **Sprint 4.5 — Results screen.** Modal at match end: WINNER (name + photo if available). Per-player row: rank, distance, kills (count of `lastRammedBy === this.playerIndex` deaths), survival time. Buttons: REMATCH (back to lobby with same peers) or LEAVE.
- [ ] **Sprint 4.6 — Rematch flow.** REMATCH resets sim, generates a new seed, all peers re-handshake start tick, countdown again. Same lobby, same peers — fast loop.

## Verification

- Sprint 4.1: countdown overlay matches across two browsers, both start sim at the same tick.
- Sprint 4.2: kill a player in playtest — visual death state correct on both peers.
- Sprint 4.3: die intentionally — camera smoothly transitions to leader. Press tab — cycles to next alive.
- Sprint 4.4: 2-player match — winner correct. Test simultaneous death (both crash same tick) → tie-break by `playerIndex` per architecture decision in README.
- Sprint 4.5: results screen renders kills + ranks correctly. Photo loads or gracefully omits.
- Sprint 4.6: rematch returns lobby intact, new seed.

## Edge Cases

- **Single survivor leaves before results screen.** Their browser closes. Other players (now all dead spectators) still see results — local-only computation.
- **All players die same tick.** Tie-break by `playerIndex`. Document this on the results screen ("tied — lowest player index wins").
- **Match runs forever (one survivor never crashes).** Cap match at, say, 10 minutes. Game-over banner: "MARATHON ENDED" — top distance wins.
- **A player rage-quits during countdown.** Treat as drop. Their crystal renders inert (drifts at zero speed). Match continues.

## Files

| File | Change |
|---|---|
| `src/multiplayer.ts` | Match lifecycle messages — `READY`, `START`, `RESULTS` |
| `src/game.ts` | Countdown overlay, spectator camera, results modal, rematch handler |
| `src/types.ts` | `MatchResult`, `PlayerScore` |
| `src/menu-navigation.ts` | Results modal scope (push/pop) |

## Acceptance for Phase Done

- [ ] 2-8 player match runs from start to winner declared
- [ ] Spectator camera works on death — smooth, can cycle
- [ ] Results screen shows accurate kills + distances
- [ ] Rematch returns to a fresh match without re-doing the lobby code dance
- [ ] Disconnects, ties, and marathon caps all handled

## Acceptance for Whole Multiplayer Plan

When Phase 4 ships, multiplayer Shatter Drift is functionally complete:
- Up to 8 players, 6-char lobby code, full mesh WebRTC
- Shared deterministic sim — all peers identical
- Sphere-bump combat — knock rivals into walls
- Last-alive wins, rematch loop, spectator camera

Stretch goals deferred to a future plan: ranked matchmaking, replay sharing of multiplayer matches, server-authoritative rollback for >8 players.
