import type { Weather } from './tuning';

/**
 * Time trial ghosts.
 *
 * A ghost stores where Ned's car *was* (positions sampled at `GHOST_FRAME_HZ`),
 * not which keys were pressed. Replaying inputs would be smaller, but the
 * simulation leans on `Math.sin`/`Math.exp`, which JavaScript engines are free
 * to round differently: a run recorded in Chrome could drift off the road when
 * re-simulated in Safari. Positions replay the same everywhere.
 *
 * Everything here is pure; the race loop feeds a `GhostRecorder` and the
 * renderer asks `ghostPose` where to draw.
 */

export const GHOST_VERSION = 1;
export const GHOST_FRAME_HZ = 10;
/** Checkpoints per lap where the split against the ghost is shown. */
export const SECTORS_PER_LAP = 3;
/** Laps of a time trial run. */
export const TIME_TRIAL_LAPS = 3;

/** Positions are stored as integers: tenths of a pixel and milliradians. */
const POSITION_SCALE = 10;
const HEADING_SCALE = 1000;
const VALUES_PER_FRAME = 3;

export interface GhostRun {
  readonly version: typeof GHOST_VERSION;
  readonly trackId: string;
  readonly weather: Weather;
  /** Car model the run was set with: records are kept per model. */
  readonly modelId: string;
  readonly laps: number;
  /** Race time at the finish line (s). */
  readonly time: number;
  readonly bestLap: number | undefined;
  /** Race time at each checkpoint, `laps × SECTORS_PER_LAP` entries, the last one at the finish. */
  readonly splits: readonly number[];
  /** Flat `[x, y, heading]` per frame, quantised (see `POSITION_SCALE`, `HEADING_SCALE`). */
  readonly frames: readonly number[];
  /** ISO date the record was set. */
  readonly recordedAt: string;
}

export interface GhostPose {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

export function ghostKey(trackId: string, weather: Weather, modelId: string): string {
  return `${trackId}/${weather}/${modelId}`;
}

/** Number of checkpoints passed for a given race progress (0 before the first one). */
export function sectorsPassed(progress: number, trackLength: number, sectorsPerLap = SECTORS_PER_LAP): number {
  if (!(trackLength > 0) || !Number.isFinite(progress) || progress <= 0) return 0;
  return Math.floor((progress / trackLength) * sectorsPerLap);
}

/**
 * Collects a run while it is driven. Feed it every simulation step; it keeps
 * one frame per `1 / GHOST_FRAME_HZ` seconds and the time of each checkpoint.
 *
 * Keep feeding it for a moment after the finish line (the race outro does):
 * frames are taken on a fixed grid, so a recording cut at the line would end
 * up to one frame short and the ghost would park just before it.
 */
export class GhostRecorder {
  private readonly frames: number[] = [];
  private readonly splits: number[] = [];
  private nextFrameAt = 0;

  constructor(
    private readonly trackLength: number,
    private readonly totalSectors: number,
  ) {}

  /**
   * Records the car at race time `time` (s since the green light). Returns the
   * index of the checkpoint just crossed, if any (0-based), so the caller can
   * show the split.
   */
  sample(time: number, x: number, y: number, heading: number, progress: number): number | undefined {
    if (time >= this.nextFrameAt) {
      this.frames.push(Math.round(x * POSITION_SCALE), Math.round(y * POSITION_SCALE), Math.round(wrapAngle(heading) * HEADING_SCALE));
      this.nextFrameAt += 1 / GHOST_FRAME_HZ;
    }
    const passed = Math.min(this.totalSectors, sectorsPassed(progress, this.trackLength));
    // A car can only cross one checkpoint per step, but a reset could skip
    // ahead: fill every crossed checkpoint with the same time.
    let crossed: number | undefined;
    while (this.splits.length < passed) {
      this.splits.push(time);
      crossed = this.splits.length - 1;
    }
    return crossed;
  }

  /** The finished run, or undefined if the car did not complete every checkpoint. */
  finish(meta: {
    readonly trackId: string;
    readonly weather: Weather;
    readonly modelId: string;
    readonly laps: number;
    readonly time: number;
    readonly bestLap: number | undefined;
    readonly recordedAt: string;
  }): GhostRun | undefined {
    if (this.splits.length < this.totalSectors || !(meta.time > 0)) return undefined;
    return {
      version: GHOST_VERSION,
      ...meta,
      splits: [...this.splits],
      frames: [...this.frames],
    };
  }
}

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Where the ghost is at race time `time`, interpolated between frames (the
 * heading along the shortest turn). Undefined before the start; parked on the
 * last frame once its run is over.
 */
export function ghostPose(run: GhostRun, time: number): GhostPose | undefined {
  const count = Math.floor(run.frames.length / VALUES_PER_FRAME);
  if (count === 0 || !Number.isFinite(time) || time < 0) return undefined;
  const at = (index: number): GhostPose => {
    const i = Math.min(count - 1, Math.max(0, index)) * VALUES_PER_FRAME;
    return {
      x: (run.frames[i] ?? 0) / POSITION_SCALE,
      y: (run.frames[i + 1] ?? 0) / POSITION_SCALE,
      heading: (run.frames[i + 2] ?? 0) / HEADING_SCALE,
    };
  };
  const position = time * GHOST_FRAME_HZ;
  const index = Math.floor(position);
  if (index >= count - 1) return at(count - 1);
  const a = at(index);
  const b = at(index + 1);
  const t = position - index;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    heading: wrapAngle(a.heading + wrapAngle(b.heading - a.heading) * t),
  };
}

/** Time gained (negative) or lost (positive) against the ghost at a checkpoint. */
export function splitDelta(run: GhostRun, sector: number, time: number): number | undefined {
  const reference = run.splits[sector];
  return reference === undefined ? undefined : time - reference;
}

/** True when `candidate` should replace `current` as the record. */
export function beatsRecord(candidate: GhostRun, current: GhostRun | undefined): boolean {
  return current === undefined || candidate.time < current.time;
}

/** Validates a ghost read back from storage (anything malformed is dropped). */
export function isGhostRun(value: unknown): value is GhostRun {
  if (typeof value !== 'object' || value === null) return false;
  const run = value as Partial<GhostRun>;
  return (
    run.version === GHOST_VERSION &&
    typeof run.trackId === 'string' &&
    (run.weather === 'dry' || run.weather === 'wet') &&
    typeof run.modelId === 'string' &&
    typeof run.laps === 'number' &&
    run.laps > 0 &&
    typeof run.time === 'number' &&
    Number.isFinite(run.time) &&
    run.time > 0 &&
    (run.bestLap === undefined || (typeof run.bestLap === 'number' && Number.isFinite(run.bestLap))) &&
    Array.isArray(run.splits) &&
    run.splits.length === run.laps * SECTORS_PER_LAP &&
    run.splits.every((s) => typeof s === 'number' && Number.isFinite(s)) &&
    Array.isArray(run.frames) &&
    run.frames.length % VALUES_PER_FRAME === 0 &&
    run.frames.every((f) => typeof f === 'number' && Number.isFinite(f)) &&
    typeof run.recordedAt === 'string'
  );
}
