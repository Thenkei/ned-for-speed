import type { ShiftRequest } from '../domain/drivetrain';
import { IDLE_PAD, pickPad, readPad, type PadReading, type Rumble } from './gamepad';
import type { Controls } from './sim';

/**
 * Keyboard + touch + gamepad input. Keys are matched on `event.code` (physical
 * position) so that WASD works on a French AZERTY keyboard as ZQSD without
 * configuration. The gamepad is polled once per frame (`poll`); the mapping
 * itself lives in `gamepad.ts`.
 */

/** The device the player last used: drives the hints and the touch auto-throttle. */
export type InputDevice = 'keyboard' | 'touch' | 'gamepad';

const KEY_BINDINGS: Readonly<Record<string, keyof KeyState>> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'nitro',
  ShiftLeft: 'nitro',
  ShiftRight: 'nitro',
  KeyN: 'nitro',
};

/** Manual gearbox. Physical keys: E / Q on QWERTY, E / A on AZERTY — next to the WASD/ZQSD cluster. */
const SHIFT_BINDINGS: Readonly<Record<string, ShiftRequest>> = {
  KeyE: 1,
  KeyQ: -1,
  PageUp: 1,
  PageDown: -1,
};

interface KeyState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  nitro: boolean;
}

export interface RaceInput {
  /** The device the player last used (touch screens start on 'touch'). */
  device(): InputDevice;
  /** Reads the gamepad. Call once per frame, before the `consume*` and `read` calls. */
  poll(): void;
  read(): Controls;
  /** True once, the frame after the player asked for it. */
  consumePause(): boolean;
  consumeReset(): boolean;
  showFinishControls(): void;
  /** Gear change requested since the last call (the latest wins). */
  consumeShift(): ShiftRequest;
  /** Vibrates the gamepad, if that is what the player is driving with and it can. */
  rumble(effect: Rumble): void;
  dispose(): void;
}

export interface RaceInputOptions {
  /** Shows the shift buttons on touch screens. */
  readonly manualGearbox: boolean;
}

