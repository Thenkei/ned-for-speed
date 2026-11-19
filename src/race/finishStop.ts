import { stepDrivetrain } from '../domain/drivetrain';
import { MAX_HEAT } from '../domain/engine';
import { sampleAtDistance } from './track';
import type { CarSim, RaceSim } from './sim';

const SLIDE_SECONDS = 1.05;
const RIVAL_BURN_SECONDS = 1.5;
const WEAR_PER_SECOND = 8;

export interface FinishStop {
  readonly startX: number;
  readonly startY: number;
  readonly entryX: number;
  readonly entryY: number;
  readonly startHeading: number;
  readonly endX: number;
  readonly endY: number;
  readonly endHeading: number;
  readonly side: number;
  readonly showoff: boolean;
  elapsed: number;
  burnSeconds: number;
}

export function planFinishStop(sim: RaceSim, car: CarSim, winner: boolean): FinishStop {
  const side = car.id % 2 === 0 ? 1 : -1;
  const ahead = 115 + Math.floor(car.id / 2) * 62;
  const spot = sampleAtDistance(sim.track, car.s + ahead);
  const lateral = side * (sim.track.halfWidth + 7);
  // A short tangent at entry carries momentum into the slide. The opposite end of
  // the curve has zero velocity, so even a high-speed finisher settles at rest.
  const lead = Math.min(ahead * 0.75, Math.hypot(car.vx, car.vy) * SLIDE_SECONDS / 3);
  const direction = Math.atan2(car.vy, car.vx);
  return {
    startX: car.x, startY: car.y,
    entryX: car.x + lead * Math.cos(direction), entryY: car.y + lead * Math.sin(direction),
    startHeading: car.heading,
    endX: spot.x + lateral * spot.nx, endY: spot.y + lateral * spot.ny,
    endHeading: Math.atan2(spot.ty, spot.tx) + side * 0.28,
    side, showoff: winner && !car.isPlayer && car.racer.recklessness >= 0.5,
    elapsed: 0, burnSeconds: 0,
  };
}

function slideToShoulder(car: CarSim, stop: FinishStop, dt: number): void {
  const t = Math.min(1, stop.elapsed / SLIDE_SECONDS);
  const u = 1 - t;
  const a = u ** 3, b = 3 * u * u * t, c = t * t * (3 - 2 * t);
  const x = a * stop.startX + b * stop.entryX + c * stop.endX;
  const y = a * stop.startY + b * stop.entryY + c * stop.endY;
  const turn = stop.endHeading - stop.startHeading;
  car.heading = stop.startHeading + Math.atan2(Math.sin(turn), Math.cos(turn)) * t
    + stop.side * 0.95 * Math.sin(Math.PI * t);
  car.vx = (x - car.x) / dt;
  car.vy = (y - car.y) / dt;
  car.x = x;
  car.y = y;
  car.speed = car.vx * Math.cos(car.heading) + car.vy * Math.sin(car.heading);
  car.slip = Math.abs(car.vy * Math.cos(car.heading) - car.vx * Math.sin(car.heading));
  car.steer = -stop.side * Math.sin(Math.PI * t);
}

export function stepFinishStop(sim: RaceSim, car: CarSim, stop: FinishStop, burnoutHeld: boolean, dt: number): void {
  const sliding = stop.elapsed < SLIDE_SECONDS;
  stop.elapsed += dt;
  if (sliding) {
    slideToShoulder(car, stop, dt);
  } else {
    car.vx = car.vy = car.speed = car.slip = car.steer = 0;
  }

  // A winner who arrived early waits for Ned to see the celebration.
  const rivalBurn = stop.showoff && stop.burnSeconds < RIVAL_BURN_SECONDS
    && (stop.burnSeconds > 0 || sim.phase === 'finished' || Math.hypot(car.x - sim.player.x, car.y - sim.player.y) < 260);
  const burning = !sliding && !car.engine.exploded && (car.isPlayer ? car.finished && burnoutHeld : rivalBurn);
  car.wheelspin = burning ? 1 : 0;
  car.controls = { throttle: burning ? 1 : 0, brake: sliding || burning ? 1 : 0, steer: car.steer, nitro: false };
  if (burning) {
    stop.burnSeconds += dt;
    // The front tyres hold while the rear swings around them.
    const nextHeading = car.heading + stop.side * 2.8 * dt;
    car.x += 9 * (Math.cos(car.heading) - Math.cos(nextHeading));
    car.y += 9 * (Math.sin(car.heading) - Math.sin(nextHeading));
    car.heading = nextHeading;
  }

  if (!car.engine.exploded) {
    const heat = burning ? Math.min(MAX_HEAT, car.engine.heat + 32 * dt)
      : Math.max(20, car.engine.heat - car.engineSpec.coolRate * dt);
    const wear = car.engine.wear + (burning ? WEAR_PER_SECOND * dt : 0);
    const failed = burning && car.isPlayer && (heat >= MAX_HEAT || wear >= car.racer.condition);
    car.engine = { ...car.engine, heat, wear, nitroActive: false };
    if (failed) {
      car.engine = { ...car.engine, exploded: true, explosionCause: 'burnout' };
      car.wheelspin = 0;
      sim.events.push({ type: 'explosion', carId: car.id });
    }
  }
  car.drivetrain = stepDrivetrain(car.drivetrain, car.gearbox, {
    throttle: burning ? 1 : 0, speed: car.speed, clutchIn: !sliding, shift: 0, wheelspin: car.wheelspin,
  }, dt);
}
