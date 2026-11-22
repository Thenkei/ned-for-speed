/**
 * Handling check: how much each kind of driver slides, and what it costs.
 *
 *  - rivals, by recklessness: careful ones should (almost) never slide;
 *  - Ned on the autopilot, with skill 0.9 (a tidy driver) and 1.15 (one who
 *    arrives too fast in every corner: he should slide, and lose time);
 *  - Ned with keyboard-like all-or-nothing inputs (see keyboard-bot.ts).
 *
 * Usage: npx vite-node scripts/handling-probe.ts   (WEATHER=wet for the rain)
 *   HANDLING='{"steerOverdrive":1.2}'  tries other tunables;
 *   LEGACY=1                            approximates the old never-slide model;
 *   DRIFT='{"nitroPerDriftSecond":0}'  tries other drift rewards (0 = none).
 */
import { DRIFT_TUNING, HANDLING_TUNING, type HandlingTuning, type Weather } from '../src/domain/tuning';
import type { RaceSetup, Racer, RivalSpec, Stats } from '../src/domain/types';
import { DISTRICTS } from '../src/domain/world';
import { createAutopilot, createRaceSim, stepRaceSim, type CarSim, type Controls } from '../src/race/sim';

const DT = 1 / 120;
const weather = (process.env['WEATHER'] ?? 'dry') as Weather;
const legacy: Partial<HandlingTuning> = { tyreHeadroom: 1, steerOverdrive: 1, slidingGrip: 1, brakingGripLoss: 0, powerOversteer: 0, slideScrub: 0, aiGripUse: [1, 1] };
Object.assign(HANDLING_TUNING, process.env['LEGACY'] ? legacy : {}, JSON.parse(process.env['HANDLING'] ?? '{}'));
Object.assign(DRIFT_TUNING, JSON.parse(process.env['DRIFT'] ?? '{}'));
console.log('handling', JSON.stringify(HANDLING_TUNING), 'drift', JSON.stringify(DRIFT_TUNING));

const toRacer = (r: RivalSpec): Racer => ({
  name: r.name,
  look: { body: r.body, paint: r.paint, neon: r.neon, spoiler: r.spoiler },
  stats: r.stats,
  condition: 100,
  skill: r.skill,
  recklessness: r.recklessness,
});

const ned = (level: number, skill: number): Racer => {
  const stats: Stats = { topSpeed: level, accel: level, handling: level + 8, reliability: 55, nitro: 20 + level * 0.4 };
  return { name: 'NED', look: { body: 'city', paint: '#fff', neon: '', spoiler: false }, stats, condition: 100, skill, recklessness: 0.1 };
};

type Driver = 'tidy' | 'too-fast' | 'keyboard' | 'tapping';

interface Tally {
  clean: number;
  failed: number;
  steps: number;
  sliding: number;
  walls: number;
  maxDrift: number;
}

