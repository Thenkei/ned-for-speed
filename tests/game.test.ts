import { describe, expect, it } from 'vitest';
import { CAR_MODELS } from '../src/domain/cars';
import {
  activeCar,
  applyBossOutcome,
  applyEventOutcome,
  bossRaceSetup,
  buyCar,
  buyJewel,
  buyPart,
  canChallengeBoss,
  canEnterEvent,
  effectiveStats,
  eligibleStakes,
  equipPart,
  eventRaceSetup,
  hasWonGame,
  isBossAvailable,
  isDistrictUnlocked,
  newGame,
  repairCar,
  repairCost,
  sellJewel,
  sellPart,
  transferParts,
  unequipSlot,
} from '../src/domain/game';
import { JEWEL_KINDS, jewelKind, swagMultiplier } from '../src/domain/jewels';
import { buildPart, rarityOdds, rollPart } from '../src/domain/parts';
import { createRng } from '../src/domain/rng';
import { RARITIES, type GameState, type RaceOutcome } from '../src/domain/types';
import { DISTRICTS } from '../src/domain/world';

const outcome = (overrides: Partial<RaceOutcome> = {}): RaceOutcome => ({
  position: 1,
  racers: 3,
  exploded: false,
  abandoned: false,
  time: 42,
  topSpeedKmh: 150,
  wear: 0,
  standings: [],
  ...overrides,
});

const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

const parking = DISTRICTS[0]!;
const rich = (state: GameState, money = 1_000_000): GameState => ({ ...state, money });

describe('new game', () => {
  const state = newGame(1);

  it('starts Ned with mamie’s car, a bodged nitro kit and one jewel to bet', () => {
    expect(activeCar(state).modelId).toBe('biquette');
    expect(effectiveStats(state, activeCar(state)).nitro).toBeGreaterThan(0);
    expect(state.jewels).toHaveLength(1);
    expect(eligibleStakes(state, parking.boss)).toHaveLength(1);
    expect(state.shop.parts).toHaveLength(8);
  });

  it('is reproducible from its seed', () => {
    expect(newGame(7)).toEqual(newGame(7));
    expect(newGame(7).shop.parts).not.toEqual(newGame(8).shop.parts);
  });

  it('can always afford the very first race', () => {
    expect(canEnterEvent(state, parking.events[0]!).ok).toBe(true);
    expect(parking.events[0]!.entryFee).toBe(0);
  });
});

describe('parts', () => {
  it('builds deterministic parts whose power grows with rarity', () => {
    const powers = RARITIES.map((rarity) => buildPart({ uid: 'x', slot: 'engine', rarity }).bonus.topSpeed ?? 0);
    expect([...powers].sort((a, b) => a - b)).toEqual(powers);
    expect(new Set(powers).size).toBe(RARITIES.length);
  });

  it('has rarity odds that sum to one at every tier', () => {
    for (let tier = 0; tier <= 4; tier++) {
      const total = Object.values(rarityOdds(tier)).reduce((sum, p) => sum + p, 0);
      expect(total).toBeCloseTo(1, 10);
    }
    expect(rarityOdds(0).legende).toBe(0);
  });

  it('rolls the same part from the same seed', () => {
    expect(rollPart(createRng(5), 'p', 2)).toEqual(rollPart(createRng(5), 'p', 2));
  });

  it('buys, equips, unequips and sells', () => {
    let state = rich(newGame(3));
    const part = state.shop.parts.find((p) => p.slot === 'engine')!;
    const before = effectiveStats(state, activeCar(state));
    state = unwrap(buyPart(state, part.uid));
    expect(state.money).toBe(1_000_000 - part.price);
    expect(state.shop.parts.some((p) => p.uid === part.uid)).toBe(false);

    state = unwrap(equipPart(state, state.activeCarUid, part.uid));
    expect(effectiveStats(state, activeCar(state)).topSpeed).toBeGreaterThan(before.topSpeed);
    expect(sellPart(state, part.uid).ok).toBe(false);

    state = unwrap(unequipSlot(state, state.activeCarUid, 'engine'));
    expect(effectiveStats(state, activeCar(state)).topSpeed).toBe(before.topSpeed);
    const sold = unwrap(sellPart(state, part.uid));
    expect(sold.money).toBeGreaterThan(state.money);
    expect(sold.inventory.some((p) => p.uid === part.uid)).toBe(false);
  });

  it('refuses a purchase Ned cannot afford', () => {
    const state = { ...newGame(3), money: 0 };
    expect(buyPart(state, state.shop.parts[0]!.uid).ok).toBe(false);
  });
});

