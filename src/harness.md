# Shatter Drift — `?_harness=1` QA Harness

## What it does

Appending `?_harness=1` to the URL switches the page into **headless harness mode**:

- The rendered `Game` is **not started** — no Three.js scene, no RAF loop.
- `window.__harness` is set to a `Harness` object.
- `window.__harnessReady = true` is set (poll this from Puppeteer).
- A console log confirms: `[harness] ready, scripts: ...`

Normal play (no query param) is completely unaffected.

## Calling from Puppeteer

```js
await page.goto('http://localhost:4173/?_harness=1')
await page.waitForFunction(() => window.__harnessReady === true, { timeout: 10_000 })
const result = await page.evaluate(() => window.__harness.runScript('determinism'))
console.log(result.invariants)
```

## Calling from Chrome DevTools

Open the built page with `?_harness=1`, then in the console:

```js
// Run a canned script
window.__harness.runScript('idle-60s')

// Step manually
window.__harness.reset(42)
window.__harness.step(60, 0)        // 60 ticks, no input
window.__harness.getStateHash()     // reproducible hash

// Run all invariants against current state
window.__harness.invariants()
```

## Harness API

| Method | Description |
|---|---|
| `reset(seed?)` | Re-creates the simulation with the given seed (default: random). Returns initial `GameSnapshot`. |
| `step(n, action?)` | Advance `n` ticks. `action` can be a number (0–5) or `(tick) => number`. Returns final `GameSnapshot`. |
| `getState()` | Current `GameSnapshot` from the sim. |
| `getStateHash()` | FNV-1a 32-bit hash over canonical state. Same seed + actions → same hash. |
| `invariants()` | Run all invariants against current state. Returns `{name, ok, msg?}[]`. |
| `runScript(name)` | Run a canned script. Returns `{state, invariants, ticks}`. |
| `listScripts()` | Returns the list of available script names. |

### Actions

| Value | Effect |
|---|---|
| 0 | No input |
| 1 | Move left |
| 2 | Move right |
| 3 | Shatter (phase) |
| 4 | Left + Shatter |
| 5 | Right + Shatter |

## Invariants

All invariants run via `harness.invariants()` or automatically inside `runScript()`:

| Name | What it checks |
|---|---|
| `no-nan-in-state` | Recursively walks `getState()`; fails if any `Number.isNaN`. |
| `score-monotonic` | Score never decreases between consecutive steps. |
| `alive-is-one-way` | Once `alive` goes `false`, it cannot return `true` without `reset()`. |
| `distance-non-negative` | `state.distance >= 0` at all times. |
| `determinism-check` | Part of the `determinism` script: two runs with the same seed + actions must produce the same hash. |

## Canned scripts

| Name | What it runs |
|---|---|
| `idle-60s` | `reset(42)` → 3600 ticks, action=0. Checks all invariants. |
| `survive-30s` | `reset(42)` → 1800 ticks, alternating left/right every 0.5s. Checks invariants. |
| `determinism` | Two identical 1800-tick runs with seed=42; asserts hashes match. |

## Adding a new script

In `src/harness.ts`, add an entry to the `SCRIPTS` object:

```ts
'my-script'(): ScriptResult {
  resetSim(99)              // or any seed
  const TICKS = 600         // 10 seconds at 1/60 dt
  const state = doStep(TICKS, 2)   // action=2 (move right)
  return { state, invariants: runInvariants(), ticks: TICKS }
},
```

No other changes needed — `listScripts()` and `runScript()` pick it up automatically.

## Bundle impact

The harness module is statically imported but only activates on `?_harness=1`. The
simulation is already in the normal bundle (used by the AI ghost). Net addition is
the harness wrapper code only — target ≤ 5 KB gzipped.
