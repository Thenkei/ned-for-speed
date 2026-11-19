import { describe, expect, it } from 'vitest';
import { eventRaceSetup, newGame } from '../src/domain/game';
import { DISTRICTS } from '../src/domain/world';
import { CrashReplay } from '../src/race/crashReplay';
import { createRaceSim } from '../src/race/sim';

function race() {
  const district = DISTRICTS[0]!;
  return createRaceSim(eventRaceSetup(newGame(7), district, district.events[0]!));
}

describe('crash replay', () => {
  it('keeps the last two seconds and interpolates rival poses across the heading wrap', () => {
    const sim = race();
    const replay = new CrashReplay();
    const rival = sim.cars[0]!;
    for (let i = 0; i <= 36; i++) {
      sim.time = i / 10;
      rival.x = 100 * sim.time;
      rival.heading = i % 2 === 0 ? 3.1 : -3.1;
      replay.record(sim, 0);
    }
    expect(replay.start).toBeCloseTo(1.6);
    const pose = replay.carsAt(2.05)[rival.id]!;
    expect(pose.x).toBeCloseTo(205);
    expect(Math.abs(pose.heading)).toBeCloseTo(Math.PI);
    replay.clear();
    expect(replay.carsAt(2)).toEqual([]);
  });

  it('preserves pre-impact bodywork and emits the fatal hit once at its exact tick', () => {
    const sim = race();
    const replay = new CrashReplay();
    replay.record(sim, 0);
    const car = sim.player;
    sim.time = 1 / 120;
    car.bodyDamage.push({ kind: 'dent', x: 15, y: 0, angle: 0, length: 8 });
    car.engine = { ...car.engine, exploded: true, explosionCause: 'wall' };
    sim.events.push({ type: 'explosion', carId: car.id });
    replay.record(sim, 0);
    expect(replay.carsAt(sim.time / 2)[car.id]!.bodyDamage).toHaveLength(0);
    expect(replay.carsAt(sim.time / 2)[car.id]!.engine.exploded).toBe(false);
    expect(replay.carsAt(sim.time)[car.id]!.bodyDamage).toHaveLength(1);
    expect(replay.effectsBetween(0, sim.time)).toEqual(sim.events);
    expect(replay.effectsBetween(sim.time, sim.time + 1)).toEqual([]);
  });
});
