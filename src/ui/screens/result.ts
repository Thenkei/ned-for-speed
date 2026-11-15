import { jewelKind } from '../../domain/jewels';
import { districtById } from '../../domain/world';
import { backdropStyle, button, conditionGauge, jewelCard, partCard, picture } from '../components';
import { esc, euro, num, ordinal, raceTime } from '../dom';
import type { ResultView, View } from '../view';

interface Headline {
  readonly big: string;
  readonly sub: string;
  readonly tone: 'win' | 'meh' | 'lose' | 'boom';
}

function headline(result: ResultView): Headline {
  const { report } = result;
  if (report.exploded) {
    return { big: '💥 Boum.', sub: 'Ton moteur a explosé ! Tu as trop tiré sur le nitro.', tone: 'boom' };
  }
  if (report.abandoned) {
    return { big: 'Abandon', sub: 'Tu as levé le pied. Le parking a tout vu.', tone: 'lose' };
  }
  if (report.won) {
    return {
      big: 'Victoire !',
      sub: report.kind === 'boss' ? 'Le boss mord la poussière.' : `1er sur ${report.racers}. Ça, c’est du pilotage.`,
      tone: 'win',
    };
  }
  const position = `${ordinal(report.position)} sur ${report.racers}`;
  if (report.kind === 'boss') return { big: 'Défaite', sub: 'En duel, deuxième, c’est dernier.', tone: 'lose' };
  return report.position <= 3
    ? { big: position, sub: 'Pas ridicule. Mais pas premier.', tone: 'meh' }
    : { big: position, sub: 'Le pot d’échappement des autres, tu le connais par cœur.', tone: 'lose' };
}

function standingsTable(result: ResultView): string {
  const rows = result.outcome.standings
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((standing) => {
      const time = standing.exploded
        ? '💥 Moteur explosé'
        : standing.time === undefined
          ? 'Non classé'
          : raceTime(standing.time);
      return `
        <li class="${standing.isPlayer ? 'me' : ''}${standing.exploded ? ' out' : ''}">
          <span class="pos">${esc(standing.position)}</span>
          <span class="who">${esc(standing.name)}</span>
          <span class="time">${esc(time)}</span>
        </li>`;
    })
    .join('');
  return `<ol class="standings">${rows}</ol>`;
}

function rewardLine(icon: string, label: string, value: string, tone = ''): string {
  return `<div class="reward ${tone}"><span class="reward-icon">${icon}</span><span class="reward-label">${label}</span><strong>${value}</strong></div>`;
}

