import type { BodyKind, Boss, District, RaceEvent, RivalSpec } from './types';

interface RivalOptions {
  readonly body?: BodyKind;
  readonly paint?: string;
  readonly neon?: string;
  readonly skill?: number;
  readonly recklessness?: number;
  readonly spoiler?: boolean;
  /** Per-stat offsets around the level, to give rivals a personality. */
  readonly tweak?: Partial<Record<'topSpeed' | 'accel' | 'handling' | 'reliability', number>>;
}

const RIVAL_PAINTS = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#f39c12', '#16a085', '#d35400', '#7f8c8d', '#e84393', '#f1c40f'];
const RIVAL_NEONS = ['', '#2ff3ff', '#ff3fa4', '#4dff6a', '', '#ff9a2f', '#b04bff', ''];

function nameIndex(name: string, modulo: number): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % modulo;
}

function bodyForLevel(level: number): BodyKind {
  if (level < 36) return 'city';
  if (level < 50) return 'hatch';
  if (level < 64) return 'coupe';
  if (level < 80) return 'sport';
  if (level < 94) return 'muscle';
  return 'super';
}

/** A rival's whole car is derived from a single "level" so events are easy to balance. */
function rival(name: string, level: number, options: RivalOptions = {}): RivalSpec {
  const tweak = options.tweak ?? {};
  return {
    name,
    body: options.body ?? bodyForLevel(level),
    paint: options.paint ?? RIVAL_PAINTS[nameIndex(name, RIVAL_PAINTS.length)] ?? '#c0392b',
    neon: options.neon ?? RIVAL_NEONS[nameIndex(name + 'neon', RIVAL_NEONS.length)] ?? '',
    stats: {
      topSpeed: level + (tweak.topSpeed ?? 0),
      accel: level + (tweak.accel ?? 0),
      handling: level + 8 + (tweak.handling ?? 0),
      reliability: 50 + (tweak.reliability ?? 0),
      nitro: Math.round(18 + level * 0.45),
    },
    skill: options.skill ?? 0.8,
    recklessness: options.recklessness ?? 0.25,
    spoiler: options.spoiler ?? level > 30,
  };
}

function event(
  id: string,
  name: string,
  blurb: string,
  laps: number,
  rivals: readonly RivalSpec[],
  entryFee: number,
  prize: number,
  respect: number,
  lootTier: number,
): RaceEvent {
  return { id, name, blurb, laps, rivals, entryFee, prize, respect, lootTier };
}

const kevin: Boss = {
  id: 'kevin',
  name: 'Kévin « Le K »',
  title: 'Roi du parking du Mégamarché',
  portrait: 'assets/boss-kevin.jpg',
  intro: [
    'Wesh, c’est toi le Ned qui tourne sur MON parking avec la caisse à mamie ?',
    'Ici on roule pas pour le plaisir. On met un bijou sur le capot, et le premier arrivé repart avec les deux.',
    'T’as une gourmette au moins ? Sinon retourne jouer aux petites voitures.',
  ],
  onWin: 'Vas-y… prends-la, ma gourmette. Mais le dis pas à ma mère.',
  onLose: 'Merci pour le bijou, frérot ! Reviens quand t’auras passé le permis.',
  rival: rival('Le K', 38, { body: 'hatch', paint: '#39d353', neon: '#4dff6a', skill: 0.84, recklessness: 0.6, spoiler: true }),
  laps: 3,
  minStake: 250,
  trophyKindId: 'trophy-kevin',
  prize: 1200,
  respect: 40,
};

