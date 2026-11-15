import { TRACK_DEFS, buildTrack, SHOULDER } from '../src/race/track';
for (const def of TRACK_DEFS) {
  const t = buildTrack(def);
  let maxK = 0, at = 0;
  t.samples.forEach((s, i) => { if (Math.abs(s.curvature) > maxK) { maxK = Math.abs(s.curvature); at = i; } });
  const corridor = 2 * (t.halfWidth + SHOULDER);
  const skip = Math.ceil((corridor * 2.2) / t.step);
  const n = t.samples.length; let closest = Infinity; let ci = 0, cj = 0;
  for (let i = 0; i < n; i += 2) for (let j = i + skip; j < n; j += 2) { if (n - j + i < skip) continue; const a=t.samples[i]!, b=t.samples[j]!; const d=Math.hypot(a.x-b.x,a.y-b.y); if (d<closest){closest=d;ci=i;cj=j;} }
  const tight = t.samples.filter((s) => Math.abs(s.curvature) > 1 / (t.wallOffset + 10));
  const a = t.samples[at]!;
  console.log(def.id, 'len', Math.round(t.length), 'minR', Math.round(1/maxK), 'at', Math.round(a.x), Math.round(a.y), 'need', t.wallOffset + 10, 'closest', Math.round(closest), 'corridor', corridor, 'near', Math.round(t.samples[ci]!.x), Math.round(t.samples[ci]!.y), '|', Math.round(t.samples[cj]!.x), Math.round(t.samples[cj]!.y));
  const spots = new Set(tight.map((s) => `${Math.round(s.x/100)*100},${Math.round(s.y/100)*100}`));
  if (spots.size) console.log('   tight spots:', [...spots].join(' '));
}
