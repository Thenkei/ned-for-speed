import './race.css';
import type { ShiftRequest } from '../domain/drivetrain';
import { ghostPose, GhostRecorder, SECTORS_PER_LAP, splitDelta, type GhostRun } from '../domain/ghost';
import type { LaunchEnd, LaunchGrade } from '../domain/launch';
import type { TransmissionMode } from '../domain/tuning';
import type { RaceOutcome, RaceSetup, Racer } from '../domain/types';
import { audio } from '../infra/audio';
import {
  bangStrength,
  engineProfileFor,
  IDLE_TURBO,
  ON_THROTTLE,
  stepPopsAndBangs,
  stepTurbo,
  tunedEngineProfile,
  type EngineSoundProfile,
  type TurboState,
} from '../infra/engineProfiles';
import { engineSoundParams, RIVAL_SOUND, rivalSoundParams } from '../infra/engineSound';
import { CrashReplay, REPLAY_SPEED } from './crashReplay';
import { impactRumble, RUMBLES } from './gamepad';
import { createRaceInput, type InputDevice } from './input';
import { RaceRenderer, formatTime } from './render';
import { maxCurvature } from './track';
import {
  createAutopilot,
  createRaceSim,
  playerPosition,
  raceOutcome,
  resetCarToTrack,
  stepRaceSim,
  type CarSim,
  type RaceSim,
} from './sim';

/** Time trial: record Ned's run and race the stored ghost. */
export interface TimeTrialOptions {
  /** The record to race against, if there is one. */
  readonly ghost: GhostRun | undefined;
  /** Car model the run is set with (records are kept per model). */
  readonly modelId: string;
  /** Called once, when the race ends, with the run (undefined if not completed). */
  readonly onRun: (run: GhostRun | undefined) => void;
}

export interface RaceOptions {
  readonly muted: boolean;
  /** Ned's gearbox; automatic when absent. */
  readonly transmission?: TransmissionMode;
  readonly timeTrial?: TimeTrialOptions;
}

const LAUNCH_BANNERS: Readonly<Record<LaunchGrade, { text: string; sub?: string; color: string } | undefined>> = {
  perfect: { text: 'DÉPART PARFAIT !', sub: 'Turbo au départ', color: '#4dff6a' },
  good: undefined,
  under: { text: 'DÉPART MOU…', sub: 'Pas assez de tours : le moteur cale', color: '#9ab4ff' },
  // `sub` depends on the device: filled in from HINTS when shown.
  over: { text: 'PATINAGE !', color: '#ff9a2f' },
};

const LAUNCH_END_BANNERS: Partial<Record<LaunchEnd, { text: string; color: string }>> = {
  cancelled: { text: 'Grip retrouvé', color: '#4dff6a' },
};

/** Driving tips worded for the device the player is actually using. */
const HINTS: Readonly<Record<InputDevice, {
  readonly launch: string;
  /** Under the "PATINAGE !" banner. */
  readonly spinFix: string;
  readonly wheelspin: string;
  readonly stuck: string;
  readonly basics: string;
  readonly wall: string;
  readonly brake: string;
  readonly nitro: string;
}>> = {
  keyboard: {
    launch: 'Départ : appuie sur ↑ quand le « 1 » s’affiche, aiguille dans le vert',
    spinFix: 'Relâche ↑ puis réaccélère',
    wheelspin: 'Ça patine ! Relâche ↑ et réappuie pour reprendre du grip',
    stuck: 'Coincé ? Appuie sur R pour revenir sur la route',
    basics: '↑ accélérer · ← → tourner · ↓ freiner',
    wall: 'Tu frottes le mur : tourne (← →) pour revenir au milieu',
    brake: 'Freine (↓) avant les virages : trop vite, ça ne tourne plus',
    nitro: 'Ligne droite : maintiens ESPACE pour la nitro',
  },
  touch: {
    launch: 'Départ : maintiens NITRO quand le « 1 » s’affiche, aiguille dans le vert',
    spinFix: 'Touche FREIN un instant',
    wheelspin: 'Ça patine ! Touche FREIN un instant pour reprendre du grip',
    stuck: 'Coincé ? Touche ↺ pour revenir sur la route',
    basics: '◀ ▶ pour tourner · la voiture accélère toute seule',
    wall: 'Tu frottes le mur : tourne (◀ ▶) pour revenir au milieu',
    brake: 'Freine avant les virages : trop vite, ça ne tourne plus',
    nitro: 'Ligne droite : maintiens NITRO',
  },
  gamepad: {
    launch: 'Départ : dose RT pour garder l’aiguille dans le vert au « 1 »',
    spinFix: 'Relâche RT puis réaccélère',
    wheelspin: 'Ça patine ! Relâche RT et réappuie pour reprendre du grip',
    stuck: 'Coincé ? Appuie sur Ⓨ pour revenir sur la route',
    basics: 'RT accélérer · stick gauche tourner · LT freiner',
    wall: 'Tu frottes le mur : tourne (stick gauche) pour revenir au milieu',
    brake: 'Freine (LT) avant les virages : trop vite, ça ne tourne plus',
    nitro: 'Ligne droite : maintiens Ⓐ pour la nitro',
  },
};

