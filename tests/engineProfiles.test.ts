import { describe, expect, it } from 'vitest';
import { CAR_MODELS } from '../src/domain/cars';
import type { BodyKind } from '../src/domain/types';
import {
  DEFAULT_ENGINE_PROFILE,
  ENGINE_SOUND_PROFILES,
  engineProfileFor,
  firingFrequency,
  IDLE_TURBO,
  stepTurbo,
  type EngineSoundProfile,
  type TurboState,
} from '../src/infra/engineProfiles';
import { engineSoundParams, rivalSoundParams, type EngineSoundInput } from '../src/infra/engineSound';

const BODIES = Object.keys(ENGINE_SOUND_PROFILES) as BodyKind[];
const DT = 1 / 60;

const pulling: EngineSoundInput = {
  rpm: 5000,
  idleRpm: 900,
  redlineRpm: 7000,
  throttle: 1,
  acceleration: 200,
  limiter: false,
  wheelspin: 0,
  lateralSlip: 0,
  nitro: false,
  off: false,
  speedRatio: 0.5,
  wet: false,
  turboSpool: 0,
};

/** A fingerprint of everything that makes a voice recognisable. */
const fingerprint = (p: EngineSoundProfile): string =>
  JSON.stringify([p.cylinders, p.harmonics, p.subLevel, p.resonances, p.brightness, p.roughness, p.turbo, p.camNorm]);

function runTurbo(profile: EngineSoundProfile, throttle: (t: number) => number, seconds: number, start: TurboState = IDLE_TURBO) {
  let state = start;
  let blowOffs = 0;
  for (let t = 0; t < seconds; t += DT) {
    const step = stepTurbo(state, { throttle: throttle(t), revs: 0.8 }, profile, DT);
    state = step.state;
    if (step.blowOff) blowOffs++;
  }
  return { state, blowOffs };
}

describe('engine voices', () => {
  it('every car on sale, and every rival body, has its own engine', () => {
    for (const model of CAR_MODELS) expect(ENGINE_SOUND_PROFILES[model.body].id).toBe(model.body);
    const prints = new Set(BODIES.map((body) => fingerprint(ENGINE_SOUND_PROFILES[body])));
    expect(prints.size).toBe(BODIES.length);
  });

  it('falls back to the classic voice for an unknown body', () => {
    expect(engineProfileFor(undefined)).toBe(DEFAULT_ENGINE_PROFILE);
    expect(engineProfileFor('nope' as BodyKind)).toBe(DEFAULT_ENGINE_PROFILE);
    // The default is the voice the game always had: a four, rpm / 30.
    expect(engineSoundParams({ ...pulling, rpm: 6000 }).frequency).toBeCloseTo(200, 6);
  });

  it('pitches by cylinder count: a six sings 1.5× a four, the V10 2.5×', () => {
    const at = (body: BodyKind): number => engineSoundParams(pulling, ENGINE_SOUND_PROFILES[body]).frequency;
    expect(at('sport') / at('hatch')).toBeCloseTo(1.5, 6);
    expect(at('super') / at('hatch')).toBeCloseTo(2.5, 6);
    expect(firingFrequency(6000, ENGINE_SOUND_PROFILES.muscle)).toBeCloseTo(300, 6);
  });

  it('gives each engine its character', () => {
    const p = (body: BodyKind, input: Partial<EngineSoundInput> = {}) =>
      engineSoundParams({ ...pulling, ...input }, ENGINE_SOUND_PROFILES[body]);
    // Grandma's car: dull and lumpy; the V10: bright; the V6 brute: grittiest.
    expect(p('city').filterHz).toBeLessThan(p('hatch').filterHz);
    expect(p('super').filterHz).toBeGreaterThan(p('hatch').filterHz);
    expect(p('city', { rpm: 900, throttle: 0 }).roughness).toBeGreaterThan(p('sport', { rpm: 900, throttle: 0 }).roughness);
    expect(p('muscle').drive).toBeGreaterThan(p('sport').drive);
    // The hatch's straight-through exhaust pops more than the old city car's.
    const lift = { rpm: 5000, throttle: 0, acceleration: -150 };
    expect(p('hatch', lift).crackleRate).toBeGreaterThan(p('city', lift).crackleRate);
  });

  it('the Cobra’s cam kicks in up top and the note hardens', () => {
    const cobra = ENGINE_SOUND_PROFILES.coupe;
    const span = pulling.redlineRpm - pulling.idleRpm;
    const rpmAt = (norm: number): number => pulling.idleRpm + norm * span;
    const below = engineSoundParams({ ...pulling, rpm: rpmAt(cobra.camNorm - 0.01) }, cobra);
    const above = engineSoundParams({ ...pulling, rpm: rpmAt(cobra.camNorm + 0.01) }, cobra);
    expect(above.filterHz / below.filterHz).toBeGreaterThan(1.25);
    expect(above.gain).toBeGreaterThan(below.gain);
  });

  it('keeps every level in range for every engine', () => {
    for (const body of BODIES) {
      for (const rpm of [0, 900, 4000, 7300]) {
        for (const throttle of [0, 1]) {
          const out = engineSoundParams({ ...pulling, rpm, throttle, turboSpool: 1 }, ENGINE_SOUND_PROFILES[body]);
          for (const value of [out.gain, out.drive, out.roughness, out.turboGain]) {
            expect(Number.isFinite(value), body).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
          }
          expect(out.frequency).toBeGreaterThanOrEqual(20);
          expect(out.filterHz).toBeGreaterThan(out.frequency);
        }
      }
    }
  });

  it('rivals sound like their own car too', () => {
    const rival = { rpm: 6000, throttle: 1, dx: 0, dy: -80, dvx: 0, dvy: 0, heading: 0, off: false };
    expect(rivalSoundParams(rival, ENGINE_SOUND_PROFILES.super).frequency).toBeCloseTo(500, 6);
    expect(rivalSoundParams(rival, ENGINE_SOUND_PROFILES.city).frequency).toBeCloseTo(200, 6);
    expect(rivalSoundParams(rival, ENGINE_SOUND_PROFILES.super).filterHz).toBeGreaterThan(
      rivalSoundParams(rival, ENGINE_SOUND_PROFILES.city).filterHz,
    );
  });
});

