import type { CarModel } from './types';

/** All brands and models are invented for the game. */
export const CAR_MODELS: readonly CarModel[] = [
  {
    id: 'biquette',
    brand: 'Marcel',
    name: 'Biquette 1.1',
    tagline: "L'ancienne voiture de mamie. 240 000 km, autoradio cassette, odeur de sapin.",
    base: { topSpeed: 26, accel: 28, handling: 40, reliability: 60, nitro: 0 },
    price: 0,
    body: 'city',
    defaultPaint: '#d8c9a3',
  },
  {
    id: 'furet',
    brand: 'Gaulois',
    name: 'Furet 1.4 Sport',
    tagline: 'Légère, nerveuse, et déjà rabaissée par le vendeur. Le début des ennuis.',
    base: { topSpeed: 38, accel: 42, handling: 55, reliability: 50, nitro: 0 },
    price: 4500,
    body: 'hatch',
    defaultPaint: '#e03a3a',
  },
  {
    id: 'cobra',
    brand: 'Tornado',
    name: 'Cobra 16S',
    tagline: 'Seize soupapes, zéro assurance. Elle pousse fort, elle freine quand elle veut.',
    base: { topSpeed: 52, accel: 50, handling: 48, reliability: 45, nitro: 0 },
    price: 12000,
    body: 'coupe',
    defaultPaint: '#2f6fe0',
  },
  {
    id: 'sakura',
    brand: 'Kaiju',
    name: 'Sakura Type-S',
    tagline: 'Importée du Japon dans un conteneur. Précise comme un sabre, fiable comme un réveil.',
    base: { topSpeed: 58, accel: 62, handling: 72, reliability: 65, nitro: 0 },
    price: 28000,
    body: 'sport',
    defaultPaint: '#f2f2f2',
  },
  {
    id: 'bulldozer',
    brand: 'Vostok',
    name: 'Bulldozer V6 Turbo',
    tagline: 'Une brute. Ligne droite : imbattable. Virage : priez. Moteur : fragile.',
    base: { topSpeed: 78, accel: 74, handling: 50, reliability: 35, nitro: 0 },
    price: 55000,
    body: 'muscle',
    defaultPaint: '#1c1c1c',
  },
  {
    id: 'mistral',
    brand: 'Tornado',
    name: 'Mistral RS',
    tagline: "Le rêve de tout Jacky. Quand elle passe, même les radars s'inclinent.",
    base: { topSpeed: 88, accel: 82, handling: 80, reliability: 60, nitro: 0 },
    price: 120000,
    body: 'super',
    defaultPaint: '#ffb400',
  },
];

const BY_ID = new Map(CAR_MODELS.map((m) => [m.id, m]));

export function carModel(id: string): CarModel {
  const model = BY_ID.get(id);
  if (!model) throw new Error(`Unknown car model: ${id}`);
  return model;
}

export const PAINTS: readonly { readonly name: string; readonly hex: string }[] = [
  { name: 'Beige mamie', hex: '#d8c9a3' },
  { name: 'Rouge pompier', hex: '#e03a3a' },
  { name: 'Bleu électrique', hex: '#2f6fe0' },
  { name: 'Blanc nacré', hex: '#f2f2f2' },
  { name: 'Noir mat', hex: '#1c1c1c' },
  { name: 'Jaune poussin', hex: '#ffb400' },
  { name: 'Vert pomme', hex: '#6fd13a' },
  { name: 'Violet candy', hex: '#8e3fe0' },
  { name: 'Orange vitaminé', hex: '#ff6a1a' },
  { name: 'Rose bonbon', hex: '#ff4fa3' },
  { name: 'Gris titane', hex: '#7d8794' },
  { name: 'Turquoise lagon', hex: '#19c2c2' },
];

export const NEONS: readonly { readonly name: string; readonly hex: string }[] = [
  { name: 'Aucun', hex: '' },
  { name: 'Violet', hex: '#b04bff' },
  { name: 'Cyan', hex: '#2ff3ff' },
  { name: 'Rose', hex: '#ff3fa4' },
  { name: 'Vert', hex: '#4dff6a' },
  { name: 'Orange', hex: '#ff9a2f' },
  { name: 'Bleu', hex: '#3f7bff' },
];

export const PAINT_JOB_PRICE = 150;
export const NEON_PRICE = 300;
