import {
  DEBT_INTEREST, BANK_INTEREST, LOCATION_BY_ID, TRENCH_COAT_COST,
  TRENCH_COAT_BONUS, DRUGS, type DrugId,
} from './data';
import { type GameState, type GameMode, makeInitialState, inventoryFree, inventoryUsed, netWorth } from './state';
import { makeRng, makeSeed, type Rng } from './rng';
import { generateMarket, type MarketModifiers } from './market';
import { rollEvent, type GeneratedEvent } from './events';
import { newFight, fightRound, runRound, type CopFight } from './copFight';

export type Action =
  | { type: 'NEW_GAME'; totalDays: number; mode: GameMode; seed?: number }
  | { type: 'START_GAME' }
  | { type: 'RETIRE' }
  | { type: 'BUY'; drug: DrugId; qty: number }
  | { type: 'SELL'; drug: DrugId; qty: number }
  | { type: 'TRAVEL'; locationId: string }
  | { type: 'EVENT_OK' }                    // dismiss event modal
  | { type: 'EVENT_ACCEPT_OFFER' }          // accept event offer
  | { type: 'EVENT_DECLINE_OFFER' }
  | { type: 'FIGHT' }                       // cop fight round
  | { type: 'RUN' }                         // run from cops
  | { type: 'COP_FIGHT_CONTINUE' }          // dismiss intermediate log
  | { type: 'PAY_LOAN'; amount: number }    // Bronx-only
  | { type: 'DEPOSIT'; amount: number }     // Bronx-only
  | { type: 'WITHDRAW'; amount: number }    // Bronx-only
  | { type: 'BUY_COAT' }                    // any time? (original was an event) — we'll allow at end of day
  | { type: 'TO_LEADERBOARD' }
  | { type: 'BACK_TO_TITLE' };

// Extended state: includes ephemeral combat state and the modifiers used for
// the current market — we keep them outside core state for clarity but in the
// same object so React renders them as one unit.
export interface FullState extends GameState {
  fight: CopFight | null;
  pendingMarketMods: MarketModifiers | null;
  pendingEventGenerated: GeneratedEvent | null;
  fightLogIndex: number; // last index of fight.log player has seen
}

