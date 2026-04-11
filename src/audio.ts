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
  music?.fadeOut();
}

// ============================================================
// Procedural Music System
// Generative electronic soundtrack — pentatonic arpeggios,
// pulsing bass, atmospheric pad. Reacts to speed & phase state.
// ============================================================

// C minor pentatonic across 2 octaves
const SCALE = [
  130.81, 155.56, 174.61, 196.00, 233.08, // C3-Bb3
  261.63, 311.13, 349.23, 392.00, 466.16, // C4-Bb4
];

// Bass root notes for chord progression: Cm → Fm → Gm → Eb
const BASS_ROOTS = [65.41, 87.31, 98.00, 77.78];

// Arp patterns — index offsets into SCALE per beat group
const ARP_PATTERNS = [
  [0, 2, 4, 7],    // rising 4th
  [7, 5, 4, 2],    // falling
  [0, 4, 2, 5],    // bounce
  [4, 7, 9, 7],    // high bounce
];

class ProceduralMusic {
  private audioCtx: AudioContext;
  private output: GainNode;
  private active = false;

  // Arp voice
  private arpOsc: OscillatorNode | null = null;
  private arpFilter: BiquadFilterNode | null = null;
  private arpGain: GainNode | null = null;

  // Bass voice
  private bassOsc: OscillatorNode | null = null;
  private bassGain: GainNode | null = null;

  // Pad voices (3 oscillators = triad)
  private padOscs: OscillatorNode[] = [];
  private padFilter: BiquadFilterNode | null = null;
  private padGain: GainNode | null = null;

  // Sub-bass (sine for weight)
  private subOsc: OscillatorNode | null = null;
  private subGain: GainNode | null = null;

  // Timing state
  private beatAccum = 0;
  private sixteenthCount = 0;
  private chordIndex = 0;
  private patternIndex = 0;

