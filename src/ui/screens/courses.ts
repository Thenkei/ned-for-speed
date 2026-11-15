import {
  activeCar,
  effectiveStats,
  eligibleStakes,
  isBossAvailable,
  isDistrictUnlocked,
  performanceIndex,
  playerRacer,
} from '../../domain/game';
import { jewelKind, swagMultiplier } from '../../domain/jewels';
import type { District, GameState, RaceEvent, RivalSpec } from '../../domain/types';
import { DISTRICTS, districtById, districtIndex } from '../../domain/world';
import { backdropStyle, button, carCanvas, jewelCard, picture } from '../components';
import { esc, euro, num, plural } from '../dom';
import type { View } from '../view';

// ───────────────────────── Helpers ─────────────────────────

interface Difficulty {
  readonly label: string;
  readonly tone: 'easy' | 'fair' | 'hot' | 'insane';
}

/** Compares the strongest rival to the player's current car. */
export function difficulty(playerPi: number, rivals: readonly RivalSpec[]): Difficulty {
  const strongest = Math.max(...rivals.map((r) => performanceIndex(r.stats)));
  const gap = strongest - playerPi;
  if (gap <= -6) return { label: 'Promenade', tone: 'easy' };
  if (gap <= 3) return { label: 'Jouable', tone: 'fair' };
  if (gap <= 10) return { label: 'Chaud', tone: 'hot' };
  return { label: 'Suicidaire', tone: 'insane' };
}

function playerPi(game: GameState): number {
  return performanceIndex(effectiveStats(game, activeCar(game)));
}

/** What the event actually pays right now (repeat penalty + swag bonus). */
export function effectivePrize(game: GameState, event: RaceEvent): number {
  const repeat = (game.eventWins[event.id] ?? 0) > 0 ? 0.6 : 1;
  return Math.round(event.prize * repeat * swagMultiplier(game.jewels));
}

function previousBossName(district: District): string {
  const previous = DISTRICTS[districtIndex(district.id) - 1];
  return previous ? previous.boss.name : '';
}

// ───────────────────────── Courses tab ─────────────────────────

function districtCard(game: GameState, district: District, selected: boolean): string {
  const unlocked = isDistrictUnlocked(game, district);
  const beaten = game.bossesBeaten.includes(district.boss.id);
  const won = district.events.filter((e) => (game.eventWins[e.id] ?? 0) > 0).length;
  const status = !unlocked
    ? `<span class="tag lock">🔒 Bats ${esc(previousBossName(district))}</span>`
    : beaten
      ? '<span class="tag gold">👑 Quartier conquis</span>'
      : `<span class="tag">${won}/${district.events.length} courses</span>`;
  return `
    <button type="button" class="district-card${selected ? ' on' : ''}${unlocked ? '' : ' locked'}"
      data-action="district" data-id="${esc(district.id)}" style="${backdropStyle(district.image)}"
      aria-pressed="${selected}">
      <span class="district-num">${districtIndex(district.id) + 1}</span>
      <span class="district-name">${esc(district.name)}</span>
      ${status}
    </button>`;
}

function eventCard(game: GameState, event: RaceEvent, pi: number): string {
  const wins = game.eventWins[event.id] ?? 0;
  const level = difficulty(pi, event.rivals);
  const wonBadge = wins > 0 ? `<span class="tag won">✓ ×${wins}</span>` : '';
  const repeatNote = wins > 0 ? '<span class="event-note">Déjà gagnée : prime réduite, respect symbolique.</span>' : '';
  const cannotPay = game.money < event.entryFee;
  return `
    <article class="event${wins > 0 ? ' done' : ''}">
      <div class="event-main">
        <h4>${esc(event.name)} ${wonBadge}</h4>
        <p>${esc(event.blurb)}</p>
        <div class="event-meta">
          <span>🔁 ${esc(plural(event.laps, 'tour'))}</span>
          <span>🚗 ${esc(plural(event.rivals.length, 'rival', 'rivaux'))}</span>
          <span class="${cannotPay ? 'warn' : ''}">🎟️ ${event.entryFee === 0 ? 'Gratuit' : esc(euro(event.entryFee))}</span>
          <span class="prize">💶 ${esc(euro(effectivePrize(game, event)))}</span>
          <span>✊ +${esc(wins > 0 ? Math.max(1, Math.round(event.respect * 0.2)) : event.respect)}</span>
        </div>
        ${repeatNote}
      </div>
      <div class="event-side">
        <span class="difficulty ${level.tone}" title="Force du meilleur rival comparée à ta voiture">${esc(level.label)}</span>
        ${button({ action: 'open-event', label: 'S’inscrire', data: { id: event.id }, variant: 'primary', dim: cannotPay })}
      </div>
    </article>`;
}