const dede: Boss = {
  id: 'dede',
  name: 'Gros Dédé',
  title: 'Patron de la Zone Industrielle Nord',
  portrait: 'assets/boss-dede.jpg',
  intro: [
    'Alors c’est toi qui as plumé le petit Kévin ? Bien. Il parlait trop.',
    'Moi je parle pas. Je serre des boulons depuis trente ans et je perds jamais sur mes ronds-points.',
    'Pose un bijou qui vaut quelque chose. Ma chevalière contre la tienne.',
  ],
  onWin: 'Hmpf. T’as un bon coup de volant, gamin. Passe au garage, je te ferai un prix.',
  onLose: 'Trente ans, je te dis. Allez, file, et resserre tes roues.',
  rival: rival('Gros Dédé', 54, { body: 'muscle', paint: '#1f4e8c', neon: '', skill: 0.86, recklessness: 0.15, tweak: { accel: 4, handling: -3, reliability: 30 } }),
  laps: 3,
  minStake: 600,
  trophyKindId: 'trophy-dede',
  prize: 4000,
  respect: 80,
};

const samira: Boss = {
  id: 'samira',
  name: 'Samira « Nitro »',
  title: 'Reine des quais',
  portrait: 'assets/boss-samira.jpg',
  intro: [
    'Dédé m’a parlé de toi. Il parle jamais de personne, alors forcément, ça intrigue.',
    'Sur les quais, la ligne droite fait huit cents mètres. Je garde le pied dedans jusqu’au bout. Et toi ?',
    'Ma chaîne contre ce que tu as de plus beau. Essaie de ne pas exploser avant le dernier conteneur.',
  ],
  onWin: 'Pas mal du tout. Garde la chaîne, elle te portera chance. Ou pas.',
  onLose: 'Tu as levé le pied. Sur les quais, ça ne pardonne pas.',
  rival: rival('Samira', 70, { body: 'sport', paint: '#ff2d6f', neon: '#ff3fa4', skill: 0.88, recklessness: 0.85, tweak: { topSpeed: 4, reliability: 15 } }),
  laps: 3,
  minStake: 1800,
  trophyKindId: 'trophy-samira',
  prize: 10000,
  respect: 150,
};

const baron: Boss = {
  id: 'baron',
  name: 'Le Baron',
  title: 'Seigneur de la Corniche',
  portrait: 'assets/boss-baron.jpg',
  intro: [
    'Ah. Le jeune homme du parking. Vous sentez l’huile de friture, c’est charmant.',
    'La Corniche est une route de gentlemen. Chaque épingle a un nom, et c’est le mien.',
    'Mon chronographe contre votre… quincaillerie. Veuillez ne pas rayer ma peinture.',
  ],
  onWin: 'C’est… c’est insensé. Prenez la montre. Et ayez la décence de ne pas en parler au club.',
  onLose: 'Comme prévu. Mon majordome vous raccompagnera à l’arrêt de bus.',
  rival: rival('Le Baron', 86, { body: 'super', paint: '#f5f5f5', neon: '', skill: 0.9, recklessness: 0.3, tweak: { handling: 6, reliability: 20 } }),
  laps: 3,
  minStake: 5000,
  trophyKindId: 'trophy-baron',
  prize: 25000,
  respect: 250,
};

const jacky: Boss = {
  id: 'jacky',
  name: 'Jacky Senior',
  title: 'La Légende du Périph’',
  portrait: 'assets/boss-jacky.jpg',
  intro: [
    'Alors c’est toi, Ned. Assieds-toi, petit. Enfin… reste debout, y a pas de chaise.',
    'J’ai posé mon premier aileron en 1983. Tout ce que tu vois rouler de travers dans ce pays, c’est un peu grâce à moi.',
    'Si tu me bats sur le Périph’, le Piston en or est à toi. Et le respect qui va avec.',
  ],
  onWin: 'Voilà. C’est fait. Le tuning a un nouveau patron… Prends soin du Piston, Ned.',
  onLose: 'T’y es presque, petit. Presque. Reviens me voir quand ton moteur chantera juste.',
  rival: rival('Jacky Senior', 104, { body: 'super', paint: '#ffb400', neon: '#ff9a2f', skill: 0.93, recklessness: 0.5, tweak: { reliability: 35 } }),
  laps: 3,
  minStake: 12000,
  trophyKindId: 'trophy-jacky',
  prize: 60000,
  respect: 500,
};

