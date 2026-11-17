import { describe, expect, it } from 'vitest';
import { gearboxSpecFrom, initialDrivetrainState, rpmNorm, stepDrivetrain } from '../src/domain/drivetrain';
import {
  gradeLaunch,
  gridThrottle,
  idealThrottleLead,
  launchAccelMultiplier,
  launchRpmRiseCap,
  launchWheelspin,
  overRevThreshold,
  perfectLaunchPlan,
  rivalLaunchPlan,
  shouldLiftForGrip,
  startLaunch,
  stepLaunch,
  type LaunchState,
} from '../src/domain/launch';
import { LAUNCH_TUNING, RIVAL_LAUNCH_TUNING, WEATHER_PROFILES } from '../src/domain/tuning';

const DT = 1 / 120;
const DRY = WEATHER_PROFILES.dry;
const WET = WEATHER_PROFILES.wet;
const L = LAUNCH_TUNING;

function run(state: LaunchState, throttle: number, seconds: number, rpm = 0.6): LaunchState {
  let s = state;
  for (let t = 0; t < seconds - 1e-9; t += DT) s = stepLaunch(s, { throttle, rpmNorm: rpm }, DT);
  return s;
}

describe('launch grading', () => {
  it('maps the RPM at the green light onto the configured windows', () => {
    expect(gradeLaunch(0.2, DRY)).toBe('under');
    expect(gradeLaunch(L.underRevBelow - 0.01, DRY)).toBe('under');
    expect(gradeLaunch(L.underRevBelow + 0.01, DRY)).toBe('good');
    expect(gradeLaunch((L.perfect[0] + L.perfect[1]) / 2, DRY)).toBe('perfect');
    expect(gradeLaunch(L.perfect[1] + 0.02, DRY)).toBe('good');
    expect(gradeLaunch(L.overRevFrom, DRY)).toBe('over');
    expect(gradeLaunch(1.04, DRY)).toBe('over');
  });

  it('spins up sooner in the wet', () => {
    expect(overRevThreshold(WET)).toBeLessThan(overRevThreshold(DRY));
    const between = (overRevThreshold(WET) + overRevThreshold(DRY)) / 2;
    expect(gradeLaunch(between, DRY)).toBe('good');
    expect(gradeLaunch(between, WET)).toBe('over');
  });

  it('keeps the perfect window clear of the over-rev zone in every weather', () => {
    for (const weather of Object.values(WEATHER_PROFILES)) {
      expect(L.perfect[1]).toBeLessThan(overRevThreshold(weather, L));
      expect(L.perfect[0]).toBeGreaterThanOrEqual(L.underRevBelow);
    }
  });

  it('needs the throttle down at the light to earn the boost or the wheelspin', () => {
    expect(startLaunch(0.7, 0, DRY).grade).toBe('good');
    expect(startLaunch(1.0, 0, DRY).grade).toBe('good');
    expect(startLaunch(0.7, 1, DRY).grade).toBe('perfect');
    expect(startLaunch(1.0, 1, DRY).grade).toBe('over');
    // Revs too low stay a bog whatever the foot does.
    expect(startLaunch(0.2, 0, DRY).grade).toBe('under');
  });
});

describe('perfect start', () => {
  it('boosts the acceleration, then hands back smoothly', () => {
    let s = startLaunch(0.7, 1, DRY);
    expect(s.phase).toBe('boost');
    expect(launchAccelMultiplier(s)).toBeCloseTo(L.perfectBoostMultiplier, 6);
    let previous = launchAccelMultiplier(s);
    for (let t = 0; t < L.perfectBoostSeconds + 0.1; t += DT) {
      s = stepLaunch(s, { throttle: 1, rpmNorm: 0.6 }, DT);
      const current = launchAccelMultiplier(s);
      expect(current).toBeLessThanOrEqual(previous + 1e-9);
      expect(previous - current).toBeLessThan(0.02); // no jolt
      previous = current;
    }
    expect(s.phase).toBe('done');
    expect(launchAccelMultiplier(s)).toBe(1);
  });
});