export function createRaceInput(host: HTMLElement, options: RaceInputOptions = { manualGearbox: false }): RaceInput {
  const keys: KeyState = { up: false, down: false, left: false, right: false, nitro: false };
  const touch: KeyState = { up: false, down: false, left: false, right: false, nitro: false };
  let burnButton: HTMLButtonElement | undefined;
  let keyBurn = false;
  let pointerBurn = false;
  let pauseRequested = false;
  let resetRequested = false;
  let shiftRequested: ShiftRequest = 0;
  // Touch pad: only shown on coarse pointers; throttle is automatic there.
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  let device: InputDevice = isTouch ? 'touch' : 'keyboard';
  let pad: PadReading = IDLE_PAD;
  let padPressed: readonly boolean[] | undefined;
  let padIndex: number | undefined;
  const abort = new AbortController();
  const { signal } = abort;

  const onKey = (down: boolean) => (event: KeyboardEvent) => {
    if (burnButton && event.code === 'KeyB') {
      if (!event.repeat) keyBurn = down;
      event.preventDefault();
      return;
    }
    const binding = KEY_BINDINGS[event.code];
    if (binding) {
      keys[binding] = down;
      if (down) device = 'keyboard';
      event.preventDefault();
      return;
    }
    if (!down) return;
    const shift = SHIFT_BINDINGS[event.code];
    if (shift !== undefined) {
      // Holding the key must not run through the whole box.
      if (!event.repeat) shiftRequested = shift;
      event.preventDefault();
      return;
    }
    if (event.code === 'Escape' || event.code === 'KeyP') {
      pauseRequested = true;
      event.preventDefault();
    } else if (event.code === 'KeyR') {
      resetRequested = true;
    }
  };
  window.addEventListener('keydown', onKey(true), { signal });
  window.addEventListener('keyup', onKey(false), { signal });
  // Keys must not stay "stuck" when the tab loses focus mid-press.
  window.addEventListener(
    'blur',
    () => {
      keyBurn = pointerBurn = false;
      keys.up = keys.down = keys.left = keys.right = keys.nitro = false;
    },
    { signal },
  );

  let touchPad: HTMLElement | undefined;
  if (isTouch) {
    const pad = document.createElement('div');
    touchPad = pad;
    pad.className = 'race-touch';
    const button = (label: string, key: keyof KeyState, className: string): HTMLButtonElement => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `race-touch__btn ${className}`;
      element.textContent = label;
      element.setAttribute('aria-label', key);
      const set = (value: boolean) => (event: Event) => {
        touch[key] = value;
        if (value) device = 'touch';
        event.preventDefault();
      };
      element.addEventListener('pointerdown', set(true), { signal });
      element.addEventListener('pointerup', set(false), { signal });
      element.addEventListener('pointercancel', set(false), { signal });
      element.addEventListener('pointerleave', set(false), { signal });
      element.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
      return element;
    };
    const left = document.createElement('div');
    left.className = 'race-touch__group';
    left.append(button('◀', 'left', 'race-touch__btn--steer'), button('▶', 'right', 'race-touch__btn--steer'));
    const right = document.createElement('div');
    right.className = 'race-touch__group';
    right.append(button('FREIN', 'down', 'race-touch__btn--brake'), button('NITRO', 'nitro', 'race-touch__btn--nitro'));
    const pause = document.createElement('button');
    pause.type = 'button';
    pause.className = 'race-touch__pause';
    pause.textContent = 'Ⅱ';
    pause.setAttribute('aria-label', 'Pause');
    pause.addEventListener('click', () => (pauseRequested = true), { signal });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'race-touch__pause race-touch__reset';
    reset.textContent = '↺';
    reset.setAttribute('aria-label', 'Revenir sur la route');
    reset.addEventListener('click', () => (resetRequested = true), { signal });
    pad.append(left, right, pause, reset);
    if (options.manualGearbox) {
      const gears = document.createElement('div');
      gears.className = 'race-touch__gears';
      const shiftButton = (label: string, direction: ShiftRequest, aria: string): HTMLButtonElement => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'race-touch__btn race-touch__btn--shift';
        element.textContent = label;
        element.setAttribute('aria-label', aria);
        element.addEventListener(
          'pointerdown',
          (event) => {
            shiftRequested = direction;
            event.preventDefault();
          },
          { signal },
        );
        element.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
        return element;
      };
      gears.append(shiftButton('+', 1, 'Monter un rapport'), shiftButton('−', -1, 'Descendre un rapport'));
      pad.append(gears);
    }
    host.append(pad);
  }

  // A pad unplugged mid-race must not leave the throttle stuck down.
  window.addEventListener(
    'gamepaddisconnected',
    (event) => {
      if (event.gamepad.index !== padIndex) return;
      pad = IDLE_PAD;
      padPressed = undefined;
      padIndex = undefined;
    },
    { signal },
  );

  return {
    device: () => device,
    poll(): void {
      const found = typeof navigator.getGamepads === 'function' ? pickPad(navigator.getGamepads()) : undefined;
      if (!found) {
        pad = IDLE_PAD;
        padPressed = undefined;
        padIndex = undefined;
        return;
      }
      if (found.index !== padIndex) padPressed = undefined;
      padIndex = found.index;
      pad = readPad(found, padPressed);
      padPressed = pad.pressed;
      if (pad.active) device = 'gamepad';
      if (pad.pause) pauseRequested = true;
      if (pad.reset) resetRequested = true;
      if (pad.shift !== 0) shiftRequested = pad.shift;
    },
    showFinishControls(): void {
      if (burnButton) return;
      touchPad?.remove();
      const button = document.createElement('button');
      burnButton = button;
      button.type = 'button';
      button.className = 'race-burnout';
      const hold = device === 'touch' ? 'Maintenir pour un burnout' : device === 'gamepad' ? 'Burnout · maintenir Ⓑ' : 'Burnout · maintenir B';
      button.innerHTML = `<strong>${hold}</strong><small>Risque de casse moteur</small>`;
      button.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        pointerBurn = true;
      }, { signal });
      button.addEventListener('lostpointercapture', () => { pointerBurn = false; }, { signal });
      const holdKey = (down: boolean) => (event: KeyboardEvent) => {
        if (event.code !== 'Space' && event.code !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) keyBurn = down;
      };
      button.addEventListener('keydown', holdKey(true), { signal });
      button.addEventListener('keyup', holdKey(false), { signal });
      button.addEventListener('blur', () => { keyBurn = false; }, { signal });
      host.append(button);
    },
    read(): Controls {
      const left = keys.left || touch.left;
      const right = keys.right || touch.right;
      const brake = keys.down || touch.down;
      const throttle = keys.up || (device === 'touch' && !brake);
      // Keys and pad combine: the stronger input wins, a held key overrides the stick.
      const digitalSteer = (right ? 1 : 0) - (left ? 1 : 0);
      const analogSteer = digitalSteer === 0 && pad.analogSteer;
      return {
        burnout: keyBurn || pointerBurn || (burnButton !== undefined && pad.burnout),
        throttle: Math.max(throttle ? 1 : 0, pad.throttle),
        brake: Math.max(brake ? 1 : 0, pad.brake),
        steer: digitalSteer !== 0 ? digitalSteer : pad.steer,
        nitro: keys.nitro || touch.nitro || pad.nitro,
        ...(analogSteer && { analogSteer }),
      };
    },
    consumePause(): boolean {
      const value = pauseRequested;
      pauseRequested = false;
      return value;
    },
    consumeReset(): boolean {
      const value = resetRequested;
      resetRequested = false;
      return value;
    },
    consumeShift(): ShiftRequest {
      const value = shiftRequested;
      shiftRequested = 0;
      return value;
    },
    rumble(effect: Rumble): void {
      if (device !== 'gamepad' || padIndex === undefined) return;
      const actuator = navigator.getGamepads()[padIndex]?.vibrationActuator;
      // Not every pad (or browser) can rumble; a refusal is not worth a log line.
      actuator
        ?.playEffect('dual-rumble', { duration: effect.durationMs, strongMagnitude: effect.strong, weakMagnitude: effect.weak })
        .catch(() => undefined);
    },
    dispose(): void {
      abort.abort();
      touchPad?.remove();
      burnButton?.remove();
    },
  };
}
