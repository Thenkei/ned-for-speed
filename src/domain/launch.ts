import {
  DRIVETRAIN_TUNING,
  LAUNCH_TUNING,
  RIVAL_LAUNCH_TUNING,
  type DrivetrainTuning,
  type LaunchTuning,
  type RivalLaunchTuning,
  type WeatherProfile,
} from './tuning';

/**
 * Skill-based race start.
 *
 * On the grid the clutch is in and the throttle revs the engine freely (see
 * `drivetrain.ts`). What counts is the RPM when the light turns green:
 *
 *  - in the perfect window: a short acceleration boost;
 *  - too low (late or timid on the throttle): the engine bogs, with reduced
 *    acceleration until the RPM climbs back;
 *  - too high (early, or sitting on the limiter): wheelspin, with reduced
 *    acceleration and grip for up to ~5 s. Lifting off and pressing again
 *    cancels it at once.
 *
 * Nothing here touches engine heat: a bad start costs time, never the engine.
 */

export type LaunchGrade = 'perfect' | 'good' | 'under' | 'over';
export type LaunchPhase = 'boost' | 'bog' | 'wheelspin' | 'done';
export type LaunchEnd = 'cancelled' | 'expired' | 'recovered';

export interface LaunchState {
  readonly grade: LaunchGrade;
  readonly phase: LaunchPhase;
  /** Seconds spent in the current phase (bog: only while on the throttle). */
  readonly elapsed: number;
  /** Planned length of the phase (boost, wheelspin) or its safety cap (bog). */
  readonly duration: number;
  /** RPM norm at the green light. */
  readonly rpmAtGo: number;
  /** Bog only: 0 → 1 as the RPM climbs back to the recovery threshold. */
  readonly recovery: number;
  /** Throttle released since the green light: arms the wheelspin cancel. */
  readonly released: boolean;
  readonly endedBy: LaunchEnd | undefined;
}

