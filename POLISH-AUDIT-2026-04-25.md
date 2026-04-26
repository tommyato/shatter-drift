# Shatter Drift Polish Audit - 2026-04-25

Audited against `preferences/game-polish-universal.md` (10 rules). Source HEAD: `112d28d708a503e722463eaa20f32a6fe944f34c`.

## Status (2026-04-26)

- **Rules 2, 5, 9 — RESOLVED** in commit `da442e2` ("polish(sd): menu nav, hide title crystal, coolname identity, console hygiene"), pushed to `origin/main` 2026-04-25 (the same day the audit was committed). Spot-checked on origin/main @ `8b36014`:
  - Rule 5 — `src/game.ts:577` sets `this.player.group.visible = false` on init; `:1571` sets visible on gameplay start. Confirmed by host-Chrome screenshots.
  - Rule 2 — `grep -REn '"PLAYER"|"Player[0-9]"|"Anonymous"|"ANON"' src/` returns no matches outside `src/multiplayer.ts`. `getLocalUsername()` is wired through `game.ts:38, 963, 1028, 3209, 3241`.
  - Rule 9 — `grep -En 'console\.(log|warn|error|info)' src/main.ts src/recorder.ts` returns no matches.
- **Rule 4 — RESOLVED** as of `2e0f410` (PR #5, "back-port categorical-alignment-first findNeighbor from CC"), which landed the `findNeighbor` primitive on top of the already-shipped `MenuNavigation` class from earlier polish work. Spot-checked on origin/main @ `0a25db2`:
  - `MenuNavigation` registered on every menu surface: title (`game.ts:824`), customize (`game.ts:841`), multiplayer (`game.ts:852`), pause (`game.ts:866`), game-over (`game.ts:879`).
  - Gamepad polled in `src/input.ts:225` (`navigator.getGamepads()`).
  - **Live verification 2026-04-26 16:20Z** via host-Chrome agent-browser against `https://tommyato.com/games/shatter-drift/`:
    - Default focus on `play-btn` (correct — primary action).
    - Synthetic `ArrowDown` moves focus play-btn → daily-btn; `ArrowUp` returns to play-btn.
    - Synthetic `Enter` on focused `play-btn` hides `#title-overlay` and starts the game.
    - Title screenshot shows clean grid backdrop, no player crystal pre-start (Rule 5 visual confirm).

A polish-bundle worker was dispatched on 2026-04-26 (`9e927ba7`) before this status check was done; it correctly identified that Rules 2/5/9 were already done and pushed only a verification markdown to `polish/sd-rule-5-2-9-bundle`. That branch was deleted; this audit doc is the canonical record. Lesson captured in `tommyato-knowledge/preferences/worker-dispatch-hygiene.md`.

---


## Rule 1: No native browser dialogs
**Status:** PASS
**Evidence:** `grep -REn '\b(window\.)?(prompt|alert|confirm)\s*\(' src/` produced no matches. The shipped UI uses DOM overlays and buttons instead of native dialogs: `index.html:652-733`, `game.ts:2470-2516`, `game.ts:2677-2732`.
**Notes:** No `prompt`, `alert`, or `confirm` calls are present in `src/`.

## Rule 2: Coolname default usernames
**Status:** FAIL
**Evidence:** `grep -REn '"Player"|"Anonymous"|cc-username|coolname' src/` produced no matches. The leaderboard identity is stored under a per-game key instead of the shared `cc-username` key: `leaderboard.ts:27-35`. The game falls back to a literal `PLAYER####` string when no name exists: `game.ts:2644-2648`. Ghost uploads also fall back to `ANON`: `game.ts:2615-2617`.
**Notes:** The fix needs to route all name reads/writes through the shared coolname path and shared storage key, then let the title/game-over flows reuse that value live.

## Rule 3: Modals and overlay panels are fixed-size
**Status:** PASS
**Evidence:** The major overlays are bounded and scroll their interior content instead of growing with the data: `index.html:208-219` (`#center-message`), `index.html:455-468` (`#customize-panel`), `index.html:586-598` (`#pause-menu`), `index.html:691-733` (title/customize/pause markup), `game.ts:2470-2516` (game-over tabs/content).
**Notes:** The menu chrome is viewport-fixed; only the inner content changes.

## Rule 4: Keyboard AND gamepad navigation must work on every menu
**Status:** FAIL
**Status (original audit):** FAIL
**Status (2026-04-26 re-check):** PASS
**Evidence (original):** `grep -REn 'getGamepads|gamepadconnected|d-?pad|stickX|stickY|navIndex|focusedIndex' src/` produced no matches. The title screen only reacts to `space` or `click`, not focus-based navigation.
**Evidence (re-check on `0a25db2`):** Same grep now hits `src/input.ts:225` (`navigator.getGamepads()`) and `src/menu-navigation.ts` (`MenuNavigation` class, `MENU_FOCUS_CLASS`, scope stack with `setScope`/`pushScope`/`popScope`). `MenuNavigation.update(input)` runs once per frame from `Game.loop()` (`game.ts:1404`) and reads d-pad/left-stick/arrow-keys to move focus and `.click()` the focused element on A/Enter/Space. Live behavior verified 2026-04-26 16:20Z via host-Chrome (see Status block above).
**Notes:** Originally deferred until PR #5 landed `findNeighbor`; that merged `2026-04-26` and the audit doc was lagging. Resolved.

## Rule 5: Title screens don't show gameplay actors before the run starts
**Status (original audit):** FAIL
**Status (2026-04-26 re-check):** PASS
**Evidence (original):** The player object was created during init and added to the scene before the game left the title state. Title update loop animated the player crystal every frame on the title screen.
**Evidence (re-check on `0a25db2`):** `src/game.ts:577` now sets `this.player.group.visible = false` during init; the visibility flip to `true` happens at `:1571` on gameplay start. Title screenshot at 2026-04-26 16:20Z (host-Chrome via agent-browser) shows clean grid backdrop only — no crystal floating pre-run.
**Notes:** Resolved by `da442e2`.

## Rule 6: Death + revive doesn't loop
**Status:** PASS
**Evidence:** The shield power-up is one-use and gets consumed on hit, not respawned in place: `powerups.ts:261-289`. Death transitions straight into game-over flow with no checkpoint/revive path: `game.ts:2290-2466`. Restart only happens after an explicit retry input from game-over: `game.ts:2755-2764`.
**Notes:** I did not find any revive/checkpoint loop that would re-kill the player at the death position.

## Rule 7: State changes propagate live, no refresh required
**Status:** PASS
**Evidence:** The visible settings surfaces update immediately: ghost toggle repaint + live enable/disable + title-line refresh in `game.ts:689-704`, cosmetic selection applies directly to the player in `game.ts:765-815`, daily/high-score display is re-read from storage on refresh points in `game.ts:842-857`, and the leaderboard name flow re-reads the saved value when the game-over panel opens and saves edits on change/blur in `game.ts:2644-2727`.
**Notes:** The live update path is intact for the visible settings and cosmetics surfaces.

## Rule 8: Audio doesn't pop on state transitions
**Status:** PASS
**Evidence:** Ambient state changes use smoothing with `setTargetAtTime`: `audio.ts:183-199`. Music parameter retunes also use `setTargetAtTime` and fade-outs are ramped: `audio.ts:1111-1119`, `audio.ts:1141-1166`, `audio.ts:1188-1191`, `audio.ts:1222-1225`. The `setValueAtTime` calls that remain are in short one-shot SFX builders, not state-boundary retunes: `audio.ts:203-245`, `audio.ts:325-385`, `audio.ts:478-523`.
**Notes:** I did not find a state-transition pop path in the ambient or music code.

## Rule 9: Console hygiene at zero warnings
**Status:** FAIL
**Evidence:** `grep -REn 'console\.(log|warn|error|info|debug)' src/` hit `src/main.ts:22` (`console.log`) and `src/recorder.ts:46` (`console.error`). Those are shipped code paths, not comments or tests.
**Notes:** Remove the runtime log and replace the recorder error path with silent failure or UI-handled messaging, depending on whether the condition is user-actionable.

## Rule 10: Verify visually on the actual deploy target before reporting "done"
**Status:** N/A
**Evidence:** This is a process requirement, not a game-code property. The rule itself is defined in `preferences/game-polish-universal.md:88-97`.
**Notes:** No code audit is possible here; this is enforced by the brain's review/deploy workflow, not by source changes.

---

## Summary

**Original audit (committed 2026-04-25):**

| Rule | Original | Now |
|---|---|---|
| 1 — No native dialogs | PASS | PASS |
| 2 — Coolname usernames | FAIL | ✅ PASS (`da442e2`) |
| 3 — Fixed-size overlays | PASS | PASS |
| 4 — KB+gamepad nav on every menu | FAIL | ✅ PASS (`2e0f410`, live-verified 2026-04-26) |
| 5 — No actors on title | FAIL | ✅ PASS (`da442e2`, screenshot-verified) |
| 6 — No revive loop | PASS | PASS |
| 7 — Live state propagation | PASS | PASS |
| 8 — No audio pops | PASS | PASS |
| 9 — Console hygiene | FAIL | ✅ PASS (`da442e2`) |
| 10 — Verify-on-target | N/A | N/A |

**All P0/P1/P2 items closed.** 9-of-9 testable rules pass on `origin/main @ 0a25db2`.

**Lesson banked twice:** the audit doc was committed 2026-04-25 03:43 PM EDT, but the underlying source moved fast — Rules 2/5/9 were fixed the same day in `da442e2`, and Rule 4 fell out as a free pass when PR #5 (`findNeighbor` back-port) merged 2026-04-26. By the time anyone read the audit's per-rule sections in isolation, every "FAIL" had already been resolved. Process fix at `tommyato-knowledge/preferences/worker-dispatch-hygiene.md` (audit-staleness spot-check before dispatching off audit doc >24h old).
