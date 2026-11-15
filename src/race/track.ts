/**
 * Track geometry. A track is a closed centripetal Catmull-Rom spline through a
 * handful of control points, resampled at a constant arc-length step so that
 * "distance along the track" is a cheap array lookup everywhere else.
 */

export interface TrackDef {
  readonly id: string;
  readonly name: string;
  /** Road width in pixels. */
  readonly width: number;
  /** Lane marking offsets from the centre line. */
  readonly laneLines: readonly number[];
  /** Corner-rounding passes (default 120). More = wider, faster bends. */
  readonly smoothing?: number;
  readonly points: readonly (readonly [number, number])[];
}

export interface TrackSample {
  readonly x: number;
  readonly y: number;
  /** Unit tangent (direction of travel). */
  readonly tx: number;
  readonly ty: number;
  /** Unit normal, pointing to the left of the direction of travel. */
  readonly nx: number;
  readonly ny: number;
  /** Signed curvature in 1/px. */
  readonly curvature: number;
  /** Distance from the start line. */
  readonly s: number;
}

export interface Track {
  readonly def: TrackDef;
  readonly samples: readonly TrackSample[];
  readonly length: number;
  readonly step: number;
  readonly halfWidth: number;
  /** Half-width of the drivable corridor (road + pavement) before the wall. */
  readonly wallOffset: number;
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
}

/** Width of the pavement between the road edge and the wall. */
export const SHOULDER = 42;
const SAMPLE_STEP = 10;

/**
 * The first control point is the start/finish line, so each list starts in
 * the middle of a straight: nobody wants a hairpin with cold tyres.
 */
export const TRACK_DEFS: readonly TrackDef[] = [
  {
    id: 'parking',
    name: 'Parking du Mégamarché',
    width: 170,
    laneLines: [0],
    points: [
      [1100, 250], [1900, 320], [2220, 680], [2000, 1060], [1420, 1010], [1120, 1360],
      [520, 1410], [230, 900], [320, 320],
    ],
  },
  {
    id: 'zi',
    name: 'Zone Industrielle Nord',
    width: 170,
    laneLines: [0],
    smoothing: 190,
    points: [
      [1000, 300], [1520, 540], [2100, 310], [2800, 440], [3020, 1000], [2520, 1360],
      [2700, 1900], [2020, 2160], [1500, 1760], [900, 2060], [350, 1700], [520, 1050],
      [320, 420],
    ],
  },
  {
    id: 'port',
    name: 'Les Quais',
    width: 190,
    laneLines: [0],
    points: [
      [1800, 280], [3200, 310], [3620, 720], [3300, 1160], [2400, 1110], [1900, 1500],
      [1000, 1560], [360, 1260], [210, 760], [420, 300],
    ],
  },
  {
    id: 'corniche',
    name: 'La Corniche',
    width: 150,
    laneLines: [0],
    smoothing: 170,
    points: [
      [1000, 1760], [1560, 1600], [1760, 1230], [1400, 960], [900, 1030], [560, 760],
      [860, 420], [1500, 500], [1950, 290], [2560, 340], [2860, 720], [2680, 1080],
      [2920, 1440], [2740, 1860], [2120, 2100], [1200, 2200], [420, 2180], [205, 1965],
      [420, 1750],
    ],
  },
  {
    id: 'periph',
    name: 'Le Périph’',
    width: 230,
    laneLines: [-38, 38],
    points: [
      [1800, 260], [3000, 360], [4000, 300], [4620, 820], [4500, 1700], [4800, 2500],
      [4200, 3100], [3000, 3000], [2200, 3300], [1100, 3100], [420, 2500], [560, 1500],
      [620, 420],
    ],
  },
];

type Vec = readonly [number, number];

