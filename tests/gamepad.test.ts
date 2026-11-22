import { describe, expect, it } from 'vitest';
import { newGame, timeTrialSetup } from '../src/domain/game';
import { DISTRICTS } from '../src/domain/world';
import {
  GAMEPAD_TUNING,
  impactRumble,
  PAD_BUTTON,
  pickPad,
  readPad,
  RUMBLES,
  stickValue,
  triggerValue,
  type PadSnapshot,
} from '../src/race/gamepad';
import { createAutopilot, createRaceSim, stepRaceSim, type Controls } from '../src/race/sim';

const DT = 1 / 120;

/** A standard-layout pad at rest, with the given buttons / axes overridden. */
function pad(
  buttons: Partial<Record<keyof typeof PAD_BUTTON, number | boolean>> = {},
  axes: readonly number[] = [0, 0, 0, 0],
  mapping = 'standard',
): PadSnapshot & { connected: boolean; index: number } {
  const list = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const [name, state] of Object.entries(buttons)) {
    const index = PAD_BUTTON[name as keyof typeof PAD_BUTTON];
    list[index] = typeof state === 'boolean' ? { pressed: state, value: state ? 1 : 0 } : { pressed: state > 0.1, value: state };
  }
  return { mapping, axes, buttons: list, connected: true, index: 0 };
}

describe('gamepad mapping', () => {
  it('ignores a resting stick and still reaches full lock', () => {
    expect(stickValue(0.1)).toBe(0);
    expect(stickValue(-GAMEPAD_TUNING.stickDeadzone)).toBe(0);
    expect(stickValue(1)).toBe(1);
    expect(stickValue(-1)).toBe(-1);
    expect(stickValue(1.3)).toBe(1);
    expect(stickValue(Number.NaN)).toBe(0);
    // Finer around the centre than at the edge, and monotonic.
    expect(stickValue(0.5)).toBeGreaterThan(0);
    expect(stickValue(0.5)).toBeLessThan((0.5 - GAMEPAD_TUNING.stickDeadzone) / (1 - GAMEPAD_TUNING.stickDeadzone));
    expect(stickValue(0.6)).toBeGreaterThan(stickValue(0.5));
  });

  it('reads the triggers as analog pedals', () => {
    expect(triggerValue(0.03)).toBe(0);
    expect(triggerValue(1)).toBe(1);
    expect(triggerValue(0.5)).toBeCloseTo((0.5 - GAMEPAD_TUNING.triggerDeadzone) / (1 - GAMEPAD_TUNING.triggerDeadzone), 9);
    const reading = readPad(pad({ rt: 0.6, lt: 0.2 }, [0.8, 0]), []);
    expect(reading.throttle).toBeCloseTo(triggerValue(0.6), 9);
    expect(reading.brake).toBeCloseTo(triggerValue(0.2), 9);
    expect(reading.steer).toBeCloseTo(stickValue(0.8), 9);
    expect(reading.analogSteer).toBe(true);
    expect(reading.active).toBe(true);
  });

  it('treats a digital trigger (pressed, value 0) as fully pulled', () => {
    const reading = readPad({ ...pad(), buttons: pad().buttons.map((b, i) => (i === PAD_BUTTON.rt ? { pressed: true, value: 0 } : b)) }, []);
    expect(reading.throttle).toBe(1);
  });

  it('lets the d-pad override the stick, without the analog flag', () => {
    const reading = readPad(pad({ dpadLeft: true }, [0.9, 0]), []);
    expect(reading.steer).toBe(-1);
    expect(reading.analogSteer).toBe(false);
  });

  it('holds nitro and burnout, and is idle at rest', () => {
    expect(readPad(pad({ a: true, b: true }), []).nitro).toBe(true);
    expect(readPad(pad({ a: true, b: true }), []).burnout).toBe(true);
    const rest = readPad(pad({}, [0.08, 0.5]), []);
    expect(rest).toMatchObject({ throttle: 0, brake: 0, steer: 0, nitro: false, active: false });
  });

  it('fires shifts, pause and reset once per press', () => {
    const first = readPad(pad({ rb: true, start: true, y: true }), []);
    expect(first).toMatchObject({ shift: 1, pause: true, reset: true });
    const held = readPad(pad({ rb: true, start: true, y: true }), first.pressed);
    expect(held).toMatchObject({ shift: 0, pause: false, reset: false });
    const down = readPad(pad({ lb: true }), held.pressed);
    expect(down.shift).toBe(-1);
  });

  it('does not fire a button already held when the pad is first seen', () => {
    expect(readPad(pad({ start: true, rb: true }), undefined)).toMatchObject({ pause: false, shift: 0 });
  });

  it('prefers a standard-layout pad, skipping holes and disconnected ones', () => {
    const odd = pad({}, [0, 0], '');
    const standard = { ...pad(), index: 2 };
    const gone = { ...pad(), connected: false, index: 1 };
    expect(pickPad([null, odd, gone, standard])).toBe(standard);
    expect(pickPad([null, odd])).toBe(odd);
    expect(pickPad([null, gone])).toBeUndefined();
    expect(pickPad([])).toBeUndefined();
  });

  it('rumbles harder for harder hits, never past full power', () => {
    expect(impactRumble(0.01, false)).toBeUndefined();
    const light = impactRumble(0.2, false)!;
    const hard = impactRumble(1, false)!;
    expect(hard.strong).toBeGreaterThan(light.strong);
    expect(hard.durationMs).toBeGreaterThan(light.durationMs);
    for (const rumble of [hard, impactRumble(1, true)!, impactRumble(5, false)!, ...Object.values(RUMBLES)]) {
      expect(rumble.strong).toBeLessThanOrEqual(1);
      expect(rumble.weak).toBeLessThanOrEqual(1);
      expect(rumble.durationMs).toBeGreaterThan(0);
    }
    expect(impactRumble(0.5, true)!.weak).toBeGreaterThan(impactRumble(0.5, true)!.strong);
  });
});

