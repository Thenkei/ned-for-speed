import {
  driveSpecFrom,
  engineSpecFrom,
  initialEngineState,
  KMH_PER_PX_S,
  stepEngine,
  type DriveSpec,
  type EngineSpec,
  type EngineState,
} from '../domain/engine';
import {
  gearboxSpecFrom,
  gearDriveFactor,
  initialDrivetrainState,
  rpmNorm,
  stepDrivetrain,
  type DrivetrainState,
  type GearboxSpec,
  type ShiftRequest,
} from '../domain/drivetrain';
import {
  gridThrottle,
  launchAccelMultiplier,
  launchRpmRiseCap,
  launchWheelspin,
  perfectLaunchPlan,
  rivalLaunchPlan,
  shouldLiftForGrip,
  startLaunch,
  stepLaunch,
  type LaunchEnd,
  type LaunchGrade,
  type LaunchPlan,
  type LaunchState,
} from '../domain/launch';
import { createRng, type Rng } from '../domain/rng';
import { WHEELSPIN_TUNING, type TransmissionMode, type WeatherProfile } from '../domain/tuning';
import { applyWeather, weatherProfile } from '../domain/weather';
import type { RaceOutcome, RaceSetup, RaceStanding, Racer } from '../domain/types';
import { BODY_SHAPES, markScrape, type Scrape } from './carBody';
import { locate, maxCurvature, sampleAt, sampleAtDistance, trackById, type Track } from './track';

/**
 * Race simulation: deterministic for a given seed and input sequence, with no
 * DOM access, so the AI and the rules can be exercised headlessly in tests.
 * The structures are mutated in place: this runs 120 times per second.
 */

export interface Controls {
  /** 0–1. */
  throttle: number;
  /** 0–1. */
  brake: number;
  /** -1 (left) … 1 (right). */
  steer: number;
  nitro: boolean;
  /** Manual gearbox: one gear up / down, applied on a single step. */
  shift?: ShiftRequest;
}

export type SimEvent =
  | { readonly type: 'explosion'; readonly carId: number }
  | { readonly type: 'bump'; readonly carId: number; readonly strength: number }
  | { readonly type: 'wall'; readonly carId: number; readonly strength: number; readonly x: number; readonly y: number; readonly sliding: boolean }
  | { readonly type: 'lap'; readonly carId: number; readonly lap: number; readonly lapTime: number }
  | { readonly type: 'finish'; readonly carId: number }
  | { readonly type: 'countdown'; readonly value: number }
  | { readonly type: 'go' }
  | { readonly type: 'launch'; readonly carId: number; readonly grade: LaunchGrade }
  | { readonly type: 'launch-end'; readonly carId: number; readonly grade: LaunchGrade; readonly endedBy: LaunchEnd }
  | { readonly type: 'shift'; readonly carId: number; readonly gear: number; readonly direction: ShiftRequest };

interface AiState {
  lane: number;
  laneTimer: number;
  spraying: boolean;
  stuckTime: number;
  /** How this driver plays the race start. */
  readonly launch: LaunchPlan;
}

export interface CarSim {
  readonly id: number;
  readonly racer: Racer;
  readonly isPlayer: boolean;
  readonly drive: DriveSpec;
  readonly engineSpec: EngineSpec;
  engine: EngineState;
  readonly gearbox: GearboxSpec;
  drivetrain: DrivetrainState;
  /** Race-start effect, for every car (rivals time their start from their skill). */
  launch: LaunchState | undefined;
  /** 0–1: how hard the driven wheels spin (bad launch, or more power than the road takes). */
  wheelspin: number;
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  /** Smoothed steering actually applied (-1…1). */
  steer: number;
  controls: Controls;
  /** Forward speed (px/s) and sideways slip speed, refreshed every step. */
  speed: number;
  slip: number;
  trackIndex: number;
  s: number;
  lateral: number;
  /** Completed laps (-1 before the first start-line crossing). */
  lap: number;
  /** Total distance raced; `laps * track.length` means finished. */
  progress: number;
  finished: boolean;
  finishTime: number | undefined;
  lapStartTime: number;
  bestLap: number | undefined;
  topSpeed: number;
  wrongWayTime: number;
  onPavement: boolean;
  readonly scrapes: Scrape[];
  nextScrapeAt: number;
  readonly ai: AiState | undefined;
}

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface RaceSim {
  readonly setup: RaceSetup;
  readonly track: Track;
  readonly cars: CarSim[];
  readonly player: CarSim;
  readonly rng: Rng;
  readonly weather: WeatherProfile;
  phase: RacePhase;
  /** Seconds left before the start. */
  countdown: number;
  /** Race clock (starts at the green light). */
  time: number;
  /** Seconds since the race was decided, used to let the scene breathe before leaving. */
  finishedFor: number;
  firstFinishTime: number | undefined;
  events: SimEvent[];
}

