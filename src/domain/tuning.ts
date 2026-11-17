/**
 * Every tunable of the drivetrain, the race start and the weather, in one
 * place. The pure models (`drivetrain.ts`, `launch.ts`, `weather.ts`) take
 * these as defaults and accept overrides, which is how the tests pin them.
 *
 * Units follow the rest of the simulation: pixels, seconds, revolutions per
 * minute. "Norm" values are fractions of the redline RPM.
 */

// ───────────────────────── Gearbox & RPM ─────────────────────────

export type TransmissionMode = 'auto' | 'manual';

export interface DrivetrainTuning {
  readonly idleRpm: number;
  readonly redlineRpm: number;
  /** Hard cut: the engine cannot spin faster than this. */
  readonly limiterRpm: number;
  /**
   * Speed at which each gear hits the redline, as a fraction of the car's
   * absolute top speed (nitro included). The last gear never reaches the
   * redline on the flat, so the top gear has no limiter in practice.
   */
  readonly gearSpan: readonly number[];
  /** Automatic box: upshift when the current gear reaches this RPM norm. */
  readonly autoUpshiftNorm: number;
  /** Automatic box: downshift below this RPM norm with the throttle down… */
  readonly autoDownshiftNormOnThrottle: number;
  /** …and below this one when coasting. */
  readonly autoDownshiftNormCoasting: number;
  /** Minimum time between two automatic shifts (stops gear hunting). */
  readonly autoShiftCooldown: number;
  /** A manual downshift is refused if it would put the engine above this norm (no money shift). */
  readonly manualDownshiftMaxNorm: number;
  /** Clutch slip in first gear: engine RPM norm held at full throttle from standstill. */
  readonly launchSlipNorm: number;
  /** RPM change rates (rpm/s): free-revving in neutral, and with the clutch engaged. */
  readonly freeRevRise: number;
  readonly freeRevFall: number;
  readonly engagedRate: number;
  /** RPM norm the engine settles at while the wheels are spinning. */
  readonly wheelspinNorm: number;
  /** Manual box: below this RPM norm (gears ≥ 2) the engine lugs. */
  readonly lugNorm: number;
  /** Manual box: drive factor when lugging at 0 RPM (linear up to 1 at `lugNorm`). */
  readonly lugFloor: number;
  /** Manual box: reward for keeping the engine in its power band. */
  readonly powerBandNorm: readonly [number, number];
  readonly powerBandBonus: number;
  /** Manual box: drive fades out over the last fraction of a gear before the limiter. */
  readonly limiterFade: number;
}

export const DRIVETRAIN_TUNING: DrivetrainTuning = {
  idleRpm: 900,
  redlineRpm: 7000,
  limiterRpm: 7300,
  gearSpan: [0.27, 0.45, 0.62, 0.8, 1.02],
  autoUpshiftNorm: 0.9,
  autoDownshiftNormOnThrottle: 0.36,
  autoDownshiftNormCoasting: 0.24,
  autoShiftCooldown: 0.3,
  manualDownshiftMaxNorm: 0.97,
  launchSlipNorm: 0.42,
  freeRevRise: 4200,
  freeRevFall: 3200,
  engagedRate: 16000,
  wheelspinNorm: 0.9,
  lugNorm: 0.38,
  lugFloor: 0.4,
  powerBandNorm: [0.62, 1.0],
  powerBandBonus: 1.04,
  limiterFade: 0.03,
};

// ───────────────────────── Race start ─────────────────────────

export interface LaunchTuning {
  /**
   * Windows on the RPM norm at the green light. Below `underRevBelow` the
   * engine bogs; in `perfect` the car gets a boost; at or above `overRevFrom`
   * the wheels spin. Anything else is a normal start.
   */
  readonly underRevBelow: number;
  readonly perfect: readonly [number, number];
  readonly overRevFrom: number;
  /** Perfect start: acceleration multiplier and how long it lasts (fades out). */
  readonly perfectBoostMultiplier: number;
  readonly perfectBoostSeconds: number;
  /** Under-rev: acceleration multiplier while the engine bogs… */
  readonly underRevAccelMultiplier: number;
  /** …until the RPM norm climbs back to this… */
  readonly bogRecoveryNorm: number;
  /** …climbing no faster than this (rpm/s), and in any case for at most this long. */
  readonly bogRpmRise: number;
  readonly maxBogSeconds: number;
  /** Over-rev: acceleration multiplier while the wheels spin. */
  readonly overRevAccelMultiplier: number;
  /** Wheelspin duration: from `min` just over the threshold to `max` on the limiter. */
  readonly wheelspinSeconds: readonly [number, number];
  /** The multiplier eases back to 1 over this last fraction of the wheelspin. */
  readonly wheelspinFadeShare: number;
  /** Throttle below this counts as released, above `pressThreshold` as pressed. */
  readonly releaseThreshold: number;
  readonly pressThreshold: number;
}