describe('under-rev start', () => {
  it('bogs with reduced acceleration until the RPM recovers', () => {
    let s = startLaunch(0.15, 1, DRY);
    expect(s.phase).toBe('bog');
    expect(launchAccelMultiplier(s)).toBeCloseTo(L.underRevAccelMultiplier, 6);
    expect(launchRpmRiseCap(s)).toBe(L.bogRpmRise);
    s = stepLaunch(s, { throttle: 1, rpmNorm: (0.15 + L.bogRecoveryNorm) / 2 }, DT);
    expect(launchAccelMultiplier(s)).toBeGreaterThan(L.underRevAccelMultiplier);
    expect(launchAccelMultiplier(s)).toBeLessThan(1);
    s = stepLaunch(s, { throttle: 1, rpmNorm: L.bogRecoveryNorm }, DT);
    expect(s.phase).toBe('done');
    expect(s.endedBy).toBe('recovered');
    expect(launchRpmRiseCap(s)).toBeUndefined();
  });

  it('cannot bog forever', () => {
    const s = run(startLaunch(0.15, 1, DRY), 1, L.maxBogSeconds + 0.05, 0.2);
    expect(s.phase).toBe('done');
    expect(s.endedBy).toBe('expired');
  });

  it('does not use the bog up while the driver waits off the throttle', () => {
    const s = run(startLaunch(0.15, 0, DRY), 0, L.maxBogSeconds + 1, 0.15);
    expect(s.phase).toBe('bog');
  });
});

describe('over-rev start', () => {
  it('spins the wheels at the configured multiplier, for up to the configured time', () => {
    const s = startLaunch(1.04, 1, DRY);
    expect(s.phase).toBe('wheelspin');
    expect(launchAccelMultiplier(s)).toBeCloseTo(L.overRevAccelMultiplier, 6);
    expect(launchWheelspin(s)).toBe(1);
    expect(s.duration).toBeLessThanOrEqual(L.wheelspinSeconds[1]);
    expect(s.duration).toBeGreaterThan(L.wheelspinSeconds[1] * 0.9);
  });

  it('spins for less time just over the threshold than on the limiter', () => {
    const mild = startLaunch(overRevThreshold(DRY) + 0.005, 1, DRY);
    const wild = startLaunch(1.04, 1, DRY);
    expect(mild.duration).toBeLessThan(wild.duration);
    expect(mild.duration).toBeGreaterThanOrEqual(L.wheelspinSeconds[0]);
  });

  it('wears off on its own, easing the grip back in', () => {
    let s = startLaunch(1.04, 1, DRY);
    const duration = s.duration;
    s = run(s, 1, duration * 0.5);
    expect(launchAccelMultiplier(s)).toBeCloseTo(L.overRevAccelMultiplier, 6);
    s = run(s, 1, duration * (1 - L.wheelspinFadeShare / 2) - duration * 0.5);
    expect(launchAccelMultiplier(s)).toBeGreaterThan(L.overRevAccelMultiplier);
    expect(launchWheelspin(s)).toBeLessThan(1);
    s = run(s, 1, duration);
    expect(s.phase).toBe('done');
    expect(s.endedBy).toBe('expired');
  });

  it('is cancelled at once by releasing and pressing the throttle again', () => {
    let s = run(startLaunch(1.04, 1, DRY), 1, 0.5);
    expect(s.phase).toBe('wheelspin');
    s = stepLaunch(s, { throttle: 0, rpmNorm: 0.9 }, DT);
    expect(s.phase).toBe('wheelspin'); // releasing alone is not enough
    s = stepLaunch(s, { throttle: 1, rpmNorm: 0.9 }, DT);
    expect(s.phase).toBe('done');
    expect(s.endedBy).toBe('cancelled');
    expect(launchAccelMultiplier(s)).toBe(1);
    expect(launchWheelspin(s)).toBe(0);
  });

  it('is not cancelled by keeping the foot down, nor by a half lift', () => {
    let s = run(startLaunch(1.04, 1, DRY), 1, 1);
    s = stepLaunch(s, { throttle: 0.3, rpmNorm: 0.9 }, DT);
    s = stepLaunch(s, { throttle: 1, rpmNorm: 0.9 }, DT);
    expect(s.phase).toBe('wheelspin');
  });

  it('lasts longer in the wet, still capped', () => {
    const rpm = overRevThreshold(DRY) + 0.02;
    expect(startLaunch(rpm, 1, WET).duration).toBeGreaterThan(startLaunch(rpm, 1, DRY).duration);
    expect(startLaunch(1.04, 1, WET).duration).toBeLessThanOrEqual(L.wheelspinSeconds[1]);
  });
});

