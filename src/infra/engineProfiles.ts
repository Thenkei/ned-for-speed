import type { BodyKind } from '../domain/types';

/**
 * One engine voice per kind of car. Sound only: the physics and the RPM range
 * are shared by every car (see `domain/tuning.ts`); what changes is how the
 * same RPM *sounds*.
 *
 * The pitch follows the firing frequency of a four-stroke, rpm × cylinders /
 * 120: at the same revs a straight-six sings 1.5× higher than a four, a V10
 * 2.5× higher. The rest is character: harmonic recipe, how lumpy the idle
 * is, how bright and gritty it gets on load, exhaust resonances, crackles,
 * and for the turbo cars a spooling whistle and a blow-off valve.
 */

export interface TurboProfile {
  /** Whistle level at full boost (0–1 of the design maximum). */
  readonly level: number;
  /** Time constant of the spool-up: the turbo lag. */
  readonly spoolSeconds: number;
  /** 0–1: how much the blow-off chatters (compressor surge on a big turbo). */
  readonly flutter: number;
}

export interface EngineSoundProfile {
  readonly id: BodyKind;
  /** What the player would read in a magazine. */
  readonly label: string;
  readonly cylinders: number;
  /** Amplitudes of the harmonics of the firing frequency (index 1 = fundamental; index 0 unused). */
  readonly harmonics: readonly number[];
  /** Level of the half-firing-rate sub-oscillator: the "burble". */
  readonly subLevel: number;
  /** Pitch ratio of the second, detuned oscillator: higher = rougher, more out of tune. */
  readonly twinDetune: number;
  /** Multipliers on the shared design (1 = neutral). */
  readonly roughness: number;
  readonly brightness: number;
  readonly grit: number;
  readonly crackle: number;
  readonly gainTrim: number;
  /** Exhaust resonances (Hz): the low drone and the mid boom. */
  readonly resonances: readonly [number, number];
  /** RPM norm at which a variable cam timing kicks in and the note hardens (none if > 1). */
  readonly camNorm: number;
  readonly turbo: TurboProfile | undefined;
}

const NO_CAM = 2;

export const ENGINE_SOUND_PROFILES: Readonly<Record<BodyKind, EngineSoundProfile>> = {
  // Biquette 1.1: grandma's tired four. Thin, buzzy, out of tune, rattly idle.
  city: {
    id: 'city',
    label: '4 cylindres 1.1 fatigué',
    cylinders: 4,
    harmonics: [0, 1, 0.35, 0.5, 0.2, 0.32, 0.1, 0.16, 0.05, 0.08, 0.03, 0.04],
    subLevel: 0.15,
    twinDetune: 1.012,
    roughness: 1.35,
    brightness: 0.7,
    grit: 0.6,
    crackle: 0.3,
    gainTrim: 0.85,
    resonances: [230, 560],
    camNorm: NO_CAM,
    turbo: undefined,
  },
  // Furet 1.4 Sport: a raspy little four with a straight-through exhaust that pops.
  hatch: {
    id: 'hatch',
    label: '4 cylindres 1.4 échappement libre',
    cylinders: 4,
    harmonics: [0, 1, 0.62, 0.42, 0.5, 0.25, 0.22, 0.12, 0.15, 0.08, 0.07, 0.05, 0.05, 0.03, 0.03, 0.02],
    subLevel: 0.3,
    twinDetune: 1.006,
    roughness: 1,
    brightness: 1.1,
    grit: 1.25,
    crackle: 1.6,
    gainTrim: 1,
    resonances: [160, 420],
    camNorm: NO_CAM,
    turbo: undefined,
  },
  // Cobra 16S: sixteen valves, revs to the moon, and the cam kicks in up top.
  coupe: {
    id: 'coupe',
    label: '4 cylindres 16 soupapes, distribution variable',
    cylinders: 4,
    harmonics: [0, 1, 0.55, 0.45, 0.42, 0.3, 0.28, 0.18, 0.18, 0.11, 0.1, 0.07, 0.07, 0.05, 0.04, 0.03],
    subLevel: 0.25,
    twinDetune: 1.004,
    roughness: 0.9,
    brightness: 1.15,
    grit: 1,
    crackle: 1.1,
    gainTrim: 1,
    resonances: [180, 480],
    camNorm: 0.68,
    turbo: undefined,
  },
  // Sakura Type-S: a silky turbo straight-six. Smooth, round, whistles as it spools.
  sport: {
    id: 'sport',
    label: '6 cylindres en ligne turbo',
    cylinders: 6,
    harmonics: [0, 1, 0.5, 0.3, 0.25, 0.15, 0.1, 0.07, 0.05, 0.03, 0.02],
    subLevel: 0.12,
    twinDetune: 1.003,
    roughness: 0.5,
    brightness: 1,
    grit: 0.7,
    crackle: 0.8,
    gainTrim: 1,
    resonances: [210, 600],
    camNorm: NO_CAM,
    turbo: { level: 0.7, spoolSeconds: 0.45, flutter: 0 },
  },
  // Bulldozer V6 Turbo: a brute. Deep, lumpy burble, a big laggy turbo and a fluttering blow-off.
  muscle: {
    id: 'muscle',
    label: 'V6 turbo gros débit',
    cylinders: 6,
    harmonics: [0, 1, 0.8, 0.55, 0.45, 0.3, 0.2, 0.14, 0.1, 0.06, 0.04],
    subLevel: 0.55,
    twinDetune: 1.008,
    roughness: 1.4,
    brightness: 0.8,
    grit: 1.45,
    crackle: 1.3,
    gainTrim: 1.08,
    resonances: [120, 330],
    camNorm: NO_CAM,
    turbo: { level: 1, spoolSeconds: 0.8, flutter: 1 },
  },
  // Mistral RS: a screaming V10. High, hard, metallic.
  super: {
    id: 'super',
    label: 'V10 atmosphérique',
    cylinders: 10,
    harmonics: [0, 1, 0.45, 0.35, 0.2, 0.18, 0.1, 0.08, 0.05, 0.04],
    subLevel: 0.18,
    twinDetune: 1.003,
    roughness: 0.6,
    brightness: 1.3,
    grit: 0.8,
    crackle: 1.2,
    gainTrim: 1.05,
    resonances: [300, 820],
    camNorm: NO_CAM,
    turbo: undefined,
  },
};

