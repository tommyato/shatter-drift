---
topic: Shatter Drift — boost, brake, and gamepad input
created: 2026-04-25
tags: [plan, shatter-drift, input, gamepad, vibejam]
---

# Boost + Brake + Gamepad Support

## Overview

Shatter Drift's speed ramps continuously with distance — by minute 3 the player is on rails, reacting only laterally. Adding modulated boost (faster) and brake (slower), each with cooldown, gives the player agency over the speed curve without flattening difficulty: **the modulation is multiplicative on the current base speed**, so it stays meaningful at every tier. Pairs naturally with multiplayer (Plan 3) where speed manipulation = positional combat: brake to let a rival overshoot, boost to ram them.

Gamepad ships in this plan because boost/brake *want* analog triggers (LT/RT) — they're the same feature surface. Plus, gamepad support is a vibejam table-stakes polish item the judges will check.

## Research Context

- **Action int is already the input contract.** `input/agent-input.ts:3-10` maps action numbers `0-5` to `{ horizontal, shatter }` state. The action int is what gets recorded for ghost playback and what gets broadcast over the wire in multiplayer. Extending the action enum is the right place to add boost/brake — keeps determinism + RL + ghost replay coherent.
- **Speed lives in `SimulationState.speed`** (`sim-world.ts:33`). Modulating it goes in `PlayerMovementSystem` or a new `SpeedModSystem` ordered after movement, before collision.
- **Phase meter precedent.** `phaseMeter` (`game.ts:332`) is already a 0-100 resource with recharge logic — boost/brake cooldown rings can mirror its HUD pattern.
- **No keyboard module exists yet.** SD's input is `agent-input.ts` for the sim layer; the rendering layer reads keyboard via `game.ts` directly. This plan adds a unified browser-input shim that maps keyboard + gamepad → action int.
- **Gamepad pattern to crib.** `gamedevjs-2026-entry/src/input.ts` has the `gamepad.buttons[i].pressed` polling pattern + frame-edge detection (`prevGamepadButtons`). Same approach.

## Architecture Decisions

