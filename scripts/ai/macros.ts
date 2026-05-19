// Fixed action index — every possible Macro mapped to a stable integer in [0, N).
// Required because the policy head has a fixed output dimension; at each state
// we mask out illegal indices before softmax.

import { type Macro } from './actions.ts';
import { DRUGS } from '../../src/game/data.ts';
import { LOCATIONS } from './sim.ts';

// Layout (37 actions total):
//   [0..5]   BUY_MAX  per drug
//   [6..11]  BUY_HALF per drug
//   [12..17] SELL_ALL per drug
//   [18..23] SELL_HALF per drug
//   [24..29] TRAVEL   per location
//   [30]     BUY_COAT
//   [31]     PAY_DEBT_ALL
//   [32]     DEPOSIT_ALL
//   [33]     WITHDRAW_ALL
//   [34]     FIGHT
//   [35]     RUN
//   [36]     ACCEPT_OFFER
//   [37]     DECLINE_OFFER
//   [38]     RETIRE
export const NUM_MACROS = 39;

const DRUG_INDEX: Record<string, number> = Object.fromEntries(
  DRUGS.map((d, i) => [d.id, i]),
);
const LOC_INDEX: Record<string, number> = Object.fromEntries(
  LOCATIONS.map((l, i) => [l.id, i]),
);

export function macroToIndex(m: Macro): number {
  switch (m.kind) {
    case 'BUY_MAX':       return 0 + DRUG_INDEX[m.drug];
    case 'BUY_HALF':      return 6 + DRUG_INDEX[m.drug];
    case 'SELL_ALL':      return 12 + DRUG_INDEX[m.drug];
    case 'SELL_HALF':     return 18 + DRUG_INDEX[m.drug];
    case 'TRAVEL':        return 24 + LOC_INDEX[m.locationId];
    case 'BUY_COAT':      return 30;
    case 'PAY_DEBT_ALL':  return 31;
    case 'DEPOSIT_ALL':   return 32;
    case 'WITHDRAW_ALL':  return 33;
    case 'FIGHT':         return 34;
    case 'RUN':           return 35;
    case 'ACCEPT_OFFER':  return 36;
    case 'DECLINE_OFFER': return 37;
    case 'RETIRE':        return 38;
  }
}

export function legalMask(legal: Macro[]): Float32Array {
  const m = new Float32Array(NUM_MACROS);
  for (const a of legal) m[macroToIndex(a)] = 1;
  return m;
}
