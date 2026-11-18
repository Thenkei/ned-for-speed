import { carModel, NEON_PRICE, PAINT_JOB_PRICE } from './cars';
import { jewelKind, jewelResaleValue, swagMultiplier } from './jewels';
import { buildPart, exhaustBuildOf, partResaleValue, rollPart, turboBuildOf } from './parts';
import { createRng } from './rng';
import {
  err,
  ok,
  SLOTS,
  STAT_KEYS,
  type Boss,
  type District,
  type GameState,
  type Jewel,
  type OwnedCar,
  type Part,
  type RaceEvent,
  type RaceOutcome,
  type RaceSetup,
  type Racer,
  type Result,
  type RivalSpec,
  type Slot,
  type StatKey,
  type Stats,
  type ExhaustBuild,
  type TurboBuild,
} from './types';
import { TIME_TRIAL_LAPS } from './ghost';
import type { Weather } from './tuning';
import { forecastWeather, weatherProfile } from './weather';
import { DISTRICTS, districtIndex } from './world';

const SHOP_SIZE = 8;
const STARTING_MONEY = 300;
/** Number of career races during which on-track driving tips are shown. */
const COACHED_RACES = 2;

// ───────────────────────── Queries ─────────────────────────

export function activeCar(state: GameState): OwnedCar {
  const car = state.cars.find((c) => c.uid === state.activeCarUid);
  if (!car) throw new Error('Corrupt save: active car not found');
  return car;
}

export function findCar(state: GameState, carUid: string): OwnedCar | undefined {
  return state.cars.find((c) => c.uid === carUid);
}

export function partByUid(state: GameState, uid: string): Part | undefined {
  return state.inventory.find((p) => p.uid === uid);
}

export function equippedParts(state: GameState, car: OwnedCar): Part[] {
  const parts: Part[] = [];
  for (const slot of SLOTS) {
    const uid = car.equipped[slot];
    const part = uid === undefined ? undefined : partByUid(state, uid);
    if (part) parts.push(part);
  }
  return parts;
}

/** The car a part is bolted on, if any. */
export function partOwnerCar(state: GameState, partUid: string): OwnedCar | undefined {
  return state.cars.find((car) => Object.values(car.equipped).includes(partUid));
}

export function sumStats(base: Stats, parts: readonly Part[]): Stats {
  const totals: Record<StatKey, number> = { ...base };
  for (const part of parts) {
    for (const key of STAT_KEYS) totals[key] += part.bonus[key] ?? 0;
  }
  for (const key of STAT_KEYS) totals[key] = Math.max(key === 'nitro' ? 0 : 5, totals[key]);
  return totals;
}

export function effectiveStats(state: GameState, car: OwnedCar): Stats {
  return sumStats(carModel(car.modelId).base, equippedParts(state, car));
}

/** Stats the car would have with `candidate` fitted in its slot. */
export function statsWithPart(state: GameState, car: OwnedCar, candidate: Part): Stats {
  const others = equippedParts(state, car).filter((p) => p.slot !== candidate.slot);
  return sumStats(carModel(car.modelId).base, [...others, candidate]);
}

/** Single number shown on cards to compare cars at a glance. */
export function performanceIndex(stats: Stats): number {
  return Math.round(stats.topSpeed * 0.34 + stats.accel * 0.3 + stats.handling * 0.3 + stats.nitro * 0.06);
}

export function shopTier(state: GameState): number {
  return Math.min(4, state.bossesBeaten.length);
}

export function isDistrictUnlocked(state: GameState, district: District): boolean {
  const index = districtIndex(district.id);
  if (index <= 0) return true;
  const previous = DISTRICTS[index - 1];
  return previous !== undefined && state.bossesBeaten.includes(previous.boss.id);
}

export function isBossAvailable(state: GameState, district: District): boolean {
  return (
    isDistrictUnlocked(state, district) &&
    district.events.every((event) => (state.eventWins[event.id] ?? 0) > 0)
  );
}

export function hasWonGame(state: GameState): boolean {
  return DISTRICTS.every((d) => state.bossesBeaten.includes(d.boss.id));
}