const COUNTDOWN_SECONDS = 3.6;
// Dashboard km/h directed into the wall. Along-wall motion does not contribute.
const FATAL_WALL_SPEED = 100 / KMH_PER_PX_S;
const CAR_RADIUS = 11;
const CAR_CIRCLE_OFFSET = 12;
/** After the first finisher, stragglers get this long before the race is called. */
const STRAGGLER_TIMEOUT = 40;
const NEUTRAL: Controls = { throttle: 0, brake: 0, steer: 0, nitro: false };

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export interface SimOptions {
  /** Gearbox of Ned's car; rivals always drive automatics. Default: automatic. */
  readonly playerTransmission?: TransmissionMode;
}

function createCar(
  id: number,
  racer: Racer,
  isPlayer: boolean,
  track: Track,
  gridSlot: number,
  rng: Rng,
  weather: WeatherProfile,
  transmission: TransmissionMode,
  launchRoll: number,
): CarSim {
  const engineSpec = engineSpecFrom(racer.stats, racer.condition);
  const drive = applyWeather(driveSpecFrom(racer.stats, racer.condition), weather);
  const gearbox = gearboxSpecFrom(drive.maxSpeed * engineSpec.nitroSpeedBoost);
  // Two-by-two grid behind the line; the player (last slot) starts at the back.
  const row = Math.floor(gridSlot / 2);
  const side = gridSlot % 2 === 0 ? -1 : 1;
  const distanceBehind = 70 + row * 78 + (side > 0 ? 26 : 0);
  const startS = track.length - distanceBehind;
  const sample = sampleAtDistance(track, startS);
  const lateral = side * track.halfWidth * 0.42;
  const location = locate(track, sample.x + sample.nx * lateral, sample.y + sample.ny * lateral);
  return {
    id,
    racer,
    isPlayer,
    drive,
    engineSpec,
    engine: initialEngineState(engineSpec),
    gearbox,
    drivetrain: initialDrivetrainState(transmission, gearbox),
    launch: undefined,
    wheelspin: 0,
    x: sample.x + sample.nx * lateral,
    y: sample.y + sample.ny * lateral,
    heading: Math.atan2(sample.ty, sample.tx),
    vx: 0,
    vy: 0,
    steer: 0,
    controls: { ...NEUTRAL },
    speed: 0,
    slip: 0,
    trackIndex: location.index,
    s: location.s,
    lateral: location.lateral,
    lap: -1,
    progress: location.s - track.length,
    finished: false,
    finishTime: undefined,
    lapStartTime: 0,
    bestLap: undefined,
    topSpeed: 0,
    wrongWayTime: 0,
    onPavement: false,
    scrapes: [],
    nextScrapeAt: 0,
    ai: isPlayer
      ? undefined
      : {
          lane: lateral,
          laneTimer: rng.range(1.5, 4),
          spraying: false,
          stuckTime: 0,
          launch: rivalLaunchPlan(racer.skill, launchRoll),
        },
  };
}

