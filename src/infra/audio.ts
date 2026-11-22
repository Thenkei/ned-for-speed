/**
 * Procedural sound (WebAudio): no audio files to ship or license.
 * Every entry point is safe to call before the first user gesture or in a
 * browser without WebAudio: it simply stays silent.
 */

import { DEFAULT_ENGINE_PROFILE, MAX_BANG, type EngineSoundProfile } from './engineProfiles';
import type { EngineSoundParams, RivalSoundParams } from './engineSound';

export type UiSound = 'click' | 'buy' | 'error' | 'equip' | 'win' | 'lose' | 'jewel';
export type RaceSound =
  | 'beep'
  | 'go'
  | 'explosion'
  | 'scrape'
  | 'bump'
  | 'lap'
  | 'finish'
  | 'perfect-start'
  | 'bog'
  | 'wheelspin'
  | 'grip'
  | 'drift'
  | 'shift'
  | 'blowoff'
  | 'bang';

/** Every node of Ned's engine and tyre voice, so that it can be glided and torn down as one. */
interface EngineVoice {
  /** Which engine this is (pitch recipe, detune, resonances). */
  readonly profile: EngineSoundProfile;
  /** Firing-frequency oscillators (the profile's wave): main, a detuned twin for body, and a sub-octave. */
  readonly main: OscillatorNode;
  readonly twin: OscillatorNode;
  readonly sub: OscillatorNode;
  /** Grit: gain into a soft-clipping waveshaper, and make-up gain after it. */
  readonly preDrive: GainNode;
  readonly postDrive: GainNode;
  readonly filter: BiquadFilterNode;
  /** Amplitude modulation at half the firing rate: the idle "lump". */
  readonly lumpLfo: OscillatorNode;
  readonly lumpDepth: GainNode;
  readonly lumpNode: GainNode;
  /** Square chop for the rev limiter. */
  readonly limiterLfo: OscillatorNode;
  readonly limiterDepth: GainNode;
  readonly limiterNode: GainNode;
  /** Ignition cut on gear changes (scheduled, never glided). */
  readonly cutNode: GainNode;
  readonly gain: GainNode;
  readonly intakeFilter: BiquadFilterNode;
  readonly intakeGain: GainNode;
  /** Turbo whistle (silent on engines without one). */
  readonly turbo: OscillatorNode;
  readonly turboGain: GainNode;
  /** Tyres: pitched scream (two oscillators through a band-pass) plus band-passed hiss. */
  readonly tyreTone: OscillatorNode;
  readonly tyreOvertone: OscillatorNode;
  readonly tyreToneFilter: BiquadFilterNode;
  readonly tyreToneGain: GainNode;
  readonly tyreHissFilter: BiquadFilterNode;
  readonly tyreHissGain: GainNode;
  /** Irregular wobble of the screech pitch (two incommensurate LFOs), and its chatter. */
  readonly tyreLfos: readonly OscillatorNode[];
  readonly tyreWobbleDepth: GainNode;
  readonly tyreChatterDepth: GainNode;
  readonly tyreChatterNode: GainNode;
  /** Noise layers: intake, nitro hiss, tyre hiss, rain, road spray. */
  readonly noiseSources: readonly AudioBufferSourceNode[];
  readonly nitroGain: GainNode;
  readonly rainGain: GainNode;
  readonly sprayGain: GainNode;
  readonly rivals: readonly RivalVoice[];
  lastUpdate: number;
}

/** A rival's engine: simpler than Ned's, panned and Doppler-shifted by the caller. */
interface RivalVoice {
  readonly main: OscillatorNode;
  readonly sub: OscillatorNode;
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
  readonly panner: StereoPannerNode | undefined;
}

let context: AudioContext | undefined;
let master: GainNode | undefined;
let muted = false;
let noiseBuffer: AudioBuffer | undefined;
let engineVoice: EngineVoice | undefined;

function ensureContext(): AudioContext | undefined {
  if (context) {
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    return context;
  }
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return undefined;
    context = new Ctor();
    master = context.createGain();
    master.gain.value = muted ? 0 : 0.5;
    // Many layers can stack up (engine, tyres, rivals, crash): a gentle bus
    // compressor keeps the peaks from clipping without pumping.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 10;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;
    master.connect(limiter).connect(context.destination);
    return context;
  } catch (error) {
    console.warn('[audio] WebAudio unavailable', error);
    return undefined;
  }
}

