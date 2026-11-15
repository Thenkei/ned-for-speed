/**
 * Balancing aid: runs every event headlessly with the player's car driven by
 * the rival AI, and prints who wins. Usage: npx vite-node scripts/balance.ts
 */
import { DISTRICTS } from '../src/domain/world';
import type { RaceSetup, Racer, RivalSpec, Stats } from '../src/domain/types';
import { createAutopilot, createRaceSim, rankCars, stepRaceSim } from '../src/race/sim';

const toRacer = (r: RivalSpec): Racer => ({
  name: r.name,
  look: { body: r.body, paint: r.paint, neon: r.neon, spoiler: r.spoiler },
  stats: r.stats,
  condition: 100,
  skill: r.skill,
  recklessness: r.recklessness,
});

function run(setup: RaceSetup, useNitro: boolean): string {
  const sim = createRaceSim(setup);
  const pilot = createAutopilot(sim);
  const dt = 1 / 120;
  let guard = 0;
  while (sim.phase !== 'finished' && guard++ < 120 * 600) {
    const c = pilot(sim.player, dt);
    stepRaceSim(sim, useNitro ? c : { ...c, nitro: false }, dt);
  }
  const ranked = rankCars(sim);
  return ranked
    .map((c) => `${c.racer.name}${c.engine.exploded ? '💥' : ''}:${c.finishTime ? c.finishTime.toFixed(1) : `(${Math.round(c.progress)})`}`)
    .join('  ');
}

const playerAt = (level: number, skill: number): Racer => {
  const stats: Stats = { topSpeed: level, accel: level, handling: level + 8, reliability: 55, nitro: 20 + level * 0.4 };
  return { name: `NED@${level}`, look: { body: 'city', paint: '#fff', neon: '', spoiler: false }, stats, condition: 100, skill, recklessness: 0.2 };
};

for (const district of DISTRICTS) {
  for (const event of district.events) {
    const top = Math.max(...event.rivals.map((r) => r.stats.topSpeed));
    for (const delta of [-6, 0, 6]) {
      const setup: RaceSetup = {
        title: event.name, trackId: district.trackId, theme: district.theme, laps: event.laps,
        player: playerAt(top + delta, 0.9), rivals: event.rivals.map(toRacer), seed: 1234,
      };
      console.log(`${event.id} [player ${delta >= 0 ? '+' : ''}${delta}]  ${run(setup, true)}`);
    }
  }
  const boss = district.boss;
  for (const delta of [-6, 0, 6]) {
    const setup: RaceSetup = {
      title: boss.name, trackId: district.trackId, theme: district.theme, laps: boss.laps,
      player: playerAt(boss.rival.stats.topSpeed + delta, 0.9), rivals: [toRacer(boss.rival)], seed: 99,
    };
    console.log(`BOSS ${boss.id} [player ${delta >= 0 ? '+' : ''}${delta}]  ${run(setup, true)}`);
  }
}
