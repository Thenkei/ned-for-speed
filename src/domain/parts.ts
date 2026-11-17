import type { Rng } from './rng';
import { RARITIES, SLOTS, type Part, type Rarity, type Slot, type StatKey, type TurboBuild, type ExhaustBuild } from './types';

/** Main bonus granted by a part of each rarity before slot weighting. */
const RARITY_POWER: Readonly<Record<Rarity, number>> = {
  occasion: 3,
  sport: 6,
  racing: 10,
  proto: 15,
  legende: 21,
};

const RARITY_PRICE: Readonly<Record<Rarity, number>> = {
  occasion: 180,
  sport: 750,
  racing: 2800,
  proto: 9500,
  legende: 32000,
};

/** Nitro kits are not linear: a kit is what gives the car a bottle at all. */
const NITRO_BY_RARITY: Readonly<Record<Rarity, number>> = {
  occasion: 20,
  sport: 35,
  racing: 52,
  proto: 72,
  legende: 95,
};

interface SlotTemplate {
  /** Stat weights applied to the rarity power. */
  readonly weights: Readonly<Partial<Record<StatKey, number>>>;
  readonly priceFactor: number;
  readonly names: Readonly<Record<Rarity, string>>;
}

const TEMPLATES: Readonly<Record<Slot, SlotTemplate>> = {
  engine: {
    weights: { topSpeed: 1, accel: 0.6 },
    priceFactor: 1.6,
    names: {
      occasion: 'Moteur de casse révisé',
      sport: 'Bloc 16S préparé',
      racing: 'Moteur Racing arbres à cames pointus',
      proto: 'Bloc Proto forgé',
      legende: 'Moteur « Le Cœur de Dragon »',
    },
  },
  turbo: {
    weights: { accel: 1, topSpeed: 0.4, reliability: -0.5 },
    priceFactor: 1.3,
    names: {
      occasion: "Turbo T2 d'occasion",
      sport: 'Turbo Sport K03',
      racing: 'Turbo Racing GT28',
      proto: 'Turbo Proto Twin-Scroll',
      legende: 'Turbo « Le Sifflet du Diable »',
    },
  },
  exhaust: {
    weights: { accel: 0.4, topSpeed: 0.3 },
    priceFactor: 0.6,
    names: {
      occasion: 'Pot percé (ça fait du bruit)',
      sport: 'Ligne inox Sport',
      racing: 'Échappement Racing sortie centrale',
      proto: 'Ligne Proto titane',
      legende: 'Échappement « Le Tonnerre de Brest »',
    },
  },
  tires: {
    weights: { handling: 1 },
    priceFactor: 0.8,
    names: {
      occasion: 'Pneus rechapés',
      sport: 'Pneus Sport taille basse',
      racing: 'Semi-slicks Racing',
      proto: 'Slicks Proto gomme tendre',
      legende: 'Pneus « Ventouse »',
    },
  },
  suspension: {
    weights: { handling: 0.7, topSpeed: 0.1 },
    priceFactor: 0.9,
    names: {
      occasion: 'Ressorts coupés à la disqueuse',
      sport: 'Kit rabaissé -40 mm',
      racing: 'Combinés filetés Racing',
      proto: 'Suspension Proto pilotée',
      legende: 'Suspension « Rase-Bitume »',
    },
  },
  nitro: {
    weights: {},
    priceFactor: 1.0,
    names: {
      occasion: 'Bouteille de protoxyde bricolée',
      sport: 'Kit Nitro Sport 50 ch',
      racing: 'Kit Nitro Racing double étage',
      proto: 'Kit Nitro Proto injection directe',
      legende: 'Kit Nitro « Le Souffle du Mistral »',
    },
  },
  cooling: {
    weights: { reliability: 1.5 },
    priceFactor: 0.7,
    names: {
      occasion: 'Radiateur de récup',
      sport: 'Radiateur alu Sport',
      racing: 'Intercooler frontal Racing',
      proto: 'Refroidissement Proto double circuit',
      legende: 'Radiateur « Banquise »',
    },
  },
  spoiler: {
    weights: { handling: 0.5, topSpeed: 0.15 },
    priceFactor: 0.5,
    names: {
      occasion: 'Aileron en fibre fissuré',
      sport: 'Becquet Sport',
      racing: 'Aileron Racing alu réglable',
      proto: 'Aileron Proto carbone',
      legende: 'Aileron « Table à Repasser »',
    },
  },
};

interface Quirk {
  readonly label: string;
  readonly bonus: Readonly<Partial<Record<StatKey, number>>>;
  readonly priceFactor: number;
  /** Garage work rather than factory parts: on a turbo, it comes with a pop-and-bang map. */
  readonly homemade: boolean;
}

/** RPG-style affixes: a part can come out better (or dodgier) than its template. */
const QUIRKS: readonly Quirk[] = [
  { label: 'préparé par Dédé', bonus: { reliability: 4 }, priceFactor: 1.2, homemade: true },
  { label: 'tombé du camion', bonus: { reliability: -3 }, priceFactor: 0.7, homemade: true },
  { label: 'allégé', bonus: { accel: 2, handling: 1 }, priceFactor: 1.25, homemade: false },
  { label: 'poussé à bloc', bonus: { topSpeed: 3, reliability: -4 }, priceFactor: 1.15, homemade: true },
  { label: 'béni par mamie', bonus: { reliability: 6 }, priceFactor: 1.3, homemade: false },
  { label: 'édition tuning show', bonus: { handling: 2, topSpeed: 1 }, priceFactor: 1.25, homemade: false },
  { label: 'monté à l’envers', bonus: { handling: -2, accel: 1 }, priceFactor: 0.75, homemade: true },
];

