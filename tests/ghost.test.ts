import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canRunTimeTrial, newGame, timeTrialSetup } from '../src/domain/game';
import {
  beatsRecord,
  GHOST_FRAME_HZ,
  ghostKey,
  ghostPose,
  GhostRecorder,
  isGhostRun,
  SECTORS_PER_LAP,
  sectorsPassed,
  splitDelta,
  TIME_TRIAL_LAPS,
  type GhostRun,
} from '../src/domain/ghost';
import type { GameState } from '../src/domain/types';
import { DISTRICTS } from '../src/domain/world';
import { createAutopilot, createRaceSim, stepRaceSim, type RaceSim } from '../src/race/sim';

const DT = 1 / 120;
const parking = DISTRICTS[0]!;

const meta = (time: number) => ({
  trackId: 'parking',
  weather: 'dry' as const,
  modelId: 'biquette',
  laps: 1,
  time,
  bestLap: time,
  recordedAt: '2026-11-17T00:00:00.000Z',
});

/** A straight-line run along x at 100 px/s on a 300 px "track" (1 lap, 3 sectors). */
function straightRun(): GhostRun {
  const recorder = new GhostRecorder(300, SECTORS_PER_LAP);
  for (let t = 0; t <= 3.05; t += 0.01) recorder.sample(t, t * 100, 50, 0, t * 100);
  const run = recorder.finish(meta(3));
  if (!run) throw new Error('run should be complete');
  return run;
}

describe('ghost recording', () => {
  it('counts checkpoints from the race progress', () => {
    expect(sectorsPassed(-40, 300)).toBe(0);
    expect(sectorsPassed(0, 300)).toBe(0);
    expect(sectorsPassed(99, 300)).toBe(0);
    expect(sectorsPassed(100, 300)).toBe(1);
    expect(sectorsPassed(900, 300)).toBe(9);
    expect(sectorsPassed(Number.NaN, 300)).toBe(0);
    expect(sectorsPassed(100, 0)).toBe(0);
  });

  it('keeps one frame per tenth of a second and the time of every checkpoint', () => {
    const run = straightRun();
    expect(run.frames.length / 3).toBeCloseTo(3.05 * GHOST_FRAME_HZ + 1, -0.5);
    expect(run.splits).toHaveLength(SECTORS_PER_LAP);
    run.splits.forEach((split, i) => expect(split).toBeCloseTo(i + 1, 1));
  });

  it('reports each checkpoint once, as it is crossed', () => {
    const recorder = new GhostRecorder(300, 3);
    expect(recorder.sample(0.5, 0, 0, 0, 50)).toBeUndefined();
    expect(recorder.sample(1.0, 0, 0, 0, 100)).toBe(0);
    expect(recorder.sample(1.1, 0, 0, 0, 110)).toBeUndefined();
    // A jump (reset to the road) fills every skipped checkpoint.
    expect(recorder.sample(2.0, 0, 0, 0, 300)).toBe(2);
  });

  it('refuses an unfinished run', () => {
    const recorder = new GhostRecorder(300, 3);
    recorder.sample(0, 0, 0, 0, 0);
    recorder.sample(1, 100, 0, 0, 150);
    expect(recorder.finish(meta(1))).toBeUndefined();
  });
});

describe('ghost replay', () => {
  it('interpolates between frames and parks at the end', () => {
    const run = straightRun();
    expect(ghostPose(run, 1.25)?.x).toBeCloseTo(125, 0);
    expect(ghostPose(run, 1.25)?.y).toBeCloseTo(50, 1);
    const end = ghostPose(run, 99)!;
    expect(end.x).toBeCloseTo(ghostPose(run, 3.05)!.x, 6);
    expect(ghostPose(run, -1)).toBeUndefined();
    expect(ghostPose({ ...run, frames: [] }, 1)).toBeUndefined();
  });

  it('turns the short way round when the heading wraps past ±π', () => {
    const recorder = new GhostRecorder(300, 1);
    recorder.sample(0, 0, 0, Math.PI - 0.1, 0);
    recorder.sample(0.1, 0, 0, -Math.PI + 0.1, 300);
    const run = recorder.finish({ ...meta(0.1), laps: 1 })!;
    const mid = ghostPose({ ...run, splits: [0.1] }, 0.05)!;
    expect(Math.abs(Math.abs(mid.heading) - Math.PI)).toBeLessThan(0.01);
  });

  it('measures splits and records', () => {
    const run = straightRun();
    expect(splitDelta(run, 0, 0.8)).toBeCloseTo(0.8 - run.splits[0]!, 9);
    expect(splitDelta(run, 7, 1)).toBeUndefined();
    expect(beatsRecord(run, undefined)).toBe(true);
    expect(beatsRecord({ ...run, time: 2.9 }, run)).toBe(true);
    expect(beatsRecord({ ...run, time: 3 }, run)).toBe(false);
    expect(ghostKey('port', 'wet', 'cobra')).toBe('port/wet/cobra');
  });

  it('validates what comes back from storage', () => {
    const run = straightRun();
    expect(isGhostRun(JSON.parse(JSON.stringify(run)))).toBe(true);
    expect(isGhostRun(null)).toBe(false);
    expect(isGhostRun({ ...run, version: 2 })).toBe(false);
    expect(isGhostRun({ ...run, weather: 'snow' })).toBe(false);
    expect(isGhostRun({ ...run, time: -1 })).toBe(false);
    expect(isGhostRun({ ...run, splits: [1] })).toBe(false);
    expect(isGhostRun({ ...run, frames: [1, 2] })).toBe(false);
    expect(isGhostRun({ ...run, frames: [1, 2, 'x'] })).toBe(false);
  });
});

