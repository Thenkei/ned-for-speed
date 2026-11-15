/**
 * Playability check: drives Ned with keyboard-like inputs — steering and
 * pedals are all-or-nothing and only change 15 times per second — and reports
 * how that compares with the rivals at equal car level. If this driver cannot
 * keep up, the handling model is too demanding for a keyboard.
 *
 * Note: adding a pure reaction *delay* on top makes the underlying
 * pure-pursuit controller oscillate into the walls (even with analog inputs),
 * which says something about that controller, not about players, who
 * anticipate. So no delay is modelled here.
 * Usage: npx vite-node scripts/keyboard-bot.ts
 */
import { DISTRICTS } from '../src/domain/world';
import type { RaceSetup, Racer, RivalSpec, Stats } from '../src/domain/types';
import { createAutopilot, createRaceSim, rankCars, stepRaceSim, type Controls } from '../src/race/sim';

const DT = 1 / 120;
const DECISION_EVERY = 8; // steps → 15 Hz

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
  // skill < 1 makes the bot brake earlier than the limit, like a cautious human.
  return { name: 'NED', look: { body: 'city', paint: '#fff', neon: '', spoiler: false }, stats, condition: 100, skill: 0.8, recklessness: 0.1 };
};

function run(setup: RaceSetup): string {
  const sim = createRaceSim(setup);
  const pilot = createAutopilot(sim);
  let held: Controls = { throttle: 0, brake: 0, steer: 0, nitro: false };
  let wallHits = 0;
  let step = 0;
  while (sim.phase !== 'finished' && step < 120 * 600) {
    const ideal = pilot(sim.player, DT);
    if (step % DECISION_EVERY === 0) {
      held = {
        throttle: ideal.throttle > 0.3 ? 1 : 0,
        brake: ideal.brake > 0.2 ? 1 : 0,
        steer: Math.abs(ideal.steer) > 0.5 ? Math.sign(ideal.steer) : 0,
        nitro: ideal.nitro,
      };
    }
    stepRaceSim(sim, held, DT);
    for (const event of sim.events) if (event.type === 'wall' && event.carId === sim.player.id) wallHits++;
    sim.events.length = 0;
    step++;
  }
  const ranked = rankCars(sim);
  const position = ranked.indexOf(sim.player) + 1;
  const winner = ranked[0];
  const gap = sim.player.finishTime !== undefined && winner?.finishTime !== undefined ? (sim.player.finishTime - winner.finishTime).toFixed(1) : 'DNF';
  const best = Math.min(...sim.cars.filter((c) => !c.isPlayer && c.bestLap !== undefined).map((c) => c.bestLap ?? Infinity));
  return `P${position}/${sim.cars.length}  gap ${gap}s  lap ${sim.player.bestLap?.toFixed(1)} vs best rival ${best.toFixed(1)}  walls ${wallHits}${sim.player.engine.exploded ? '  💥' : ''}`;
}

for (const district of DISTRICTS) {
  for (const event of [district.events[0], district.events[district.events.length - 1]]) {
    if (!event) continue;
    const top = Math.max(...event.rivals.map((r) => r.stats.topSpeed));
    for (const delta of [0, 6]) {
      const setup: RaceSetup = {
        title: event.name, trackId: district.trackId, theme: district.theme, laps: event.laps,
        player: playerAt(top + delta), rivals: event.rivals.map(toRacer), seed: 7,
      };
      console.log(`${event.id.padEnd(11)} [car ${delta >= 0 ? '+' : ''}${delta}]  ${run(setup)}`);
    }
  }
}