export const LAUNCH_TUNING: LaunchTuning = {
  underRevBelow: 0.45,
  perfect: [0.58, 0.82],
  overRevFrom: 0.92,
  perfectBoostMultiplier: 1.3,
  perfectBoostSeconds: 1.6,
  underRevAccelMultiplier: 0.55,
  bogRecoveryNorm: 0.5,
  bogRpmRise: 2600,
  maxBogSeconds: 2,
  overRevAccelMultiplier: 0.5,
  wheelspinSeconds: [2.5, 5],
  wheelspinFadeShare: 0.25,
  releaseThreshold: 0.05,
  pressThreshold: 0.5,
};

/**
 * Rivals launch with the same mechanic as Ned: they floor the throttle some
 * time before the green light and live with the RPM they get. Their timing
 * error shrinks with skill, so street kids fluff starts and bosses nail them.
 */
export interface RivalLaunchTuning {
  /** Throttle timing error (s, ±) of a driver with skill 0; scales with (1 − skill). */
  readonly timingSpread: number;
  /** Seconds before a rival with skill 1 lifts to catch a wheelspin… */
  readonly spinReactionBase: number;
  /** …plus this many seconds per point of missing skill. */
  readonly spinReactionPerMissingSkill: number;
}

export const RIVAL_LAUNCH_TUNING: RivalLaunchTuning = {
  timingSpread: 1.8,
  spinReactionBase: 0.35,
  spinReactionPerMissingSkill: 4,
};

// ───────────────────────── Wheelspin (launch or traction) ─────────────────────────

export interface WheelspinTuning {
  /** Share of lateral grip lost at full wheelspin (0 = none, 1 = ice). */
  readonly gripLoss: number;
  /** Share of the traction limit a spinning tyre still delivers. */
  readonly spinningTractionEfficiency: number;
  /** Small deterministic fishtail at full wheelspin (rad/s of yaw). */
  readonly fishtailYaw: number;
  readonly fishtailHz: number;
}

export const WHEELSPIN_TUNING: WheelspinTuning = {
  gripLoss: 0.4,
  spinningTractionEfficiency: 0.8,
  fishtailYaw: 0.14,
  fishtailHz: 1.3,
};

// ───────────────────────── Weather ─────────────────────────

export type Weather = 'dry' | 'wet';

export interface WeatherProfile {
  readonly id: Weather;
  readonly label: string;
  /** Cornering grip (yaw cap, AI corner speeds). */
  readonly gripMultiplier: number;
  /** Braking deceleration: 0.7 means ~43 % longer stopping distances. */
  readonly brakeMultiplier: number;
  /** How fast a slide is caught: lower means slides last longer. */
  readonly slipRecoveryMultiplier: number;
  /** Longitudinal traction limit as a share of the cornering grip (Infinity = never limited). */
  readonly tractionShareOfGrip: number;
  /** Shifts the over-rev threshold of the race start (negative = spins sooner). */
  readonly overRevShift: number;
  /** Scales how long launch wheelspin lasts. */
  readonly wheelspinDurationMultiplier: number;
  /** Risk–reward: multiplier on the prize money of a race run in this weather. */
  readonly prizeMultiplier: number;
}

export const WEATHER_PROFILES: Readonly<Record<Weather, WeatherProfile>> = {
  // Dry is the legacy behaviour: every multiplier is neutral and traction is unlimited.
  dry: {
    id: 'dry',
    label: 'Sec',
    gripMultiplier: 1,
    brakeMultiplier: 1,
    slipRecoveryMultiplier: 1,
    tractionShareOfGrip: Number.POSITIVE_INFINITY,
    overRevShift: 0,
    wheelspinDurationMultiplier: 1,
    prizeMultiplier: 1,
  },
  // Rain is a leveller (scripts/winrate.ts, 20 seeds per scenario): at equal
  // stats Ned wins as often as in the dry, but a +6 favourite wins only ~63 %
  // as often and an underdog a little more. The 1.5× prize keeps the
  // favourite's expected payout about even, and makes rain the underdog's chance.
  wet: {
    id: 'wet',
    label: 'Pluie',
    gripMultiplier: 0.82,
    brakeMultiplier: 0.7,
    slipRecoveryMultiplier: 0.7,
    tractionShareOfGrip: 0.36,
    overRevShift: -0.06,
    wheelspinDurationMultiplier: 1.25,
    prizeMultiplier: 1.5,
  },
};

export interface ForecastTuning {
  /** Chance that a career race is run in the wet. */
  readonly rainChance: number;
}

export const FORECAST_TUNING: ForecastTuning = {
  rainChance: 0.3,
};
