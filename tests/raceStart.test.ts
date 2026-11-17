import { describe, expect, it } from 'vitest';
import { idealThrottleLead } from '../src/domain/launch';
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
 * Integration of the drivetrain, the race start and the weather with the race
 * simulation. Ned is steered by the autopilot so that only the pedals under
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

/** Runs the countdown with Ned pressing the throttle `lead` seconds before the light (Infinity: the whole time). */
function countdown(sim: RaceSim, lead: number, events: SimEvent[] = []): void {
  while (sim.phase === 'countdown') {
    const throttle = sim.countdown <= lead ? 1 : 0;
    stepRaceSim(sim, { throttle, brake: 0, steer: 0, nitro: false }, DT);
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

/** Ned's events only: rivals launch too. */
const playerEvents = (sim: RaceSim, events: readonly SimEvent[]): SimEvent[] =>
  events.filter((e) => !('carId' in e) || e.carId === sim.player.id);

function launchGrade(sim: RaceSim, events: readonly SimEvent[]): string | undefined {
  const launch = playerEvents(sim, events).find((e): e is Extract<SimEvent, { type: 'launch' }> => e.type === 'launch');
  return launch?.grade;
}

describe('race start', () => {
  it('lets Ned rev on the grid while the rivals wait for their moment, without moving anyone', () => {
    const sim = createRaceSim(setup());
    const positions = sim.cars.map((c) => [c.x, c.y]);
    for (let i = 0; i < 120; i++) stepRaceSim(sim, { throttle: 1, brake: 0, steer: 0, nitro: false }, DT);
    expect(sim.phase).toBe('countdown');
    expect(sim.player.drivetrain.rpm).toBeGreaterThan(4000);
    for (const rival of sim.cars.filter((c) => !c.isPlayer)) expect(rival.drivetrain.rpm).toBe(rival.gearbox.tuning.idleRpm);
    expect(sim.cars.map((c) => [c.x, c.y])).toEqual(positions);
  });

  it('grades the start from the throttle timing', () => {
    const grade = (lead: number): string | undefined => {
      const sim = createRaceSim(setup());
      const events: SimEvent[] = [];
      countdown(sim, lead, events);
      return launchGrade(sim, events);
    };
    expect(grade(idealThrottleLead())).toBe('perfect');
    expect(grade(Number.POSITIVE_INFINITY)).toBe('over');
    expect(grade(0.1)).toBe('under');
    expect(grade(-1)).toBe('under'); // never pressed before the light
  });

  it('rewards a perfect start and penalises both mistakes', () => {
    const distance = (lead: number): number => {
      const sim = createRaceSim(setup());
      countdown(sim, lead);
      return drive(sim, 3, () => 1);
    };
    const perfect = distance(idealThrottleLead());
    const late = distance(0.1);
    const early = distance(Number.POSITIVE_INFINITY);
    expect(perfect).toBeGreaterThan(late);
    expect(perfect).toBeGreaterThan(early);
    // Wheelspin halves the drive: it must cost real distance.
    expect(early).toBeLessThan(perfect * 0.85);
  });

  it('wheelspin is cancelled by lifting and pressing again, and that pays off', () => {
    const run = (cancel: boolean): { distance: number; events: SimEvent[] } => {
      const sim = createRaceSim(setup());
      const events: SimEvent[] = [];
      countdown(sim, Number.POSITIVE_INFINITY, events);
      // A blip of two steps off the throttle half a second in.
      const distance = drive(sim, 4, (t) => (cancel && t > 0.5 && t < 0.5 + 2 * DT ? 0 : 1), events);
      return { distance, events: playerEvents(sim, events) };
    };
    const held = run(false);
    const cancelled = run(true);
    expect(cancelled.events.some((e) => e.type === 'launch-end' && e.endedBy === 'cancelled')).toBe(true);
    expect(held.events.some((e) => e.type === 'launch-end' && e.endedBy === 'cancelled')).toBe(false);
    expect(cancelled.distance).toBeGreaterThan(held.distance);
  });

  it('wheelspin wears off by itself within ~5 s', () => {
    const sim = createRaceSim(setup());
    countdown(sim, Number.POSITIVE_INFINITY);
    expect(sim.player.launch?.phase).toBe('wheelspin');
    drive(sim, 5.2, () => 1);
    expect(sim.player.launch?.phase).toBe('done');
    expect(sim.player.wheelspin).toBe(0);
  });

  it('never blows the engine, nor sends the car off the road, however long it is held on the limiter', () => {
    for (const weather of ['dry', 'wet'] as const) {
      const sim = createRaceSim(setup({ weather }, 2, 0, 30));
      const heatBefore = sim.player.engine.heat;
      countdown(sim, Number.POSITIVE_INFINITY);
      expect(sim.player.engine.heat).toBe(heatBefore);
      let worstLateral = 0;
      drive(sim, 6, () => 1);
      for (const car of sim.cars) worstLateral = Math.max(worstLateral, Math.abs(car.lateral));
      expect(sim.player.engine.exploded, weather).toBe(false);
      expect(worstLateral).toBeLessThanOrEqual(sim.track.wallOffset);
      expect(sim.player.speed, weather).toBeGreaterThan(100);
    }
  });

  it('rivals launch too, graded by their skill, and catch their own wheelspin', () => {
    // Over a spread of seeds, the weakest grid (skill ~0.7) fluffs some starts.
    const grades: string[] = [];
    let caught = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const sim = createRaceSim(setup({ seed }));
      const events: SimEvent[] = [];
      countdown(sim, idealThrottleLead(), events);
      drive(sim, 7, () => 1, events);
      for (const e of events) {
        if (e.type === 'launch' && e.carId !== sim.player.id) grades.push(e.grade);
        if (e.type === 'launch-end' && e.carId !== sim.player.id && e.endedBy === 'cancelled') caught++;
      }
      for (const rival of sim.cars.filter((c) => !c.isPlayer)) {
        expect(rival.launch?.phase).toBe('done');
        expect(rival.engine.exploded).toBe(false);
      }
    }
    expect(grades).toHaveLength(60);
    expect(grades).toContain('perfect');
    expect(grades.some((g) => g !== 'perfect')).toBe(true);
    if (grades.includes('over')) expect(caught).toBeGreaterThan(0);
  });

  it('stays deterministic with launches, gears and rain', () => {
    const run = (): string => {
      const sim = createRaceSim(setup({ weather: 'wet' }), { playerTransmission: 'manual' });
      countdown(sim, Number.POSITIVE_INFINITY);
      drive(sim, 8, (t) => (t > 1 && t < 1.05 ? 0 : 1));
      return sim.cars.map((c) => `${c.x.toFixed(4)},${c.y.toFixed(4)},${c.drivetrain.rpm.toFixed(2)}`).join('|');
    };
    expect(run()).toBe(run());
  });
});

describe('transmission in the race', () => {
  it('shifts the automatic box up as the car gathers speed and reports the gear', () => {
    const sim = createRaceSim(setup());
    const events: SimEvent[] = [];
    countdown(sim, idealThrottleLead());
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
      countdown(sim, idealThrottleLead());
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
      countdown(sim, idealThrottleLead());
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
      countdown(sim, idealThrottleLead());
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
      countdown(sim, idealThrottleLead());
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
});
