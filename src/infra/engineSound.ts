/**
 * Engine and tyre sound design, kept free of WebAudio so it can be unit-tested:
 * turns what the car is doing into synthesis parameters. `audio.ts` only
 * glides its oscillators and filters towards these values.
 *
 * Engine model: the fundamental is the firing frequency, rpm × cylinders / 120
 * (a four: 30 Hz at idle, ~240 Hz at the limiter). Each kind of car has its
 * own voice on top of the shared design below (`engineProfiles.ts`).
 *  - idle:    low, dark, lumpy (amplitude modulation at half the firing rate);
 *  - on load: louder, brighter, grittier (more drive into the waveshaper), and
 *             the intake starts to roar;
 *  - overrun: quieter and duller, with exhaust crackles above mid revs;
 *  - limiter: the note chops (fuel cut) a couple of dozen times a second.
 *
 * Tyres: a *pitched* screech, not just hiss, so a spinning or sliding car is
 * unmistakable. Wheelspin screams high and wobbles (stick-slip); a cornering
 * slide chirps lower. On a wet road the rubber wails lower and hissier, as loud.
 */

import { DEFAULT_ENGINE_PROFILE, firingFrequency, type EngineSoundProfile } from './engineProfiles';

export interface EngineSoundInput {
  readonly rpm: number;
  readonly idleRpm: number;
  readonly redlineRpm: number;
  /** 0–1. */
  readonly throttle: number;
  /** Longitudinal acceleration in px/s² (positive = gaining speed). */
  readonly acceleration: number;
  readonly limiter: boolean;
  /** 0–1: driven wheels spinning (bad launch, or more power than the road takes). */
  readonly wheelspin: number;
  /** Sideways speed of the car (px/s): how hard it is sliding. */
  readonly lateralSlip: number;
  readonly nitro: boolean;
  /** Engine dead (exploded): only the ambience remains. */
  readonly off: boolean;
  /** 0–1 share of top speed, drives road noise and spray. */
  readonly speedRatio: number;
  readonly wet: boolean;
  /** 0–1 turbo boost (see `stepTurbo`); ignored by engines without a turbo. */
  readonly turboSpool: number;
}

export interface TyreSoundParams {
  readonly gain: number;
  /** Centre pitch of the screech (Hz). */
  readonly pitch: number;
  /** 0 = pure hiss (wet rubber) … 1 = clean pitched scream (dry wheelspin). */
  readonly tonality: number;
  /** 0–1 depth of the irregular pitch wobble (stick-slip chatter). */
  readonly wobble: number;
}

export interface EngineSoundParams {
  /** Firing frequency (Hz), the main oscillator. */
  readonly frequency: number;
  readonly gain: number;
  readonly filterHz: number;
  /** 0–1 depth of the firing-rate amplitude modulation (the "lump"). */
  readonly roughness: number;
  /** 0–1 depth of the rev-limiter chop. */
  readonly limiterDepth: number;
  /** 0–1 waveshaper drive: grit under load. */
  readonly drive: number;
  /** Intake roar: band-passed noise that opens up with throttle and revs. */
  readonly intakeGain: number;
  readonly intakeHz: number;
  /** Expected exhaust crackles per second. */
  readonly crackleRate: number;
  /** Turbo whistle: a sine that rises with the boost. */
  readonly turboGain: number;
  readonly turboHz: number;
  readonly tyre: TyreSoundParams;
  readonly nitroGain: number;
  readonly rainGain: number;
  readonly sprayGain: number;
}

/** Tunables of the tyre voice. */
export const TYRE_SOUND = {
  /** Lateral slip (px/s) where a cornering squeal starts, and where it is at full voice. */
  slideFrom: 55,
  slideFull: 110,
  /** Peak gains: wheelspin is the loudest thing on the car, on purpose. */
  spinGain: 0.22,
  slideGain: 0.11,
  /** Pitch (Hz): wheelspin climbs with the revs, slides sit lower. */
  spinPitch: 980,
  spinPitchPerRev: 320,
  slidePitch: 720,
  /** Wet rubber: lower and hissier, but as loud: a wheelspin must never go unnoticed. */
  wetGain: 1,
  wetPitch: 0.7,
  wetTonality: 0.55,
  dryTonality: 0.9,
} as const;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const SILENT_TYRES: TyreSoundParams = { gain: 0, pitch: TYRE_SOUND.slidePitch, tonality: 0, wobble: 0 };

