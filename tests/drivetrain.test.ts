import { describe, expect, it } from 'vitest';
import {
  gearboxSpecFrom,
  gearCount,
  gearDriveFactor,
  initialDrivetrainState,
  rpmNorm,
  stepDrivetrain,
  wheelRpm,
  type DrivetrainInput,
  type DrivetrainState,
  type GearboxSpec,
} from '../src/domain/drivetrain';
import { DRIVETRAIN_TUNING } from '../src/domain/tuning';

const DT = 1 / 120;
const TOP = 700;
const spec: GearboxSpec = gearboxSpecFrom(TOP);
const T = DRIVETRAIN_TUNING;

const input = (overrides: Partial<DrivetrainInput> = {}): DrivetrainInput => ({
  throttle: 1,
  speed: 0,
  clutchIn: false,
  shift: 0,
  wheelspin: 0,
  ...overrides,
});

/** Steps long enough for the RPM to settle on its target. */
function settle(state: DrivetrainState, overrides: Partial<DrivetrainInput>, seconds = 2): DrivetrainState {
  let s = state;
  for (let t = 0; t < seconds; t += DT) s = stepDrivetrain(s, spec, input(overrides), DT);
  return s;
}

describe('gearbox spec', () => {
  it('spreads the gears over the top speed, the last one past it', () => {
    expect(gearCount(spec)).toBe(T.gearSpan.length);
    const last = spec.gearTopSpeeds[spec.gearTopSpeeds.length - 1]!;
    expect(last).toBeGreaterThan(TOP);
    for (let i = 1; i < spec.gearTopSpeeds.length; i++) {
      expect(spec.gearTopSpeeds[i]!).toBeGreaterThan(spec.gearTopSpeeds[i - 1]!);
    }
  });

  it('rejects a nonsensical top speed', () => {
    expect(() => gearboxSpecFrom(0)).toThrow();
    expect(() => gearboxSpecFrom(Number.NaN)).toThrow();
  });
});

describe('free revving on the grid (clutch in)', () => {
  it('climbs to the limiter on full throttle and falls back to idle when released', () => {
    const revved = settle(initialDrivetrainState('auto', spec), { clutchIn: true, throttle: 1 });
    expect(revved.rpm).toBeCloseTo(T.limiterRpm, 0);
    expect(revved.limiter).toBe(true);
    const released = settle(revved, { clutchIn: true, throttle: 0 }, 3);
    expect(released.rpm).toBeCloseTo(T.idleRpm, 0);
    expect(released.limiter).toBe(false);
  });

  it('holds part revs on part throttle', () => {
    const half = settle(initialDrivetrainState('auto', spec), { clutchIn: true, throttle: 0.5 });
    expect(half.rpm).toBeCloseTo(T.idleRpm + 0.5 * (T.limiterRpm - T.idleRpm), 0);
  });

  it('rises at the configured rate (it takes skill to time)', () => {
    let s = initialDrivetrainState('auto', spec);
    s = stepDrivetrain(s, spec, input({ clutchIn: true }), 0.5);
    expect(s.rpm).toBeCloseTo(T.idleRpm + T.freeRevRise * 0.5, 0);
  });

  it('ignores shift requests with the clutch in', () => {
    const s = stepDrivetrain(initialDrivetrainState('manual', spec), spec, input({ clutchIn: true, shift: 1 }), DT);
    expect(s.gear).toBe(1);
  });
});

describe('automatic box', () => {
  it('runs up through every gear, dropping the revs at each upshift, never past the limiter', () => {
    let s = initialDrivetrainState('auto', spec);
    const upshiftDrops: number[] = [];
    for (let speed = 0; speed <= TOP; speed += 1) {
      const before = s;
      s = stepDrivetrain(s, spec, input({ speed }), DT * 3);
      if (s.shifted === 1) upshiftDrops.push(wheelRpm(spec, before.gear, speed) - wheelRpm(spec, s.gear, speed));
      expect(s.rpm).toBeLessThanOrEqual(T.limiterRpm);
    }
    expect(s.gear).toBe(gearCount(spec));
    expect(upshiftDrops).toHaveLength(gearCount(spec) - 1);
    for (const drop of upshiftDrops) expect(drop).toBeGreaterThan(500);
  });

  it('comes back down the box when slowing', () => {
    let s: DrivetrainState = { ...initialDrivetrainState('auto', spec), gear: gearCount(spec) };
    for (let speed = TOP; speed >= 0; speed -= 1) s = stepDrivetrain(s, spec, input({ speed, throttle: 0 }), DT * 3);
    expect(s.gear).toBe(1);
  });

  it('never alters the drive force: the legacy car is untouched', () => {
    let s = initialDrivetrainState('auto', spec);
    for (let speed = 0; speed <= TOP * 1.1; speed += 7) {
      s = stepDrivetrain(s, spec, input({ speed }), DT);
      expect(gearDriveFactor(spec, s, speed)).toBe(1);
    }
  });

  it('respects the shift cooldown (no gear hunting)', () => {
    let s = initialDrivetrainState('auto', spec);
    const speed = spec.gearTopSpeeds[0]! * T.autoUpshiftNorm;
    s = stepDrivetrain(s, spec, input({ speed }), DT);
    expect(s.gear).toBe(2);
    // Immediately way faster: still no second shift while cooling down.
    s = stepDrivetrain(s, spec, input({ speed: spec.gearTopSpeeds[1]! }), DT);
    expect(s.gear).toBe(2);
  });
});