export const DISTRICTS: readonly District[] = [
  {
    id: 'parking',
    name: 'Parking du Mégamarché',
    blurb: 'Là où tout commence : des caddies, des lampadaires orange et des autoradios trop forts.',
    image: 'assets/district-parking.jpg',
    trackId: 'parking',
    theme: 'parking',
    events: [
      event('parking-1', 'Tour de chauffe', 'Deux tours entre les abris à caddies pour voir ce que la Biquette a dans le ventre.', 2,
        [rival('Jordan', 20, { skill: 0.68 }), rival('Dylan', 23, { skill: 0.7 })], 0, 260, 6, 0),
      event('parking-2', 'Le run du samedi soir', 'Tout le parking regarde. Même le vigile.', 3,
        [rival('Steevy', 25, { skill: 0.72 }), rival('Brandon', 28, { skill: 0.75 }), rival('Cindy', 30, { skill: 0.76 })], 50, 480, 10, 0),
      event('parking-3', 'La nocturne des caddies', 'Les meilleurs du parking. Le gagnant a le droit de défier Le K.', 3,
        [rival('Mickaël', 31, { skill: 0.78 }), rival('Jennifer', 34, { skill: 0.8, recklessness: 0.5 }), rival('Kéké', 36, { skill: 0.8 })], 100, 750, 14, 1),
    ],
    boss: kevin,
  },
  {
    id: 'zi',
    name: 'Zone Industrielle Nord',
    blurb: 'Des entrepôts, des ronds-points et des semi-remorques garés n’importe comment.',
    image: 'assets/district-zi.jpg',
    trackId: 'zi',
    theme: 'zi',
    events: [
      event('zi-1', 'Le tour des entrepôts', 'Première sortie hors du parking. Ça va plus vite, d’un coup.', 2,
        [rival('Bébert', 40, { skill: 0.78 }), rival('Nono', 43, { skill: 0.8 })], 150, 1000, 18, 1),
      event('zi-2', 'Grand Prix des ronds-points', 'Sept ronds-points, zéro clignotant.', 3,
        [rival('Fredo', 44, { skill: 0.8 }), rival('Lulu', 47, { skill: 0.81 }), rival('Titi', 48, { skill: 0.82, recklessness: 0.5 })], 300, 1500, 24, 1),
      event('zi-3', 'La nuit des semi-remorques', 'Les routiers dorment. Pas vous.', 3,
        [rival('Riton', 48, { skill: 0.82 }), rival('La Fouine', 50, { skill: 0.83 }), rival('Gégé', 52, { skill: 0.83 })], 450, 2100, 30, 2),
    ],
    boss: dede,
  },
  {
    id: 'port',
    name: 'Les Quais',
    blurb: 'Des conteneurs, des grues, et la plus longue ligne droite de la ville. Idéal pour faire exploser un moteur.',
    image: 'assets/district-port.jpg',
    trackId: 'port',
    theme: 'port',
    events: [
      event('port-1', 'Sprint des conteneurs', 'Ligne droite, épingle, ligne droite. Simple. Brutal.', 2,
        [rival('Marco', 55, { skill: 0.82, recklessness: 0.5 }), rival('Sofiane', 58, { skill: 0.83 })], 600, 2800, 36, 2),
      event('port-2', 'Minuit au terminal', 'Les dockers ont parié gros. Sur les autres.', 3,
        [rival('Nadia', 59, { skill: 0.84 }), rival('Le Grec', 62, { skill: 0.84, recklessness: 0.6 }), rival('Yann', 63, { skill: 0.85 })], 900, 3900, 46, 2),
      event('port-3', 'La coupe des dockers', 'Trois tours pied au plancher entre les grues.', 3,
        [rival('Bruno', 63, { skill: 0.85 }), rival('Inès', 65, { skill: 0.86, recklessness: 0.7 }), rival('Tony', 67, { skill: 0.86 })], 1200, 5200, 58, 3),
    ],
    boss: samira,
  },
  {
    id: 'corniche',
    name: 'La Corniche',
    blurb: 'Une route de falaise au-dessus de la mer. Les épingles sont serrées et les villas hors de prix.',
    image: 'assets/district-corniche.jpg',
    trackId: 'corniche',
    theme: 'corniche',
    events: [
      event('corniche-1', 'La montée des villas', 'Ici, la puissance ne suffit plus. Il faut tourner.', 2,
        [rival('Édouard', 69, { skill: 0.85 }), rival('Clothilde', 72, { skill: 0.86 })], 1500, 6500, 70, 3),
      event('corniche-2', 'Le rallye du club', 'Des messieurs en gants de conduite qui ne vous saluent pas.', 3,
        [rival('Gonzague', 73, { skill: 0.87 }), rival('Sixtine', 76, { skill: 0.87 }), rival('Hubert', 78, { skill: 0.88, recklessness: 0.5 })], 2200, 8500, 85, 3),
      event('corniche-3', 'Les épingles du diable', 'Onze virages, un seul garde-fou.', 3,
        [rival('Amaury', 78, { skill: 0.88 }), rival('Bérénice', 80, { skill: 0.89 }), rival('Tancrède', 82, { skill: 0.89 })], 3000, 11000, 100, 4),
    ],
    boss: baron,
  },
  {
    id: 'periph',
    name: 'Le Périph’',
    blurb: 'La rocade, de nuit. Quatre voies, des tunnels, et tout au bout : la Légende.',
    image: 'assets/district-periph.jpg',
    trackId: 'periph',
    theme: 'periph',
    events: [
      event('periph-1', 'Porte à porte', 'Un tour de rocade plein gaz. Les camions de nuit ne ralentissent pas.', 2,
        [rival('Karim', 85, { skill: 0.88, recklessness: 0.5 }), rival('Vanessa', 88, { skill: 0.89 })], 4000, 15000, 120, 4),
      event('periph-2', 'Le run des tunnels', 'Le bruit de l’échappement sous le tunnel, c’est ça, le bonheur.', 3,
        [rival('Sacha', 89, { skill: 0.9 }), rival('Malik', 92, { skill: 0.9, recklessness: 0.7 }), rival('Élodie', 94, { skill: 0.91 })], 5500, 20000, 150, 4),
      event('periph-3', 'La dernière ronde', 'Les trois meilleurs pilotes de la ville. Après eux, il ne reste que Jacky.', 3,
        [rival('Le Fantôme', 95, { skill: 0.91 }), rival('Diesel', 97, { skill: 0.92, recklessness: 0.6 }), rival('Reine', 99, { skill: 0.92 })], 7000, 26000, 180, 4),
    ],
    boss: jacky,
  },
];

export function districtById(id: string): District {
  const district = DISTRICTS.find((d) => d.id === id);
  if (!district) throw new Error(`Unknown district: ${id}`);
  return district;
}

export function districtIndex(id: string): number {
  return DISTRICTS.findIndex((d) => d.id === id);
}

export interface RespectRank {
  readonly min: number;
  readonly title: string;
}

export const RESPECT_RANKS: readonly RespectRank[] = [
  { min: 0, title: 'Aspirant Jacky' },
  { min: 30, title: 'Jacky du dimanche' },
  { min: 120, title: 'Jacky confirmé' },
  { min: 350, title: 'Kéké respecté' },
  { min: 800, title: 'Baron du bitume' },
  { min: 1600, title: 'Légende du tuning' },
];

export function respectRank(respect: number): RespectRank {
  let current = RESPECT_RANKS[0] as RespectRank;
  for (const rank of RESPECT_RANKS) if (respect >= rank.min) current = rank;
  return current;
}
