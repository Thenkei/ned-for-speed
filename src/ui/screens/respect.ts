import { isBossAvailable, isDistrictUnlocked } from '../../domain/game';
import { jewelKind } from '../../domain/jewels';
import type { District } from '../../domain/types';
import { DISTRICTS, RESPECT_RANKS, respectRank } from '../../domain/world';
import { button, picture } from '../components';
import { esc, num } from '../dom';
import type { View } from '../view';

/**
 * "Les grands noms": the end goal of the game on one page — who already
 * respects Ned, who still looks down on him, and what stands in between.
 */

type Standing = 'respect' | 'ready' | 'climbing' | 'unknown';

function standingOf(view: View, district: District): Standing {
  const { game } = view;
  if (game.bossesBeaten.includes(district.boss.id)) return 'respect';
  if (!isDistrictUnlocked(game, district)) return 'unknown';
  return isBossAvailable(game, district) ? 'ready' : 'climbing';
}

const STANDING_LABEL: Readonly<Record<Standing, string>> = {
  respect: '✊ Te respecte',
  ready: '🔥 Prêt à être défié',
  climbing: '😒 Te snobe',
  unknown: '🔒 Ne sait pas que tu existes',
};

function bossCard(view: View, district: District): string {
  const { game } = view;
  const boss = district.boss;
  const standing = standingOf(view, district);
  const trophy = jewelKind(boss.trophyKindId);
  const wonEvents = district.events.filter((event) => (game.eventWins[event.id] ?? 0) > 0).length;

  let quote: string;
  let todo: string;
  switch (standing) {
    case 'respect':
      quote = boss.onWin;
      todo = `Trophée : ${trophy.icon} ${trophy.name}`;
      break;
    case 'ready':
      quote = boss.intro[boss.intro.length - 1] ?? '';
      todo = `Pose un bijou d’au moins ${num(boss.minStake)} € sur le capot et bats-le.`;
      break;
    case 'climbing':
      quote = boss.intro[0] ?? '';
      todo = `Gagne les courses du quartier (${wonEvents}/${district.events.length}) pour avoir le droit de le défier.`;
      break;
    case 'unknown':
      quote = '…';
      todo = 'Fais-toi d’abord un nom dans le quartier précédent.';
      break;
  }

  const action =
    standing === 'unknown'
      ? ''
      : button({
          action: 'goto-district',
          label: standing === 'respect' ? 'Revoir le quartier' : 'Aller au quartier →',
          variant: standing === 'ready' ? 'gold' : 'ghost',
          small: true,
          data: { id: district.id },
        });

  return `
    <article class="name-card is-${standing}">
      ${picture(boss.portrait, boss.name, 'name-portrait', '👤')}
      <div class="name-body">
        <p class="name-status">${esc(STANDING_LABEL[standing])}</p>
        <h3>${esc(standing === 'unknown' ? '???' : boss.name)}</h3>
        <p class="name-title">${esc(boss.title)} · ${esc(district.name)}</p>
        <p class="name-quote">« ${esc(quote)} »</p>
        <p class="name-todo">${esc(todo)}</p>
        ${action}
      </div>
    </article>`;
}

function rankLadder(respect: number): string {
  const current = respectRank(respect);
  const next = RESPECT_RANKS.find((rank) => rank.min > respect);
  const from = current.min;
  const to = next?.min ?? Math.max(respect, from + 1);
  const ratio = next ? Math.max(0, Math.min(1, (respect - from) / (to - from))) : 1;
  const steps = RESPECT_RANKS.map((rank) => {
    const reached = respect >= rank.min;
    return `<li class="${reached ? 'reached' : ''}${rank === current ? ' current' : ''}"><span>${esc(rank.title)}</span><small>${esc(num(rank.min))}</small></li>`;
  }).join('');
  return `
    <div class="panel rank-panel">
      <div class="rank-head">
        <div>
          <p class="kicker">Ta réputation</p>
          <h3>${esc(current.title)}</h3>
        </div>
        <p class="rank-points"><strong>${esc(num(respect))}</strong> ✊ ${next ? `· encore ${esc(num(next.min - respect))} avant « ${esc(next.title)} »` : '· rang maximum'}</p>
      </div>
      <div class="rank-track"><span style="width:${(ratio * 100).toFixed(1)}%"></span></div>
      <ol class="rank-steps">${steps}</ol>
    </div>`;
}

export function renderRespect(view: View): string {
  const { game } = view;
  const count = game.bossesBeaten.length;
  const total = DISTRICTS.length;
  const headline =
    count === total
      ? 'Tous les grands noms te respectent. Tu ES le tuning.'
      : count === 0
        ? 'Pour l’instant, personne ne connaît ton prénom. Même pas le vigile.'
        : `${count} sur ${total}. Les autres font encore semblant de ne pas te voir.`;
  return `
    <section class="respect-head">
      <p class="kicker gold">Le but du jeu</p>
      <h2>Être respecté par tous les grands noms</h2>
      <p class="respect-sub">${esc(headline)}</p>
      <div class="respect-meter" role="img" aria-label="${count} grands noms sur ${total} te respectent">
        ${DISTRICTS.map((d) => `<span class="${game.bossesBeaten.includes(d.boss.id) ? 'on' : ''}"></span>`).join('')}
      </div>
    </section>
    ${rankLadder(game.respect)}
    <section class="names-grid">
      ${DISTRICTS.map((district) => bossCard(view, district)).join('')}
    </section>`;
}
