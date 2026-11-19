import { describe, expect, it } from 'vitest';
import type { RaceSetup, Racer, RivalSpec } from '../src/domain/types';
import { DISTRICTS } from '../src/domain/world';
import { createAutopilot, createRaceSim, raceOutcome, rankCars, resetCarToTrack, stepRaceSim, type Controls } from '../src/race/sim';

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
    expect(sim.player.engine.explosionCause).toBe('overheat');
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

describe('wall damage', () => {
  function hitWall(speed: number, angle: number, side = 1, reverse = false) {
    const sim = createRaceSim({ ...setupFor(0, 0, 45), rivals: [] });
    sim.phase = 'racing';
    const car = sim.player;
    const index = 20;
    const wall = sim.track.samples[index]!;
    const lateral = side * (sim.track.wallOffset - 8);
    car.x = wall.x + wall.nx * lateral;
    car.y = wall.y + wall.ny * lateral;
    car.heading = Math.atan2(wall.ty, wall.tx) + side * angle;
    car.vx = speed * Math.cos(car.heading);
    car.vy = speed * Math.sin(car.heading);
    if (reverse) car.heading += Math.PI;
    car.trackIndex = index;
    car.s = wall.s;
    stepRaceSim(sim, IDLE, DT);
    return sim;
  }

  it('wrecks the car once on a fast square hit and records a wall DNF', () => {
    const sim = hitWall(400, Math.PI / 2);
    expect(sim.phase).toBe('finished');
    expect(sim.player.finished).toBe(false);
    expect(raceOutcome(sim, false)).toMatchObject({
      exploded: true, explosionCause: 'wall', standings: [{ exploded: true, explosionCause: 'wall' }],
    });
    for (let i = 0; i < 120; i++) stepRaceSim(sim, IDLE, DT);
    expect(sim.events.filter(event => event.type === 'explosion')).toHaveLength(1);
  });

  it.each([-1, 1])('scrapes the contacted side at the same speed on a shallow approach (side %i)', side => {
    const sim = hitWall(400, 0.08, side);
    expect(sim.phase).toBe('racing');
    expect(sim.player.bodyDamage).toHaveLength(1);
    const mark = sim.player.bodyDamage[0]!;
    expect(mark.y * side).toBeGreaterThan(6);
    expect(sim.events).toContainEqual(expect.objectContaining({ type: 'wall', sliding: true }));
    resetCarToTrack(sim, sim.player);
    stepRaceSim(sim, IDLE, DT);
    expect(sim.player.bodyDamage).toEqual([mark]);
  });

  it('rotates in opposite directions for a nose or tail clip on the right panel', () => {
    const nose = hitWall(200, 0.45);
    const tail = hitWall(200, 0.45, -1, true);
    expect(nose.player.bodyDamage[0]!.x).toBeGreaterThan(0);
    expect(tail.player.bodyDamage[0]!.x).toBeLessThan(0);
    expect(nose.player.bodyDamage[0]!.y).toBeGreaterThan(0);
    expect(tail.player.bodyDamage[0]!.y).toBeGreaterThan(0);
    expect(nose.player.impactYaw).toBeLessThan(0);
    expect(tail.player.impactYaw).toBeGreaterThan(0);
    const heading = nose.player.heading;
    stepRaceSim(nose, IDLE, DT);
    expect(nose.player.heading).toBeLessThan(heading);
    resetCarToTrack(nose, nose.player);
    expect(nose.player.impactYaw).toBe(0);
  });

  it('dents the nose on a medium square hit without ending the race or spinning it', () => {
    const sim = hitWall(180, Math.PI / 2);
    expect(sim.phase).toBe('racing');
    expect(sim.player.bodyDamage[0]).toMatchObject({ kind: 'dent' });
    expect(sim.player.bodyDamage[0]!.x).toBeGreaterThan(15);
    expect(Math.abs(sim.player.impactYaw)).toBeLessThan(0.05);
  });

  it('marks the nose on a slow square hit and ignores stationary contact', () => {
    const sim = hitWall(80, Math.PI / 2);
    expect(sim.phase).toBe('racing');
    expect(sim.player.bodyDamage[0]?.x).toBeGreaterThan(15);
    expect(hitWall(0, 0).player.bodyDamage).toHaveLength(0);
  });
});

describe('car-to-car damage', () => {
  // Place two identical bodies on a straight. All offsets and speeds are in the road frame.
  function collide(gap: number, lateral: number, rearSpeed: number, leadSpeed: number) {
    const setup = setupFor(0, 0, 45);
    const rival = { ...setup.player, look: { ...setup.player.look, paint: '#ef4444' } };
    const sim = createRaceSim({ ...setup, rivals: [rival] });
    sim.phase = 'racing';
    const lead = sim.cars[0]!;
    const road = sim.track.samples[20]!;
    for (const car of sim.cars) {
      const ahead = car === lead ? gap : 0;
      const sideways = car === lead ? lateral : 0;
      const speed = car === lead ? leadSpeed : rearSpeed;
      car.x = road.x + road.tx * ahead + road.nx * sideways;
      car.y = road.y + road.ty * ahead + road.ny * sideways;
      car.heading = Math.atan2(road.ty, road.tx);
      car.trackIndex = 20;
      car.s = road.s + ahead;
      car.vx = road.tx * speed;
      car.vy = road.ty * speed;
      car.speed = speed;
    }
    stepRaceSim(sim, IDLE, DT);
    return { rear: sim.player, lead };
  }

  it('dents opposing bumpers on a rear-end hit, while matched speeds leave them clean', () => {
    const { rear, lead } = collide(38, 0, 270, 60);
    expect(rear.bodyDamage[0]).toMatchObject({ kind: 'dent' });
    expect(lead.bodyDamage[0]).toMatchObject({ kind: 'dent' });
    expect(rear.bodyDamage[0]!.x).toBeGreaterThan(15);
    expect(lead.bodyDamage[0]!.x).toBeLessThan(-15);
    const matched = collide(37.9, 0, 270, 270);
    expect(matched.rear.bodyDamage).toHaveLength(0);
    expect(matched.lead.bodyDamage).toHaveLength(0);
  });

  it('trades paint on the two facing panels during a sideswipe', () => {
    const { rear, lead } = collide(22, 18.8, 250, 140);
    expect(rear.bodyDamage[0]).toMatchObject({ kind: 'scrape', paintTransfer: lead.racer.look.paint });
    expect(lead.bodyDamage[0]).toMatchObject({ kind: 'scrape', paintTransfer: rear.racer.look.paint });
    expect(rear.bodyDamage[0]!.y).toBeGreaterThan(6);
    expect(lead.bodyDamage[0]!.y).toBeLessThan(-6);
  });
});
