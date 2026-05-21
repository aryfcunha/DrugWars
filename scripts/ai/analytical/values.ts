// Expected-value calculations for analytical agent.
// All EVs are in dollars unless noted. "turns" = remaining days in fixed mode.

import { DRUGS, DRUG_BY_ID, LOCATIONS, BANK_INTEREST, DEBT_INTEREST, TRENCH_COAT_COST, TRENCH_COAT_BONUS, type DrugId } from '../../../src/game/data';
import { inventoryFree, type GameState } from '../../../src/game/state';
import type { FullState } from '../sim';
import type { CombatTable } from './combat';
import { lookup } from './combat';

// ─── Price priors ──────────────────────────────────────────────────────────
// E[price] when present is the uniform midpoint between min and max.
// E[best price observed over N future visits] for buying = min(N draws of U[min,max]).
// E[best price for selling] = max(N draws).

export function drugMidpoint(d: DrugId): number {
  const drug = DRUG_BY_ID[d];
  return (drug.min + drug.max) / 2;
}

// E[min of N uniform draws on [a,b]] = a + (b-a)/(N+1)
// E[max of N uniform draws on [a,b]] = a + N(b-a)/(N+1)
function eMinUniform(a: number, b: number, n: number): number {
  return a + (b - a) / (n + 1);
}
function eMaxUniform(a: number, b: number, n: number): number {
  return a + n * (b - a) / (n + 1);
}

// Drug present probability per location per turn (events.ts): 0.75 baseline.
// So E[markets where drug appears in N turns] ≈ 0.75 * N.
const DRUG_PRESENT_P = 0.75;

function expectedFutureMarketDraws(turns: number): number {
  return Math.max(1, DRUG_PRESENT_P * turns);
}

// ─── Cop encounter expectations ────────────────────────────────────────────

const AVG_COP_RISK = LOCATIONS.reduce((s, l) => s + l.copRisk, 0) / LOCATIONS.length;
// ≈ 0.11 average cop encounter rate (gated on hasDrugs)

// Probability of at least one cop encounter over N turns, given player carries drugs
export function pCopEncounter(turns: number, hasDrugs: boolean): number {
  if (!hasDrugs) return 0;
  const perTurn = AVG_COP_RISK;
  return 1 - Math.pow(1 - perTurn, turns);
}

// E[cops spawned] when an encounter happens (uniform 2-6 → 4)
export const E_COPS_PER_ENCOUNTER = 4;

// ─── Mugger expectation ────────────────────────────────────────────────────
// 5% per turn, U(50, 400) → E=$225
export const MUGGER_P = 0.05;
export const MUGGER_E = 225;

// ─── Trading EVs ───────────────────────────────────────────────────────────

export interface DrugBuyEV {
  drug: DrugId;
  perUnit: number;      // E[profit per unit] if we buy now
  pricePresent: number; // current price
  spread: number;       // E[future_sell_price] - current_price
  margin: number;       // spread / current_price (relative)
}

/** EV of buying one unit of drug at current price, holding it, and selling at
 *  the best of N future market draws. */
export function drugBuyEV(state: FullState, drug: DrugId, turnsRemaining: number): DrugBuyEV | null {
  const price = state.market.prices[drug];
  if (price == null) return null;
  const d = DRUG_BY_ID[drug];
  const futureMarkets = expectedFutureMarketDraws(turnsRemaining);
  // E[best sell price] = max of futureMarkets uniform draws on [min,max]
  const eBestSell = eMaxUniform(d.min, d.max, futureMarkets);
  const perUnit = eBestSell - price;
  return {
    drug,
    perUnit,
    pricePresent: price,
    spread: perUnit,
    margin: perUnit / price,
  };
}

/** EV of selling current holdings now vs. holding for better future price. */
export function drugSellEV(state: FullState, drug: DrugId, turnsRemaining: number): { sellNow: boolean; ev: number; eBestFuture: number } | null {
  const price = state.market.prices[drug];
  const have = state.inv.drugs[drug];
  if (price == null || have <= 0) return null;
  const d = DRUG_BY_ID[drug];
  const futureMarkets = expectedFutureMarketDraws(turnsRemaining);
  const eBestSell = eMaxUniform(d.min, d.max, futureMarkets);
  // Sell now if current price beats E[best future], accounting for opportunity cost of capital tied up
  const sellNow = price >= eBestSell * 0.95; // 5% slack for capital lockup + cop drop risk
  const ev = (price - eBestSell) * have;
  return { sellNow, ev, eBestFuture: eBestSell };
}

