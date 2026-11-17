import { describe, expect, it } from 'vitest';
import {
  engineSoundParams,
  rivalSoundParams,
  RIVAL_SOUND,
  TYRE_SOUND,
  tyreSoundParams,
  type EngineSoundInput,
  type RivalSoundInput,
} from '../src/infra/engineSound';

/** The WebAudio side only glides towards these numbers, so the sound design is tested here. */

const base: EngineSoundInput = {
  rpm: 900,
  idleRpm: 900,
  redlineRpm: 7000,
  throttle: 0,
  acceleration: 0,
  limiter: false,
  wheelspin: 0,
  lateralSlip: 0,
  nitro: false,
  off: false,
  speedRatio: 0,
  wet: false,
  turboSpool: 0,
};

describe('engine note', () => {
  it('pitches with the RPM (two firings per revolution)', () => {
    expect(engineSoundParams(base).frequency).toBeCloseTo(30, 6);
    expect(engineSoundParams({ ...base, rpm: 6000 }).frequency).toBeCloseTo(200, 6);
  });

  it('is lumpy at idle and smooth at high revs', () => {
    expect(engineSoundParams(base).roughness).toBeGreaterThan(engineSoundParams({ ...base, rpm: 6500, throttle: 1 }).roughness);
  });

  it('is louder, brighter, grittier and roars through the intake pulling; crackles coasting', () => {
    const pulling = engineSoundParams({ ...base, rpm: 4500, throttle: 1, acceleration: 250 });
    const coasting = engineSoundParams({ ...base, rpm: 4500, throttle: 0, acceleration: -150 });
    expect(pulling.gain).toBeGreaterThan(coasting.gain);
    expect(pulling.filterHz).toBeGreaterThan(coasting.filterHz);
    expect(pulling.drive).toBeGreaterThan(coasting.drive);
    expect(pulling.intakeGain).toBeGreaterThan(0);
    expect(coasting.intakeGain).toBe(0);
    expect(coasting.crackleRate).toBeGreaterThan(0);
    expect(pulling.crackleRate).toBe(0);
  });

  it('keeps every level in a sane range across the whole map', () => {
    for (const rpm of [0, 900, 4000, 7300, 9000]) {
      for (const throttle of [0, 0.5, 1]) {
        for (const acceleration of [-800, 0, 800]) {
          const p = engineSoundParams({ ...base, rpm, throttle, acceleration, wheelspin: throttle, lateralSlip: rpm / 50 });
          for (const value of [p.gain, p.drive, p.roughness, p.intakeGain, p.tyre.gain, p.tyre.tonality, p.tyre.wobble]) {
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
          }
          expect(p.frequency).toBeGreaterThanOrEqual(20);
        }
      }
    }
  });

  it('chops on the limiter', () => {
    expect(engineSoundParams({ ...base, rpm: 7300, throttle: 1, limiter: true }).limiterDepth).toBeGreaterThan(0.5);
    expect(engineSoundParams({ ...base, rpm: 7000, throttle: 1 }).limiterDepth).toBe(0);
  });

  it('goes silent when the engine is dead, keeping the rain and the tyres', () => {
    const dead = engineSoundParams({ ...base, off: true, wet: true, rpm: 5000, throttle: 1, lateralSlip: 120 });
    expect(dead.gain).toBe(0);
    expect(dead.intakeGain).toBe(0);
    expect(dead.rainGain).toBeGreaterThan(0);
    expect(dead.tyre.gain).toBeGreaterThan(0);
  });

  it('adds rain and speed-dependent spray only in the wet', () => {
    expect(engineSoundParams({ ...base, speedRatio: 0.8 }).sprayGain).toBe(0);
    const slow = engineSoundParams({ ...base, wet: true, speedRatio: 0.1 });
    const fast = engineSoundParams({ ...base, wet: true, speedRatio: 0.9 });
    expect(fast.sprayGain).toBeGreaterThan(slow.sprayGain);
  });
});