describe('launch timing against the drivetrain', () => {
  it('flooring it at the ideal lead lands in the perfect window', () => {
    const gearbox = gearboxSpecFrom(700);
    const lead = idealThrottleLead();
    // The window must be reachable on the countdown (3 beats of 1 s).
    expect(lead).toBeGreaterThan(0.3);
    expect(lead).toBeLessThan(2.5);
    let s = initialDrivetrainState('auto', gearbox);
    for (let t = 0; t < lead; t += DT) s = stepDrivetrain(s, gearbox, { throttle: 1, speed: 0, clutchIn: true, shift: 0, wheelspin: 0 }, DT);
    expect(gradeLaunch(rpmNorm(gearbox, s.rpm), DRY)).toBe('perfect');
  });

  it('holding the throttle through the whole countdown over-revs', () => {
    const gearbox = gearboxSpecFrom(700);
    let s = initialDrivetrainState('auto', gearbox);
    for (let t = 0; t < 3.6; t += DT) s = stepDrivetrain(s, gearbox, { throttle: 1, speed: 0, clutchIn: true, shift: 0, wheelspin: 0 }, DT);
    expect(gradeLaunch(rpmNorm(gearbox, s.rpm), DRY)).toBe('over');
  });
});

describe('rival launch plans', () => {
  /** Grade a plan would earn on a dry road: free-rev from idle for `throttleLead` seconds. */
  const gradeOf = (throttleLead: number): string => {
    const gearbox = gearboxSpecFrom(700);
    let s = initialDrivetrainState('auto', gearbox);
    const dt = 1 / 120;
    for (let t = 0; t < throttleLead; t += dt) s = stepDrivetrain(s, gearbox, { throttle: 1, speed: 0, clutchIn: true, shift: 0, wheelspin: 0 }, dt);
    return gradeLaunch(rpmNorm(gearbox, s.rpm), WEATHER_PROFILES.dry);
  };
  const rolls = Array.from({ length: 41 }, (_, i) => i / 40);
  const perfectShare = (skill: number): number =>
    rolls.filter((roll) => gradeOf(rivalLaunchPlan(skill, roll).throttleLead) === 'perfect').length / rolls.length;

  it('a middle roll is a perfectly timed press, whatever the skill', () => {
    expect(rivalLaunchPlan(0.5, 0.5).throttleLead).toBeCloseTo(idealThrottleLead(), 9);
    expect(gradeOf(rivalLaunchPlan(0.7, 0.5).throttleLead)).toBe('perfect');
  });

  it('weak drivers fluff starts both ways, strong ones nail them', () => {
    expect(gradeOf(rivalLaunchPlan(0.68, 0.999).throttleLead)).toBe('over');
    expect(gradeOf(rivalLaunchPlan(0.68, 0).throttleLead)).toBe('under');
    expect(perfectShare(0.93)).toBe(1);
    expect(perfectShare(0.7)).toBeLessThan(0.5);
    expect(perfectShare(0.85)).toBeGreaterThan(perfectShare(0.7));
  });

  it('skill also buys a quicker reaction to wheelspin', () => {
    expect(rivalLaunchPlan(0.9, 0.5).spinReaction).toBeLessThan(rivalLaunchPlan(0.7, 0.5).spinReaction);
    expect(rivalLaunchPlan(1, 0.5).spinReaction).toBe(RIVAL_LAUNCH_TUNING.spinReactionBase);
    expect(perfectLaunchPlan().throttleLead).toBe(idealThrottleLead());
  });

  it('never asks for a negative lead, even for hopeless drivers', () => {
    expect(rivalLaunchPlan(-3, 0).throttleLead).toBeGreaterThanOrEqual(0);
    expect(rivalLaunchPlan(Number.NaN, 0.5).throttleLead).toBeGreaterThanOrEqual(0);
  });

  it('holds the throttle from the lead onward and lifts once to catch a spin', () => {
    const plan = { throttleLead: 1, spinReaction: 0.5 };
    expect(gridThrottle(plan, 1.2)).toBe(0);
    expect(gridThrottle(plan, 0.9)).toBe(1);
    const spin = startLaunch(0.99, 1, WEATHER_PROFILES.dry);
    expect(shouldLiftForGrip(plan, spin)).toBe(false);
    const later = stepLaunch(spin, { throttle: 1, rpmNorm: 0.9 }, 0.6);
    expect(shouldLiftForGrip(plan, later)).toBe(true);
    const lifted = stepLaunch(later, { throttle: 0, rpmNorm: 0.9 }, 1 / 120);
    expect(shouldLiftForGrip(plan, lifted)).toBe(false);
    expect(shouldLiftForGrip(plan, undefined)).toBe(false);
  });
});