export function renderResult(view: View): string {
  const result = view.ui.result;
  if (!result) return '';
  const { report, outcome } = result;
  const district = districtById(result.districtId);
  const boss = result.bossId === undefined ? undefined : district.boss;
  const head = headline(result);

  const rewards: string[] = [];
  if (report.prize > 0) rewards.push(rewardLine('💶', 'Prime', `+${esc(euro(report.prize))}`, 'good'));
  else rewards.push(rewardLine('💶', 'Prime', 'Rien du tout', 'muted'));
  if (report.entryFee > 0) rewards.push(rewardLine('🎟️', 'Inscription', `−${esc(euro(report.entryFee))}`, 'bad'));
  if (report.respect > 0) rewards.push(rewardLine('✊', report.firstWin ? 'Respect' : 'Respect (déjà gagnée)', `+${esc(num(report.respect))}`, 'good'));

  const lootBlock = report.loot
    ? `
      <div class="result-block loot rarity-${report.loot.rarity}">
        <p class="kicker">🎁 Butin : le perdant t’a laissé une pièce</p>
        ${partCard(report.loot, { compact: true })}
      </div>`
    : '';

  const wear = Math.max(0, Math.round(report.conditionBefore - report.conditionAfter));
  const engineBlock = report.exploded
    ? `
      <div class="result-block engine boom">
        <p class="kicker danger">💥 Ton moteur a explosé !</p>
        ${conditionGauge(report.conditionAfter)}
        <p>Il faut passer au garage avant la prochaine course. Si tu es à sec, Tonton Gégé te le rafistolera contre ce qu’il te reste.</p>
      </div>`
    : wear > 0
      ? `
      <div class="result-block engine">
        <p class="kicker">🌡️ Usure moteur : −${wear} point${wear > 1 ? 's' : ''}</p>
        ${conditionGauge(report.conditionAfter)}
        <p>Rouler dans le rouge, ça laisse des traces. Un moteur fatigué surchauffe plus tôt.</p>
      </div>`
      : '';

  let jewelBlock = '';
  if (boss && report.jewelWon) {
    jewelBlock = `
      <div class="result-block jewel-won">
        <p class="kicker gold">🏆 Trophée gagné</p>
        ${jewelCard(jewelKind(report.jewelWon.kindId), '', 'flat')}
      </div>`;
  } else if (boss && report.jewelLost) {
    jewelBlock = `
      <div class="result-block jewel-lost">
        <p class="kicker danger">💔 Bijou perdu</p>
        ${jewelCard(jewelKind(report.jewelLost.kindId), '', 'flat')}
        <p>Il brille maintenant au poignet de ${esc(boss.name)}.</p>
      </div>`;
  }

  const bossQuote = boss
    ? `
      <div class="result-quote">
        ${picture(boss.portrait, boss.name, 'quote-portrait', '👑')}
        <blockquote>
          <p>« ${esc(report.won ? boss.onWin : boss.onLose)} »</p>
          <cite>${esc(boss.name)}</cite>
        </blockquote>
      </div>`
    : '';

  const unlocked =
    report.unlockedDistrictId === undefined ? undefined : districtById(report.unlockedDistrictId);
  const unlockBlock = unlocked
    ? `
      <div class="result-block unlock" style="${backdropStyle(unlocked.image)}">
        <p class="kicker">🔓 Nouveau quartier débloqué</p>
        <h4>${esc(unlocked.name)}</h4>
        <p>${esc(unlocked.blurb)}</p>
      </div>`
    : '';

  const facts = [
    outcome.abandoned || outcome.exploded ? '' : `<span>⏱️ ${esc(raceTime(outcome.time))}</span>`,
    outcome.bestLap === undefined ? '' : `<span>⚡ Meilleur tour ${esc(raceTime(outcome.bestLap))}</span>`,
    `<span>🚀 Pointe à ${esc(num(outcome.topSpeedKmh))} km/h</span>`,
  ].join('');

  const actions = report.gameCompleted
    ? button({ action: 'result-ending', label: 'La consécration →', variant: 'gold' })
    : `
      ${report.conditionAfter < 100 ? button({ action: 'result-garage', label: '🔧 Au garage', variant: report.exploded ? 'cyan' : 'ghost' }) : ''}
      ${button({ action: 'result-continue', label: 'Retour au quartier →', variant: 'primary' })}`;

  return `
    <section class="screen result-screen tone-${head.tone}" style="${backdropStyle(district.image)}">
      <div class="result-card">
        <header class="result-head">
          <p class="kicker">${esc(result.title)} · ${esc(district.name)}</p>
          <h1>${esc(head.big)}</h1>
          <p class="result-sub">${esc(head.sub)}</p>
          <div class="result-facts">${facts}</div>
        </header>
        ${bossQuote}
        <div class="result-columns">
          <div class="result-col">
            <div class="result-block rewards">${rewards.join('')}</div>
            ${jewelBlock}
            ${lootBlock}
            ${unlockBlock}
          </div>
          <div class="result-col">
            <div class="result-block">
              <p class="kicker">Classement</p>
              ${standingsTable(result)}
            </div>
            ${engineBlock}
          </div>
        </div>
        <footer class="result-actions">${actions}</footer>
      </div>
    </section>`;
}