function bossCard(game: GameState, district: District, pi: number): string {
  const boss = district.boss;
  const beaten = game.bossesBeaten.includes(boss.id);
  const available = isBossAvailable(game, district);
  const won = district.events.filter((e) => (game.eventWins[e.id] ?? 0) > 0).length;
  const trophy = jewelKind(boss.trophyKindId);
  const stakes = eligibleStakes(game, boss).length;
  const level = difficulty(pi, [boss.rival]);

  let action: string;
  if (!available) {
    action = `<span class="boss-lock">🔒 Gagne les ${district.events.length} courses du quartier (${won}/${district.events.length})</span>`;
  } else {
    const label = beaten ? 'Revanche' : '⚔️ Défier';
    action = `
      <span class="difficulty ${level.tone}">${esc(level.label)}</span>
      ${button({ action: 'open-boss', label, variant: beaten ? 'ghost' : 'gold', dim: stakes === 0 })}
      ${stakes === 0 ? `<span class="boss-lock">Il te faut un bijou d’au moins ${esc(euro(boss.minStake))} (voir Bijouterie).</span>` : ''}`;
  }

  return `
    <article class="boss-card${beaten ? ' beaten' : ''}${available ? '' : ' locked'}">
      ${picture(boss.portrait, boss.name, 'boss-portrait', '👑')}
      <div class="boss-info">
        <p class="kicker gold">Le boss du quartier${beaten ? ' · <span class="tag gold">Battu ✓</span>' : ''}</p>
        <h4>${esc(boss.name)}</h4>
        <p class="boss-title">${esc(boss.title)}</p>
        <div class="event-meta">
          <span>🔁 ${esc(plural(boss.laps, 'tour'))} en duel</span>
          <span>💍 Mise mini ${esc(euro(boss.minStake))}</span>
          <span class="prize">💶 ${esc(euro(boss.prize * (beaten ? 0.3 : 1) * swagMultiplier(game.jewels)))}</span>
          <span>✊ +${esc(num(beaten ? Math.round(boss.respect * 0.1) : boss.respect))}</span>
        </div>
        <p class="boss-trophy">${beaten ? 'Trophée déjà raflé' : 'À gagner'} : <strong>${esc(trophy.icon)} ${esc(trophy.name)}</strong> (swag +${trophy.swag})</p>
      </div>
      <div class="boss-action">${action}</div>
    </article>`;
}

function districtDetail(game: GameState, district: District): string {
  const unlocked = isDistrictUnlocked(game, district);
  const pi = playerPi(game);
  const body = unlocked
    ? `
      <div class="events">${district.events.map((e) => eventCard(game, e, pi)).join('')}</div>
      ${bossCard(game, district, pi)}`
    : `
      <div class="locked-panel">
        <span class="locked-icon">🔒</span>
        <p>Ici, personne ne te connaît encore.</p>
        <p><strong>Bats ${esc(previousBossName(district))} pour débloquer ce quartier.</strong></p>
      </div>`;
  return `
    <section class="district-detail">
      <div class="district-hero" style="${backdropStyle(district.image)}">
        <div class="district-hero-text">
          <p class="kicker">Quartier ${districtIndex(district.id) + 1} / ${DISTRICTS.length}</p>
          <h3>${esc(district.name)}</h3>
          <p>${esc(district.blurb)}</p>
        </div>
      </div>
      ${body}
    </section>`;
}