export function createRaceSim(setup: RaceSetup, options: SimOptions = {}): RaceSim {
  const track = trackById(setup.trackId);
  const rng = createRng(setup.seed);
  const weather = weatherProfile(setup.weather);
  const cars: CarSim[] = [];
  setup.rivals.forEach((racer, index) =>
    cars.push(createCar(index, racer, false, track, index, rng, weather, 'auto', launchRoll(setup.seed, index))),
  );
  const player = createCar(
    cars.length, setup.player, true, track, cars.length, rng, weather, options.playerTransmission ?? 'auto', 0.5,
  );
  cars.push(player);
  return {
    setup,
    track,
    cars,
    player,
    rng,
    weather,
    phase: 'countdown',
    countdown: COUNTDOWN_SECONDS,
    time: 0,
    finishedFor: 0,
    firstFinishTime: undefined,
    events: [],
  };
}

/**
 * Each rival's start is drawn from its own stream, derived from the race seed:
 * the shared race RNG (lane changes, engine rolls) keeps its exact sequence.
 */
function launchRoll(seed: number, carIndex: number): number {
  return createRng((seed ^ Math.imul(carIndex + 1, 0x9e3779b1)) >>> 0).next();
}

// ───────────────────────── AI ─────────────────────────

function aiControls(sim: RaceSim, car: CarSim, ai: AiState, dt: number): Controls {
  const controls = aiDriving(sim, car, ai, dt);
  // On the grid only the throttle matters. The driving logic above still runs
  // so the AI state (and its RNG draws) evolve exactly as they always did.
  if (sim.phase === 'countdown') {
    return { ...controls, throttle: gridThrottle(ai.launch, sim.countdown), brake: 0, nitro: false };
  }
  // Wheels spinning off the line: lift for a step, which cancels it.
  if (shouldLiftForGrip(ai.launch, car.launch)) return { ...controls, throttle: 0, nitro: false };
  return controls;
}

function aiDriving(sim: RaceSim, car: CarSim, ai: AiState, dt: number): Controls {
  const { track } = sim;
  const { drive } = car;
  const racer = car.racer;
  const speed = Math.max(0, car.speed);

  // Lane keeping: wander a little, and move over when about to run into someone.
  ai.laneTimer -= dt;
  const laneLimit = track.halfWidth - 30;
  if (ai.laneTimer <= 0) {
    ai.lane = sim.rng.range(-laneLimit, laneLimit) * 0.8;
    ai.laneTimer = sim.rng.range(2, 5);
  }
  for (const other of sim.cars) {
    if (other === car) continue;
    let gap = other.s - car.s;
    if (gap < -track.length / 2) gap += track.length;
    if (gap > track.length / 2) gap -= track.length;
    if (gap > 0 && gap < 110 && Math.abs(other.lateral - car.lateral) < 30 && other.speed < speed + 20) {
      ai.lane = clamp(other.lateral + (other.lateral > 0 ? -1 : 1) * 62, -laneLimit, laneLimit);
      ai.laneTimer = 1.6;
    }
  }

  // Pure pursuit towards a point ahead on the chosen lane.
  const lookahead = 55 + speed * 0.28;
  const target = sampleAtDistance(track, car.s + lookahead);
  const tx = target.x + target.nx * ai.lane;
  const ty = target.y + target.ny * ai.lane;
  const desired = Math.atan2(ty - car.y, tx - car.x);
  const steer = clamp(wrapAngle(desired - car.heading) * 2.6, -1, 1);

  // Speed planning: the fastest speed that still lets the car brake for every bend in range.
  const cornerGrip = drive.grip * racer.skill;
  const brakePower = drive.brake * 0.75;
  const horizon = 80 + (speed * speed) / (2 * brakePower) + speed * 0.25;
  let targetSpeed = Infinity;
  for (let d = 0; d <= horizon; d += 30) {
    const k = maxCurvature(track, car.s + d, car.s + d + 30);
    if (k < 1e-5) continue;
    const cornerSpeed = Math.sqrt(cornerGrip / k);
    const allowed = Math.sqrt(cornerSpeed * cornerSpeed + 2 * brakePower * d);
    if (allowed < targetSpeed) targetSpeed = allowed;
  }

  // Gentle rubber band so that races stay fights rather than processions.
  const gapToPlayer = car.progress - sim.player.progress;
  const band = clamp(1 - gapToPlayer / 9000, 0.955, 1.035);
  targetSpeed *= band;

  let throttle = 0;
  let brake = 0;
  if (speed < targetSpeed - 4) throttle = 1;
  else if (speed > targetSpeed + 12) brake = clamp((speed - targetSpeed) / 70, 0.35, 1);
  else throttle = 0.4;
  // Do not floor it sideways.
  if (Math.abs(steer) > 0.9 && speed > 140) throttle = Math.min(throttle, 0.6);
  // Feather the throttle at the traction limit (wet road) instead of spinning up.
  if (throttle > 0 && Number.isFinite(drive.traction)) {
    const ratio = clamp(speed / drive.maxSpeed, 0, 1);
    const fullPush = drive.accel * (ai.spraying ? car.engineSpec.nitroAccelBoost : 1) * (1 - ratio * ratio);
    if (fullPush > drive.traction) throttle = Math.min(throttle, drive.traction / fullPush);
  }

  // Nitro: only on a clear straight, and only as deep into the heat as the driver dares.
  const straightAhead = targetSpeed === Infinity || targetSpeed > drive.maxSpeed * car.engineSpec.nitroSpeedBoost;
  const stopHeat = car.engineSpec.redline + (racer.recklessness - 0.5) * 16;
  if (ai.spraying) {
    if (!straightAhead || car.engine.heat >= stopHeat || car.engine.nitro <= 0.05) ai.spraying = false;
  } else if (
    straightAhead &&
    throttle === 1 &&
    speed > 120 &&
    car.engine.heat < stopHeat - 22 &&
    car.engine.nitro > car.engineSpec.nitroTank * 0.5
  ) {
    ai.spraying = true;
  }

  return { throttle, brake, steer, nitro: ai.spraying };
}