describe('cars', () => {
  it('buys a car, makes it active and can move the parts across', () => {
    let state = rich(newGame(4));
    const oldUid = state.activeCarUid;
    state = unwrap(buyCar(state, 'furet'));
    expect(activeCar(state).modelId).toBe('furet');
    expect(buyCar(state, 'furet').ok).toBe(false);
    state = unwrap(transferParts(state, oldUid, state.activeCarUid));
    expect(activeCar(state).equipped.nitro).toBeDefined();
    expect(state.cars.find((c) => c.uid === oldUid)!.equipped.nitro).toBeUndefined();
  });

  it('keeps a part on a single car', () => {
    let state = rich(newGame(4));
    const oldUid = state.activeCarUid;
    const kit = state.inventory[0]!;
    state = unwrap(buyCar(state, 'furet'));
    state = unwrap(equipPart(state, state.activeCarUid, kit.uid));
    expect(state.cars.find((c) => c.uid === oldUid)!.equipped.nitro).toBeUndefined();
  });

  it('offers cars in increasing order of price and punch', () => {
    const prices = CAR_MODELS.map((m) => m.price);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });
});

describe('race results', () => {
  const event = parking.events[0]!;

  it('pays the prize, respect and a guaranteed part on a first win', () => {
    const state = newGame(9);
    const { state: next, report } = applyEventOutcome(state, event, outcome());
    expect(report.won).toBe(true);
    expect(report.firstWin).toBe(true);
    expect(next.money).toBe(state.money - event.entryFee + report.prize);
    expect(report.prize).toBe(Math.round(event.prize * swagMultiplier(state.jewels)));
    expect(next.respect).toBe(event.respect);
    expect(report.loot).toBeDefined();
    expect(next.inventory).toHaveLength(state.inventory.length + 1);
    expect(next.eventWins[event.id]).toBe(1);
    expect(next.shop.parts).not.toEqual(state.shop.parts);
  });

  it('pays less for a repeat win and nothing for a defeat', () => {
    const first = applyEventOutcome(newGame(9), event, outcome()).state;
    const repeat = applyEventOutcome(first, event, outcome());
    expect(repeat.report.prize).toBeLessThan(event.prize);
    expect(repeat.report.respect).toBeLessThan(event.respect);

    const lost = applyEventOutcome(newGame(9), event, outcome({ position: 3 }));
    expect(lost.report.won).toBe(false);
    expect(lost.report.respect).toBe(0);
    expect(lost.report.loot).toBeUndefined();
  });

  it('kills the engine on an explosion and blocks racing until repaired', () => {
    const { state, report } = applyEventOutcome(newGame(9), event, outcome({ exploded: true, position: 3 }));
    expect(report.conditionAfter).toBe(0);
    expect(report.prize).toBe(0);
    expect(state.career.explosions).toBe(1);
    expect(canEnterEvent(state, event).ok).toBe(false);
  });

  it('wears the engine when it ran in the red, without killing it', () => {
    const { report } = applyEventOutcome(newGame(9), event, outcome({ wear: 500 }));
    expect(report.conditionAfter).toBe(5);
  });

  it('repairs fully when Ned can pay, and bodges it when he is broke', () => {
    const blown = applyEventOutcome(newGame(9), event, outcome({ exploded: true })).state;
    const cost = repairCost(activeCar(blown));
    const paid = unwrap(repairCar(rich(blown, cost), blown.activeCarUid));
    expect(activeCar(paid).condition).toBe(100);
    expect(paid.money).toBe(0);

    const broke = unwrap(repairCar({ ...blown, money: 3 }, blown.activeCarUid));
    expect(activeCar(broke).condition).toBe(45);
    expect(broke.money).toBe(0);
    expect(canEnterEvent(broke, event).ok).toBe(true);
  });

  it('coaches only Ned’s first two races', () => {
    let state = newGame(9);
    expect(eventRaceSetup(state, parking, event).coach).toBe(true);
    state = applyEventOutcome(state, event, outcome()).state;
    expect(eventRaceSetup(state, parking, event).coach).toBe(true);
    state = applyEventOutcome(state, event, outcome()).state;
    expect(eventRaceSetup(state, parking, event).coach).toBe(false);
  });

  it('builds a race setup with every rival', () => {
    const state = newGame(9);
    const setup = eventRaceSetup(state, parking, event);
    expect(setup.rivals).toHaveLength(event.rivals.length);
    expect(setup.player.name).toBe('Ned');
    expect(setup.trackId).toBe(parking.trackId);
  });
});

