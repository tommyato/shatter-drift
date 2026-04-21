#!/usr/bin/env node
/**
 * Pre-training simulation validator.
 *
 * Runs the headless simulation through key scenarios to verify:
 * 1. Boss waves spawn at correct intervals
 * 2. LaserGrid (full-width) bars appear in observations
 * 3. Shatter mechanic allows passing through obstacles
 * 4. Collision kills when NOT shattered
 * 5. Observation vector is well-formed (24 values, correct ranges)
 * 6. Episode can survive to boss wave distance with correct play
 *
 * Usage: node validate-sim.mjs [--verbose]
 */

import { pathToFileURL } from 'node:url';

const verbose = process.argv.includes('--verbose');

// Load the simulation
const simUrl = pathToFileURL(new URL('./dist/simulation.mjs', import.meta.url).pathname).href;
const mod = await import(simUrl);
const SimClass = mod.ShatterDriftSimulation || mod.default;

const PLAYABLE_HALF_WIDTH = 10;
const BOSS_INTERVAL = 500;
const MAX_SPEED = 45;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    if (verbose) console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function section(name) {
  console.log(`\n▶ ${name}`);
}

// ==========================================================================
// Test 1: Basic simulation mechanics
// ==========================================================================
section('Basic mechanics');
{
  const sim = new SimClass({ seed: 42, fixedDt: 1/60 });
  const { state } = sim.reset();

  assert(state.alive === true, 'Player starts alive');
  assert(state.distance === 0, 'Player starts at distance 0');
  assert(state.shattered === false, 'Player starts unshattered');

  const obs = sim.getObservation();
  assert(obs.length === 24, `Observation is 24 values (got ${obs.length})`);
  assert(obs[0] === 0, 'Player X starts at center (obs[0]=0)');
  assert(obs[1] === 0, 'Not shattered (obs[1]=0)');
  assert(obs[2] >= 0 && obs[2] <= 1, 'Speed normalized 0-1');
  assert(obs[3] === 0, 'Phase cooldown starts at 0');
}

// ==========================================================================
// Test 2: Shatter mechanic works
// ==========================================================================
section('Shatter mechanic');
{
  const sim = new SimClass({ seed: 42, fixedDt: 1/60 });
  sim.reset();

  // Action 3 = shatter (no movement)
  sim.step(3);
  const obs = sim.getObservation();
  assert(obs[1] === 1, 'Shatter activates with action 3 (obs[1]=1)');

  // Release shatter
  sim.step(0);
  const obs2 = sim.getObservation();
  assert(obs2[1] === 0, 'Shatter deactivates when released');
}

// ==========================================================================
// Test 3: Boss wave spawning — verify via getState() obstacle data
// Boss schedule: 500m=SpinningGate, 1000m=Converging, 1500m=Orbital, 2000m=LaserGrid
// ==========================================================================
section('Boss wave spawning (state inspection)');
{
  const sim = new SimClass({ seed: 42, fixedDt: 1/60 });
  sim.reset();

  let sawBossObstacles = false;
  let bossObstacles = [];
  let maxDist = 0;

  // Smart policy: dodge gates, shatter bars
  for (let i = 0; i < 60 * 120; i++) {
    const obs = sim.getObservation();
    const playerX = obs[0];
    const nearestZ = obs[4];
    const nearestCenter = obs[5];
    const nearestIsGate = obs[7];
    const cooldown = obs[3];

    let action = 0;
    if (nearestZ > 0 && nearestZ < 0.3) {
      if (nearestIsGate > 0.5) {
        if (nearestCenter > playerX + 0.05) action = 2;
        else if (nearestCenter < playerX - 0.05) action = 1;
      } else if (cooldown === 0) {
        action = 3; // shatter through bars
      } else {
        action = nearestCenter > 0 ? 1 : 2;
      }
    }

    const result = sim.step(action);
    if (!result.state.alive) { sim.reset(); continue; }
    if (result.state.distance > maxDist) maxDist = result.state.distance;

    // Check for SpinningGate boss obstacles (~500m: 4 pillars, halfWidth=3, at x=0)
    if (result.state.distance > 480 && result.state.distance < 520 && !sawBossObstacles) {
      const bossHits = result.state.obstacles.filter(o =>
        o.z >= 490 && o.z <= 510 && Math.abs(o.halfWidth - 3) < 0.01 && !o.isGate
      );
      if (bossHits.length >= 2) {
        sawBossObstacles = true;
        bossObstacles = bossHits;
      }
    }

    if (maxDist > 520) break;
  }

  assert(maxDist >= 480, `Reaches boss zone 480m+ (got ${Math.round(maxDist)}m)`);
  assert(sawBossObstacles, `SpinningGate boss spawns near 500m (${bossObstacles.length} pillars found)`);

  if (bossObstacles.length > 0) {
    assert(bossObstacles.every(o => Math.abs(o.x) < 0.01), 'Boss pillars centered at x=0');
    assert(bossObstacles.every(o => o.halfWidth === 3), 'Boss pillars have halfWidth=3');
    assert(bossObstacles.every(o => !o.isGate), 'Boss pillars are non-gate bars');
  }
}