const STEP = 1 / 120;

/** "−0.32 s" / "+1.05 s": time gained (green) or lost against the record. */
function formatDelta(delta: number): string {
  const sign = delta < 0 ? '−' : '+';
  return `${sign}${Math.abs(delta).toFixed(2)} s`;
}
const MAX_STEPS_PER_FRAME = 6;
/** Time the final scene stays on screen before handing back to the menus. */
const OUTRO_SECONDS = 3;
const FINISH_SHOW_SECONDS = 5.5;

/** Handle on the running race for automated tests and the dev harness (`window.__nedRace`). */
interface RaceDebugHandle {
  readonly sim: RaceSim;
  /** When true the rival AI drives Ned's car instead of the keyboard. */
  autopilot: boolean;
  /** Driving tip currently on screen, if any. */
  hint: string | undefined;
  finishNow(): void;
}

declare global {
  interface Window {
    __nedRace?: RaceDebugHandle | undefined;
  }
}

/**
 * Mounts a full-screen race inside `host`, runs it to completion and resolves
 * with the outcome. The host element is emptied when the race is over.
 */
export function runRace(host: HTMLElement, setup: RaceSetup, options: RaceOptions): Promise<RaceOutcome> {
  return new Promise<RaceOutcome>((resolve, reject) => {
    let disposed = false;
    let frame = 0;
    const abort = new AbortController();

    host.replaceChildren();
    host.classList.add('race-host');
    const canvas = document.createElement('canvas');
    canvas.className = 'race-canvas';
    const overlay = document.createElement('div');
    overlay.className = 'race-pause';
    overlay.hidden = true;
    const transmission: TransmissionMode = options.transmission ?? 'auto';
    const gearKeys = transmission === 'manual' ? '<br><b>E / Q</b> monter / descendre un rapport (boîte manuelle)' : '';
    overlay.innerHTML = `
      <div class="race-pause__panel" role="dialog" aria-modal="true" aria-label="Pause">
        <h2>PAUSE</h2>
        <p class="race-pause__keys">
          <b>↑ / W</b> accélérer · <b>↓ / S</b> freiner · <b>← → / A D</b> tourner<br>
          <b>Espace / Maj</b> nitro · <b>R</b> se remettre sur la route · <b>Échap</b> pause${gearKeys}
        </p>
        <p class="race-pause__keys">
          🎮 <b>RT / LT</b> accélérer / freiner · <b>stick gauche</b> tourner · <b>Ⓐ</b> nitro<br>
          <b>Ⓨ</b> se remettre sur la route · <b>Start</b> pause${transmission === 'manual' ? ' · <b>RB / LB</b> rapports' : ''}
        </p>
        <button type="button" class="btn btn--primary" data-action="resume">Reprendre</button>
        <button type="button" class="btn btn--danger" data-action="abandon">Abandonner la course</button>
      </div>`;
    host.append(canvas, overlay);

    let sim: RaceSim;
    let renderer: RaceRenderer;
    const input = createRaceInput(host, { manualGearbox: transmission === 'manual' });
    try {
      sim = createRaceSim(setup, { playerTransmission: transmission });
      renderer = new RaceRenderer(canvas, sim);
    } catch (error) {
      input.dispose();
      host.replaceChildren();
      host.classList.remove('race-host');
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const resize = (): void => {
      const rect = host.getBoundingClientRect();
      renderer.resize(rect.width || window.innerWidth, rect.height || window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
    };
    resize();
    window.addEventListener('resize', resize, { signal: abort.signal });

    audio.setMuted(options.muted);
    // Every car sounds like what it is, with the turbo and exhaust it has fitted;
    // voices follow the sim's car order.
    const engineOf = (racer: Racer) => tunedEngineProfile(engineProfileFor(racer.look.body), racer);
    const playerEngine = engineOf(setup.player);
    const rivalCars = sim.cars.filter((car) => !car.isPlayer);
    const rivalEngines = rivalCars.map((car) => engineOf(car.racer));
    audio.startEngine({ player: playerEngine, rivals: rivalEngines });
    // Pop-and-bang maps (a big home-made turbo): one overrun tracker per car that has one.
    const bangers = sim.cars
      .map((car) => ({ car, engine: car.isPlayer ? playerEngine : engineOf(car.racer), overrun: ON_THROTTLE }))
      .filter((banger) => banger.engine.popsAndBangs > 0);

    // Time trial: record the run, and show the ghost of the record.
    const trial = options.timeTrial;
    const totalSectors = sim.setup.laps * SECTORS_PER_LAP;
    const recorder = trial ? new GhostRecorder(sim.track.length, totalSectors) : undefined;
    const ghost = trial?.ghost && trial.ghost.splits.length === totalSectors ? trial.ghost : undefined;
    renderer.setGhost(ghost ? { look: setup.player.look, recordTime: ghost.time } : undefined);
    /** Checkpoint crossed during the last frame's steps (shown after the events). */
    let pendingSplit: { readonly index: number; readonly time: number } | undefined;
    let paused = false;
    const setPaused = (value: boolean): void => {
      if (sim.phase === 'finished') return;
      paused = value;
      overlay.hidden = !value;
      if (value) audio.quietEngine();
    };

    const finish = (abandoned: boolean): void => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      abort.abort();
      input.dispose();
      audio.stopEngine();
      window.__nedRace = undefined;
      const outcome = raceOutcome(sim, abandoned);
      if (trial && recorder) {
        const player = sim.player;
        const completed = !abandoned && player.finished;
        trial.onRun(
          completed
            ? recorder.finish({
                trackId: sim.setup.trackId,
                weather: sim.weather.id,
                modelId: trial.modelId,
                laps: sim.setup.laps,
                time: player.finishTime ?? sim.time,
                bestLap: player.bestLap,
                recordedAt: new Date().toISOString(),
              })
            : undefined,
        );
      }
      host.replaceChildren();
      host.classList.remove('race-host');
      resolve(outcome);
    };

    const history = new CrashReplay();
    let playReplay: ((elapsed: number) => void) | undefined;

    const startCrashReplay = (): void => {
      input.dispose();
      audio.stopEngine();
      const bar = document.createElement('div');
      bar.className = 'race-replay';
      const label = document.createElement('span');
      label.textContent = 'Ralenti · 0,5×';
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.textContent = 'Passer le ralenti';
      skip.addEventListener('click', () => finish(false), { signal: abort.signal });
      bar.append(label, skip);
      host.append(bar);
      skip.focus({ preventScroll: true });
      window.addEventListener('keydown', event => {
        if (!['Escape', 'Enter', 'Space'].includes(event.code)) return;
        event.preventDefault();
        if (!event.repeat) finish(false);
      }, { signal: abort.signal });

      // Give the live explosion a beat, then rewind the visuals. The authoritative
      // simulation stays on the fatal tick for both a skipped and a completed replay.
      let leadIn = 0.45;
      let cursor = history.start;
      let previous = cursor - 1e-8;
      playReplay = elapsed => {
        if (leadIn > 0) {
          leadIn -= elapsed;
          if (leadIn > 0) {
            renderer.render(elapsed);
            return;
          }
          renderer.beginReplay();
        }
        const cars = history.carsAt(cursor);
        for (const effect of history.effectsBetween(previous, cursor)) {
          const car = cars[effect.carId]!;
          if (effect.type === 'explosion') renderer.explode(car);
          else renderer.sparks(car, effect.strength, effect);
        }
        renderer.renderReplay(cars, elapsed * REPLAY_SPEED);
        if (cursor >= history.end + 0.4) {
          finish(false);
          return;
        }
        previous = cursor;
        cursor += elapsed * REPLAY_SPEED;
      };
    };

    overlay.addEventListener(
      'click',
      (event) => {
        const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
        if (action === 'resume') setPaused(false);
        else if (action === 'abandon') finish(true);
      },
      { signal: abort.signal },
    );
    // A race that keeps running in a hidden tab would be lost without the player seeing it.
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) setPaused(true);
      },
      { signal: abort.signal },
    );

    const announceEnd = (): void => {
      const player = sim.player;
      if (player.engine.exploded) return; // The explosion banner is already up.
      if (player.finished) input.showFinishControls();
      if (trial && player.finished) {
        const time = player.finishTime ?? sim.time;
        const delta = ghost ? time - ghost.time : undefined;
        const record = delta === undefined || delta < 0;
        renderer.showBanner({
          text: record ? 'NOUVEAU RECORD !' : 'ARRIVÉE',
          sub: delta === undefined ? formatTime(time) : `${formatTime(time)} (${formatDelta(delta)})`,
          color: record ? '#ffd23f' : '#ffffff',
          ttl: OUTRO_SECONDS,
          big: true,
        });
        audio.race('finish');
        return;
      }
      const position = playerPosition(sim);
      if (position === 1) {
        renderer.showBanner({ text: 'VICTOIRE !', sub: formatTime(player.finishTime ?? sim.time), color: '#ffd23f', ttl: OUTRO_SECONDS, big: true });
        audio.race('finish');
      } else {
        renderer.showBanner({
          text: player.finished ? `${position}e` : 'TROP TARD…',
          sub: player.finished ? formatTime(player.finishTime ?? sim.time) : 'Les autres sont déjà au kebab.',
          color: '#ffffff',
          ttl: OUTRO_SECONDS,
          big: true,
        });
      }
    };

    const handleEvents = (): void => {
      for (const event of sim.events) {
        const car = sim.cars[event.type === 'countdown' || event.type === 'go' ? 0 : event.carId];
        switch (event.type) {
          case 'countdown':
            audio.race('beep');
            break;
          case 'go':
            audio.race('go');
            renderer.showBanner({ text: 'GO !', color: '#4dff6a', ttl: 0.9, big: true });
            break;
          case 'explosion':
            if (!car) break;
            renderer.explode(car);
            audio.race('explosion');
            if (car.isPlayer) input.rumble(RUMBLES.explosion);
            if (car.isPlayer) {
              if (car.engine.explosionCause === 'burnout') {
                input.dispose();
                renderer.showBanner({ text: 'MOTEUR SERRÉ !', sub: 'Le classement est acquis. Le moteur, lui, a lâché.', color: '#ff753b', ttl: 2, big: true });
                break;
              }
              const wall = car.engine.explosionCause === 'wall';
              renderer.showBanner({
                text: wall ? 'VOITURE PULVÉRISÉE !' : 'MOTEUR EXPLOSÉ !',
                sub: wall ? 'Le choc contre le mur a été fatal.' : 'Trop de nitro tue la nitro.',
                color: '#ff3b3b', ttl: OUTRO_SECONDS + 1, big: true,
              });
            } else {
              renderer.showBanner({ text: `${car.racer.name} a explosé !`, color: '#ff9a2f', ttl: 2, big: false });
            }
            break;
          case 'bump':
          case 'wall':
            if (!car) break;
            renderer.sparks(car, event.strength, event);
            if (car.isPlayer) {
              audio.race(event.sliding ? 'scrape' : 'bump', event.strength);
              const rumble = impactRumble(event.strength, event.sliding);
              if (rumble) input.rumble(rumble);
              if (event.type === 'wall') {
                coach.wallHits++;
                coach.lastWallAt = sim.time;
              }
            }
            break;
          case 'lap':
            if (!car?.isPlayer || car.finished) break;
            audio.race('lap');
            if (event.lap === sim.setup.laps - 1) {
              renderer.showBanner({ text: 'DERNIER TOUR !', sub: formatTime(event.lapTime), color: '#ff3fa4', ttl: 1.8, big: false });
            } else if (event.lap < sim.setup.laps) {
              renderer.showBanner({ text: `TOUR ${event.lap + 1}/${sim.setup.laps}`, sub: formatTime(event.lapTime), color: '#2ff3ff', ttl: 1.6, big: false });
            }
            break;
          case 'launch': {
            if (!car?.isPlayer) break;
            const banner = LAUNCH_BANNERS[event.grade];
            const sub = event.grade === 'over' ? HINTS[input.device()].spinFix : banner?.sub;
            if (banner) renderer.showBanner({ ...banner, ...(sub !== undefined && { sub }), ttl: 1.6, big: false });
            if (event.grade === 'perfect') {
              audio.race('perfect-start');
              renderer.boostFlash(car);
              input.rumble(RUMBLES.perfectStart);
            } else if (event.grade === 'over') {
              audio.race('wheelspin');
              input.rumble(RUMBLES.wheelspin);
            } else if (event.grade === 'under') {
              audio.race('bog');
            }
            break;
          }
          case 'launch-end': {
            if (!car?.isPlayer) break;
            const banner = LAUNCH_END_BANNERS[event.endedBy];
            if (banner && event.grade === 'over') {
              renderer.showBanner({ ...banner, ttl: 0.9, big: false });
              audio.race('grip');
            }
            break;
          }
          case 'shift':
            // Flat-shifting a pop-and-bang car on full throttle: the cut fires a bang.
            if (car?.isPlayer && event.direction > 0 && car.controls.throttle > 0.5 && Math.random() < playerEngine.popsAndBangs) {
              backfire(car, playerEngine, 0.8);
            }
            if (car?.isPlayer) audio.race('shift', event.direction);
            break;
          case 'finish':
            break;
        }
      }
      sim.events.length = 0;
    };

    const debug: RaceDebugHandle = { sim, autopilot: false, hint: undefined, finishNow: () => finish(false) };
    const autopilot = createAutopilot(sim);
    window.__nedRace = debug;

    // Driving tips: "stuck" help is always on, the rest only for Ned's first races.
    const coach = { usedNitro: false, wallHits: 0, lastWallAt: -Infinity, stuckFor: 0, grindingFor: 0 };
    const pickHint = (elapsed: number): string | undefined => {
      const player = sim.player;
      if (player.engine.exploded || player.finished || sim.phase === 'finished') return undefined;
      const hints = HINTS[input.device()];
      if (sim.phase === 'racing' && player.launch?.phase === 'wheelspin' && player.controls.throttle > 0) return hints.wheelspin;
      if (sim.phase === 'racing') {
        // Stuck = trying to move and not moving (not simply parked off the throttle).
        const pushing = player.controls.throttle > 0 || player.controls.brake > 0;
        coach.stuckFor = pushing && Math.abs(player.speed) < 25 ? coach.stuckFor + elapsed : 0;
        if (coach.stuckFor > 2 && sim.time > 3) return hints.stuck;
        const onWall = Math.abs(player.lateral) > sim.track.wallOffset - 12;
        coach.grindingFor = onWall ? coach.grindingFor + elapsed : 0;
      }
      if (!setup.coach) return undefined;
      if (sim.phase === 'countdown') return hints.launch;
      if (sim.time < 3) return hints.basics;
      if (coach.grindingFor > 0.8) return hints.wall;
      if (player.engine.nitroActive) coach.usedNitro = true;
      const spec = player.engineSpec;
      if (player.engine.heat > spec.redline) return undefined; // The overheat banner says it louder.
      if (player.engine.nitroActive && player.engine.heat > spec.redline - 14) {
        return 'Relâche la nitro avant le rouge et laisse refroidir';
      }
      if (sim.time - coach.lastWallAt < 4 && coach.wallHits >= 2) return hints.brake;
      if (!coach.usedNitro && spec.nitroTank > 0 && maxCurvature(sim.track, player.s, player.s + 320) < 0.0016) {
        return hints.nitro;
      }
      return undefined;
    };

    let last = performance.now();
    let accumulator = 0;
    let endAnnounced = false;
    let pendingShift: ShiftRequest = 0;
    let previousSpeed = sim.player.speed;
    let turbo: TurboState = IDLE_TURBO;

    /** One exhaust bang: heard (quieter from afar for rivals) and seen. */
    const backfire = (car: CarSim, engine: EngineSoundProfile, revs: number): void => {
      const strength = bangStrength(revs, engine, Math.random());
      const distance = Math.hypot(car.x - sim.player.x, car.y - sim.player.y);
      const heard = car.isPlayer ? 1 : 1 / (1 + (distance / RIVAL_SOUND.halfDistance) ** 2);
      if (heard > 0.04) audio.race('bang', strength * heard);
      renderer.backfire(car, strength);
    };
    let smoothedAcceleration = 0;

    const tick = (now: number): void => {
      if (disposed) return;
      frame = requestAnimationFrame(tick);
      try {
        const elapsed = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (document.hidden && sim.phase === 'finished') return;
        if (playReplay) {
          playReplay(elapsed);
          return;
        }
        input.poll();
        if (input.consumePause()) setPaused(!paused);
        const wantsReset = input.consumeReset();
        if (paused) return;

        if (wantsReset && sim.phase === 'racing' && !sim.player.engine.exploded) {
          resetCarToTrack(sim, sim.player);
          history.clear();
        }

        accumulator += elapsed;
        let controls = input.read();
        // Touch throttle is automatic, which would over-rev every start: on the
        // grid, touch players rev with the NITRO button instead (nitro is inert there).
        if (input.device() === 'touch' && sim.phase === 'countdown') controls = { ...controls, throttle: controls.nitro ? 1 : 0 };
        // A shift is an edge: kept until a step actually runs, then applied once.
        const shift = input.consumeShift();
        if (shift !== 0) pendingShift = shift;
        let steps = 0;
        while (accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
          if (debug.autopilot) controls = autopilot(sim.player, STEP);
          const firstEvent = sim.events.length;
          stepRaceSim(sim, { ...controls, shift: pendingShift }, STEP);
          const wallCrash = sim.player.engine.explosionCause === 'wall';
          if (sim.phase === 'racing' || wallCrash) history.record(sim, firstEvent);
          pendingShift = 0;
          // Recorded on through the outro (sim time keeps running), so the ghost
          // carries on past the line instead of parking a frame short of it. On
          // the step Ned crosses the line, `sim.time` is exactly his finish time.
          if (recorder && sim.phase !== 'countdown') {
            const p = sim.player;
            const crossed = recorder.sample(sim.time, p.x, p.y, p.heading, p.progress);
            if (crossed !== undefined) pendingSplit = { index: crossed, time: sim.time };
          }
          accumulator -= STEP;
          steps++;
          if (wallCrash) break;
        }
        if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
        handleEvents();
        if (sim.player.engine.explosionCause === 'wall') {
          renderer.render(elapsed);
          startCrashReplay();
          return;
        }
        // Split against the ghost (after the lap banner, which it replaces). The
        // finish line is announced by the end banner instead.
        if (pendingSplit && ghost && sim.phase === 'racing' && pendingSplit.index < totalSectors - 1) {
          const delta = splitDelta(ghost, pendingSplit.index, pendingSplit.time);
          if (delta !== undefined) {
            renderer.showBanner({
              text: formatDelta(delta),
              sub: `Intermédiaire ${pendingSplit.index + 1}/${totalSectors}`,
              color: delta <= 0 ? '#4dff6a' : '#ff5a5a',
              ttl: 1.6,
              big: false,
            });
          }
        }
        pendingSplit = undefined;
        if (ghost) renderer.setGhostPose(ghostPose(ghost, sim.time));

        if (sim.phase === 'finished' && !endAnnounced) {
          endAnnounced = true;
          announceEnd();
        }

        // Engine note from the real drivetrain state.
        const player = sim.player;
        if (elapsed > 0) {
          const instant = (player.speed - previousSpeed) / elapsed;
          smoothedAcceleration += (instant - smoothedAcceleration) * Math.min(1, elapsed * 8);
        }
        previousSpeed = player.speed;
        const { tuning } = player.gearbox;
        const revs = (player.drivetrain.rpm - tuning.idleRpm) / (tuning.redlineRpm - tuning.idleRpm);
        const turboStep = stepTurbo(
          turbo,
          { throttle: player.engine.exploded ? 0 : player.controls.throttle, revs },
          playerEngine,
          elapsed,
        );
        turbo = turboStep.state;
        if (turboStep.blowOff) audio.race('blowoff', playerEngine.turbo?.flutter ?? 0);
        for (const banger of bangers) {
          const { car, engine } = banger;
          const { tuning: carTuning } = car.gearbox;
          const carRevs = (car.drivetrain.rpm - carTuning.idleRpm) / (carTuning.redlineRpm - carTuning.idleRpm);
          const step = stepPopsAndBangs(
            banger.overrun,
            { throttle: car.engine.exploded || car.finished ? 1 : car.controls.throttle, revs: carRevs },
            engine,
            elapsed,
          );
          banger.overrun = step.state;
          // At most one bang per frame: a Poisson process sampled at the frame rate.
          if (step.liftBang || Math.random() < step.bangRate * elapsed) backfire(car, engine, carRevs);
        }
        audio.updateEngine(
          engineSoundParams(
            {
              rpm: player.drivetrain.rpm,
              idleRpm: tuning.idleRpm,
              redlineRpm: tuning.redlineRpm,
              throttle: player.controls.throttle,
              acceleration: smoothedAcceleration,
              limiter: player.drivetrain.limiter,
              wheelspin: player.wheelspin,
              lateralSlip: sim.phase === 'racing' ? player.slip : 0,
              nitro: player.engine.nitroActive,
              off: player.engine.exploded,
              speedRatio: Math.abs(player.speed) / player.drive.maxSpeed,
              wet: sim.weather.id === 'wet',
              turboSpool: turbo.spool,
            },
            playerEngine,
          ),
        );
        // Rivals in creation order, matching the voices built by `startEngine`.
        audio.updateRivals(
          rivalCars.map((car, index) =>
            rivalSoundParams(
              {
                rpm: car.drivetrain.rpm,
                throttle: car.controls.throttle,
                dx: car.x - player.x,
                dy: car.y - player.y,
                dvx: car.vx - player.vx,
                dvy: car.vy - player.vy,
                heading: player.heading,
                off: car.engine.exploded,
              },
              rivalEngines[index],
            ),
          ),
        );

        debug.hint = pickHint(elapsed);
        renderer.setHint(debug.hint);
        renderer.render(elapsed);

        if (sim.phase === 'finished' && sim.finishedFor > (player.finished ? FINISH_SHOW_SECONDS : OUTRO_SECONDS)) finish(false);
      } catch (error) {
        // A rendering bug must not trap the player in a frozen full-screen canvas.
        disposed = true;
        cancelAnimationFrame(frame);
        abort.abort();
        input.dispose();
        audio.stopEngine();
        window.__nedRace = undefined;
        host.replaceChildren();
        host.classList.remove('race-host');
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    frame = requestAnimationFrame(tick);
  });
}