describe('tyres', () => {
  it('are silent while the car grips', () => {
    expect(tyreSoundParams(0, 0, 0.5, false).gain).toBe(0);
    expect(tyreSoundParams(0, TYRE_SOUND.slideFrom, 0.5, false).gain).toBe(0);
  });

  it('scream clearly on wheelspin: pitched, wobbling and louder than the engine', () => {
    const spin = engineSoundParams({ ...base, rpm: 6300, throttle: 1, acceleration: 100, wheelspin: 1 });
    expect(spin.tyre.gain).toBeGreaterThan(spin.gain);
    expect(spin.tyre.tonality).toBeGreaterThan(0.8);
    expect(spin.tyre.wobble).toBeGreaterThan(0.9);
    expect(spin.tyre.pitch).toBeGreaterThan(1000);
  });

  it('climb in pitch with the revs while spinning', () => {
    expect(tyreSoundParams(1, 0, 1, false).pitch).toBeGreaterThan(tyreSoundParams(1, 0, 0.2, false).pitch);
  });

  it('tell a cornering slide from a wheelspin: quieter and lower', () => {
    const slide = tyreSoundParams(0, TYRE_SOUND.slideFull, 0.5, false);
    const spin = tyreSoundParams(1, 0, 0.5, false);
    expect(slide.gain).toBeGreaterThan(0);
    expect(slide.gain).toBeLessThan(spin.gain);
    expect(slide.pitch).toBeLessThan(spin.pitch);
    expect(slide.wobble).toBeLessThan(spin.wobble);
    // A harder slide squeals louder, up to the full-voice slip.
    expect(tyreSoundParams(0, 80, 0.5, false).gain).toBeLessThan(slide.gain);
    expect(tyreSoundParams(0, 400, 0.5, false).gain).toBeCloseTo(slide.gain, 9);
  });

  it('hiss rather than scream on a wet road, but stay clearly audible', () => {
    const dry = tyreSoundParams(1, 0, 0.6, false);
    const wet = tyreSoundParams(1, 0, 0.6, true);
    expect(wet.tonality).toBeLessThan(dry.tonality);
    expect(wet.pitch).toBeLessThan(dry.pitch);
    expect(wet.gain).toBeGreaterThan(0.5 * dry.gain);
  });

  it('survive garbage input', () => {
    expect(tyreSoundParams(Number.NaN, Number.NaN, 0.5, false).gain).toBe(0);
  });
});

describe('rival engines', () => {
  const near: RivalSoundInput = { rpm: 6000, throttle: 1, dx: 0, dy: -60, dvx: 0, dvy: 0, heading: 0, off: false };

  it('fade with distance and fall silent far away or when blown', () => {
    const close = rivalSoundParams(near);
    const far = rivalSoundParams({ ...near, dy: -800 });
    expect(close.gain).toBeGreaterThan(far.gain);
    expect(far.gain).toBeGreaterThan(0);
    expect(rivalSoundParams({ ...near, dy: -(RIVAL_SOUND.maxDistance + 1) }).gain).toBe(0);
    expect(rivalSoundParams({ ...near, off: true }).gain).toBe(0);
    // Never louder than Ned's own idle.
    expect(close.gain).toBeLessThanOrEqual(RIVAL_SOUND.nearGain);
  });

  it('fade to zero at the edge of hearing, with no pop', () => {
    const edge = rivalSoundParams({ ...near, dy: -(RIVAL_SOUND.maxDistance - 1) });
    expect(edge.gain).toBeLessThan(1e-4);
  });

  it('Doppler: higher when closing in, lower when pulling away', () => {
    const still = rivalSoundParams(near).frequency;
    // Rival ahead (−y) coming back towards Ned (+y), then running away.
    const closing = rivalSoundParams({ ...near, dvy: 300 }).frequency;
    const leaving = rivalSoundParams({ ...near, dvy: -300 }).frequency;
    expect(closing).toBeGreaterThan(still);
    expect(leaving).toBeLessThan(still);
    expect(still).toBeCloseTo(200, 6);
  });

  it('pans to the side the rival is on, relative to where Ned points', () => {
    // Heading 0 = facing +x; with y down, the driver's right is +y.
    expect(rivalSoundParams({ ...near, dx: 0, dy: 200 }).pan).toBeGreaterThan(0.5);
    expect(rivalSoundParams({ ...near, dx: 0, dy: -200 }).pan).toBeLessThan(-0.5);
    expect(rivalSoundParams({ ...near, dx: 200, dy: 0 }).pan).toBeCloseTo(0, 6);
    // Turn Ned round: sides swap.
    expect(rivalSoundParams({ ...near, dx: 0, dy: 200, heading: Math.PI }).pan).toBeLessThan(-0.5);
  });
});
