---
phase: 2.5
parent: multiplayer-survival
title: Live world integration — bridge headless SimulationWorld ↔ live World/game.ts
created: 2026-04-26
status: planned
---

# Phase 2.5 — Live World Integration

## Goal

Wire the Phase 2 building blocks (`LockstepRunner`, `MatchStartCoordinator`, `players[]`-aware systems, `RemotePlayer` factory — all on `feat/sd-mp-phase-2-shared-sim`) into the live game loop in `game.ts`. After this phase, **two browsers in the same lobby actually play a synchronized round** — same obstacles, same physics, players visible to each other (still passing through; collision is Phase 3). Singleplayer remains bit-identical.

This phase exists because Phase 2 surfaced an architectural reality the original plan didn't capture: `game.ts` does **not** drive the headless `SimulationWorld`. It drives a separate live `World` (`src/world.ts`, 1518 lines) with its own obstacle spawner, RNG, and update loop. Phase 2 shipped the headless sim infrastructure; this phase makes the live game consume it in MP mode.

## Carryover Context

- **Phase 2 building blocks live on `feat/sd-mp-phase-2-shared-sim`** (PR #1, two commits: `5831df0` headless refactor, `6b6bd5a` runner + match coordinator + RemotePlayer). Branch is gated behind a flag and inert against `main`. Merge to main is blocked until this phase ships and we have an end-to-end MP smoke pass.
- **Headless `SimulationWorld` (`src/sim-world.ts`, 312 lines)** now carries `players: PlayerState[]`, drives systems via DI, and `world.getState()` returns a `GameSnapshot` per local player. Determinism harness 19/19 green.
- **Live `World` (`src/world.ts`, 1518 lines)** owns: obstacle spawning, portals, boss waves, speed gates, powerups, world events, biomes, post-FX. The deterministic-sim half of these (obstacles, basic player movement, collisions, orbs) is also in the headless sim. The visual/feature-rich half (portals/bosses/gates/events) is **not** in the headless sim, and won't be for v1 MP — those are SP-only features.
- **`World` already has a seeded-RNG hook** (`this.random: () => number = Math.random` at `src/world.ts:266`) — designed for the daily-challenge code path. Reuse it for MP: same lobby seed → identical obstacle layout on every peer. This is the single most important piece of pre-existing leverage.
- **No `MULTIPLAYER_ENABLED` const exists yet** despite the README references — Phase 1 didn't land it. This phase introduces it (`src/config.ts`).
- **Lobby UI from Phase 1 exists** — `LobbyClient` + `MeshTransport` (`src/multiplayer.ts`). What's missing is the *transition* from lobby → in-match in `game.ts`.

## Architecture Decisions

### 1. Hybrid headless-authoritative / live-renderer architecture

In MP mode, the **headless `SimulationWorld` is the source of truth for gameplay state** (obstacle positions, player positions, collisions, scoring). The **live `World` becomes a renderer that mirrors the sim's authoritative state** rather than running its own gameplay loop.

```
SP mode  : game.ts → World.update(dt, playerZ, ...)        ← unchanged, bit-identical
MP mode  : game.ts → LockstepRunner.tryAdvance() → SimulationWorld.step(actions[])
                  → World.renderFromSimState(simWorld.getState()) ← NEW: visual-only
```

Why this beats the two paths the Phase 2 worker outlined:

- **Path A** ("route World's spawn pipeline through SimulationWorld") muddles ownership — both worlds spawn obstacles, you have to deduplicate.
- **Path B** ("rebuild World as a thin renderer over SimulationState") is correct in spirit but the worker called it "invasive" because it implied porting portals/boss-waves/speed-gates/powerups to the headless sim. **The hybrid skips that work entirely**: in MP mode, those SP-only features are simply disabled. MP v1 is the deterministic core (obstacles + player movement + orbs + shatter); SP keeps its full feature set.
- **Net surgical area**: a mode switch in `World.update()` that, in MP, suppresses spawn-side logic and accepts an external authoritative state instead. The visual-only systems (post-FX, particles, biomes, skybox, plasma trail) keep running unchanged in both modes.

### 2. Lockstep tick drives sim; render frame drives visuals

Lockstep `tryAdvance` runs at sim-tick cadence (60Hz when frames are flowing). Visual `requestAnimationFrame` keeps running independently for smooth post-FX, particle decay, camera lerp. The bridge from sim → render is: after each successful `simWorld.step()`, copy authoritative state into live World's render-side fields (`World.obstaclesAhead`, player meshes, etc.).

### 3. Camera anchor: local player

Per Phase 2 plan — each peer's render camera tracks `players[localPlayerIndex]`. World scroll is driven by the same anchor (your own player's Z). Rivals appear ahead/behind based on their relative Z. No "follow leader" mode in v1.

### 4. Match-state machine in game.ts

