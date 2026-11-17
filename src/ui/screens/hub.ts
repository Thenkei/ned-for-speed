import { activeCar } from '../../domain/game';
import { totalSwag } from '../../domain/jewels';
import { respectRank, RESPECT_RANKS } from '../../domain/world';
import { conditionClass } from '../components';
import { esc, euro, num } from '../dom';
import { TAB_LABELS, TABS, type Tab, type View } from '../view';
import { renderCourses } from './courses';
import { renderGarage } from './garage';
import { renderRespect } from './respect';
import { renderDealer, renderJeweler, renderPartsShop } from './shops';

const TAB_RENDERERS: Readonly<Record<Tab, (view: View) => string>> = {
  courses: renderCourses,
  garage: renderGarage,
  pieces: renderPartsShop,
  concession: renderDealer,
  bijouterie: renderJeweler,
  respect: renderRespect,
};

function respectProgress(respect: number): string {
  const next = RESPECT_RANKS.find((rank) => rank.min > respect);
  if (!next) return 'Rang maximum';
  return `Prochain rang à ${num(next.min)}`;
}

function topBar(view: View): string {
  const { game, ui } = view;
  const car = activeCar(game);
  const condition = Math.round(car.condition);
  return `
    <header class="topbar">
      <button type="button" class="brand" data-action="to-title" title="Retour à l’écran titre">
        <span class="brand-ned">Ned</span><span class="brand-rest">for Speed</span>
      </button>
      <div class="pills">
        <div class="pill money" title="Tes thunes">
          <span class="pill-icon">💶</span><span class="pill-value">${esc(euro(game.money))}</span>
        </div>
        <button type="button" class="pill respect" data-action="tab" data-tab="respect" title="${esc(respectProgress(game.respect))} · voir les grands noms">
          <span class="pill-icon">✊</span>
          <span class="pill-value">${esc(num(game.respect))}</span>
          <span class="pill-sub">${esc(respectRank(game.respect).title)}</span>
        </button>
        <div class="pill swag" title="Swag total de tes bijoux : booste tes gains">
          <span class="pill-icon">💎</span><span class="pill-value">${esc(num(totalSwag(game.jewels)))}</span>
          <span class="pill-sub">swag</span>
        </div>
        <button type="button" class="pill engine ${conditionClass(condition)}" data-action="tab" data-tab="garage" title="État du moteur">
          <span class="pill-icon">🛠️</span><span class="pill-value">${condition}&nbsp;%</span>
          <span class="pill-sub">moteur</span>
        </button>
      </div>
      <div class="topbar-actions">
        <button type="button" class="icon-btn gearbox-btn" data-action="toggle-transmission" aria-label="${ui.transmission === 'manual' ? 'Boîte manuelle (E / Q pour passer les rapports) : passer en automatique' : 'Boîte automatique : passer en manuelle'}" title="${ui.transmission === 'manual' ? 'Boîte manuelle · E / Q pour passer les rapports' : 'Boîte automatique · clique pour passer en manuelle'}">${ui.transmission === 'manual' ? 'BVM' : 'BVA'}</button>
        <button type="button" class="icon-btn" data-action="toggle-mute" aria-label="${ui.muted ? 'Activer le son' : 'Couper le son'}" title="${ui.muted ? 'Activer le son' : 'Couper le son'}">${ui.muted ? '🔇' : '🔊'}</button>
        <button type="button" class="icon-btn" data-action="to-title" aria-label="Menu principal" title="Menu principal">⏏</button>
      </div>
    </header>`;
}

function tabBar(view: View): string {
  const tabs = TABS.map((tab) => {
    const { icon, label } = TAB_LABELS[tab];
    const selected = tab === view.ui.tab;
    return `
      <button type="button" role="tab" aria-selected="${selected}" class="tab${selected ? ' on' : ''}" data-action="tab" data-tab="${tab}">
        <span class="tab-icon" aria-hidden="true">${icon}</span>${esc(label)}
      </button>`;
  }).join('');
  return `<nav class="tabs" role="tablist" data-scroll="tabs">${tabs}</nav>`;
}

export function renderHub(view: View): string {
  return `
    <div class="screen hub-screen">
      ${topBar(view)}
      ${tabBar(view)}
      <main class="tab-body tab-${view.ui.tab}">
        ${TAB_RENDERERS[view.ui.tab](view)}
      </main>
    </div>`;
}