  constructor(audioCtx: AudioContext, output: GainNode) {
    this.audioCtx = audioCtx;
    this.output = output;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.beatAccum = 0;
    this.sixteenthCount = 0;
    this.chordIndex = 0;
    this.patternIndex = 0;

    const c = this.audioCtx;
    const t = c.currentTime;

    // --- Arp: sawtooth → filter → gain ---
    this.arpOsc = c.createOscillator();
    this.arpOsc.type = "sawtooth";
    this.arpOsc.frequency.value = SCALE[0];

    this.arpFilter = c.createBiquadFilter();
    this.arpFilter.type = "lowpass";
    this.arpFilter.frequency.value = 600;
    this.arpFilter.Q.value = 6;

    this.arpGain = c.createGain();
    this.arpGain.gain.value = 0;

    this.arpOsc.connect(this.arpFilter);
    this.arpFilter.connect(this.arpGain);
    this.arpGain.connect(this.output);
    this.arpOsc.start(t);

    // --- Bass: square → gain ---
    this.bassOsc = c.createOscillator();
    this.bassOsc.type = "square";
    this.bassOsc.frequency.value = BASS_ROOTS[0];

    const bassFilter = c.createBiquadFilter();
    bassFilter.type = "lowpass";
    bassFilter.frequency.value = 300;
    bassFilter.Q.value = 1;

    this.bassGain = c.createGain();
    this.bassGain.gain.value = 0;

    this.bassOsc.connect(bassFilter);
    bassFilter.connect(this.bassGain);
    this.bassGain.connect(this.output);
    this.bassOsc.start(t);

    // --- Sub bass: pure sine for rumble ---
    this.subOsc = c.createOscillator();
    this.subOsc.type = "sine";
    this.subOsc.frequency.value = BASS_ROOTS[0] * 0.5;

    this.subGain = c.createGain();
    this.subGain.gain.value = 0;

    this.subOsc.connect(this.subGain);
    this.subGain.connect(this.output);
    this.subOsc.start(t);

    // --- Pad: 3 triangle oscillators → filter → gain ---
    this.padFilter = c.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 500;
    this.padFilter.Q.value = 0.7;

    this.padGain = c.createGain();
    this.padGain.gain.value = 0;

    // Root, third, fifth of C minor pentatonic
    const padNotes = [SCALE[0] * 0.5, SCALE[2] * 0.5, SCALE[4] * 0.5];
    for (const freq of padNotes) {
      const osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      osc.connect(this.padFilter);
      osc.start(t);
      this.padOscs.push(osc);
    }

    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.output);
  }

  /** Call every frame with dt, current speed, and shatter state */
  update(dt: number, speed: number, isShattered: boolean) {
    if (!this.active || !this.audioCtx) return;

    const t = this.audioCtx.currentTime;
    const speedNorm = Math.min(speed / 45, 1);

    // BPM: 105 at start → 150 at max speed
    const bpm = 105 + speedNorm * 45;
    const sixteenthDur = 60 / bpm / 4;

    // Accumulate time and step on 16th note boundaries
    this.beatAccum += dt;

    while (this.beatAccum >= sixteenthDur) {
      this.beatAccum -= sixteenthDur;
      this.onSixteenthNote(t, speedNorm, isShattered);
      this.sixteenthCount++;
    }

    // Continuous parameter updates
    // Arp filter opens with speed — brighter at high speed
    const arpCutoff = 500 + speedNorm * 2500 + (isShattered ? 600 : 0);
    this.arpFilter!.frequency.setTargetAtTime(arpCutoff, t, 0.08);

    // Pad: warmer when solid, darker when shattered
    const padCutoff = 400 + speedNorm * 600 + (isShattered ? -150 : 0);
    this.padFilter!.frequency.setTargetAtTime(Math.max(200, padCutoff), t, 0.2);
    this.padGain!.gain.setTargetAtTime(
      isShattered ? 0.015 : 0.025 + speedNorm * 0.015,
      t, 0.15
    );
  }

  private onSixteenthNote(t: number, speedNorm: number, isShattered: boolean) {
    const count = this.sixteenthCount;

    // --- Arp note ---
    const pattern = ARP_PATTERNS[this.patternIndex % ARP_PATTERNS.length];
    const patternStep = count % 4;
    const noteIdx = pattern[patternStep] % SCALE.length;
    const freq = SCALE[noteIdx];
    // Detune when shattered for unease
    const detune = isShattered ? (Math.random() - 0.5) * 40 : 0;

    this.arpOsc!.frequency.setValueAtTime(freq, t);
    this.arpOsc!.detune.setValueAtTime(detune, t);

    // Accent on beat (every 4 sixteenths)
    const baseVol = 0.05 + speedNorm * 0.05;
    const accent = patternStep === 0 ? 1.6 : 1.0;
    this.arpGain!.gain.setValueAtTime(baseVol * accent, t);
    this.arpGain!.gain.setTargetAtTime(baseVol * 0.4, t + 0.02, 0.04);

    // --- Bass pulse every beat (4 sixteenths) ---
    if (count % 4 === 0) {
      const bassVol = 0.08 + speedNorm * 0.05;
      this.bassGain!.gain.setValueAtTime(bassVol, t);
      this.bassGain!.gain.setTargetAtTime(bassVol * 0.15, t + 0.01, 0.12);

      // Sub follows
      const subVol = 0.10 + speedNorm * 0.06;
      this.subGain!.gain.setValueAtTime(subVol, t);
      this.subGain!.gain.setTargetAtTime(subVol * 0.2, t + 0.01, 0.18);
    }

    // --- Chord change every 4 beats (16 sixteenths) ---
    if (count % 16 === 0 && count > 0) {
      this.chordIndex = (this.chordIndex + 1) % BASS_ROOTS.length;

      // Bass root
      this.bassOsc!.frequency.setTargetAtTime(
        BASS_ROOTS[this.chordIndex], t, 0.05
      );
      this.subOsc!.frequency.setTargetAtTime(
        BASS_ROOTS[this.chordIndex] * 0.5, t, 0.05
      );

      // Pad chord — shift scale degrees based on chord
      const offset = this.chordIndex * 2;
      for (let i = 0; i < this.padOscs.length; i++) {
        const idx = (offset + i * 2) % SCALE.length;
        this.padOscs[i].frequency.setTargetAtTime(
          SCALE[idx] * 0.5, t, 0.2
        );
      }
    }

    // --- Pattern change every 2 bars (32 sixteenths) ---
    if (count % 32 === 0 && count > 0) {
      this.patternIndex++;
    }
  }

  fadeOut() {
    if (!this.active) return;
    const t = this.audioCtx.currentTime;

    this.arpGain?.gain.setTargetAtTime(0, t, 0.2);
    this.bassGain?.gain.setTargetAtTime(0, t, 0.2);
    this.subGain?.gain.setTargetAtTime(0, t, 0.2);
    this.padGain?.gain.setTargetAtTime(0, t, 0.3);

    // Cleanup after fade
    const cleanup = () => {
      try {
        this.arpOsc?.stop();
        this.bassOsc?.stop();
        this.subOsc?.stop();
        for (const osc of this.padOscs) osc.stop();
      } catch { /* already stopped */ }
      this.padOscs = [];
      this.active = false;
    };
    setTimeout(cleanup, 800);
  }
}

let music: ProceduralMusic | null = null;

/** Start background music (call after initAudio) */
export function startMusic() {
  if (!ctx || !masterGain) return;
  if (!music) music = new ProceduralMusic(ctx, masterGain);
  music.start();
}

/** Update music each frame */
export function updateMusic(dt: number, speed: number, isShattered: boolean) {
  music?.update(dt, speed, isShattered);
}

/** Fade out music (on death / game over) */
export function fadeOutMusic() {
  music?.fadeOut();
  music = null; // allow fresh start on retry
}