export function repairCost(car: OwnedCar): number {
  const model = carModel(car.modelId);
  const full = 200 + model.price * 0.05;
  return Math.round(((100 - car.condition) / 100) * full);
}

// ───────────────────────── Construction ─────────────────────────

function rollShop(state: GameState): GameState {
  const rng = createRng(state.rngSeed);
  const tier = shopTier(state);
  let nextUid = state.nextUid;
  const parts: Part[] = [];
  // Guarantee variety: the first slots of the stock cycle through every slot.
  const offset = state.shop.rotation % SLOTS.length;
  for (let i = 0; i < SHOP_SIZE; i++) {
    const slot = SLOTS[(i + offset) % SLOTS.length];
    parts.push(rollPart(rng, `p${nextUid++}`, tier, slot));
  }
  return {
    ...state,
    nextUid,
    rngSeed: rng.state(),
    shop: { parts, rotation: state.shop.rotation + 1 },
  };
}

export function newGame(seed: number): GameState {
  const starterKit = buildPart({ uid: 'p1', slot: 'nitro', rarity: 'occasion' });
  const model = carModel('biquette');
  const base: GameState = {
    version: 1,
    money: STARTING_MONEY,
    respect: 0,
    cars: [
      {
        uid: 'c1',
        modelId: model.id,
        paint: model.defaultPaint,
        neon: '',
        condition: 100,
        equipped: { nitro: starterKit.uid },
      },
    ],
    activeCarUid: 'c1',
    inventory: [starterKit],
    jewels: [{ uid: 'j1', kindId: 'gourmette' }],
    eventWins: {},
    bossesBeaten: [],
    shop: { parts: [], rotation: 0 },
    rngSeed: seed >>> 0,
    nextUid: 2,
    career: { races: 0, wins: 0, explosions: 0, jewelsLost: 0 },
    introSeen: false,
    endingSeen: false,
  };
  return rollShop(base);
}

// ───────────────────────── Commands (pure reducers) ─────────────────────────

const replaceCar = (state: GameState, car: OwnedCar): GameState => ({
  ...state,
  cars: state.cars.map((c) => (c.uid === car.uid ? car : c)),
});

export function buyPart(state: GameState, partUid: string): Result<GameState> {
  const part = state.shop.parts.find((p) => p.uid === partUid);
  if (!part) return err('Cette pièce n’est plus en rayon.');
  if (state.money < part.price) return err('Pas assez de thunes.');
  return ok({
    ...state,
    money: state.money - part.price,
    inventory: [...state.inventory, part],
    shop: { ...state.shop, parts: state.shop.parts.filter((p) => p.uid !== partUid) },
  });
}

export function sellPart(state: GameState, partUid: string): Result<GameState> {
  const part = partByUid(state, partUid);
  if (!part) return err('Pièce introuvable.');
  if (partOwnerCar(state, partUid)) return err('Démonte la pièce avant de la vendre.');
  return ok({
    ...state,
    money: state.money + partResaleValue(part),
    inventory: state.inventory.filter((p) => p.uid !== partUid),
  });
}

export function equipPart(state: GameState, carUid: string, partUid: string): Result<GameState> {
  const car = findCar(state, carUid);
  const part = partByUid(state, partUid);
  if (!car) return err('Voiture introuvable.');
  if (!part) return err('Pièce introuvable.');

  // A part can only be on one car: take it off wherever it currently sits.
  let next = state;
  const previousOwner = partOwnerCar(state, partUid);
  if (previousOwner && previousOwner.uid !== carUid) {
    const { [part.slot]: _removed, ...rest } = previousOwner.equipped;
    next = replaceCar(next, { ...previousOwner, equipped: rest });
  }
  return ok(replaceCar(next, { ...car, equipped: { ...car.equipped, [part.slot]: partUid } }));
}

export function unequipSlot(state: GameState, carUid: string, slot: Slot): Result<GameState> {
  const car = findCar(state, carUid);
  if (!car) return err('Voiture introuvable.');
  const { [slot]: _removed, ...rest } = car.equipped;
  return ok(replaceCar(state, { ...car, equipped: rest }));
}