describe('bosses and jewels', () => {
  const clearDistrict = (state: GameState, index: number): GameState => {
    let next = state;
    for (const event of DISTRICTS[index]!.events) next = applyEventOutcome(next, event, outcome()).state;
    return next;
  };

  it('locks the boss until every event of the district is won', () => {
    let state = newGame(11);
    expect(isBossAvailable(state, parking)).toBe(false);
    expect(canChallengeBoss(state, parking).ok).toBe(false);
    state = clearDistrict(state, 0);
    expect(isBossAvailable(state, parking)).toBe(true);
    expect(canChallengeBoss(state, parking).ok).toBe(true);
  });

  it('hands over the boss trophy on a win and opens the next district', () => {
    const state = clearDistrict(newGame(11), 0);
    const stake = eligibleStakes(state, parking.boss)[0]!;
    const { state: next, report } = unwrap(applyBossOutcome(state, parking, stake.uid, outcome({ racers: 2 })));
    expect(report.won).toBe(true);
    expect(report.jewelWon?.kindId).toBe(parking.boss.trophyKindId);
    expect(next.jewels).toHaveLength(state.jewels.length + 1);
    expect(next.bossesBeaten).toEqual([parking.boss.id]);
    expect(report.unlockedDistrictId).toBe(DISTRICTS[1]!.id);
    expect(isDistrictUnlocked(next, DISTRICTS[1]!)).toBe(true);
    expect(isDistrictUnlocked(next, DISTRICTS[2]!)).toBe(false);
  });

  it('takes the staked jewel on a defeat', () => {
    const state = clearDistrict(newGame(11), 0);
    const stake = eligibleStakes(state, parking.boss)[0]!;
    const { state: next, report } = unwrap(applyBossOutcome(state, parking, stake.uid, outcome({ position: 2, racers: 2 })));
    expect(report.jewelLost?.uid).toBe(stake.uid);
    expect(next.jewels.some((j) => j.uid === stake.uid)).toBe(false);
    expect(next.bossesBeaten).toHaveLength(0);
    expect(next.career.jewelsLost).toBe(1);
    expect(canChallengeBoss(next, parking).ok).toBe(false);
  });

  it('rejects a stake that is not worth enough', () => {
    const state = clearDistrict(newGame(11), 0);
    const zi = DISTRICTS[1]!;
    expect(applyBossOutcome(state, zi, state.jewels[0]!.uid, outcome()).ok).toBe(false);
  });

  it('sells jewels at a loss but never a trophy', () => {
    let state = rich(newGame(11));
    state = unwrap(buyJewel(state, 'chaine'));
    const chain = state.jewels.find((j) => j.kindId === 'chaine')!;
    const sold = unwrap(sellJewel(state, chain.uid));
    expect(sold.money - state.money).toBeLessThan(jewelKind('chaine').value);
    expect(buyJewel(state, 'trophy-jacky').ok).toBe(false);
    const withTrophy = { ...state, jewels: [...state.jewels, { uid: 'jt', kindId: 'trophy-kevin' }] };
    expect(sellJewel(withTrophy, 'jt').ok).toBe(false);
  });

  it('lets each boss trophy pay for the next boss’s stake', () => {
    DISTRICTS.slice(1).forEach((district, i) => {
      const previousTrophy = jewelKind(DISTRICTS[i]!.boss.trophyKindId);
      expect(previousTrophy.value).toBeGreaterThanOrEqual(district.boss.minStake);
    });
    expect(JEWEL_KINDS.filter((k) => k.trophy)).toHaveLength(DISTRICTS.length);
  });

  it('completes the game once the five bosses are beaten', () => {
    let state = newGame(11);
    let lastReport;
    for (let i = 0; i < DISTRICTS.length; i++) {
      const district = DISTRICTS[i]!;
      state = clearDistrict(state, i);
      const stake = eligibleStakes(state, district.boss)[0]!;
      expect(bossRaceSetup(state, district).rivals).toHaveLength(1);
      const result = unwrap(applyBossOutcome(state, district, stake.uid, outcome({ racers: 2 })));
      state = result.state;
      lastReport = result.report;
    }
    expect(hasWonGame(state)).toBe(true);
    expect(lastReport?.gameCompleted).toBe(true);
  });
});