export interface LaunchInput {
  /** 0–1. */
  readonly throttle: number;
  /** Current engine RPM norm. */
  readonly rpmNorm: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function overRevThreshold(weather: WeatherProfile, tuning: LaunchTuning = LAUNCH_TUNING): number {
  return tuning.overRevFrom + weather.overRevShift;
}

/** Grade from the RPM at the green light, ignoring whether the throttle is still down. */
export function gradeLaunch(rpmNorm: number, weather: WeatherProfile, tuning: LaunchTuning = LAUNCH_TUNING): LaunchGrade {
  if (rpmNorm >= overRevThreshold(weather, tuning)) return 'over';
  if (rpmNorm < tuning.underRevBelow) return 'under';
  const [low, high] = tuning.perfect;
  if (rpmNorm >= low && rpmNorm <= high) return 'perfect';
  return 'good';
}

/** Called once, at the green light. */
export function startLaunch(
  rpmNorm: number,
  throttle: number,
  weather: WeatherProfile,
  tuning: LaunchTuning = LAUNCH_TUNING,
): LaunchState {
  let grade = gradeLaunch(rpmNorm, weather, tuning);
  // Revs alone are not a launch: lifting off right before the light forfeits
  // the boost, and also means the clutch is not dumped at the limiter.
  if (throttle < tuning.pressThreshold && (grade === 'perfect' || grade === 'over')) grade = 'good';

  const base = {
    grade,
    elapsed: 0,
    rpmAtGo: rpmNorm,
    recovery: 0,
    released: throttle < tuning.releaseThreshold,
    endedBy: undefined,
  };
  switch (grade) {
    case 'perfect':
      return { ...base, phase: 'boost', duration: tuning.perfectBoostSeconds };
    case 'under':
      return { ...base, phase: 'bog', duration: tuning.maxBogSeconds };
    case 'over': {
      const threshold = overRevThreshold(weather, tuning);
      const severity = threshold >= 1 ? 1 : clamp((rpmNorm - threshold) / (1 - threshold), 0, 1);
      const [shortest, longest] = tuning.wheelspinSeconds;
      const duration = Math.min(longest, (shortest + (longest - shortest) * severity) * weather.wheelspinDurationMultiplier);
      return { ...base, phase: 'wheelspin', duration };
    }
    case 'good':
      return { ...base, phase: 'done', duration: 0 };
  }
}

export function stepLaunch(state: LaunchState, input: LaunchInput, dt: number, tuning: LaunchTuning = LAUNCH_TUNING): LaunchState {
  if (state.phase === 'done') return state;
  const released = state.released || input.throttle < tuning.releaseThreshold;
  const end = (endedBy: LaunchEnd): LaunchState => ({ ...state, phase: 'done', released, endedBy });

  switch (state.phase) {
    case 'wheelspin': {
      // `state.released` (not the fresh value): release and re-press must be two distinct steps.
      if (state.released && input.throttle >= tuning.pressThreshold) return end('cancelled');
      const elapsed = state.elapsed + dt;
      return elapsed >= state.duration ? end('expired') : { ...state, elapsed, released };
    }
    case 'boost': {
      const elapsed = state.elapsed + dt;
      return elapsed >= state.duration ? end('expired') : { ...state, elapsed, released };
    }
    case 'bog': {
      const span = tuning.bogRecoveryNorm - state.rpmAtGo;
      const recovery = span <= 0 ? 1 : clamp((input.rpmNorm - state.rpmAtGo) / span, 0, 1);
      if (recovery >= 1) return end('recovered');
      // The bog is only a penalty on the throttle; waiting does not "use it up".
      const elapsed = state.elapsed + (input.throttle > tuning.releaseThreshold ? dt : 0);
      return elapsed >= state.duration ? end('expired') : { ...state, elapsed, recovery, released };
    }
  }
}

/** Fade from 0 to 1 over the last `share` of a phase. */
function tailFade(state: LaunchState, share: number): number {
  if (state.duration <= 0) return 1;
  const t = state.elapsed / state.duration;
  const start = 1 - share;
  return t <= start ? 0 : clamp((t - start) / share, 0, 1);
}

/** Multiplier on the drive force. */
export function launchAccelMultiplier(state: LaunchState, tuning: LaunchTuning = LAUNCH_TUNING): number {
  switch (state.phase) {
    case 'boost':
      // Full boost for the first half, then eases out so there is no jolt.
      return 1 + (tuning.perfectBoostMultiplier - 1) * (1 - tailFade(state, 0.5));
    case 'bog':
      return tuning.underRevAccelMultiplier + (1 - tuning.underRevAccelMultiplier) * state.recovery;
    case 'wheelspin':
      return tuning.overRevAccelMultiplier + (1 - tuning.overRevAccelMultiplier) * tailFade(state, tuning.wheelspinFadeShare);
    case 'done':
      return 1;
  }
}

/** 0–1 wheelspin intensity for grip loss and effects. */
export function launchWheelspin(state: LaunchState, tuning: LaunchTuning = LAUNCH_TUNING): number {
  return state.phase === 'wheelspin' ? 1 - tailFade(state, tuning.wheelspinFadeShare) : 0;
}

/** RPM rise cap while the engine bogs, undefined otherwise. */
export function launchRpmRiseCap(state: LaunchState | undefined, tuning: LaunchTuning = LAUNCH_TUNING): number | undefined {
  return state?.phase === 'bog' ? tuning.bogRpmRise : undefined;
}

/**
 * How long before the green light a driver flooring the throttle from idle
 * should press to land in the middle of the perfect window. Used by the
 * autopilot, and a handy number to sanity-check the tuning against the
 * one-second countdown beats.
 */
export function idealThrottleLead(
  drivetrain: DrivetrainTuning = DRIVETRAIN_TUNING,
  tuning: LaunchTuning = LAUNCH_TUNING,
): number {
  const [low, high] = tuning.perfect;
  const targetRpm = ((low + high) / 2) * drivetrain.redlineRpm;
  return Math.max(0, (targetRpm - drivetrain.idleRpm) / drivetrain.freeRevRise);
}

/** How a computer driver plays the race start. */
export interface LaunchPlan {
  /** Seconds before the green light at which the throttle goes down. */
  readonly throttleLead: number;
  /** Seconds of wheelspin before the driver lifts to cancel it. */
  readonly spinReaction: number;
}

/** A flawless start: the autopilot's default. */
export function perfectLaunchPlan(tuning: RivalLaunchTuning = RIVAL_LAUNCH_TUNING): LaunchPlan {
  return { throttleLead: idealThrottleLead(), spinReaction: tuning.spinReactionBase };
}

/**
 * A rival's start for one race. `roll` is a uniform number in [0, 1) supplied
 * by the caller (pure and testable): 0.5 is a perfectly timed press, the
 * extremes press early (over-rev) or late (bog) by up to
 * `timingSpread × (1 − skill)` seconds.
 */
export function rivalLaunchPlan(
  skill: number,
  roll: number,
  tuning: RivalLaunchTuning = RIVAL_LAUNCH_TUNING,
): LaunchPlan {
  // Garbage in (NaN) degrades to the worst driver / a centred roll, never to a NaN lead.
  const missing = 1 - (Number.isFinite(skill) ? clamp(skill, 0, 1) : 0);
  const error = (2 * (Number.isFinite(roll) ? clamp(roll, 0, 1) : 0.5) - 1) * tuning.timingSpread * missing;
  return {
    throttleLead: Math.max(0, idealThrottleLead() + error),
    spinReaction: tuning.spinReactionBase + tuning.spinReactionPerMissingSkill * missing,
  };
}

/** Throttle a computer driver holds on the grid, `countdown` seconds before the green light. */
export function gridThrottle(plan: LaunchPlan, countdown: number): number {
  return countdown <= plan.throttleLead ? 1 : 0;
}

/** True when a computer driver should lift this step to cancel its launch wheelspin. */
export function shouldLiftForGrip(plan: LaunchPlan, launch: LaunchState | undefined): boolean {
  return launch?.phase === 'wheelspin' && !launch.released && launch.elapsed >= plan.spinReaction;
}
