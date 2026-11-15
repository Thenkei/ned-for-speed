import { describe, expect, it } from 'vitest';
import {
  MAX_HEAT,
  driveSpecFrom,
  engineSpecFrom,
  explosionHazard,
  initialEngineState,
  nitroProfile,
  stepEngine,
  type EngineSpec,
  type EngineState,
} from '../src/domain/engine';
import type { Stats } from '../src/domain/types';

const stats = (overrides: Partial<Stats> = {}): Stats => ({
  topSpeed: 50,
  accel: 50,
  handling: 50,
  reliability: 50,
  nitro: 40,
  ...overrides,
});

/** Holds the nitro down and returns the time at which the redline is crossed. */
function secondsToRedline(spec: EngineSpec): number {
  let state = initialEngineState(spec);
  const dt = 1 / 120;
  for (let t = 0; t < 30; t += dt) {
    // roll = 1 can never trigger the probabilistic explosion.
    state = stepEngine(state, { ...spec, nitroTank: 999 }, { throttle: 1, nitroRequested: true }, dt, 1);
    if (state.heat > spec.redline) return t;
  }
  return Infinity;
}

describe('engine heat model', () => {
  it('heats up under nitro and cools down afterwards', () => {
    const spec = engineSpecFrom(stats(), 100);
    let state: EngineState = initialEngineState(spec);
    for (let i = 0; i < 120; i++) state = stepEngine(state, spec, { throttle: 1, nitroRequested: true }, 1 / 120, 1);
    const hot = state.heat;
    expect(hot).toBeGreaterThan(40);
    expect(state.nitro).toBeLessThan(spec.nitroTank);
    for (let i = 0; i < 600; i++) state = stepEngine(state, spec, { throttle: 1, nitroRequested: false }, 1 / 120, 1);
    expect(state.heat).toBeLessThan(hot);
  });

  it('never explodes below the redline, always at maximum heat', () => {
    const spec = engineSpecFrom(stats(), 100);
    expect(explosionHazard(spec.redline - 1, spec)).toBe(0);
    expect(explosionHazard(spec.redline + 5, spec)).toBeGreaterThan(0);
    expect(explosionHazard(MAX_HEAT, spec)).toBe(Number.POSITIVE_INFINITY);

    const safe = stepEngine({ ...initialEngineState(spec), heat: spec.redline - 5 }, spec, { throttle: 1, nitroRequested: false }, 1 / 60, 0);
    expect(safe.exploded).toBe(false);
    const doomed = stepEngine({ ...initialEngineState(spec), heat: 99.99 }, spec, { throttle: 1, nitroRequested: true }, 1 / 60, 0.999);
    expect(doomed.exploded).toBe(true);
  });

  it('rolls the dice above the redline', () => {
    const spec = engineSpecFrom(stats(), 100);
    const hot: EngineState = { ...initialEngineState(spec), heat: spec.redline + 10 };
    expect(stepEngine(hot, spec, { throttle: 1, nitroRequested: false }, 1 / 60, 0).exploded).toBe(true);
    expect(stepEngine(hot, spec, { throttle: 1, nitroRequested: false }, 1 / 60, 0.99).exploded).toBe(false);
  });

  it('rewards reliability with more nitro time before the red zone', () => {
    const fragile = secondsToRedline(engineSpecFrom(stats({ reliability: 30 }), 100));
    const solid = secondsToRedline(engineSpecFrom(stats({ reliability: 110 }), 100));
    expect(solid).toBeGreaterThan(fragile * 1.4);
  });

  it('lowers the redline of a worn engine and accumulates wear in the red', () => {
    const fresh = engineSpecFrom(stats(), 100);
    const worn = engineSpecFrom(stats(), 30);
    expect(worn.redline).toBeLessThan(fresh.redline);
    const state = stepEngine({ ...initialEngineState(fresh), heat: fresh.redline + 10 }, fresh, { throttle: 1, nitroRequested: false }, 0.5, 1);
    expect(state.wear).toBeGreaterThan(0);
  });

  it('has no nitro at all without a kit', () => {
    const spec = engineSpecFrom(stats({ nitro: 0 }), 100);
    const state = stepEngine(initialEngineState(spec), spec, { throttle: 1, nitroRequested: true }, 1 / 60, 1);
    expect(spec.nitroTank).toBe(0);
    expect(state.nitroActive).toBe(false);
  });

  it('stops being an explosion risk once the engine is dead', () => {
    const spec = engineSpecFrom(stats(), 100);
    const dead: EngineState = { ...initialEngineState(spec), exploded: true, heat: 100 };
    expect(stepEngine(dead, spec, { throttle: 1, nitroRequested: true }, 1, 0)).toBe(dead);
  });
});

describe('nitro profile shown in the garage', () => {
  it('matches what the simulation actually allows', () => {
    const spec = engineSpecFrom(stats(), 100);
    const profile = nitroProfile(spec);
    // Bring the engine to cruising temperature, then hold the nitro.
    let state = initialEngineState(spec);
    for (let i = 0; i < 120 * 20; i++) state = stepEngine(state, spec, { throttle: 1, nitroRequested: false }, 1 / 120, 1);
    let seconds = 0;
    const endless = { ...spec, nitroTank: 999 };
    state = { ...state, nitro: 999 };
    while (state.heat <= spec.redline && seconds < 30) {
      state = stepEngine(state, endless, { throttle: 1, nitroRequested: true }, 1 / 120, 1);
      seconds += 1 / 120;
    }
    expect(profile.secondsToRedline).toBeCloseTo(seconds, 1);
    expect(profile.tank).toBe(spec.nitroTank);
  });

  it('gives a reliable car more nitro time', () => {
    const fragile = nitroProfile(engineSpecFrom(stats({ reliability: 30 }), 100));
    const solid = nitroProfile(engineSpecFrom(stats({ reliability: 110 }), 100));
    expect(solid.secondsToRedline).toBeGreaterThan(fragile.secondsToRedline);
  });
});

describe('drive spec', () => {
  it('is monotonic in every stat', () => {
    const low = driveSpecFrom(stats({ topSpeed: 30, accel: 30, handling: 30 }), 100);
    const high = driveSpecFrom(stats({ topSpeed: 90, accel: 90, handling: 90 }), 100);
    expect(high.maxSpeed).toBeGreaterThan(low.maxSpeed);
    expect(high.accel).toBeGreaterThan(low.accel);
    expect(high.grip).toBeGreaterThan(low.grip);
  });

  it('makes a tired engine slower', () => {
    expect(driveSpecFrom(stats(), 20).maxSpeed).toBeLessThan(driveSpecFrom(stats(), 100).maxSpeed);
  });
});
