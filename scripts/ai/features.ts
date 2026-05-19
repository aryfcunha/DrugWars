// State -> flat numeric feature vector for the value/policy network.
//
// Design principles (from Splendor MuZero research):
//   - Flat observation, all values roughly in [-1, 2] range to keep gradients sane
//   - Log-scale large monetary quantities (cash, bank, debt) — they span 5 orders of magnitude
//   - Normalize prices by drug-specific midpoints so each drug's signal is comparable
//   - Include both "have/cost" and "ratio" features so the network doesn't have to learn ratios
//   - One-hot location (6 dims) since they have distinct cop-risk + banking roles
//   - **v3:** add event-specific features (cop count, offer details, inventory value)
//     so the network can reason about FIGHT-vs-RUN, ACCEPT-vs-DECLINE, and
//     liquidation-for-arbitrage decisions.

import { type FullState } from './sim.ts';
import { DRUGS } from '../../src/game/data.ts';
import { LOCATIONS } from './sim.ts';
import { inventoryUsed } from '../../src/game/state.ts';

const DRUG_MID = DRUGS.map(d => (d.min + d.max) / 2);

// log1p(x/scale) is a smooth monotone compression of [0, ∞)
const lg = (x: number, scale: number) => Math.log1p(Math.max(0, x) / scale);

// Feature vector size (must match NN input dim)
export const FEATURE_DIM =
    3   // cash / bank / debt (log-scaled)
  + 1   // hp [0,1]
  + 1   // guns (capped, normalized)
  + 1   // capacity utilization [0,1]
  + 1   // capacity-free / capacity [0,1]
  + 1   // day-progress  [0,1] (or day/120 for endless)
  + 1   // endless flag (binary)
  + 6   // inventory per drug (log-scaled)
  + 6   // price-per-drug (price/mid, 0 if absent)
  + 6   // price-presence flags
  + 6   // location one-hot
  + 1   // in cop fight flag
  + 1   // pending event with offer flag
  + 1   // net worth (tanh-squashed)
  // ── v3 additions: event-specific signal ──
  + 1   // cop count (when fighting, 0 otherwise), capped/normalized
  + 1   // combat strength: guns * hp/100 (heuristic for FIGHT viability)
  + 1   // offer cash cost / (cash + 1)  — affordability of pending offer
  + 1   // offer guns delta normalized   — does the offer give a gun?
  + 1   // offer capacity delta / 10     — does the offer give coat space?
  + 1   // inventory market value (log-scaled) — sellable wealth right now
  + 1   // inventory value / (cash + 1)  — liquidity ratio
  + 1   // can-afford-coat flag (cash >= 200)
  + 1   // in-bronx flag (banking accessible)
  ;     // = 44

export function featurize(s: FullState): Float32Array {
  const f = new Float32Array(FEATURE_DIM);
  let i = 0;

  // 1. Cash / bank / debt (log-scaled to dampen $10–$1M range)
  f[i++] = lg(s.cash, 1000);
  f[i++] = lg(s.bank, 1000);
  f[i++] = lg(s.debt, 1000);

  // 2. HP
  f[i++] = s.hp / 100;

  // 3. Guns (typical range 0–6)
  f[i++] = Math.min(1, s.guns / 4);

  // 4. Capacity utilization (used / capacity)
  const used = inventoryUsed(s);
  const capUtil = s.capacity > 0 ? Math.min(1, used / s.capacity) : 0;
  f[i++] = capUtil;

  // 5. Free capacity / capacity (complement, but encoded separately to help the
  //    network reason about absolute free space)
  f[i++] = 1 - capUtil;

  // 6. Day progress
  const endless = s.mode === 'endless';
  f[i++] = endless ? Math.min(1, s.day / 120) : (s.totalDays > 0 ? s.day / s.totalDays : 0);

  // 7. Endless flag
  f[i++] = endless ? 1 : 0;

  // 8. Inventory per drug (log)
  for (const d of DRUGS) f[i++] = lg(s.inv.drugs[d.id], 10);

  // 9. Price / drug-midpoint (or 0 if absent)
  for (let j = 0; j < DRUGS.length; j++) {
    const p = s.market.prices[DRUGS[j].id];
    f[i++] = p == null ? 0 : (p / DRUG_MID[j]);
  }

  // 10. Price presence flags
  for (const d of DRUGS) f[i++] = s.market.prices[d.id] != null ? 1 : 0;

  // 11. Location one-hot
  for (const l of LOCATIONS) f[i++] = s.locationId === l.id ? 1 : 0;

  // 12. Combat phase
  const inFight = s.phase === 'fighting_cops';
  f[i++] = inFight ? 1 : 0;

  // 13. Event with offer pending
  const hasOffer = s.phase === 'event' && !!s.pendingEventGenerated?.offer;
  f[i++] = hasOffer ? 1 : 0;

  // 14. Net worth, signed log scale
  const nw = s.cash + s.bank - s.debt;
  f[i++] = Math.tanh(nw / 30_000);

  // ── v3 additions ──

  // 15. Cop count (when fighting, 0 otherwise). Officer count caps around 6.
  const cops = inFight && s.fight ? s.fight.copsLeft : 0;
  f[i++] = Math.min(1, cops / 6);

  // 16. Combat strength heuristic
  f[i++] = (s.guns * s.hp) / 400;       // 4 guns × 100 hp = 1.0

  // 17–19. Offer details (cost, gun delta, capacity delta)
  if (hasOffer) {
    const o = s.pendingEventGenerated!.offer!;
    const cost = -(o.accept.cashDelta ?? 0);
    f[i++] = Math.min(2, cost / (s.cash + 1));
    f[i++] = (o.accept.gunsDelta ?? 0) / 1;       // typically +1
    f[i++] = (o.accept.capacityDelta ?? 0) / 10;  // typically +10 trench coat
  } else {
    f[i++] = 0; f[i++] = 0; f[i++] = 0;
  }

  // 20. Inventory market value: sum_d inv[d] * price[d] for drugs present in market
  let invValue = 0;
  for (const d of DRUGS) {
    const q = s.inv.drugs[d.id];
    const p = s.market.prices[d.id];
    if (q > 0 && p != null) invValue += q * p;
  }
  f[i++] = lg(invValue, 1000);

  // 21. Inventory-value / cash ratio (liquidity headroom)
  f[i++] = Math.min(5, invValue / (s.cash + 1));

  // 22. Can-afford-coat (cash >= 200)
  f[i++] = s.cash >= 200 ? 1 : 0;

  // 23. In-Bronx flag (banking + loan shark accessible without travel)
  f[i++] = s.locationId === 'bronx' ? 1 : 0;

  // Sanity
  if (i !== FEATURE_DIM) throw new Error(`feature dim mismatch: ${i} vs ${FEATURE_DIM}`);

  return f;
}
