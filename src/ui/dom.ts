/** Small DOM/formatting helpers shared by every screen. */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes any dynamic value before it is interpolated into an HTML template. */
export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

const EURO = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const NUMBER = new Intl.NumberFormat('fr-FR');

export const euro = (amount: number): string => EURO.format(Math.round(amount));
export const num = (value: number): string => NUMBER.format(Math.round(value));

export function signed(value: number): string {
  return value > 0 ? `+${num(value)}` : `−${num(Math.abs(value))}`;
}

/** 83.456 → "1:23.46" */
export function raceTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}

export function ordinal(position: number): string {
  return position === 1 ? '1er' : `${position}e`;
}

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

/** Colours come from the save file: never trust them inside a style attribute. */
export function safeColor(color: string, fallback = 'transparent'): string {
  return HEX_COLOR.test(color) ? color : fallback;
}

/** Only relative asset paths are allowed in `url()` / `src`. */
export function safeAsset(path: string): string {
  return /^assets\/[a-z0-9._-]+$/i.test(path) ? path : '';
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${num(count)} ${count > 1 ? pluralForm : singular}`;
}
