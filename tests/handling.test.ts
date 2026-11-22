import { describe, expect, it } from 'vitest';
import { newGame, timeTrialSetup } from '../src/domain/game';
import { HANDLING_TUNING, type Weather } from '../src/domain/tuning';
import { DISTRICTS } from '../src/domain/world';
import { fullLockYaw, oversteerYaw, resolveTyres, tyreGrip } from '../src/race/handling';
import { createAutopilot, createRaceSim, stepRaceSim, type Controls, type RaceSim } from '../src/race/sim';

const DT = 1 / 120;
const T = HANDLING_TUNING;

describe('tyre grip', () => {
  const base = { grip: 500, surface: 1, braking: 0, sliding: false };

  it('is lower once sliding, lower still when sliding on water', () => {
    const rolling = tyreGrip(base);
    expect(rolling).toBeCloseTo(500 * T.tyreHeadroom, 9);
    const sliding = tyreGrip({ ...base, sliding: true });
    expect(sliding).toBeCloseTo(rolling * T.slidingGrip, 9);
    expect(tyreGrip({ ...base, sliding: true, slidingGripMultiplier: 0.8 })).toBeCloseTo(sliding * 0.8, 9);
    // The wet multiplier is about sliding tyres only.
    expect(tyreGrip({ ...base, slidingGripMultiplier: 0.8 })).toBe(rolling);
  });

  it('shares the tyres between braking and cornering', () => {
    const rolling = tyreGrip(base);
    expect(tyreGrip({ ...base, braking: 1 })).toBeCloseTo(rolling * (1 - T.brakingGripLoss), 9);
    expect(tyreGrip({ ...base, braking: 0.5 })).toBeGreaterThan(tyreGrip({ ...base, braking: 1 }));
    expect(tyreGrip({ ...base, braking: 5 })).toBeCloseTo(tyreGrip({ ...base, braking: 1 }), 9);
  });

  it('lets full lock reach past the grip at speed, the steering rack below', () => {
    expect(fullLockYaw(2.4, 500, 1, 600, 1.3)).toBeCloseTo((500 * 1.3) / 600, 9);
    expect(fullLockYaw(2.4, 500, 1, 100, 1.3)).toBe(2.4);
    expect(fullLockYaw(2.4, 500, 1, 600, 1.15)).toBeLessThan(fullLockYaw(2.4, 500, 1, 600, 1.3));
  });
});

describe('tyres', () => {
  const recovery = Math.exp(-8 * DT);

  it('within the grip, behaves exactly like the old never-slide model', () => {
    const state = { forward: 400, lateral: 30 };
    const result = resolveTyres(state, 600, recovery, DT);
    // The old model: the slide angle decays exponentially, plus a small scrub.
    const total = Math.hypot(400, 30);
    const angle = Math.atan2(30, 400) * recovery;
    const scrub = 1 - Math.min(0.9, Math.abs(Math.sin(angle)) * 0.9) * DT;
    expect(result.sliding).toBe(false);
    expect(result.drift).toBe(0);
    expect(result.forward).toBeCloseTo(total * Math.cos(angle) * scrub, 9);
    expect(result.lateral).toBeCloseTo(total * Math.sin(angle) * scrub, 9);
  });

  it('past the grip, turns the momentum only as fast as the grip allows, and slides', () => {
    const grip = 500;
    const state = { forward: 450, lateral: 120 };
    const before = Math.atan2(120, 450);
    const result = resolveTyres(state, grip, recovery, DT);
    const after = Math.atan2(result.lateral, result.forward);
    expect(result.sliding).toBe(true);
    expect(result.drift).toBeGreaterThan(0);
    const total = Math.hypot(450, 120);
    expect(before - after).toBeCloseTo((grip / total) * DT, 9);
    // And it costs speed: more than the plain scrub.
    const gripping = resolveTyres(state, 1e9, recovery, DT);
    expect(Math.hypot(result.forward, result.lateral)).toBeLessThan(Math.hypot(gripping.forward, gripping.lateral) + 1e-9);
    expect(Math.hypot(result.forward, result.lateral)).toBeLessThan(total);
  });

  it('never lets the slide angle pass the cap (no spinning round)', () => {
    const result = resolveTyres({ forward: 100, lateral: 400 }, 10, recovery, DT);
    expect(Math.abs(Math.atan2(result.lateral, result.forward))).toBeCloseTo(T.maxSlideAngle, 9);
  });

  it('is sticky: a slide needs the (lower) sliding grip to be caught', () => {
    const state = { forward: 400, lateral: 60 };
    const wanted = Math.abs(Math.atan2(60, 400)) * (1 - recovery);
    const total = Math.hypot(400, 60);
    // A grip just enough when rolling, not enough once sliding.
    const rollingGrip = (wanted * total) / DT / T.slidingGrip / 1.0001;
    expect(resolveTyres(state, rollingGrip, recovery, DT).sliding).toBe(false);
    expect(resolveTyres(state, rollingGrip * T.slidingGrip, recovery, DT).sliding).toBe(true);
  });

  it('steps the tail out on the throttle in a slide, not when lifting or gripping', () => {
    // The yaw pushes the nose away from the momentum: it grows the slide angle.
    expect(Math.sign(oversteerYaw(true, 0.3, 1, 1))).toBe(-1);
    expect(Math.sign(oversteerYaw(true, -0.3, 1, 1))).toBe(1);
    expect(oversteerYaw(true, 0.3, 0, 1)).toBe(0);
    expect(oversteerYaw(false, 0.3, 1, 1)).toBe(0);
    expect(Math.abs(oversteerYaw(true, 0.3, 1, 1, 1.6))).toBeCloseTo(Math.abs(oversteerYaw(true, 0.3, 1, 1)) * 1.6, 9);
  });
});

