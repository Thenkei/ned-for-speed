import type { BodyKind, ExhaustBuild, Rarity, TurboBuild } from '../domain/types';

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
  /** 0–1: anti-lag / pop-and-bang map. Bangs and flames on every lift-off (see `stepPopsAndBangs`). */
  readonly popsAndBangs: number;
  /** Multiplier on how hard each bang hits (a free-flowing exhaust is louder). */
  readonly bangLoudness: number;
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
    popsAndBangs: 0,
    bangLoudness: 1,
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
    popsAndBangs: 0,
    bangLoudness: 1,
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
    popsAndBangs: 0,
    bangLoudness: 1,
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
    popsAndBangs: 0,
    bangLoudness: 1,
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
    popsAndBangs: 0,
    bangLoudness: 1,
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
    popsAndBangs: 0,
    bangLoudness: 1,
  },
};

/** The voice the game had before engines had characters (the hatch's raspy four). */
export const DEFAULT_ENGINE_PROFILE: EngineSoundProfile = ENGINE_SOUND_PROFILES.hatch;

export function engineProfileFor(body: BodyKind | undefined): EngineSoundProfile {
  return (body && ENGINE_SOUND_PROFILES[body]) || DEFAULT_ENGINE_PROFILE;
}

// ───────────────────────── Fitted turbos ─────────────────────────

/** A bolt-on turbo, by size. A big snail whistles louder, lags more and chatters on the blow-off. */
const FITTED_TURBO: Readonly<Record<'small' | 'big', TurboProfile>> = {
  small: { level: 0.6, spoolSeconds: 0.4, flutter: 0 },
  big: { level: 1, spoolSeconds: 0.85, flutter: 1 },
};

/**
 * Pop-and-bang level of a fitted turbo. The full "brap-pap-BANG" is the big
 * home-made build (garage tune, anti-lag map); a big factory-quality turbo or
 * a small home-made one only pops now and then.
 */
export function popsAndBangsLevel(turbo: TurboBuild | undefined): number {
  if (!turbo) return 0;
  if (turbo.big && turbo.homemade) return 1;
  if (turbo.big) return 0.4;
  if (turbo.homemade) return 0.3;
  return 0;
}

/** Player-facing description of what a turbo does to the car's sound. */
export function turboSoundLabel(turbo: TurboBuild): string {
  if (turbo.big && turbo.homemade) return 'Gros turbo maison : sifflement, dump valve et pop & bang 💥';
  if (turbo.big) return 'Gros turbo : gros sifflement, quelques pétarades';
  if (turbo.homemade) return 'Turbo bricolé : sifflement et quelques pétarades';
  return 'Sifflement de turbo';
}

// ───────────────────────── Fitted exhausts ─────────────────────────

/** What an exhaust does to the voice: multipliers on the engine's own, plus the pops it brings by itself. */
export interface ExhaustSound {
  readonly gain: number;
  readonly brightness: number;
  readonly roughness: number;
  readonly crackle: number;
  /** Bangs of a pop-and-bang map hit this much harder. */
  readonly bangLoudness: number;
  /** Pop level the exhaust gives on its own, turbo or not. */
  readonly pops: number;
  readonly label: string;
}

export const EXHAUST_SOUND: Readonly<Record<Rarity, ExhaustSound>> = {
  // "Pot percé": a holed silencer. Loud, rattly, spits on the overrun.
  occasion: { gain: 1.22, brightness: 0.95, roughness: 1.3, crackle: 1.8, bangLoudness: 1.2, pops: 0.15, label: 'Pot percé : ça rugit, ça crache' },
  sport: { gain: 1.1, brightness: 1.05, roughness: 1, crackle: 1.2, bangLoudness: 1.15, pops: 0, label: 'Ligne inox : un peu plus de voix' },
  racing: { gain: 1.2, brightness: 1.1, roughness: 1, crackle: 1.5, bangLoudness: 1.3, pops: 0.1, label: 'Sortie centrale : grosse voix, pétarades plus fortes' },
  // Titanium sings: brighter rather than louder.
  proto: { gain: 1.18, brightness: 1.25, roughness: 0.9, crackle: 1.5, bangLoudness: 1.35, pops: 0.1, label: 'Titane : chant aigu, pétarades plus fortes' },
  legende: { gain: 1.3, brightness: 1, roughness: 1.1, crackle: 2, bangLoudness: 1.6, pops: 0.2, label: 'Tonnerre de Brest : des détonations énormes 💥' },
};

/** A garage-built line: rawer and spittier than the catalogue part. */
const HOMEMADE_EXHAUST = { roughness: 1.15, crackle: 1.2 } as const;

export function exhaustSoundLabel(exhaust: ExhaustBuild): string {
  return EXHAUST_SOUND[exhaust.rarity].label + (exhaust.homemade ? ' (fait maison, encore plus brut)' : '');
}

/** The parts that change how a car sounds. */
export interface SoundBuild {
  readonly turbo?: TurboBuild | undefined;
  readonly exhaust?: ExhaustBuild | undefined;
}