A small explicit state machine: `idle` → `inLobby` → `inMatch` → `matchOver` → back to `idle`. Currently game.ts implicitly assumes "always in SP play mode." The state machine is what the lobby UI and MatchStartCoordinator hook into.

### 5. Singleplayer code path stays untouched

Every change is gated by `if (matchState === 'inMatch' && MULTIPLAYER_ENABLED)`. SP is the negation branch and runs the existing code unmodified. Determinism harness exercises only the SP path; it must remain 19/19 green throughout.

## Edge Cases

- **Lobby seed mismatch.** Match-start handshake (already in `MatchStartCoordinator`) broadcasts the seed; every peer constructs its `World` and `SimulationWorld` with the same seed. Peers without seed cannot start.
- **Sim ticks behind render frames.** Lockstep can stall if a peer drops a frame. Render keeps drawing the last-known state; players see a brief freeze, not corruption. Same handling Phase 2 already wired into `LockstepRunner` (2s peer-drop timeout → action=0 fill).
- **Local player input timing.** Local player presses arrow → input is queued for tick `currentTick + 3` (3-frame lockstep delay from Phase 2 plan). Visual feedback for own input lags by the delay; this is the standard lockstep tradeoff and is acceptable for SD's reaction window (~200ms).
- **Player Z divergence at match start.** All players start at the same Z (the headless sim spawns them on a grid). Match-start blocks rendering until first authoritative tick lands, so no peer sees their player at a stale position.
- **Mid-match peer leaves.** `LockstepRunner` already handles this — peer marked dropped, action=0 from then on. Live render: their `RemotePlayer` mesh stops moving but stays visible (becomes a drifting hazard until they hit something).
- **Browser tab background-throttles.** Chrome aggressively slows requestAnimationFrame on hidden tabs. Lockstep handles this (frames buffered in `MeshTransport`); when the tab returns, `tryAdvance` catches up. Verify by hiding one of the host-Chrome tabs during the smoke test.
- **SP players in the same browser session as MP.** Player plays SP, returns to title, joins MP. State machine resets cleanly: `World.reset()` is called on every `idle → ...` entry; `SimulationWorld` is constructed fresh per match.

## Sprints