function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

interface Tone {
  readonly frequency: number;
  readonly to?: number;
  readonly duration: number;
  readonly delay?: number;
  readonly type?: OscillatorType;
  readonly volume?: number;
}

function tone(spec: Tone): void {
  const ctx = ensureContext();
  if (!ctx || !master || muted) return;
  const start = ctx.currentTime + (spec.delay ?? 0);
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = spec.type ?? 'square';
  oscillator.frequency.setValueAtTime(spec.frequency, start);
  if (spec.to !== undefined) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to), start + spec.duration);
  const volume = spec.volume ?? 0.16;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration);
  oscillator.connect(gain).connect(master);
  oscillator.start(start);
  oscillator.stop(start + spec.duration + 0.03);
}

function burst(duration: number, volume: number, cutoff: number, sweepTo?: number, delay = 0): void {
  const ctx = ensureContext();
  if (!ctx || !master || muted) return;
  const start = ctx.currentTime + delay;
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoff, start);
  if (sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(sweepTo, start + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(gain).connect(master);
  source.start(start, Math.random() * 1.2);
  source.stop(start + duration + 0.05);
}

/** A one-shot tyre scream: a wobbling saw through a narrow band-pass, sliding down in pitch. */
function screech(duration: number, from: number, to: number, volume: number): void {
  const ctx = ensureContext();
  if (!ctx || !master || muted) return;
  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(from, now);
  oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 19;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = from * 0.05;
  vibrato.connect(vibratoDepth).connect(oscillator.frequency);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 6;
  band.frequency.setValueAtTime(from, now);
  band.frequency.exponentialRampToValueAtTime(to, now + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.03);
  gain.gain.setValueAtTime(volume, now + duration * 0.6);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(band).connect(gain).connect(master);
  for (const node of [oscillator, vibrato]) {
    node.start(now);
    node.stop(now + duration + 0.05);
  }
}

/**
 * Exhaust backfire: a chest-thump (falling sine), a sharp crack (high-passed
 * noise) and a short boom tail. Much bigger than an overrun crackle.
 */
function bang(strength: number): void {
  const ctx = ensureContext();
  if (!ctx || !master || muted) return;
  const s = Math.max(0.05, Math.min(MAX_BANG, strength));
  const now = ctx.currentTime;
  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(115, now);
  thump.frequency.exponentialRampToValueAtTime(38, now + 0.09);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0.0001, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.55 * s, now + 0.004);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
  thump.connect(thumpGain).connect(master);
  const crack = ctx.createBufferSource();
  crack.buffer = noise(ctx);
  const crackFilter = ctx.createBiquadFilter();
  crackFilter.type = 'highpass';
  crackFilter.frequency.value = 700;
  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(0.0001, now);
  crackGain.gain.exponentialRampToValueAtTime(0.45 * s, now + 0.002);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
  crack.connect(crackFilter).connect(crackGain).connect(master);
  thump.start(now);
  thump.stop(now + 0.16);
  crack.start(now, Math.random() * 1.2);
  crack.stop(now + 0.09);
  burst(0.2, 0.16 * s, 1100, 180, 0.01);
}

