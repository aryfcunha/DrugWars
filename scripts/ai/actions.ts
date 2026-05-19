// Discretized action enumeration.
//
// The reducer accepts continuous-quantity BUY/SELL/PAY_LOAN/etc. — way too
// large an action space for tree search. We discretize to a small set of
// semantically-meaningful "macro" actions that an MCTS / policy network can
// reason about. The macros expand to the right reducer action at apply time.

import {
  type Action, type FullState, LOCATIONS,
} from './sim.ts';
import { DRUGS, type DrugId } from '../../src/game/data.ts';
import { inventoryFree } from '../../src/game/state.ts';

// ────────────────────────────────────────────────────────────────────────────
// Macro action types
// ────────────────────────────────────────────────────────────────────────────

export type Macro =
  | { kind: 'BUY_MAX'; drug: DrugId }              // buy as much as cash + capacity allow
  | { kind: 'BUY_HALF'; drug: DrugId }             // buy half of max-affordable
  | { kind: 'SELL_ALL'; drug: DrugId }             // sell entire holding
  | { kind: 'SELL_HALF'; drug: DrugId }
  | { kind: 'TRAVEL'; locationId: string }
  | { kind: 'BUY_COAT' }
  | { kind: 'PAY_DEBT_ALL' }                       // Bronx: pay min(cash, debt)
  | { kind: 'DEPOSIT_ALL' }                        // Bronx: deposit all cash
  | { kind: 'WITHDRAW_ALL' }                       // Bronx: withdraw all bank
  | { kind: 'FIGHT' }
  | { kind: 'RUN' }
  | { kind: 'ACCEPT_OFFER' }
  | { kind: 'DECLINE_OFFER' }
  | { kind: 'RETIRE' };                            // endless mode: cash out

/** All legal macros from a given state. Order is deterministic. */
export function legalActions(s: FullState): Macro[] {
  if (s.phase === 'game_over') return [];

  // Cop fight: only FIGHT (if guns) / RUN
  if (s.phase === 'fighting_cops') {
    const out: Macro[] = [{ kind: 'RUN' }];
    if (s.guns > 0) out.unshift({ kind: 'FIGHT' });
    return out;
  }

  // Event with offer (e.g. gun for sale): ACCEPT / DECLINE
  if (s.phase === 'event' && s.pendingEventGenerated?.offer) {
    return [{ kind: 'ACCEPT_OFFER' }, { kind: 'DECLINE_OFFER' }];
  }

  // Trading phase
  const out: Macro[] = [];

  // BUY / SELL per drug present in market
  for (const drug of DRUGS) {
    const price = s.market.prices[drug.id];
    const have = s.inv.drugs[drug.id];
    if (price != null) {
      const maxByCash = Math.floor(s.cash / price);
      const maxByCap = inventoryFree(s);
      const maxBuy = Math.min(maxByCash, maxByCap);
      if (maxBuy >= 1) out.push({ kind: 'BUY_MAX', drug: drug.id });
      if (maxBuy >= 2) out.push({ kind: 'BUY_HALF', drug: drug.id });
      if (have > 0) out.push({ kind: 'SELL_ALL', drug: drug.id });
      if (have > 1) out.push({ kind: 'SELL_HALF', drug: drug.id });
    } else if (have > 0) {
      // Drug present in inventory but not in market: cannot sell.
    }
  }

  // TRAVEL to any other location (this is what advances the day)
  for (const loc of LOCATIONS) {
    if (loc.id !== s.locationId) out.push({ kind: 'TRAVEL', locationId: loc.id });
  }

  // Buy coat (small capacity upgrade)
  if (s.cash >= 200) out.push({ kind: 'BUY_COAT' });

  // Bronx-only banking
  if (s.locationId === 'bronx') {
    if (s.cash > 0 && s.debt > 0) out.push({ kind: 'PAY_DEBT_ALL' });
    if (s.cash > 0) out.push({ kind: 'DEPOSIT_ALL' });
    if (s.bank > 0) out.push({ kind: 'WITHDRAW_ALL' });
  }

  // Endless retire (cash-out)
  if (s.mode === 'endless') out.push({ kind: 'RETIRE' });

  return out;
}

/** Convert a macro into one or more reducer actions to apply in sequence.
 *  The simulator applies these atomically via apply(state, macro). */
export function apply(s: FullState, m: Macro): Action[] {
  switch (m.kind) {
    case 'BUY_MAX': {
      const price = s.market.prices[m.drug] ?? Infinity;
      const qty = Math.min(Math.floor(s.cash / price), inventoryFree(s));
      return qty > 0 ? [{ type: 'BUY', drug: m.drug, qty }] : [];
    }
    case 'BUY_HALF': {
      const price = s.market.prices[m.drug] ?? Infinity;
      const qty = Math.floor(Math.min(Math.floor(s.cash / price), inventoryFree(s)) / 2);
      return qty > 0 ? [{ type: 'BUY', drug: m.drug, qty }] : [];
    }
    case 'SELL_ALL':
      return [{ type: 'SELL', drug: m.drug, qty: s.inv.drugs[m.drug] }];
    case 'SELL_HALF':
      return [{ type: 'SELL', drug: m.drug, qty: Math.floor(s.inv.drugs[m.drug] / 2) }];
    case 'TRAVEL':
      return [{ type: 'TRAVEL', locationId: m.locationId }];
    case 'BUY_COAT':
      return [{ type: 'BUY_COAT' }];
    case 'PAY_DEBT_ALL':
      return [{ type: 'PAY_LOAN', amount: Math.min(s.cash, s.debt) }];
    case 'DEPOSIT_ALL':
      return [{ type: 'DEPOSIT', amount: s.cash }];
    case 'WITHDRAW_ALL':
      return [{ type: 'WITHDRAW', amount: s.bank }];
    case 'FIGHT':       return [{ type: 'FIGHT' }];
    case 'RUN':         return [{ type: 'RUN' }];
    case 'ACCEPT_OFFER':return [{ type: 'EVENT_ACCEPT_OFFER' }];
    case 'DECLINE_OFFER':return [{ type: 'EVENT_DECLINE_OFFER' }];
    case 'RETIRE':      return [{ type: 'RETIRE' }];
  }
}

export function describe(m: Macro): string {
  switch (m.kind) {
    case 'BUY_MAX':       return `buy-max ${m.drug}`;
    case 'BUY_HALF':      return `buy-half ${m.drug}`;
    case 'SELL_ALL':      return `sell-all ${m.drug}`;
    case 'SELL_HALF':     return `sell-half ${m.drug}`;
    case 'TRAVEL':        return `travel→${m.locationId}`;
    case 'BUY_COAT':      return 'buy-coat';
    case 'PAY_DEBT_ALL':  return 'pay-debt';
    case 'DEPOSIT_ALL':   return 'deposit';
    case 'WITHDRAW_ALL':  return 'withdraw';
    case 'FIGHT':         return 'fight';
    case 'RUN':           return 'run';
    case 'ACCEPT_OFFER':  return 'accept';
    case 'DECLINE_OFFER': return 'decline';
    case 'RETIRE':        return 'retire';
  }
}
