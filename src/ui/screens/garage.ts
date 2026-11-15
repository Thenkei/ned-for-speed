import { carModel, NEON_PRICE, NEONS, PAINT_JOB_PRICE, PAINTS } from '../../domain/cars';
import { engineSpecFrom, nitroProfile } from '../../domain/engine';
import {
  activeCar,
  effectiveStats,
  partByUid,
  partOwnerCar,
  performanceIndex,
  repairCost,
  statsWithPart,
} from '../../domain/game';
import { partResaleValue, RARITY_ORDER } from '../../domain/parts';
import {
  SLOT_ICONS,
  SLOT_LABELS,
  SLOTS,
  type CarLook,
  type GameState,
  type OwnedCar,
  type Part,
  type Slot,
  type Stats,
} from '../../domain/types';
import {
  backdropStyle,
  bonusChips,
  button,
  carCanvas,
  conditionGauge,
  deltaChips,
  partCard,
  statBars,
} from '../components';
import { esc, euro, safeColor } from '../dom';
import type { View } from '../view';

export function lookOf(car: OwnedCar): CarLook {
  return {
    body: carModel(car.modelId).body,
    paint: car.paint,
    neon: car.neon,
    spoiler: car.equipped.spoiler !== undefined,
  };
}

function carSwitcher(game: GameState, active: OwnedCar): string {
  if (game.cars.length < 2) return '';
  const cards = game.cars
    .map((car) => {
      const model = carModel(car.modelId);
      const on = car.uid === active.uid;
      return `
        <button type="button" class="car-chip${on ? ' on' : ''}" data-action="select-car" data-uid="${esc(car.uid)}" aria-pressed="${on}">
          <span class="car-chip-dot" style="background:${safeColor(car.paint, '#888')}"></span>
          <span class="car-chip-name">${esc(model.name)}</span>
          <span class="car-chip-pi">${performanceIndex(effectiveStats(game, car))}</span>
        </button>`;
    })
    .join('');
  return `<div class="car-switcher" data-scroll="car-switcher">${cards}</div>`;
}

function repairBlock(game: GameState, car: OwnedCar): string {
  const cost = repairCost(car);
  let action: string;
  if (car.condition >= 100) {
    action = '<span class="hint">Rien à réparer. Elle ronronne.</span>';
  } else if (game.money >= cost) {
    action = button({ action: 'repair', label: `🔧 Réparer (${esc(euro(cost))})`, variant: 'cyan' });
  } else if (car.condition < 45) {
    action = `
      ${button({ action: 'repair', label: `🩹 Bricolage de Tonton Gégé (${esc(euro(game.money))})`, variant: 'cyan' })}
      <span class="hint">Trop juste pour une vraie réparation (${esc(euro(cost))}). Tonton te la remet à 45&nbsp;% contre tout ce que tu as en poche.</span>`;
  } else {
    action = `
      ${button({ action: 'repair', label: `🔧 Réparer (${esc(euro(cost))})`, variant: 'cyan', dim: true })}
      <span class="hint">Pas assez de thunes pour l’instant. Elle roule encore, va gagner une course.</span>`;
  }
  const dead = car.condition <= 0 ? '<p class="dead-note">💥 Moteur explosé. Interdiction de courir tant qu’il n’est pas réparé.</p>' : '';
  return `
    <div class="panel repair">
      <h4>État du moteur</h4>
      ${conditionGauge(car.condition)}
      ${dead}
      <div class="repair-actions">${action}</div>
    </div>`;
}

function paintBlock(car: OwnedCar): string {
  const paints = PAINTS.map((paint) => {
    const on = paint.hex.toLowerCase() === car.paint.toLowerCase();
    return `<button type="button" class="swatch${on ? ' on' : ''}" data-action="paint" data-hex="${esc(paint.hex)}" title="${esc(paint.name)}" aria-label="Peinture ${esc(paint.name)}" aria-pressed="${on}" style="--c:${safeColor(paint.hex, '#888')}"></button>`;
  }).join('');
  const neons = NEONS.map((neon) => {
    const on = neon.hex.toLowerCase() === car.neon.toLowerCase();
    const none = neon.hex === '';
    return `<button type="button" class="swatch neon${none ? ' none' : ''}${on ? ' on' : ''}" data-action="neon" data-hex="${esc(neon.hex)}" title="${esc(neon.name)}" aria-label="Néon ${esc(neon.name)}" aria-pressed="${on}" style="--c:${safeColor(neon.hex, 'transparent')}">${none ? '∅' : ''}</button>`;
  }).join('');
  return `
    <div class="panel paint">
      <h4>Peinture <span class="price-note">${esc(euro(PAINT_JOB_PRICE))} le coup de pistolet</span></h4>
      <div class="swatches">${paints}</div>
      <h4>Néons de bas de caisse <span class="price-note">${esc(euro(NEON_PRICE))} la pose</span></h4>
      <div class="swatches">${neons}</div>
    </div>`;
}