describe('handling in the race', () => {
  const parking = DISTRICTS[0]!;

  /** Ned at `speed` px/s on the start straight, holding `controls` for `seconds`: how far does he slide? */
  function corner(weather: Weather, speed: number, controls: Controls, seconds = 0.35): { slid: boolean; maxDrift: number; sim: RaceSim } {
    const sim = createRaceSim(timeTrialSetup(newGame(3), parking, weather));
    while (sim.phase === 'countdown') stepRaceSim(sim, { throttle: 0, brake: 0, steer: 0, nitro: false }, DT);
    const p = sim.player;
    p.vx = Math.cos(p.heading) * speed;
    p.vy = Math.sin(p.heading) * speed;
    p.launch = undefined;
    let slid = false;
    let maxDrift = 0;
    for (let t = 0; t < seconds; t += DT) {
      stepRaceSim(sim, controls, DT);
      if (sim.events.some((e) => e.type === 'wall')) break;
      sim.events.length = 0;
      slid ||= p.sliding;
      maxDrift = Math.max(maxDrift, p.drift);
    }
    return { slid, maxDrift, sim };
  }
  const fullLock: Controls = { throttle: 1, brake: 0, steer: 1, nitro: false };

  it('slides when a corner is taken too fast, not when taken slowly', () => {
    expect(corner('dry', 160, fullLock).slid).toBe(false);
    const fast = corner('dry', 480, { ...fullLock, analogSteer: true });
    expect(fast.slid).toBe(true);
    expect(fast.maxDrift).toBeGreaterThan(0.2);
  });

  /** Lowest speed (px/s, 20 px/s steps) at which holding full lock for 0.8 s makes Ned slide. */
  const slideSpeed = (weather: Weather, controls: Controls): number => {
    for (let speed = 120; speed <= 700; speed += 20) if (corner(weather, speed, controls, 0.8).slid) return speed;
    return Infinity;
  };

  it('is slippery in the wet: the same input slides at a lower speed, and further', () => {
    for (const controls of [fullLock, { ...fullLock, analogSteer: true }]) {
      const dry = slideSpeed('dry', controls);
      const wet = slideSpeed('wet', controls);
      expect(Number.isFinite(dry)).toBe(true);
      expect(wet).toBeLessThanOrEqual(dry * 0.9);
    }
    const stick = { ...fullLock, analogSteer: true };
    expect(corner('wet', 480, stick).maxDrift).toBeGreaterThan(corner('dry', 480, stick).maxDrift);
  });

  it('gives keys and touch a speed-sensitive wheel: a flick does not slide, holding on still does', () => {
    // At speed, a third of a second of full stick slides; the same on a key does not.
    expect(corner('dry', 480, { ...fullLock, analogSteer: true }).slid).toBe(true);
    expect(corner('dry', 480, fullLock).slid).toBe(false);
    // Held on through a corner taken too fast, the key slides too.
    expect(corner('dry', 480, fullLock, 0.8).slid).toBe(true);
  });

  it('is caught faster by lifting and unwinding than by keeping the foot down', () => {
    const catchTime = (controls: Controls): number => {
      const { sim } = corner('dry', 480, { ...fullLock, analogSteer: true });
      expect(sim.player.sliding).toBe(true);
      for (let t = 0; t < 3; t += DT) {
        stepRaceSim(sim, controls, DT);
        if (!sim.player.sliding) return t;
      }
      return Infinity;
    };
    const lifted = catchTime({ throttle: 0, brake: 0, steer: -0.3, nitro: false, analogSteer: true });
    const pushing = catchTime({ throttle: 1, brake: 0, steer: 1, nitro: false, analogSteer: true });
    expect(lifted).toBeLessThan(pushing);
  });

  it('leaves the rivals (almost) slide-free: they drive within the grip they trust', () => {
    const district = DISTRICTS[2]!;
    const event = district.events[1]!;
    const sim = createRaceSim({
      ...timeTrialSetup(newGame(3), district, 'dry'),
      laps: event.laps,
      rivals: event.rivals.map((r) => ({
        name: r.name,
        look: { body: r.body, paint: r.paint, neon: r.neon, spoiler: r.spoiler },
        stats: r.stats,
        condition: 100,
        skill: r.skill,
        recklessness: r.recklessness,
      })),
    });
    const pilot = createAutopilot(sim);
    let steps = 0;
    let sliding = 0;
    for (let i = 0; sim.phase !== 'finished' && i < 120 * 300; i++) {
      stepRaceSim(sim, pilot(sim.player, DT), DT);
      if (sim.phase !== 'racing') continue;
      for (const car of sim.cars) {
        if (car.isPlayer || car.finished) continue;
        steps++;
        if (car.sliding) sliding++;
      }
    }
    expect(steps).toBeGreaterThan(1000);
    expect(sliding / steps).toBeLessThan(0.03);
  }, 30_000);
});
