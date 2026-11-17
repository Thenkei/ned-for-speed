/**
 * Balancing aid: Ned's win rate per scenario over many seeds. One seed per
 * race (scripts/balance.ts) is too noisy to tune from: starts, rain and
 * traffic swing single races. Ned is driven by the rival AI with skill 0.9,
 * starts included (his launch timing is drawn like a rival's).
 *
 * Usage: SEEDS=20 WEATHER=wet npx vite-node scripts/winrate.ts
 */
// Run under Node (vite-node); the project ships no @types/node.
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

import { rivalLaunchPlan } from '../src/domain/launch';
import type { Weather } from '../src/domain/tuning';
import type { RaceSetup, Racer, RivalSpec, Stats } from '../src/domain/types';
import { DISTRICTS } from '../src/domain/world';
import { createAutopilot, createRaceSim, rankCars, stepRaceSim } from '../src/race/sim';

const SEEDS = Math.max(1, Number(process.env.SEEDS ?? 20));
const WEATHER: Weather = process.env.WEATHER === 'wet' ? 'wet' : 'dry';
const DELTAS = [-6, 0, 6] as const;
const PLAYER_SKILL = 0.9;
const DT = 1 / 120;

const toRacer = (r: RivalSpec): Racer => ({
  name: r.name,
  look: { body: r.body, paint: r.paint, neon: r.neon, spoiler: r.spoiler },
  stats: r.stats,
  condition: 100,
  skill: r.skill,
  recklessness: r.recklessness,
});

const playerAt = (level: number): Racer => {
  const stats: Stats = { topSpeed: level, accel: level, handling: level + 8, reliability: 55, nitro: 20 + level * 0.4 };
  return { name: 'NED', look: { body: 'city', paint: '#fff', neon: '', spoiler: false }, stats, condition: 100, skill: PLAYER_SKILL, recklessness: 0.2 };
};

function wins(base: Omit<RaceSetup, 'seed' | 'weather'>): number {
  let won = 0;
  for (let k = 0; k < SEEDS; k++) {
    const sim = createRaceSim({ ...base, seed: 1000 + k * 7919, weather: WEATHER });
    // Golden-ratio sequence: evenly spread launch timings across the seeds.
    const pilot = createAutopilot(sim, rivalLaunchPlan(PLAYER_SKILL, (k * 0.6180339887) % 1));
    let guard = 0;
    while (sim.phase !== 'finished' && guard++ < 120 * 600) stepRaceSim(sim, pilot(sim.player, DT), DT);
    if (rankCars(sim)[0]?.isPlayer && !sim.player.engine.exploded) won++;
  }
  return won;
}

const totals = new Map<number, number>(DELTAS.map((d) => [d, 0]));
const tag = (delta: number): string => `${delta >= 0 ? '+' : ''}${delta}`;
for (const district of DISTRICTS) {
  const cells: string[] = [];
  const record = (label: string, delta: number, count: number): void => {
    totals.set(delta, (totals.get(delta) ?? 0) + count);
    cells.push(`${label}${tag(delta)}:${count}`);
  };
  for (const event of district.events) {
    const top = Math.max(...event.rivals.map((r) => r.stats.topSpeed));
    for (const delta of DELTAS) {
      record(event.id, delta, wins({
        title: event.name, trackId: district.trackId, theme: district.theme, laps: event.laps,
        player: playerAt(top + delta), rivals: event.rivals.map(toRacer),
      }));
    }
  }
  const boss = district.boss;
  for (const delta of DELTAS) {
    record('BOSS', delta, wins({
      title: boss.name, trackId: district.trackId, theme: district.theme, laps: boss.laps,
      player: playerAt(boss.rival.stats.topSpeed + delta), rivals: [toRacer(boss.rival)],
    }));
  }
  console.log(district.id, cells.join(' '));
}
const races = SEEDS * DISTRICTS.reduce((n, d) => n + d.events.length + 1, 0);
console.log(`TOTAL wins per stat gap (${WEATHER}, of ${races}):`, [...totals].map(([d, n]) => `${tag(d)}: ${n}`).join('  '));
