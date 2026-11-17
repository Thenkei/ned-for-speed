import type { Stats } from './types';

/**
 * Engine heat / nitro model.
 *
 * Nitro is the risk-reward heart of the game: it gives a big boost but pumps
 * heat into the engine. Past the redline every second is a dice roll, and at
 * 100 % the engine lets go for sure. Reliability (car + cooling parts) slows
 * the heating, speeds the cooling and pushes the redline higher. A worn engine
 * (low condition) has a lower redline.
 */
export interface EngineSpec {
  /** Heat units per second while nitro is flowing. */
  readonly heatRateNitro: number;
  /** Heat units per second shed when nitro is off. */
  readonly coolRate: number;
  /** Heat level above which the engine may explode. */
  readonly redline: number;
  /** Seconds of nitro in a full bottle (0 = no kit fitted). */
  readonly nitroTank: number;
  /** Seconds of nitro regained per second when not spraying. */
  readonly nitroRegen: number;
  /** Top-speed multiplier while spraying. */
  readonly nitroSpeedBoost: number;
  /** Acceleration multiplier while spraying. */
  readonly nitroAccelBoost: number;
}

export interface EngineState {
  /** 0–100. */
  readonly heat: number;
  /** Seconds of nitro left. */
  readonly nitro: number;
  readonly nitroActive: boolean;
  readonly exploded: boolean;
  /** Condition points lost so far in this race. */
  readonly wear: number;
}

export interface EngineInput {
  /** 0–1. */
  readonly throttle: number;
  readonly nitroRequested: boolean;
}

export const MAX_HEAT = 100;
/** Minimum bottle content needed to (re)start spraying, avoids on/off flicker. */
const NITRO_RESTART_THRESHOLD = 0.25;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export function engineSpecFrom(stats: Stats, condition: number): EngineSpec {
  const reliability = clamp(stats.reliability, 0, 140);
  const nitro = clamp(stats.nitro, 0, 140);
  const wearPenalty = (100 - clamp(condition, 0, 100)) * 0.15;
  const hasKit = nitro > 0;
  const tank = hasKit ? 1.5 + nitro * 0.05 : 0;
  return {
    heatRateNitro: Math.max(12, 32 - reliability * 0.12),
    coolRate: 7 + reliability * 0.1,
    redline: clamp(70 + reliability * 0.15 - wearPenalty, 50, 92),
    nitroTank: tank,
    nitroRegen: tank / 22,
    nitroSpeedBoost: hasKit ? 1.12 + nitro * 0.0018 : 1,
    nitroAccelBoost: hasKit ? 1.5 + nitro * 0.01 : 1,
  };
}

export function initialEngineState(spec: EngineSpec): EngineState {
  return { heat: 25, nitro: spec.nitroTank, nitroActive: false, exploded: false, wear: 0 };
}

/** Heat of an engine cruising flat out without nitro. */
const CRUISING_HEAT = 38;

export interface NitroProfile {
  /** Seconds of continuous nitro, from cruising temperature, before the red zone. */
  readonly secondsToRedline: number;
  /** Seconds of nitro in a full bottle. */
  readonly tank: number;
  readonly redline: number;
}

/** Player-facing summary of what the engine tolerates (shown in the garage). */
export function nitroProfile(spec: EngineSpec): NitroProfile {
  return {
    secondsToRedline: Math.max(0, (spec.redline - CRUISING_HEAT) / spec.heatRateNitro),
    tank: spec.nitroTank,
    redline: spec.redline,
  };
}

/** Probability per second that the engine explodes at a given heat. */
export function explosionHazard(heat: number, spec: EngineSpec): number {
  if (heat >= MAX_HEAT) return Number.POSITIVE_INFINITY;
  if (heat <= spec.redline) return 0;
  const excess = (heat - spec.redline) / (MAX_HEAT - spec.redline);
  return 0.04 + 1.3 * excess * excess;
}

/**
 * Advance the engine by `dt` seconds.
 * `roll` is a uniform random number in [0, 1) supplied by the caller, which
 * keeps this function pure and the explosion logic testable.
 */
export function stepEngine(
  state: EngineState,
  spec: EngineSpec,
  input: EngineInput,
  dt: number,
  roll: number,
): EngineState {
  if (state.exploded) return state;

  const canSpray =
    input.nitroRequested &&
    spec.nitroTank > 0 &&
    (state.nitroActive ? state.nitro > 0 : state.nitro >= NITRO_RESTART_THRESHOLD);

  let heat = state.heat;
  let nitro = state.nitro;
  if (canSpray) {
    heat += spec.heatRateNitro * dt;
    nitro = Math.max(0, nitro - dt);
  } else {
    // Idle engine settles at 20, a flat-out one at the cruising heat.
    const floor = 20 + (CRUISING_HEAT - 20) * clamp(input.throttle, 0, 1);
    heat = heat > floor ? Math.max(floor, heat - spec.coolRate * dt) : Math.min(floor, heat + 12 * dt);
    nitro = Math.min(spec.nitroTank, nitro + spec.nitroRegen * dt);
  }
  heat = clamp(heat, 0, MAX_HEAT);

  const hazard = explosionHazard(heat, spec);
  const exploded = hazard === Number.POSITIVE_INFINITY || roll < hazard * dt;

  // Running in the red eats the engine even when it survives.
  const overRed = heat > spec.redline ? (heat - spec.redline) / (MAX_HEAT - spec.redline) : 0;
  const wear = state.wear + overRed * 6 * dt;

  return { heat, nitro, nitroActive: canSpray && !exploded, exploded, wear };
}

/**
 * Mapping from RPG stats to the arcade physics used on track.
 * Units: pixels and seconds (a car is ~46 px long).
 */
export interface DriveSpec {
  readonly maxSpeed: number;
  readonly accel: number;
  readonly brake: number;
  /** Maximum lateral acceleration before the car pushes wide. */
  readonly grip: number;
  /** Maximum yaw rate at low speed (rad/s). */
  readonly steerRate: number;
  /** How fast sideways slip is scrubbed off (1/s). */
  readonly slipRecovery: number;
  /**
   * Maximum longitudinal acceleration the tyres can put down before they
   * spin (px/s²). Unlimited on a dry road; the weather lowers it.
   */
  readonly traction: number;
}

export function driveSpecFrom(stats: Stats, condition: number): DriveSpec {
  // A tired engine loses up to 15 % of its punch.
  const health = 0.85 + 0.15 * (clamp(condition, 0, 100) / 100);
  const topSpeed = clamp(stats.topSpeed, 5, 150);
  const accel = clamp(stats.accel, 5, 150);
  const handling = clamp(stats.handling, 5, 150);
  return {
    maxSpeed: (270 + topSpeed * 5.2) * health,
    accel: (70 + accel * 2.3) * health,
    brake: 620 + handling * 3,
    grip: 380 + handling * 6,
    steerRate: 2.0 + handling * 0.008,
    slipRecovery: 4.5 + handling * 0.06,
    traction: Number.POSITIVE_INFINITY,
  };
}

/** Pixels per second → km/h as shown on the dashboard. */
export const KMH_PER_PX_S = 0.36;