/**
 * Drives any car with the rival AI. Used by tests and balancing scripts to
 * estimate what a competent driver gets out of a given car.
 */
/** The rival AI driving Ned (debug key, balance script). Launches perfectly unless told otherwise. */
export function createAutopilot(sim: RaceSim, launch: LaunchPlan = perfectLaunchPlan()): (car: CarSim, dt: number) => Controls {
  const state: AiState = { lane: 0, laneTimer: 3, spraying: false, stuckTime: 0, launch };
  return (car, dt) => aiControls(sim, car, state, dt);
}

// ───────────────────────── Physics ─────────────────────────

function stepCar(sim: RaceSim, car: CarSim, input: Controls, dt: number): void {
  const { track } = sim;
  const { drive } = car;
  const wasExploded = car.engine.exploded;

  const dead = car.engine.exploded;
  const throttle = dead ? 0 : clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);

  car.engine = stepEngine(
    car.engine,
    car.engineSpec,
    { throttle, nitroRequested: input.nitro && throttle > 0.1 && !car.finished },
    dt,
    sim.rng.next(),
  );
  if (car.engine.exploded && !wasExploded) sim.events.push({ type: 'explosion', carId: car.id });
  const spraying = car.engine.nitroActive;

  // Decompose velocity in the car frame.
  let fx = Math.cos(car.heading);
  let fy = Math.sin(car.heading);
  let forward = car.vx * fx + car.vy * fy;
  let lateral = -car.vx * fy + car.vy * fx;

  // Steering: yaw rate is capped by grip, so fast cars need room (or handling parts).
  // A keyboard is all-or-nothing: ease the player's wheel in so taps do not snap the car sideways.
  const steerResponse = car.isPlayer ? 7 : 14;
  car.steer += (clamp(input.steer, -1, 1) - car.steer) * Math.min(1, dt * steerResponse);
  const absForward = Math.abs(forward);
  // Spinning rear tyres have less to give sideways (last step's value: one step of lag is invisible).
  const surfaceGrip = (car.onPavement ? 0.7 : 1) * (1 - car.wheelspin * WHEELSPIN_TUNING.gripLoss);
  const maxYaw = Math.min(drive.steerRate, (drive.grip * surfaceGrip) / Math.max(absForward, 70));
  let yaw = car.steer * maxYaw * clamp(absForward / 45, 0, 1) * (forward >= 0 ? 1 : -1);
  if (car.wheelspin > 0) {
    // A gentle, deterministic fishtail: the car squirms but always goes where it is pointed.
    yaw += car.wheelspin * WHEELSPIN_TUNING.fishtailYaw * Math.sin(2 * Math.PI * WHEELSPIN_TUNING.fishtailHz * sim.time) * clamp(absForward / 60, 0, 1);
  }
  car.heading = wrapAngle(car.heading + yaw * dt);
  fx = Math.cos(car.heading);
  fy = Math.sin(car.heading);
  forward = car.vx * fx + car.vy * fy;
  lateral = -car.vx * fy + car.vy * fx;

  // Longitudinal forces.
  const topSpeed = drive.maxSpeed * (spraying ? car.engineSpec.nitroSpeedBoost : 1) * (car.onPavement ? 0.6 : 1);
  let acceleration = 0;
  let tractionSpin = 0;
  if (throttle > 0 && forward < topSpeed) {
    const ratio = clamp(forward / topSpeed, 0, 1);
    let push = drive.accel * (spraying ? car.engineSpec.nitroAccelBoost : 1) * throttle * (1 - ratio * ratio);
    push *= gearDriveFactor(car.gearbox, car.drivetrain, forward);
    if (car.launch) push *= launchAccelMultiplier(car.launch);
    // Traction limit (wet road): past it the tyres spin and deliver less, not more.
    if (push > drive.traction) {
      tractionSpin = clamp(0.35 + (push - drive.traction) / drive.traction, 0, 1);
      push = drive.traction * WHEELSPIN_TUNING.spinningTractionEfficiency;
    }
    acceleration += push;
  }
  if (forward > topSpeed) acceleration -= 260 + (forward - topSpeed) * 1.5;
  if (brake > 0) {
    if (forward > 8) acceleration -= drive.brake * brake;
    else if (throttle === 0 && !dead) acceleration -= drive.accel * 0.6 * brake * (forward > -110 ? 1 : 0);
  }
  // Rolling resistance + engine braking; a dead engine drags hard.
  const drag = dead ? 1.4 : throttle > 0 ? 0.04 : 0.32;
  acceleration -= forward * drag + Math.sign(forward) * 14;
  forward += acceleration * dt;
  if (throttle === 0 && brake === 0 && Math.abs(forward) < 6) forward = 0;

  // Tyres: grip swings the velocity back in line with the nose. Going forward
  // this *redirects* the momentum (a tyre's side force does no work) and only
  // scrubs a little speed in proportion to the slide, so steering inputs do
  // not cost speed by themselves — braking too late and understeering does.
  const recovery = Math.exp(-drive.slipRecovery * surfaceGrip * dt);
  if (forward > 25) {
    const total = Math.hypot(forward, lateral);
    const slipAngle = Math.atan2(lateral, forward) * recovery;
    const scrub = 1 - Math.min(0.9, Math.abs(Math.sin(slipAngle)) * 0.9) * dt;
    forward = total * Math.cos(slipAngle) * scrub;
    lateral = total * Math.sin(slipAngle) * scrub;
  } else {
    lateral *= recovery;
  }

  car.vx = forward * fx - lateral * fy;
  car.vy = forward * fy + lateral * fx;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.speed = forward;
  car.slip = Math.abs(lateral);
  if (forward * KMH_PER_PX_S > car.topSpeed) car.topSpeed = forward * KMH_PER_PX_S;

  // Engine speed, gears and the race-start effect.
  const launchSpin = car.launch && throttle > 0 ? launchWheelspin(car.launch) : 0;
  car.wheelspin = dead ? 0 : Math.max(launchSpin, tractionSpin);
  car.drivetrain = stepDrivetrain(
    car.drivetrain,
    car.gearbox,
    {
      throttle,
      speed: forward,
      clutchIn: false,
      shift: input.shift ?? 0,
      wheelspin: car.wheelspin,
      maxRise: launchRpmRiseCap(car.launch),
    },
    dt,
  );
  if (car.drivetrain.shifted !== 0 && car.isPlayer) {
    sim.events.push({ type: 'shift', carId: car.id, gear: car.drivetrain.gear, direction: car.drivetrain.shifted });
  }
  if (car.launch && car.launch.phase !== 'done') {
    car.launch = stepLaunch(car.launch, { throttle, rpmNorm: rpmNorm(car.gearbox, car.drivetrain.rpm) }, dt);
    if (car.launch.phase === 'done' && car.launch.endedBy) {
      sim.events.push({ type: 'launch-end', carId: car.id, grade: car.launch.grade, endedBy: car.launch.endedBy });
    }
  }

  // Track bookkeeping.
  const previousS = car.s;
  const location = locate(track, car.x, car.y, car.trackIndex);
  car.trackIndex = location.index;
  car.s = location.s;
  car.lateral = location.lateral;
  car.onPavement = Math.abs(location.lateral) > track.halfWidth;

  const delta = car.s - previousS;
  if (delta < -track.length / 2) {
    car.lap += 1;
    if (car.lap >= 1 && !car.finished) {
      const lapTime = sim.time - car.lapStartTime;
      if (car.bestLap === undefined || lapTime < car.bestLap) car.bestLap = lapTime;
      sim.events.push({ type: 'lap', carId: car.id, lap: car.lap, lapTime });
    }
    if (car.lap >= 0) car.lapStartTime = sim.time;
  } else if (delta > track.length / 2) {
    car.lap -= 1;
  }
  car.progress = car.lap * track.length + car.s;

  resolveWall(sim, car, fx, fy, dt);

  // Wrong way detection (player feedback only).
  const sampleHere = sampleAtDistance(track, car.s);
  const alongSpeed = car.vx * sampleHere.tx + car.vy * sampleHere.ty;
  car.wrongWayTime = alongSpeed < -25 ? car.wrongWayTime + dt : 0;

  // Finish line.
  if (!car.finished && !car.engine.exploded && car.progress >= sim.setup.laps * track.length) {
    car.finished = true;
    car.finishTime = sim.time;
    if (sim.firstFinishTime === undefined) sim.firstFinishTime = sim.time;
    sim.events.push({ type: 'finish', carId: car.id });
  }
}