export function makeFullInitial(totalDays = 30, seed = makeSeed(), mode: GameMode = 'fixed'): FullState {
  return {
    ...makeInitialState(seed, totalDays, mode),
    fight: null,
    pendingMarketMods: null,
    pendingEventGenerated: null,
    fightLogIndex: 0,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function addLog(s: FullState, line: string): FullState {
  return { ...s, log: [...s.log.slice(-50), line] };
}

function applyEventEffects(s: FullState, ev: GeneratedEvent): FullState {
  let next: FullState = { ...s };
  if (ev.cashDelta) next.cash = Math.max(0, next.cash + ev.cashDelta);
  if (ev.hpDelta) next.hp = clamp(next.hp + ev.hpDelta, 0, 100);
  if (ev.gunsDelta) next.guns = Math.max(0, next.guns + ev.gunsDelta);
  if (ev.capacityDelta) next.capacity = Math.max(0, next.capacity + ev.capacityDelta);
  if (ev.drugDelta) {
    const drugs = { ...next.inv.drugs };
    for (const [k, v] of Object.entries(ev.drugDelta) as [DrugId, number][]) {
      drugs[k] = Math.max(0, (drugs[k] ?? 0) + v);
    }
    next.inv = { drugs };
  }
  next.highCash = Math.max(next.highCash, next.cash + next.bank);
  return next;
}

function checkDeath(s: FullState): FullState {
  if (s.hp <= 0) {
    return addLog({ ...s, phase: 'game_over' }, 'You died on the streets...');
  }
  return s;
}

function advanceArrival(s: FullState, rng: Rng): FullState {
  // Called when entering a location (including initial start and after travel).
  // 1) Roll for an event.
  // 2) Build market modifiers based on event.
  // 3) Generate prices.
  const loc = LOCATION_BY_ID[s.locationId];
  const hasDrugs = DRUGS.some(d => s.inv.drugs[d.id] > 0);
  // In endless mode, cop risk ramps after day 30 (1.0× → up to 2.5×).
  const dayMultiplier =
    s.mode === 'endless'
      ? Math.min(2.5, 1 + Math.max(0, s.day - 30) * 0.02)
      : 1;
  const ev = rollEvent(rng, {
    copRisk: Math.min(0.7, loc.copRisk * dayMultiplier),
    hasDrugs,
    guns: s.guns,
    cash: s.cash,
  });

  const mods: MarketModifiers = {};
  if (ev?.priceMult) mods.multipliers = ev.priceMult;
  if (ev?.forcePresent) mods.forcePresent = ev.forcePresent;

  const market = generateMarket(rng, mods);

  if (ev) {
    if (ev.startCopFight) {
      return {
        ...s,
        market,
        pendingMarketMods: mods,
        pendingEventGenerated: ev,
        phase: 'event',
      };
    }
    return {
      ...s,
      market,
      pendingMarketMods: mods,
      pendingEventGenerated: ev,
      phase: 'event',
    };
  }
  return {
    ...s,
    market,
    pendingMarketMods: null,
    pendingEventGenerated: null,
    phase: 'playing',
  };
}

export function reducer(state: FullState, action: Action): FullState {
  const rng = makeRng(state.seed + state.day * 1000 + state.log.length);
  switch (action.type) {
    case 'NEW_GAME': {
      return makeFullInitial(action.totalDays, action.seed ?? makeSeed(), action.mode);
    }
    case 'RETIRE': {
      if (state.mode !== 'endless') return state;
      return addLog({ ...state, phase: 'game_over' }, `Retired on day ${state.day} with ${netWorth(state) >= 0 ? '$' : '-$'}${Math.abs(netWorth(state)).toLocaleString()}.`);
    }
    case 'START_GAME': {
      // Generate first market (with possible event)
      const fresh = advanceArrival({ ...state, phase: 'playing' }, rng);
      return addLog(fresh, `Day 1 — arrived at ${LOCATION_BY_ID[fresh.locationId].name}.`);
    }
    case 'BUY': {
      const price = state.market.prices[action.drug];
      if (price == null) return state;
      const free = inventoryFree(state);
      const maxByCash = Math.floor(state.cash / price);
      const qty = Math.min(action.qty, free, maxByCash);
      if (qty <= 0) return state;
      const drugs = { ...state.inv.drugs };
      drugs[action.drug] += qty;
      return addLog({
        ...state,
        cash: state.cash - qty * price,
        inv: { drugs },
      }, `Bought ${qty} ${action.drug} @ $${price}`);
    }
    case 'SELL': {
      const price = state.market.prices[action.drug];
      if (price == null) return state;
      const have = state.inv.drugs[action.drug];
      const qty = Math.min(action.qty, have);
      if (qty <= 0) return state;
      const drugs = { ...state.inv.drugs };
      drugs[action.drug] -= qty;
      const proceeds = qty * price;
      const cash = state.cash + proceeds;
      return addLog({
        ...state,
        cash,
        inv: { drugs },
        highCash: Math.max(state.highCash, cash + state.bank),
      }, `Sold ${qty} ${action.drug} @ $${price} (+$${proceeds})`);
    }
    case 'TRAVEL': {
      if (action.locationId === state.locationId) return state;
      // Advance day.
      let next: FullState = {
        ...state,
        locationId: action.locationId,
        day: state.day + 1,
        debt: Math.round(state.debt * (1 + DEBT_INTEREST)),
        bank: Math.round(state.bank * (1 + BANK_INTEREST)),
      };
      if (state.mode === 'fixed' && next.day > next.totalDays) {
        // Game over by time (fixed mode only)
        return addLog({ ...next, phase: 'game_over' }, `Day ${state.totalDays} — your time is up.`);
      }
      next = addLog(next, `Day ${next.day} — traveled to ${LOCATION_BY_ID[action.locationId].name}.`);
      return advanceArrival(next, rng);
    }
    case 'EVENT_OK': {
      const ev = state.pendingEventGenerated;
      if (!ev) return { ...state, phase: 'playing' };
      if (ev.startCopFight) {
        const fight = newFight(ev.startCopFight.guns);
        return {
          ...state,
          phase: 'fighting_cops',
          fight,
          fightLogIndex: fight.log.length, // start showing from here
          pendingEventGenerated: null,
        };
      }
      // Apply effects, then check whether market still valid (effects don't
      // regen market, since modifiers were applied at arrival time)
      let next = applyEventEffects(state, ev);
      next = { ...next, pendingEventGenerated: null, pendingMarketMods: null, phase: 'playing' };
      next = checkDeath(next);
      return next;
    }
    case 'EVENT_ACCEPT_OFFER': {
      const ev = state.pendingEventGenerated;
      if (!ev?.offer) return state;
      // Verify affordability
      const cost = -(ev.offer.accept.cashDelta ?? 0);
      if (cost > state.cash) return state;
      let next = applyEventEffects(state, {
        ...ev,
        cashDelta: ev.offer.accept.cashDelta,
        gunsDelta: ev.offer.accept.gunsDelta,
        capacityDelta: ev.offer.accept.capacityDelta,
      });
      next = { ...next, pendingEventGenerated: null, phase: 'playing' };
      return checkDeath(next);
    }
    case 'EVENT_DECLINE_OFFER': {
      return { ...state, pendingEventGenerated: null, phase: 'playing' };
    }
    case 'FIGHT': {
      if (!state.fight) return state;
      const res = fightRound(rng, state.fight, state.guns, state.hp);
      let next: FullState = { ...state, fight: res.fight, hp: res.hp };
      if (res.resolved === 'dead') {
        next = checkDeath(next);
      } else if (res.resolved === 'win') {
        // Maybe drop money/guns when killing cops
        const loot = rng.int(50, 400) * state.guns;
        next = addLog({ ...next, fight: null, phase: 'playing', cash: next.cash + loot }, `Won the firefight! Looted $${loot}.`);
      }
      return next;
    }
    case 'RUN': {
      if (!state.fight) return state;
      const res = runRound(rng, state.fight, state.hp);
      let next: FullState = { ...state, fight: res.fight, hp: res.hp };
      if (res.resolved === 'dead') {
        next = checkDeath(next);
      } else if (res.escape) {
        // Drop a random drug as you flee
        const carriedIds = DRUGS.filter(d => state.inv.drugs[d.id] > 0).map(d => d.id);
        if (carriedIds.length > 0) {
          const dropped = rng.pick(carriedIds);
          const dropQty = Math.min(state.inv.drugs[dropped], rng.int(1, 5));
          const drugs = { ...next.inv.drugs };
          drugs[dropped] = Math.max(0, drugs[dropped] - dropQty);
          next = addLog({ ...next, inv: { drugs }, fight: null, phase: 'playing' }, `Escaped! Dropped ${dropQty} ${dropped}.`);
        } else {
          next = addLog({ ...next, fight: null, phase: 'playing' }, 'Escaped clean.');
        }
      }
      return next;
    }
    case 'COP_FIGHT_CONTINUE': {
      if (!state.fight) return state;
      return { ...state, fightLogIndex: state.fight.log.length };
    }
    case 'PAY_LOAN': {
      if (state.locationId !== 'bronx') return state;
      const amt = Math.min(action.amount, state.cash, state.debt);
      if (amt <= 0) return state;
      return addLog({ ...state, cash: state.cash - amt, debt: state.debt - amt }, `Paid loan shark $${amt}.`);
    }
    case 'DEPOSIT': {
      if (state.locationId !== 'bronx') return state;
      const amt = Math.min(action.amount, state.cash);
      if (amt <= 0) return state;
      return addLog({ ...state, cash: state.cash - amt, bank: state.bank + amt }, `Deposited $${amt}.`);
    }
    case 'WITHDRAW': {
      if (state.locationId !== 'bronx') return state;
      const amt = Math.min(action.amount, state.bank);
      if (amt <= 0) return state;
      return addLog({ ...state, cash: state.cash + amt, bank: state.bank - amt }, `Withdrew $${amt}.`);
    }
    case 'BUY_COAT': {
      if (state.cash < TRENCH_COAT_COST) return state;
      return addLog({
        ...state,
        cash: state.cash - TRENCH_COAT_COST,
        capacity: state.capacity + TRENCH_COAT_BONUS,
      }, `Bought trench coat (+${TRENCH_COAT_BONUS} capacity)`);
    }
    case 'TO_LEADERBOARD': return { ...state, phase: 'leaderboard' };
    case 'BACK_TO_TITLE': return makeFullInitial(state.totalDays, makeSeed(), state.mode);
  }
}

export { inventoryFree, inventoryUsed, netWorth };
