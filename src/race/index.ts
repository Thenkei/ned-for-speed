import './race.css';
import { audio } from '../infra/audio';
import type { RaceOutcome, RaceSetup } from '../domain/types';
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
}

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
    overlay.innerHTML = `
      <div class="race-pause__panel" role="dialog" aria-modal="true" aria-label="Pause">
        <h2>PAUSE</h2>
        <p class="race-pause__keys">
          <b>↑ / W</b> accélérer · <b>↓ / S</b> freiner · <b>← → / A D</b> tourner<br>
          <b>Espace / Maj</b> nitro · <b>R</b> se remettre sur la route · <b>Échap</b> pause
        </p>
        <button type="button" class="btn btn--primary" data-action="resume">Reprendre</button>
        <button type="button" class="btn btn--danger" data-action="abandon">Abandonner la course</button>
      </div>`;
    host.append(canvas, overlay);

    let sim: RaceSim;
    let renderer: RaceRenderer;
    const input = createRaceInput(host);
    try {
      sim = createRaceSim(setup);
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
    audio.startEngine();

    let paused = false;
    const setPaused = (value: boolean): void => {
      if (sim.phase === 'finished') return;
      paused = value;
      overlay.hidden = !value;
      if (value) audio.updateEngine({ revs: 0.1, throttle: 0, nitro: false });
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
      if (sim.phase === 'countdown' || sim.time < 3) {
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
        let steps = 0;
        while (accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
          if (debug.autopilot) controls = autopilot(sim.player, STEP);
          stepRaceSim(sim, controls, STEP);
          accumulator -= STEP;
          steps++;
        }
        if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
        handleEvents();

        if (sim.phase === 'finished' && !endAnnounced) {
          endAnnounced = true;
          announceEnd();
        }

        // Fake gearbox for the engine note: revs climb then drop at each shift.
        const player = sim.player;
        const speedRatio = Math.min(1, Math.abs(player.speed) / (player.drive.maxSpeed * 1.2));
        const gearPosition = speedRatio * 5;
        const revs = player.engine.exploded ? 0 : 0.25 + 0.75 * (gearPosition - Math.floor(Math.min(gearPosition, 4.999)));
        audio.updateEngine({
          revs: sim.phase === 'countdown' ? 0.2 + (controls.throttle > 0 ? 0.5 : 0) : revs,
          throttle: player.engine.exploded ? 0 : controls.throttle,
          nitro: player.engine.nitroActive,
        });

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