export function buyCar(state: GameState, modelId: string): Result<GameState> {
  const model = carModel(modelId);
  if (state.cars.some((c) => c.modelId === modelId)) return err('Tu l’as déjà dans ton garage.');
  if (state.money < model.price) return err('Pas assez de thunes.');
  const uid = `c${state.nextUid}`;
  const car: OwnedCar = {
    uid,
    modelId,
    paint: model.defaultPaint,
    neon: '',
    condition: 100,
    equipped: {},
  };
  return ok({
    ...state,
    money: state.money - model.price,
    cars: [...state.cars, car],
    activeCarUid: uid,
    nextUid: state.nextUid + 1,
  });
}

export function selectCar(state: GameState, carUid: string): Result<GameState> {
  if (!findCar(state, carUid)) return err('Voiture introuvable.');
  return ok({ ...state, activeCarUid: carUid });
}

/** Move every part from the active car's slots to another car (handy after buying a new one). */
export function transferParts(state: GameState, fromUid: string, toUid: string): Result<GameState> {
  const from = findCar(state, fromUid);
  const to = findCar(state, toUid);
  if (!from || !to) return err('Voiture introuvable.');
  if (from.uid === to.uid) return ok(state);
  const next = replaceCar(state, { ...from, equipped: {} });
  return ok(replaceCar(next, { ...to, equipped: { ...to.equipped, ...from.equipped } }));
}

export function repaintCar(state: GameState, carUid: string, paint: string): Result<GameState> {
  const car = findCar(state, carUid);
  if (!car) return err('Voiture introuvable.');
  if (car.paint === paint) return ok(state);
  if (state.money < PAINT_JOB_PRICE) return err('Pas assez de thunes pour la peinture.');
  return ok({ ...replaceCar(state, { ...car, paint }), money: state.money - PAINT_JOB_PRICE });
}

export function setNeon(state: GameState, carUid: string, neon: string): Result<GameState> {
  const car = findCar(state, carUid);
  if (!car) return err('Voiture introuvable.');
  if (car.neon === neon) return ok(state);
  const price = neon === '' ? 0 : NEON_PRICE;
  if (state.money < price) return err('Pas assez de thunes pour les néons.');
  return ok({ ...replaceCar(state, { ...car, neon }), money: state.money - price });
}

/**
 * Full repair when Ned can pay; otherwise Tonton Gégé patches the engine up
 * to 45 % for whatever is in Ned's pockets, so a blown engine never soft-locks
 * the career.
 */
export function repairCar(state: GameState, carUid: string): Result<GameState> {
  const car = findCar(state, carUid);
  if (!car) return err('Voiture introuvable.');
  if (car.condition >= 100) return err('Le moteur est déjà comme neuf.');
  const cost = repairCost(car);
  if (state.money >= cost) {
    return ok({ ...replaceCar(state, { ...car, condition: 100 }), money: state.money - cost });
  }
  if (car.condition >= 45) return err('Pas assez de thunes pour une vraie réparation.');
  return ok({ ...replaceCar(state, { ...car, condition: 45 }), money: 0 });
}

export function buyJewel(state: GameState, kindId: string): Result<GameState> {
  const kind = jewelKind(kindId);
  if (kind.trophy) return err('Celui-là, il se gagne.');
  if (state.money < kind.value) return err('Pas assez de thunes.');
  const jewel: Jewel = { uid: `j${state.nextUid}`, kindId };
  return ok({
    ...state,
    money: state.money - kind.value,
    jewels: [...state.jewels, jewel],
    nextUid: state.nextUid + 1,
  });
}

export function sellJewel(state: GameState, jewelUid: string): Result<GameState> {
  const jewel = state.jewels.find((j) => j.uid === jewelUid);
  if (!jewel) return err('Bijou introuvable.');
  const kind = jewelKind(jewel.kindId);
  if (kind.trophy) return err('On ne vend pas un trophée, enfin !');
  return ok({
    ...state,
    money: state.money + jewelResaleValue(kind),
    jewels: state.jewels.filter((j) => j.uid !== jewelUid),
  });
}

