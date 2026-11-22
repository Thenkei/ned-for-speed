import { describe, expect, it } from 'vitest';
import { newGame, timeTrialSetup } from '../src/domain/game';
import { DRIFT_TUNING } from '../src/domain/tuning';
import { DISTRICTS } from '../src/domain/world';
import { driftNitroShare, stepDrift, type DriftRun, type DriftSample, type DriftStep } from '../src/race/drift';
import { createRaceSim, stepRaceSim, type Controls, type SimEvent } from '../src/race/sim';

const DT = 1 / 120;
const T = DRIFT_TUNING;

const sliding: DriftSample = { sliding: true, drift: 0.6, speed: 400, offRoad: false, contact: false };
const gripping: DriftSample = { ...sliding, sliding: false, drift: 0 };

/** Feeds `sample` for `seconds`, returning the last step and the first outcome seen. */
function feed(run: DriftRun | undefined, sample: DriftSample, seconds: number): { step: DriftStep; outcome: DriftStep['outcome'] } {
  let step: DriftStep = { run };
  let outcome: DriftStep['outcome'];
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    step = stepDrift(step.run, sample, DT);
    outcome ??= step.outcome;
  }
  return { step, outcome };
}

describe('drift tracking', () => {
  it('pays a held, caught drift in proportion to its depth and length, up to a cap', () => {
    const { step } = feed(undefined, sliding, 1);
    expect(step.run?.seconds).toBeCloseTo(1, 6);
    const { outcome } = feed(step.run, gripping, 0.3);
    expect(outcome).toMatchObject({ kind: 'clean' });
    if (outcome?.kind !== 'clean') return;
    expect(outcome.score).toBeCloseTo(0.6, 6);
    expect(outcome.nitroShare).toBeCloseTo(0.6 * T.nitroPerDriftSecond, 6);
    expect(driftNitroShare(100)).toBe(T.maxNitroShare);
    expect(driftNitroShare(-1)).toBe(0);
  });

  it('ignores twitches: too short, too slow, too shallow', () => {
    const short = feed(feed(undefined, sliding, T.minSeconds / 2).step.run, gripping, 0.3);
    expect(short.outcome).toBeUndefined();
    expect(short.step.run).toBeUndefined();
    expect(stepDrift(undefined, { ...sliding, speed: T.minSpeed - 1 }, DT).run).toBeUndefined();
    expect(stepDrift(undefined, { ...sliding, drift: T.minDrift / 2 }, DT).run).toBeUndefined();
  });

  it('survives the sliding flag flickering on the limit', () => {
    let run = feed(undefined, sliding, 0.5).step.run;
    run = feed(run, gripping, T.settleSeconds / 2).step.run;
    expect(run).toBeDefined();
    run = feed(run, sliding, 0.3).step.run;
    expect(run?.seconds).toBeCloseTo(0.8, 6);
  });

  it('pays nothing for a ruined drift, and says why', () => {
    const run = feed(undefined, sliding, 0.8).step.run;
    expect(stepDrift(run, { ...sliding, contact: true }, DT).outcome).toMatchObject({ kind: 'failed', reason: 'contact' });
    expect(stepDrift(run, { ...sliding, offRoad: true }, DT).outcome).toMatchObject({ kind: 'failed', reason: 'off-road' });
    const slow = feed(run, { ...gripping, speed: 400 * T.minExitSpeedShare - 1 }, 0.3).outcome;
    expect(slow).toMatchObject({ kind: 'failed', reason: 'scrubbed' });
    // A twitch that touches a wall is just a twitch: nothing to report.
    expect(stepDrift(feed(undefined, sliding, 0.1).step.run, { ...sliding, contact: true }, DT).outcome).toBeUndefined();
  });
});

describe('drifts in the race', () => {
  /**
   * Ned at speed on the industrial zone's start straight: full stick into a
   * slide, then lift and unwind to catch it. Returns the player's events.
   * (The road is narrow: only a short drift fits before the wall.)
   */
  let lastContact = (): number => Number.NaN;

  function drift(entrySeconds: number, side: 1 | -1 = 1, bumpMidDrift = false): { events: SimEvent[]; nitroBefore: number; nitroAfter: number } {
    const sim = createRaceSim(timeTrialSetup(newGame(3), DISTRICTS[1]!, 'dry'));
    while (sim.phase === 'countdown') stepRaceSim(sim, { throttle: 0, brake: 0, steer: 0, nitro: false }, DT);
    for (let t = 0; t < 1; t += DT) stepRaceSim(sim, { throttle: 1, brake: 0, steer: 0, nitro: false }, DT);
    sim.events.length = 0;
    const p = sim.player;
    p.launch = undefined;
    p.vx = Math.cos(p.heading) * 450;
    p.vy = Math.sin(p.heading) * 450;
    p.engine = { ...p.engine, nitro: 0 };
    const nitroBefore = p.engine.nitro;
    lastContact = () => p.lastContactAt;
    const events: SimEvent[] = [];
    const run = (controls: Controls, seconds: number) => {
      for (let t = 0; t < seconds; t += DT) {
        stepRaceSim(sim, controls, DT);
        events.push(...sim.events.filter((e) => 'carId' in e && e.carId === p.id));
        sim.events.length = 0;
      }
    };
    run({ throttle: 1, brake: 0, steer: side, nitro: false, analogSteer: true }, entrySeconds);
    const unwind: Controls = { throttle: 0, brake: 0, steer: -0.6 * side, nitro: false, analogSteer: true };
    run(unwind, 0.15);
    // A rival's nudge (or any contact) while still sideways, once the drift counts.
    if (bumpMidDrift) {
      expect(p.sliding).toBe(true);
      expect(p.driftRun?.seconds ?? 0).toBeGreaterThanOrEqual(DRIFT_TUNING.minSeconds);
      p.lastContactAt = sim.time;
    }
    run(unwind, 1.05);
    return { events, nitroBefore, nitroAfter: p.engine.nitro };
  }

  it('refills nitro after a clean drift', () => {
    const { events, nitroBefore, nitroAfter } = drift(0.6);
    const paid = events.find((e) => e.type === 'drift');
    expect(events.some((e) => e.type === 'wall' || e.type === 'bump')).toBe(false);
    expect(paid).toMatchObject({ type: 'drift', outcome: { kind: 'clean' } });
    expect(nitroAfter).toBeGreaterThan(nitroBefore);
  });

  it('pays nothing for a drift spoiled by contact', () => {
    const { events, nitroBefore, nitroAfter } = drift(0.6, 1, true);
    expect(events.find((e) => e.type === 'drift')).toMatchObject({ outcome: { kind: 'failed', reason: 'contact' }, nitroGained: 0 });
    // Only the slow refill of the bottle: less than the same drift kept clean.
    const clean = drift(0.6, 1);
    expect(nitroAfter - nitroBefore).toBeLessThan(clean.nitroAfter - clean.nitroBefore - 0.05);
  });

  it('counts a wall impact as contact', () => {
    const { events } = drift(0.6, -1);
    const wall = events.find((e) => e.type === 'wall');
    expect(wall).toBeDefined();
    expect(Number.isFinite(lastContact())).toBe(true);
    // A slide that meets the wall before it counted as a drift is just a twitch: no verdict.
    expect(events.some((e) => e.type === 'drift' && e.outcome.kind === 'clean')).toBe(false);
  });
});
