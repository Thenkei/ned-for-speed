import type { Jewel, JewelKind } from './types';

export const JEWEL_KINDS: readonly JewelKind[] = [
  {
    id: 'gourmette',
    name: 'Gourmette plaquée or',
    icon: '📿',
    value: 250,
    swag: 1,
    flavor: 'Gravée « NED » par le cordonnier du centre commercial.',
  },
  {
    id: 'boucle',
    name: "Boucle d'oreille en zircon",
    icon: '💎',
    value: 600,
    swag: 2,
    flavor: 'De loin, on dirait un diamant. De très loin.',
  },
  {
    id: 'chaine',
    name: 'Chaîne maille épaisse',
    icon: '⛓️',
    value: 1800,
    swag: 4,
    flavor: 'Elle pèse son poids. La nuque suit comme elle peut.',
  },
  {
    id: 'chevaliere',
    name: 'Chevalière en or',
    icon: '💍',
    value: 5000,
    swag: 7,
    flavor: 'Se porte au petit doigt, le coude à la portière.',
  },
  {
    id: 'dent',
    name: 'Dent en or',
    icon: '🦷',
    value: 12000,
    swag: 11,
    flavor: 'Un sourire qui se voit depuis la rocade.',
  },
  {
    id: 'montre',
    name: 'Montre « Rolaxe » en or',
    icon: '⌚',
    value: 30000,
    swag: 16,
    flavor: "Elle retarde de dix minutes par jour, mais quelle allure.",
  },
  // ── Boss trophies ──
  {
    id: 'trophy-kevin',
    name: 'La Gourmette du K',
    icon: '🔗',
    value: 900,
    swag: 5,
    flavor: 'Prise au poignet du roi du parking.',
    trophy: true,
  },
  {
    id: 'trophy-dede',
    name: 'La Chevalière Tête de Lion',
    icon: '🦁',
    value: 4000,
    swag: 10,
    flavor: 'Gros Dédé ne l’avait pas enlevée depuis 1987.',
    trophy: true,
  },
  {
    id: 'trophy-samira',
    name: 'La Chaîne des Quais',
    icon: '⚓',
    value: 11000,
    swag: 16,
    flavor: 'Samira l’a gagnée contre un capitaine de cargo.',
    trophy: true,
  },
  {
    id: 'trophy-baron',
    name: 'Le Chrono du Baron',
    icon: '🕰️',
    value: 28000,
    swag: 24,
    flavor: 'Une vraie, celle-là. Le Baron en pleure encore.',
    trophy: true,
  },
  {
    id: 'trophy-jacky',
    name: 'Le Piston en Or Massif',
    icon: '🏆',
    value: 100000,
    swag: 40,
    flavor: 'Le pendentif de la Légende. Celui qui le porte EST le tuning.',
    trophy: true,
  },
];

const BY_ID = new Map(JEWEL_KINDS.map((k) => [k.id, k]));

export function jewelKind(id: string): JewelKind {
  const kind = BY_ID.get(id);
  if (!kind) throw new Error(`Unknown jewel kind: ${id}`);
  return kind;
}

export const SHOP_JEWELS: readonly JewelKind[] = JEWEL_KINDS.filter((k) => !k.trophy);

export function totalSwag(jewels: readonly Jewel[]): number {
  return jewels.reduce((sum, jewel) => sum + jewelKind(jewel.kindId).swag, 0);
}

/**
 * Each swag point adds 1 % to race winnings, capped at +100 %: with every boss
 * trophy on his neck Ned roughly doubles his prizes, without the bonus ever
 * dwarfing the prize itself.
 */
export function swagMultiplier(jewels: readonly Jewel[]): number {
  return 1 + Math.min(totalSwag(jewels) * 0.01, 1);
}

/** Momo buys jewels back at 60 % of their value. */
export function jewelResaleValue(kind: JewelKind): number {
  return Math.round(kind.value * 0.6);
}