export function markIntroSeen(state: GameState): GameState {
  return { ...state, introSeen: true };
}

export function markEndingSeen(state: GameState): GameState {
  return { ...state, endingSeen: true };
}

// ───────────────────────── Racing ─────────────────────────

function rivalToRacer(spec: RivalSpec): Racer {
  return {
    name: spec.name,
    look: { body: spec.body, paint: spec.paint, neon: spec.neon, spoiler: spec.spoiler },
    stats: spec.stats,
    condition: 100,
    skill: spec.skill,
    recklessness: spec.recklessness,
    ...(spec.turbo ? { turbo: spec.turbo } : {}),
    ...(spec.exhaust ? { exhaust: spec.exhaust } : {}),
  };
}

export function playerRacer(state: GameState): Racer {
  const car = activeCar(state);
  const model = carModel(car.modelId);
  return {
    name: 'Ned',
    look: {
      body: model.body,
      paint: car.paint,
      neon: car.neon,
      spoiler: car.equipped.spoiler !== undefined,
    },
    stats: effectiveStats(state, car),
    condition: car.condition,
    skill: 1,
    recklessness: 0,
    ...soundBuildOf(state, car),
  };
}

/** The fitted turbo and exhaust, spread into a `Racer` (nothing for a stock car). */
function soundBuildOf(state: GameState, car: OwnedCar): { turbo?: TurboBuild; exhaust?: ExhaustBuild } {
  const fitted = (slot: Slot): Part | undefined => {
    const uid = car.equipped[slot];
    return uid === undefined ? undefined : partByUid(state, uid);
  };
  const turbo = turboBuildOf(fitted('turbo'));
  const exhaust = exhaustBuildOf(fitted('exhaust'));
  return { ...(turbo ? { turbo } : {}), ...(exhaust ? { exhaust } : {}) };
}

export function canEnterEvent(state: GameState, event: RaceEvent): Result<true> {
  const car = activeCar(state);
  if (car.condition <= 0) return err('Ton moteur est HS. Passe au garage d’abord.');
  if (state.money < event.entryFee) return err('Pas assez de thunes pour l’inscription.');
  return ok(true);
}

export function eligibleStakes(state: GameState, boss: Boss): Jewel[] {
  return state.jewels.filter((j) => jewelKind(j.kindId).value >= boss.minStake);
}

export function canChallengeBoss(state: GameState, district: District): Result<true> {
  if (!isBossAvailable(state, district)) return err('Gagne d’abord toutes les courses du quartier.');
  if (activeCar(state).condition <= 0) return err('Ton moteur est HS. Passe au garage d’abord.');
  if (eligibleStakes(state, district.boss).length === 0) {
    return err(`Il te faut un bijou d’au moins ${district.boss.minStake} € à mettre en jeu.`);
  }
  return ok(true);
}

export function eventRaceSetup(state: GameState, district: District, event: RaceEvent): RaceSetup {
  const seed = (state.rngSeed ^ (state.career.races * 7919)) >>> 0;
  const coach = state.career.races < COACHED_RACES;
  return {
    title: event.name,
    trackId: district.trackId,
    theme: district.theme,
    laps: event.laps,
    player: playerRacer(state),
    rivals: event.rivals.map(rivalToRacer),
    seed,
    coach,
    // Ned learns the controls on a dry road; after that the sky decides.
    weather: coach ? 'dry' : forecastWeather(seed),
  };
}

/**
 * A time trial: Ned alone on a district's track, the weather of his choice.
 * Nothing is at stake (no fee, no prize, no wear): the run is only measured.
 * The seed is fixed per track so a run never depends on when it is started.
 */