- **Action int expansion: bit-flag, not enum balloon.** Currently `0-5` (6 states). Adding boost/brake naively → 24 states. Instead use bits: `[bit3=brake][bit2=boost][bit1=shatter][bit0_1=horizontal]`. Decode in `agent-input.ts` to the existing `SimulationInputState` plus new `boost: boolean`, `brake: boolean`. Compact, infinitely extensible.
- **Cooldown lives in `SimulationState`, not in the renderer.** Determinism rule: every gameplay-affecting timer must be in the sim. `boostCooldown: number` and `brakeCooldown: number` get added to `SimulationState`, ticked in the speed-mod system. HUD reads them.
- **Effect: multiplicative, eased.** `targetSpeed = baseSpeed(t) * 1.4` for boost, `* 0.65` for brake. Lerp toward target over ~150ms in/out (not step). Keeps motion blur, ribbon FX, and ground streaks reading the modulation.
- **Tuning starting point** (don't tune to feel during the first sprint — get it functional first, polish in Sprint 4):
  - Boost: 1.4× for 1.2s active, 5.0s cooldown
  - Brake: 0.65× for 1.0s active, 3.0s cooldown
  - Cancel rule: starting boost cancels active brake and vice versa, but cooldown applies to whichever was triggered.
- **Gamepad mapping.** RT (button 7) = boost. LT (button 6) = brake. A (button 0) = shatter (already used as primary action in CC, mirror it). Left stick X = lateral. D-pad L/R = lateral fallback for d-pad-only controllers.
- **Keyboard mapping.** Shift = boost. Ctrl = brake. Space = shatter (currently). Arrow / A-D = lateral. Don't reassign Space.
- **RL implications: action space changes from 6 to 24 (bit-encoded).** ONNX agent (`onnx-agent.ts`) is already in the repo — note in plan that current trained policy needs retraining. Fine; the trained policy is a stretch goal.

## Edge Cases

- **Player holds both triggers simultaneously.** Decode order: brake wins if both pressed (defensive default — slowing is safer). Document in input layer.
- **Boost during shatter.** Shatter already gates obstacle damage; boost just multiplies speed. Stack them — fastest aggressive option in the game. No conflict.
- **Cooldown serialization in ghost replay.** Ghost frames record state at 10Hz; cooldowns will appear as snapshots, not continuous. Don't try to interpolate cooldown values for replay — they're not visualized on ghosts anyway.
- **Browser tab loses focus during cooldown.** Existing `dt` clamping prevents runaway dt; cooldowns just resume from wherever they were. No special handling.
- **Gamepad disconnect mid-run.** Detect via `gamepadconnected` / `gamepaddisconnected`. Fall back silently to keyboard. No game-pause prompt — disruptive.

## Sprints

- [ ] **Sprint 1 — action bit encoding.** Refactor `agent-input.ts` to decode action int as bit-flags. Extend `SimulationInputState` with `boost: boolean`, `brake: boolean`. Existing 0-5 actions remain valid (low bits). Verify determinism harness still passes (`harness.ts:239` two-run hash check) — bit encoding is a pure refactor here.
- [ ] **Sprint 2 — speed-mod system.** Add `boostCooldown`, `brakeCooldown`, `boostTimer`, `brakeTimer` to `SimulationState`. Create `systems/speed-mod-system.ts`. Wire into `runtime.ts` `update()` after `playerMovementSystem`, before `collisionSystem`. Implement multiplicative target + lerp.
- [ ] **Sprint 3 — keyboard input.** Wire Shift / Ctrl to set the new action bits in the renderer's input loop. Verify boost feels and brake feels in playtest.
- [ ] **Sprint 4 — HUD cooldown rings.** Two small ring indicators near the phase meter — boost (gold) and brake (cyan). Fill drains while on cooldown, snap full when ready. Subtle pulse when ready-to-use.
- [ ] **Sprint 5 — gamepad polling.** New `browser-input.ts` (or fold into existing input layer) — gamepad poll each frame, frame-edge detect, map LT/RT/A/stick/d-pad to action bits. Existing keyboard input remains as fallback / coexists.
- [ ] **Sprint 6 — feel pass.** Tune boost/brake durations and cooldowns by playing. Adjust ribbon FX, FOV, and ground streak intensity to read the modulation. Add a brief "whoosh" SFX on boost edge, "screech" on brake edge.

## Verification Strategy

- **Sprint 1:** `npm run determinism` passes. Manual: action int 0 still does nothing, action int 1/2 still moves L/R, action int 3 still shatters.
- **Sprint 2:** Manually `setAction(4)` (bit 2 = boost) in harness, observe `state.speed` rising over 150ms toward 1.4× base, then decaying.
- **Sprint 3:** Hold Shift in browser, watch speed modulation visually + listen for FX.
- **Sprint 4:** Cooldown ring matches the 5s timer. Manual stopwatch check.
- **Sprint 5:** Connect Xbox / PS5 controller, confirm LT brakes, RT boosts, A shatters, stick steers.
- **Sprint 6:** No automated test — feel work. Tommy plays + signs off.

## Files to Create / Modify

| File | Change |
|---|---|
| `src/types.ts` | Add `boost: boolean`, `brake: boolean` to `SimulationInputState`; extend cooldowns on `GameSnapshot` |
| `src/sim-world.ts` | Extend `SimulationState` with cooldown/timer fields |
| `src/input/agent-input.ts` | Bit-flag action decoding |
| `src/systems/speed-mod-system.ts` | **NEW** — speed modulation system |
| `src/runtime.ts` | Wire new system + token |
| `src/tokens.ts` | Add `SpeedModSystemToken` |
| `src/game.ts` | Renderer input loop — keyboard + gamepad → action bits; HUD cooldown rings |
| `src/audio.ts` | Boost/brake edge SFX |
| `src/onnx-agent.ts` | Update action-space comment; retrain not in scope |

## Estimated Effort

5-7 SP. Sprint 1-3 land the gameplay change. Sprint 4-5 add the polish + gamepad. Sprint 6 is the feel pass that turns "it works" into "it slaps."
