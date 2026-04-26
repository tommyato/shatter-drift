# Shatter Drift Polish Audit - 2026-04-25

Audited against `preferences/game-polish-universal.md` (10 rules). Source HEAD: `112d28d708a503e722463eaa20f32a6fe944f34c`.

## Status (2026-04-26)

- **Rules 2, 5, 9 — RESOLVED** in commit `da442e2` ("polish(sd): menu nav, hide title crystal, coolname identity, console hygiene"), pushed to `origin/main` 2026-04-25 (the same day the audit was committed). Spot-checked on origin/main @ `8b36014`:
  - Rule 5 — `src/game.ts:577` sets `this.player.group.visible = false` on init; `:1571` sets visible on gameplay start. Confirmed by host-Chrome screenshots.
  - Rule 2 — `grep -REn '"PLAYER"|"Player[0-9]"|"Anonymous"|"ANON"' src/` returns no matches outside `src/multiplayer.ts`. `getLocalUsername()` is wired through `game.ts:38, 963, 1028, 3209, 3241`.
  - Rule 9 — `grep -En 'console\.(log|warn|error|info)' src/main.ts src/recorder.ts` returns no matches.
- **Rule 4 — DEFERRED** until SD PR #3 (back-port of `findNeighbor` from Clockwork Climb) merges. Touching `src/menu-navigation.ts` before that lands would force a rebase. Pick this back up post-merge.

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
**Evidence:** `grep -REn 'getGamepads|gamepadconnected|d-?pad|stickX|stickY|navIndex|focusedIndex' src/` produced no matches. The title screen only reacts to `space` or `click`, not focus-based navigation: `game.ts:978-995`. The title buttons are clickable divs, not keyboard-navigable controls: `index.html:674-687`. The pause and customize overlays also rely on click handlers only: `game.ts:673-718`, `game.ts:732-815`. Game-over tabs are clickable, but there is no selection model or gamepad path: `game.ts:2473-2516`.
**Notes:** This needs a real menu focus model plus gamepad polling and activation support across title, pause, customize, and game-over surfaces.

## Rule 5: Title screens don't show gameplay actors before the run starts
**Status:** FAIL
**Evidence:** The player object is created during init and added to the scene before the game ever leaves the title state: `game.ts:517-519`, `game.ts:433-443`. The title update loop explicitly positions and animates the player crystal every frame on the title screen: `game.ts:978-982`. Ghosts are gated correctly until start, which makes the player render stand out as the only title-actor leak: `ghost.ts:157-160`, `ghost.ts:348-350`.
**Notes:** The title scene needs to hide the player visual root until `GameState.Playing` begins.

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

**P0 (ship-stoppers):**
- Rule 4 - Every menu surface is still mouse-driven; there is no gamepad navigation path and no focus/selection model.
- Rule 5 - The title screen renders the player crystal before gameplay starts.

**P1 (visible polish):**
- Rule 2 - Username defaults are still per-game and literal (`PLAYER####`) instead of shared coolname-backed identity.

**P2 (minor):**
- Rule 9 - Ship code still emits console output in the harness and recorder paths.

**Overall:** This audit is narrow, not sprawling: the clean passes are the fixed-size overlays, revive behavior, live settings propagation, and audio smoothing. The real problems cluster in the entry/title/identity layer, which is the same kind of high-signal surface that failed the Gravity Dash audit before its fixes landed. One fix worker should be able to handle the UI cluster in `game.ts` and `index.html` in a single session; if the shared coolname helper needs to be normalized across titles, that part may split into a small follow-up.
