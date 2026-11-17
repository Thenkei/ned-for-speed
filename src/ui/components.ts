import { jewelKind } from '../domain/jewels';
import { exhaustBuildOf, turboBuildOf } from '../domain/parts';
import {
  RARITY_LABELS,
  SLOT_ICONS,
  SLOT_LABELS,
  STAT_KEYS,
  STAT_LABELS,
  type CarLook,
  type JewelKind,
  type Part,
  type StatKey,
  type Stats,
} from '../domain/types';
import { exhaustSoundLabel, popsAndBangsLevel, turboSoundLabel } from '../infra/engineProfiles';
import { esc, euro, safeAsset, safeColor, signed } from './dom';

/** Upper bound of the stat bars (a fully legendary Mistral peaks around 125). */
const STAT_BAR_MAX = 130;

const STAT_SHORT: Readonly<Record<StatKey, string>> = {
  topSpeed: 'Vitesse',
  accel: 'Accél.',
  handling: 'Maniab.',
  reliability: 'Fiab.',
  nitro: 'Nitro',
};

const pct = (value: number): number => Math.max(0, Math.min(100, (value / STAT_BAR_MAX) * 100));

export interface StatBarsOptions {
  /** Base stats of the bare car: drawn as a dimmer underlay, bonus shown next to the value. */
  readonly base?: Stats;
  readonly keys?: readonly StatKey[];
}

export function statBars(stats: Stats, options: StatBarsOptions = {}): string {
  const keys = options.keys ?? STAT_KEYS;
  const rows = keys.map((key) => {
    const value = stats[key];
    const base = options.base?.[key];
    const bonus = base === undefined ? 0 : value - base;
    const bonusHtml =
      bonus === 0
        ? ''
        : `<span class="stat-bonus ${bonus > 0 ? 'up' : 'down'}">${esc(signed(bonus))}</span>`;
    const baseFill =
      base === undefined
        ? ''
        : `<span class="stat-fill base" style="width:${pct(Math.min(base, value)).toFixed(1)}%"></span>`;
    return `
      <div class="stat-row stat-${key}">
        <span class="stat-label">${esc(STAT_LABELS[key])}</span>
        <span class="stat-track">
          <span class="stat-fill" style="width:${pct(value).toFixed(1)}%"></span>
          ${baseFill}
        </span>
        <span class="stat-value">${esc(Math.round(value))}${bonusHtml}</span>
      </div>`;
  });
  return `<div class="stat-bars">${rows.join('')}</div>`;
}

/** Chips describing a part's raw bonuses. */
export function bonusChips(bonus: Readonly<Partial<Record<StatKey, number>>>): string {
  const chips = STAT_KEYS.filter((key) => (bonus[key] ?? 0) !== 0).map((key) => {
    const value = bonus[key] ?? 0;
    return `<span class="chip ${value > 0 ? 'up' : 'down'}">${esc(signed(value))} ${esc(STAT_SHORT[key])}</span>`;
  });
  return `<div class="chips">${chips.join('') || '<span class="chip flat">Purement décoratif</span>'}</div>`;
}

/** Chips describing what fitting a part would change on the active car. */
export function deltaChips(current: Stats, next: Stats): string {
  const chips = STAT_KEYS.filter((key) => Math.round(next[key] - current[key]) !== 0).map((key) => {
    const delta = Math.round(next[key] - current[key]);
    return `<span class="chip ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} ${esc(signed(delta))} ${esc(STAT_SHORT[key])}</span>`;
  });
  return chips.join('') || '<span class="chip flat">= Pareil que l’actuelle</span>';
}

export interface PartCardOptions {
  /** HTML of the "if fitted" line (already built with `deltaChips`). */
  readonly delta?: string;
  readonly deltaLabel?: string;
  /** HTML of the action buttons. */
  readonly actions?: string;
  readonly badge?: string;
  readonly compact?: boolean;
}

export function partCard(part: Part, options: PartCardOptions = {}): string {
  const quirk = part.quirk ? ` · <em class="quirk">«&nbsp;${esc(part.quirk)}&nbsp;»</em>` : '';
  const badge = options.badge ? `<span class="part-badge">${esc(options.badge)}</span>` : '';
  const delta =
    options.delta === undefined
      ? ''
      : `<div class="part-delta"><span class="part-delta-label">${esc(options.deltaLabel ?? 'Si montée')}</span>${options.delta}</div>`;
  const actions = options.actions ? `<div class="part-actions">${options.actions}</div>` : '';
  // Turbos and exhausts change how the car sounds: say so, it is half the fun of fitting one.
  const turbo = turboBuildOf(part);
  const exhaust = exhaustBuildOf(part);
  const soundLabel = turbo ? turboSoundLabel(turbo) : exhaust ? exhaustSoundLabel(exhaust) : undefined;
  const loud = (turbo && popsAndBangsLevel(turbo) >= 1) || exhaust?.rarity === 'legende';
  const sound = soundLabel ? `<div class="part-sound${loud ? ' bangs' : ''}">🔊 ${esc(soundLabel)}</div>` : '';
  return `
    <article class="part rarity-${part.rarity}${options.compact ? ' compact' : ''}">
      <header class="part-head">
        <span class="part-icon" aria-hidden="true">${SLOT_ICONS[part.slot]}</span>
        <div class="part-title">
          <div class="part-name">${esc(part.name)}</div>
          <div class="part-meta">
            ${esc(SLOT_LABELS[part.slot])} · <span class="rarity-tag">${esc(RARITY_LABELS[part.rarity])}</span>${quirk}
          </div>
        </div>
        ${badge}
      </header>
      ${bonusChips(part.bonus)}
      ${sound}
      ${delta}
      ${actions}
    </article>`;
}