function transferBlock(game: GameState, active: OwnedCar): string {
  const donors = game.cars.filter(
    (car) => car.uid !== active.uid && Object.keys(car.equipped).length > 0,
  );
  if (donors.length === 0) return '';
  const buttons = donors
    .map((car) => {
      const count = Object.keys(car.equipped).length;
      return button({
        action: 'transfer',
        label: `🔁 ${esc(carModel(car.modelId).name)} (${count} pièce${count > 1 ? 's' : ''})`,
        data: { uid: car.uid },
        variant: 'ghost',
        small: true,
      });
    })
    .join('');
  return `
    <div class="panel transfer">
      <h4>Transférer les pièces depuis…</h4>
      <p class="hint">Tout ce qui est monté sur l’autre voiture passe sur celle-ci (les pièces sont universelles, merci le scotch).</p>
      <div class="transfer-buttons">${buttons}</div>
    </div>`;
}

function slotRow(game: GameState, car: OwnedCar, slot: Slot): string {
  const uid = car.equipped[slot];
  const part = uid === undefined ? undefined : partByUid(game, uid);
  if (!part) {
    return `
      <div class="slot empty">
        <span class="slot-icon" aria-hidden="true">${SLOT_ICONS[slot]}</span>
        <div class="slot-body">
          <div class="slot-label">${esc(SLOT_LABELS[slot])}</div>
          <div class="slot-part muted">${slot === 'nitro' ? 'Pas de bouteille : pas de nitro' : 'Pièce d’origine'}</div>
        </div>
        ${button({ action: 'filter', label: 'Choisir', data: { slot }, variant: 'ghost', small: true })}
      </div>`;
  }
  return `
    <div class="slot rarity-${part.rarity}">
      <span class="slot-icon" aria-hidden="true">${SLOT_ICONS[slot]}</span>
      <div class="slot-body">
        <div class="slot-label">${esc(SLOT_LABELS[slot])}</div>
        <div class="slot-part">${esc(part.name)}${part.quirk ? ` <em class="quirk">«&nbsp;${esc(part.quirk)}&nbsp;»</em>` : ''}</div>
        ${bonusChips(part.bonus)}
      </div>
      ${button({ action: 'unequip', label: 'Démonter', data: { slot }, variant: 'ghost', small: true })}
    </div>`;
}

