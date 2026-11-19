import { CAR_MODELS } from '../../domain/cars';
import { activeCar, effectiveStats, lookOf, performanceIndex, shopTier, statsWithPart } from '../../domain/game';
import { jewelKind, jewelResaleValue, SHOP_JEWELS, swagMultiplier, totalSwag } from '../../domain/jewels';
import { RARITIES, RARITY_LABELS, type CarLook, type StatKey } from '../../domain/types';
import { DISTRICTS } from '../../domain/world';
import { button, carCanvas, deltaChips, jewelCard, partCard, statBars } from '../components';
import { esc, euro, num } from '../dom';
import type { View } from '../view';

// ───────────────────────── Parts shop ─────────────────────────

export function renderPartsShop(view: View): string {
  const { game } = view;
  const car = activeCar(game);
  const current = effectiveStats(game, car);
  const tier = shopTier(game);
  const tierRarity = RARITIES[tier] ?? 'occasion';

  const cards = game.shop.parts
    .map((part) => {
      const affordable = game.money >= part.price;
      return partCard(part, {
        delta: deltaChips(current, statsWithPart(game, car, part)),
        deltaLabel: 'Sur ta voiture',
        actions: `
          <span class="price${affordable ? '' : ' too-much'}">${esc(euro(part.price))}</span>
          ${button({ action: 'buy-part', label: 'Acheter', data: { uid: part.uid }, variant: 'primary', small: true, dim: !affordable })}`,
      });
    })
    .join('');

  return `
    <div class="shop-head">
      <div class="section-head">
        <p class="kicker">La Casse à Dédé</p>
        <h3>Pièces détachées, garanties jusqu’au portail</h3>
        <p>
          Le stock tourne <strong>après chaque course</strong>&nbsp;: si une pièce te fait de l’œil, c’est maintenant.
          Gamme du moment&nbsp;: <span class="rarity-text rarity-${tierRarity}">${esc(RARITY_LABELS[tierRarity])}</span>.
          Plus tu bats de boss, plus Dédé sort les belles pièces de l’arrière-boutique.
        </p>
      </div>
      <div class="rarity-legend">
        ${RARITIES.map((r) => `<span class="rarity-text rarity-${r}">● ${esc(RARITY_LABELS[r])}</span>`).join('')}
      </div>
    </div>
    <div class="part-grid">
      ${cards || '<p class="empty">Tu as tout raflé. Reviens après la prochaine course, Dédé aura refait le plein.</p>'}
    </div>
    <p class="hint center">Les pièces achetées vont dans ton coffre : monte-les depuis le ${button({ action: 'tab', label: 'Garage', data: { tab: 'garage' }, variant: 'ghost', small: true })}</p>`;
}

// ───────────────────────── Car dealer ─────────────────────────

const DEALER_STATS: readonly StatKey[] = ['topSpeed', 'accel', 'handling', 'reliability'];

export function renderDealer(view: View): string {
  const { game } = view;
  const cards = CAR_MODELS.map((model) => {
    const owned = game.cars.find((car) => car.modelId === model.id);
    const active = owned?.uid === game.activeCarUid;
    const look: CarLook = owned
      ? lookOf(owned)
      : { body: model.body, paint: model.defaultPaint, neon: '', spoiler: false };
    const affordable = game.money >= model.price;

    let action: string;
    if (active) action = '<span class="tag gold">🔑 Au volant</span>';
    else if (owned) action = `<span class="tag won">Possédée</span>${button({ action: 'select-car', label: 'Choisir', data: { uid: owned.uid }, variant: 'cyan', small: true })}`;
    else action = `${button({ action: 'buy-car', label: 'Acheter', data: { id: model.id }, variant: 'primary', small: true, dim: !affordable })}`;

    const missing = !owned && !affordable ? `<span class="hint">Il te manque ${esc(euro(model.price - game.money))}</span>` : '';

    return `
      <article class="dealer-card${owned ? ' owned' : ''}${active ? ' active' : ''}">
        ${carCanvas(look, 'dealer', 420, 220)}
        <div class="dealer-body">
          <p class="kicker">${esc(model.brand)}</p>
          <h4>${esc(model.name)} <span class="pi-mini" title="Indice de performance d’origine">${performanceIndex(model.base)}</span></h4>
          <p class="dealer-tagline">${esc(model.tagline)}</p>
          ${statBars(model.base, { keys: DEALER_STATS })}
          <div class="dealer-foot">
            <span class="price${owned || affordable ? '' : ' too-much'}">${model.price === 0 ? 'Héritage de mamie' : esc(euro(model.price))}</span>
            <div class="dealer-actions">${action}</div>
          </div>
          ${missing}
        </div>
      </article>`;
  }).join('');

  return `
    <div class="section-head">
      <p class="kicker">Concession « Auto Prestige 2000 »</p>
      <h3>Des occasions comme neuves. Enfin, comme occasions.</h3>
      <p>
        Une nouvelle voiture arrive <strong>nue</strong>&nbsp;: pense à transférer tes pièces depuis le garage.
        Tu gardes toutes tes voitures, et tu changes quand tu veux.
      </p>
    </div>
    <div class="dealer-grid">${cards}</div>`;
}