describe('time trial in the race', () => {
  it('puts Ned alone on the track, with the chosen weather and a fixed seed', () => {
    const state = newGame(3);
    const setup = timeTrialSetup(state, parking, 'wet');
    expect(setup.rivals).toHaveLength(0);
    expect(setup.laps).toBe(TIME_TRIAL_LAPS);
    expect(setup.weather).toBe('wet');
    expect(setup.trackId).toBe(parking.trackId);
    expect(timeTrialSetup(newGame(99), parking, 'dry').seed).toBe(setup.seed);
    expect(timeTrialSetup(state, DISTRICTS[1]!, 'dry').seed).not.toBe(setup.seed);
  });

  it('is open on unlocked districts with a running engine only', () => {
    const state = newGame(3);
    expect(canRunTimeTrial(state, parking).ok).toBe(true);
    expect(canRunTimeTrial(state, DISTRICTS[1]!).ok).toBe(false);
    const dead: GameState = { ...state, cars: state.cars.map((car) => ({ ...car, condition: 0 })) };
    expect(canRunTimeTrial(dead, parking).ok).toBe(false);
  });

  /**
   * Drives a full time trial with the autopilot, recording it like the race
   * loop does: every step, and on through the outro after the finish line.
   */
  function drive(sim: RaceSim): { run: GhostRun | undefined; trail: { t: number; x: number; y: number }[] } {
    const recorder = new GhostRecorder(sim.track.length, sim.setup.laps * SECTORS_PER_LAP);
    const pilot = createAutopilot(sim);
    const trail: { t: number; x: number; y: number }[] = [];
    for (let i = 0; i < 120 * 400 && (sim.phase !== 'finished' || sim.finishedFor < 1); i++) {
      stepRaceSim(sim, pilot(sim.player, DT), DT);
      if (sim.phase === 'countdown') continue;
      const p = sim.player;
      recorder.sample(sim.time, p.x, p.y, p.heading, p.progress);
      trail.push({ t: sim.time, x: p.x, y: p.y });
    }
    const p = sim.player;
    const run = recorder.finish({
      trackId: sim.setup.trackId,
      weather: sim.weather.id,
      modelId: 'biquette',
      laps: sim.setup.laps,
      time: p.finishTime ?? sim.time,
      bestLap: p.bestLap,
      recordedAt: 'now',
    });
    return { run, trail };
  }

  it.each(['dry', 'wet'] as const)('records a complete run whose ghost retraces the car (%s)', (weather) => {
    const sim = createRaceSim(timeTrialSetup(newGame(3), parking, weather));
    const { run, trail } = drive(sim);
    expect(run).toBeDefined();
    if (!run) return;
    expect(sim.player.finished).toBe(true);
    expect(run.splits).toHaveLength(TIME_TRIAL_LAPS * SECTORS_PER_LAP);
    expect(run.splits.at(-1)).toBeCloseTo(run.time, 9);
    for (let i = 1; i < run.splits.length; i++) expect(run.splits[i]!).toBeGreaterThan(run.splits[i - 1]!);
    expect(isGhostRun(JSON.parse(JSON.stringify(run)))).toBe(true);

    // The ghost passes where the car passed, at every step and through the
    // outro. At 10 Hz the error is up to one step of lag plus the chord of a
    // curve: under a quarter of a car (cars are ~46 px long).
    let worst = 0;
    for (const point of trail) {
      const pose = ghostPose(run, point.t)!;
      worst = Math.max(worst, Math.hypot(pose.x - point.x, pose.y - point.y));
    }
    expect(worst).toBeLessThan(10);

    // A 3-lap run stays small enough to keep many records in localStorage.
    expect(JSON.stringify(run).length).toBeLessThan(40_000);
  }, 30_000);
});

describe('record storage', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('saves and reloads a record per track, weather and car, dropping corrupt entries', async () => {
    const { loadGhost, saveGhost } = await import('../src/infra/storage');
    const run = straightRun();
    expect(loadGhost('parking', 'dry', 'biquette')).toBeUndefined();
    expect(saveGhost(run)).toBe(true);
    expect(loadGhost('parking', 'dry', 'biquette')?.time).toBe(run.time);
    expect(loadGhost('parking', 'wet', 'biquette')).toBeUndefined();

    // A fresh page load with a damaged entry keeps the good ones only.
    const raw = JSON.parse(store.get('ned-for-speed/ghosts/v1')!) as Record<string, unknown>;
    raw['port/dry/cobra'] = { version: 1, junk: true };
    store.set('ned-for-speed/ghosts/v1', JSON.stringify(raw));
    vi.resetModules();
    const reloaded = await import('../src/infra/storage');
    expect(reloaded.loadGhost('parking', 'dry', 'biquette')?.time).toBe(run.time);
    expect(reloaded.loadGhost('port', 'dry', 'cobra')).toBeUndefined();
  });

  it('reports a failed write instead of throwing (quota, private mode)', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { saveGhost, loadGhost } = await import('../src/infra/storage');
    expect(saveGhost(straightRun())).toBe(false);
    expect(loadGhost('parking', 'dry', 'biquette')).toBeUndefined();
  });
});