const HOMEMADE_QUIRKS: ReadonlySet<string> = new Set(QUIRKS.filter((q) => q.homemade).map((q) => q.label));

/** Rarities from which a turbo counts as a big one. */
const BIG_TURBO_RARITIES: ReadonlySet<Rarity> = new Set<Rarity>(['racing', 'proto', 'legende']);

const isHomemade = (part: Part): boolean => part.quirk !== undefined && HOMEMADE_QUIRKS.has(part.quirk);

/** What kind of turbo a part is (undefined for any other slot). */
export function turboBuildOf(part: Part | undefined): TurboBuild | undefined {
  if (!part || part.slot !== 'turbo') return undefined;
  return { big: BIG_TURBO_RARITIES.has(part.rarity), homemade: isHomemade(part) };
}

/** What kind of exhaust a part is (undefined for any other slot). */
export function exhaustBuildOf(part: Part | undefined): ExhaustBuild | undefined {
  if (!part || part.slot !== 'exhaust') return undefined;
  return { rarity: part.rarity, homemade: isHomemade(part) };
}

const round1 = (n: number): number => Math.round(n);

function mergeBonus(
  a: Readonly<Partial<Record<StatKey, number>>>,
  b: Readonly<Partial<Record<StatKey, number>>>,
): Partial<Record<StatKey, number>> {
  const out: Partial<Record<StatKey, number>> = { ...a };
  for (const [key, value] of Object.entries(b) as [StatKey, number][]) {
    const total = (out[key] ?? 0) + value;
    if (total === 0) delete out[key];
    else out[key] = total;
  }
  return out;
}

export interface PartRequest {
  readonly uid: string;
  readonly slot: Slot;
  readonly rarity: Rarity;
  /** Index into the quirk table, or undefined for a plain part. */
  readonly quirkIndex?: number;
}

/** Deterministic part construction (no randomness here: see `rollPart`). */
export function buildPart(request: PartRequest): Part {
  const template = TEMPLATES[request.slot];
  const power = RARITY_POWER[request.rarity];
  let bonus: Partial<Record<StatKey, number>> = {};
  for (const [stat, weight] of Object.entries(template.weights) as [StatKey, number][]) {
    const value = round1(power * weight);
    if (value !== 0) bonus[stat] = value;
  }
  if (request.slot === 'nitro') bonus.nitro = NITRO_BY_RARITY[request.rarity];

  let price = RARITY_PRICE[request.rarity] * template.priceFactor;
  const quirk = request.quirkIndex === undefined ? undefined : QUIRKS[request.quirkIndex];
  if (quirk) {
    bonus = mergeBonus(bonus, quirk.bonus);
    price *= quirk.priceFactor;
  }

  const base: Part = {
    uid: request.uid,
    slot: request.slot,
    rarity: request.rarity,
    name: template.names[request.rarity],
    bonus,
    price: Math.round(price / 10) * 10,
  };
  return quirk ? { ...base, quirk: quirk.label } : base;
}

/**
 * Rarity odds for a loot/shop roll at a given tier (0 = car park … 4 = ring road).
 * Each tier mostly yields its own rarity, sometimes one above or below.
 */
export function rarityOdds(tier: number): Readonly<Record<Rarity, number>> {
  const clamped = Math.max(0, Math.min(RARITIES.length - 1, Math.round(tier)));
  const odds: Record<Rarity, number> = { occasion: 0, sport: 0, racing: 0, proto: 0, legende: 0 };
  RARITIES.forEach((rarity, index) => {
    const distance = index - clamped;
    if (distance === 0) odds[rarity] = 0.55;
    else if (distance === -1) odds[rarity] = 0.3;
    else if (distance === 1) odds[rarity] = 0.13;
    else if (distance === -2) odds[rarity] = 0.02;
    else odds[rarity] = 0;
  });
  const total = Object.values(odds).reduce((sum, p) => sum + p, 0);
  for (const rarity of RARITIES) odds[rarity] /= total;
  return odds;
}

function rollRarity(rng: Rng, tier: number): Rarity {
  const odds = rarityOdds(tier);
  let roll = rng.next();
  for (const rarity of RARITIES) {
    roll -= odds[rarity];
    if (roll < 0) return rarity;
  }
  return 'occasion';
}

export function rollPart(rng: Rng, uid: string, tier: number, slot?: Slot): Part {
  const chosenSlot = slot ?? rng.pick(SLOTS);
  const rarity = rollRarity(rng, tier);
  const hasQuirk = rng.chance(0.35);
  const quirkIndex = rng.int(0, QUIRKS.length - 1);
  return buildPart(
    hasQuirk
      ? { uid, slot: chosenSlot, rarity, quirkIndex }
      : { uid, slot: chosenSlot, rarity },
  );
}

/** Resale value of a part ("à la casse"). */
export function partResaleValue(part: Part): number {
  return Math.round((part.price * 0.4) / 10) * 10;
}

export const RARITY_ORDER: Readonly<Record<Rarity, number>> = {
  occasion: 0,
  sport: 1,
  racing: 2,
  proto: 3,
  legende: 4,
};