function resolveWall(sim: RaceSim, car: CarSim, fx: number, fy: number, dt: number): void {
  const shape = BODY_SHAPES[car.racer.look.body];
  const clearance = sim.track.wallOffset - Math.abs(car.lateral);
  const halfLength = shape.length / 2;
  if (clearance > halfLength) return;

  const sample = sampleAt(sim.track, car.trackIndex);
  const side = Math.sign(car.lateral);
  const nx = sample.nx * side;
  const ny = sample.ny * side;
  const localNx = nx * fx + ny * fy;
  const localNy = -nx * fy + ny * fx;
  // Support point of the oval footprint against the wall plane. Its projection
  // gives the clearance needed for this body at its current heading.
  const halfWidth = shape.width / 2;
  const extent = Math.hypot(halfLength * localNx, halfWidth * localNy);
  const penetration = extent - clearance;
  if (penetration < 0) return;
  car.x -= nx * penetration;
  car.y -= ny * penetration;
  car.lateral -= side * penetration;

  const outward = car.vx * nx + car.vy * ny;
  if (outward < 0) return;
  const alongSpeed = Math.abs(car.vx * sample.tx + car.vy * sample.ty);
  if (sim.phase === 'racing' && !car.finished && !car.engine.exploded) {
    if (outward >= FATAL_WALL_SPEED) {
      car.engine = { ...car.engine, exploded: true, explosionCause: 'wall', nitroActive: false };
      sim.events.push({ type: 'explosion', carId: car.id });
    } else if ((outward > 15 || alongSpeed > 25) && sim.time >= car.nextScrapeAt) {
      const x = halfLength * halfLength * localNx / extent;
      const y = halfWidth * halfWidth * localNy / extent;
      const sliding = alongSpeed > outward;
      const strength = clamp((sliding ? alongSpeed : outward) / FATAL_WALL_SPEED, 0, 1);
      markScrape(car.scrapes, {
        x: x - localNx * 1.3, y: y - localNy * 1.3,
        angle: Math.atan2(localNx, -localNy), length: 3 + strength * (sliding ? 8 : 3),
      });
      sim.events.push({
        type: 'wall', carId: car.id, strength, sliding,
        x: car.x + fx * x - fy * y, y: car.y + fy * x + fx * y,
      });
      car.nextScrapeAt = sim.time + 0.14;
    }
  }

  // Reflect the normal velocity and scrub some speed along the wall.
  const scrub = (1 - clamp(outward / 500, 0, 0.45)) * Math.exp(-0.7 * dt);
  car.vx = (car.vx - nx * outward * 1.25) * scrub;
  car.vy = (car.vy - ny * outward * 1.25) * scrub;
  const along = Math.atan2(sample.ty, sample.tx);
  const forwardAlong = Math.cos(car.heading - along) >= 0 ? along : along + Math.PI;
  car.heading = wrapAngle(car.heading + wrapAngle(forwardAlong - car.heading) * Math.min(1, dt * 8));
}