/**
 * Canvas placeholder for a car; the app paints it after each render through
 * `renderCarPreview`. The stage keeps a paint-coloured glow so it still reads
 * as "a car goes here" if nothing is drawn.
 */
export function carCanvas(look: CarLook, className = '', width = 420, height = 220): string {
  const paint = safeColor(look.paint, '#888888');
  const neon = safeColor(look.neon, 'transparent');
  return `
    <div class="car-stage ${esc(className)}" style="--paint:${paint};--neon:${neon}">
      <canvas class="car-canvas" width="${width}" height="${height}" data-look="${esc(JSON.stringify(look))}"></canvas>
    </div>`;
}

/** `<img>` that swaps to a gradient + glyph placeholder if the asset is missing. */
export function picture(path: string, alt: string, className: string, glyph = '🏎️'): string {
  const src = safeAsset(path);
  const img = src
    ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" data-fallback />`
    : '';
  return `<span class="picture ${esc(className)}${src ? '' : ' img-missing'}" data-glyph="${esc(glyph)}">${img}</span>`;
}

/** Inline style for a CSS background with a gradient underneath (so a 404 still looks intentional). */
export function backdropStyle(path: string): string {
  const src = safeAsset(path);
  if (!src) return '';
  // A relative url() inside a custom property resolves against the stylesheet
  // that *uses* it, not the document: make it absolute so dev and build agree.
  const absolute = new URL(src, document.baseURI).href.replace(
    /['"()\\\s]/g,
    (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
  );
  return esc(`--img:url('${absolute}')`);
}

export function conditionClass(condition: number): string {
  if (condition <= 0) return 'dead';
  if (condition < 45) return 'bad';
  if (condition < 75) return 'worn';
  return 'good';
}

export function conditionLabel(condition: number): string {
  if (condition <= 0) return 'Moteur HS';
  if (condition < 45) return 'Ça fume sévère';
  if (condition < 75) return 'Fatigué';
  if (condition < 100) return 'En forme';
  return 'Comme neuf';
}

export function conditionGauge(condition: number): string {
  const value = Math.max(0, Math.min(100, Math.round(condition)));
  return `
    <div class="gauge ${conditionClass(value)}" role="img" aria-label="État moteur ${value} %">
      <span class="gauge-fill" style="width:${value}%"></span>
      <span class="gauge-text">${value} % · ${esc(conditionLabel(value))}</span>
    </div>`;
}

export function jewelCard(kind: JewelKind, actions = '', extraClass = ''): string {
  return `
    <article class="jewel${kind.trophy ? ' trophy' : ''} ${esc(extraClass)}">
      <span class="jewel-icon" aria-hidden="true">${esc(kind.icon)}</span>
      <div class="jewel-body">
        <div class="jewel-name">${esc(kind.name)}${kind.trophy ? ' <span class="tag gold">Trophée</span>' : ''}</div>
        <div class="jewel-flavor">${esc(kind.flavor)}</div>
        <div class="jewel-meta">
          <span>Valeur <strong>${esc(euro(kind.value))}</strong></span>
          <span>Swag <strong>+${esc(kind.swag)}</strong></span>
        </div>
      </div>
      ${actions ? `<div class="jewel-actions">${actions}</div>` : ''}
    </article>`;
}

export function jewelCardById(kindId: string, actions = '', extraClass = ''): string {
  return jewelCard(jewelKind(kindId), actions, extraClass);
}

export interface ButtonOptions {
  readonly action: string;
  readonly label: string;
  readonly variant?: 'primary' | 'ghost' | 'danger' | 'gold' | 'cyan';
  readonly data?: Readonly<Record<string, string>>;
  /** Dimmed but still clickable: the click explains why it is not possible. */
  readonly dim?: boolean;
  readonly small?: boolean;
  readonly disabled?: boolean;
}

export function button(options: ButtonOptions): string {
  const data = Object.entries(options.data ?? {})
    .map(([key, value]) => ` data-${esc(key)}="${esc(value)}"`)
    .join('');
  const classes = [
    'btn',
    options.variant ?? 'primary',
    options.dim ? 'dim' : '',
    options.small ? 'small' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<button type="button" class="${classes}" data-action="${esc(options.action)}"${data}${options.disabled ? ' disabled' : ''}>${options.label}</button>`;
}