// ─── Coat EV ───────────────────────────────────────────────────────────────
// E[profit per slot per turn] = avg drug margin × P(profitable trade available)
// We use a conservative estimate based on typical mid-tier drug spreads.

const E_PROFIT_PER_SLOT_PER_TURN = 80;
// Justification: a free slot is worth ~U(min,max) sell - U(min,max) buy averaged
// across drugs. Weighted to mid-tier (acid/weed) since high-tier ones rarely fill.
// Empirical: should be re-calibrated after first sim run.

export function coatEV(state: FullState, turnsRemaining: number): number {
  if (turnsRemaining <= 0) return -TRENCH_COAT_COST;
  return TRENCH_COAT_BONUS * E_PROFIT_PER_SLOT_PER_TURN * turnsRemaining - TRENCH_COAT_COST;
}

// ─── Gun EV (from offer) ──────────────────────────────────────────────────

const E_INVENTORY_LOSS_IF_LOSE_FIGHT = 5000;
// Rough estimate: if you die you lose everything. P(die) is small if guns ≥ 2.

export function gunOfferEV(state: FullState, gunCost: number, turnsRemaining: number, combatTable: CombatTable): number {
  const hasDrugs = inventoryFree(state) < state.capacity;
  const pEnc = pCopEncounter(turnsRemaining, hasDrugs);
  const cops = E_COPS_PER_ENCOUNTER;
  const fightCur = lookup(combatTable, 'fight', cops, state.hp, state.guns);
  const fightNew = lookup(combatTable, 'fight', cops, state.hp, state.guns + 1);
  // Marginal benefit: change in P(survive fight) × value of survival, plus extra loot.
  // If current best is run (guns=0 or run pWin > fight pWin), gun changes the optimal action.
  const runCur = lookup(combatTable, 'run', cops, state.hp, state.guns);
  const bestCurP = Math.max(fightCur.pWin, runCur.pWin);
  const bestNewP = Math.max(fightNew.pWin, runCur.pWin);
  const dP = bestNewP - bestCurP;
  const lootDelta = fightNew.eLoot - fightCur.eLoot;
  const survivalValue = dP * (state.cash + state.bank); // dying loses cash+bank
  const expectedValue = pEnc * (survivalValue + Math.max(0, lootDelta) * 0.5);
  return expectedValue - gunCost;
}

// ─── Combat decision ──────────────────────────────────────────────────────

export interface CombatDecision {
  action: 'FIGHT' | 'RUN';
  eFightOutcome: number;  // E[net worth after fight]
  eRunOutcome: number;    // E[net worth after run]
}

export function fightVsRunEV(state: FullState, cops: number, combatTable: CombatTable): CombatDecision {
  const wealthAtStake = state.cash + state.bank;
  const inventoryValue = estimateInventoryValue(state);

  const fight = lookup(combatTable, 'fight', cops, state.hp, state.guns);
  const run = lookup(combatTable, 'run', cops, state.hp, state.guns);

  // Fight: P(win) × (wealth + inventory + loot) + (1-P(win)) × 0 (dead loses all)
  const eFight = fight.pWin * (wealthAtStake + inventoryValue + fight.eLoot);
  // Run: P(escape) × (wealth + inventory - drug drop loss) + (1-P(escape)) × 0
  const dropLoss = run.eDrops * 200; // ~$200 avg per drug unit (very rough)
  const eRun = run.pWin * (wealthAtStake + inventoryValue - dropLoss);

  return {
    action: eFight > eRun ? 'FIGHT' : 'RUN',
    eFightOutcome: eFight,
    eRunOutcome: eRun,
  };
}

export function estimateInventoryValue(state: GameState): number {
  let v = 0;
  for (const d of DRUGS) {
    const qty = state.inv.drugs[d.id];
    if (qty > 0) v += qty * drugMidpoint(d.id);
  }
  return v;
}

// ─── Banking policy ───────────────────────────────────────────────────────
// Decisions per Bronx visit:
//   1. PAY_DEBT_ALL: always wins (10%>5%) — no EV check needed
//   2. DEPOSIT_ALL: deposit if cash is "excess" (no profitable buy available now)
//   3. WITHDRAW_ALL: withdraw if there's a current high-EV buy and we need cash

