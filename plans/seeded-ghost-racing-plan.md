---
topic: Shatter Drift — seeded ghost racing
created: 2026-04-25
tags: [plan, shatter-drift, ghost, leaderboard, vibejam]
---

# Seeded Ghost Racing

## Overview

Ghost racing in Shatter Drift currently records the player's `(x, z, speed, shattered)` trace at 10Hz and replays it as a wireframe icosahedron alongside a fresh run. Problem: normal-mode runs use `Math.random` for world/powerups/speedGates/worldEvents/bossWaves, so a ghost's recording exists in a *different* obstacle layout than the racing player's. The ghost may thread through walls or skip orbs the live player has to navigate. Today's "ghost" is a position trace, not a race.

This plan makes ghost racing identical to Clockwork Climb: capture the run's seed, replay the ghost in *its own* world. Player runs the same seed, sees the same obstacle layout the ghost saw, and races a real performance — not a position scribble.

Ships a "Race This Ghost" entry point from the leaderboard: tap a leaderboard entry → next run uses that entry's seed + loads only that ghost. Same-seed identity is the foundation multiplayer also needs (Plan 3) — landing this first de-risks the larger system.

## Research Context

- **Seed plumbing already exists end-to-end.** `runtime.ts:42-45` accepts `config.seed` → `mulberry32`. `simulation.ts:13` passes seed through to `createRuntime`. `game.ts:1172-1183` applies `seededRandom(baseSeed)` to all 5 subsystems for daily mode; normal mode currently passes `Math.random`. The plumbing exists — we're filling in the normal-mode seed instead of leaving it implicit.
- **GhostRecorder is seed-agnostic today.** `ghost.ts:36-77` records frames with no run identity. Adding `seed` to `GhostRecord` is purely additive — the playback path doesn't care.
- **Server contract.** `leaderboard.ts:126` `fetchGhosts(limit=3)`, `leaderboard.ts:140` `submitGhost`. Both need a `seed` field through the wire format. Server: `ghosts-server` (separate repo, Firebase-backed — see `/Users/tommyato/Documents/projects/superhq/projects/ghosts-server/`).
- **CC reference.** `gamedevjs-2026-entry/src/ghost-recorder.ts` + `ghost-playback.ts` already do seed-bound ghost racing — read their schema before deciding the wire format.

## Architecture Decisions

- **Single source of seed: `Game.runSeed`.** Set once in `startGame()`. Used to construct all 5 `seededRandom` instances *and* recorded into the ghost upload payload. Same number on both sides. No drift.
- **Normal mode seed = `Math.floor(Math.random() * 0xffffffff)` at run-start.** Daily mode keeps `parseInt(this.dailyDateKey, 10)` (unchanged).
- **Backwards compat: ghosts without seeds are still raceable, but degrade.** The server has historical ghosts uploaded before this plan. Treat missing `seed` as "render-only" — show their trace in the current world, no claim of a fair race. Don't delete or migrate; let them age out.
- **"Race This Ghost" UX is a leaderboard click → restart with seed + filtered ghost set.** Don't build a new screen. Reuse existing leaderboard list; add a "RACE" button per row. Click sets pending-seed + pending-ghost-id, calls `startGame()`, the existing flow handles the rest.
- **Server schema bump is additive, not breaking.** Add `seed: number?` column. Old clients keep working; new clients populate; old records remain readable.

## Edge Cases

- **Seed 0.** `mulberry32` doesn't break on 0 but produces a degenerate sequence. Reroll if `Math.random()` produces a seed of 0 — cheap guard.
- **Daily-mode ghosts already have a seed implicit (the date).** Don't double-write. Daily ghosts already race fair because everyone gets the same date seed. This plan changes nothing for daily.
- **Race-this-ghost when the ghost's seed is missing.** Disable the RACE button on rows where the server reports no seed.
- **Ghost upload threshold.** `fetchGhostUploadThreshold` currently gates uploads to top scores. Don't change the threshold logic — just add `seed` to the payload that gets sent.

## Sprints

- [ ] **Sprint 1 — wire format.** Add `seed: number` to `GhostFrame` *no, to `GhostRecord`* in `ghost.ts:26`. Update `submitGhost` payload type in `leaderboard.ts:140`. Update `fetchGhosts` response type. Server: add `seed` field to ghost document write/read. Verify a manual upload + fetch round-trips.
- [ ] **Sprint 2 — capture and apply seed in normal mode.** Generate `runSeed` in `startGame()`. Use it in the `else` branch of `game.ts:1178-1183` (normal mode) instead of `Math.random`. Pass into `submitGhost` call (`game.ts:2813`). Verify two runs with the same seed produce identical worlds (paste seed into URL, reload, identical obstacle pattern).
- [ ] **Sprint 3 — Race This Ghost UX.** Add per-row RACE button to the leaderboard panel. Click handler sets `pendingRaceSeed` + `pendingRaceGhostId` on `Game`, calls existing start flow. In `loadGhostsAsync`, when pending values are set, fetch only that ghost (or filter the cached ghosts) and use the pending seed instead of generating a new one. Verify the click → restart works and the world matches.
- [ ] **Sprint 4 — visual confirmation.** Add a small chip near the HUD showing "Racing: SHIPMATE-FOX-42" when a specific ghost was selected. Disambiguates "I'm in a chase" from "I died and started over." Hide chip on plain runs.
- [ ] **Sprint 5 — seed surfacing for sharing.** Add the seed to the X-share message format (`"I scored 0 climbing 0m..."` style — see CC's sharing path). "I beat SHIPMATE-FOX-42 on seed #1234567 in Shatter Drift!" Optional but cheap and drives jam-style sharing.

## Verification Strategy

- **Sprint 1:** manual round-trip — `submitGhost({ seed: 12345, ... })` then `fetchGhosts()`, confirm `seed` field present.
- **Sprint 2:** load `?seed=42` twice, see identical first 5 obstacles. Determinism check via `harness.ts` `determinism-check` script.
- **Sprint 3:** click leaderboard row, watch network tab, confirm only the targeted ghost loads. Run finishes, ghost finishes, fade burst plays.
- **Sprint 4:** manual screenshot of HUD with chip visible.
- **Sprint 5:** hit share button, paste output, verify seed encoded.

## Files to Modify

| File | Change |
|---|---|
| `src/ghost.ts` | Add `seed: number` to `GhostRecord` |
| `src/leaderboard.ts` | Add `seed` to submit/fetch wire format |
| `src/game.ts` | Generate + apply `runSeed`; thread into submit + race flow |
| `src/types.ts` | Already has `seed?: number` on `SimulationConfig` — no change |
| `ghosts-server/` (separate repo) | Add `seed` field to ghost document schema |
| Leaderboard panel HTML/handlers (in `game.ts` UI section) | RACE button per row |

## Estimated Effort

3-5 SP. Single-file changes plus one column on the ghost server. Sprint 1 + 2 land the core; 3 is the UX; 4-5 are polish that pay disproportionate dividends for jam visibility.
