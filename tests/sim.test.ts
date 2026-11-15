import { describe, expect, it } from 'vitest';
import type { RaceSetup, Racer, RivalSpec } from '../src/domain/types';
import { DISTRICTS } from '../src/domain/world';
import { createAutopilot, createRaceSim, raceOutcome, rankCars, stepRaceSim, type Controls } from '../src/race/sim';

const DT = 1 / 120;
const IDLE: Controls = { throttle: 0, brake: 0, steer: 0, nitro: false };

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

function setupFor(districtIndex: number, eventIndex: number, playerLevel: number): RaceSetup {
  const district = DISTRICTS[districtIndex]!;
  const event = district.events[eventIndex]!;
  return {
    title: event.name,
    trackId: district.trackId,
    theme: district.theme,
    laps: event.laps,
    player: ned(playerLevel),
    rivals: event.rivals.map(toRacer),
    seed: 2024,
  };
}

describe('race simulation', () => {
  it('lets the rivals finish every event on every track without getting lost', () => {
    for (let d = 0; d < DISTRICTS.length; d++) {
      const district = DISTRICTS[d]!;
      const event = district.events[district.events.length - 1]!;
      const sim = createRaceSim(setupFor(d, district.events.length - 1, 20));
      // Ned stays parked on the grid: the race ends on the straggler timeout.
      for (let i = 0; i < 120 * 400 && sim.phase !== 'finished'; i++) stepRaceSim(sim, IDLE, DT);
      const rivals = sim.cars.filter((c) => !c.isPlayer);
      expect(sim.phase, district.id).toBe('finished');
      for (const rival of rivals) {
        if (!rival.engine.exploded) expect(rival.finished, `${district.id}/${rival.racer.name}`).toBe(true);
      }
      const outcome = raceOutcome(sim, false);
      expect(outcome.position).toBe(event.rivals.length + 1);
    }
  }, 60_000);

  it('is deterministic for a given seed and input', () => {
    const run = (): string => {
      const sim = createRaceSim(setupFor(0, 1, 34));
      const pilot = createAutopilot(sim);
      for (let i = 0; i < 120 * 40; i++) stepRaceSim(sim, pilot(sim.player, DT), DT);
      return sim.cars.map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.engine.heat.toFixed(3)}`).join('|');
    };
    expect(run()).toBe(run());
  });

  it('lets a clearly faster car win from the back of the grid', () => {
    const sim = createRaceSim(setupFor(0, 0, 45));
    const pilot = createAutopilot(sim);
    for (let i = 0; i < 120 * 200 && sim.phase !== 'finished'; i++) stepRaceSim(sim, pilot(sim.player, DT), DT);
    const outcome = raceOutcome(sim, false);
    expect(outcome.position).toBe(1);
    expect(outcome.exploded).toBe(false);
    expect(outcome.bestLap).toBeGreaterThan(5);
    expect(rankCars(sim)[0]).toBe(sim.player);
  });

  it('blows the engine of a driver who never lifts off the nitro', () => {
    const setup = setupFor(2, 0, 60);
    const sim = createRaceSim({ ...setup, player: { ...setup.player, stats: { ...setup.player.stats, nitro: 140, reliability: 20 } } });
    const pilot = createAutopilot(sim);
    for (let i = 0; i < 120 * 60 && sim.phase !== 'finished'; i++) {
      stepRaceSim(sim, { ...pilot(sim.player, DT), throttle: 1, nitro: true }, DT);
    }
    expect(sim.player.engine.exploded).toBe(true);
    const outcome = raceOutcome(sim, false);
    expect(outcome.exploded).toBe(true);
    expect(outcome.position).toBe(sim.cars.length);
  });

  it('classifies an abandon as last', () => {
    const sim = createRaceSim(setupFor(0, 0, 45));
    for (let i = 0; i < 600; i++) stepRaceSim(sim, IDLE, DT);
    const outcome = raceOutcome(sim, true);
    expect(outcome.abandoned).toBe(true);
    expect(outcome.position).toBe(sim.cars.length);
  });

  it('keeps every car inside the walls', () => {
    const sim = createRaceSim(setupFor(3, 2, 82));
    const pilot = createAutopilot(sim);
    let worst = 0;
    for (let i = 0; i < 120 * 70; i++) {
      // A terrible driver: full throttle and nitro, steering late.
      const c = pilot(sim.player, DT);
      stepRaceSim(sim, { ...c, throttle: 1, brake: 0 }, DT);
      for (const car of sim.cars) worst = Math.max(worst, Math.abs(car.lateral));
    }
    expect(worst).toBeLessThanOrEqual(sim.track.wallOffset);
  });
});