function resolveCollisions(sim: RaceSim): void {
  const cars = sim.cars;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i] as CarSim;
      const b = cars[j] as CarSim;
      if (Math.abs(a.x - b.x) > 60 || Math.abs(a.y - b.y) > 60) continue;
      for (const oa of [-CAR_CIRCLE_OFFSET, CAR_CIRCLE_OFFSET]) {
        for (const ob of [-CAR_CIRCLE_OFFSET, CAR_CIRCLE_OFFSET]) {
          const ax = a.x + Math.cos(a.heading) * oa;
          const ay = a.y + Math.sin(a.heading) * oa;
          const bx = b.x + Math.cos(b.heading) * ob;
          const by = b.y + Math.sin(b.heading) * ob;
          const dx = bx - ax;
          const dy = by - ay;
          const distance = Math.hypot(dx, dy);
          const overlap = CAR_RADIUS * 2 - distance;
          if (overlap <= 0 || distance < 1e-3) continue;
          const nx = dx / distance;
          const ny = dy / distance;
          a.x -= nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.y += ny * overlap * 0.5;
          const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (relative < 0) {
            const impulse = -relative * 0.65;
            a.vx -= nx * impulse;
            a.vy -= ny * impulse;
            b.vx += nx * impulse;
            b.vy += ny * impulse;
            if (-relative > 50) {
              const strength = clamp(-relative / 300, 0, 1);
              sim.events.push({ type: 'bump', carId: a.id, strength });
              sim.events.push({ type: 'bump', carId: b.id, strength });
            }
          }
        }
      }
    }
  }
}