function race(setup: RaceSetup, driver: Driver): { ned: Tally & { time: number | undefined; why: string }; rivals: Map<number, Tally> } {
  const sim = createRaceSim(setup);
  const pilot = createAutopilot(sim);
  const tallies = new Map<CarSim, Tally>(sim.cars.map((car) => [car, { clean: 0, failed: 0, steps: 0, sliding: 0, walls: 0, maxDrift: 0 }]));
  let held: Controls = { throttle: 0, brake: 0, steer: 0, nitro: false };
  let tapDebt = 0;
  for (let step = 0; sim.phase !== 'finished' && step < 120 * 600; step++) {
    const ideal = pilot(sim.player, DT);
    if (driver === 'keyboard') {
      if (step % 8 === 0) {
        held = {
          throttle: ideal.throttle > 0.3 ? 1 : 0,
          brake: ideal.brake > 0.2 ? 1 : 0,
          steer: Math.abs(ideal.steer) > 0.5 ? Math.sign(ideal.steer) : 0,
          nitro: ideal.nitro,
        };
      }
    } else if (driver === 'tapping') {
      // Keyboard too, but tapping: a held key 15×/s with a duty cycle that
      // follows the wanted steering (error diffusion), like a player feathering ←/→.
      if (step % 8 === 0) {
        tapDebt += ideal.steer;
        const steer = tapDebt > 0.5 ? 1 : tapDebt < -0.5 ? -1 : 0;
        tapDebt -= steer;
        held = { throttle: ideal.throttle > 0.3 ? 1 : 0, brake: ideal.brake > 0.2 ? 1 : 0, steer, nitro: ideal.nitro };
      }
    } else {
      held = ideal;
    }
    stepRaceSim(sim, held, DT);
    for (const event of sim.events) {
      const car = sim.cars.find((c) => c.id === (event as { carId?: number }).carId);
      if (event.type === 'wall' && car) tallies.get(car)!.walls++;
      if (event.type === 'drift' && car) tallies.get(car)![event.outcome.kind === 'clean' ? 'clean' : 'failed']++;
    }
    sim.events.length = 0;
    if (sim.phase !== 'racing') continue;
    for (const car of sim.cars) {
      if (car.finished) continue;
      const t = tallies.get(car)!;
      t.steps++;
      if (car.sliding) t.sliding++;
      t.maxDrift = Math.max(t.maxDrift, car.drift);
    }
  }
  const rivals = new Map<number, Tally>();
  for (const car of sim.cars) if (!car.isPlayer) rivals.set(car.racer.recklessness, tallies.get(car)!);
  return { ned: { ...tallies.get(sim.player)!, time: sim.player.finishTime, why: sim.player.engine.exploded ? `💥${sim.player.engine.explosionCause}` : `lap${sim.player.lap}` }, rivals };
}

const pct = (t: Tally) => `${((100 * t.sliding) / Math.max(1, t.steps)).toFixed(1).padStart(4)}%`;
const byReck = new Map<string, Tally>();

for (const district of DISTRICTS) {
  const event = district.events[0]!;
  const top = Math.max(...event.rivals.map((r) => r.stats.topSpeed));
  const line: string[] = [];
  for (const driver of ['tidy', 'too-fast', 'keyboard', 'tapping'] as const) {
    const setup: RaceSetup = {
      title: event.name, trackId: district.trackId, theme: district.theme, laps: event.laps,
      player: ned(top + 3, driver === 'too-fast' ? 1.15 : driver === 'keyboard' || driver === 'tapping' ? 0.8 : 0.9),
      rivals: event.rivals.map(toRacer), seed: 7, weather,
    };
    const { ned: n, rivals } = race(setup, driver);
    line.push(`${driver.slice(0, 3)} slide ${pct(n)} drifts ${n.clean}/${n.failed} walls ${String(n.walls).padStart(2)} time ${n.time?.toFixed(1) ?? `DNF(${n.why})`}`);
    if (driver === 'tidy') {
      for (const [reck, t] of rivals) {
        const key = reck.toFixed(2);
        const sum = byReck.get(key) ?? { clean: 0, failed: 0, steps: 0, sliding: 0, walls: 0, maxDrift: 0 };
        byReck.set(key, { clean: sum.clean + t.clean, failed: sum.failed + t.failed, steps: sum.steps + t.steps, sliding: sum.sliding + t.sliding, walls: sum.walls + t.walls, maxDrift: Math.max(sum.maxDrift, t.maxDrift) });
      }
    }
  }
  console.log(`${district.id.padEnd(9)} ${line.join('  |  ')}`);
}
console.log(`\nRivals (${weather}) by recklessness:`);
for (const [reck, t] of [...byReck].sort()) console.log(`  ${reck}: slide ${pct(t)} max ${t.maxDrift.toFixed(2)} walls ${t.walls} drifts clean/failed ${t.clean}/${t.failed}`);
