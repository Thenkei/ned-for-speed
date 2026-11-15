/**
 * Procedural sound (WebAudio): no audio files to ship or license.
 * Every entry point is safe to call before the first user gesture or in a
 * browser without WebAudio: it simply stays silent.
 */

export type UiSound = 'click' | 'buy' | 'error' | 'equip' | 'win' | 'lose' | 'jewel';
export type RaceSound = 'beep' | 'go' | 'explosion' | 'bump' | 'lap' | 'finish';

interface EngineVoice {
  readonly main: OscillatorNode;
  readonly sub: OscillatorNode;
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
  readonly nitroGain: GainNode;
  readonly nitroSource: AudioBufferSourceNode;
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
    master.connect(context.destination);
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

function burst(duration: number, volume: number, cutoff: number, sweepTo?: number): void {
  const ctx = ensureContext();
  if (!ctx || !master || muted) return;
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoff, ctx.currentTime);
  if (sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  source.connect(filter).connect(gain).connect(master);
  source.start();
  source.stop(ctx.currentTime + duration + 0.05);
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
  bump: (strength) => burst(0.14, 0.2 + strength * 0.3, 900, 200),
  explosion: () => {
    burst(1.3, 0.9, 1800, 60);
    tone({ frequency: 120, to: 30, duration: 0.9, type: 'sawtooth', volume: 0.4 });
  },
};

export interface EngineSoundState {
  /** 0–1 revs within the current gear. */
  readonly revs: number;
  readonly throttle: number;
  readonly nitro: boolean;
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

  startEngine(): void {
    const ctx = ensureContext();
    if (!ctx || !master || engineVoice) return;
    const main = ctx.createOscillator();
    main.type = 'sawtooth';
    const sub = ctx.createOscillator();
    sub.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    main.connect(filter);
    sub.connect(subGain).connect(filter);
    filter.connect(gain).connect(master);

    const nitroSource = ctx.createBufferSource();
    nitroSource.buffer = noise(ctx);
    nitroSource.loop = true;
    const nitroFilter = ctx.createBiquadFilter();
    nitroFilter.type = 'bandpass';
    nitroFilter.frequency.value = 2600;
    nitroFilter.Q.value = 0.7;
    const nitroGain = ctx.createGain();
    nitroGain.gain.value = 0;
    nitroSource.connect(nitroFilter).connect(nitroGain).connect(master);

    main.start();
    sub.start();
    nitroSource.start();
    engineVoice = { main, sub, filter, gain, nitroGain, nitroSource };
  },

  updateEngine(state: EngineSoundState): void {
    if (!engineVoice || !context) return;
    const now = context.currentTime;
    const frequency = 48 + state.revs * 150;
    engineVoice.main.frequency.setTargetAtTime(frequency, now, 0.04);
    engineVoice.sub.frequency.setTargetAtTime(frequency / 2, now, 0.04);
    engineVoice.filter.frequency.setTargetAtTime(380 + state.revs * 1500 + state.throttle * 500, now, 0.06);
    engineVoice.gain.gain.setTargetAtTime(0.05 + state.throttle * 0.06, now, 0.08);
    engineVoice.nitroGain.gain.setTargetAtTime(state.nitro ? 0.22 : 0, now, 0.05);
  },

  stopEngine(): void {
    if (!engineVoice || !context) return;
    const voice = engineVoice;
    engineVoice = undefined;
    const now = context.currentTime;
    voice.gain.gain.setTargetAtTime(0, now, 0.05);
    voice.nitroGain.gain.setTargetAtTime(0, now, 0.05);
    const stopAt = now + 0.4;
    try {
      voice.main.stop(stopAt);
      voice.sub.stop(stopAt);
      voice.nitroSource.stop(stopAt);
    } catch (error) {
      console.warn('[audio] engine voice already stopped', error);
    }
  },
};