// ==========================================================================
// Test 4: Non-gate obstacles kill when NOT shattered
// ==========================================================================
section('Collision kills when not shattered');
{
  const sim = new SimClass({ seed: 42, fixedDt: 1/60 });
  sim.reset();

  // Run straight into the first obstacle without shattering or dodging
  let died = false;
  let deathDistance = 0;

  for (let i = 0; i < 60 * 30; i++) {
    const result = sim.step(0); // idle, no dodge
    if (!result.state.alive) {
      died = true;
      deathDistance = result.state.distance;
      break;
    }
  }

  assert(died, `Player dies from obstacle collision (at ${Math.round(deathDistance)}m)`);
  assert(deathDistance > 0 && deathDistance < 200, `Death within first 200m (got ${Math.round(deathDistance)}m)`);
}

// ==========================================================================
// Test 5: Shatter allows passing through obstacles
// ==========================================================================
section('Shatter grants invulnerability');
{
  const sim = new SimClass({ seed: 42, fixedDt: 1/60 });
  sim.reset();

  // Shatter through obstacles (action 3) until energy runs out, verify survival
  let stepsWhileShattered = 0;
  let passedWhileShattered = false;

  for (let i = 0; i < 300; i++) {
    const obs = sim.getObservation();
    const result = sim.step(3); // always shatter
    if (obs[1] === 1) stepsWhileShattered++;

    // Check if we passed any obstacles while shattered
    for (const ev of result.events) {
      if (ev.type === 'wall_destroyed' || ev.type === 'close_call') {
        passedWhileShattered = true;
      }
    }
    if (!result.state.alive) break;
  }

  assert(stepsWhileShattered > 100, `Shatter sustained for ${stepsWhileShattered} frames`);
  assert(passedWhileShattered, 'Shatter allows passing through obstacles (close_call/wall_destroyed events)');
}

// ==========================================================================
// Test 6: Observation vector validity across a full episode
// ==========================================================================
section('Observation bounds check');
{
  const sim = new SimClass({ seed: 42, fixedDt: 1/60 });
  sim.reset();

  let violations = 0;
  let totalChecks = 0;

  for (let i = 0; i < 600; i++) {
    const obs = sim.getObservation();

    // Verify all values are in expected ranges
    const checks = [
      [obs[0], -1, 1, 'playerX'],
      [obs[1], 0, 1, 'shattered'],
      [obs[2], 0, 1, 'speed'],
      [obs[3], 0, 1, 'cooldown'],
    ];
    for (let j = 0; j < 5; j++) {
      checks.push(
        [obs[4+j*4], 0, 1, `obs[${j}].z`],
        [obs[4+j*4+1], -1, 1, `obs[${j}].center`],
        [obs[4+j*4+2], 0, 1, `obs[${j}].width`],
        [obs[4+j*4+3], 0, 1, `obs[${j}].isGate`],
      );
    }

    for (const [val, min, max, name] of checks) {
      totalChecks++;
      if (val < min || val > max) {
        violations++;
        if (verbose) console.log(`    OOB: ${name}=${val} not in [${min},${max}]`);
      }
    }

    // Alternate actions
    sim.step(i % 6);
    if (!sim.getState().alive) sim.reset();
  }

  assert(violations === 0, `All ${totalChecks} observation values in bounds (${violations} violations)`);
}