export function renderCourses(view: View): string {
  const { game, ui } = view;
  const selected = districtById(ui.districtId);
  const car = activeCar(game);
  const engineWarning =
    car.condition <= 0
      ? `<div class="banner danger">💥 Ton moteur est HS. Impossible de courir : passe au ${button({ action: 'tab', label: 'Garage', data: { tab: 'garage' }, variant: 'ghost', small: true })}</div>`
      : car.condition < 45
        ? `<div class="banner warn">🌡️ Moteur fatigué (${Math.round(car.condition)} %) : la zone rouge arrive plus tôt. Un tour au ${button({ action: 'tab', label: 'Garage', data: { tab: 'garage' }, variant: 'ghost', small: true })} ne ferait pas de mal.</div>`
        : '';
  return `
    ${engineWarning}
    <div class="courses">
      <aside class="districts" data-scroll="districts">
        ${DISTRICTS.map((d) => districtCard(game, d, d.id === selected.id)).join('')}
      </aside>
      ${districtDetail(game, selected)}
    </div>`;
}

// ───────────────────────── Pre-race ─────────────────────────

function racerCard(name: string, pi: number, canvas: string, note: string, isPlayer = false): string {
  return `
    <div class="racer${isPlayer ? ' me' : ''}">
      ${canvas}
      <div class="racer-name">${esc(name)}</div>
      <div class="racer-pi">Indice ${esc(pi)}</div>
      ${note ? `<div class="racer-note">${esc(note)}</div>` : ''}
    </div>`;
}

function rivalNote(rival: RivalSpec): string {
  if (rival.recklessness >= 0.6) return 'Tête brûlée du nitro';
  if (rival.skill >= 0.88) return 'Pilote propre';
  if (rival.skill < 0.76) return 'Freine au pif';
  return '';
}

function rivalCard(rival: RivalSpec): string {
  const look = { body: rival.body, paint: rival.paint, neon: rival.neon, spoiler: rival.spoiler };
  return racerCard(rival.name, performanceIndex(rival.stats), carCanvas(look, 'small', 260, 140), rivalNote(rival));
}

export function controlsHelp(): string {
  return `
    <div class="controls">
      <h4>Commandes</h4>
      <ul>
        <li><kbd>↑</kbd> / <kbd>W</kbd> <span>Accélérer</span></li>
        <li><kbd>↓</kbd> / <kbd>S</kbd> <span>Freiner</span></li>
        <li><kbd>←</kbd> <kbd>→</kbd> / <kbd>A</kbd> <kbd>D</kbd> <span>Tourner</span></li>
        <li><kbd>Espace</kbd> / <kbd>Maj</kbd> <span>Nitro</span></li>
        <li><kbd>R</kbd> <span>Revenir sur la route</span></li>
        <li><kbd>Échap</kbd> <span>Pause</span></li>
      </ul>
      <p class="nitro-warning">
        🔥 Le nitro fait grimper la température. Dans la zone rouge, chaque seconde est un coup de dés&nbsp;:
        le moteur peut <strong>exploser</strong>. Relâche, laisse refroidir, recommence.
      </p>
    </div>`;
}

export function renderPreRace(view: View): string {
  const { game, ui } = view;
  const district = districtById(ui.districtId);
  const event = district.events.find((e) => e.id === ui.eventId);
  if (!event) return '';
  const me = playerRacer(game);
  const level = difficulty(performanceIndex(me.stats), event.rivals);
  const fee = event.entryFee === 0 ? 'Inscription gratuite' : `Inscription ${euro(event.entryFee)}`;
  return `
    <section class="screen prerace-screen" style="${backdropStyle(district.image)}">
      <div class="prerace-card">
        <header class="prerace-head">
          <p class="kicker">${esc(district.name)}</p>
          <h2>${esc(event.name)}</h2>
          <p>${esc(event.blurb)}</p>
          <div class="event-meta">
            <span>🔁 ${esc(plural(event.laps, 'tour'))}</span>
            <span>🎟️ ${esc(fee)}</span>
            <span class="prize">💶 ${esc(euro(effectivePrize(game, event)))} au vainqueur</span>
            <span class="difficulty ${level.tone}">${esc(level.label)}</span>
          </div>
        </header>
        <div class="grid-lineup">
          ${racerCard('Ned (toi)', performanceIndex(me.stats), carCanvas(me.look, 'small', 260, 140), 'Part dernier, comme tout challenger', true)}
          ${event.rivals.map(rivalCard).join('')}
        </div>
        ${controlsHelp()}
        <footer class="prerace-actions">
          ${button({ action: 'prerace-back', label: '← Retour', variant: 'ghost' })}
          ${button({ action: 'race-go', label: 'C’est parti ! 🏁', variant: 'primary' })}
        </footer>
      </div>
    </section>`;
}

