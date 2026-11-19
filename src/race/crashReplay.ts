import type { CarSim, RaceSim, SimEvent } from './sim';

const HISTORY = 2;
const SAMPLE_INTERVAL = 1 / 30;
export const REPLAY_SPEED = 0.5;

export type ReplayCar = Pick<CarSim,
  'id' | 'isPlayer' | 'racer' | 'x' | 'y' | 'vx' | 'vy' | 'heading' | 'steer' |
  'engine' | 'controls' | 'launch' | 'bodyDamage'
>;
type CollisionEffect = Extract<SimEvent, { type: 'wall' | 'bump' | 'explosion' }>;

interface Frame {
  time: number;
  cars: ReplayCar[];
  effects: CollisionEffect[];
}

function snapshot(car: CarSim): ReplayCar {
  const { id, isPlayer, racer, x, y, vx, vy, heading, steer, engine, controls, launch } = car;
  // Engine, controls, launch and individual panel marks are replaced by the sim.
  // The damage array itself is mutated in place, so each frame owns its list.
  return { id, isPlayer, racer, x, y, vx, vy, heading, steer, engine, controls, launch, bodyDamage: [...car.bodyDamage] };
}

/** A rolling pose history. Impacts get an exact frame between the regular samples. */
export class CrashReplay {
  private readonly frames: Frame[] = [];

  record(sim: RaceSim, firstEvent: number): void {
    const last = this.frames.at(-1);
    const due = !last || sim.time - last.time >= SAMPLE_INTERVAL - 1e-8;
    if (!due && firstEvent === sim.events.length) return;
    const effects = sim.events.slice(firstEvent).filter((event): event is CollisionEffect =>
      event.type === 'wall' || event.type === 'bump' || event.type === 'explosion');
    if (!due && !effects.length) return;
    const cutoff = sim.time - HISTORY;
    while (this.frames[1] && this.frames[1].time <= cutoff) this.frames.shift();
    this.frames.push({ time: sim.time, cars: sim.cars.map(snapshot), effects });
  }

  clear(): void {
    this.frames.length = 0;
  }

  get start(): number {
    return Math.max(this.frames[0]?.time ?? 0, this.end - HISTORY);
  }

  get end(): number {
    return this.frames.at(-1)?.time ?? 0;
  }

  /** Interpolate only the pose. Wrecks and panel damage appear on their recorded tick. */
  carsAt(time: number): ReplayCar[] {
    const next = this.frames.findIndex(frame => frame.time > time);
    const before = this.frames[next === -1 ? this.frames.length - 1 : Math.max(0, next - 1)];
    if (!before) return [];
    const after = this.frames[next];
    if (!after || time <= before.time) return before.cars;
    const t = (time - before.time) / (after.time - before.time);
    return before.cars.map((a, index) => {
      const b = after.cars[index]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      // A recovery reset teleports the car. Never interpolate across the track.
      if (Math.hypot(dx, dy) > 60) return a;
      const turn = b.heading - a.heading;
      return { ...a, x: a.x + dx * t, y: a.y + dy * t, heading: a.heading + Math.atan2(Math.sin(turn), Math.cos(turn)) * t };
    });
  }

  effectsBetween(from: number, to: number): CollisionEffect[] {
    const effects: CollisionEffect[] = [];
    for (const frame of this.frames) {
      if (frame.time > to) break;
      if (frame.time > from) effects.push(...frame.effects);
    }
    return effects;
  }
}