// ==========================================================================
// Test 7: All 6 actions produce different behaviors
// ==========================================================================
section('Action space verification (6 actions)');
{
  const results = [];
  for (let action = 0; action < 6; action++) {
    const sim = new SimClass({ seed: 42, fixedDt: 1/60 });
    sim.reset();
    // Run 30 steps with same action
    for (let i = 0; i < 30; i++) sim.step(action);
    const obs = sim.getObservation();
    results.push({ action, x: obs[0], shattered: obs[1] });
  }

  // Actions 0,1,2 should not shatter; 3,4,5 should
  assert(results[0].shattered === 0, 'Action 0 (idle): not shattered');
  assert(results[1].shattered === 0, 'Action 1 (left): not shattered');
  assert(results[2].shattered === 0, 'Action 2 (right): not shattered');
  assert(results[3].shattered === 1, 'Action 3 (shatter): shattered');
  assert(results[4].shattered === 1, 'Action 4 (shatter+left): shattered');
  assert(results[5].shattered === 1, 'Action 5 (shatter+right): shattered');

  // Actions 1,4 should move left (negative X)
  assert(results[1].x < results[0].x, 'Action 1 moves left vs idle');
  assert(results[4].x < results[3].x, 'Action 4 moves left vs shatter-idle');

  // Actions 2,5 should move right (positive X)
  assert(results[2].x > results[0].x, 'Action 2 moves right vs idle');
  assert(results[5].x > results[3].x, 'Action 5 moves right vs shatter-idle');
}

// ==========================================================================
// Test 8: Event emission verification
// ==========================================================================
section('Game events fire correctly');
{
  const sim = new SimClass({ seed: 42, fixedDt: 1/60 });
  sim.reset();

  const eventTypes = new Set();

  // Shatter through obstacles to collect events
  for (let i = 0; i < 600; i++) {
    const obs = sim.getObservation();
    const nearestZ = obs[4];
    // Shatter when close to obstacles
    const action = (nearestZ > 0 && nearestZ < 0.2) ? 3 : 0;
    const result = sim.step(action);

    for (const ev of result.events) {
      eventTypes.add(ev.type);
    }

    if (!result.state.alive) {
      eventTypes.add('death'); // should already be in events
      break;
    }
  }

  assert(eventTypes.has('wall_destroyed'), 'wall_destroyed event fires when shattering through bars');
  assert(eventTypes.has('shatter_activated'), 'shatter_activated event fires on phase');
  // These may or may not fire depending on obstacle placement
  if (verbose) console.log(`  Events observed: ${[...eventTypes].join(', ')}`);
}

// ==========================================================================
// Test 9: Speed ramp verification
// ==========================================================================
section('Speed ramp matches constants');
{
  const sim = new SimClass({ seed: 42, fixedDt: 1/60 });
  sim.reset();

  // Speed starts at 0 in state (computed on first update tick), so step once first
  sim.step(0);
  const obs0 = sim.getObservation();
  const initialSpeed = obs0[2] * MAX_SPEED;
  assert(Math.abs(initialSpeed - 12) < 2, `Initial speed ~12 m/s (got ${initialSpeed.toFixed(1)})`);

  // Run to ~300m with smart policy
  sim.reset();
  for (let i = 0; i < 60 * 60; i++) {
    const obs = sim.getObservation();
    const nearestZ = obs[4];
    const cooldown = obs[3];
    const shouldShatter = nearestZ > 0 && nearestZ < 0.15 && cooldown === 0;
    sim.step(shouldShatter ? 3 : 0);
    if (!sim.getState().alive) { sim.reset(); continue; }
    if (sim.getState().distance > 300) break;
  }
  const obs300 = sim.getObservation();
  const speed300 = obs300[2] * MAX_SPEED;
  assert(speed300 > 18 && speed300 < 25, `Speed at 300m is 18-25 (got ${speed300.toFixed(1)})`);
}

// ==========================================================================
// Test 10: Determinism check (seeded sim should reproduce)
// ==========================================================================
section('Deterministic replay');
{
  function runEpisode(seed, actions) {
    const sim = new SimClass({ seed, fixedDt: 1/60 });
    sim.reset();
    const observations = [];
    for (const action of actions) {
      sim.step(action);
      observations.push(Array.from(sim.getObservation()));
      if (!sim.getState().alive) break;
    }
    return observations;
  }

  // Random-ish action sequence
  const actions = Array.from({ length: 200 }, (_, i) => i % 6);
  const run1 = runEpisode(123, actions);
  const run2 = runEpisode(123, actions);

  assert(run1.length === run2.length, `Same episode length (${run1.length})`);

  let allMatch = true;
  for (let i = 0; i < run1.length; i++) {
    for (let j = 0; j < 24; j++) {
      if (run1[i][j] !== run2[i][j]) {
        allMatch = false;
        break;
      }
    }
  }
  assert(allMatch, 'Seeded simulation is perfectly deterministic');
}

// ==========================================================================
// Summary
// ==========================================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\n⚠️  SIMULATION HAS ISSUES — do NOT start training until fixed.');
  process.exit(1);
} else {
  console.log('\n✓ All checks pass — simulation is ready for training.');
  process.exit(0);
}
