import { describe, expect, it } from 'vitest';
import type { RaceSetup, Racer, RivalSpec } from '../src/domain/types';
import { DISTRICTS } from '../src/domain/world';
import {
  createAutopilot,
  createRaceSim,
  raceOutcome,
  stepRaceSim,
  type Controls,
  type RaceSim,
  type SimEvent,
  type SimOptions,
} from '../src/race/sim';

/**
 * Integration of the drivetrain and the weather with the race simulation. Ned is steered by the autopilot so that only the pedals under
 * test differ between runs.
 */

const DT = 1 / 120;

const toRacer = (r: RivalSpec): Racer => ({
  name: r.name,
  look: { body: r.body, paint: r.paint, neon: r.neon, spoiler: r.spoiler },
  stats: r.stats,
  condition: 100,
  skill: r.skill,
  recklessness: r.recklessness,
});

const ned = (level: number): Racer => ({
  name: 'Ned',
  look: { body: 'city', paint: '#fff', neon: '', spoiler: false },
  stats: { topSpeed: level, accel: level, handling: level + 8, reliability: 55, nitro: 30 },
  condition: 100,
  skill: 0.9,
  recklessness: 0.2,
});

function setup(overrides: Partial<RaceSetup> = {}, districtIndex = 0, eventIndex = 0, level = 40): RaceSetup {
  const district = DISTRICTS[districtIndex]!;
  const event = district.events[eventIndex]!;
  return {
    title: event.name,
    trackId: district.trackId,
    theme: district.theme,
    laps: event.laps,
    player: ned(level),
    rivals: event.rivals.map(toRacer),
    seed: 99,
    ...overrides,
  };
}

/** Runs the countdown, Ned waiting on the grid. */
function countdown(sim: RaceSim, events: SimEvent[] = []): void {
  while (sim.phase === 'countdown') {
    stepRaceSim(sim, { throttle: 0, brake: 0, steer: 0, nitro: false }, DT);
    events.push(...sim.events);
    sim.events.length = 0;
  }
}

/** Drives on, autopilot steering, with the given throttle policy. Returns the distance covered. */
function drive(sim: RaceSim, seconds: number, throttle: (t: number) => number, events: SimEvent[] = []): number {
  const pilot = createAutopilot(sim);
  const start = sim.player.progress;
  for (let t = 0; t < seconds; t += DT) {
    const c = pilot(sim.player, DT);
    stepRaceSim(sim, { ...c, throttle: throttle(t), brake: 0, nitro: false }, DT);
    events.push(...sim.events);
    sim.events.length = 0;
  }
  return sim.player.progress - start;
}

describe('transmission in the race', () => {
  it('shifts the automatic box up as the car gathers speed and reports the gear', () => {
    const sim = createRaceSim(setup());
    const events: SimEvent[] = [];
    countdown(sim);
    drive(sim, 8, () => 1, events);
    expect(sim.player.drivetrain.gear).toBeGreaterThanOrEqual(3);
    expect(events.filter((e) => e.type === 'shift' && e.direction === 1).length).toBeGreaterThanOrEqual(2);
    // Rivals shift too, silently.
    expect(sim.cars.some((c) => !c.isPlayer && c.drivetrain.gear > 1)).toBe(true);
    expect(events.every((e) => e.type !== 'shift' || e.carId === sim.player.id)).toBe(true);
  });

  it('a manual driver stuck in first hits the limiter and goes nowhere fast', () => {
    const run = (options: SimOptions): RaceSim => {
      // Alone on the road: rivals bumping into Ned would blur the comparison.
      const sim = createRaceSim(setup({ rivals: [] }), options);
      countdown(sim);
      drive(sim, 6, () => 1);
      return sim;
    };
    const auto = run({ playerTransmission: 'auto' });
    const manual = run({ playerTransmission: 'manual' });
    expect(manual.player.drivetrain.gear).toBe(1);
    expect(manual.player.speed).toBeLessThan(auto.player.speed * 0.6);
    expect(manual.player.speed).toBeLessThanOrEqual(manual.player.gearbox.gearTopSpeeds[0]! * 1.05);
  });

  it('a manual driver who shifts well keeps up with the automatic', () => {
    const run = (transmission: 'auto' | 'manual'): number => {
      const sim = createRaceSim(setup({ rivals: [] }), { playerTransmission: transmission });
      countdown(sim);
      const pilot = createAutopilot(sim);
      const start = sim.player.progress;
      for (let t = 0; t < 12; t += DT) {
        const player = sim.player;
        const { tuning } = player.gearbox;
        let shift: Controls['shift'] = 0;
        if (transmission === 'manual') {
          const norm = player.drivetrain.rpm / tuning.redlineRpm;
          if (norm > 0.95) shift = 1;
          else if (norm < 0.45 && player.drivetrain.gear > 1) shift = -1;
        }
        stepRaceSim(sim, { ...pilot(player, DT), shift }, DT);
        sim.events.length = 0;
      }
      return sim.player.progress - start;
    };
    const auto = run('auto');
    const manual = run('manual');
    expect(manual).toBeGreaterThan(auto * 0.95);
  });
});