describe('manual box', () => {
  it('shifts on request, one gear at a time, within bounds', () => {
    let s = initialDrivetrainState('manual', spec);
    s = stepDrivetrain(s, spec, input({ shift: -1 }), DT);
    expect(s.gear).toBe(1);
    for (let i = 0; i < 10; i++) s = stepDrivetrain(s, spec, input({ shift: 1, speed: TOP * 0.9 }), DT);
    expect(s.gear).toBe(gearCount(spec));
    s = stepDrivetrain(s, spec, input({ shift: -1, speed: TOP * 0.6 }), DT);
    expect(s.gear).toBe(gearCount(spec) - 1);
    expect(s.shifted).toBe(-1);
  });

  it('never shifts by itself', () => {
    let s = initialDrivetrainState('manual', spec);
    for (let speed = 0; speed < TOP; speed += 5) s = stepDrivetrain(s, spec, input({ speed }), DT);
    expect(s.gear).toBe(1);
  });

  it('refuses a downshift that would over-rev the engine', () => {
    const s: DrivetrainState = { ...initialDrivetrainState('manual', spec), gear: 3 };
    const fast = spec.gearTopSpeeds[1]! * 1.05; // over second gear's redline
    expect(stepDrivetrain(s, spec, input({ shift: -1, speed: fast }), DT).gear).toBe(3);
    const slow = spec.gearTopSpeeds[1]! * 0.6;
    expect(stepDrivetrain(s, spec, input({ shift: -1, speed: slow }), DT).gear).toBe(2);
  });

  it('cuts the drive at the rev limiter of a short gear', () => {
    const first = initialDrivetrainState('manual', spec);
    const limiterSpeed = spec.gearTopSpeeds[0]! * (T.limiterRpm / T.redlineRpm);
    expect(gearDriveFactor(spec, first, limiterSpeed)).toBe(0);
    expect(gearDriveFactor(spec, first, limiterSpeed * 0.995)).toBeGreaterThan(0);
    expect(gearDriveFactor(spec, first, limiterSpeed * 0.995)).toBeLessThan(1);
    const settled = settle(first, { speed: limiterSpeed * 1.2 });
    expect(settled.rpm).toBeLessThanOrEqual(T.limiterRpm);
    expect(settled.limiter).toBe(true);
  });

  it('lugs in too long a gear and rewards the power band', () => {
    const top: DrivetrainState = { ...initialDrivetrainState('manual', spec), gear: gearCount(spec) };
    const lugging = gearDriveFactor(spec, top, 40);
    expect(lugging).toBeLessThan(0.6);
    expect(lugging).toBeGreaterThanOrEqual(T.lugFloor);
    const second: DrivetrainState = { ...initialDrivetrainState('manual', spec), gear: 2 };
    expect(gearDriveFactor(spec, second, spec.gearTopSpeeds[1]! * 0.8)).toBeCloseTo(T.powerBandBonus, 6);
  });

  it('pulls away cleanly in first thanks to clutch slip', () => {
    const first = initialDrivetrainState('manual', spec);
    expect(gearDriveFactor(spec, first, 0)).toBe(1);
    expect(gearDriveFactor(spec, first, 5)).toBe(1);
    const s = settle(first, { speed: 0, throttle: 1 });
    expect(rpmNorm(spec, s.rpm)).toBeCloseTo(T.launchSlipNorm, 2);
  });
});

describe('RPM under load', () => {
  it('follows the wheels when engaged and rises with wheelspin', () => {
    const s: DrivetrainState = { ...initialDrivetrainState('manual', spec), gear: 2 };
    const speed = spec.gearTopSpeeds[1]! * 0.5;
    const gripping = settle(s, { speed });
    expect(rpmNorm(spec, gripping.rpm)).toBeCloseTo(0.5, 2);
    const spinning = settle(s, { speed, wheelspin: 1 });
    expect(rpmNorm(spec, spinning.rpm)).toBeCloseTo(T.wheelspinNorm, 2);
  });

  it('honours a rise cap (bogging engine)', () => {
    let s = initialDrivetrainState('auto', spec);
    s = stepDrivetrain(s, spec, input({ speed: spec.gearTopSpeeds[0]! * 0.8, maxRise: 1000 }), 0.5);
    expect(s.rpm).toBeCloseTo(T.idleRpm + 500, 0);
  });
});
