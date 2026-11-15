import { describe, expect, it } from 'vitest';
import { SHOULDER, TRACK_DEFS, buildTrack, locate } from '../src/race/track';

describe('tracks', () => {
  for (const def of TRACK_DEFS) {
    describe(def.id, () => {
      const track = buildTrack(def);

      it('has corners that are wide enough to drive', () => {
        const maxK = Math.max(...track.samples.map((s) => Math.abs(s.curvature)));
        const minRadius = 1 / maxK;
        // The inner wall must not fold over itself.
        expect(minRadius).toBeGreaterThan(track.wallOffset + 10);
      });

      it('never runs into itself', () => {
        const corridor = 2 * (track.halfWidth + SHOULDER) + 20;
        const skip = Math.ceil((corridor * 2.2) / track.step);
        const n = track.samples.length;
        let closest = Infinity;
        for (let i = 0; i < n; i += 3) {
          for (let j = i + skip; j < n; j += 3) {
            if (n - j + i < skip) continue;
            const a = track.samples[i]!;
            const b = track.samples[j]!;
            closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
          }
        }
        expect(closest).toBeGreaterThan(corridor);
      });

      it('locates points on the centre line', () => {
        const sample = track.samples[Math.floor(track.samples.length / 3)]!;
        const loc = locate(track, sample.x + sample.nx * 25, sample.y + sample.ny * 25);
        expect(loc.lateral).toBeCloseTo(25, 0);
        expect(Math.abs(loc.s - sample.s)).toBeLessThan(track.step);
      });
    });
  }
});
