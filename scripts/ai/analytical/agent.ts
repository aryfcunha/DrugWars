// Analytical agent V1 — picks actions by expected value from first principles.
// Every strategic insight is a config flag so we can A/B test each.

import { type FullState } from '../sim';
import { type Macro, legalActions } from '../actions';
import { DRUGS, DRUG_BY_ID, type DrugId } from '../../../src/game/data';
import { inventoryFree } from '../../../src/game/state';
import { mulberry32 } from '../../../src/game/rng';
import type { CombatTable } from './combat';
import { lookup } from './combat';
import {
  drugBuyEV, drugSellEV, gunOfferEV, estimateInventoryValue, pCopEncounter,
  E_COPS_PER_ENCOUNTER, MUGGER_P, MUGGER_E, bestDrugBuy,
} from './values';
import { DEFAULT_CONFIG, type StrategyConfig } from './config';

export interface AnalyticalAgentOpts {
  combatTable: CombatTable;
  config?: Partial<StrategyConfig>;
  exploreRate?: number;
  seed?: number;
}

export function makeAnalyticalAgent(opts: AnalyticalAgentOpts) {
  const cfg: StrategyConfig = { ...DEFAULT_CONFIG, ...(opts.config ?? {}) };
  const rng = mulberry32(opts.seed ?? 0xC0FFEE);
  const explore = opts.exploreRate ?? 0;

  return {
    name: `ANALYTICAL[${shortLabel(cfg)}]`,
    config: cfg,
    choose: (s: FullState): Macro | null => {
      const actions = legalActions(s);
      if (!actions.length) return null;
      if (explore > 0 && rng() < explore) return actions[(rng() * actions.length) | 0];

      // In endless mode treat "remaining turns" as a large constant so we
      // never turtle. The game is bounded only by maxTurns in the sim/eval
      // harness, but strategically we should keep compounding.
      const turnsLeft = s.mode === 'endless' ? 999 : Math.max(0, s.totalDays - s.day);

      // ── Endless-mode retire decision ──
      // Infinite-horizon value: VALUE_future = G / pDeath. Retire when
      // current NW exceeds the expected NPV of continuing. Cop-risk
      // multiplier ramps 1.0× → 2.5× from day 30 to day 105.
      if (s.mode === 'endless' && s.phase === 'playing' && actsHas(actions, 'RETIRE')) {
        const nw = s.cash + s.bank - s.debt;
        if (s.day >= cfg.retireMinDay && nw >= cfg.retireMinNetWorth) {
          const copMult = Math.min(2.5, 1 + Math.max(0, s.day - 30) * 0.02);
          const pDeathPerDay = 0.015 * copMult;
          // Expected per-day gain: heuristic that scales with NW but saturates
          // (market liquidity bounds how much capital you can deploy per turn).
          const G = Math.min(nw * 0.10, 500_000);
          const valueOfContinuing = G / Math.max(0.001, pDeathPerDay);
          if (nw > valueOfContinuing) return { kind: 'RETIRE' };
        }
      }

      // ── Combat ──
      if (s.phase === 'fighting_cops') return chooseCombat(s, cfg, opts.combatTable);

      // ── Offer event (gun for sale) ──
      if (s.phase === 'event' && s.pendingEventGenerated?.offer) {
        return chooseOffer(s, cfg, turnsLeft, opts.combatTable);
      }

      // ── Trading phase ──
      // Step -1: Cheap-drug detection — price below the drug's normal min can only
      // happen from a cheap_drug event (0.25× multiplier). Expected return ~4×
      // when sold at any normal market. Dump everything else to buy it.
      const cheapBuy = detectCheapDrug(s);
      if (cheapBuy && turnsLeft > 1) {
        // First: liquidate any non-cheap holdings to free cash
        for (const d of DRUGS) {
          if (d.id === cheapBuy) continue;
          if (s.inv.drugs[d.id] > 0 && s.market.prices[d.id] != null && actsHasDrug(actions, 'SELL_ALL', d.id)) {
            return { kind: 'SELL_ALL', drug: d.id };
          }
        }
        // Then BUY_MAX the cheap drug
        if (actsHasDrug(actions, 'BUY_MAX', cheapBuy)) return { kind: 'BUY_MAX', drug: cheapBuy };
      }

      // Step 0: Panic-sell at low HP — dump inventory to travel empty.
      // When carrying drugs, the cop-encounter roll gates on hasDrugs; emptying
      // out makes travel completely safe.
      if (s.hp < cfg.panicSellHpThreshold) {
        for (const d of DRUGS) {
          if (s.inv.drugs[d.id] > 0 && s.market.prices[d.id] != null && actsHasDrug(actions, 'SELL_ALL', d.id)) {
            return { kind: 'SELL_ALL', drug: d.id };
          }
        }
      }

      // Step 1: Banking & debt (Bronx only)
      if (s.locationId === 'bronx') {
        const bankAction = chooseBronxAction(s, cfg, turnsLeft, actions);
        if (bankAction) return bankAction;
      }

      // Step 2: Sell holdings at favorable prices — frees cash and capacity
      const sell = chooseSell(s, cfg, turnsLeft, actions);
      if (sell) return sell;

      // Step 3: Coat decision (JIT, early-compound, or legacy) — comes BEFORE buy
      // so capacity expansion happens before cash deployment. Otherwise we'd
      // BUY_MAX with the smaller capacity and the coat would only help next trade.
      if (turnsLeft > cfg.turtleAtTurnsLeft) {
        const coat = chooseCoat(s, cfg, turnsLeft, actions);
        if (coat) return coat;
      }

      // Step 4: Buy at favorable prices (if not turtling)
      if (turnsLeft > cfg.turtleAtTurnsLeft) {
        const buy = chooseBuy(s, cfg, turnsLeft, actions);
        if (buy) return buy;
      }

      // Step 5: Fire-sale before travel when HP-vulnerable.
      // Carrying inventory through a travel rolls a cop encounter (gated by hasDrugs).
      // At full HP we can absorb ~1 encounter; at reduced HP a second encounter
      // is likely fatal, so we dump inventory at whatever price the market offers.
      // (Above 60 HP we accept the risk because losing ~$5k to a sub-threshold
      // sell would compound over many travels.)
      const hpVulnerable = s.hp < 60;
      if (cfg.fireSaleBeforeTravel && hpVulnerable) {
        let bestHolding: { drug: DrugId; revenue: number } | null = null;
        for (const d of DRUGS) {
          const price = s.market.prices[d.id];
          const have = s.inv.drugs[d.id];
          if (price == null || have <= 0) continue;
          const revenue = price * have;
          if (bestHolding == null || revenue > bestHolding.revenue) bestHolding = { drug: d.id, revenue };
        }
        if (bestHolding && actsHasDrug(actions, 'SELL_ALL', bestHolding.drug)) {
          return { kind: 'SELL_ALL', drug: bestHolding.drug };
        }
      }

      // Step 6: Travel
      return chooseTravel(s, cfg, actions);
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Combat decision
// ───────────────────────────────────────────────────────────────────────────

function chooseCombat(s: FullState, cfg: StrategyConfig, combatTable: CombatTable): Macro {
  const cops = s.fight?.copsLeft ?? E_COPS_PER_ENCOUNTER;
  const hasGuns = s.guns > 0;

  if (cfg.combatMode === 'always-run') return { kind: 'RUN' };
  if (cfg.combatMode === 'always-fight' && hasGuns) return { kind: 'FIGHT' };

  // Analytical: pick max-EV action.
  // EV = P(survive) × (cash+bank+inventory_value + loot_or_minus_drops)
  const wealth = s.cash + s.bank;
  const invValue = estimateInventoryValue(s);

  const fight = lookup(combatTable, 'fight', cops, s.hp, s.guns);
  const run = lookup(combatTable, 'run', cops, s.hp, s.guns);

  const eFight = hasGuns ? fight.pWin * (wealth + invValue + fight.eLoot) : 0;
  const eRun = run.pWin * (wealth + invValue - run.eDrops * 1000); // ~$1000/avg drug unit

  if (!hasGuns) return { kind: 'RUN' };
  return eFight > eRun ? { kind: 'FIGHT' } : { kind: 'RUN' };
}

// ───────────────────────────────────────────────────────────────────────────
// Gun offer
// ───────────────────────────────────────────────────────────────────────────

function chooseOffer(s: FullState, cfg: StrategyConfig, turnsLeft: number, combatTable: CombatTable): Macro {
  if (cfg.gunMode === 'decline-all') return { kind: 'DECLINE_OFFER' };
  if (cfg.gunMode === 'first-only') return s.guns === 0 ? { kind: 'ACCEPT_OFFER' } : { kind: 'DECLINE_OFFER' };
  // Analytical EV
  const cashDelta = s.pendingEventGenerated?.offer?.accept.cashDelta ?? 0;
  const cost = -cashDelta;
  if (cost <= 0 || cost > s.cash) return { kind: 'DECLINE_OFFER' };
  const ev = gunOfferEV(s, cost, turnsLeft, combatTable);
  return ev > 0 ? { kind: 'ACCEPT_OFFER' } : { kind: 'DECLINE_OFFER' };
}

// ───────────────────────────────────────────────────────────────────────────
// Bronx: debt, deposit, withdraw
// ───────────────────────────────────────────────────────────────────────────

function chooseBronxAction(s: FullState, cfg: StrategyConfig, turnsLeft: number, actions: Macro[]): Macro | null {
  const hasGoodBuy = bestDrugBuy(s, turnsLeft);
  const goodBuyMargin = hasGoodBuy?.margin ?? 0;

  // Debt payment — only when we can pay off in full (cash ≥ debt) OR when no good
  // buy is available and we'd otherwise idle. Partial-payment loops are anti-strategy.
  const canPayoff = s.debt > 0 && s.cash >= s.debt;
  if (canPayoff && cfg.debtMode !== 'never' && actsHas(actions, 'PAY_DEBT_ALL')) {
    return { kind: 'PAY_DEBT_ALL' };
  }
  if (cfg.debtMode === 'always' && s.debt > 0 && s.cash > 0 && goodBuyMargin < cfg.buyMarginThreshold && actsHas(actions, 'PAY_DEBT_ALL')) {
    return { kind: 'PAY_DEBT_ALL' };
  }
  if (cfg.debtMode === 'fallback' && s.debt > 0 && s.cash > 0 && goodBuyMargin < cfg.buyMarginThreshold && actsHas(actions, 'PAY_DEBT_ALL')) {
    return { kind: 'PAY_DEBT_ALL' };
  }

  // Banking
  if (cfg.bankingMode === 'on') {
    // Withdraw if we have a great buy and not enough cash
    if (hasGoodBuy && hasGoodBuy.margin > cfg.buyMarginThreshold * 2 && s.bank > 0 && s.cash < hasGoodBuy.pricePresent * 5 && actsHas(actions, 'WITHDRAW_ALL')) {
      return { kind: 'WITHDRAW_ALL' };
    }
    // Deposit if cash overflows what we'd deploy
    // With the cash-ratio coat logic, we should rarely have actual overflow.
    // But late game with no debt, depositing makes some sense vs mugger risk.
    if (s.debt === 0 && s.cash > 50_000 && goodBuyMargin < cfg.buyMarginThreshold && actsHas(actions, 'DEPOSIT_ALL')) {
      // Only deposit when there's truly nothing better to do
      return { kind: 'DEPOSIT_ALL' };
    }
  }

  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Sell
// ───────────────────────────────────────────────────────────────────────────

function sellThresholdFor(d: typeof DRUGS[number], cfg: StrategyConfig): number {
  if (cfg.sellMode === 'user-threshold') {
    return cfg.userThresholds[d.id] ?? (d.min + 0.70 * (d.max - d.min));
  }
  const p = cfg.sellMode === 'uniform-percentile' ? cfg.uniformSellPercentile : cfg.sellPercentile;
  return d.min + p * (d.max - d.min);
}

function chooseSell(s: FullState, cfg: StrategyConfig, _turnsLeft: number, actions: Macro[]): Macro | null {
  let best: { drug: DrugId; gain: number } | null = null;
  for (const d of DRUGS) {
    const price = s.market.prices[d.id];
    const have = s.inv.drugs[d.id];
    if (price == null || have <= 0) continue;
    const threshold = sellThresholdFor(d, cfg);
    if (price < threshold) continue;
    const gain = price * have;
    if (best == null || gain > best.gain) best = { drug: d.id, gain };
  }
  if (best && actsHasDrug(actions, 'SELL_ALL', best.drug)) return { kind: 'SELL_ALL', drug: best.drug };
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Buy
// ───────────────────────────────────────────────────────────────────────────

interface BuyCandidate {
  drug: DrugId;
  price: number;
  score: number;          // ranking score (higher = better)
  sellTarget: number;     // expected sell price
  perUnitProfit: number;  // sellTarget - price
}

function rankBuyCandidates(s: FullState, cfg: StrategyConfig, turnsLeft: number): BuyCandidate[] {
  const candidates: BuyCandidate[] = [];
  const freeCap = inventoryFree(s);
  for (const d of DRUGS) {
    const price = s.market.prices[d.id];
    if (price == null || price <= 0) continue;
    let qualifies = false;
    let sellTarget = 0;

    if (cfg.buyMode === 'user-threshold') {
      const threshold = cfg.userThresholds[d.id] ?? (d.min + 0.70 * (d.max - d.min));
      if (price < threshold) { qualifies = true; sellTarget = threshold; }
    } else if (cfg.buyMode === 'uniform-percentile') {
      const buyCap = d.min + cfg.uniformBuyPercentile * (d.max - d.min);
      const sellCap = d.min + cfg.uniformSellPercentile * (d.max - d.min);
      if (price <= buyCap) { qualifies = true; sellTarget = sellCap; }
    } else { // margin mode
      const ev = drugBuyEV(s, d.id, turnsLeft);
      if (ev && ev.margin >= cfg.buyMarginThreshold) { qualifies = true; sellTarget = price + ev.perUnit; }
    }
    if (qualifies) {
      // Rank by EXPECTED TOTAL PROFIT achievable on this trade given current
      // cash & capacity — not by relative return. This handles the mid-range
      // case where a cheap-but-thin-margin drug (ludes) and an expensive-but-
      // fat-margin drug (cocaine) both qualify: pick whichever moves more
      // dollars of profit through the inventory.
      const perUnit = sellTarget - price;
      const unitsCash = Math.floor(s.cash / price);
      const unitsBuyable = Math.min(unitsCash, freeCap);
      const score = unitsBuyable * perUnit;
      candidates.push({ drug: d.id, price, score, sellTarget, perUnitProfit: sellTarget - price });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function chooseBuy(s: FullState, cfg: StrategyConfig, turnsLeft: number, actions: Macro[]): Macro | null {
  const candidates = rankBuyCandidates(s, cfg, turnsLeft);
  if (candidates.length === 0) return null;

  const top = candidates[0];
  const second = candidates[1];
  const dominant = !second || top.score > second.score * 1.5;

  let useHalf = false;
  if (cfg.allocationMode === 'diversify') useHalf = !!second;
  else if (cfg.allocationMode === 'concentrate') useHalf = false;
  else useHalf = turnsLeft < 5 && !!second && !dominant;

  if (useHalf && actsHasDrug(actions, 'BUY_HALF', top.drug)) return { kind: 'BUY_HALF', drug: top.drug };
  if (actsHasDrug(actions, 'BUY_MAX', top.drug)) return { kind: 'BUY_MAX', drug: top.drug };
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Coat
// ───────────────────────────────────────────────────────────────────────────

const COAT_COST = 200;
const COAT_SLOTS = 10;
const COAT_BREAKEVEN_PER_SLOT = COAT_COST / COAT_SLOTS; // $20/slot

/** JIT coat purchase: when an active buy opportunity exists and we have spare cash
 *  but limited capacity, buy coats until cash and capacity bind simultaneously.
 *  Math: N* = (C - P·K) / (200 + 10·P), buy ceil(N*) if positive.
 *  Profitability gate: per-unit profit on the active trade > $20 (coat pays back). */
function jitCoatDecision(
  s: FullState,
  cfg: StrategyConfig,
  turnsLeft: number,
): { shouldBuy: boolean; reason: string } {
  if (s.cash < COAT_COST + 100) return { shouldBuy: false, reason: 'too poor' };
  const candidates = rankBuyCandidates(s, cfg, turnsLeft);
  if (candidates.length === 0) return { shouldBuy: false, reason: 'no active buy' };
  const top = candidates[0];
  if (top.perUnitProfit < COAT_BREAKEVEN_PER_SLOT) {
    return { shouldBuy: false, reason: `profit/unit $${top.perUnitProfit.toFixed(0)} < $${COAT_BREAKEVEN_PER_SLOT}` };
  }
  const K = inventoryFree(s);
  const C = s.cash;
  const P = top.price;
  // N* = (C - P*K) / (200 + 10*P). Positive only if C > P*K (cash exceeds what
  // current capacity could absorb at this price).
  const numerator = C - P * K;
  if (numerator <= 0) return { shouldBuy: false, reason: 'capacity already sufficient' };
  // N* > 0 → buy a coat (one per decision; the next decision re-evaluates).
  return { shouldBuy: true, reason: `JIT for ${top.drug} at $${P}` };
}

function chooseCoat(s: FullState, cfg: StrategyConfig, turnsLeft: number, actions: Macro[]): Macro | null {
  if (cfg.coatMode === 'never') return null;
  if (!actsHas(actions, 'BUY_COAT')) return null;
  if (s.cash < 1000) return null;

  // (1) JIT: fires whenever there's an active high-margin buy needing more capacity.
  if (cfg.jitCoats) {
    const decision = jitCoatDecision(s, cfg, turnsLeft);
    if (decision.shouldBuy) return { kind: 'BUY_COAT' };
  }

  // (2) Aggressive: any spare cash + many turns left → buy coats to compound.
  // The slot's expected value over remaining turns dominates the $20 cost.
  if (cfg.aggressiveCoats && turnsLeft > 5 && s.cash > 1000) {
    return { kind: 'BUY_COAT' };
  }

  // (3) Early-compound: turns_left > 15 AND capacity tightening (utilization above threshold).
  if (cfg.earlyCompoundCoats && turnsLeft > 15 && s.cash > 1000) {
    const utilization = (s.capacity - inventoryFree(s)) / Math.max(1, s.capacity);
    if (utilization > cfg.coatEarlyMinUtilization) return { kind: 'BUY_COAT' };
  }

  // (4) Legacy modes
  if (s.cash < 5000) return null;
  if (cfg.coatMode === 'ev-gated') return { kind: 'BUY_COAT' };
  const used = s.capacity - inventoryFree(s);
  const utilization = used / Math.max(1, s.capacity);
  if (utilization > cfg.coatCashRatio) return { kind: 'BUY_COAT' };
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Travel
// ───────────────────────────────────────────────────────────────────────────

const LOC_RISK: Record<string, number> = {
  bronx: 0.10, ghetto: 0.19, central: 0.07, manhattan: 0.15, coney: 0.05, brooklyn: 0.10,
};

const TRAVEL_MODES = {
  'coney-central': ['coney', 'central'],
  'low-risk-3': ['coney', 'central', 'bronx'],
  'any': ['coney', 'central', 'bronx', 'brooklyn', 'manhattan', 'ghetto'],
};

function chooseTravel(s: FullState, cfg: StrategyConfig, actions: Macro[]): Macro | null {
  const travelActions = actions.filter(a => a.kind === 'TRAVEL') as Extract<Macro, { kind: 'TRAVEL' }>[];
  if (!travelActions.length) return actions[0];

  const hasInv = estimateInventoryValue(s) > 0;
  const allowedLocs = TRAVEL_MODES[cfg.travelMode];

  // Route to Bronx ONLY when we can fully extinguish the debt in one trip.
  // Partial payments oscillate (Bronx → trade → Bronx → trade) which burns turns.
  const wantsBronx = !cfg.bronxOnlyWhenEmpty || !hasInv;
  const canPayoffDebt = cfg.debtMode !== 'never' && s.debt > 0 && s.cash >= s.debt;
  if (canPayoffDebt && wantsBronx && s.locationId !== 'bronx') {
    const bronx = travelActions.find(t => t.locationId === 'bronx');
    if (bronx) return bronx;
  }

  // Filter to allowed locations
  let candidates = travelActions.filter(t => allowedLocs.includes(t.locationId));
  if (!candidates.length) candidates = travelActions; // fallback

  // When carrying drugs, exclude bronx and high-risk
  if (hasInv) {
    const carryingOnly = candidates.filter(t => t.locationId !== 'bronx');
    if (carryingOnly.length) candidates = carryingOnly;
  }

  // Pick lowest cop risk
  candidates.sort((a, b) => LOC_RISK[a.locationId] - LOC_RISK[b.locationId]);
  return candidates[0];
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/** Detect a cheap_drug event by checking if any market price is below the drug's
 *  normal min — this can only happen from the 0.25× multiplier. Returns the drug
 *  with the deepest discount, or null. */
function detectCheapDrug(s: FullState): DrugId | null {
  let best: { drug: DrugId; discount: number } | null = null;
  for (const d of DRUGS) {
    const price = s.market.prices[d.id];
    if (price == null) continue;
    if (price < d.min) {
      const discount = price / d.min;
      if (best == null || discount < best.discount) best = { drug: d.id, discount };
    }
  }
  return best?.drug ?? null;
}

function actsHas(actions: Macro[], kind: Macro['kind']): boolean {
  return actions.some(a => a.kind === kind);
}

function actsHasDrug(actions: Macro[], kind: 'BUY_MAX' | 'BUY_HALF' | 'SELL_ALL' | 'SELL_HALF', drug: DrugId): boolean {
  return actions.some(a => a.kind === kind && 'drug' in a && a.drug === drug);
}

function shortLabel(cfg: StrategyConfig): string {
  const parts: string[] = [];
  parts.push(`bank=${cfg.bankingMode}`);
  parts.push(`debt=${cfg.debtMode}`);
  parts.push(`tr=${cfg.travelMode}`);
  parts.push(`cmb=${cfg.combatMode}`);
  parts.push(`gun=${cfg.gunMode}`);
  parts.push(`coat=${cfg.coatMode}`);
  parts.push(`alloc=${cfg.allocationMode}`);
  return parts.join(',');
}

// Re-export for callers
export { DEFAULT_CONFIG } from './config';
export type { StrategyConfig } from './config';

// Suppress: MUGGER_P, MUGGER_E, pCopEncounter unused but exported — kept for callers
void MUGGER_P; void MUGGER_E; void pCopEncounter;