export function timeTrialSetup(state: GameState, district: District, weather: Weather): RaceSetup {
  let seed = 0x1f2e3d4c;
  for (let i = 0; i < district.trackId.length; i++) seed = Math.imul(seed ^ district.trackId.charCodeAt(i), 0x01000193) >>> 0;
  return {
    title: `Chrono : ${district.name}`,
    trackId: district.trackId,
    theme: district.theme,
    laps: TIME_TRIAL_LAPS,
    player: playerRacer(state),
    rivals: [],
    seed,
    weather,
  };
}

/** Whether the active car can be taken out for a time trial. */
export function canRunTimeTrial(state: GameState, district: District): Result<true> {
  if (!isDistrictUnlocked(state, district)) return err('Ce quartier n’est pas encore débloqué.');
  if (activeCar(state).condition <= 0) return err('Ton moteur est HS. Passe au garage d’abord.');
  return ok(true);
}

export function bossRaceSetup(state: GameState, district: District): RaceSetup {
  const boss = district.boss;
  const seed = (state.rngSeed ^ (state.career.races * 104729)) >>> 0;
  return {
    title: `Duel : ${boss.name}`,
    trackId: district.trackId,
    theme: district.theme,
    laps: boss.laps,
    player: playerRacer(state),
    rivals: [rivalToRacer(boss.rival)],
    seed,
    taunt: boss.intro[boss.intro.length - 1] ?? '',
    weather: forecastWeather(seed),
  };
}

const PRIZE_SHARE_BY_POSITION: readonly number[] = [1, 0.35, 0.1];

/** Splits a prize into its dry-weather base and the rain bonus on top. */
function withWeatherBonus(basePrize: number, outcome: RaceOutcome): { prize: number; weatherBonus: number } {
  const base = Math.round(basePrize);
  const weatherBonus = Math.round(base * (weatherProfile(outcome.weather).prizeMultiplier - 1));
  return { prize: base + weatherBonus, weatherBonus };
}

export interface RaceReport {
  readonly kind: 'event' | 'boss';
  readonly won: boolean;
  readonly position: number;
  readonly racers: number;
  readonly exploded: boolean;
  readonly abandoned: boolean;
  readonly entryFee: number;
  /** Total prize, rain bonus included. */
  readonly prize: number;
  /** Part of `prize` earned for racing in the wet (set only when non-zero). */
  readonly weatherBonus?: number;
  readonly respect: number;
  readonly loot?: Part;
  readonly conditionBefore: number;
  readonly conditionAfter: number;
  readonly jewelWon?: Jewel;
  readonly jewelLost?: Jewel;
  readonly firstWin: boolean;
  /** Set when beating a boss opened a new district. */
  readonly unlockedDistrictId?: string;
  readonly gameCompleted: boolean;
}

function conditionAfterRace(car: OwnedCar, outcome: RaceOutcome): number {
  if (outcome.exploded) return 0;
  // Overheating alone never kills the engine outright: it bottoms out at 5 %.
  return Math.max(5, Math.round(car.condition - outcome.wear));
}

export function applyEventOutcome(
  state: GameState,
  event: RaceEvent,
  outcome: RaceOutcome,
): { state: GameState; report: RaceReport } {
  const car = activeCar(state);
  const won = outcome.position === 1 && !outcome.exploded && !outcome.abandoned;
  const previousWins = state.eventWins[event.id] ?? 0;
  const firstWin = won && previousWins === 0;
  const classified = !outcome.exploded && !outcome.abandoned;

  const share = classified ? (PRIZE_SHARE_BY_POSITION[outcome.position - 1] ?? 0) : 0;
  const repeatFactor = previousWins > 0 ? 0.6 : 1;
  const { prize, weatherBonus } = withWeatherBonus(event.prize * share * repeatFactor * swagMultiplier(state.jewels), outcome);
  const respect = won ? (firstWin ? event.respect : Math.max(1, Math.round(event.respect * 0.2))) : 0;

  const rng = createRng(state.rngSeed);
  let nextUid = state.nextUid;
  let loot: Part | undefined;
  if (won && (firstWin || rng.chance(0.45))) {
    loot = rollPart(rng, `p${nextUid++}`, event.lootTier);
  }

  const conditionAfter = conditionAfterRace(car, outcome);
  let next: GameState = {
    ...replaceCar(state, { ...car, condition: conditionAfter }),
    money: Math.max(0, state.money - event.entryFee) + prize,
    respect: state.respect + respect,
    inventory: loot ? [...state.inventory, loot] : state.inventory,
    eventWins: won ? { ...state.eventWins, [event.id]: previousWins + 1 } : state.eventWins,
    rngSeed: rng.state(),
    nextUid,
    career: {
      ...state.career,
      races: state.career.races + 1,
      wins: state.career.wins + (won ? 1 : 0),
      explosions: state.career.explosions + (outcome.exploded ? 1 : 0),
    },
  };
  next = rollShop(next);

  const base: RaceReport = {
    kind: 'event',
    won,
    position: outcome.position,
    racers: outcome.racers,
    exploded: outcome.exploded,
    abandoned: outcome.abandoned,
    entryFee: event.entryFee,
    prize,
    ...(weatherBonus > 0 ? { weatherBonus } : {}),
    respect,
    conditionBefore: car.condition,
    conditionAfter,
    firstWin,
    gameCompleted: false,
  };
  return { state: next, report: loot ? { ...base, loot } : base };
}

