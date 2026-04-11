/**
 * Procedural audio system using Web Audio API.
 * No external files — everything is synthesized.
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let droneOsc: OscillatorNode | null = null;
let droneGain: GainNode | null = null;
let windNoise: AudioBufferSourceNode | null = null;
let windFilter: BiquadFilterNode | null = null;
let windGain: GainNode | null = null;
let initialized = false;

function ensureContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }
  return ctx;
}

/** Call on first user interaction to unlock audio */
export function initAudio() {
  if (initialized) return;
  initialized = true;
  const c = ensureContext();

  // Ambient drone — low oscillator
  droneOsc = c.createOscillator();
  droneOsc.type = "sine";
  droneOsc.frequency.value = 55;
  droneGain = c.createGain();
  droneGain.gain.value = 0;
  droneOsc.connect(droneGain);
  droneGain.connect(masterGain!);
  droneOsc.start();

  // Wind noise — filtered white noise
  const bufferSize = c.sampleRate * 2;
  const noiseBuffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }

  windNoise = c.createBufferSource();
  windNoise.buffer = noiseBuffer;
  windNoise.loop = true;

  windFilter = c.createBiquadFilter();
  windFilter.type = "bandpass";
  windFilter.frequency.value = 200;
  windFilter.Q.value = 0.5;

  windGain = c.createGain();
  windGain.gain.value = 0;

  windNoise.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(masterGain!);
  windNoise.start();
}

/** Update ambient sounds based on game state */
export function updateAmbient(speed: number, isPlaying: boolean) {
  if (!initialized || !ctx) return;

  const t = ctx.currentTime;
  const speedNorm = Math.min(speed / 45, 1); // 0-1

  if (isPlaying) {
    // Drone rises in pitch and volume with speed
    droneOsc!.frequency.setTargetAtTime(55 + speedNorm * 60, t, 0.3);
    droneGain!.gain.setTargetAtTime(0.06 + speedNorm * 0.08, t, 0.3);

    // Wind increases with speed
    windFilter!.frequency.setTargetAtTime(200 + speedNorm * 1200, t, 0.2);
    windGain!.gain.setTargetAtTime(0.03 + speedNorm * 0.12, t, 0.2);
  } else {
    droneGain!.gain.setTargetAtTime(0, t, 0.5);
    windGain!.gain.setTargetAtTime(0, t, 0.3);
  }
}

/** Shatter sound — noise burst with pitch sweep down */
export function playShatter() {
  if (!ctx || !masterGain) return;
  const t = ctx.currentTime;

  // Noise burst
  const dur = 0.15;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const env = 1 - i / data.length;
    data[i] = (Math.random() * 2 - 1) * env * env;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(2000, t);
  filter.frequency.exponentialRampToValueAtTime(400, t + dur);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  src.start(t);
  src.stop(t + dur);

  // Tonal component — descending
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(800, t);
  osc.frequency.exponentialRampToValueAtTime(200, t + 0.1);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.08, t);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc.connect(oscGain);
  oscGain.connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.12);
}

/** Recombine sound — ascending chime */
export function playRecombine() {
  if (!ctx || !masterGain) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(300, t);
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.12);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.16);
}

/** Orb collect — bright ping, pitch rises with combo */
export function playCollect(combo: number) {
  if (!ctx || !masterGain) return;
  const t = ctx.currentTime;

  const basePitch = 600 + Math.min(combo, 10) * 80;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(basePitch, t);
  osc.frequency.exponentialRampToValueAtTime(basePitch * 1.5, t + 0.08);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.13);

  // Harmonic overtone
  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(basePitch * 2, t);
  osc2.frequency.exponentialRampToValueAtTime(basePitch * 2.5, t + 0.06);

  const gain2 = ctx.createGain();
  gain2.gain.setValueAtTime(0.06, t);
  gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

  osc2.connect(gain2);
  gain2.connect(masterGain);
  osc2.start(t);
  osc2.stop(t + 0.09);
}

/** Close call swoosh */
export function playCloseCall() {
  if (!ctx || !masterGain) return;
  const t = ctx.currentTime;

  const dur = 0.2;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const p = i / data.length;
    const env = Math.sin(p * Math.PI);
    data[i] = (Math.random() * 2 - 1) * env * 0.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1500, t);
  filter.frequency.exponentialRampToValueAtTime(500, t + dur);
  filter.Q.value = 2;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.18, t);
  gain.gain.linearRampToValueAtTime(0, t + dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  src.start(t);
  src.stop(t + dur);
}

/** Death sound — low boom + crash */
export function playDeath() {
  if (!ctx || !masterGain) return;
  const t = ctx.currentTime;

  // Low boom
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(30, t + 0.5);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.35, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.65);

  // Crash noise
  const dur = 0.4;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const env = Math.pow(1 - i / data.length, 2);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const crashGain = ctx.createGain();
  crashGain.gain.setValueAtTime(0.3, t);
  crashGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(3000, t);
  filter.frequency.exponentialRampToValueAtTime(200, t + dur);

  src.connect(filter);
  filter.connect(crashGain);
  crashGain.connect(masterGain);
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** Stop all audio (cleanup) */
export function stopAudio() {
  if (!ctx) return;
  droneGain?.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
  windGain?.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
}