- [ ] **Sprint 2.5.1 — `MULTIPLAYER_ENABLED` config + match-state machine.** Create `src/config.ts` exporting `MULTIPLAYER_ENABLED` (default `false` for jam build). Add `?mp=1` URL flag override. Add `matchState: 'idle' | 'inLobby' | 'inMatch' | 'matchOver'` to game.ts with explicit transition methods. SP path: state stays at `idle` forever, all existing logic untouched.
- [ ] **Sprint 2.5.2 — Lobby → match wiring.** Title screen gets a `MULTIPLAYER` button (visible only when `MULTIPLAYER_ENABLED`). Click → instantiate `LobbyClient` + `MeshTransport` + render lobby panel (CC's lobby panel is the visual reference; CC code is at `gamedevjs-2026-entry/src/multiplayer.ts`). Lobby panel hosts: invite code display, peer list, READY button. READY → `MatchStartCoordinator` → on `onMatchStart`, transition `inLobby → inMatch` and construct `SimulationWorld` + `LockstepRunner` with the negotiated seed.
- [ ] **Sprint 2.5.3 — `World` renderer mode.** Add `World.setRenderMode('sp' | 'mp-renderer')`. In `'mp-renderer'`, the spawn-side logic in `World.update()` (the `while (this.nextObstacleZ < playerZ + SPAWN_DISTANCE)` loop and portal/gate/boss/event spawning) is **suppressed**. Visual-only systems continue. Add `World.applyAuthoritativeState(state: GameSnapshot)` that synchronizes the live mesh pool with the authoritative obstacle list from the headless sim.
- [ ] **Sprint 2.5.4 — Sim-tick driver in game.ts main loop.** When `matchState === 'inMatch'`: each render frame, call `lockstepRunner.tryAdvance()` which may step the sim 0–N times; after each step, call `world.applyAuthoritativeState(simWorld.getState())` and update local + remote player meshes from `simWorld.players[]`. SP path unchanged: `world.update(dt, playerZ, playerX, speed, isPhasing)` runs as today.
- [ ] **Sprint 2.5.5 — Remote player rendering wiring.** Phase 2 already shipped `createRemotePlayer` / `updateRemotePlayer` / `disposeRemotePlayer`. This sprint instantiates one per non-local entry in `players[]` at match start, calls `updateRemotePlayer` each render frame from `simWorld.players[i]`, disposes on match-over. Name labels positioned above each remote crystal.
- [ ] **Sprint 2.5.6 — Camera anchor in MP mode.** Camera follows `simWorld.players[localPlayerIndex]` in MP (using existing `world.camera` lerp logic). Verify SP camera path unchanged with the determinism harness.
- [ ] **Sprint 2.5.7 — Match-over → return to title.** When all-but-one player dies (Phase 4 will own the survival rule; for this phase, end-on-local-death is acceptable), transition `inMatch → matchOver`. Show "match ended" overlay. Click → `matchOver → idle`, `World.reset()`, dispose remote players, dispose `SimulationWorld` + `LockstepRunner`. Returning to title is bit-identical to a fresh page load.
- [ ] **Sprint 2.5.8 — End-to-end smoke + determinism check.** Two host-Chrome tabs at `tommyato.com/games/shatter-drift?mp=1`, one creates a lobby, the other joins via code, both READY, match starts. Both peers play 30 seconds of synchronized obstacles. Implement a debug `?mp=1&hash=1` flag that snapshots `simWorld.getState()` to console every 60 ticks; the hash from both browsers must match. Tab-hide one browser briefly to exercise the throttle path.

## Verification Strategy

| Sprint | Verification |
|---|---|
| 2.5.1 | `npm run build` clean. SP path unchanged in browser smoke test. |
| 2.5.2 | Two host-Chrome tabs reach the lobby panel, exchange a test message via existing Phase 1 transport, see each other in peer list. |
| 2.5.3 | `npm run determinism` still 19/19 green (proves SP code path bit-identical). MP-renderer mode set in isolation: world renders no obstacles (because no authoritative state injected yet), visual systems still run. |
| 2.5.4 | Single-browser MP solo: lobby of 1, start a match, sim ticks via lockstep with no remote peers, obstacles render from authoritative state, player can play. |
| 2.5.5 | Two-browser MP: each peer sees the other's crystal moving. Visible name label above. |
| 2.5.6 | SP camera regression test (determinism harness includes camera-relative checks already). MP camera tracks own player — verified visually. |
| 2.5.7 | Match-over transition: no leaked WebGL resources (DevTools memory diff before/after match). Return to title returns to a clean SP world. |
| 2.5.8 | The debug-hash output from both browsers matches every 60 ticks for 30 seconds (1800 ticks total, 30 hash samples). Tab-hide-then-show recovers without desync. |

## Files Created / Modified

| File | Change |
|---|---|
| `src/config.ts` | **NEW** — `MULTIPLAYER_ENABLED` const, URL-flag parsing |
| `src/world.ts` | Add `setRenderMode`, `applyAuthoritativeState`; gate spawn-side logic on render mode |
| `src/game.ts` | Match-state machine, lobby wiring, sim-tick driver, MP camera path, remote-player lifecycle, match-over flow |
| `src/multiplayer.ts` | (no change expected — Phase 2's exports cover everything; if a missing hook surfaces, add minimally) |
| `src/types.ts` | (likely no change — `MatchState` may live in game.ts since it's UI-state, not sim-state) |

## Estimated Effort

8–13 SP. The bulk is `game.ts` surgery (Sprint 2.5.4 — sim-tick driver — is the largest single change) and the end-to-end smoke (2.5.8). Sprint 2.5.3 (`World.applyAuthoritativeState`) is medium because the live mesh pool's reconciliation logic needs care to avoid leaking obstacle meshes. Everything else is wiring.

## Acceptance for Phase Done

- [ ] `npm run determinism` 19/19 green throughout (proves SP regression-free).
- [ ] Two host-Chrome browsers reach an in-match state via lobby code, play 30s of synchronized obstacles.
- [ ] Debug hash from both peers matches every 60 ticks.
- [ ] Players visible to each other (passing through is fine — Phase 3 adds collision).
- [ ] Match-over returns cleanly to title; subsequent SP play unchanged.
- [ ] One peer hidden-tabs mid-match → returns → no desync, no crash.
- [ ] PR opened against `main` (not auto-merged) with the smoke-test capture in the description.

## Out of Scope (deliberate)

- **Player-vs-player collision** — Phase 3.
- **Death/survival rules** — Phase 4.
- **MP versions of portals, boss waves, speed gates, powerups beyond orbs, world events** — these are SP-only for v1. Adding them to the headless sim is a future "MP feature parity" effort, not a vibejam blocker.
- **Matchmaking, ELO, queues** — invite-code only, per parent plan.
- **Spectator mode after local death** — Phase 4 will own this.

## Vibejam Sequencing Impact

Original plan slotted Phase 2 for Apr 28–29. Phase 2's headless half landed Apr 26 (early). This Phase 2.5 slots into Apr 27–28 and absorbs the original Phase 2's "make it actually playable" expectation. Phase 3 (sphere bump) and Phase 4 (survival rules) keep their original Apr 29 / Apr 30 AM slots. **The Apr 30 PM GO/NO-GO call on `MULTIPLAYER_ENABLED` is unchanged.**

If 2.5.8's two-browser smoke test fails by Apr 29 evening, we ship `MULTIPLAYER_ENABLED=false` for the jam and merge the work post-jam. The hide-if-broken gate handles this without touching the SP build.