export function applyBossOutcome(
  state: GameState,
  district: District,
  stakeUid: string,
  outcome: RaceOutcome,
): Result<{ state: GameState; report: RaceReport }> {
  const boss = district.boss;
  const stake = state.jewels.find((j) => j.uid === stakeUid);
  if (!stake) return err('Le bijou mis en jeu est introuvable.');
  if (jewelKind(stake.kindId).value < boss.minStake) return err('Ce bijou ne vaut pas assez.');

  const car = activeCar(state);
  const won = outcome.position === 1 && !outcome.exploded && !outcome.abandoned;
  const firstWin = won && !state.bossesBeaten.includes(boss.id);
  const conditionAfter = conditionAfterRace(car, outcome);

  let nextUid = state.nextUid;
  let jewels = state.jewels;
  let jewelWon: Jewel | undefined;
  let jewelLost: Jewel | undefined;
  if (won) {
    if (firstWin) {
      jewelWon = { uid: `j${nextUid++}`, kindId: boss.trophyKindId };
      jewels = [...jewels, jewelWon];
    }
  } else {
    jewelLost = stake;
    jewels = jewels.filter((j) => j.uid !== stakeUid);
  }

  const { prize, weatherBonus } = withWeatherBonus(
    won ? boss.prize * (firstWin ? 1 : 0.3) * swagMultiplier(state.jewels) : 0,
    outcome,
  );
  const respect = won ? (firstWin ? boss.respect : Math.round(boss.respect * 0.1)) : 0;

  let next: GameState = {
    ...replaceCar(state, { ...car, condition: conditionAfter }),
    money: state.money + prize,
    respect: state.respect + respect,
    jewels,
    bossesBeaten: firstWin ? [...state.bossesBeaten, boss.id] : state.bossesBeaten,
    nextUid,
    career: {
      races: state.career.races + 1,
      wins: state.career.wins + (won ? 1 : 0),
      explosions: state.career.explosions + (outcome.exploded ? 1 : 0),
      jewelsLost: state.career.jewelsLost + (jewelLost ? 1 : 0),
    },
  };
  next = rollShop(next);

  const nextDistrict = DISTRICTS[districtIndex(district.id) + 1];
  const report: RaceReport = {
    kind: 'boss',
    won,
    position: outcome.position,
    racers: outcome.racers,
    exploded: outcome.exploded,
    abandoned: outcome.abandoned,
    entryFee: 0,
    prize,
    ...(weatherBonus > 0 ? { weatherBonus } : {}),
    respect,
    conditionBefore: car.condition,
    conditionAfter,
    firstWin,
    gameCompleted: firstWin && hasWonGame(next),
    ...(jewelWon ? { jewelWon } : {}),
    ...(jewelLost ? { jewelLost } : {}),
    ...(firstWin && nextDistrict ? { unlockedDistrictId: nextDistrict.id } : {}),
  };
  return ok({ state: next, report });
}