// ───────────────────────── Jeweler ─────────────────────────

export function renderJeweler(view: View): string {
  const { game } = view;
  const swag = totalSwag(game.jewels);
  const bonus = Math.round((swagMultiplier(game.jewels) - 1) * 100);
  const nextBoss = DISTRICTS.find((d) => !game.bossesBeaten.includes(d.boss.id))?.boss;

  const owned = game.jewels
    .slice()
    .sort((a, b) => jewelKind(b.kindId).value - jewelKind(a.kindId).value)
    .map((jewel) => {
      const kind = jewelKind(jewel.kindId);
      const actions = kind.trophy
        ? '<span class="hint">Un trophée, ça ne se vend pas.</span>'
        : button({ action: 'sell-jewel', label: `Revendre ${esc(euro(jewelResaleValue(kind)))}`, data: { uid: jewel.uid }, variant: 'ghost', small: true });
      const stakeable = nextBoss !== undefined && kind.value >= nextBoss.minStake;
      return jewelCard(kind, actions, stakeable ? 'stakeable' : '');
    })
    .join('');

  const shop = SHOP_JEWELS.map((kind) => {
    const affordable = game.money >= kind.value;
    return jewelCard(
      kind,
      `<span class="price${affordable ? '' : ' too-much'}">${esc(euro(kind.value))}</span>
       ${button({ action: 'buy-jewel', label: 'Acheter', data: { id: kind.id }, variant: 'gold', small: true, dim: !affordable })}`,
    );
  }).join('');

  const bossHint = nextBoss
    ? `Prochain boss&nbsp;: <strong>${esc(nextBoss.name)}</strong> exige une mise d’au moins <strong>${esc(euro(nextBoss.minStake))}</strong>. Les bijoux entourés d’or font l’affaire.`
    : 'Tu as battu tous les boss. Il ne reste qu’à briller.';

  return `
    <div class="section-head">
      <p class="kicker">Bijouterie « Chez Momo »</p>
      <h3>L’or, c’est comme le nitro : jamais trop</h3>
    </div>
    <div class="jeweler-explain">
      <div class="explain-card">
        <span class="explain-big">+${bonus}&nbsp;%</span>
        <p><strong>Le swag, ça paie.</strong> Chaque point de swag ajoute 1&nbsp;% à tes gains de course (jusqu’à +100&nbsp;%). Tu en as <strong>${esc(num(swag))}</strong>.</p>
      </div>
      <div class="explain-card">
        <span class="explain-big">⚔️</span>
        <p><strong>Les boss ne courent pas pour de l’argent.</strong> On pose un bijou sur le capot&nbsp;: le vainqueur repart avec les deux. ${bossHint}</p>
      </div>
    </div>
    <div class="jeweler">
      <section>
        <h4 class="list-title">Ta quincaillerie <span>${game.jewels.length}</span></h4>
        <div class="jewel-list">${owned || '<p class="empty">Rien autour du cou. Même pas une gourmette. C’est triste.</p>'}</div>
      </section>
      <section>
        <h4 class="list-title">La vitrine de Momo</h4>
        <div class="jewel-list">${shop}</div>
        <p class="hint">Momo reprend tout à 60&nbsp;% de la valeur. « C’est le marché, mon frère. »</p>
      </section>
    </div>`;
}
