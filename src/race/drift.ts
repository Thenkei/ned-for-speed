import { DRIFT_TUNING, type DriftTuning } from '../domain/tuning';

/**
 * Drift rewards, kept pure for testing: follows one car's slide from start to
 * finish and says whether it was a drift worth nitro. `stepCar` (sim.ts)
 * feeds it every step and applies the reward.
 */

export interface DriftRun {
  /** Seconds spent at or past `minDrift`. */
  readonly seconds: number;
  /** ∫ drift dt over those seconds: deeper slides earn more. */
  readonly score: number;
  readonly entrySpeed: number;
  /** Seconds back on grip so far (ends the run at `settleSeconds`). */
  readonly settle: number;
}

export interface DriftSample {
  readonly sliding: boolean;
  /** 0–1, `CarSim.drift`. */
  readonly drift: number;
  /** Speed along the momentum (px/s). */
  readonly speed: number;
  readonly offRoad: boolean;
  /** Touched a wall or a car since the last step. */
  readonly contact: boolean;
}

export type DriftFailure = 'contact' | 'off-road' | 'scrubbed';

export type DriftOutcome =
  | { readonly kind: 'clean'; readonly seconds: number; readonly score: number; readonly nitroShare: number }
  | { readonly kind: 'failed'; readonly seconds: number; readonly reason: DriftFailure };

export interface DriftStep {
  readonly run: DriftRun | undefined;
  /** Set on the step a drift that lasted `minSeconds` ends, cleanly or not. */
  readonly outcome?: DriftOutcome;
}

/** Share of the nitro bottle a clean drift of this score earns. */
export function driftNitroShare(score: number, tuning: DriftTuning = DRIFT_TUNING): number {
  return Math.min(tuning.maxNitroShare, Math.max(0, score) * tuning.nitroPerDriftSecond);
}

export function stepDrift(run: DriftRun | undefined, sample: DriftSample, dt: number, tuning: DriftTuning = DRIFT_TUNING): DriftStep {
  const counts = sample.sliding && sample.drift >= tuning.minDrift;
  if (!run) {
    if (!counts || sample.speed < tuning.minSpeed || sample.offRoad || sample.contact) return { run: undefined };
    return { run: { seconds: dt, score: sample.drift * dt, entrySpeed: sample.speed, settle: 0 } };
  }

  // Ruined: only worth saying so if it had become a drift.
  const fail = (reason: DriftFailure): DriftStep =>
    run.seconds >= tuning.minSeconds ? { run: undefined, outcome: { kind: 'failed', seconds: run.seconds, reason } } : { run: undefined };
  if (sample.contact) return fail('contact');
  if (sample.offRoad) return fail('off-road');

  if (sample.sliding) {
    return {
      run: {
        seconds: run.seconds + (counts ? dt : 0),
        score: run.score + (counts ? sample.drift * dt : 0),
        entrySpeed: run.entrySpeed,
        settle: 0,
      },
    };
  }
  const settle = run.settle + dt;
  if (settle < tuning.settleSeconds) return { run: { ...run, settle } };

  // Caught. Too short is just a twitch: nothing to say.
  if (run.seconds < tuning.minSeconds) return { run: undefined };
  if (sample.speed < run.entrySpeed * tuning.minExitSpeedShare) return fail('scrubbed');
  return { run: undefined, outcome: { kind: 'clean', seconds: run.seconds, score: run.score, nitroShare: driftNitroShare(run.score, tuning) } };
}