describe('turbo', () => {
  const sakura = ENGINE_SOUND_PROFILES.sport;
  const bulldozer = ENGINE_SOUND_PROFILES.muscle;

  it('only the turbo cars whistle', () => {
    for (const body of BODIES) {
      const profile = ENGINE_SOUND_PROFILES[body];
      const { state, blowOffs } = runTurbo(profile, (t) => (t < 2 ? 1 : 0), 2.5);
      const whistle = engineSoundParams({ ...pulling, turboSpool: 1 }, profile).turboGain;
      if (profile.turbo) {
        expect(whistle, body).toBeGreaterThan(0);
        expect(blowOffs, body).toBe(1);
      } else {
        expect(whistle, body).toBe(0);
        expect(blowOffs, body).toBe(0);
        expect(state.spool, body).toBe(0);
      }
    }
  });

  it('spools with lag, the big turbo lagging most, and the whistle rises with boost', () => {
    const after = (profile: EngineSoundProfile, seconds: number): number => runTurbo(profile, () => 1, seconds).state.spool;
    expect(after(sakura, 0.3)).toBeGreaterThan(after(bulldozer, 0.3));
    expect(after(sakura, 0.3)).toBeLessThan(0.7);
    expect(after(bulldozer, 4)).toBeGreaterThan(0.95);
    const low = engineSoundParams({ ...pulling, turboSpool: 0.2 }, bulldozer);
    const high = engineSoundParams({ ...pulling, turboSpool: 0.9 }, bulldozer);
    expect(high.turboHz).toBeGreaterThan(low.turboHz);
    expect(high.turboGain).toBeGreaterThan(low.turboGain);
  });

  it('builds no boost at low revs', () => {
    let state = IDLE_TURBO;
    for (let t = 0; t < 3; t += DT) state = stepTurbo(state, { throttle: 1, revs: 0.1 }, bulldozer, DT).state;
    expect(state.spool).toBe(0);
  });

  it('vents with a blow-off only when lifting on boost, and only once', () => {
    // Lift before the turbo has spooled: no blow-off.
    expect(runTurbo(bulldozer, (t) => (t < 0.15 ? 1 : 0), 1).blowOffs).toBe(0);
    // Lift on boost: exactly one, and the boost collapses.
    const spooled = runTurbo(bulldozer, () => 1, 3).state;
    const lift = stepTurbo(spooled, { throttle: 0, revs: 0.8 }, bulldozer, DT);
    expect(lift.blowOff).toBe(true);
    expect(lift.state.spool).toBeLessThan(spooled.spool * 0.5);
    expect(stepTurbo(lift.state, { throttle: 0, revs: 0.8 }, bulldozer, DT).blowOff).toBe(false);
    // The big turbo flutters, the Sakura's just hisses.
    expect(bulldozer.turbo?.flutter).toBeGreaterThan(0);
    expect(sakura.turbo?.flutter).toBe(0);
  });

  it('survives garbage input', () => {
    const step = stepTurbo(IDLE_TURBO, { throttle: Number.NaN, revs: Number.NaN }, bulldozer, DT);
    expect(step.state.spool).toBe(0);
    expect(step.blowOff).toBe(false);
  });
});