/** Centripetal Catmull-Rom (alpha = 0.5): no cusps or loops between uneven control points. */
function catmullRom(p0: Vec, p1: Vec, p2: Vec, p3: Vec, u: number): Vec {
  const knot = (a: Vec, b: Vec): number => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a: Vec, b: Vec, ta: number, tb: number): Vec => {
    const w = (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

function resampleClosed(polyline: readonly Vec[], targetStep: number): { points: Vec[]; length: number; step: number } {
  const cumulative: number[] = [0];
  for (let i = 0; i < polyline.length; i++) {
    const a = polyline[i] as Vec;
    const b = polyline[(i + 1) % polyline.length] as Vec;
    cumulative.push((cumulative[i] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cumulative[polyline.length] as number;
  const count = Math.max(16, Math.round(length / targetStep));
  const step = length / count;
  const points: Vec[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const target = i * step;
    while (cursor < polyline.length - 1 && (cumulative[cursor + 1] as number) < target) cursor++;
    const segStart = cumulative[cursor] as number;
    const segEnd = cumulative[cursor + 1] as number;
    const a = polyline[cursor] as Vec;
    const b = polyline[(cursor + 1) % polyline.length] as Vec;
    const w = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
    points.push([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]);
  }
  return { points, length, step };
}

/** Laplacian smoothing of a closed polyline. */
function smoothClosed(polyline: readonly Vec[], iterations: number): Vec[] {
  let current = polyline.map((p) => [p[0], p[1]] as [number, number]);
  const n = current.length;
  for (let k = 0; k < iterations; k++) {
    const next = new Array<[number, number]>(n);
    for (let i = 0; i < n; i++) {
      const prev = current[(i - 1 + n) % n] as [number, number];
      const here = current[i] as [number, number];
      const after = current[(i + 1) % n] as [number, number];
      next[i] = [(prev[0] + 2 * here[0] + after[0]) / 4, (prev[1] + 2 * here[1] + after[1]) / 4];
    }
    current = next;
  }
  return current;
}

export function buildTrack(def: TrackDef): Track {
  const pts = def.points;
  const n = pts.length;
  if (n < 4) throw new Error(`Track ${def.id} needs at least 4 control points`);
  const at = (i: number): Vec => pts[((i % n) + n) % n] as Vec;

  // 1. Dense polyline.
  const dense: Vec[] = [];
  const PER_SEGMENT = 48;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < PER_SEGMENT; k++) {
      dense.push(catmullRom(at(i - 1), at(i), at(i + 1), at(i + 2), k / PER_SEGMENT));
    }
  }

  // 2. Resample at a constant step, round the corners off, resample again.
  //    The smoothing pass is what guarantees a minimum corner radius whatever
  //    the control points look like (σ ≈ step · √(iterations / 2)).
  const rough = resampleClosed(dense, SAMPLE_STEP).points;
  const smoothed = smoothClosed(rough, def.smoothing ?? 120);
  const { points: positions, length, step } = resampleClosed(smoothed, SAMPLE_STEP);
  const count = positions.length;

  // 4. Tangents, normals, curvature.
  const pos = (i: number): Vec => positions[((i % count) + count) % count] as Vec;
  const headings: number[] = [];
  for (let i = 0; i < count; i++) {
    const prev = pos(i - 1);
    const next = pos(i + 1);
    headings.push(Math.atan2(next[1] - prev[1], next[0] - prev[0]));
  }
  const heading = (i: number): number => headings[((i % count) + count) % count] as number;
  const angleDiff = (a: number, b: number): number => {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };

  const SMOOTH = 3;
  const samples: TrackSample[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const p = pos(i);
    const h = heading(i);
    const curvature = angleDiff(heading(i + SMOOTH), heading(i - SMOOTH)) / (2 * SMOOTH * step);
    const tx = Math.cos(h);
    const ty = Math.sin(h);
    samples.push({ x: p[0], y: p[1], tx, ty, nx: -ty, ny: tx, curvature, s: i * step });
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }

  return {
    def,
    samples,
    length,
    step,
    halfWidth: def.width / 2,
    wallOffset: def.width / 2 + SHOULDER,
    bounds: { minX, minY, maxX, maxY },
  };
}

const cache = new Map<string, Track>();

export function trackById(id: string): Track {
  const cached = cache.get(id);
  if (cached) return cached;
  const def = TRACK_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown track: ${id}`);
  const track = buildTrack(def);
  cache.set(id, track);
  return track;
}

export function sampleAt(track: Track, index: number): TrackSample {
  const count = track.samples.length;
  return track.samples[((index % count) + count) % count] as TrackSample;
}

/** Sample nearest to a distance along the track (wraps around). */
export function sampleAtDistance(track: Track, s: number): TrackSample {
  return sampleAt(track, Math.round(s / track.step));
}

export interface TrackLocation {
  readonly index: number;
  /** Distance along the lap, in [0, length). */
  readonly s: number;
  /** Signed offset from the centre line (positive = left of travel). */
  readonly lateral: number;
}

/**
 * Projects a point onto the centre line. `hint` is the sample index found on
 * the previous frame; the search stays local around it, which is both fast and
 * robust where two parts of the track run close to each other.
 */
export function locate(track: Track, x: number, y: number, hint?: number): TrackLocation {
  const count = track.samples.length;
  let best = 0;
  let bestDistance = Infinity;
  const consider = (i: number): void => {
    const sample = sampleAt(track, i);
    const d = (sample.x - x) ** 2 + (sample.y - y) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = ((i % count) + count) % count;
    }
  };
  if (hint === undefined) {
    for (let i = 0; i < count; i++) consider(i);
  } else {
    const WINDOW = 14;
    for (let i = hint - WINDOW; i <= hint + WINDOW; i++) consider(i);
  }
  const sample = sampleAt(track, best);
  const dx = x - sample.x;
  const dy = y - sample.y;
  const along = dx * sample.tx + dy * sample.ty;
  const lateral = dx * sample.nx + dy * sample.ny;
  let s = sample.s + along;
  if (s < 0) s += track.length;
  if (s >= track.length) s -= track.length;
  return { index: best, s, lateral };
}

/** Largest absolute curvature between two distances along the lap. */
export function maxCurvature(track: Track, fromS: number, toS: number): number {
  const start = Math.round(fromS / track.step);
  const end = Math.round(toS / track.step);
  let max = 0;
  for (let i = start; i <= end; i++) max = Math.max(max, Math.abs(sampleAt(track, i).curvature));
  return max;
}