/** The voice the game had before engines had characters (the hatch's raspy four). */
export const DEFAULT_ENGINE_PROFILE: EngineSoundProfile = ENGINE_SOUND_PROFILES.hatch;

export function engineProfileFor(body: BodyKind | undefined): EngineSoundProfile {
  return (body && ENGINE_SOUND_PROFILES[body]) || DEFAULT_ENGINE_PROFILE;
}

/** Firing frequency (Hz) of a four-stroke: each cylinder fires every other revolution. */
export function firingFrequency(rpm: number, profile: EngineSoundProfile): number {
  return Math.max(20, (Math.max(0, rpm) * profile.cylinders) / 120);
}

// ───────────────────────── Turbo ─────────────────────────

export interface TurboState {
  /** 0–1 boost. */
  readonly spool: number;
  readonly throttle: number;
}

export const IDLE_TURBO: TurboState = { spool: 0, throttle: 0 };

/** Boost needed for the blow-off valve to vent when the throttle snaps shut. */
const BLOW_OFF_SPOOL = 0.45;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Spools the turbo up with lag under load and lets it run down off the
 * throttle. `blowOff` is true on the step the throttle snaps shut on boost.
 */
export function stepTurbo(
  state: TurboState,
  input: { readonly throttle: number; readonly revs: number },
  profile: EngineSoundProfile,
  dt: number,
): { readonly state: TurboState; readonly blowOff: boolean } {
  const throttle = clamp(Number.isFinite(input.throttle) ? input.throttle : 0, 0, 1);
  if (!profile.turbo) return { state: { spool: 0, throttle }, blowOff: false };
  // Exhaust energy: no boost off the throttle or at low revs.
  const revs = Number.isFinite(input.revs) ? input.revs : 0;
  const target = throttle * clamp((revs - 0.25) / 0.5, 0, 1);
  const tau = target > state.spool ? profile.turbo.spoolSeconds : 0.25;
  const spool = state.spool + (target - state.spool) * (1 - Math.exp(-Math.max(0, dt) / tau));
  const blowOff = state.throttle >= 0.05 && throttle < 0.05 && state.spool >= BLOW_OFF_SPOOL;
  // The valve vents the boost: the whistle collapses instead of winding down.
  const vented = blowOff ? spool * 0.35 : spool;
  return { state: { spool: clamp(vented, 0, 1), throttle }, blowOff };
}

