import type { DriveSpec } from './engine';
import { createRng } from './rng';
import { FORECAST_TUNING, WEATHER_PROFILES, type ForecastTuning, type Weather, type WeatherProfile } from './tuning';

/**
 * Weather acts on the car's `DriveSpec` rather than inside the physics loop:
 * the player's physics *and* the rival AI (which plans corner and braking
 * speeds from the same spec) adapt to a wet track without any special case.
 */

export function weatherProfile(weather: Weather | undefined): WeatherProfile {
  return WEATHER_PROFILES[weather ?? 'dry'];
}

export function applyWeather(drive: DriveSpec, profile: WeatherProfile): DriveSpec {
  const grip = drive.grip * profile.gripMultiplier;
  return {
    ...drive,
    grip,
    brake: drive.brake * profile.brakeMultiplier,
    slipRecovery: drive.slipRecovery * profile.slipRecoveryMultiplier,
    traction: Math.min(drive.traction, grip * profile.tractionShareOfGrip),
  };
}

/**
 * Deterministic forecast for a race seed, so the menu can announce the
 * weather before the start and the race is reproducible from a save.
 */
export function forecastWeather(seed: number, tuning: ForecastTuning = FORECAST_TUNING): Weather {
  // Salted so the forecast is not correlated with the first rolls of the race RNG.
  return createRng((seed ^ 0x5bd1e995) >>> 0).next() < tuning.rainChance ? 'wet' : 'dry';
}

/** Distance needed to stop from `speed` (px/s) with a given spec (ignores rolling drag). */
export function brakingDistance(drive: DriveSpec, speed: number): number {
  return (speed * speed) / (2 * drive.brake);
}