/** Turbo blow-off: a bright "pssh" of air, fluttering on a big turbo. */
function blowOff(flutter: number): void {
  const ctx = ensureContext();
  if (!ctx || !master || muted) return;
  const now = ctx.currentTime;
  const duration = 0.4;
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.1;
  band.frequency.setValueAtTime(4200, now);
  band.frequency.exponentialRampToValueAtTime(2200, now + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  const chop = ctx.createGain();
  source.connect(band).connect(gain).connect(chop).connect(master);
  const nodes: AudioScheduledSourceNode[] = [source];
  if (flutter > 0) {
    // Compressor surge: the air chatters back through the turbo.
    chop.gain.value = 1 - flutter * 0.45;
    const lfo = oscillator(ctx, 'square', 26, gainNode(ctx, flutter * 0.45, chop.gain));
    nodes.push(lfo);
  }
  source.start(now, Math.random() * 1.0);
  for (const node of nodes) {
    if (node !== source) node.start(now);
    node.stop(now + duration + 0.05);
  }
}

/** Gear change: the ignition cuts for a few hundredths of a second (and pops on an upshift). */
function shiftCut(direction: number): void {
  const voice = engineVoice;
  if (!voice || !context || muted) return;
  const now = context.currentTime;
  const cut = voice.cutNode.gain;
  cut.cancelScheduledValues(now);
  cut.setValueAtTime(1, now);
  cut.linearRampToValueAtTime(direction > 0 ? 0.22 : 0.5, now + 0.015);
  cut.setValueAtTime(direction > 0 ? 0.22 : 0.5, now + 0.07);
  cut.linearRampToValueAtTime(1, now + 0.13);
  if (direction > 0) burst(0.05, 0.16, 2200, 450, 0.03);
}

const UI_SOUNDS: Readonly<Record<UiSound, () => void>> = {
  click: () => tone({ frequency: 520, to: 700, duration: 0.06, volume: 0.08 }),
  equip: () => {
    tone({ frequency: 240, to: 180, duration: 0.07, type: 'sawtooth', volume: 0.12 });
    tone({ frequency: 620, duration: 0.07, delay: 0.07, volume: 0.1 });
  },
  buy: () => {
    tone({ frequency: 880, duration: 0.08, volume: 0.12 });
    tone({ frequency: 1320, duration: 0.14, delay: 0.08, volume: 0.12 });
  },
  jewel: () => {
    [1047, 1319, 1568, 2093].forEach((frequency, i) => tone({ frequency, duration: 0.16, delay: i * 0.07, type: 'triangle', volume: 0.14 }));
  },
  error: () => tone({ frequency: 180, to: 110, duration: 0.2, type: 'sawtooth', volume: 0.14 }),
  win: () => {
    [523, 659, 784, 1047].forEach((frequency, i) => tone({ frequency, duration: 0.2, delay: i * 0.12, volume: 0.14 }));
  },
  lose: () => {
    [392, 330, 262].forEach((frequency, i) => tone({ frequency, duration: 0.26, delay: i * 0.16, type: 'triangle', volume: 0.14 }));
  },
};

const RACE_SOUNDS: Readonly<Record<RaceSound, (strength: number) => void>> = {
  beep: () => tone({ frequency: 440, duration: 0.16, volume: 0.2 }),
  go: () => tone({ frequency: 880, duration: 0.5, volume: 0.22 }),
  lap: () => {
    tone({ frequency: 660, duration: 0.09, volume: 0.14 });
    tone({ frequency: 990, duration: 0.14, delay: 0.09, volume: 0.14 });
  },
  finish: () => {
    [659, 784, 1047, 1319].forEach((frequency, i) => tone({ frequency, duration: 0.18, delay: i * 0.1, volume: 0.15 }));
  },
  scrape: (strength) => burst(0.14, 0.08 + strength * 0.15, 4000, 1600),
  bump: (strength) => burst(0.14, 0.2 + strength * 0.3, 900, 200),
  explosion: () => {
    burst(1.3, 0.9, 1800, 60);
    tone({ frequency: 120, to: 30, duration: 0.9, type: 'sawtooth', volume: 0.4 });
  },
  'perfect-start': () => {
    [784, 1175, 1568].forEach((frequency, i) => tone({ frequency, duration: 0.14, delay: i * 0.06, type: 'triangle', volume: 0.16 }));
  },
  bog: () => tone({ frequency: 150, to: 70, duration: 0.45, type: 'sawtooth', volume: 0.12 }),
  // The bite of the tyres letting go; the continuous screech follows from the tyre voice.
  wheelspin: () => {
    screech(0.7, 1350, 1050, 0.2);
    burst(0.35, 0.18, 3200, 1400);
  },
  grip: () => tone({ frequency: 520, to: 880, duration: 0.12, type: 'triangle', volume: 0.12 }),
  // A clean drift paid out: a quick rising "cha-ching" towards the nitro.
  drift: () => {
    [659, 988, 1319].forEach((frequency, i) => tone({ frequency, duration: 0.1, delay: i * 0.05, type: 'triangle', volume: 0.14 }));
    tone({ frequency: 1760, to: 2637, duration: 0.18, delay: 0.15, type: 'sine', volume: 0.07 });
  },
  // Blow-off valve venting the boost; `strength` > 0 adds the big turbo's flutter ("tchu-tu-tu").
  blowoff: (strength) => blowOff(strength),
  // Pop-and-bang map: an exhaust backfire; `strength` 0–1.
  bang: (strength) => bang(strength),
  shift: (strength) => {
    // A dull clunk; upshifts (strength 1) slightly higher than downshifts.
    burst(0.05, 0.16, 700, 180);
    tone({ frequency: strength > 0 ? 95 : 75, duration: 0.05, type: 'square', volume: 0.06 });
    shiftCut(strength);
  },
};

function noiseLayer(ctx: AudioContext, destination: AudioNode, offset: number): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);
  source.loop = true;
  source.connect(destination);
  // Different offsets into the same buffer, or the layers would comb-filter each other.
  source.start(0, offset);
  return source;
}

