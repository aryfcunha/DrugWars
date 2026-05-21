// Strategy configuration for the analytical agent.
// Every hypothesis we want to test is a flag here.

export interface StrategyConfig {
  // ── Banking ──
  bankingMode: 'off' | 'on';                          // H1
  debtMode: 'never' | 'fallback' | 'always';          // H2

  // ── Travel ──
  travelMode: 'coney-central' | 'low-risk-3' | 'any'; // H3
  bronxOnlyWhenEmpty: boolean;

  // ── Combat ──
  combatMode: 'always-run' | 'analytical' | 'always-fight'; // H4
  gunMode: 'first-only' | 'analytical-ev' | 'decline-all';  // H5

  // ── Capacity ──
  coatMode: 'never' | 'ev-gated' | 'cash-ratio';      // H6
  coatCashRatio: number;                              // Q2: buy coat if (cash / (capacity × avg_price)) > this

  // ── Trading ──
  allocationMode: 'concentrate' | 'diversify' | 'horizon-adaptive'; // H7
  buyMarginThreshold: number;                         // Q1: min margin to buy (margin mode)
  sellPercentile: number;                             // H8: sell when price >= Nth percentile of range (percentile mode)

  // Buy/sell mode selectors
  buyMode: 'margin' | 'user-threshold' | 'uniform-percentile';
  sellMode: 'percentile' | 'user-threshold' | 'uniform-percentile';

  // user-threshold: per-drug absolute price thresholds (buy below, sell at/above)
  userThresholds: Partial<Record<'cocaine'|'heroin'|'acid'|'weed'|'speed'|'ludes', number>>;

  // uniform-percentile: single percentile applied across all drugs (0..1)
  uniformBuyPercentile: number;
  uniformSellPercentile: number;

  // JIT coat purchase math: buy coats to balance cash vs capacity for an active buy
  jitCoats: boolean;
  earlyCompoundCoats: boolean;                        // buy coats turns_left > 15 when capacity tightening
  aggressiveCoats: boolean;                           // buy coats whenever cash > $1k AND no immediate buy (mid game)
  coatEarlyMinUtilization: number;                    // utilization threshold for early-compound rule (default 0.3)

  // ── Endgame ──
  turtleAtTurnsLeft: number;                          // H10: at this many turns left, stop buying

  // ── Safety ──
  panicSellHpThreshold: number;                       // H11: if HP < this, dump inventory at any price
  fireSaleBeforeTravel: boolean;                      // H12: always sell inventory before traveling (avoid carrying)

  // ── Endless-mode retirement ──
  retireMinDay: number;                               // earliest day we'll consider retiring
  retireMinNetWorth: number;                          // minimum NW before retiring is even an option
  retireMaxDeathRatePerDay: number;                   // retire when est. P(death/day) > this × NW/gain
}

export const DEFAULT_CONFIG: StrategyConfig = {
  bankingMode: 'on',
  debtMode: 'fallback',
  travelMode: 'coney-central',
  bronxOnlyWhenEmpty: true,
  combatMode: 'analytical',
  gunMode: 'analytical-ev',
  coatMode: 'cash-ratio',
  coatCashRatio: 0.5,
  allocationMode: 'horizon-adaptive',
  buyMarginThreshold: 0.15,
  sellPercentile: 0.40,
  turtleAtTurnsLeft: 1,
  panicSellHpThreshold: 40,
  fireSaleBeforeTravel: true,
  // Retire on infinite-horizon value: stop compounding when NW exceeds
  // expected NPV of continuing (G / pDeath). Without retire the game has
  // no natural terminal state in endless mode — it just hits sim maxTurns.
  retireMinDay: 30,
  retireMinNetWorth: 500_000,
  retireMaxDeathRatePerDay: 0.015,
  buyMode: 'uniform-percentile',
  sellMode: 'uniform-percentile',
  userThresholds: {
    cocaine: 20000,
    heroin: 10000,
    acid: 2000,
    weed: 400,
    speed: 200,
    ludes: 30,
  },
  uniformBuyPercentile: 0.20,
  uniformSellPercentile: 0.50,
  jitCoats: true,
  earlyCompoundCoats: true,
  aggressiveCoats: false,
  coatEarlyMinUtilization: 0.3,
};

export function configHash(cfg: StrategyConfig): string {
  // Stable short hash of config — used as experiment id suffix.
  const json = JSON.stringify(cfg, Object.keys(cfg).sort());
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function describeDiff(a: StrategyConfig, b: StrategyConfig): string {
  const out: string[] = [];
  for (const k of Object.keys(a) as (keyof StrategyConfig)[]) {
    if (a[k] !== b[k]) out.push(`${k}:${a[k]}→${b[k]}`);
  }
  return out.join(' ');
}
