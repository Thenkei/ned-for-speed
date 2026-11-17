import { jewelKind, totalSwag } from '../../domain/jewels';
import type { GameState } from '../../domain/types';
import { DISTRICTS, respectRank } from '../../domain/world';
import { backdropStyle, button, picture } from '../components';
import { esc, euro, num } from '../dom';
import type { UiState, View } from '../view';

// ───────────────────────── Title ─────────────────────────

export function renderTitle(ui: Readonly<UiState>): string {
  const continueButton = ui.hasSave
    ? button({ action: 'title-continue', label: '▶ Continuer', variant: 'primary' })
    : '';
  return `
    <section class="screen title-screen" style="${backdropStyle('assets/title.jpg')}">
      <div class="title-shade"></div>
      <div class="title-content">
        <p class="title-kicker">Un jeu de tuning, de bitume et de mauvais goût</p>
        <h1 class="logo" aria-label="Ned for Speed">
          <span class="logo-ned">Ned</span>
          <span class="logo-rest">for Speed</span>
        </h1>
        <p class="title-tagline">
          Aspirant Jacky cherche respect. Possède&nbsp;: une Biquette 1.1, une gourmette plaquée or
          et beaucoup trop de confiance.
        </p>
        <div class="title-actions">
          ${continueButton}
          ${button({
            action: 'title-new',
            label: ui.hasSave ? 'Nouvelle partie' : '▶ Nouvelle partie',
            variant: ui.hasSave ? 'ghost' : 'primary',
          })}
          ${button({
            action: 'toggle-transmission',
            label: ui.transmission === 'manual' ? '🕹️ Boîte manuelle' : '🕹️ Boîte automatique',
            variant: 'ghost',
          })}
          ${button({
            action: 'toggle-mute',
            label: ui.muted ? '🔇 Son coupé' : '🔊 Son activé',
            variant: 'ghost',
          })}
        </div>
      </div>
      <p class="title-foot">Clavier&nbsp;: flèches ou WASD · Espace = nitro · Marques et modèles 100&nbsp;% inventés</p>
    </section>`;
}

// ───────────────────────── Intro ─────────────────────────

interface IntroPanel {
  readonly kicker: string;
  readonly title: string;
  readonly text: string;
}

export const INTRO_PANELS: readonly IntroPanel[] = [
  {
    kicker: 'Il était une fois…',
    title: '« Ned »',
    text: 'Petit, il n’arrivait pas à prononcer « need ». Ça sortait « Ned ». Il le criait tellement fort à l’arrière de la voiture que tout le quartier a fini par l’appeler comme ça. Le prénom est resté. L’envie de vitesse aussi.',
  },
  {
    kicker: 'Aujourd’hui',
    title: 'Aspirant Jacky',
    text: 'Ned a vingt ans, un survêtement, une casquette et une gourmette plaquée or. Il rêve d’ailerons grands comme des tables à repasser et de néons sous le bas de caisse. Officiellement, il est Jacky. Enfin… aspirant Jacky.',
  },
  {
    kicker: 'L’héritage',
    title: 'La Biquette de mamie',
    text: 'Mamie lui a laissé sa Marcel Biquette 1.1 : 240 000 km, autoradio cassette, odeur de sapin. Tonton Gégé y a bricolé une bouteille de protoxyde. « Appuie pas trop longtemps dessus, gamin. Ça chauffe. Et quand ça chauffe trop, ça pète. »',
  },
  {
    kicker: 'L’objectif',
    title: 'Le respect des cinq grands',
    text: 'Le K, Gros Dédé, Samira « Nitro », le Baron… et tout au bout du Périph’, Jacky Senior, la Légende. Gagne des courses, monte des pièces, mets tes bijoux sur le capot. Quand les cinq te salueront, tu seras quelqu’un.',
  },
];

export function renderIntro(ui: Readonly<UiState>): string {
  const index = Math.max(0, Math.min(INTRO_PANELS.length - 1, ui.introStep));
  const panel = INTRO_PANELS[index];
  if (!panel) return '';
  const last = index === INTRO_PANELS.length - 1;
  const dots = INTRO_PANELS.map(
    (_, i) => `<span class="dot${i === index ? ' on' : ''}${i < index ? ' done' : ''}"></span>`,
  ).join('');
  return `
    <section class="screen intro-screen" style="${backdropStyle('assets/district-parking.jpg')}">
      <div class="intro-card">
        ${picture('assets/ned.jpg', 'Ned, aspirant Jacky', 'intro-portrait', '🧢')}
        <div class="intro-text">
          <p class="kicker">${esc(panel.kicker)}</p>
          <h2>${esc(panel.title)}</h2>
          <p class="intro-body">${esc(panel.text)}</p>
          <div class="intro-nav">
            <div class="dots" aria-label="Étape ${index + 1} sur ${INTRO_PANELS.length}">${dots}</div>
            <div class="intro-buttons">
              ${last ? '' : button({ action: 'intro-skip', label: 'Passer', variant: 'ghost' })}
              ${button({
                action: 'intro-next',
                label: last ? 'Au parking ! 🏁' : 'Suivant →',
                variant: 'primary',
              })}
            </div>
          </div>
        </div>
      </div>
    </section>`;
}

// ───────────────────────── Ending ─────────────────────────

function careerRows(game: GameState): string {
  const trophies = game.jewels.filter((j) => jewelKind(j.kindId).trophy).length;
  const rows: readonly (readonly [string, string])[] = [
    ['Courses disputées', num(game.career.races)],
    ['Victoires', num(game.career.wins)],
    ['Moteurs explosés', num(game.career.explosions)],
    ['Bijoux laissés sur le capot', num(game.career.jewelsLost)],
    ['Trophées de boss', `${num(trophies)} / ${DISTRICTS.length}`],
    ['Voitures au garage', num(game.cars.length)],
    ['Swag total', num(totalSwag(game.jewels))],
    ['Thunes en poche', euro(game.money)],
    ['Respect', `${num(game.respect)} — ${respectRank(game.respect).title}`],
  ];
  return rows
    .map(([label, value]) => `<div class="career-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`)
    .join('');
}

export function renderEnding(view: View): string {
  const bosses = DISTRICTS.map(
    (district) => `
      <figure class="ending-boss">
        ${picture(district.boss.portrait, district.boss.name, 'ending-boss-pic', '👑')}
        <figcaption>${esc(district.boss.name)}<span>« Respect. »</span></figcaption>
      </figure>`,
  ).join('');
  return `
    <section class="screen ending-screen" style="${backdropStyle('assets/district-periph.jpg')}">
      <div class="ending-card">
        <p class="kicker gold">Le Piston en or est à toi</p>
        <h1 class="ending-title">Ned, Légende du tuning</h1>
        <p class="ending-text">
          Le K baisse sa casquette. Gros Dédé t’a serré la main (elle est encore engourdie).
          Samira t’a fait un signe de tête. Le Baron a prononcé ton prénom sans grimacer.
          Et Jacky Senior t’a remis le Piston. Sur le parking du Mégamarché, des gamins
          prononcent déjà « Ned » de travers pour faire comme toi.
        </p>
        <div class="ending-bosses">${bosses}</div>
        <div class="ending-bottom">
          ${picture('assets/ned.jpg', 'Ned', 'ending-ned', '🧢')}
          <div class="career">${careerRows(view.game)}</div>
        </div>
        <div class="ending-actions">
          ${button({ action: 'ending-continue', label: 'Continuer à rouler 🏁', variant: 'gold' })}
        </div>
      </div>
    </section>`;
}