function filtered(ctx: AudioContext, type: BiquadFilterType, frequency: number, q: number, out: AudioNode): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  filter.connect(out);
  return filter;
}

function silentGain(ctx: AudioContext, out: AudioNode): GainNode {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(out);
  return gain;
}

/**
 * Exhaust note: a strong firing fundamental with the profile's own, uneven
 * series of harmonics (a plain sawtooth sounds like a synth, not a car).
 * Built once per profile and audio context.
 */
const engineWaves = new WeakMap<AudioContext, Map<string, PeriodicWave>>();

function engineWaveFor(ctx: AudioContext, profile: EngineSoundProfile): PeriodicWave {
  let waves = engineWaves.get(ctx);
  if (!waves) {
    waves = new Map();
    engineWaves.set(ctx, waves);
  }
  const cached = waves.get(profile.id);
  if (cached) return cached;
  const real = new Float32Array(profile.harmonics.length);
  // Alternate the phases so the peaks do not all line up (smoother, less buzzy).
  const imag = new Float32Array(profile.harmonics.map((a, n) => (n % 3 === 2 ? -a : a)));
  const wave = ctx.createPeriodicWave(real, imag);
  waves.set(profile.id, wave);
  return wave;
}

/** Soft clipper (tanh): adds the grit of an engine under load. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = 2.5;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

/** Connects to a node or modulates a parameter (the overloads of `connect` do not accept the union). */
function connectTo(node: AudioNode, out: AudioNode | AudioParam): void {
  if (out instanceof AudioParam) node.connect(out);
  else node.connect(out);
}

function oscillator(ctx: AudioContext, type: OscillatorType, frequency: number, out: AudioNode | AudioParam): OscillatorNode {
  const node = ctx.createOscillator();
  node.type = type;
  node.frequency.value = frequency;
  connectTo(node, out);
  return node;
}

function gainNode(ctx: AudioContext, value: number, out: AudioNode | AudioParam): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  connectTo(node, out);
  return node;
}

function rivalVoice(ctx: AudioContext, out: AudioNode, profile: EngineSoundProfile): RivalVoice {
  // Not every WebAudio implementation has a stereo panner: fall back to mono.
  const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : undefined;
  if (panner) panner.connect(out);
  const gain = gainNode(ctx, 0, panner ?? out);
  const filter = filtered(ctx, 'lowpass', 600, 1.2, gain);
  const main = ctx.createOscillator();
  main.setPeriodicWave(engineWaveFor(ctx, profile));
  main.connect(filter);
  const sub = oscillator(ctx, 'triangle', 15, gainNode(ctx, 0.25 + profile.subLevel, filter));
  return { main, sub, filter, gain, panner };
}

/**
 * The narrow band-pass keeps only a sliver of the sawtooth's energy: make-up
 * gain so that a full wheelspin screams level with the engine (measured on
 * the master bus: the screech peak sits within ~1 dB of the engine's).
 */
const TYRE_TONE_MAKEUP = 1.8;

