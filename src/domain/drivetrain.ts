import { DRIVETRAIN_TUNING, type DrivetrainTuning, type TransmissionMode } from './tuning';

/**
 * Gearbox and engine speed.
 *
 * The race physics stays an arcade force model (see `sim.ts`); this module adds
 * what an engine *sounds and feels* like on top of it: discrete gears, an RPM
 * with inertia (free-revving on the grid, clutch slip in first, a smooth drop
 * at each upshift) and, for the manual box only, a torque factor that rewards
 * keeping the engine in its power band.
 *
 * The automatic box never changes the car's acceleration (factor 1), so a
 * player who never touches the setting drives exactly the legacy car.
 *
 * Pure functions over immutable state, like `engine.ts`.
 */

export interface GearboxSpec {
  /** Speed (px/s) at which each gear reaches the redline; index 0 is first gear. */
  readonly gearTopSpeeds: readonly number[];
  readonly tuning: DrivetrainTuning;
}

export type ShiftRequest = -1 | 0 | 1;

export interface DrivetrainState {
  readonly mode: TransmissionMode;
  /** 1-based. */
  readonly gear: number;
  readonly rpm: number;
  /** Seconds before the automatic box may shift again. */
  readonly shiftCooldown: number;
  /** Bouncing off the rev limiter this step. */
  readonly limiter: boolean;
  /** Shift made during the last step (0: none). */
  readonly shifted: ShiftRequest;
}