describe('gamepad in the race', () => {
  const parking = DISTRICTS[0]!;

  it('lets a held half-pulled trigger land a perfect start, where a floored one wheelspins', () => {
    const launch = (throttle: number) => {
      const sim = createRaceSim(timeTrialSetup(newGame(3), parking, 'dry'));
      const controls: Controls = { throttle, brake: 0, steer: 0, nitro: false };
      while (sim.phase === 'countdown') stepRaceSim(sim, controls, DT);
      stepRaceSim(sim, controls, DT);
      return sim.player.launch?.grade;
    };
    // The keyboard can only floor it from the start: over-rev.
    expect(launch(1)).toBe('over');
    // A trigger held at ~65 % the whole countdown sits in the green.
    expect(launch(readPad(pad({ rt: 0.67 }), []).throttle)).toBe('perfect');
  });

  it('turns in faster with a stick than with the eased keyboard wheel', () => {
    const turnAfter = (controls: Controls, seconds: number) => {
      const sim = createRaceSim(timeTrialSetup(newGame(3), parking, 'dry'));
      const pilot = createAutopilot(sim);
      while (sim.phase === 'countdown') stepRaceSim(sim, pilot(sim.player, DT), DT);
      for (let t = 0; t < 1.5; t += DT) stepRaceSim(sim, pilot(sim.player, DT), DT);
      sim.player.steer = 0;
      for (let t = 0; t < seconds; t += DT) stepRaceSim(sim, controls, DT);
      return sim.player.steer;
    };
    const base: Controls = { throttle: 1, brake: 0, steer: 1, nitro: false };
    const keyboard = turnAfter(base, 0.1);
    const stick = turnAfter({ ...base, analogSteer: true }, 0.1);
    expect(stick).toBeGreaterThan(keyboard);
    expect(stick).toBeLessThanOrEqual(1);
  });
});
