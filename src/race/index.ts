import './race.css';
import type { ShiftRequest } from '../domain/drivetrain';
import type { LaunchEnd, LaunchGrade } from '../domain/launch';
import type { TransmissionMode } from '../domain/tuning';
import type { RaceOutcome, RaceSetup } from '../domain/types';
import { audio } from '../infra/audio';
import { engineProfileFor, IDLE_TURBO, stepTurbo, type TurboState } from '../infra/engineProfiles';
import { engineSoundParams, rivalSoundParams } from '../infra/engineSound';
import { createRaceInput } from './input';
import { RaceRenderer, formatTime } from './render';
import { maxCurvature } from './track';
import {
  createAutopilot,
  createRaceSim,
  playerPosition,
  raceOutcome,
  resetCarToTrack,
  stepRaceSim,
  type RaceSim,
} from './sim';

export interface RaceOptions {
  readonly muted: boolean;
  /** Ned's gearbox; automatic when absent. */
  readonly transmission?: TransmissionMode;
}

const LAUNCH_BANNERS: Readonly<Record<LaunchGrade, { text: string; sub?: string; color: string } | undefined>> = {
  perfect: { text: 'DÉPART PARFAIT !', sub: 'Turbo au départ', color: '#4dff6a' },
  good: undefined,
  under: { text: 'DÉPART MOU…', sub: 'Pas assez de tours : le moteur cale', color: '#9ab4ff' },
  over: { text: 'PATINAGE !', sub: 'Relâche ↑ puis réaccélère', color: '#ff9a2f' },
};

const LAUNCH_END_BANNERS: Partial<Record<LaunchEnd, { text: string; color: string }>> = {
  cancelled: { text: 'Grip retrouvé', color: '#4dff6a' },
};

const STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 6;
/** Time the final scene stays on screen before handing back to the menus. */
const OUTRO_SECONDS = 3;

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
    // Every car sounds like what it is; voices follow the sim's car order.
    const playerEngine = engineProfileFor(setup.player.look.body);
    const rivalCars = sim.cars.filter((car) => !car.isPlayer);
    const rivalEngines = rivalCars.map((car) => engineProfileFor(car.racer.look.body));
    audio.startEngine({ player: playerEngine, rivals: rivalEngines });

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
      host.replaceChildren();
      host.classList.remove('race-host');
      resolve(outcome);
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
            if (car.isPlayer) {
              renderer.showBanner({ text: 'MOTEUR EXPLOSÉ !', sub: 'Trop de nitro tue la nitro.', color: '#ff3b3b', ttl: OUTRO_SECONDS + 1, big: true });
            } else {
              renderer.showBanner({ text: `${car.racer.name} a explosé !`, color: '#ff9a2f', ttl: 2, big: false });
            }
            break;
          case 'bump':
          case 'wall':
            if (!car) break;
            renderer.sparks(car, event.strength);
            if (car.isPlayer) {
              audio.race('bump', event.strength);
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
            if (banner) renderer.showBanner({ ...banner, ttl: 1.6, big: false });
            if (event.grade === 'perfect') {
              audio.race('perfect-start');
              renderer.boostFlash(car);
            } else if (event.grade === 'over') {
              audio.race('wheelspin');
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
      const touch = input.touch;
      if (sim.phase === 'racing' && player.launch?.phase === 'wheelspin' && player.controls.throttle > 0) {
        return touch ? 'Ça patine ! Touche FREIN un instant pour reprendre du grip' : 'Ça patine ! Relâche ↑ et réappuie pour reprendre du grip';
      }
      if (sim.phase === 'racing') {
        // Stuck = trying to move and not moving (not simply parked off the throttle).
        const pushing = player.controls.throttle > 0 || player.controls.brake > 0;
        coach.stuckFor = pushing && Math.abs(player.speed) < 25 ? coach.stuckFor + elapsed : 0;
        if (coach.stuckFor > 2 && sim.time > 3) {
          return touch ? 'Coincé ? Touche ↺ pour revenir sur la route' : 'Coincé ? Appuie sur R pour revenir sur la route';
        }
        const onWall = Math.abs(player.lateral) > sim.track.wallOffset - 12;
        coach.grindingFor = onWall ? coach.grindingFor + elapsed : 0;
      }
      if (!setup.coach) return undefined;
      if (sim.phase === 'countdown') {
        return touch
          ? 'Départ : maintiens NITRO quand le « 1 » s’affiche, aiguille dans le vert'
          : 'Départ : appuie sur ↑ quand le « 1 » s’affiche, aiguille dans le vert';
      }
      if (sim.time < 3) {
        return touch ? '◀ ▶ pour tourner · la voiture accélère toute seule' : '↑ accélérer · ← → tourner · ↓ freiner';
      }
      if (coach.grindingFor > 0.8) {
        return touch ? 'Tu frottes le mur : tourne (◀ ▶) pour revenir au milieu' : 'Tu frottes le mur : tourne (← →) pour revenir au milieu';
      }
      if (player.engine.nitroActive) coach.usedNitro = true;
      const spec = player.engineSpec;
      if (player.engine.heat > spec.redline) return undefined; // The overheat banner says it louder.
      if (player.engine.nitroActive && player.engine.heat > spec.redline - 14) {
        return 'Relâche la nitro avant le rouge et laisse refroidir';
      }
      if (sim.time - coach.lastWallAt < 4 && coach.wallHits >= 2) {
        return touch ? 'Freine avant les virages : trop vite, ça ne tourne plus' : 'Freine (↓) avant les virages : trop vite, ça ne tourne plus';
      }
      if (!coach.usedNitro && spec.nitroTank > 0 && maxCurvature(sim.track, player.s, player.s + 320) < 0.0016) {
        return touch ? 'Ligne droite : maintiens NITRO' : 'Ligne droite : maintiens ESPACE pour la nitro';
      }
      return undefined;
    };

    let last = performance.now();
    let accumulator = 0;
    let endAnnounced = false;
    let pendingShift: ShiftRequest = 0;
    let previousSpeed = sim.player.speed;
    let turbo: TurboState = IDLE_TURBO;
    let smoothedAcceleration = 0;

    const tick = (now: number): void => {
      if (disposed) return;
      frame = requestAnimationFrame(tick);
      try {
        const elapsed = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (input.consumePause()) setPaused(!paused);
        const wantsReset = input.consumeReset();
        if (paused) return;

        if (wantsReset && sim.phase === 'racing' && !sim.player.engine.exploded) resetCarToTrack(sim, sim.player);

        accumulator += elapsed;
        let controls = input.read();
        // Touch throttle is automatic, which would over-rev every start: on the
        // grid, touch players rev with the NITRO button instead (nitro is inert there).
        if (input.touch && sim.phase === 'countdown') controls = { ...controls, throttle: controls.nitro ? 1 : 0 };
        // A shift is an edge: kept until a step actually runs, then applied once.
        const shift = input.consumeShift();
        if (shift !== 0) pendingShift = shift;
        let steps = 0;
        while (accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
          if (debug.autopilot) controls = autopilot(sim.player, STEP);
          stepRaceSim(sim, { ...controls, shift: pendingShift }, STEP);
          pendingShift = 0;
          accumulator -= STEP;
          steps++;
        }
        if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
        handleEvents();

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

        if (sim.phase === 'finished' && sim.finishedFor > OUTRO_SECONDS) finish(false);
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