// ───────────────────────── Boss challenge ─────────────────────────

export function renderBoss(view: View): string {
  const { game, ui } = view;
  const district = districtById(ui.districtId);
  const boss = district.boss;
  const lines = boss.intro;
  const talking = ui.bossStep < lines.length;
  const trophy = jewelKind(boss.trophyKindId);
  const me = playerRacer(game);

  let panel: string;
  if (talking) {
    const line = lines[ui.bossStep] ?? '';
    panel = `
      <div class="speech">
        <p class="speech-name">${esc(boss.name)}</p>
        <p class="speech-line">« ${esc(line)} »</p>
        <div class="speech-nav">
          <span class="speech-count">${ui.bossStep + 1} / ${lines.length}</span>
          ${button({ action: 'boss-back', label: '← Filer discrètement', variant: 'ghost' })}
          ${button({ action: 'boss-skip', label: 'Abréger', variant: 'ghost' })}
          ${button({ action: 'boss-next', label: 'Suivant →', variant: 'primary' })}
        </div>
      </div>`;
  } else {
    const stakes = eligibleStakes(game, boss);
    const stakeCards = stakes
      .map((jewel) => {
        const kind = jewelKind(jewel.kindId);
        const selected = jewel.uid === ui.stakeUid;
        return `
          <button type="button" class="stake${selected ? ' on' : ''}" data-action="stake" data-uid="${esc(jewel.uid)}" aria-pressed="${selected}">
            <span class="stake-icon">${esc(kind.icon)}</span>
            <span class="stake-name">${esc(kind.name)}</span>
            <span class="stake-value">${esc(euro(kind.value))} · swag +${kind.swag}</span>
          </button>`;
      })
      .join('');
    const beaten = game.bossesBeaten.includes(boss.id);
    panel = `
      <div class="stake-panel">
        <h3>Qu’est-ce que tu poses sur le capot ?</h3>
        <p class="stake-rule">Mise minimum : un bijou d’au moins <strong>${esc(euro(boss.minStake))}</strong>. Si tu perds — ou si ton moteur explose — il est pour ${esc(boss.name)}.</p>
        <div class="stake-columns">
          <div class="stake-col risk">
            <p class="kicker danger">Ce que tu risques</p>
            <div class="stake-list">${stakeCards || '<p class="empty">Aucun bijou assez précieux. File chez Momo.</p>'}</div>
          </div>
          <div class="stake-vs">VS</div>
          <div class="stake-col gain">
            <p class="kicker gold">Ce que tu peux gagner</p>
            ${beaten ? '<p class="empty">Tu as déjà son trophée. Reste la prime… et le plaisir.</p>' : jewelCard(trophy, '', 'flat')}
            <p class="stake-prize">+ ${esc(euro(boss.prize * (beaten ? 0.3 : 1) * swagMultiplier(game.jewels)))} · ✊ +${esc(num(beaten ? Math.round(boss.respect * 0.1) : boss.respect))}</p>
          </div>
        </div>
        <div class="duel-lineup">
          <div class="duel-car">${carCanvas(me.look, 'small', 260, 140)}<span>Ned · indice ${performanceIndex(me.stats)}</span></div>
          <div class="duel-car">${carCanvas({ body: boss.rival.body, paint: boss.rival.paint, neon: boss.rival.neon, spoiler: boss.rival.spoiler }, 'small', 260, 140)}<span>${esc(boss.rival.name)} · indice ${performanceIndex(boss.rival.stats)}</span></div>
        </div>
        <div class="speech-nav">
          ${button({ action: 'boss-back', label: '← Je reviendrai', variant: 'ghost' })}
          ${button({ action: 'boss-go', label: `Poser le bijou et rouler (${plural(boss.laps, 'tour')}) 🏁`, variant: 'gold', dim: ui.stakeUid === undefined })}
        </div>
      </div>`;
  }

  return `
    <section class="screen boss-screen" style="${backdropStyle(district.image)}">
      <div class="boss-stage${talking ? '' : ' staking'}">
        <div class="boss-figure">
          ${picture(boss.portrait, boss.name, 'boss-big', '👑')}
          <div class="boss-nameplate">
            <strong>${esc(boss.name)}</strong>
            <span>${esc(boss.title)}</span>
          </div>
        </div>
        ${panel}
      </div>
    </section>`;
}
