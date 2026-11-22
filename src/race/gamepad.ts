import type { ShiftRequest } from '../domain/drivetrain';

/**
 * Gamepad mapping, kept pure (no `navigator`, no DOM types) so it can be
 * tested headlessly. `input.ts` polls the browser once per frame and feeds the
 * snapshots here.
 *
 * Buttons follow the W3C "standard" layout (Xbox names; on a PlayStation pad
 * A = ✕, B = ○, X = □, Y = △). Pads the browser cannot map to it report
 * `mapping: ''` with arbitrary indices: they are still read with the same
 * indices, which is right for most of them and harmless for the rest.
 *
 * The triggers are what makes a pad worth having here: throttle and brake are
 * analog, so the launch window can be *held* instead of tapped, and wheelspin
 * can be fed out instead of cut.
 */

export const GAMEPAD_TUNING = {
  /** Stick travel ignored around the centre (worn sticks rest off-centre). */
  stickDeadzone: 0.15,
  /** Trigger travel ignored at rest (some report a few % unpressed). */
  triggerDeadzone: 0.05,
  /** Steering curve past the deadzone: > 1 gives finer control around the centre. */
  steerExponent: 1.4,
} as const;

/** W3C standard-mapping button indices. */
export const PAD_BUTTON = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  back: 8,
  start: 9,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

/** Left stick, horizontal. */
const STEER_AXIS = 0;

/** What `input.ts` needs from a browser `Gamepad` (structurally compatible). */
export interface PadSnapshot {
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}

export interface PadReading {
  readonly throttle: number;
  readonly brake: number;
  readonly steer: number;
  /** True when `steer` comes from the stick (the sim then skips the keyboard easing). */
  readonly analogSteer: boolean;
  readonly nitro: boolean;
  readonly burnout: boolean;
  /** One-shot actions, true only on the poll where the button went down. */
  readonly pause: boolean;
  readonly reset: boolean;
  readonly shift: ShiftRequest;
  /** Anything pressed or deflected: the player is using the pad right now. */
  readonly active: boolean;
  /** Pressed state per button, to pass back as `previous` on the next poll. */
  readonly pressed: readonly boolean[];
}

export const IDLE_PAD: PadReading = {
  throttle: 0,
  brake: 0,
  steer: 0,
  analogSteer: false,
  nitro: false,
  burnout: false,
  pause: false,
  reset: false,
  shift: 0,
  active: false,
  pressed: [],
};

const finite = (value: number | undefined): number => (value !== undefined && Number.isFinite(value) ? value : 0);
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Maps a stick axis to -1…1 with a deadzone, rescaled so full travel is still ±1. */
export function stickValue(raw: number, deadzone = GAMEPAD_TUNING.stickDeadzone, exponent = GAMEPAD_TUNING.steerExponent): number {
  const value = clamp(finite(raw), -1, 1);
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return Math.sign(value) * ((magnitude - deadzone) / (1 - deadzone)) ** exponent;
}

/** Maps a trigger to 0…1 with a rest deadzone, rescaled so a full pull is still 1. */
export function triggerValue(raw: number, deadzone = GAMEPAD_TUNING.triggerDeadzone): number {
  const value = clamp(finite(raw), 0, 1);
  return value <= deadzone ? 0 : (value - deadzone) / (1 - deadzone);
}

/**
 * Reads one pad. `previous` is the `pressed` array of the last poll, or
 * undefined on the first one: a button already held when the pad is first seen
 * (say, Start still down from a menu) must not fire its action.
 */
export function readPad(pad: PadSnapshot, previous: readonly boolean[] | undefined): PadReading {
  const pressed = pad.buttons.map((button) => button.pressed);
  const held = (index: number): boolean => pressed[index] ?? false;
  const went = (index: number): boolean => previous !== undefined && held(index) && !(previous[index] ?? false);
  // Digital triggers (cheap pads) report value 0 and pressed true: trust either.
  const trigger = (index: number): number => {
    const button = pad.buttons[index];
    if (!button) return 0;
    return Math.max(triggerValue(button.value), button.pressed && !(button.value > 0) ? 1 : 0);
  };

  const dpad = (held(PAD_BUTTON.dpadRight) ? 1 : 0) - (held(PAD_BUTTON.dpadLeft) ? 1 : 0);
  const stick = stickValue(pad.axes[STEER_AXIS] ?? 0);
  const steer = dpad !== 0 ? dpad : stick;
  const throttle = trigger(PAD_BUTTON.rt);
  const brake = trigger(PAD_BUTTON.lt);
  const shift: ShiftRequest = went(PAD_BUTTON.rb) ? 1 : went(PAD_BUTTON.lb) ? -1 : 0;

  return {
    throttle,
    brake,
    steer,
    analogSteer: dpad === 0 && stick !== 0,
    nitro: held(PAD_BUTTON.a),
    burnout: held(PAD_BUTTON.b),
    pause: went(PAD_BUTTON.start),
    reset: went(PAD_BUTTON.y),
    shift,
    active: throttle > 0 || brake > 0 || steer !== 0 || pressed.some(Boolean),
    pressed,
  };
}

/**
 * Picks the pad to read: the first with the standard layout, else the first
 * connected one. Browsers return a sparse list with `null` holes.
 */
export function pickPad<T extends PadSnapshot & { readonly connected: boolean }>(pads: readonly (T | null)[]): T | undefined {
  const connected = pads.filter((pad): pad is T => pad !== null && pad.connected);
  return connected.find((pad) => pad.mapping === 'standard') ?? connected[0];
}

export interface Rumble {
  /** Low-frequency motor, 0–1. */
  readonly strong: number;
  /** High-frequency motor, 0–1. */
  readonly weak: number;
  readonly durationMs: number;
}

/** Rumble for the player's car hitting a wall or a rival (`strength` 0–1, as in the sim event). */
export function impactRumble(strength: number, sliding: boolean): Rumble | undefined {
  const s = clamp(finite(strength), 0, 1);
  if (s < 0.05) return undefined;
  // A scrape buzzes (weak motor); a hit thumps (strong motor).
  return sliding
    ? { strong: 0.1 * s, weak: 0.3 + 0.5 * s, durationMs: 90 }
    : { strong: 0.3 + 0.7 * s, weak: 0.2 + 0.4 * s, durationMs: Math.round(80 + 220 * s) };
}

export const RUMBLES = {
  explosion: { strong: 1, weak: 1, durationMs: 700 },
  perfectStart: { strong: 0.25, weak: 0.5, durationMs: 140 },
  wheelspin: { strong: 0.15, weak: 0.55, durationMs: 450 },
} as const satisfies Readonly<Record<string, Rumble>>;
