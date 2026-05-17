import {
  DRUGS, LOCATIONS, START_CASH, START_DEBT, START_CAPACITY,
  START_HP, START_GUNS, type DrugId,
} from './data';

export type Phase =
  | 'title'           // pre-game splash
  | 'playing'         // in market
  | 'event'           // showing a random event modal
  | 'fighting_cops'   // cop chase active
  | 'game_over'
  | 'leaderboard';

export interface Market {
  // Today's prices for each drug at the current location.
  // A drug may be absent today (not for sale here).
  prices: Partial<Record<DrugId, number>>;
}

export interface PlayerInv {
  // Quantity of each drug player owns.
  drugs: Record<DrugId, number>;
}

export interface GameState {
  phase: Phase;
  seed: number;

  // Time
  day: number;          // 1-indexed
  totalDays: number;    // e.g. 30

  // Player resources
  cash: number;
  debt: number;
  bank: number;
  hp: number;
  guns: number;
  capacity: number;     // trench coat size
  inv: PlayerInv;

  // World
  locationId: string;
  market: Market;

  // UI / log
  log: string[];

  // Stats for end-screen
  highCash: number;     // peak cash + bank value (for net worth)
}

export function emptyInv(): PlayerInv {
  const d = {} as Record<DrugId, number>;
  for (const drug of DRUGS) d[drug.id] = 0;
  return { drugs: d };
}

export function makeInitialState(seed: number, totalDays: number): GameState {
  return {
    phase: 'title',
    seed,
    day: 1,
    totalDays,
    cash: START_CASH,
    debt: START_DEBT,
    bank: 0,
    hp: START_HP,
    guns: START_GUNS,
    capacity: START_CAPACITY,
    inv: emptyInv(),
    locationId: LOCATIONS[0].id,
    market: { prices: {} },
    log: [],
    highCash: START_CASH,
  };
}

export function inventoryUsed(s: GameState): number {
  let u = 0;
  for (const drug of DRUGS) u += s.inv.drugs[drug.id];
  // Guns also take 1 slot each in the original; we'll do 5 per gun for weight.
  u += s.guns * 5;
  return u;
}

export function inventoryFree(s: GameState): number {
  return Math.max(0, s.capacity - inventoryUsed(s));
}

export function netWorth(s: GameState): number {
  return s.cash + s.bank - s.debt;
}
