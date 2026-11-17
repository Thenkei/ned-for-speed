/**
 * Every tunable of the drivetrain, in one place. The pure model
 * (`drivetrain.ts`) takes these as defaults and accepts overrides, which is
 * how the tests pin them.
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