describe('wet weather in the race', () => {
  it('takes longer to stop from the same speed', () => {
    const BRAKE_FROM = 280;
    const stopping = (weather: 'dry' | 'wet'): number => {
      const sim = createRaceSim(setup({ weather }, 4, 0, 50));
      countdown(sim);
      const pilot = createAutopilot(sim);
      for (let i = 0; i < 120 * 10 && sim.player.speed < BRAKE_FROM; i++) {
        stepRaceSim(sim, { ...pilot(sim.player, DT), throttle: 1, brake: 0, nitro: false }, DT);
      }
      expect(sim.player.speed).toBeGreaterThanOrEqual(BRAKE_FROM);
      expect(sim.player.speed).toBeLessThan(BRAKE_FROM + 5);
      const from = sim.player.progress;
      for (let i = 0; i < 120 * 4 && sim.player.speed > 5; i++) {
        stepRaceSim(sim, { ...pilot(sim.player, DT), throttle: 0, brake: 1, nitro: false }, DT);
      }
      return sim.player.progress - from;
    };
    expect(stopping('wet')).toBeGreaterThan(stopping('dry') * 1.15);
  });

  it('spins the wheels under nitro where the dry road holds', () => {
    const peakSpin = (weather: 'dry' | 'wet'): number => {
      const sim = createRaceSim(setup({ weather, player: { ...ned(70), stats: { ...ned(70).stats, nitro: 90 } } }));
      countdown(sim);
      const pilot = createAutopilot(sim);
      let peak = 0;
      for (let t = 0; t < 3; t += DT) {
        stepRaceSim(sim, { ...pilot(sim.player, DT), throttle: 1, nitro: true }, DT);
        sim.events.length = 0;
        peak = Math.max(peak, sim.player.wheelspin);
      }
      return peak;
    };
    expect(peakSpin('dry')).toBe(0);
    expect(peakSpin('wet')).toBeGreaterThan(0.3);
  });

  it('is slower for the same driver, and every rival still finishes on every track', () => {
    for (let d = 0; d < DISTRICTS.length; d++) {
      const district = DISTRICTS[d]!;
      const sim = createRaceSim(setup({ weather: 'wet' }, d, district.events.length - 1, 20));
      for (let i = 0; i < 120 * 500 && sim.phase !== 'finished'; i++) {
        stepRaceSim(sim, { throttle: 0, brake: 0, steer: 0, nitro: false }, DT);
      }
      for (const rival of sim.cars.filter((c) => !c.isPlayer)) {
        if (!rival.engine.exploded) expect(rival.finished, `${district.id}/${rival.racer.name}`).toBe(true);
      }
    }

    const lap = (weather: 'dry' | 'wet'): number => {
      const sim = createRaceSim(setup({ weather, rivals: [] }, 0, 0, 45));
      const pilot = createAutopilot(sim);
      for (let i = 0; i < 120 * 200 && sim.phase !== 'finished'; i++) stepRaceSim(sim, pilot(sim.player, DT), DT);
      return raceOutcome(sim, false).time;
    };
    expect(lap('wet')).toBeGreaterThan(lap('dry') * 1.03);
  }, 60_000);

  it('stays deterministic with gears and rain', () => {
    const run = (): string => {
      const sim = createRaceSim(setup({ weather: 'wet' }), { playerTransmission: 'manual' });
      countdown(sim);
      drive(sim, 8, (t) => (t > 1 && t < 1.05 ? 0 : 1));
      return sim.cars.map((c) => `${c.x.toFixed(4)},${c.y.toFixed(4)},${c.drivetrain.rpm.toFixed(2)}`).join('|');
    };
    expect(run()).toBe(run());
  });
});
