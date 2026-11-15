import type { Controls } from './sim';

/**
 * Keyboard + touch input. Keys are matched on `event.code` (physical position)
 * so that WASD works on a French AZERTY keyboard as ZQSD without configuration.
 */

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

interface KeyState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  nitro: boolean;
}

export interface RaceInput {
  /** True on touch devices, where the on-screen pad replaces the keyboard. */
  readonly touch: boolean;
  read(): Controls;
  /** True once, the frame after the player asked for it. */
  consumePause(): boolean;
  consumeReset(): boolean;
  dispose(): void;
}

export function createRaceInput(host: HTMLElement): RaceInput {
  const keys: KeyState = { up: false, down: false, left: false, right: false, nitro: false };
  const touch: KeyState = { up: false, down: false, left: false, right: false, nitro: false };
  let pauseRequested = false;
  let resetRequested = false;
  const abort = new AbortController();
  const { signal } = abort;

  const onKey = (down: boolean) => (event: KeyboardEvent) => {
    const binding = KEY_BINDINGS[event.code];
    if (binding) {
      keys[binding] = down;
      event.preventDefault();
      return;
    }
    if (!down) return;
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
      keys.up = keys.down = keys.left = keys.right = keys.nitro = false;
    },
    { signal },
  );

  // Touch pad: only shown on coarse pointers; throttle is automatic there.
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  let pad: HTMLElement | undefined;
  if (isTouch) {
    pad = document.createElement('div');
    pad.className = 'race-touch';
    const button = (label: string, key: keyof KeyState, className: string): HTMLButtonElement => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `race-touch__btn ${className}`;
      element.textContent = label;
      element.setAttribute('aria-label', key);
      const set = (value: boolean) => (event: Event) => {
        touch[key] = value;
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
    host.append(pad);
  }

  return {
    touch: isTouch,
    read(): Controls {
      const left = keys.left || touch.left;
      const right = keys.right || touch.right;
      const brake = keys.down || touch.down;
      const throttle = keys.up || (isTouch && !brake);
      return {
        throttle: throttle ? 1 : 0,
        brake: brake ? 1 : 0,
        steer: (right ? 1 : 0) - (left ? 1 : 0),
        nitro: keys.nitro || touch.nitro,
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
    dispose(): void {
      abort.abort();
      pad?.remove();
    },
  };
}