/** Puts a car back in the middle of the road, stopped (player "R" key, stuck AI). */
export function resetCarToTrack(sim: RaceSim, car: CarSim): void {
  const sample = sampleAtDistance(sim.track, car.s);
  car.x = sample.x;
  car.y = sample.y;
  car.heading = Math.atan2(sample.ty, sample.tx);
  car.vx = 0;
  car.vy = 0;
  car.steer = 0;
  car.lateral = 0;
}

export function stepRaceSim(sim: RaceSim, playerInput: Controls, dt: number): void {
  if (sim.phase === 'countdown') {
    const before = Math.ceil(sim.countdown - 0.6);
    sim.countdown -= dt;
    const after = Math.ceil(sim.countdown - 0.6);
    if (after !== before && after >= 1 && after <= 3) sim.events.push({ type: 'countdown', value: after });
    // Clutch in on the grid: everyone revs for the start. Rivals only touch
    // the throttle here (no driving logic, so the race RNG is not drawn).
    for (const car of sim.cars) {
      const controls = car.ai
        ? { ...NEUTRAL, throttle: gridThrottle(car.ai.launch, sim.countdown) }
        : { ...playerInput, brake: 0, steer: 0, nitro: false };
      car.controls = controls;
      car.drivetrain = stepDrivetrain(
        car.drivetrain,
        car.gearbox,
        { throttle: clamp(controls.throttle, 0, 1), speed: 0, clutchIn: true, shift: 0, wheelspin: 0 },
        dt,
      );
    }
    if (sim.countdown <= 0) {
      sim.phase = 'racing';
      sim.events.push({ type: 'go' });
      for (const car of sim.cars) {
        car.launch = startLaunch(rpmNorm(car.gearbox, car.drivetrain.rpm), clamp(car.controls.throttle, 0, 1), sim.weather);
        sim.events.push({ type: 'launch', carId: car.id, grade: car.launch.grade });
      }
    }
    return;
  }

  sim.time += dt;

  for (const car of sim.cars) {
    let controls: Controls;
    if (car.finished) {
      // Cool-down lap: keep following the road, off the throttle.
      controls = car.ai
        ? { ...aiControls(sim, car, car.ai, dt), throttle: 0.25, nitro: false }
        : { throttle: 0, brake: 0.35, steer: playerInput.steer, nitro: false };
    } else if (car.ai) {
      controls = aiControls(sim, car, car.ai, dt);
      // A rival that is wedged somewhere gets put back on the road.
      car.ai.stuckTime = Math.abs(car.speed) < 18 && !car.engine.exploded ? car.ai.stuckTime + dt : 0;
      if (car.ai.stuckTime > 2.2) {
        resetCarToTrack(sim, car);
        car.ai.stuckTime = 0;
      }
    } else {
      controls = playerInput;
    }
    car.controls = controls;
    stepCar(sim, car, controls, dt);
  }
  resolveCollisions(sim);

  if (sim.phase === 'racing') {
    const player = sim.player;
    const timedOut = sim.firstFinishTime !== undefined && sim.time - sim.firstFinishTime > STRAGGLER_TIMEOUT;
    if (player.finished || player.engine.exploded || timedOut) sim.phase = 'finished';
  } else {
    sim.finishedFor += dt;
  }
}

