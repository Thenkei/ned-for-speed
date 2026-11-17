/**
 * Dev harness (see /race-dev.html): launches a race directly, without the
 * career, to work on tracks, physics and rendering.
 * Query params: track, level (player and rival strength), laps, rivals, auto=1 (AI drives),
 * coach=1 (driving tips), weather=wet, gearbox=manual, body=<BodyKind>.
 */
import type { RaceSetup, Racer, Stats, ThemeId } from '../domain/types';
import { runRace } from './index';

const params = new URLSearchParams(location.search);
const trackId = params.get('track') ?? 'parking';
const level = Number(params.get('level') ?? 30);
const laps = Number(params.get('laps') ?? 2);
const rivalCount = Number(params.get('rivals') ?? 3);

const statsAt = (l: number): Stats => ({ topSpeed: l, accel: l, handling: l + 8, reliability: 50, nitro: 30 + l * 0.4 });
const bodies = ['city', 'hatch', 'coupe', 'sport', 'muscle', 'super'] as const;
const paints = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad'];

const rivals: Racer[] = Array.from({ length: rivalCount }, (_, i) => ({
  name: ['Jordan', 'Cindy', 'Kéké', 'Dédé', 'Samira'][i % 5] ?? 'Rival',
  look: { body: bodies[(i + 1) % bodies.length] ?? 'hatch', paint: paints[i % paints.length] ?? '#fff', neon: i % 2 ? '#2ff3ff' : '', spoiler: i % 2 === 0 },
  stats: statsAt(level - 2 + i * 2),
  condition: 100,
  skill: 0.82,
  recklessness: 0.5,
}));

const setup: RaceSetup = {
  title: `Essai ${trackId}`,
  trackId,
  theme: trackId as ThemeId,
  laps,
  player: {
    name: 'Ned',
    look: { body: (params.get('body') as (typeof bodies)[number]) ?? 'hatch', paint: '#ffb400', neon: '#b04bff', spoiler: true },
    stats: statsAt(level),
    condition: 100,
    skill: 1,
    recklessness: 0,
  },
  rivals,
  seed: Number(params.get('seed') ?? 42),
  coach: params.get('coach') === '1',
  weather: params.get('weather') === 'wet' ? 'wet' : 'dry',
};

const host = document.getElementById('race');
const out = document.getElementById('out');
if (host && out) {
  runRace(host, setup, { muted: params.get('sound') !== '1', transmission: params.get('gearbox') === 'manual' ? 'manual' : 'auto' })
    .then((outcome) => (out.textContent = JSON.stringify(outcome, null, 2)))
    .catch((error: unknown) => (out.textContent = `ERREUR: ${String(error)}`));

  // auto=1: let the AI drive Ned (handy for screenshots and soak tests).
  if (params.get('auto') === '1' && window.__nedRace) window.__nedRace.autopilot = true;
}
