import { DRUGS, type DrugId } from './data';
import type { Market } from './state';
import type { Rng } from './rng';

// Generate a market for the player's current location for the current day.
// Each drug has a base [min, max] range; sometimes a drug is absent;
// sometimes a drug is at fire-sale or crazy-high prices (special events).
//
// modifiers lets event handlers tweak prices ahead of generation.
export interface MarketModifiers {
  // drugId -> multiplier
  multipliers?: Partial<Record<DrugId, number>>;
  // drugId -> force present (e.g. cheap deals)
  forcePresent?: Partial<Record<DrugId, boolean>>;
}

export function generateMarket(rng: Rng, modifiers: MarketModifiers = {}): Market {
  const prices: Partial<Record<DrugId, number>> = {};
  for (const drug of DRUGS) {
    // 75% chance present, 25% absent — except guarantees from events
    const present = modifiers.forcePresent?.[drug.id] ?? rng.chance(0.75);
    if (!present) continue;
    const base = rng.int(drug.min, drug.max);
    const mult = modifiers.multipliers?.[drug.id] ?? 1;
    prices[drug.id] = Math.max(1, Math.round(base * mult));
  }
  // Ensure at least 2 drugs available
  const count = Object.keys(prices).length;
  if (count < 2) {
    const remaining = DRUGS.filter(d => prices[d.id] == null);
    for (let i = 0; i < 2 - count; i++) {
      const d = rng.pick(remaining);
      prices[d.id] = rng.int(d.min, d.max);
      remaining.splice(remaining.indexOf(d), 1);
    }
  }
  return { prices };
}
