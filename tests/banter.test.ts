import { describe, expect, it } from 'vitest';
import { eventRaceSetup, newGame } from '../src/domain/game';
import { DISTRICTS } from '../src/domain/world';
import { RaceBanter } from '../src/race/banter';
import { createRaceSim, rankCars } from '../src/race/sim';

function race() {
  const district = DISTRICTS[0]!;
  const sim = createRaceSim(eventRaceSetup(newGame(17), district, district.events[0]!));
  const rival = sim.cars[0]!;
  const leader = sim.cars[1]!;
  rival.progress = 100;
  leader.progress = 500;
  sim.player.progress = 50;
  const banter = new RaceBanter(sim);
  sim.phase = 'racing';
  function at(time: number, progress: number) {
    sim.time = time;
    sim.player.progress = progress;
    return banter.update(sim, rankCars(sim));
  }
  return { sim, rival, leader, at };
}

describe('race banter', () => {
  it('waits for a clear pass, then lets the same rival answer on a retake', () => {
    const { sim, rival, at } = race();
    expect(at(1, 106)).toBeUndefined();
    expect(at(2, 96)).toBeUndefined();
    const pass = at(3, 125);
    expect(pass?.speaker).toBe(sim.player);
    expect(pass?.listener).toBe(rival);
    expect(at(4, 98)).toBe(pass);
    expect(at(5.5, 102)).toBeUndefined();
    const retake = at(6.1, 75);
    expect(retake?.speaker).toBe(rival);
    expect(retake?.listener).toBe(sim.player);
    expect(retake?.text).not.toBe(pass?.text);
  });

  it('credits the frontmost rival in a pack and drops secondary passes during a line', () => {
    const { sim, leader, at } = race();
    const pass = at(4, 550);
    expect(pass?.speaker).toBe(sim.player);
    expect(pass?.listener).toBe(leader);
    expect(at(4.5, 470)).toBe(pass);
    expect(at(7.5, 470)).toBeUndefined();
  });

  it('rotates through distinct lines in both directions without consuming gameplay RNG', () => {
    const { sim, at } = race();
    const seed = sim.rng.state();
    const passed = new Set<string>();
    const lost = new Set<string>();
    for (let i = 0; i < 8; i++) {
      passed.add(at(20 * i + 10, 130)!.text);
      lost.add(at(20 * i + 20, 70)!.text);
    }
    expect(passed.size).toBe(8);
    expect(lost.size).toBe(8);
    expect(sim.rng.state()).toBe(seed);
  });

  it('ignores the countdown, going backwards, wrecks and the classified finish', () => {
    const { sim, rival, at } = race();
    sim.phase = 'countdown';
    expect(at(0, 140)).toBeUndefined();
    sim.phase = 'racing';
    sim.player.wrongWayTime = 1;
    expect(at(1, 140)).toBeUndefined();
    sim.player.wrongWayTime = 0;
    expect(at(2, 140)).toBeUndefined();
    rival.engine = { ...rival.engine, exploded: true };
    expect(at(3, 70)).toBeUndefined();
    sim.phase = 'finished';
    expect(at(4, 600)).toBeUndefined();
  });
});
