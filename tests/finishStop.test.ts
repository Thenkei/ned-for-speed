import { describe, expect, it } from 'vitest';
import { activeCar, applyBossOutcome, applyEventOutcome, eventRaceSetup, newGame } from '../src/domain/game';
import { DISTRICTS } from '../src/domain/world';
import { createRaceSim, raceOutcome, stepRaceSim, type CarSim, type RaceSim } from '../src/race/sim';

const district = DISTRICTS[0]!;
const event = district.events[0]!;
const idle = { throttle: 0, brake: 0, steer: 0, nitro: false };
const dt = 1 / 120;

function race(recklessness = 0.9) {
  const setup = eventRaceSetup(newGame(1), district, event);
  const sim = createRaceSim({ ...setup, rivals: [{ ...setup.rivals[0]!, recklessness }] });
  sim.phase = 'racing';
  return sim;
}

function crossFinish(sim: RaceSim, car: CarSim) {
  const line = sim.track.samples[0]!;
  car.lap = sim.setup.laps - 1;
  car.s = sim.track.length - 1;
  car.trackIndex = 0;
  car.x = line.x - line.tx;
  car.y = line.y - line.ty;
  car.heading = Math.atan2(line.ty, line.tx);
  car.vx = line.tx * 400;
  car.vy = line.ty * 400;
  stepRaceSim(sim, idle, dt);
  expect(car.finished).toBe(true);
}

function advance(sim: RaceSim, seconds: number, burnout = false) {
  for (let i = 0; i < seconds * 120; i++) stepRaceSim(sim, { ...idle, burnout }, dt);
}

describe('finish-line celebrations', () => {
  it.each([0.2, 0.9])('parks a winning rival and lets personality decide the burnout (%s)', recklessness => {
    const sim = race(recklessness);
    const rival = sim.cars[0]!;
    crossFinish(sim, rival);
    const finish = rival.finishTime;
    crossFinish(sim, sim.player);
    advance(sim, 1.25);
    expect(rival.wheelspin).toBe(recklessness >= 0.5 ? 1 : 0);
    advance(sim, 2);
    const parked = [rival.x, rival.y, rival.heading];
    advance(sim, 1);
    expect([rival.x, rival.y, rival.heading]).toEqual(parked);
    expect(rival.speed).toBe(0);
    expect(rival.finishTime).toBe(finish);
    expect(raceOutcome(sim, false).position).toBe(2);
  });

  it('parks a show-off who finishes second without a victory burnout', () => {
    const sim = race();
    crossFinish(sim, sim.player);
    crossFinish(sim, sim.cars[0]!);
    advance(sim, 3, false);
    for (const car of sim.cars) {
      expect(car.finishStop?.burnSeconds).toBe(0);
      expect(car.speed).toBe(0);
      expect(car.engine.wear).toBe(0);
    }
  });

  it('charges wear only while Ned is burning, and keeps the win and trophy if he blows the engine', () => {
    const sim = race();
    advance(sim, 0.1, true);
    expect(sim.player.engine.wear).toBe(0);
    crossFinish(sim, sim.player);
    const finish = sim.player.finishTime;
    advance(sim, 1.2);
    advance(sim, 0.5, true);
    expect(sim.player.engine.wear).toBeCloseTo(4);
    advance(sim, 0.4);
    expect(sim.player.engine.wear).toBeCloseTo(4);
    expect(sim.player.wheelspin).toBe(0);
    advance(sim, 3, true);
    const outcome = raceOutcome(sim, false);
    expect(outcome).toMatchObject({ position: 1, time: finish, exploded: true, explosionCause: 'burnout' });
    expect(sim.events.filter(e => e.type === 'explosion' && e.carId === sim.player.id)).toHaveLength(1);
    const game = newGame(1);
    const result = applyEventOutcome(game, event, outcome);
    expect(result.report.won).toBe(true);
    expect(result.report.prize).toBeGreaterThan(0);
    expect(activeCar(result.state).condition).toBe(0);
    const duel = applyBossOutcome(game, district, game.jewels[0]!.uid, outcome);
    expect(duel.ok && duel.value.report.jewelWon).toBeTruthy();
  });
});
