import { HANDLING_TUNING, type HandlingTuning } from '../domain/tuning';

/**
 * The tyre model, kept pure for testing: how much grip the tyres have, how
 * far the nose may turn, and how the momentum follows it. See
 * `HandlingTuning` for the idea; `stepCar` (sim.ts) wires it in.
 *
 * Units: px, s, rad. Grip is a lateral acceleration (px/s²): a car going `v`
 * can turn its momentum at most `grip / v` rad/s.
 */

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export interface GripInput {
  /** `DriveSpec.grip`, weather included (px/s²). */
  readonly grip: number;
  /** Road surface and wheelspin, 0–1 (1 = dry tarmac, wheels rolling). */
  readonly surface: number;
  /** Brake pedal, 0–1, counted only while rolling forward. */
  readonly braking: number;
  readonly sliding: boolean;
  /** Weather: scales the grip of a sliding tyre (1 in the dry). */
  readonly slidingGripMultiplier?: number;
}

/** Lateral grip the tyres have right now (px/s²). */
export function tyreGrip(input: GripInput, tuning: HandlingTuning = HANDLING_TUNING): number {
  const braking = clamp(input.braking, 0, 1);
  return (
    input.grip *
    input.surface *
    tuning.tyreHeadroom *
    (input.sliding ? tuning.slidingGrip * (input.slidingGripMultiplier ?? 1) : 1) *
    (1 - tuning.brakingGripLoss * braking * braking)
  );
}

/**
 * Yaw rate (rad/s) of full lock at `speed`: the steering rack's limit at low
 * speed, then `steerOverdrive` × the safe cornering limit. Pass the *dry*
 * grip: the steering does not know the road is wet, the tyres do.
 */
export function fullLockYaw(steerRate: number, grip: number, surface: number, speed: number, overdrive = HANDLING_TUNING.steerOverdrive): number {
  return Math.min(steerRate, (grip * surface * overdrive) / Math.max(Math.abs(speed), 70));
}

/** Slide angle (rad): between where the nose points and where the car goes. */
export function slideAngle(forward: number, lateral: number): number {
  return forward > 25 ? Math.atan2(lateral, forward) : 0;
}

/**
 * Power oversteer (rad/s, added to the steering yaw): on the throttle in a
 * slide the tail keeps stepping out, i.e. the slide angle grows.
 */
export function oversteerYaw(
  sliding: boolean,
  angle: number,
  throttle: number,
  drift: number,
  multiplier = 1,
  tuning: HandlingTuning = HANDLING_TUNING,
): number {
  if (!sliding || throttle <= 0) return 0;
  return -Math.sign(angle) * tuning.powerOversteer * multiplier * clamp(throttle, 0, 1) * clamp(drift, 0, 1);
}

export interface TyreState {
  /** Velocity along the nose (px/s). */
  readonly forward: number;
  /** Velocity across the nose (px/s). */
  readonly lateral: number;
}

export interface TyreResult extends TyreState {
  readonly sliding: boolean;
  /** 0–1: slide angle as a share of `fullDriftAngle`; 0 when not sliding. */
  readonly drift: number;
}

/**
 * Swings the velocity back in line with the nose. Going forward this
 * *redirects* the momentum (a tyre's side force does no work) and only scrubs
 * a little speed in proportion to the slide, so steering inputs do not cost
 * speed by themselves — braking too late and understeering does.
 *
 * The redirection is capped by the grip: ask for more and the car slides,
 * nose in, momentum out, and scrubs speed while it does.
 *
 * @param recovery `exp(-slipRecovery × surface × dt)`: the share of the slide
 *   angle kept this step when the tyres are not at their limit.
 */
export function resolveTyres(state: TyreState, grip: number, recovery: number, dt: number, tuning: HandlingTuning = HANDLING_TUNING): TyreResult {
  const { forward, lateral } = state;
  if (forward <= 25) return { forward, lateral: lateral * recovery, sliding: false, drift: 0 };
  const total = Math.hypot(forward, lateral);
  const angle = Math.atan2(lateral, forward);
  const wanted = Math.abs(angle) * (1 - recovery);
  const allowed = (Math.max(0, grip) / total) * dt;
  // Sticky: while sliding the caller passes the (lower) sliding grip, so the
  // car is caught only once the tyres could hold it at that grip.
  const sliding = wanted > allowed;
  const kept = angle - Math.sign(angle) * Math.min(wanted, allowed);
  // Arcade guard-rail: past this the tyres catch the car instead of letting it spin round.
  const slip = clamp(kept, -tuning.maxSlideAngle, tuning.maxSlideAngle);
  const scrub = 1 - Math.min(0.9, Math.abs(Math.sin(slip)) * 0.9) * dt;
  // A slide costs time: sideways tyres scrub speed (on top of the usual scrub).
  const slideLoss = sliding ? tuning.slideScrub * grip * Math.abs(Math.sin(slip)) * dt : 0;
  const speed = Math.max(0, total * scrub - slideLoss);
  return {
    forward: speed * Math.cos(slip),
    lateral: speed * Math.sin(slip),
    sliding,
    drift: sliding ? clamp(Math.abs(slip) / tuning.fullDriftAngle, 0, 1) : 0,
  };
}
