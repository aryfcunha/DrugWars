// State -> flat numeric feature vector for the value/policy network.
//
// Design principles (from Splendor research):
//   - Flat observation, all values roughly in [-1, 2] range to keep gradients sane
//   - Log-scale large monetary quantities (cash, bank, debt) — they span 5 orders of magnitude
//   - Normalize prices by drug-specific midpoints so each drug's signal is comparable
//   - Include both "have/cost" and "ratio" so the network doesn't have to learn ratios
//   - One-hot location (6 dims) since they have distinct cop-risk roles

import { type FullState } from './sim.ts';
import { DRUGS } from '../../src/game/data.ts';
import { LOCATIONS } from './sim.ts';
import { inventoryUsed } from '../../src/game/state.ts';

const DRUG_MID = DRUGS.map(d => (d.min + d.max) / 2);
const DRUG_RANGE = DRUGS.map(d => d.max - d.min);

// log1p(x/scale) is a smooth monotone compression of [0, ∞)
const lg = (x: number, scale: number) => Math.log1p(Math.max(0, x) / scale);

// Feature vector size (must match NN input dim)
export const FEATURE_DIM =
    3   // cash / bank / debt (log-scaled)
  + 1   // hp [0,1]
  + 1   // guns (capped, normalized)
  + 1   // capacity utilization [0,1]
  + 1   // day-progress  [0,1] (or day/120 for endless)
  + 1   // endless flag (binary)
  + 6   // inventory per drug (log-scaled)
  + 6   // price-per-drug (price/mid, 0 if absent)
  + 6   // price-presence flags
  + 6   // location one-hot
  + 1   // in cop fight
  + 1   // pending event with offer
  + 1   // net worth (log-scaled, signed)
  ;     // = 34

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
  f[i++] = s.capacity > 0 ? Math.min(1, used / s.capacity) : 0;

  // 5. Day progress
  const endless = s.mode === 'endless';
  f[i++] = endless ? Math.min(1, s.day / 120) : (s.totalDays > 0 ? s.day / s.totalDays : 0);

  // 6. Endless flag
  f[i++] = endless ? 1 : 0;

  // 7. Inventory per drug (log)
  for (const d of DRUGS) f[i++] = lg(s.inv.drugs[d.id], 10);

  // 8. Price / drug-midpoint (or 0 if absent)
  for (let j = 0; j < DRUGS.length; j++) {
    const p = s.market.prices[DRUGS[j].id];
    f[i++] = p == null ? 0 : (p / DRUG_MID[j]);
  }

  // 9. Price presence flags
  for (const d of DRUGS) f[i++] = s.market.prices[d.id] != null ? 1 : 0;

  // 10. Location one-hot
  for (const l of LOCATIONS) f[i++] = s.locationId === l.id ? 1 : 0;

  // 11. Combat phase
  f[i++] = s.phase === 'fighting_cops' ? 1 : 0;

  // 12. Event with offer pending
  f[i++] = (s.phase === 'event' && !!s.pendingEventGenerated?.offer) ? 1 : 0;

  // 13. Net worth, signed log scale (~tanh-ish)
  const nw = s.cash + s.bank - s.debt;
  f[i++] = Math.tanh(nw / 30_000);

  // Sanity
  if (i !== FEATURE_DIM) throw new Error(`feature dim mismatch: ${i} vs ${FEATURE_DIM}`);

  // Suppress unused-variable warning
  void DRUG_RANGE;

  return f;
}