export interface DrivetrainInput {
  /** 0–1. */
  readonly throttle: number;
  /** Forward speed, px/s (negative when reversing). */
  readonly speed: number;
  /** Clutch pedal down: on the grid the engine revs freely. */
  readonly clutchIn: boolean;
  /** Manual box only; ignored by the automatic one and with the clutch in. */
  readonly shift: ShiftRequest;
  /** 0–1: how hard the driven wheels are spinning (lifts the RPM off the road speed). */
  readonly wheelspin: number;
  /** Caps how fast the RPM may climb (rpm/s): an engine bogging after an under-revved start. */
  readonly maxRise?: number | undefined;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** `absoluteTopSpeed` is the fastest the car can go, nitro included (px/s). */
export function gearboxSpecFrom(absoluteTopSpeed: number, tuning: DrivetrainTuning = DRIVETRAIN_TUNING): GearboxSpec {
  if (!(absoluteTopSpeed > 0)) throw new Error(`gearboxSpecFrom: invalid top speed ${absoluteTopSpeed}`);
  if (tuning.gearSpan.length === 0) throw new Error('gearboxSpecFrom: a gearbox needs at least one gear');
  return { gearTopSpeeds: tuning.gearSpan.map((share) => share * absoluteTopSpeed), tuning };
}

export function initialDrivetrainState(mode: TransmissionMode, spec: GearboxSpec): DrivetrainState {
  return { mode, gear: 1, rpm: spec.tuning.idleRpm, shiftCooldown: 0, limiter: false, shifted: 0 };
}

export function gearCount(spec: GearboxSpec): number {
  return spec.gearTopSpeeds.length;
}

function gearTopSpeed(spec: GearboxSpec, gear: number): number {
  const top = spec.gearTopSpeeds[clamp(gear, 1, gearCount(spec)) - 1];
  if (top === undefined) throw new Error(`gearTopSpeed: no gear ${gear}`);
  return top;
}

/** Engine RPM imposed by the wheels in a given gear (no slip). */
export function wheelRpm(spec: GearboxSpec, gear: number, speed: number): number {
  return (Math.abs(speed) / gearTopSpeed(spec, gear)) * spec.tuning.redlineRpm;
}

/** RPM as a fraction of the redline (the unit of every RPM threshold in `tuning.ts`). */
export function rpmNorm(spec: GearboxSpec, rpm: number): number {
  return rpm / spec.tuning.redlineRpm;
}

function autoGear(spec: GearboxSpec, state: DrivetrainState, speed: number, throttle: number): number {
  const { tuning } = spec;
  if (state.shiftCooldown > 0) return state.gear;
  const norm = rpmNorm(spec, wheelRpm(spec, state.gear, speed));
  if (norm >= tuning.autoUpshiftNorm && state.gear < gearCount(spec)) return state.gear + 1;
  const downAt = throttle > 0.1 ? tuning.autoDownshiftNormOnThrottle : tuning.autoDownshiftNormCoasting;
  if (norm < downAt && state.gear > 1) {
    // Only drop a gear if the lower one would not immediately ask to go back up.
    const lower = rpmNorm(spec, wheelRpm(spec, state.gear - 1, speed));
    if (lower < tuning.autoUpshiftNorm * 0.95) return state.gear - 1;
  }
  return state.gear;
}

function manualGear(spec: GearboxSpec, state: DrivetrainState, speed: number, shift: ShiftRequest): number {
  if (shift === 1) return Math.min(gearCount(spec), state.gear + 1);
  if (shift === -1 && state.gear > 1) {
    // Refuse a downshift that would over-rev the engine: the box protects the
    // engine instead of letting a mis-key wreck it.
    const lower = rpmNorm(spec, wheelRpm(spec, state.gear - 1, speed));
    if (lower <= spec.tuning.manualDownshiftMaxNorm) return state.gear - 1;
  }
  return state.gear;
}

export function stepDrivetrain(
  state: DrivetrainState,
  spec: GearboxSpec,
  input: DrivetrainInput,
  dt: number,
): DrivetrainState {
  const { tuning } = spec;
  const throttle = clamp(input.throttle, 0, 1);
  const wheelspin = clamp(input.wheelspin, 0, 1);

  let gear = state.gear;
  if (!input.clutchIn) {
    gear = state.mode === 'auto' ? autoGear(spec, state, input.speed, throttle) : manualGear(spec, state, input.speed, input.shift);
  }
  const shifted: ShiftRequest = gear > state.gear ? 1 : gear < state.gear ? -1 : 0;

  let target: number;
  let rise: number;
  let fall: number;
  if (input.clutchIn) {
    // Free revving: the throttle sets where the needle wants to be.
    target = tuning.idleRpm + throttle * (tuning.limiterRpm - tuning.idleRpm);
    rise = tuning.freeRevRise;
    fall = tuning.freeRevFall;
  } else {
    target = Math.max(tuning.idleRpm, wheelRpm(spec, gear, input.speed));
    if (gear === 1 && throttle > 0) {
      // Clutch slip: pulling away in first the engine does not drop to idle.
      const slip = tuning.idleRpm + throttle * (tuning.launchSlipNorm * tuning.redlineRpm - tuning.idleRpm);
      target = Math.max(target, slip);
    }
    if (wheelspin > 0) {
      const spinning = tuning.wheelspinNorm * tuning.redlineRpm;
      if (spinning > target) target += (spinning - target) * wheelspin;
    }
    rise = tuning.engagedRate;
    fall = tuning.engagedRate;
  }
  if (input.maxRise !== undefined) rise = Math.min(rise, input.maxRise);
  target = Math.min(target, tuning.limiterRpm);

  const rpm = clamp(state.rpm + clamp(target - state.rpm, -fall * dt, rise * dt), 0, tuning.limiterRpm);
  const limiter = throttle > 0 && rpm >= tuning.limiterRpm - 60;
  const shiftCooldown = shifted !== 0 ? tuning.autoShiftCooldown : Math.max(0, state.shiftCooldown - dt);

  return { mode: state.mode, gear, rpm, shiftCooldown, limiter, shifted };
}

/**
 * Multiplier on the drive force from the gear choice. Always 1 with the
 * automatic box. With the manual one: the engine lugs if the gear is too long,
 * runs out of revs against the limiter if it is too short, and gets a small
 * bonus in its power band.
 */
export function gearDriveFactor(spec: GearboxSpec, state: DrivetrainState, speed: number): number {
  if (state.mode === 'auto' || speed <= 0) return 1;
  const { tuning } = spec;
  const top = gearTopSpeed(spec, state.gear);
  const limiterSpeed = top * (tuning.limiterRpm / tuning.redlineRpm);
  if (speed >= limiterSpeed) return 0;
  let factor = 1;
  const fadeStart = limiterSpeed * (1 - tuning.limiterFade);
  if (speed > fadeStart) factor = (limiterSpeed - speed) / (limiterSpeed - fadeStart);

  const norm = speed / top;
  const [bandLow, bandHigh] = tuning.powerBandNorm;
  if (state.gear > 1 && norm < tuning.lugNorm) {
    factor *= tuning.lugFloor + (1 - tuning.lugFloor) * (norm / tuning.lugNorm);
  } else if (norm >= bandLow && norm <= bandHigh) {
    factor *= tuning.powerBandBonus;
  }
  return factor;
}