/** Cars ordered from first to last: finishers by time, then the rest by distance covered. */
export function rankCars(sim: RaceSim): CarSim[] {
  return [...sim.cars].sort((a, b) => {
    if (a.finished && b.finished) return (a.finishTime ?? 0) - (b.finishTime ?? 0);
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.engine.exploded !== b.engine.exploded) return a.engine.exploded ? 1 : -1;
    return b.progress - a.progress;
  });
}

export function playerPosition(sim: RaceSim): number {
  return rankCars(sim).indexOf(sim.player) + 1;
}

export function raceOutcome(sim: RaceSim, abandoned: boolean): RaceOutcome {
  const ranked = rankCars(sim);
  const player = sim.player;
  const standings: RaceStanding[] = ranked.map((car, index) => ({
    name: car.racer.name,
    isPlayer: car.isPlayer,
    position: index + 1,
    exploded: car.engine.exploded,
    ...(car.engine.explosionCause && { explosionCause: car.engine.explosionCause }),
    ...(car.finishTime !== undefined ? { time: car.finishTime } : {}),
  }));
  return {
    position: abandoned ? sim.cars.length : ranked.indexOf(player) + 1,
    racers: sim.cars.length,
    exploded: player.engine.exploded,
    ...(player.engine.explosionCause && { explosionCause: player.engine.explosionCause }),
    abandoned,
    time: player.finishTime ?? sim.time,
    topSpeedKmh: Math.round(player.topSpeed),
    wear: player.engine.wear,
    standings,
    weather: sim.weather.id,
    ...(player.bestLap !== undefined ? { bestLap: player.bestLap } : {}),
  };
}
