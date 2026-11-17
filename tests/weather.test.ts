import { describe, expect, it } from 'vitest';
import { driveSpecFrom } from '../src/domain/engine';
import { FORECAST_TUNING, WEATHER_PROFILES } from '../src/domain/tuning';
import { applyWeather, brakingDistance, forecastWeather, weatherProfile } from '../src/domain/weather';

const stats = { topSpeed: 50, accel: 50, handling: 50, reliability: 50, nitro: 40 };

describe('weather and grip', () => {
  it('leaves the dry car exactly as it was', () => {
    const drive = driveSpecFrom(stats, 100);
    expect(applyWeather(drive, WEATHER_PROFILES.dry)).toEqual(drive);
    expect(drive.traction).toBe(Number.POSITIVE_INFINITY);
    expect(weatherProfile(undefined)).toBe(WEATHER_PROFILES.dry);
  });

  it('cuts cornering grip, braking and slide recovery in the wet, and caps traction', () => {
    const dry = driveSpecFrom(stats, 100);
    const wet = applyWeather(dry, WEATHER_PROFILES.wet);
    expect(wet.grip).toBeLessThan(dry.grip);
    expect(wet.brake).toBeLessThan(dry.brake);
    expect(wet.slipRecovery).toBeLessThan(dry.slipRecovery);
    expect(Number.isFinite(wet.traction)).toBe(true);
    // Straight-line pace is the engine's business, not the weather's.
    expect(wet.maxSpeed).toBe(dry.maxSpeed);
    expect(wet.accel).toBe(dry.accel);
  });

  it('makes stopping distances noticeably longer', () => {
    const dry = driveSpecFrom(stats, 100);
    const wet = applyWeather(dry, WEATHER_PROFILES.wet);
    expect(brakingDistance(wet, 500) / brakingDistance(dry, 500)).toBeGreaterThan(1.3);
  });

  it('lets nitro overwhelm the tyres in the wet', () => {
    const wet = applyWeather(driveSpecFrom({ ...stats, accel: 90, nitro: 80 }, 100), WEATHER_PROFILES.wet);
    expect(wet.accel * 2).toBeGreaterThan(wet.traction);
  });
});

describe('forecast', () => {
  it('is deterministic per seed and rains about as often as configured', () => {
    expect(forecastWeather(1234)).toBe(forecastWeather(1234));
    let wet = 0;
    const n = 4000;
    for (let seed = 0; seed < n; seed++) if (forecastWeather(seed * 7919) === 'wet') wet++;
    expect(wet / n).toBeGreaterThan(FORECAST_TUNING.rainChance - 0.05);
    expect(wet / n).toBeLessThan(FORECAST_TUNING.rainChance + 0.05);
  });

  it('can be forced dry or wet through the tuning', () => {
    expect(forecastWeather(42, { rainChance: 0 })).toBe('dry');
    expect(forecastWeather(42, { rainChance: 1 })).toBe('wet');
  });
});