export function tyreSoundParams(wheelspin: number, lateralSlip: number, revs: number, wet: boolean): TyreSoundParams {
  const spin = clamp(Number.isFinite(wheelspin) ? wheelspin : 0, 0, 1);
  const slide = clamp((Math.abs(lateralSlip) - TYRE_SOUND.slideFrom) / (TYRE_SOUND.slideFull - TYRE_SOUND.slideFrom), 0, 1);
  const spinPart = TYRE_SOUND.spinGain * spin;
  const slidePart = TYRE_SOUND.slideGain * slide;
  const total = spinPart + slidePart;
  if (total <= 0 || !Number.isFinite(total)) return SILENT_TYRES;
  // Pitch and wobble lean towards whichever source dominates.
  const spinShare = spinPart / total;
  const spinPitch = TYRE_SOUND.spinPitch + TYRE_SOUND.spinPitchPerRev * clamp(revs, 0, 1.1);
  const pitch = spinPitch * spinShare + (TYRE_SOUND.slidePitch + 120 * slide) * (1 - spinShare);
  // Two sources do not add up linearly in loudness.
  const gain = Math.max(spinPart, slidePart) + 0.35 * Math.min(spinPart, slidePart);
  return {
    gain: gain * (wet ? TYRE_SOUND.wetGain : 1),
    pitch: pitch * (wet ? TYRE_SOUND.wetPitch : 1),
    tonality: wet ? TYRE_SOUND.wetTonality : TYRE_SOUND.dryTonality,
    wobble: clamp(0.35 + 0.65 * spinShare, 0, 1),
  };
}

export function engineSoundParams(input: EngineSoundInput, profile: EngineSoundProfile = DEFAULT_ENGINE_PROFILE): EngineSoundParams {
  const span = Math.max(1, input.redlineRpm - input.idleRpm);
  const revs = clamp((input.rpm - input.idleRpm) / span, 0, 1.1);
  const ambience = {
    rainGain: input.wet ? 0.07 : 0,
    sprayGain: input.wet ? 0.16 * clamp(input.speedRatio, 0, 1) : 0,
    // A dead engine still rolls: the tyres keep their voice.
    tyre: tyreSoundParams(input.off ? 0 : input.wheelspin, input.lateralSlip, revs, input.wet),
  };
  if (input.off) {
    return {
      frequency: firingFrequency(0, profile), gain: 0, filterHz: 300, roughness: 0, limiterDepth: 0, drive: 0,
      intakeGain: 0, intakeHz: 400, crackleRate: 0, turboGain: 0, turboHz: 1800, nitroGain: 0, ...ambience,
    };
  }
  const throttle = clamp(input.throttle, 0, 1);
  // Load: pulling hard vs coasting. Throttle alone is not enough (a car held on
  // the limiter in neutral is loud but not under load).
  const pulling = throttle * clamp(0.5 + input.acceleration / 400, 0.3, 1);
  const overrun = throttle < 0.05 && revs > 0.3;

  // Variable cam timing: past the switch point the note hardens and opens up.
  const cam = revs >= profile.camNorm && !overrun;
  const gain = (0.045 + revs * 0.035 + pulling * 0.06 - (overrun ? 0.012 : 0) + (cam ? 0.008 : 0)) * profile.gainTrim;
  const filterHz = (320 + revs * 1500 + pulling * 900) * (overrun ? 0.7 : 1) * profile.brightness * (cam ? 1.3 : 1);
  const roughness = clamp((0.45 - revs * 0.38 + pulling * 0.05) * profile.roughness, 0.03, 0.6);
  const spool = clamp(Number.isFinite(input.turboSpool) ? input.turboSpool : 0, 0, 1);
  const turboLevel = profile.turbo?.level ?? 0;

  return {
    frequency: firingFrequency(input.rpm, profile),
    gain: clamp(gain, 0, 0.17),
    filterHz,
    roughness,
    limiterDepth: input.limiter ? 0.85 : 0,
    drive: clamp((0.1 + pulling * 0.55 + revs * 0.25) * profile.grit, 0, 1),
    intakeGain: 0.05 * throttle * clamp(0.25 + revs, 0, 1.1),
    intakeHz: 380 + revs * 1700,
    crackleRate: overrun ? (2 + revs * 7) * profile.crackle : 0,
    turboGain: 0.035 * turboLevel * spool * (0.4 + 0.6 * throttle),
    turboHz: 1800 + 4200 * spool,
    nitroGain: input.nitro ? 0.22 : 0,
    ...ambience,
  };
}