export interface BankingDecision {
  payDebt: boolean;
  deposit: boolean;
  withdraw: boolean;
  reason: string;
}

const E_TURNS_TO_NEXT_BRONX = 4;
// Empirical estimate — will recalibrate from sim. Bronx is 1 of 6 locations.

export function bankingPolicy(state: FullState, turnsRemaining: number): BankingDecision {
  if (state.locationId !== 'bronx') {
    return { payDebt: false, deposit: false, withdraw: false, reason: 'not in bronx' };
  }

  // (1) Pay debt first — 10%/day strictly dominates 5%/day bank
  if (state.debt > 0 && state.cash > 0) {
    return { payDebt: true, deposit: false, withdraw: false, reason: 'debt @ 10%/day > bank @ 5%/day' };
  }

  // Is there a profitable buy on the current market?
  const bestBuy = bestDrugBuy(state, turnsRemaining);
  const hasGoodBuy = bestBuy != null && bestBuy.margin > 0.20; // >20% expected margin
  const canAffordGoodBuy = bestBuy != null && state.cash >= bestBuy.pricePresent;

  // (3) Withdraw if good buy + insufficient cash + bank has money
  if (hasGoodBuy && state.bank > 0 && state.cash < bestBuy!.pricePresent * 5) {
    return { payDebt: false, deposit: false, withdraw: true, reason: `withdraw to fund ${bestBuy!.drug} buy (margin ${(bestBuy!.margin * 100).toFixed(0)}%)` };
  }

  // (2) Deposit if cash exceeds what we'd deploy this turn
  // Reserve = enough cash to take advantage of the *current* best buy
  const reserveNeeded = hasGoodBuy && canAffordGoodBuy
    ? Math.min(state.cash, bestBuy!.pricePresent * inventoryFree(state))
    : 0;
  const excess = state.cash - reserveNeeded;

  // EV of depositing excess vs holding cash:
  //   bank: excess × 1.05^E_TURNS_TO_NEXT_BRONX  (compounded until next withdrawal)
  //   cash: excess × (1 - MUGGER_P)^turnsRemaining - mugger losses
  // For typical params, deposit dominates if excess > ~$500 and turnsRemaining > 2.
  const bankReturn = excess * (Math.pow(1 + BANK_INTEREST, Math.min(E_TURNS_TO_NEXT_BRONX, turnsRemaining)) - 1);
  const muggerLoss = MUGGER_P * MUGGER_E * Math.min(E_TURNS_TO_NEXT_BRONX, turnsRemaining);
  const depositGain = bankReturn + muggerLoss; // both favor depositing

  if (excess >= 500 && depositGain > 50 && turnsRemaining > 1) {
    return { payDebt: false, deposit: true, withdraw: false, reason: `deposit excess $${excess.toFixed(0)} (bank +$${bankReturn.toFixed(0)} + mugger avoid $${muggerLoss.toFixed(0)})` };
  }

  return { payDebt: false, deposit: false, withdraw: false, reason: 'hold cash for trading' };
}

export function bestDrugBuy(state: FullState, turnsRemaining: number): DrugBuyEV | null {
  let best: DrugBuyEV | null = null;
  for (const d of DRUGS) {
    const ev = drugBuyEV(state, d.id, turnsRemaining);
    if (ev && ev.perUnit > 0 && (best == null || ev.margin > best.margin)) best = ev;
  }
  return best;
}

export function bestDrugSell(state: FullState, turnsRemaining: number): { drug: DrugId; ev: number; sellNow: boolean } | null {
  let best: { drug: DrugId; ev: number; sellNow: boolean } | null = null;
  for (const d of DRUGS) {
    const ev = drugSellEV(state, d.id, turnsRemaining);
    if (ev && ev.sellNow && (best == null || ev.ev > best.ev)) {
      best = { drug: d.id, ev: ev.ev, sellNow: true };
    }
  }
  return best;
}

// ─── Re-export constants for tests ────────────────────────────────────────
export { AVG_COP_RISK, E_PROFIT_PER_SLOT_PER_TURN, E_TURNS_TO_NEXT_BRONX, DEBT_INTEREST, BANK_INTEREST };
