import process from "node:process";
import { LockstepRunner } from "../dist/lockstep-runner.mjs";
import { ShatterDriftSimulation } from "../dist/simulation.mjs";

const INPUT_DELAY_TICKS = 3;
const START_TICK = 6;
const SAMPLE_INTERVAL = 60;
const TOTAL_TICKS = 1800;
const SEED = 0x5a17c3;

class LoopbackTransport {
  constructor() {
    this.queue = [];
    this.peer = null;
  }

  connect(peer) {
    this.peer = peer;
  }

  send(frame) {
    this.peer?.queue.push({ ...frame });
  }

  drainQueuedFrames() {
    const frames = this.queue.slice().sort((a, b) => a.tick - b.tick || a.playerIndex - b.playerIndex);
    this.queue.length = 0;
    return frames;
  }
}

function scriptedAction(tick, playerIndex) {
  const phase = (tick + playerIndex * 23) % 240;
  let action = 0;
  if (phase < 40) action |= 0x01;
  else if (phase < 80) action |= 0x02;
  if (phase >= 90 && phase < 118) action |= 0x04;
  if (phase >= 120 && phase < 132) action |= 0x08;
  if (phase >= 170 && phase < 182) action |= 0x10;
  return action;
}

function hashState(state) {
  const json = JSON.stringify(state);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function createPeer(localPlayerIndex) {
  return new ShatterDriftSimulation({
    seed: SEED,
    playerCount: 2,
    localPlayerIndex,
    playerNames: ["ALPHA", "BETA"],
    playerColors: [0x4be1ff, 0xff5fa2],
  });
}

const simA = createPeer(0);
const simB = createPeer(1);
const transportA = new LoopbackTransport();
const transportB = new LoopbackTransport();
transportA.connect(transportB);
transportB.connect(transportA);

const sampleA = [];
const sampleB = [];

const runnerA = new LockstepRunner({
  sim: simA,
  transport: transportA,
  playerIndices: new Map([
    ["peer-a", 0],
    ["peer-b", 1],
  ]),
  localPlayerIndex: 0,
  startTick: START_TICK,
  onTickAdvanced: (tick) => {
    const simTick = tick - START_TICK + 1;
    if (simTick > 0 && simTick % SAMPLE_INTERVAL === 0) {
      sampleA.push(hashState(simA.getAuthoritativeState()));
    }
  },
});

const runnerB = new LockstepRunner({
  sim: simB,
  transport: transportB,
  playerIndices: new Map([
    ["peer-a", 0],
    ["peer-b", 1],
  ]),
  localPlayerIndex: 1,
  startTick: START_TICK,
  onTickAdvanced: (tick) => {
    const simTick = tick - START_TICK + 1;
    if (simTick > 0 && simTick % SAMPLE_INTERVAL === 0) {
      sampleB.push(hashState(simB.getAuthoritativeState()));
    }
  },
});

runnerA.start();
runnerB.start();

let submittedA = START_TICK - 1;
let submittedB = START_TICK - 1;
let nowMs = 0;

while ((runnerA.getCurrentTick() - START_TICK) < TOTAL_TICKS || (runnerB.getCurrentTick() - START_TICK) < TOTAL_TICKS) {
  const targetA = Math.min(START_TICK + TOTAL_TICKS - 1, runnerA.getCurrentTick() + INPUT_DELAY_TICKS);
  while (submittedA < targetA) {
    submittedA += 1;
    const action = scriptedAction(submittedA - START_TICK, 0);
    runnerA.submitLocalInput(submittedA, action);
    transportA.send({ tick: submittedA, action, playerIndex: 0 });
  }

  const targetB = Math.min(START_TICK + TOTAL_TICKS - 1, runnerB.getCurrentTick() + INPUT_DELAY_TICKS);
  while (submittedB < targetB) {
    submittedB += 1;
    const action = scriptedAction(submittedB - START_TICK, 1);
    runnerB.submitLocalInput(submittedB, action);
    transportB.send({ tick: submittedB, action, playerIndex: 1 });
  }

  nowMs += 1000 / 60;
  runnerA.tryAdvance(nowMs);
  runnerB.tryAdvance(nowMs);
}

const mismatches = [];
for (let i = 0; i < 30; i++) {
  if (sampleA[i] !== sampleB[i]) mismatches.push({ sample: i + 1, a: sampleA[i], b: sampleB[i] });
}

if (sampleA.length !== 30 || sampleB.length !== 30 || mismatches.length > 0) {
  console.error("[mp-smoke] FAIL", {
    sampleCountA: sampleA.length,
    sampleCountB: sampleB.length,
    mismatches,
  });
  process.exit(1);
}

console.log("[mp-smoke] PASS", sampleA.map((hash, index) => `${index + 1}:${hash}`).join(" "));