// ───────────────────────── Rival engines ─────────────────────────

export interface RivalSoundInput {
  readonly rpm: number;
  readonly throttle: number;
  /** Rival position relative to the listener (Ned), in px. */
  readonly dx: number;
  readonly dy: number;
  /** Rival velocity minus listener velocity (px/s). */
  readonly dvx: number;
  readonly dvy: number;
  /** Listener heading (rad): sets left and right. */
  readonly heading: number;
  readonly off: boolean;
}

export interface RivalSoundParams {
  readonly frequency: number;
  readonly gain: number;
  readonly filterHz: number;
  /** −1 (left) … 1 (right). */
  readonly pan: number;
}

/** Tunables of the rival voices. */
export const RIVAL_SOUND = {
  /** Gain of a rival right next to Ned (well under his own engine). */
  nearGain: 0.06,
  /** Distance (px) at which a rival is at half loudness, and beyond which it is silent. */
  halfDistance: 260,
  maxDistance: 1400,
  /**
   * Speed of sound in px/s for the Doppler shift. The real value at the game's
   * ~10 px/m scale is ~3400; lower exaggerates the pass-by "neeeow" for effect.
   */
  speedOfSound: 2200,
} as const;

export function rivalSoundParams(input: RivalSoundInput, profile: EngineSoundProfile = DEFAULT_ENGINE_PROFILE): RivalSoundParams {
  const distance = Math.hypot(input.dx, input.dy);
  if (input.off || !Number.isFinite(distance) || distance > RIVAL_SOUND.maxDistance) {
    return { frequency: 30, gain: 0, filterHz: 300, pan: 0 };
  }
  // Closing speed: positive when the rival is coming towards Ned.
  const closing = distance > 1e-6 ? -(input.dx * input.dvx + input.dy * input.dvy) / distance : 0;
  const doppler = RIVAL_SOUND.speedOfSound / (RIVAL_SOUND.speedOfSound - clamp(closing, -1200, 1200));
  const falloff = 1 / (1 + (distance / RIVAL_SOUND.halfDistance) ** 2);
  // Fade to exactly zero at the edge so a rival never pops in or out.
  const edge = clamp((RIVAL_SOUND.maxDistance - distance) / (RIVAL_SOUND.maxDistance * 0.25), 0, 1);
  const throttle = clamp(input.throttle, 0, 1);
  // Driver's right in screen coordinates (y down): (−sin h, cos h).
  const right = -input.dx * Math.sin(input.heading) + input.dy * Math.cos(input.heading);
  return {
    frequency: firingFrequency(input.rpm, profile) * doppler,
    gain: RIVAL_SOUND.nearGain * profile.gainTrim * (0.6 + 0.4 * throttle) * falloff * edge,
    // Far cars lose their top end (air absorption, and it keeps them behind Ned's engine).
    filterHz: (500 + 1400 * throttle) * profile.brightness * (0.35 + 0.65 * falloff),
    pan: clamp(right / (Math.abs(right) + 120), -1, 1) * 0.85,
  };
}