/**
 * The car's voice with its fitted parts. A turbo on an atmospheric engine
 * adds the whistle and the blow-off, on a turbo engine it can only make it
 * bigger; an exhaust makes the engine louder and rawer and the bangs hit
 * harder. The engine itself (pitch, harmonics) never changes.
 */
export function tunedEngineProfile(base: EngineSoundProfile, build: SoundBuild = {}): EngineSoundProfile {
  const { turbo, exhaust } = build;
  if (!turbo && !exhaust) return base;
  let profile = base;
  if (turbo) {
    const fitted = FITTED_TURBO[turbo.big ? 'big' : 'small'];
    const merged: TurboProfile = base.turbo
      ? {
          level: Math.max(base.turbo.level, fitted.level),
          spoolSeconds: Math.max(base.turbo.spoolSeconds, fitted.spoolSeconds),
          flutter: Math.max(base.turbo.flutter, fitted.flutter),
        }
      : fitted;
    profile = { ...profile, turbo: merged, popsAndBangs: Math.max(profile.popsAndBangs, popsAndBangsLevel(turbo)) };
  }
  if (exhaust) {
    const sound = EXHAUST_SOUND[exhaust.rarity];
    const home = exhaust.homemade ? HOMEMADE_EXHAUST : { roughness: 1, crackle: 1 };
    profile = {
      ...profile,
      gainTrim: profile.gainTrim * sound.gain,
      brightness: profile.brightness * sound.brightness,
      roughness: profile.roughness * sound.roughness * home.roughness,
      crackle: profile.crackle * sound.crackle * home.crackle,
      bangLoudness: profile.bangLoudness * sound.bangLoudness,
      popsAndBangs: Math.max(profile.popsAndBangs, sound.pops),
    };
  }
  return profile;
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

// ───────────────────────── Pops and bangs ─────────────────────────

export interface OverrunState {
  /** Seconds since the throttle was released (0 while on it). */
  readonly liftedFor: number;
  readonly throttle: number;
}

export const ON_THROTTLE: OverrunState = { liftedFor: 0, throttle: 1 };

/** Tunables of the pop-and-bang map. */
export const POPS_AND_BANGS = {
  /** No fuel to burn below this RPM norm. */
  minRevs: 0.3,
  /** The map fires at full rate for this long after a lift, then fades out over `fadeSeconds`. */
  fullSeconds: 1,
  fadeSeconds: 0.6,
  /** Bangs per second at full level: base, plus this much per unit of RPM norm. */
  baseRate: 5,
  ratePerRev: 12,
  /** The lift itself fires a guaranteed bang from this RPM norm up. */
  firstBangRevs: 0.4,
} as const;

/**
 * Overrun of an engine with a pop-and-bang map: after a lift, unburnt fuel
 * goes off in the hot exhaust in a volley of bangs. Returns the expected
 * bangs per second (the caller samples it) and whether the lift itself
 * fires one: the signature crack the instant the throttle snaps shut.
 */
export function stepPopsAndBangs(
  state: OverrunState,
  input: { readonly throttle: number; readonly revs: number },
  profile: EngineSoundProfile,
  dt: number,
): { readonly state: OverrunState; readonly bangRate: number; readonly liftBang: boolean } {
  const throttle = clamp(Number.isFinite(input.throttle) ? input.throttle : 0, 0, 1);
  const revs = Number.isFinite(input.revs) ? input.revs : 0;
  const lifted = throttle < 0.05;
  const justLifted = lifted && state.throttle >= 0.05;
  const liftedFor = lifted ? (justLifted ? 0 : state.liftedFor + Math.max(0, dt)) : 0;
  const next = { liftedFor, throttle };
  const level = clamp(profile.popsAndBangs, 0, 1);
  if (level <= 0 || !lifted || revs < POPS_AND_BANGS.minRevs) return { state: next, bangRate: 0, liftBang: false };
  const t = POPS_AND_BANGS;
  const window = liftedFor <= t.fullSeconds ? 1 : clamp(1 - (liftedFor - t.fullSeconds) / t.fadeSeconds, 0, 1);
  return {
    state: next,
    bangRate: level * (t.baseRate + t.ratePerRev * clamp(revs, 0, 1.1)) * window,
    liftBang: justLifted && revs >= t.firstBangRevs && level >= 0.5,
  };
}

/** Loudest a bang may get (a big home-made turbo through the thunder pipe). */
export const MAX_BANG = 1.6;

/** Loudness of one bang, 0–`MAX_BANG`: harder at high revs, on a wilder map and through a freer exhaust. */
export function bangStrength(revs: number, profile: Pick<EngineSoundProfile, 'popsAndBangs' | 'bangLoudness'>, roll: number): number {
  const base = (0.45 + 0.55 * clamp(revs, 0, 1)) * (0.6 + 0.4 * clamp(profile.popsAndBangs, 0, 1)) * (0.75 + 0.5 * clamp(roll, 0, 1));
  return Math.min(MAX_BANG, clamp(base, 0, 1) * clamp(profile.bangLoudness, 0, MAX_BANG));
}