/** Every output level of a voice: what pausing or stopping fades out. */
function voiceGains(voice: EngineVoice): GainNode[] {
  return [
    voice.gain, voice.intakeGain, voice.turboGain, voice.nitroGain, voice.tyreToneGain, voice.tyreHissGain,
    voice.sprayGain, voice.rainGain, ...voice.rivals.map((rival) => rival.gain),
  ];
}

export const audio = {
  setMuted(value: boolean): void {
    muted = value;
    if (master && context) master.gain.setTargetAtTime(value ? 0 : 0.5, context.currentTime, 0.02);
  },
  isMuted(): boolean {
    return muted;
  },
  ui(sound: UiSound): void {
    UI_SOUNDS[sound]();
  },
  race(sound: RaceSound, strength = 1): void {
    RACE_SOUNDS[sound](strength);
  },

  /** Builds Ned's engine and tyre voice, plus one engine voice per rival (in sim order). */
  startEngine(engines: { readonly player?: EngineSoundProfile; readonly rivals?: readonly EngineSoundProfile[] } = {}): void {
    const ctx = ensureContext();
    if (!ctx || !master || engineVoice) return;
    try {
      const gain = silentGain(ctx, master);
      const cutNode = gainNode(ctx, 1, gain);
      const limiterNode = gainNode(ctx, 1, cutNode);
      const lumpNode = gainNode(ctx, 1, limiterNode);
      // Two fixed exhaust resonances: harmonics swell as the revs sweep through them.
      const profile = engines.player ?? DEFAULT_ENGINE_PROFILE;
      const [droneHz, boomHz] = profile.resonances;
      const boom = filtered(ctx, 'peaking', boomHz, 2, lumpNode);
      boom.gain.value = 5;
      const drone = filtered(ctx, 'peaking', droneHz, 1.4, boom);
      drone.gain.value = 6;
      const filter = filtered(ctx, 'lowpass', 500, 1.6, drone);
      const postDrive = gainNode(ctx, 1, filter);
      const shaper = ctx.createWaveShaper();
      shaper.curve = softClipCurve();
      shaper.oversample = '2x';
      shaper.connect(postDrive);
      const preDrive = gainNode(ctx, 1, shaper);

      const wave = engineWaveFor(ctx, profile);
      const main = ctx.createOscillator();
      main.setPeriodicWave(wave);
      main.connect(gainNode(ctx, 0.7, preDrive));
      const twin = ctx.createOscillator();
      twin.setPeriodicWave(wave);
      twin.connect(gainNode(ctx, 0.35, preDrive));
      const sub = oscillator(ctx, 'square', 15, gainNode(ctx, profile.subLevel, preDrive));

      // Turbo whistle: a pure, slightly breathy tone above the engine.
      const turboGain = silentGain(ctx, master);
      const turbo = oscillator(ctx, 'sine', 1800, filtered(ctx, 'highpass', 900, 0.7, turboGain));

      // The LFOs add to their target gain's intrinsic value (1 - depth/2 … 1 + depth/2).
      const lumpDepth = gainNode(ctx, 0, lumpNode.gain);
      const lumpLfo = oscillator(ctx, 'sine', 15, lumpDepth);
      const limiterDepth = gainNode(ctx, 0, limiterNode.gain);
      const limiterLfo = oscillator(ctx, 'square', 22, limiterDepth);

      // Tyres: a pitched scream with an irregular wobble and chatter, plus hiss.
      const tyreChatterNode = gainNode(ctx, 1, master);
      const tyreToneGain = gainNode(ctx, 0, tyreChatterNode);
      const tyreHissGain = gainNode(ctx, 0, tyreChatterNode);
      const tyreToneFilter = filtered(ctx, 'bandpass', 1000, 5, tyreToneGain);
      const tyreHissFilter = filtered(ctx, 'bandpass', 1000, 2.5, tyreHissGain);
      const tyreTone = oscillator(ctx, 'sawtooth', 1000, tyreToneFilter);
      const tyreOvertone = oscillator(ctx, 'triangle', 2010, gainNode(ctx, 0.35, tyreToneFilter));
      const tyreWobbleDepth = gainNode(ctx, 0, tyreTone.frequency);
      const tyreChatterDepth = gainNode(ctx, 0, tyreChatterNode.gain);
      const tyreLfos = [7.3, 17.9].map((frequency) => {
        const lfo = oscillator(ctx, 'sine', frequency, tyreWobbleDepth);
        lfo.connect(tyreChatterDepth);
        return lfo;
      });

      const intakeGain = silentGain(ctx, master);
      const intakeFilter = filtered(ctx, 'bandpass', 500, 1.2, intakeGain);
      const nitroGain = silentGain(ctx, master);
      const rainGain = silentGain(ctx, master);
      const sprayGain = silentGain(ctx, master);
      const rainHigh = filtered(ctx, 'highpass', 900, 0.5, rainGain);
      const noiseSources = [
        noiseLayer(ctx, filtered(ctx, 'bandpass', 2600, 0.7, nitroGain), 0),
        noiseLayer(ctx, tyreHissFilter, 0.37),
        noiseLayer(ctx, filtered(ctx, 'lowpass', 6000, 0.3, rainHigh), 0.74),
        noiseLayer(ctx, filtered(ctx, 'bandpass', 650, 0.8, sprayGain), 1.11),
        noiseLayer(ctx, intakeFilter, 0.19),
      ];

      const bus = master;
      const rivals = (engines.rivals ?? []).map((rivalProfile) => rivalVoice(ctx, bus, rivalProfile));

      for (const node of [main, twin, sub, turbo, lumpLfo, limiterLfo, tyreTone, tyreOvertone, ...tyreLfos]) node.start();
      for (const rival of rivals) {
        rival.main.start();
        rival.sub.start();
      }
      engineVoice = {
        profile, main, twin, sub, preDrive, postDrive, filter,
        lumpLfo, lumpDepth, lumpNode, limiterLfo, limiterDepth, limiterNode, cutNode, gain,
        intakeFilter, intakeGain, turbo, turboGain,
        tyreTone, tyreOvertone, tyreToneFilter, tyreToneGain, tyreHissFilter, tyreHissGain,
        tyreLfos, tyreWobbleDepth, tyreChatterDepth, tyreChatterNode,
        noiseSources, nitroGain, rainGain, sprayGain, rivals,
        lastUpdate: ctx.currentTime,
      };
    } catch (error) {
      console.warn('[audio] could not build the engine voice', error);
    }
  },

  /** Glides Ned's voice towards new parameters (see `engineSound.ts`). Call once per frame. */
  updateEngine(params: EngineSoundParams): void {
    const voice = engineVoice;
    if (!voice || !context) return;
    const now = context.currentTime;
    const elapsed = Math.min(0.1, Math.max(0, now - voice.lastUpdate));
    voice.lastUpdate = now;

    // Pitch follows quickly (an engine is light), level and tone a little slower.
    voice.main.frequency.setTargetAtTime(params.frequency, now, 0.03);
    voice.twin.frequency.setTargetAtTime(params.frequency * voice.profile.twinDetune, now, 0.03);
    voice.sub.frequency.setTargetAtTime(params.frequency / 2, now, 0.03);
    voice.lumpLfo.frequency.setTargetAtTime(params.frequency / 2, now, 0.03);
    voice.filter.frequency.setTargetAtTime(params.filterHz, now, 0.05);
    voice.gain.gain.setTargetAtTime(params.gain, now, 0.06);
    // More drive into the clipper, less make-up after it: grittier, not louder.
    voice.preDrive.gain.setTargetAtTime(1 + params.drive * 3, now, 0.08);
    voice.postDrive.gain.setTargetAtTime(1 / (1 + params.drive * 1.2), now, 0.08);
    voice.lumpNode.gain.setTargetAtTime(1 - params.roughness / 2, now, 0.05);
    voice.lumpDepth.gain.setTargetAtTime(params.roughness / 2, now, 0.05);
    voice.limiterNode.gain.setTargetAtTime(1 - params.limiterDepth / 2, now, 0.02);
    voice.limiterDepth.gain.setTargetAtTime(params.limiterDepth / 2, now, 0.02);
    voice.intakeGain.gain.setTargetAtTime(params.intakeGain, now, 0.08);
    voice.intakeFilter.frequency.setTargetAtTime(params.intakeHz, now, 0.06);
    voice.turbo.frequency.setTargetAtTime(params.turboHz, now, 0.06);
    voice.turboGain.gain.setTargetAtTime(params.turboGain, now, 0.06);
    voice.nitroGain.gain.setTargetAtTime(params.nitroGain, now, 0.05);
    voice.rainGain.gain.setTargetAtTime(params.rainGain, now, 0.3);
    voice.sprayGain.gain.setTargetAtTime(params.sprayGain, now, 0.1);

    // Tyres: fast attack so a wheelspin is heard the instant it starts.
    const { tyre } = params;
    const jitter = 1 + (Math.random() - 0.5) * 0.04 * tyre.wobble;
    const pitch = tyre.pitch * jitter;
    voice.tyreTone.frequency.setTargetAtTime(pitch, now, 0.03);
    voice.tyreOvertone.frequency.setTargetAtTime(pitch * 2.01, now, 0.03);
    voice.tyreToneFilter.frequency.setTargetAtTime(pitch, now, 0.03);
    voice.tyreHissFilter.frequency.setTargetAtTime(pitch * 1.3, now, 0.05);
    voice.tyreWobbleDepth.gain.setTargetAtTime(pitch * 0.045 * tyre.wobble, now, 0.05);
    voice.tyreChatterNode.gain.setTargetAtTime(1 - 0.18 * tyre.wobble, now, 0.05);
    voice.tyreChatterDepth.gain.setTargetAtTime(0.18 * tyre.wobble, now, 0.05);
    const attack = tyre.gain > voice.tyreToneGain.gain.value ? 0.02 : 0.08;
    voice.tyreToneGain.gain.setTargetAtTime(tyre.gain * tyre.tonality * TYRE_TONE_MAKEUP, now, attack);
    voice.tyreHissGain.gain.setTargetAtTime(tyre.gain * (0.3 + 0.9 * (1 - tyre.tonality)), now, attack);

    // Exhaust crackles on the overrun: a Poisson process sampled once per frame.
    if (params.crackleRate > 0 && Math.random() < params.crackleRate * elapsed) {
      burst(0.035 + Math.random() * 0.03, 0.1 + Math.random() * 0.12, 2400, 500);
    }
  },

  /** Rival engines, in the order the voices were created (see `rivalSoundParams`). */
  updateRivals(params: readonly RivalSoundParams[]): void {
    const voice = engineVoice;
    if (!voice || !context) return;
    const now = context.currentTime;
    voice.rivals.forEach((rival, index) => {
      const p = params[index];
      if (!p) {
        rival.gain.gain.setTargetAtTime(0, now, 0.1);
        return;
      }
      rival.main.frequency.setTargetAtTime(p.frequency, now, 0.04);
      rival.sub.frequency.setTargetAtTime(p.frequency / 2, now, 0.04);
      rival.filter.frequency.setTargetAtTime(p.filterHz, now, 0.08);
      rival.gain.gain.setTargetAtTime(p.gain, now, 0.08);
      rival.panner?.pan.setTargetAtTime(p.pan, now, 0.05);
    });
  },

  /** Ramps every voice down without stopping it (pause screen). */
  quietEngine(): void {
    const voice = engineVoice;
    if (!voice || !context) return;
    const now = context.currentTime;
    for (const node of voiceGains(voice)) node.gain.setTargetAtTime(0, now, 0.05);
  },

  stopEngine(): void {
    if (!engineVoice || !context) return;
    const voice = engineVoice;
    engineVoice = undefined;
    const now = context.currentTime;
    for (const node of voiceGains(voice)) node.gain.setTargetAtTime(0, now, 0.05);
    const stopAt = now + 0.4;
    try {
      const sources = [
        voice.main, voice.twin, voice.sub, voice.turbo, voice.lumpLfo, voice.limiterLfo,
        voice.tyreTone, voice.tyreOvertone, ...voice.tyreLfos, ...voice.noiseSources,
        ...voice.rivals.flatMap((rival) => [rival.main, rival.sub]),
      ];
      for (const source of sources) source.stop(stopAt);
    } catch (error) {
      console.warn('[audio] engine voice already stopped', error);
    }
  },
};