function inventoryBlock(view: View, car: OwnedCar): string {
  const { game, ui } = view;
  const current = effectiveStats(game, car);
  const filter = ui.inventoryFilter;

  const counts = new Map<Slot, number>();
  for (const part of game.inventory) counts.set(part.slot, (counts.get(part.slot) ?? 0) + 1);

  const filterButtons = [
    `<button type="button" class="filter${filter === 'all' ? ' on' : ''}" data-action="filter" data-slot="all">Tout <span>${game.inventory.length}</span></button>`,
    ...SLOTS.map(
      (slot) =>
        `<button type="button" class="filter${filter === slot ? ' on' : ''}" data-action="filter" data-slot="${slot}">${SLOT_ICONS[slot]} ${esc(SLOT_LABELS[slot])} <span>${counts.get(slot) ?? 0}</span></button>`,
    ),
  ].join('');

  const parts: Part[] = game.inventory
    .filter((part) => filter === 'all' || part.slot === filter)
    .slice()
    .sort(
      (a, b) =>
        SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) ||
        RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] ||
        b.price - a.price,
    );

  const cards = parts
    .map((part) => {
      const owner = partOwnerCar(game, part.uid);
      const onThisCar = owner?.uid === car.uid;
      if (onThisCar) {
        return partCard(part, {
          badge: 'Montée',
          actions: button({ action: 'unequip', label: 'Démonter', data: { slot: part.slot }, variant: 'ghost', small: true }),
        });
      }
      const badge = owner ? `Sur ${carModel(owner.modelId).name}` : undefined;
      const actions = [
        button({ action: 'equip', label: owner ? 'Récupérer et monter' : 'Monter', data: { uid: part.uid }, variant: 'primary', small: true }),
        owner
          ? ''
          : button({ action: 'sell-part', label: `Vendre ${esc(euro(partResaleValue(part)))}`, data: { uid: part.uid }, variant: 'ghost', small: true }),
      ].join('');
      return partCard(part, {
        delta: deltaChips(current, statsWithPart(game, car, part)),
        actions,
        ...(badge ? { badge } : {}),
      });
    })
    .join('');

  const empty =
    game.inventory.length === 0
      ? 'Ton coffre est vide. Va voir la Casse à Dédé, ou gagne des courses : les vainqueurs repartent souvent avec une pièce.'
      : 'Rien dans cette catégorie pour l’instant.';

  return `
    <section class="inventory" id="inventory">
      <div class="section-head">
        <h3>Le coffre à pièces</h3>
        <p>Tout ce que tu possèdes, monté ou non. Les chiffres « si montée » comparent avec ta config actuelle.</p>
      </div>
      <div class="filters" data-scroll="filters">${filterButtons}</div>
      <div class="part-grid">${cards || `<p class="empty">${esc(empty)}</p>`}</div>
    </section>`;
}

/** What the nitro/heat model means for this car, in seconds the player can feel. */
function engineReadout(stats: Stats, condition: number): string {
  const profile = nitroProfile(engineSpecFrom(stats, condition));
  const seconds = (value: number): string => `${value.toFixed(1).replace('.', ',')} s`;
  if (profile.tank <= 0) {
    return `<div class="engine-readout none"><p>🧪 Pas de kit nitro monté : aucun risque d’explosion… et aucune chance de doubler en ligne droite.</p></div>`;
  }
  return `
    <div class="engine-readout">
      <div class="readout-cell">
        <strong>${esc(seconds(profile.secondsToRedline))}</strong>
        <span>de nitro d’affilée avant la zone rouge</span>
      </div>
      <div class="readout-cell">
        <strong>${esc(seconds(profile.tank))}</strong>
        <span>de nitro dans la bouteille</span>
      </div>
      <div class="readout-cell danger">
        <strong>${Math.round(profile.redline)}&nbsp;%</strong>
        <span>seuil de la zone rouge</span>
      </div>
      <p class="readout-note">Dans le rouge, chaque seconde peut faire exploser le moteur. La <b>fiabilité</b> repousse la zone rouge ; un moteur usé la rapproche.</p>
    </div>`;
}

export function renderGarage(view: View): string {
  const { game } = view;
  const car = activeCar(game);
  const model = carModel(car.modelId);
  const stats = effectiveStats(game, car);
  return `
    <div class="garage">
      <section class="garage-left">
        <div class="garage-stage" style="${backdropStyle('assets/garage.jpg')}">
          <div class="garage-title">
            <p class="kicker">${esc(model.brand)}</p>
            <h2>${esc(model.name)}</h2>
          </div>
          ${carCanvas(lookOf(car), 'hero', 640, 340)}
          <p class="garage-tagline">${esc(model.tagline)}</p>
        </div>
        ${carSwitcher(game, car)}
        ${repairBlock(game, car)}
        ${paintBlock(car)}
        ${transferBlock(game, car)}
      </section>
      <section class="garage-right">
        <div class="panel stats-panel">
          <div class="pi-head">
            <h4>Fiche technique</h4>
            <div class="pi" title="Indice de performance : un seul chiffre pour comparer les voitures">
              <span>Indice</span><strong>${performanceIndex(stats)}</strong>
            </div>
          </div>
          ${statBars(stats, { base: model.base })}
          <p class="hint">Barre sombre : la voiture d’origine. Barre claire : avec tes pièces.</p>
          ${engineReadout(stats, car.condition)}
        </div>
        <div class="panel slots-panel">
          <h4>Pièces montées</h4>
          <div class="slots">${SLOTS.map((slot) => slotRow(game, car, slot)).join('')}</div>
        </div>
      </section>
    </div>
    ${inventoryBlock(view, car)}`;
}
