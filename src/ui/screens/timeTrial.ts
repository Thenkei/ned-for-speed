import { carModel } from '../../domain/cars';
import { activeCar } from '../../domain/game';
import type { GhostRun } from '../../domain/ghost';
import type { Weather } from '../../domain/tuning';
import type { District, GameState } from '../../domain/types';
import { districtById } from '../../domain/world';
import { loadGhost } from '../../infra/storage';
import { backdropStyle, button } from '../components';
import { esc, num, raceTime } from '../dom';
import type { View } from '../view';

const WEATHER_LABEL: Readonly<Record<Weather, string>> = { dry: '☀️ Sec', wet: '🌧️ Pluie' };

/** "−0.32 s" / "+1.05 s": same notation as the race clock and the in-race splits. */
function delta(seconds: number): string {
  return `${seconds < 0 ? '−' : '+'}${Math.abs(seconds).toFixed(2)} s`;
}

function recordLine(run: GhostRun | undefined): string {
  return run ? `<strong>${esc(raceTime(run.time))}</strong>` : '<span class="muted">pas encore de chrono</span>';
}

/** Card in the district detail: the active car's records on this track, and the way in. */
export function timeTrialCard(game: GameState, district: District): string {
  const car = activeCar(game);
  const model = carModel(car.modelId);
  const dead = car.condition <= 0;
  const rows = (['dry', 'wet'] as const)
    .map((weather) => {
      const record = loadGhost(district.trackId, weather, car.modelId);
      return `
        <li>
          <span class="trial-weather">${WEATHER_LABEL[weather]}</span>
          <span class="trial-record">${recordLine(record)}</span>
          ${button({ action: 'time-trial', label: record ? 'Battre le record' : 'Rouler', data: { weather }, variant: 'ghost', small: true, dim: dead })}
        </li>`;
    })
    .join('');
  return `
    <article class="trial-card">
      <div class="trial-info">
        <p class="kicker">⏱️ Chrono</p>
        <h4>Contre la montre</h4>
        <p>Trois tours, seul en piste, contre le fantôme de ton meilleur temps. Rien à gagner, rien à casser : juste le chrono.</p>
        <p class="trial-car">Records de la ${esc(model.name)}</p>
      </div>
      <ul class="trial-records">${rows}</ul>
    </article>`;
}

export function renderTrialResult(view: View): string {
  const result = view.ui.trialResult;
  if (!result) return '';
  const district = districtById(result.districtId);
  const { run, previous, outcome } = result;

  let big: string;
  let sub: string;
  let tone: 'win' | 'meh' | 'lose' | 'boom';
  if (!run) {
    big = outcome.exploded ? '💥 Boum.' : 'Pas de chrono';
    sub = outcome.exploded ? 'Moteur explosé : le chrono ne compte pas (et ta voiture n’a rien, c’était pour du beurre).' : 'Tour non bouclé : rien n’est enregistré.';
    tone = outcome.exploded ? 'boom' : 'lose';
  } else if (result.newRecord) {
    big = 'Nouveau record !';
    sub = previous ? `${delta(run.time - previous.time)} sur l’ancien record. Ton fantôme t’attend.` : 'Premier chrono posé : ton fantôme roulera avec toi la prochaine fois.';
    tone = 'win';
  } else {
    big = raceTime(run.time);
    sub = previous ? `${delta(run.time - previous.time)} sur ton record. Encore un effort.` : '';
    tone = 'meh';
  }

  const facts = [
    run ? `<span>⏱️ ${esc(raceTime(run.time))}</span>` : '',
    run?.bestLap === undefined ? '' : `<span>⚡ Meilleur tour ${esc(raceTime(run.bestLap))}</span>`,
    `<span>🚀 Pointe à ${esc(num(outcome.topSpeedKmh))} km/h</span>`,
    `<span>${WEATHER_LABEL[result.weather]}</span>`,
  ].join('');

  const record = result.newRecord ? run : previous;
  const recordBlock = `
    <div class="result-block">
      <p class="kicker">Record</p>
      <p class="trial-big">${recordLine(record)}</p>
      ${result.newRecord && !result.saved ? '<p class="warn">Le navigateur n’a pas pu l’enregistrer (stockage plein ou navigation privée).</p>' : ''}
    </div>`;

  return `
    <section class="screen result-screen tone-${tone}" style="${backdropStyle(district.image)}">
      <div class="result-card">
        <header class="result-head">
          <p class="kicker">Chrono · ${esc(district.name)}</p>
          <h1>${esc(big)}</h1>
          ${sub ? `<p class="result-sub">${esc(sub)}</p>` : ''}
          <div class="result-facts">${facts}</div>
        </header>
        ${recordBlock}
        <footer class="result-actions">
          ${button({ action: 'trial-back', label: 'Retour au quartier', variant: 'ghost' })}
          ${button({ action: 'time-trial', label: '↻ Rejouer', data: { weather: result.weather }, variant: 'primary' })}
        </footer>
      </div>
    </section>`;
}
