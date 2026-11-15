/**
 * Domain model for Ned for Speed.
 * Everything in `src/domain` is pure (no DOM, no storage, no clock) so that the
 * whole economy / progression / engine model can be unit-tested and replayed.
 */

export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// ───────────────────────── Stats ─────────────────────────

export const STAT_KEYS = ['topSpeed', 'accel', 'handling', 'reliability', 'nitro'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Readonly<Record<StatKey, number>>;

export const STAT_LABELS: Readonly<Record<StatKey, string>> = {
  topSpeed: 'Vitesse max',
  accel: 'Accélération',
  handling: 'Maniabilité',
  reliability: 'Fiabilité',
  nitro: 'Nitro',
};

// ───────────────────────── Parts ─────────────────────────

export const SLOTS = [
  'engine',
  'turbo',
  'exhaust',
  'tires',
  'suspension',
  'nitro',
  'cooling',
  'spoiler',
] as const;
export type Slot = (typeof SLOTS)[number];

export const SLOT_LABELS: Readonly<Record<Slot, string>> = {
  engine: 'Moteur',
  turbo: 'Turbo',
  exhaust: 'Échappement',
  tires: 'Pneus',
  suspension: 'Suspension',
  nitro: 'Kit nitro',
  cooling: 'Refroidissement',
  spoiler: 'Aileron',
};

export const SLOT_ICONS: Readonly<Record<Slot, string>> = {
  engine: '⚙️',
  turbo: '🌀',
  exhaust: '💨',
  tires: '🛞',
  suspension: '🔩',
  nitro: '🧪',
  cooling: '❄️',
  spoiler: '🪽',
};

export const RARITIES = ['occasion', 'sport', 'racing', 'proto', 'legende'] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_LABELS: Readonly<Record<Rarity, string>> = {
  occasion: 'Occasion',
  sport: 'Sport',
  racing: 'Racing',
  proto: 'Proto',
  legende: 'Légende',
};

export interface Part {
  readonly uid: string;
  readonly slot: Slot;
  readonly rarity: Rarity;
  readonly name: string;
  /** Optional quirk rolled at generation ("de casse", "préparé par Dédé"…). */
  readonly quirk?: string;
  readonly bonus: Readonly<Partial<Record<StatKey, number>>>;
  readonly price: number;
}

// ───────────────────────── Cars ─────────────────────────

export type BodyKind = 'city' | 'hatch' | 'coupe' | 'sport' | 'muscle' | 'super';

export interface CarModel {
  readonly id: string;
  readonly brand: string;
  readonly name: string;
  readonly tagline: string;
  readonly base: Stats;
  readonly price: number;
  readonly body: BodyKind;
  readonly defaultPaint: string;
}

export interface OwnedCar {
  readonly uid: string;
  readonly modelId: string;
  readonly paint: string;
  readonly neon: string;
  /** Engine health, 0 (dead) – 100 (fresh). */
  readonly condition: number;
  /** slot → part uid (parts live in `GameState.inventory`). */
  readonly equipped: Readonly<Partial<Record<Slot, string>>>;
}

// ───────────────────────── Jewels ─────────────────────────

export interface JewelKind {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly value: number;
  /** Swag points: each point adds to race winnings. */
  readonly swag: number;
  readonly flavor: string;
  /** Boss trophies cannot be bought. */
  readonly trophy?: boolean;
}

export interface Jewel {
  readonly uid: string;
  readonly kindId: string;
}

// ───────────────────────── World ─────────────────────────

export interface RivalSpec {
  readonly name: string;
  readonly body: BodyKind;
  readonly paint: string;
  readonly neon: string;
  readonly stats: Stats;
  /** 0–1: how close to the grip limit the driver corners. */
  readonly skill: number;
  /** 0–1: how deep into the red zone the driver is willing to push nitro. */
  readonly recklessness: number;
  readonly spoiler: boolean;
}

export interface RaceEvent {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly laps: number;
  readonly rivals: readonly RivalSpec[];
  readonly entryFee: number;
  readonly prize: number;
  readonly respect: number;
  /** Highest part rarity that can drop from this event. */
  readonly lootTier: number;
}

export interface Boss {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly portrait: string;
  readonly intro: readonly string[];
  readonly onWin: string;
  readonly onLose: string;
  readonly rival: RivalSpec;
  readonly laps: number;
  /** Minimum value of the jewel Ned must put on the table. */
  readonly minStake: number;
  /** Trophy jewel Ned takes if he wins. */
  readonly trophyKindId: string;
  readonly prize: number;
  readonly respect: number;
}

export type ThemeId = 'parking' | 'zi' | 'port' | 'corniche' | 'periph';

export interface District {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly image: string;
  readonly trackId: string;
  readonly theme: ThemeId;
  readonly events: readonly RaceEvent[];
  readonly boss: Boss;
}

// ───────────────────────── Race contract ─────────────────────────

/** What the race needs to draw a car. */
export interface CarLook {
  readonly body: BodyKind;
  readonly paint: string;
  readonly neon: string;
  readonly spoiler: boolean;
}

export interface Racer {
  readonly name: string;
  readonly look: CarLook;
  readonly stats: Stats;
  /** Engine condition 0–100. */
  readonly condition: number;
  readonly skill: number;
  readonly recklessness: number;
}

export interface RaceSetup {
  readonly title: string;
  readonly trackId: string;
  readonly theme: ThemeId;
  readonly laps: number;
  readonly player: Racer;
  readonly rivals: readonly Racer[];
  readonly seed: number;
  /** Optional line shouted by the boss during the countdown. */
  readonly taunt?: string;
  /** Show driving tips during the race (Ned's very first outings). */
  readonly coach?: boolean;
}

export interface RaceStanding {
  readonly name: string;
  readonly isPlayer: boolean;
  readonly position: number;
  /** Seconds, undefined when the racer did not finish. */
  readonly time?: number;
  readonly exploded: boolean;
}

export interface RaceOutcome {
  /** 1-based finishing position of the player. */
  readonly position: number;
  readonly racers: number;
  readonly exploded: boolean;
  /** True when the player quit before the end. */
  readonly abandoned: boolean;
  readonly time: number;
  readonly bestLap?: number;
  readonly topSpeedKmh: number;
  /** Engine condition points lost during the race (overheating). */
  readonly wear: number;
  readonly standings: readonly RaceStanding[];
}

// ───────────────────────── Game state ─────────────────────────

export interface ShopState {
  readonly parts: readonly Part[];
  /** Number of refreshes so far (drives the stock seed). */
  readonly rotation: number;
}

export interface CareerStats {
  readonly races: number;
  readonly wins: number;
  readonly explosions: number;
  readonly jewelsLost: number;
}

export interface GameState {
  readonly version: 1;
  readonly money: number;
  readonly respect: number;
  readonly cars: readonly OwnedCar[];
  readonly activeCarUid: string;
  /** Every owned part, equipped or not. */
  readonly inventory: readonly Part[];
  readonly jewels: readonly Jewel[];
  /** eventId → number of wins. */
  readonly eventWins: Readonly<Record<string, number>>;
  readonly bossesBeaten: readonly string[];
  readonly shop: ShopState;
  readonly rngSeed: number;
  readonly nextUid: number;
  readonly career: CareerStats;
  readonly introSeen: boolean;
  readonly endingSeen: boolean;
}
